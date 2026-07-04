from __future__ import annotations

import os

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from takehome.db.models import Conversation

logger = structlog.get_logger()


async def create_conversation(session: AsyncSession) -> Conversation:
    """Create a new conversation with default title."""
    conversation = Conversation()
    session.add(conversation)
    await session.commit()
    await session.refresh(conversation)
    return conversation


async def list_conversations(session: AsyncSession) -> list[Conversation]:
    """List all conversations ordered by most recently updated."""
    stmt = (
        select(Conversation)
        .options(selectinload(Conversation.documents))
        .order_by(Conversation.updated_at.desc())
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_conversation(session: AsyncSession, conversation_id: str) -> Conversation | None:
    """Get a single conversation with its documents eagerly loaded."""
    stmt = (
        select(Conversation)
        .options(selectinload(Conversation.documents))
        .where(Conversation.id == conversation_id)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def update_conversation(
    session: AsyncSession, conversation_id: str, title: str
) -> Conversation | None:
    """Update the title of a conversation."""
    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        return None
    conversation.title = title
    await session.commit()
    await session.refresh(conversation)
    return conversation


async def delete_conversation(session: AsyncSession, conversation_id: str) -> bool:
    """Delete a conversation and its documents' files. Returns True if it existed.

    The DB cascade removes the document rows; we also unlink the uploaded PDFs from
    disk so confidential files don't linger after a conversation is deleted.
    """
    stmt = (
        select(Conversation)
        .options(selectinload(Conversation.documents))
        .where(Conversation.id == conversation_id)
    )
    result = await session.execute(stmt)
    conversation = result.scalar_one_or_none()
    if conversation is None:
        return False

    file_paths = [doc.file_path for doc in conversation.documents]
    await session.delete(conversation)
    await session.commit()

    for path in file_paths:
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
        except OSError:
            logger.warning("Failed to remove document file on disk", path=path)
    return True
