"""Availability / cost-abuse hardening: debounced reindex, learner upload
limits, library search bounds, list clamps, AI input caps, caption dedupe,
per-recipient magic links, webhook caps and the link-preview throttle."""

import asyncio
import contextlib
from io import BytesIO
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.datastructures import Headers

from src.db.folders.folders import Folder
from src.db.webhooks import WebhookEndpoint, WebhookEndpointCreate


class _FakeRedis:
    """SET NX / GET / DELETE / RPUSH stand-in."""

    def __init__(self):
        self.store = {}
        self.lists = {}

    def set(self, key, value, nx=False, ex=None):
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True

    def get(self, key):
        return self.store.get(key)

    def delete(self, key):
        self.store.pop(key, None)

    def rpush(self, key, value):
        self.lists.setdefault(key, []).append(value)


def _deny(*_a, **_k):
    return False, 999, 42


# ---------------------------------------------------------------------------
# 1. RAG reindex debounce
# ---------------------------------------------------------------------------

class TestReindexDebounce:
    """Saves are debounced by the RAG queue (one run per burst) and orgs
    without AI search are never indexed; both covered in depth in
    test_rag_queue.py and test_rag_pipeline.py."""

    @pytest.fixture
    def rag_dispatch(self):
        """Use the real queue dispatch here, not the suite-wide stub."""
        yield None

    async def test_rapid_saves_schedule_one_reindex(self, monkeypatch, rag_dispatch):
        from src.services.ai.rag import queue

        due = {}
        client = MagicMock()
        client.zadd.side_effect = lambda key, mapping: due.update(mapping)
        monkeypatch.setattr(queue, "get_redis_client", lambda: client)
        for _ in range(10):
            queue.index_activity(7)
        assert list(due) == ["activity:7"]

    async def test_ai_disabled_skips_reindex(self, monkeypatch):
        from src.services.ai.rag import pipeline
        from src.services.ai.rag.types import ContentRef

        @contextlib.asynccontextmanager
        async def session():
            yield MagicMock()

        monkeypatch.setattr(pipeline, "_session", session)
        monkeypatch.setattr(pipeline, "_org_of", AsyncMock(return_value=1))
        monkeypatch.setattr(pipeline, "orgs_using_ai", AsyncMock(return_value=set()))
        extract = AsyncMock()
        monkeypatch.setattr(pipeline, "extract", extract)
        assert await pipeline.run(ContentRef.activity(7)) == 0
        extract.assert_not_awaited()


# ---------------------------------------------------------------------------
# 2. Learner submission uploads
# ---------------------------------------------------------------------------

def _upload(name, data=b"%PDF-1.4 test", size=None):
    return UploadFile(file=BytesIO(data), filename=name, size=size, headers=Headers({}))


class TestSubmissionUpload:
    @pytest.mark.parametrize("name", ["clip.mp4", "movie.webm", "pkg.sqlite", "a.mp3"])
    async def test_video_and_other_types_rejected(self, name):
        from src.services.courses.activities.uploads.sub_file import upload_submission_file

        with pytest.raises(HTTPException) as exc:
            await upload_submission_file(_upload(name), "a", "o", "c", "as", "t")
        assert exc.value.status_code == 415

    async def test_oversized_document_rejected(self):
        from src.services.courses.activities.uploads import sub_file

        big = _upload("essay.pdf", size=sub_file.SUBMISSION_MAX_SIZE + 1)
        with pytest.raises(HTTPException) as exc:
            await sub_file.upload_submission_file(big, "a", "o", "c", "as", "t")
        assert exc.value.status_code == 413

    async def test_small_pdf_accepted(self):
        from src.services.courses.activities.uploads import sub_file

        with patch("src.services.utils.upload_content.upload_content", new=AsyncMock()):
            name = await sub_file.upload_submission_file(
                _upload("essay.pdf"), "a", "o", "c", "as", "t"
            )
        assert name.endswith(".pdf")

    async def test_router_rate_limits_uploads(self, mock_request, admin_user):
        from src.routers.courses import assignments as router_mod

        service = AsyncMock()
        with patch.object(router_mod, "check_rate_limit", side_effect=_deny), \
             patch.object(router_mod, "put_assignment_task_submission_file", new=service):
            with pytest.raises(HTTPException) as exc:
                await router_mod.api_put_assignment_task_sub_file(
                    mock_request, "task", _upload("essay.pdf"), admin_user, None
                )
        assert exc.value.status_code == 429
        service.assert_not_awaited()


# ---------------------------------------------------------------------------
# 3/4. Library search + list clamps
# ---------------------------------------------------------------------------

