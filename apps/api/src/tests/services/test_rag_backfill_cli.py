"""The index-backfill command."""

from unittest.mock import AsyncMock, patch

import cli
from src.tests.services.rag_helpers import same_session


async def test_enqueues_every_course_without_transcribing_by_default(db, org, course):
    with patch("src.core.events.database._async_session_factory", new=lambda: same_session(db)), \
         patch("src.services.ai.rag.queue.enqueue_course", new=AsyncMock(return_value=3)) as enqueue:
        assert await cli._index_backfill("", "", inline=False, transcribe=False) == {"courses": 1, "items": 3}
    enqueue.assert_awaited_once_with(course.id, db, delay=0, transcribe=False)


async def test_filters_and_inline(db, org, course):
    with patch("src.core.events.database._async_session_factory", new=lambda: same_session(db)), \
         patch("src.services.ai.rag.pipeline.run_course", new=AsyncMock(return_value=5)) as run:
        assert await cli._index_backfill(org.slug, course.course_uuid, inline=True, transcribe=True) == {
            "courses": 1, "items": 5,
        }
        assert await cli._index_backfill("no-such-org", "", inline=True, transcribe=True) == {"courses": 0, "items": 0}
    run.assert_awaited_once_with(course.id, transcribe=True)
