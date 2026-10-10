"""AI search, index status and manual re-index endpoints."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.db.course_embeddings import CourseEmbedding
from src.db.courses.blocks import Block, BlockTypeEnum
from src.db.organization_config import OrganizationConfig
from src.routers.ai import rag as rag_router
from src.routers.ai.rag import RAGIndexRequest, RAGSearchRequest
from src.tests.services.rag_helpers import ActivitySubTypeEnum, ActivityTypeEnum, add_activity


def _hit(course):
    return SimpleNamespace(
        id=1, course_id=course.id, activity_id=None, activity_uuid="", activity_name="", chapter_name="",
        course_name=course.name, course_uuid=course.course_uuid, source_type="course", block_uuid=None,
        locator=None, chunk_text="Course: Test Course", distance=0.1,
    )


@pytest.fixture
def ai_calls():
    with patch("src.services.security.rate_limiting.enforce_ai_rate_limit") as rate, \
         patch.object(rag_router, "reserve_ai_credit", new_callable=AsyncMock) as reserve, \
         patch("src.security.features_utils.usage.refund_ai_credit") as refund, \
         patch.object(rag_router, "search_course_content", new_callable=AsyncMock) as search:
        yield SimpleNamespace(rate=rate, reserve=reserve, refund=refund, search=search)


class TestSearch:
    async def test_member_gets_ranked_sources(self, mock_request, db, org, course, regular_user, ai_calls):
        ai_calls.search.return_value = [_hit(course)]
        response = await rag_router.api_rag_search(
            mock_request, RAGSearchRequest(query="cells", course_uuid=course.course_uuid, limit=3), regular_user, db
        )
        assert response.sources[0]["title"] == "Test Course"
        assert response.sources[0]["course_uuid"] == course.course_uuid
        ai_calls.rate.assert_called_once()
        ai_calls.reserve.assert_awaited_once()
        assert ai_calls.reserve.await_args.kwargs["amount"] == 1
        assert ai_calls.search.await_args.kwargs["top_k"] == 3
        scope = ai_calls.search.await_args.args[3]
        assert scope.course_ids == [course.id]

    async def test_other_org_is_denied_before_any_charge(
        self, mock_request, db, org, other_org, course, ai_calls
    ):
        outsider = MagicMock(id=999)
        with patch.object(rag_router, "resolve_acting_user_id", return_value=999):
            with pytest.raises(HTTPException) as exc:
                await rag_router.api_rag_search(
                    mock_request, RAGSearchRequest(query="q", course_uuid=course.course_uuid), outsider, db
                )
        assert exc.value.status_code == 403
        ai_calls.reserve.assert_not_awaited()
        ai_calls.search.assert_not_awaited()

    async def test_unknown_course_is_404(self, mock_request, db, regular_user, ai_calls):
        with pytest.raises(HTTPException) as exc:
            await rag_router.api_rag_search(
                mock_request, RAGSearchRequest(query="q", course_uuid="course_missing"), regular_user, db
            )
        assert exc.value.status_code == 404

    async def test_nothing_readable_costs_nothing(self, mock_request, db, org, regular_user, ai_calls):
        # Org-wide search with no indexed course in scope.
        response = await rag_router.api_rag_search(
            mock_request, RAGSearchRequest(query="q", org_slug=org.slug), regular_user, db
        )
        assert response.sources == []
        ai_calls.reserve.assert_not_awaited()

    async def test_search_failure_refunds(self, mock_request, db, org, course, regular_user, ai_calls):
        ai_calls.search.side_effect = RuntimeError("embedding provider down")
        with pytest.raises(RuntimeError):
            await rag_router.api_rag_search(
                mock_request, RAGSearchRequest(query="q", course_uuid=course.course_uuid), regular_user, db
            )
        ai_calls.refund.assert_called_once_with(org.id, 1)

    async def test_copilot_toggle_applies(self, mock_request, db, org, course, regular_user, ai_calls):
        db.add(OrganizationConfig(
            org_id=org.id,
            config={"config_version": "2.0", "admin_toggles": {"ai": {"copilot_enabled": False}}},
            creation_date="", update_date="",
        ))
        await db.commit()
        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True}):
            with pytest.raises(HTTPException) as exc:
                await rag_router.api_rag_search(
                    mock_request, RAGSearchRequest(query="q", course_uuid=course.course_uuid), regular_user, db
                )
        assert exc.value.detail == "Copilot is disabled for this organization"

    def test_query_and_limit_are_bounded(self):
        with pytest.raises(ValueError):
            RAGSearchRequest(query="")
        with pytest.raises(ValueError):
            RAGSearchRequest(query="q", limit=500)


class TestStatus:
    async def test_admin_sees_chunks_and_transcripts(self, db, org, course, chapter, admin_user):
        await add_activity(
            db, org, course, chapter, 10,
            activity_type=ActivityTypeEnum.TYPE_VIDEO,
            sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
            content={"filename": "v.mp4"},
            extra_metadata={"transcript": {"source": "v.mp4", "status": "done"}},
            name="Lecture",
        )
        await add_activity(
            db, org, course, chapter, 11,
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        )
        db.add(Block(
            id=3, block_type=BlockTypeEnum.BLOCK_AUDIO,
            content={"transcript": {"source": "a.mp3", "status": "skipped_no_credits"}},
            org_id=org.id, course_id=course.id, activity_id=11, block_uuid="block_3",
            creation_date="", update_date="",
        ))
        for activity_id in (10, 10, None):
            db.add(CourseEmbedding(
                org_id=org.id, course_id=course.id, activity_id=activity_id, source_type="x",
                chunk_text="x", embedding=[0.0] * 768, update_date="2026-10-10 10:00:00",
            ))
        await db.commit()

        status = await rag_router.api_rag_status(course.course_uuid, admin_user, db)

        assert status.course_chunks == 1
        by_uuid = {a.activity_uuid: a for a in status.activities}
        assert by_uuid["activity_10"].chunks == 2
        assert by_uuid["activity_10"].indexed_at == "2026-10-10 10:00:00"
        assert by_uuid["activity_10"].transcripts == [{"source": "v.mp4", "status": "done"}]
        assert by_uuid["activity_11"].chunks == 0
        assert by_uuid["activity_11"].transcripts == [
            {"source": "a.mp3", "status": "skipped_no_credits", "block_uuid": "block_3"}
        ]

    async def test_members_cannot_read_status(self, db, org, course, regular_user):
        with pytest.raises(HTTPException) as exc:
            await rag_router.api_rag_status(course.course_uuid, regular_user, db)
        assert exc.value.status_code == 403

    async def test_unknown_course_is_404(self, db, admin_user):
        with pytest.raises(HTTPException) as exc:
            await rag_router.api_rag_status("course_missing", admin_user, db)
        assert exc.value.status_code == 404


class TestIndex:
    @pytest.fixture(autouse=True)
    def _allow(self):
        with patch("src.services.security.rate_limiting.check_rate_limit", return_value=(True, 1, 0)):
            yield

    async def test_indexes_now_and_retries_media_in_the_background(self, mock_request, db, org, course, admin_user):
        with patch.object(rag_router.pipeline, "run_course", new=AsyncMock(return_value=12)) as run, \
             patch.object(rag_router, "reset_unfinished_transcripts", new=AsyncMock(return_value=1)) as reset, \
             patch.object(rag_router.rag_queue, "enqueue_course", new=AsyncMock(return_value=3)) as enqueue:
            response = await rag_router.api_rag_index(
                mock_request, RAGIndexRequest(course_uuid=course.course_uuid), admin_user, db
            )
        assert (response.status, response.chunks_indexed) == ("success", 12)
        run.assert_awaited_once_with(course.id, transcribe=False)
        reset.assert_awaited_once_with(course.id, db)
        enqueue.assert_awaited_once_with(course.id, db, delay=0, transcribe=True)

    async def test_members_cannot_reindex(self, mock_request, db, org, course, regular_user):
        with patch.object(rag_router.pipeline, "run_course", new=AsyncMock()) as run:
            with pytest.raises(HTTPException) as exc:
                await rag_router.api_rag_index(
                    mock_request, RAGIndexRequest(course_uuid=course.course_uuid), regular_user, db
                )
        assert exc.value.status_code == 403
        run.assert_not_awaited()