@pytest.fixture
def folders_client(anonymous_user):
    from src.core.events.database import get_db_session
    from src.routers.folders import folders as folders_router
    from src.security.auth import get_current_user

    app = FastAPI()
    app.include_router(folders_router.router, prefix="/folders")
    app.dependency_overrides[get_current_user] = lambda: anonymous_user
    app.dependency_overrides[get_db_session] = lambda: None
    return TestClient(app), folders_router


class TestLibrarySearch:
    @pytest.mark.parametrize("q", ["a", "x" * 201])
    def test_query_length_validated(self, folders_client, q):
        client, mod = folders_client
        with patch.object(mod, "search_library", new=AsyncMock(return_value={})), \
             patch.object(mod, "check_rate_limit", return_value=(True, 1, 60)):
            resp = client.get("/folders/org/1/search", params={"q": q})
        assert resp.status_code == 422

    def test_anonymous_search_rate_limited_by_ip(self, folders_client):
        client, mod = folders_client
        search = AsyncMock(return_value={})
        with patch.object(mod, "search_library", new=search), \
             patch.object(mod, "check_rate_limit", side_effect=_deny) as rl:
            resp = client.get("/folders/org/1/search", params={"q": "intro"})
        assert resp.status_code == 429
        assert rl.call_args.kwargs["key"].startswith("library_search_anon:")
        search.assert_not_awaited()

    async def test_like_wildcards_are_literal(self, db, org, mock_request, anonymous_user):
        from src.services.folders import folders as svc

        for name in ("100% done", "100x done", "a_b", "axb"):
            db.add(Folder(name=name, org_id=org.id, folder_uuid=f"folder_{name}"))
        await db.commit()

        with patch.object(svc, "_may_see_private", new=AsyncMock(return_value=True)):
            pct = await svc.search_library(mock_request, str(org.id), "100%", anonymous_user, db)
            und = await svc.search_library(mock_request, str(org.id), "a_b", anonymous_user, db)
        assert [f["name"] for f in pct["folders"]] == ["100% done"]
        assert [f["name"] for f in und["folders"]] == ["a_b"]

    async def test_results_are_capped(self, db, org, mock_request, anonymous_user, monkeypatch):
        from src.services.folders import folders as svc

        monkeypatch.setattr(svc, "LIBRARY_SEARCH_MAX_RESULTS", 3)
        for i in range(6):
            db.add(Folder(name=f"topic {i}", org_id=org.id, folder_uuid=f"folder_t{i}"))
        await db.commit()
        with patch.object(svc, "_may_see_private", new=AsyncMock(return_value=True)):
            res = await svc.search_library(mock_request, str(org.id), "topic", anonymous_user, db)
        assert len(res["folders"]) == 3


def _spy_statements(db):
    seen = []
    real = db.execute

    async def _execute(stmt, *a, **k):
        seen.append(stmt)
        return await real(stmt, *a, **k)

    return seen, _execute


def _limit_offset(stmt):
    return stmt._limit_clause.value, (stmt._offset_clause.value if stmt._offset_clause is not None else 0)


class TestListClamps:
    @pytest.mark.parametrize("page,limit,expected", [
        (-3, 100000, (100, 0)),
        (0, 0, (1, 0)),
        (2, -5, (1, 1)),
    ])
    async def test_folder_list_clamped(self, db, org, mock_request, anonymous_user, page, limit, expected):
        from src.services.folders import folders as svc

        seen, spy = _spy_statements(db)
        with patch.object(db, "execute", side_effect=spy), \
             patch.object(svc, "_may_see_private", new=AsyncMock(return_value=False)), \
             patch.object(svc, "_get_folders_sort_mode", new=AsyncMock(return_value="name")):
            await svc.get_folders(mock_request, str(org.id), anonymous_user, db, None, page, limit)
        stmt = [s for s in seen if getattr(s, "_limit_clause", None) is not None][-1]
        assert _limit_offset(stmt) == expected

    @pytest.mark.parametrize("page,limit,expected", [
        (-1, 5000, (100, 0)),
        (0, 0, (1, 0)),
        (3, 10, (10, 20)),
    ])
    async def test_media_list_clamped(self, db, org, mock_request, anonymous_user, page, limit, expected):
        from src.services.media import media as svc

        seen, spy = _spy_statements(db)
        with patch.object(db, "execute", side_effect=spy):
            await svc.get_media_list(mock_request, str(org.id), anonymous_user, db, page, limit)
        stmt = [s for s in seen if getattr(s, "_limit_clause", None) is not None][-1]
        assert _limit_offset(stmt) == expected


# ---------------------------------------------------------------------------
# 5. AI input size
# ---------------------------------------------------------------------------

