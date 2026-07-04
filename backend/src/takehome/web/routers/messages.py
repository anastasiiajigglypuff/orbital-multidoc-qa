from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import datetime

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import StreamingResponse

from takehome.db.models import Message
from takehome.db.session import get_session
from takehome.services.conversation import get_conversation, update_conversation
from takehome.services.document import get_document, get_documents_for_conversation
from takehome.services.llm import (
    chat_with_documents,
    generate_title,
    summarize_documents,
    verify_citations,
)

logger = structlog.get_logger()

router = APIRouter(tags=["messages"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    sources_cited: int
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageCreate(BaseModel):
    content: str


class DocumentSummaryRequest(BaseModel):
    document_ids: list[str]


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #


@router.get(
    "/api/conversations/{conversation_id}/messages",
    response_model=list[MessageOut],
)
async def list_messages(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
) -> list[MessageOut]:
    """List all messages in a conversation, ordered by creation time."""
    # Verify the conversation exists
    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    result = await session.execute(stmt)
    messages = list(result.scalars().all())

    return [
        MessageOut(
            id=m.id,
            conversation_id=m.conversation_id,
            role=m.role,
            content=m.content,
            sources_cited=m.sources_cited,
            created_at=m.created_at,
        )
        for m in messages
    ]


@router.post("/api/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    body: MessageCreate,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """Send a user message and stream back the AI response via SSE."""
    # Verify the conversation exists
    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Save the user message
    user_message = Message(
        conversation_id=conversation_id,
        role="user",
        content=body.content,
    )
    session.add(user_message)
    await session.commit()
    await session.refresh(user_message)

    logger.info("User message saved", conversation_id=conversation_id, message_id=user_message.id)

    # Load all documents for the conversation (full-context stuffing).
    documents = await get_documents_for_conversation(session, conversation_id)
    document_payload: list[dict[str, str]] = [
        {"id": d.id, "filename": d.filename, "text": d.extracted_text}
        for d in documents
        if d.extracted_text
    ]

    # Load conversation history (exclude the message we just saved, it will be the user_message param)
    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .where(Message.id != user_message.id)
        .order_by(Message.created_at.asc())
    )
    result = await session.execute(stmt)
    history_messages = list(result.scalars().all())

    conversation_history: list[dict[str, str]] = [
        {"role": m.role, "content": m.content} for m in history_messages
    ]

    # Determine if this is the first user message (for title generation)
    user_msg_count = sum(1 for m in history_messages if m.role == "user")
    is_first_message = user_msg_count == 0

    async def event_stream() -> AsyncIterator[str]:
        """Generate SSE events with the streamed LLM response."""
        full_response = ""
        errored = False

        try:
            async for chunk in chat_with_documents(
                user_message=body.content,
                documents=document_payload,
                conversation_history=conversation_history,
            ):
                full_response += chunk
                event_data = json.dumps({"type": "content", "content": chunk})
                yield f"data: {event_data}\n\n"

        except Exception:
            logger.exception(
                "Error during LLM streaming",
                conversation_id=conversation_id,
            )
            errored = True
            error_msg = (
                "I'm sorry, an error occurred while generating a response. Please try again."
            )
            full_response = error_msg
            event_data = json.dumps({"type": "content", "content": error_msg})
            yield f"data: {event_data}\n\n"

        # Resolve inline citation markers against the conversation's documents.
        # On the error path we skip verification: the error text has no markers,
        # carries no citations, and gets no CITATIONS block.
        if errored:
            content_to_store = full_response
            sources = 0
        else:
            clean_text, citations, verified_count = verify_citations(
                full_response, document_payload
            )
            sources = verified_count
            # amber (server-authoritative): documents present, nothing verified,
            # and the answer isn't a NOT-FOUND / refusal reply.
            is_not_found = "not found in the provided documents" in full_response.lower()
            amber = bool(document_payload) and verified_count == 0 and not is_not_found
            block = (
                "<<<CITATIONS>>>\n"
                + json.dumps({"citations": citations, "amber": amber})
                + "\n<<<END CITATIONS>>>"
            )
            content_to_store = f"{clean_text}\n{block}"

        # Save the assistant message to the database.
        # We need a fresh session since the outer one may have been closed.
        from takehome.db.session import async_session as session_factory

        async with session_factory() as save_session:
            assistant_message = Message(
                conversation_id=conversation_id,
                role="assistant",
                content=content_to_store,
                sources_cited=sources,
            )
            save_session.add(assistant_message)
            await save_session.commit()
            await save_session.refresh(assistant_message)

            # Auto-generate title from first user message
            if is_first_message:
                try:
                    title = await generate_title(body.content)
                    await update_conversation(save_session, conversation_id, title)
                    logger.info(
                        "Auto-generated conversation title",
                        conversation_id=conversation_id,
                        title=title,
                    )
                except Exception:
                    logger.exception(
                        "Failed to generate title",
                        conversation_id=conversation_id,
                    )

            # Send the final message event with the complete assistant message
            message_data = json.dumps(
                {
                    "type": "message",
                    "message": {
                        "id": assistant_message.id,
                        "conversation_id": assistant_message.conversation_id,
                        "role": assistant_message.role,
                        "content": assistant_message.content,
                        "sources_cited": assistant_message.sources_cited,
                        "created_at": assistant_message.created_at.isoformat(),
                    },
                }
            )
            yield f"data: {message_data}\n\n"

            # Send the done signal
            done_data = json.dumps(
                {
                    "type": "done",
                    "sources_cited": sources,
                    "message_id": assistant_message.id,
                }
            )
            yield f"data: {done_data}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/api/conversations/{conversation_id}/documents/summary")
async def summarize_uploaded_documents(
    conversation_id: str,
    body: DocumentSummaryRequest,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """Stream a brief assistant summary of just-uploaded documents via SSE.

    Saves the streamed text as an assistant message at the end. There is no user
    message and no title generation — this is a proactive orientation bubble.
    """
    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Resolve the requested documents, keeping only those that belong to this
    # conversation and actually have extracted text.
    document_payload: list[dict[str, str]] = []
    for doc_id in body.document_ids:
        doc = await get_document(session, doc_id)
        if doc is not None and doc.conversation_id == conversation_id and doc.extracted_text:
            document_payload.append(
                {"id": doc.id, "filename": doc.filename, "text": doc.extracted_text}
            )

    async def event_stream() -> AsyncIterator[str]:
        full_response = ""
        try:
            async for chunk in summarize_documents(document_payload):
                full_response += chunk
                event_data = json.dumps({"type": "content", "content": chunk})
                yield f"data: {event_data}\n\n"
        except Exception:
            logger.exception(
                "Error during document summary streaming",
                conversation_id=conversation_id,
            )
            error_msg = "Documents added. Ask a question to get started."
            full_response = error_msg
            event_data = json.dumps({"type": "content", "content": error_msg})
            yield f"data: {event_data}\n\n"

        if not full_response.strip():
            return

        from takehome.db.session import async_session as session_factory

        async with session_factory() as save_session:
            # Summaries never carry verified citations and must never render
            # as "Unverified", so no CITATIONS block is appended and
            # sources_cited stays 0.
            assistant_message = Message(
                conversation_id=conversation_id,
                role="assistant",
                content=full_response,
                sources_cited=0,
            )
            save_session.add(assistant_message)
            await save_session.commit()
            await save_session.refresh(assistant_message)

            message_data = json.dumps(
                {
                    "type": "message",
                    "message": {
                        "id": assistant_message.id,
                        "conversation_id": assistant_message.conversation_id,
                        "role": assistant_message.role,
                        "content": assistant_message.content,
                        "sources_cited": assistant_message.sources_cited,
                        "created_at": assistant_message.created_at.isoformat(),
                    },
                }
            )
            yield f"data: {message_data}\n\n"

            done_data = json.dumps({"type": "done", "message_id": assistant_message.id})
            yield f"data: {done_data}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
