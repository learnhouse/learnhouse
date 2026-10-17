"""The indexing pipeline: the one code path that writes embeddings.

    ref -> extract segments -> chunk -> hash -> embed -> replace rows
                     \\-> pending media -> transcribe -> run again

Unchanged content (same hash) is not re-embedded; only the copied names are
refreshed. Media without a transcript is indexed by name first; when the run
may transcribe, it is transcribed afterwards and the ref is indexed again with
the transcript. Orgs that do not use AI search are not indexed at all.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime

from sqlmodel import select

from src.db.course_embeddings import CourseEmbedding
from src.db.courses.activities import Activity
from src.db.courses.courses import Course
from src.services.ai.rag import media as media_stage
from src.services.ai.rag import store
from src.services.ai.rag.embedding_service import chunk_text, generate_embeddings
from src.services.ai.rag.gating import orgs_using_ai
from src.services.ai.rag.sources import Extraction, extract
from src.services.ai.rag.types import ContentRef

logger = logging.getLogger(__name__)


def _session():
    from src.core.events.database import _async_session_factory

    return _async_session_factory()


async def _org_of(ref: ContentRef, db) -> int | None:
    model = Activity if ref.kind == "activity" else Course
    return (await db.execute(select(model.org_id).where(model.id == ref.id))).scalars().first()


async def run(ref: ContentRef, *, transcribe: bool = True) -> int:
    """Index one ref. Returns the number of chunks it now has."""
    async with _session() as db:
        org_id = await _org_of(ref, db)
        if org_id is None:
            return 0
        if not await orgs_using_ai([org_id], db):
            logger.debug("RAG: skipped %s, org %s does not use AI search", ref.key, org_id)
            return 0
        extraction = await extract(ref, db)
        if extraction is None:
            # Deleted since it was queued; its rows went with it (FK cascade).
            return 0
        count = await _store(extraction, db)

    if transcribe and extraction.pending_media:
        transcribed = False
        for media in extraction.pending_media:
            transcribed = await media_stage.transcribe(media) or transcribed
        if transcribed:
            return await run(ref, transcribe=False)
    return count


async def run_course(course_id: int, *, transcribe: bool = True) -> int:
    """Index a course's own text and every one of its activities."""
    async with _session() as db:
        activity_ids = (await db.execute(
            select(Activity.id).where(Activity.course_id == course_id)
        )).scalars().all()
    total = await run(ContentRef.course(course_id), transcribe=transcribe)
    for activity_id in activity_ids:
        total += await run(ContentRef.activity(activity_id), transcribe=transcribe)
    return total


def _chunks(extraction: Extraction) -> list[tuple[str, int, object]]:
    return [
        (chunk, index, segment)
        for segment in extraction.segments
        for index, chunk in enumerate(chunk_text(segment.text))
    ]


def _hash(chunks) -> str:
    payload = [
        [text, segment.source_type.value, segment.block_uuid, segment.locator, segment.chapter_name]
        for text, _, segment in chunks
    ]
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


async def _store(extraction: Extraction, db) -> int:
    ref = extraction.ref
    chunks = _chunks(extraction)
    content_hash = _hash(chunks)

    if chunks and await store.current_hash(ref, db) == content_hash:
        await store.rename(
            ref, db,
            course_id=extraction.course_id,
            course_name=extraction.course_name,
            activity_name=extraction.activity_name,
            chapter_name=extraction.chapter_name,
        )
        return len(chunks)

    # Embed before touching the table, so a provider failure leaves the
    # previous rows searchable.
    vectors = await generate_embeddings([text for text, _, _ in chunks]) if chunks else []
    now = str(datetime.now())
    rows = [
        CourseEmbedding(
            org_id=extraction.org_id,
            course_id=extraction.course_id,
            activity_id=extraction.activity_id,
            activity_uuid=extraction.activity_uuid,
            block_uuid=segment.block_uuid,
            source_type=segment.source_type.value,
            chunk_text=text,
            chunk_index=index,
            locator=segment.locator,
            content_hash=content_hash,
            activity_name=extraction.activity_name,
            chapter_name=segment.chapter_name or extraction.chapter_name,
            course_name=extraction.course_name,
            embedding=vector,
            creation_date=now,
            update_date=now,
        )
        for (text, index, segment), vector in zip(chunks, vectors)
    ]
    await store.replace(ref, rows, db)
    logger.info("RAG: indexed %s chunks for %s", len(rows), ref.key)
    return len(rows)
