"""Persistence of embedded rows, scoped by ContentRef.

An activity ref owns the rows with its activity_id; a course ref owns the
course's rows that have no activity (course and chapter text).
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import delete, update
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.course_embeddings import CourseEmbedding
from src.services.ai.rag.types import ContentRef


def _owned_by(ref: ContentRef):
    if ref.kind == "activity":
        return (CourseEmbedding.activity_id == ref.id,)
    return (CourseEmbedding.course_id == ref.id, CourseEmbedding.activity_id.is_(None))  # type: ignore[union-attr]


async def current_hash(ref: ContentRef, db: AsyncSession) -> Optional[str]:
    """The content hash of a ref's rows, if they were all written together."""
    hashes = set((await db.execute(
        select(CourseEmbedding.content_hash).where(*_owned_by(ref)).distinct()
    )).scalars().all())
    return hashes.pop() if len(hashes) == 1 else None


async def replace(ref: ContentRef, rows: list[CourseEmbedding], db: AsyncSession) -> None:
    """Swap a ref's rows for new ones in one transaction."""
    await db.execute(delete(CourseEmbedding).where(*_owned_by(ref)))
    db.add_all(rows)
    await db.commit()


async def rename(
    ref: ContentRef,
    db: AsyncSession,
    *,
    course_id: int,
    course_name: str,
    activity_name: str = "",
    chapter_name: str = "",
) -> None:
    """Refresh the names copied onto rows without re-embedding them, and mark
    the ref's rows as checked now so the periodic backfill sees them current."""
    now = str(datetime.now())
    if ref.kind == "activity":
        await db.execute(
            update(CourseEmbedding)
            .where(*_owned_by(ref))
            .values(activity_name=activity_name, chapter_name=chapter_name, course_name=course_name, update_date=now)
        )
    else:
        await db.execute(
            update(CourseEmbedding).where(CourseEmbedding.course_id == course_id).values(course_name=course_name)
        )
        await db.execute(update(CourseEmbedding).where(*_owned_by(ref)).values(update_date=now))
    await db.commit()
