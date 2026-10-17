"""The indexing pipeline: ref -> segments -> chunks -> embeddings -> rows."""

from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import select

from src.db.course_embeddings import CourseEmbedding
from src.db.organization_config import OrganizationConfig
from src.services.ai.rag import pipeline, store
from src.services.ai.rag.media import Media
from src.services.ai.rag.types import ContentRef
from src.tests.services.rag_helpers import (
    ActivitySubTypeEnum,
    ActivityTypeEnum,
    add_activity,
    same_session,
)


def _page(text):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


async def _fake_embeddings(texts):
    return [[0.1] * 768 for _ in texts]


@pytest.fixture
def embed():
    with patch.object(pipeline, "generate_embeddings", new=AsyncMock(side_effect=_fake_embeddings)) as mock:
        yield mock


@pytest.fixture
def session(db):
    with patch.object(pipeline, "_session", new=lambda: same_session(db)):
        yield db


async def _rows(db, **where):
    statement = select(CourseEmbedding)
    for key, value in where.items():
        statement = statement.where(getattr(CourseEmbedding, key) == value)
    return (await db.execute(statement.order_by(CourseEmbedding.id))).scalars().all()


async def _page_activity(db, org, course, chapter, activity_id, text, name=None):
    return await add_activity(
        db, org, course, chapter, activity_id,
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content=_page(text),
        name=name,
    )


class TestRun:
    async def test_indexes_an_activity(self, session, embed, org, course, chapter):
        await _page_activity(session, org, course, chapter, 10, "Cells divide by mitosis.", name="Mitosis")
        count = await pipeline.run(ContentRef.activity(10))

        rows = await _rows(session, activity_id=10)
        assert count == len(rows) == 2
        assert {r.source_type for r in rows} == {"activity", "dynamic_page"}
        page = next(r for r in rows if r.source_type == "dynamic_page")
        assert page.chunk_text == "Cells divide by mitosis."
        assert (page.activity_name, page.chapter_name, page.course_name) == ("Mitosis", "Test Chapter", "Test Course")
        assert page.activity_uuid == "activity_10"
        assert len({r.content_hash for r in rows}) == 1

    async def test_unchanged_content_is_not_embedded_again_but_names_refresh(
        self, session, embed, org, course, chapter
    ):
        activity = await _page_activity(session, org, course, chapter, 11, "Same text", name="Old name")
        await pipeline.run(ContentRef.activity(11))
        embed.reset_mock()

        # Same text, new name: the summary segment changes, so this does re-embed.
        activity.name = "New name"
        session.add(activity)
        await session.commit()
        await pipeline.run(ContentRef.activity(11))
        assert embed.await_count == 1

        # Nothing changed at all: no embedding call, rows untouched.
        embed.reset_mock()
        before = [r.id for r in await _rows(session, activity_id=11)]
        await pipeline.run(ContentRef.activity(11))
        embed.assert_not_awaited()
        assert [r.id for r in await _rows(session, activity_id=11)] == before

    async def test_hash_match_still_refreshes_copied_names(self, session, embed, org, course, chapter):
        await _page_activity(session, org, course, chapter, 12, "Text")
        await pipeline.run(ContentRef.activity(12))
        course.name = "Renamed Course"
        session.add(course)
        await session.commit()
        embed.reset_mock()

        await pipeline.run(ContentRef.activity(12))
        embed.assert_not_awaited()
        assert {r.course_name for r in await _rows(session, activity_id=12)} == {"Renamed Course"}

    async def test_replaces_only_its_own_rows(self, session, embed, org, course, chapter):
        await _page_activity(session, org, course, chapter, 13, "First")
        activity = await _page_activity(session, org, course, chapter, 14, "Second")
        await pipeline.run(ContentRef.activity(13))
        await pipeline.run(ContentRef.activity(14))
        untouched = [r.id for r in await _rows(session, activity_id=13)]

        activity.content = _page("Second, edited")
        session.add(activity)
        await session.commit()
        await pipeline.run(ContentRef.activity(14))

        assert [r.id for r in await _rows(session, activity_id=13)] == untouched
        assert "Second, edited" in [r.chunk_text for r in await _rows(session, activity_id=14)]

    async def test_embedding_failure_keeps_previous_rows(self, session, embed, org, course, chapter):
        activity = await _page_activity(session, org, course, chapter, 15, "Before")
        await pipeline.run(ContentRef.activity(15))
        activity.content = _page("After")
        session.add(activity)
        await session.commit()

        embed.side_effect = RuntimeError("provider down")
        with pytest.raises(RuntimeError):
            await pipeline.run(ContentRef.activity(15))
        assert "Before" in [r.chunk_text for r in await _rows(session, activity_id=15)]

    async def test_course_ref_owns_rows_without_activity(self, session, embed, org, course, chapter):
        await _page_activity(session, org, course, chapter, 16, "Activity text")
        await pipeline.run(ContentRef.activity(16))
        await pipeline.run(ContentRef.course(course.id))

        course_rows = [r for r in await _rows(session, course_id=course.id) if r.activity_id is None]
        assert [(r.source_type, r.chapter_name) for r in course_rows] == [
            ("course", ""), ("chapter", "Test Chapter"),
        ]
        # Re-running the course ref leaves the activity's rows alone.
        await pipeline.run(ContentRef.course(course.id))
        assert len(await _rows(session, activity_id=16)) == 2

    async def test_deleted_ref_is_a_no_op(self, session, embed):
        assert await pipeline.run(ContentRef.activity(404)) == 0
        embed.assert_not_awaited()

    async def test_run_course_indexes_everything(self, session, embed, org, course, chapter):
        await _page_activity(session, org, course, chapter, 17, "One")
        await _page_activity(session, org, course, chapter, 18, "Two")
        total = await pipeline.run_course(course.id)
        assert total == len(await _rows(session, course_id=course.id)) == 2 + 2 + 2


