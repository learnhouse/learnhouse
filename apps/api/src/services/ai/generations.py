"""Durable AI-generation history (Postgres).

The hybrid-history counterpart to the ephemeral Redis refine sessions in
``src/services/ai/base.py``. Every artifact the user keeps (a generated image,
a quiz, an assignment plan) is recorded here so each feature's "History" tab can
list, re-open, and delete past generations long after the 25-day Redis TTL.

Ownership is enforced on read/delete via ``user_id`` (IDOR guard), mirroring
``chat_session_belongs_to_user`` in ``base.py``.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional
from uuid import uuid4

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.ai.generations import (
    AIGeneration,
    AIGenerationKind,
    AIGenerationRead,
)

logger = logging.getLogger(__name__)


async def record_generation(
    db_session: AsyncSession,
    *,
    kind: AIGenerationKind,
    org_id: int,
    user_id: int,
    prompt: str,
    result: dict,
    session_uuid: Optional[str] = None,
    course_id: Optional[int] = None,
    activity_id: Optional[int] = None,
    assignment_id: Optional[int] = None,
) -> AIGenerationRead:
    """Persist a kept AI-generated artifact and return the read model."""
    now = str(datetime.now())
    generation = AIGeneration(
        ai_generation_uuid=f"aigen_{uuid4()}",
        kind=kind,
        org_id=org_id,
        user_id=user_id,
        prompt=prompt or "",
        result=result or {},
        session_uuid=session_uuid,
        course_id=course_id,
        activity_id=activity_id,
        assignment_id=assignment_id,
        creation_date=now,
        update_date=now,
    )
    db_session.add(generation)
    await db_session.commit()
    await db_session.refresh(generation)
    return AIGenerationRead.model_validate(generation.model_dump())


async def list_generations(
    db_session: AsyncSession,
    *,
    org_id: int,
    user_id: int,
    kind: AIGenerationKind,
    limit: int = 30,
    offset: int = 0,
) -> list[AIGenerationRead]:
    """List a user's durable generations of a given kind within an org, newest first."""
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    statement = (
        select(AIGeneration)
        .where(
            AIGeneration.org_id == org_id,
            AIGeneration.user_id == user_id,
            AIGeneration.kind == kind,
        )
        .order_by(AIGeneration.id.desc())  # type: ignore[union-attr]
        .offset(offset)
        .limit(limit)
    )
    rows = (await db_session.execute(statement)).scalars().all()
    return [AIGenerationRead.model_validate(r.model_dump()) for r in rows]


async def get_generation(
    db_session: AsyncSession,
    *,
    ai_generation_uuid: str,
    user_id: int,
) -> Optional[AIGenerationRead]:
    """Fetch one generation, enforcing ownership. Returns None if missing/not owned."""
    row = await _get_owned(db_session, ai_generation_uuid, user_id)
    if row is None:
        return None
    return AIGenerationRead.model_validate(row.model_dump())


async def delete_generation(
    db_session: AsyncSession,
    *,
    ai_generation_uuid: str,
    user_id: int,
) -> bool:
    """Delete one generation, enforcing ownership. Returns True if deleted."""
    row = await _get_owned(db_session, ai_generation_uuid, user_id)
    if row is None:
        return False
    await db_session.delete(row)
    await db_session.commit()
    return True


async def _get_owned(
    db_session: AsyncSession,
    ai_generation_uuid: str,
    user_id: int,
) -> Optional[AIGeneration]:
    statement = select(AIGeneration).where(
        AIGeneration.ai_generation_uuid == ai_generation_uuid
    )
    row = (await db_session.execute(statement)).scalars().first()
    if row is None or row.user_id != user_id:
        return None
    return row
