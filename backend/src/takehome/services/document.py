from __future__ import annotations

import os
import re
import uuid
from dataclasses import dataclass
from typing import Any

import fitz  # type: ignore  # PyMuPDF ships no type stubs
import structlog
from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from takehome.config import settings
from takehome.db.models import Document

logger = structlog.get_logger()

# PDFs always start with the %PDF- magic bytes. MIME type and extension are both
# trivially spoofable, so we verify the actual content before trusting a file.
_PDF_MAGIC = b"%PDF-"
_FILENAME_MAX_LEN = 200


def sanitize_filename(raw: str | None) -> str:
    """Return a safe display filename from untrusted upload metadata.

    Strips any path components, control characters, and collapses whitespace so a
    malicious filename can't traverse directories or corrupt logs/API responses.
    """
    name = (raw or "document.pdf").strip()
    # Drop any directory components (handles both / and \ separators).
    name = name.replace("\\", "/").split("/")[-1]
    # Remove control characters.
    name = re.sub(r"[\x00-\x1f\x7f]", "", name)
    name = name.strip() or "document.pdf"
    if len(name) > _FILENAME_MAX_LEN:
        root, ext = os.path.splitext(name)
        name = root[: _FILENAME_MAX_LEN - len(ext)] + ext
    return name


@dataclass
class PreparedDocument:
    """A validated, parsed upload that is ready to be persisted.

    Produced before any disk/DB writes so a batch upload can be validated
    atomically — if any file fails, nothing is persisted.
    """

    filename: str
    content: bytes
    extracted_text: str
    page_count: int


def _extract_text(content: bytes, filename: str) -> tuple[str, int]:
    """Parse a PDF from bytes and return (extracted_text, page_count).

    Raises ValueError if the bytes are not a parseable PDF, so we never store an
    unusable document that would later produce misleading "not found" answers.
    """
    try:
        doc: Any = fitz.open(stream=content, filetype="pdf")
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Failed to open PDF", filename=filename, error=str(exc))
        raise ValueError(f"'{filename}' is not a readable PDF file.") from exc

    try:
        page_count: int = len(doc)
        pages: list[str] = []
        for page_num in range(page_count):
            text: str = doc[page_num].get_text()
            if text.strip():
                pages.append(f"--- Page {page_num + 1} ---\n{text}")
        extracted_text = "\n\n".join(pages)
    finally:
        doc.close()

    if not extracted_text.strip():
        raise ValueError(
            f"No text could be extracted from '{filename}'. Scanned/image-only PDFs "
            "are not yet supported."
        )
    return extracted_text, page_count


async def prepare_document(file: UploadFile) -> PreparedDocument:
    """Validate and parse a single uploaded file without touching disk or the DB.

    Raises ValueError (→ HTTP 400) on any validation or parse failure.
    """
    filename = sanitize_filename(file.filename)

    # Cheap gate on the declared type/extension before reading the body.
    declared_ok = file.content_type in ("application/pdf", "application/x-pdf")
    if not declared_ok and not filename.lower().endswith(".pdf"):
        raise ValueError(f"'{filename}' is not a PDF. Only PDF files are supported.")

    content = await file.read()

    if len(content) > settings.max_upload_size:
        raise ValueError(
            f"'{filename}' is too large. Maximum size is "
            f"{settings.max_upload_size // (1024 * 1024)}MB."
        )

    # Content-based validation: MIME/extension are spoofable, magic bytes are not.
    if not content.startswith(_PDF_MAGIC):
        raise ValueError(f"'{filename}' is not a valid PDF file.")

    extracted_text, page_count = _extract_text(content, filename)
    return PreparedDocument(
        filename=filename,
        content=content,
        extracted_text=extracted_text,
        page_count=page_count,
    )


async def persist_documents(
    session: AsyncSession,
    conversation_id: str,
    prepared: list[PreparedDocument],
) -> list[Document]:
    """Write prepared documents to disk and the DB in a single commit.

    Called only after every file in the batch has been validated, so existing
    documents are never dropped by a partially-failed upload.
    """
    os.makedirs(settings.upload_dir, exist_ok=True)

    documents: list[Document] = []
    for item in prepared:
        unique_name = f"{uuid.uuid4().hex}_{item.filename}"
        file_path = os.path.join(settings.upload_dir, unique_name)
        with open(file_path, "wb") as f:
            f.write(item.content)

        logger.info(
            "Saved uploaded PDF",
            filename=item.filename,
            path=file_path,
            size=len(item.content),
            page_count=item.page_count,
        )

        document = Document(
            conversation_id=conversation_id,
            filename=item.filename,
            file_path=file_path,
            extracted_text=item.extracted_text or None,
            page_count=item.page_count,
        )
        session.add(document)
        documents.append(document)

    await session.commit()
    for document in documents:
        await session.refresh(document)
    return documents


async def get_document(session: AsyncSession, document_id: str) -> Document | None:
    """Get a document by its ID."""
    stmt = select(Document).where(Document.id == document_id)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def get_documents_for_conversation(
    session: AsyncSession, conversation_id: str
) -> list[Document]:
    """Get all documents for a conversation in a stable order.

    Ordered by upload time then id so the tile order, API order, and prompt order
    all match (deterministic even when two uploads share a timestamp).
    """
    stmt = (
        select(Document)
        .where(Document.conversation_id == conversation_id)
        .order_by(Document.uploaded_at.asc(), Document.id.asc())
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())