class TestOrgGate:
    @pytest.mark.parametrize("toggles", [
        {"features": {"ai": {"enabled": False}}},
        {"admin_toggles": {"ai": {"copilot_enabled": False}}},
    ])
    async def test_orgs_without_ai_search_are_not_indexed(self, session, embed, org, course, chapter, toggles):
        session.add(OrganizationConfig(
            org_id=org.id, config={"config_version": "2.0", **toggles}, creation_date="", update_date="",
        ))
        await session.commit()
        await _page_activity(session, org, course, chapter, 30, "Text")

        enabled = "features" not in toggles
        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": enabled}):
            assert await pipeline.run(ContentRef.activity(30)) == 0
            assert await pipeline.run(ContentRef.course(course.id)) == 0

        embed.assert_not_awaited()
        assert await _rows(session, course_id=course.id) == []


class TestTranscriptionStage:
    async def _video(self, db, org, course, chapter):
        return await add_activity(
            db, org, course, chapter, 20,
            activity_type=ActivityTypeEnum.TYPE_VIDEO,
            sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
            content={"filename": "lecture.mp4"},
            name="Lecture",
        )

    async def test_transcribes_pending_media_then_indexes_again(self, session, embed, org, course, chapter):
        await self._video(session, org, course, chapter)
        transcripts = [None, "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello class\n"]

        async def read_transcript(media):
            return transcripts[0]

        async def transcribe(media):
            assert isinstance(media, Media) and media.owner_id == 20
            transcripts.pop(0)
            return True

        with patch("src.services.ai.rag.media.read_transcript", new=read_transcript), \
             patch("src.services.ai.rag.media.transcribe", new=AsyncMock(side_effect=transcribe)) as mock_t:
            count = await pipeline.run(ContentRef.activity(20))

        mock_t.assert_awaited_once()
        rows = await _rows(session, activity_id=20)
        assert count == 2
        video = next(r for r in rows if r.source_type == "video")
        assert (video.chunk_text, video.locator) == ("Hello class", {"start": 1.0})

    async def test_failed_transcription_does_not_loop(self, session, embed, org, course, chapter):
        await self._video(session, org, course, chapter)
        with patch("src.services.ai.rag.media.read_transcript", new=AsyncMock(return_value=None)), \
             patch("src.services.ai.rag.media.transcribe", new=AsyncMock(return_value=False)) as mock_t:
            count = await pipeline.run(ContentRef.activity(20))
        mock_t.assert_awaited_once()
        assert count == 1  # findable by name meanwhile

    async def test_transcription_can_be_skipped(self, session, embed, org, course, chapter):
        await self._video(session, org, course, chapter)
        with patch("src.services.ai.rag.media.read_transcript", new=AsyncMock(return_value=None)), \
             patch("src.services.ai.rag.media.transcribe", new=AsyncMock()) as mock_t:
            await pipeline.run(ContentRef.activity(20), transcribe=False)
        mock_t.assert_not_awaited()


class TestStore:
    async def test_current_hash_needs_a_single_hash(self, db, org, course):
        for content_hash in ("a", "b"):
            db.add(CourseEmbedding(
                org_id=org.id, course_id=course.id, activity_id=None, source_type="course",
                chunk_text="x", embedding=[0.0] * 768, content_hash=content_hash,
            ))
        await db.commit()
        assert await store.current_hash(ContentRef.course(course.id), db) is None
        assert await store.current_hash(ContentRef.activity(1), db) is None
