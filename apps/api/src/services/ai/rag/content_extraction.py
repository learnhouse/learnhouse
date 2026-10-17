"""Course text extraction for AI features that read content directly.

The extractors live in ``sources``; this module keeps the helpers other AI
features (quiz, scenario and assignment generation) import.
"""

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.services.ai.rag.formats import is_safe_content_path as _is_safe_content_path  # noqa: F401
from src.services.ai.rag.sources import extract
from src.services.ai.rag.sources.dynamic import (  # noqa: F401
    MAX_HEADING_LEVEL,
    _walk_prosemirror_node,
    extract_text_from_prosemirror,
)
from src.services.ai.rag.types import ContentRef


async def extract_all_course_content(
    course_id: int,
    org_id: int,
    db_session: AsyncSession,
) -> list[dict]:
    """The text of every activity in a course, one item per activity.

    Items are ``{text, activity_id, activity_uuid, activity_name,
    chapter_name, course_name}``. Reads stored transcripts but never starts a
    transcription.
    """
    activity_ids = (await db_session.execute(
        select(Activity.id).where(Activity.course_id == course_id, Activity.org_id == org_id)
    )).scalars().all()

    items = []
    for activity_id in activity_ids:
        extraction = await extract(ContentRef.activity(activity_id), db_session)
        if extraction is None:
            continue
        items.append({
            "text": "\n\n".join(s.text for s in extraction.segments),
            "activity_id": extraction.activity_id,
            "activity_uuid": extraction.activity_uuid,
            "activity_name": extraction.activity_name,
            "chapter_name": extraction.chapter_name,
            "course_name": extraction.course_name,
        })
    return items
