"""Course-level text: the course description and its chapters.

Stored with no activity, so it is readable by anyone who can read the course.
"""

from __future__ import annotations

import json

from sqlmodel import select

from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.services.ai.rag.formats import join, prose_strings
from src.services.ai.rag.sources import SourceContext
from src.services.ai.rag.types import Segment, SourceType


async def extract_course(course: Course, ctx: SourceContext) -> list[Segment]:
    segments = [Segment(
        text=join([
            f"Course: {course.name}",
            course.description,
            course.about and f"About: {course.about}",
            _learnings(course.learnings),
            course.tags and f"Tags: {course.tags}",
        ]),
        source_type=SourceType.COURSE,
    )]
    chapters = (await ctx.db.execute(
        select(Chapter).where(Chapter.course_id == course.id).order_by(Chapter.id)
    )).scalars().all()
    for chapter in chapters:
        segments.append(Segment(
            text=join([f"Chapter: {chapter.name}", chapter.description]),
            source_type=SourceType.CHAPTER,
            # Course-level rows have no block; the chapter uuid keeps each
            # chapter a distinct source.
            block_uuid=chapter.chapter_uuid,
            chapter_name=chapter.name,
        ))
    return [s for s in segments if s.text.strip()]


def _learnings(raw) -> str:
    """Learnings are stored as a JSON list of items; older rows are plain text."""
    if not isinstance(raw, str) or not raw.strip():
        return ""
    try:
        items = list(prose_strings(json.loads(raw)))
    except ValueError:
        items = [raw]
    return join(["What you will learn:", *(f"- {item}" for item in items)]) if items else ""
