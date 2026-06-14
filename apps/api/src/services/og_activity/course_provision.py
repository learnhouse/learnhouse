"""DB-direct provisioning of the LearnHouse course (per launch) and chapter
(per artifact) that ingested activities attach to.

Find-or-create, keyed on ``extra_metadata.kb_id`` — the same idempotency key the
activity adapter uses. Runs without an HTTP request/user (background/bookkeeping
context), mirroring ``lh_course_client.py``. ``Activity`` rows are NOT created
here — they go through the service-layer ``ActivityStore`` so chapter linkage,
ordering, and versioning are reused.
"""

from datetime import datetime
from uuid import uuid4

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.services.og_activity.alignment import AlignmentRef, alignment_metadata, alignment_tags


def _now() -> str:
    return str(datetime.now())


async def _find_course_by_kb_id(session: AsyncSession, org_id: int, kb_id: str) -> Course | None:
    stmt = select(Course).where(
        Course.org_id == org_id,
        Course.extra_metadata["kb_id"].as_string() == kb_id,
    )
    return (await session.execute(stmt)).scalars().first()


async def provision_launch_course(
    session: AsyncSession,
    org_id: int,
    launch: dict,
    alignment: list[AlignmentRef],
) -> int:
    """Create or update the course for `launch`. Returns the course id."""
    kb_id = launch["id"]
    tags = ",".join(t for t in ["source:kb", alignment_tags(alignment)] if t)
    meta = {
        "source": "kb",
        "kb_id": kb_id,
        "kb_sha": launch.get("sourceSha"),
        "kb_alignment": alignment_metadata(alignment),
    }
    now = _now()
    existing = await _find_course_by_kb_id(session, org_id, kb_id)

    if existing is None:
        course = Course(
            org_id=org_id,
            name=launch.get("name") or "Untitled Launch",
            description=launch.get("summary") or "",
            tags=tags,
            public=False,
            published=True,
            open_to_contributors=False,
            course_uuid=f"course_{uuid4()}",
            creation_date=now,
            update_date=now,
            extra_metadata=meta,
        )
        session.add(course)
        await session.commit()
        await session.refresh(course)
        return course.id

    # Skip the rewrite when sha is unchanged — mirrors lh_course_client's sha-skip
    # so re-runs don't churn update_date unnecessarily.
    existing_meta = existing.extra_metadata or {}
    if launch.get("sourceSha") and existing_meta.get("kb_sha") == launch.get("sourceSha"):
        return existing.id

    existing.name = launch.get("name") or existing.name
    existing.description = launch.get("summary") or existing.description
    existing.tags = tags or existing.tags
    existing.extra_metadata = meta
    existing.update_date = now
    session.add(existing)
    await session.commit()
    await session.refresh(existing)
    return existing.id


async def _find_chapter_by_kb_id(session: AsyncSession, course_id: int, kb_id: str) -> Chapter | None:
    stmt = select(Chapter).where(
        Chapter.course_id == course_id,
        Chapter.extra_metadata["kb_id"].as_string() == kb_id,
    )
    return (await session.execute(stmt)).scalars().first()


async def provision_artifact_chapter(
    session: AsyncSession,
    org_id: int,
    course_id: int,
    artifact: dict,
) -> int:
    """Find-or-create the chapter for `artifact` under `course_id`. Returns the
    chapter id. Idempotent on the artifact's `extra_metadata.kb_id`."""
    kb_id = artifact["id"]
    existing = await _find_chapter_by_kb_id(session, course_id, kb_id)
    if existing is not None:
        return existing.id

    now = _now()
    # order = current chapter count. NOTE: not lock-guarded — safe because KB
    # ingest provisions chapters sequentially within a single run.
    existing_links = (
        await session.execute(
            select(CourseChapter).where(CourseChapter.course_id == course_id)
        )
    ).scalars().all()
    count = len(existing_links)

    chapter = Chapter(
        name=artifact.get("name") or "Content",
        org_id=org_id,
        course_id=course_id,
        chapter_uuid=f"chapter_{uuid4()}",
        creation_date=now,
        update_date=now,
        extra_metadata={"source": "kb", "kb_id": kb_id},
    )
    session.add(chapter)
    await session.flush()  # assign chapter.id before the link row

    session.add(
        CourseChapter(
            order=count,
            course_id=course_id,
            chapter_id=chapter.id,
            org_id=org_id,
            creation_date=now,
            update_date=now,
        )
    )
    await session.commit()
    await session.refresh(chapter)
    return chapter.id
