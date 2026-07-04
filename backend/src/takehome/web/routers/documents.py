from __future__ import annotations

import os
from datetime import datetime

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import FileResponse

from takehome.config import settings
from takehome.db.session import get_session
from takehome.services.conversation import get_conversation
from takehome.services.document import (
    PreparedDocument,
    get_document,
    persist_documents,
    prepare_document,
)

logger = structlog.get_logger()

router = APIRouter(tags=["documents"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #


class DocumentOut(BaseModel):
    id: str
    conversation_id: str
    filename: str
    page_count: int
    uploaded_at: datetime

    model_config = {"from_attributes": True}


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #


@router.post(
    "/api/conversations/{conversation_id}/documents",
    response_model=list[DocumentOut],
    status_code=201,
)
async def upload_document_endpoint(
    conversation_id: str,
    files: list[UploadFile] = File(...),
    session: AsyncSession = Depends(get_session),
) -> list[DocumentOut]:
    """Upload one or more PDF documents to a conversation (additive).

    New documents are appended — existing documents are never dropped. The whole
    batch is validated before anything is persisted, so a bad file in the batch
    returns 400 without adding a partial subset.
    """
    # Verify the conversation exists
    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if not files:
        raise HTTPException(status_code=400, detail="No files were provided.")

    # Aggregate guardrails against resource exhaustion (multi-file uploads multiply
    # memory, disk, parser, and LLM cost).
    if len(files) > settings.max_files_per_upload:
        raise HTTPException(
            status_code=400,
            detail=(f"Too many files. Maximum {settings.max_files_per_upload} per upload."),
        )

    # Atomic batch validation: parse & validate every file first. Any failure
    # raises before we touch disk or the DB, so existing documents stay intact.
    prepared: list[PreparedDocument] = []
    total_bytes = 0
    try:
        for file in files:
            item = await prepare_document(file)
            total_bytes += len(item.content)
            if total_bytes > settings.max_total_upload_size:
                raise ValueError(
                    "Upload exceeds the total size limit of "
                    f"{settings.max_total_upload_size // (1024 * 1024)}MB per request."
                )
            prepared.append(item)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    documents = await persist_documents(session, conversation_id, prepared)

    logger.info(
        "Documents uploaded",
        conversation_id=conversation_id,
        count=len(documents),
        document_ids=[d.id for d in documents],
    )

    return [
        DocumentOut(
            id=document.id,
            conversation_id=document.conversation_id,
            filename=document.filename,
            page_count=document.page_count,
            uploaded_at=document.uploaded_at,
        )
        for document in documents
    ]


@router.get("/api/documents/{document_id}/content")
async def serve_document_file(
    document_id: str,
    session: AsyncSession = Depends(get_session),
) -> FileResponse:
    """Serve the raw PDF file for download/viewing."""
    document = await get_document(session, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    if not os.path.exists(document.file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=document.file_path,
        filename=document.filename,
        media_type="application/pdf",
    )