class TestAISchemaLimits:
    def test_rag_chat_message_capped(self):
        from src.routers.ai.rag import RAGChatRequest

        RAGChatRequest(message="x" * 8000)
        with pytest.raises(ValidationError):
            RAGChatRequest(message="x" * 8001)

    def test_activity_chat_message_capped(self):
        from src.services.ai.schemas.ai import SendActivityAIChatMessage, StartActivityAIChatSession

        with pytest.raises(ValidationError):
            StartActivityAIChatSession(activity_uuid="a", message="x" * 8001)
        with pytest.raises(ValidationError):
            SendActivityAIChatMessage(aichat_uuid="c", activity_uuid="a", message="x" * 8001)

    def test_context_fields_capped(self):
        from src.services.ai.schemas.magicblocks import MagicBlockContext

        with pytest.raises(ValidationError):
            MagicBlockContext(
                course_title="t", course_description="d" * 20001,
                activity_name="a", activity_content_summary="s",
            )

    @pytest.mark.parametrize("path,cls,kwargs", [
        ("quiz", "GenerateQuizRequest", {"org_id": 1}),
        ("scenario", "GenerateScenarioRequest", {"org_id": 1}),
        ("image", "GenerateImageRequest", {"org_id": 1}),
        ("assignment", "GenerateAssignmentRequest", {"org_id": 1, "course_uuid": "c"}),
    ])
    def test_generation_prompts_capped(self, path, cls, kwargs):
        import importlib

        model = getattr(importlib.import_module(f"src.services.ai.schemas.{path}"), cls)
        model(prompt="ok", **kwargs)
        with pytest.raises(ValidationError):
            model(prompt="x" * 8001, **kwargs)

    def test_courseplanning_attachment_total_capped(self):
        from src.services.ai.schemas.courseplanning import (
            MAX_ATTACHMENT_TOTAL_BYTES,
            SendCoursePlanningMessage,
        )

        b64_len = (MAX_ATTACHMENT_TOTAL_BYTES // 2) * 4 // 3 + 8
        att = {"type": "file", "name": "a.pdf", "content_base64": "A" * b64_len, "mime_type": "application/pdf"}
        SendCoursePlanningMessage(session_uuid="s", message="m", attachments=[att])
        with pytest.raises(ValidationError):
            SendCoursePlanningMessage(session_uuid="s", message="m", attachments=[att, att, att])

    def test_courseplanning_attachment_count_capped(self):
        from src.services.ai.schemas.courseplanning import MAX_ATTACHMENTS, StartCoursePlanningSession

        att = {"type": "youtube", "name": "v", "url": "https://youtu.be/x"}
        with pytest.raises(ValidationError):
            StartCoursePlanningSession(org_id=1, prompt="p", attachments=[att] * (MAX_ATTACHMENTS + 1))


# ---------------------------------------------------------------------------
# 6. Caption job dedupe
# ---------------------------------------------------------------------------

class TestCaptionDedupe:
    def test_repeat_enqueue_is_deduped_until_finished(self, monkeypatch):
        import src.services.utils.caption_jobs as cj

        r = _FakeRedis()
        monkeypatch.setattr(cj, "get_redis_client", lambda: r)
        for _ in range(5):
            cj.enqueue("act1")
        assert r.lists[cj.REDIS_QUEUE_KEY] == ["act1"]

        cj._clear_queued_marker(r, "act1")
        cj.enqueue("act1")
        assert r.lists[cj.REDIS_QUEUE_KEY] == ["act1", "act1"]

    async def test_configure_captions_is_ai_rate_limited(self, monkeypatch):
        from src.services.courses.activities import video as video_mod
        import src.security.features_utils.usage as usage
        import src.services.security.rate_limiting as rl

        activity = MagicMock(
            activity_sub_type=video_mod.ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
            course_id=1, org_id=9,
        )
        result = MagicMock()
        result.scalars.return_value.first.return_value = activity
        db = MagicMock()
        db.execute = AsyncMock(return_value=result)
        monkeypatch.setattr(video_mod, "check_resource_access", AsyncMock())
        monkeypatch.setattr(usage, "check_feature_enabled", AsyncMock(return_value=True))

        def _limited(user_id, org_id):
            raise HTTPException(status_code=429, detail="slow down")

        monkeypatch.setattr(rl, "enforce_ai_rate_limit", _limited)
        user = MagicMock(id=5)
        cfg = video_mod.CaptionsConfigIn(
            enabled=True, languages=[video_mod.CaptionLanguageIn(code="en", label="English")]
        )
        with pytest.raises(HTTPException) as exc:
            await video_mod.configure_captions(None, "act", user, db, cfg)
        assert exc.value.status_code == 429


# ---------------------------------------------------------------------------
# 7. Magic link per-recipient limit
# ---------------------------------------------------------------------------

class TestMagicLinkPerEmail:
    async def test_per_email_cap_returns_generic_without_sending(self, mock_request):
        from src.routers import auth as auth_mod

        body = auth_mod.MagicLinkLoginRequest(email="victim@example.com")
        resolve = AsyncMock()
        with patch.object(auth_mod, "check_login_rate_limit", return_value=(True, 0)), \
             patch.object(auth_mod, "check_rate_limit", side_effect=_deny) as rl, \
             patch("src.services.auth.magic_login.resolve_org", new=resolve), \
             patch("src.services.auth.magic_login.send_magic_login_email") as send:
            out = await auth_mod.magic_link_request(mock_request, body, MagicMock())

        assert out == {"detail": "If an account exists for that email, a login link has been sent."}
        assert rl.call_args.kwargs["key"] == "magic_link:victim@example.com"
        resolve.assert_not_awaited()
        send.assert_not_called()


# ---------------------------------------------------------------------------
# 8. Webhooks
# ---------------------------------------------------------------------------

class TestWebhookLimits:
    async def test_endpoint_cap_per_org(self, db, org, admin_user, mock_request, monkeypatch):
        from src.services.webhooks import webhooks

        monkeypatch.setattr(webhooks, "MAX_WEBHOOK_ENDPOINTS_PER_ORG", 2)
        for i in range(2):
            db.add(WebhookEndpoint(
                webhook_uuid=f"webhook_{i}", org_id=org.id, url="https://example.com/h",
                secret_encrypted="x", events=["course_created"], is_active=True,
                created_by_user_id=admin_user.id, creation_date="", update_date="",
            ))
        await db.commit()

        obj = WebhookEndpointCreate(url="https://example.com/new", events=["course_created"])
        with patch.object(webhooks, "authorization_verify_if_user_is_anon", new=AsyncMock()), \
             patch.object(webhooks, "require_org_admin", new=AsyncMock()), \
             patch("src.services.demo.guards.require_not_demo_org", new=AsyncMock()), \
             patch.object(webhooks, "_validate_webhook_url"):
            with pytest.raises(HTTPException) as exc:
                await webhooks.create_webhook_endpoint(mock_request, db, org.id, obj, admin_user)
        assert exc.value.status_code == 400
        assert "at most 2" in exc.value.detail

    async def test_dispatch_skips_orgs_without_endpoints(self, monkeypatch):
        from src.services.webhooks import dispatch

        monkeypatch.setattr(dispatch, "_active_cache_get", lambda org_id: False)
        monkeypatch.setattr(dispatch, "validate_event_data", lambda *a: None)
        deliver = AsyncMock()
        monkeypatch.setattr(dispatch, "_deliver_webhooks", deliver)
        await dispatch.dispatch_webhooks("course_created", 1, {})
        await asyncio.sleep(0)
        deliver.assert_not_called()

        # Explicit test pings still go out
        await dispatch.dispatch_webhooks("ping", 1, {}, webhook_ids=[3])
        await asyncio.gather(*list(dispatch._background_tasks))
        deliver.assert_awaited_once()

    def test_delivery_concurrency_bounded(self):
        from src.services.webhooks import dispatch

        assert dispatch._delivery_semaphore._value == dispatch.MAX_CONCURRENT_DELIVERIES


# ---------------------------------------------------------------------------
# 9/10. AI route limits + link preview
# ---------------------------------------------------------------------------

class TestRouteThrottles:
    async def test_rag_index_rate_limited_per_org(self, db, org, course, mock_request, admin_user):
        from src.routers.ai import rag

        embed = AsyncMock(return_value=1)
        with patch.object(rag, "require_org_admin", new=AsyncMock()), \
             patch("src.services.security.rate_limiting.check_rate_limit", side_effect=_deny) as rl, \
             patch.object(rag.pipeline, "run_course", new=embed):
            with pytest.raises(HTTPException) as exc:
                await rag.api_rag_index(
                    mock_request, rag.RAGIndexRequest(course_uuid=course.course_uuid), admin_user, db
                )
        assert exc.value.status_code == 429
        assert rl.call_args.kwargs["key"] == f"rag_index:{org.id}"
        embed.assert_not_awaited()

    async def test_link_preview_rate_limited_per_user(self, admin_user):
        from src.routers import utils as utils_mod

        fetch = AsyncMock()
        with patch.object(utils_mod, "check_rate_limit", side_effect=_deny) as rl, \
             patch.object(utils_mod, "fetch_link_preview", new=fetch):
            with pytest.raises(HTTPException) as exc:
                await utils_mod.link_preview("https://example.com", admin_user)
        assert exc.value.status_code == 429
        assert rl.call_args.kwargs["key"] == f"link_preview:{admin_user.id}"
        fetch.assert_not_awaited()
