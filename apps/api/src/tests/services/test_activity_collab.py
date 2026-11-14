"""Tests for collaborative editing of activity pages: the access check, the
collab server's state endpoints (version guard, coalesced history, named
versions), the reset notification and every content writer calling it."""

import asyncio
import base64
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.activity_collab import ActivityCollabState
from src.db.courses.activity_versions import ActivityVersion
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.users import PublicUser, User
from src.routers.courses.activities import collab as collab_router
from src.security.auth import get_current_user
from src.services.courses.activities import collab, collab_notify
from src.services.courses.activities.collab import (
    CollabCheckpoint,
    CollabStateWrite,
    get_collab_access,
    get_collab_state,
    put_collab_state,
)

KEY = "k" * 40
YDOC = base64.b64encode(b"\x01\x02\x03").decode()
DOC_A = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "A"}]}]}
DOC_B = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "B"}]}]}


@pytest.fixture
def collab_key(monkeypatch):
    monkeypatch.setenv("COLLAB_INTERNAL_KEY", KEY)
    return KEY


@pytest.fixture
def no_webhooks():
    with patch("src.services.courses.activities.collab.dispatch_webhooks", new_callable=AsyncMock) as mock:
        yield mock


async def _versions(db, activity_id):
    return (await db.execute(
        select(ActivityVersion).where(ActivityVersion.activity_id == activity_id).order_by(ActivityVersion.version_number)
    )).scalars().all()


async def _fresh(db, activity_id):
    db.expire_all()
    return await db.get(Activity, activity_id)


async def _make_video_activity(db, org, course):
    a = Activity(
        id=50,
        name="Video",
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
        content={},
        org_id=org.id,
        course_id=course.id,
        activity_uuid="activity_video",
        creation_date="",
        update_date="",
    )
    db.add(a)
    await db.commit()
    return a


async def _make_user(db, uid, uuid="user_extra", avatar=""):
    u = User(
        id=uid,
        username=f"user{uid}",
        first_name="",
        last_name="",
        email=f"user{uid}@test.com",
        password="x",
        user_uuid=uuid,
        avatar_image=avatar,
        creation_date="",
        update_date="",
    )
    db.add(u)
    await db.commit()
    return u


# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------


class TestCollabAccess:
    async def test_refused_when_collab_is_not_configured(self, monkeypatch, mock_request, db, activity, admin_user):
        monkeypatch.delenv("COLLAB_INTERNAL_KEY", raising=False)
        with pytest.raises(HTTPException) as exc:
            await get_collab_access(mock_request, activity.activity_uuid, admin_user, db)
        assert exc.value.status_code == 503

    async def test_anonymous_is_refused(self, collab_key, mock_request, db, activity, anonymous_user):
        with pytest.raises(HTTPException) as exc:
            await get_collab_access(mock_request, activity.activity_uuid, anonymous_user, db)
        assert exc.value.status_code == 401

    async def test_unknown_and_non_page_activities_are_404(self, collab_key, mock_request, db, org, course, admin_user):
        with pytest.raises(HTTPException) as exc:
            await get_collab_access(mock_request, "activity_missing", admin_user, db)
        assert exc.value.status_code == 404
        video = await _make_video_activity(db, org, course)
        with pytest.raises(HTTPException) as exc:
            await get_collab_access(mock_request, video.activity_uuid, admin_user, db)
        assert exc.value.status_code == 404

    async def test_admin_is_an_editor_with_a_stable_identity(self, collab_key, mock_request, db, activity, admin_user):
        result = await get_collab_access(mock_request, activity.activity_uuid, admin_user, db)
        assert result.role == "editor"
        assert result.user.id == admin_user.id
        assert result.user.display_name == "Admin User"
        assert result.user.username == "admin"
        assert result.user.color == collab.presence_color("user_admin")
        assert result.user.color in collab.PRESENCE_COLORS
        assert result.user.avatar_url is None
        again = await get_collab_access(mock_request, activity.activity_uuid, admin_user, db)
        assert again.user.color == result.user.color

    async def test_absolute_avatar_is_passed_as_url(self, collab_key, mock_request, db, activity, admin_user):
        user = await db.get(User, admin_user.id)
        user.avatar_image = "https://cdn.example/a.png"
        db.add(user)
        await db.commit()
        result = await get_collab_access(mock_request, activity.activity_uuid, admin_user, db)
        assert result.user.avatar_url == "https://cdn.example/a.png"
        assert result.user.avatar_image == "https://cdn.example/a.png"

    async def test_learner_is_refused(self, collab_key, mock_request, db, activity, regular_user):
        with pytest.raises(HTTPException) as exc:
            await get_collab_access(mock_request, activity.activity_uuid, regular_user, db)
        assert exc.value.status_code == 403

    async def test_active_course_author_without_edit_rights_is_a_viewer(
        self, collab_key, mock_request, db, course, activity, regular_user
    ):
        db.add(ResourceAuthor(
            resource_uuid=course.course_uuid,
            user_id=regular_user.id,
            authorship=ResourceAuthorshipEnum.REPORTER,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
            creation_date="",
            update_date="",
        ))
        await db.commit()
        with patch(
            "src.services.courses.activities.collab.check_resource_access",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=403, detail="no"),
        ):
            result = await get_collab_access(mock_request, activity.activity_uuid, regular_user, db)
        assert result.role == "viewer"
        assert result.user.display_name == "Regular User"

    async def test_pending_author_or_other_errors_are_refused(
        self, collab_key, mock_request, db, course, activity, regular_user
    ):
        db.add(ResourceAuthor(
            resource_uuid=course.course_uuid,
            user_id=regular_user.id,
            authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
            authorship_status=ResourceAuthorshipStatusEnum.PENDING,
            creation_date="",
            update_date="",
        ))
        await db.commit()
        with patch(
            "src.services.courses.activities.collab.check_resource_access",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=403, detail="no"),
        ):
            with pytest.raises(HTTPException) as exc:
                await get_collab_access(mock_request, activity.activity_uuid, regular_user, db)
        assert exc.value.status_code == 403
        # Errors other than a denial are never turned into viewer access
        with patch(
            "src.services.courses.activities.collab.check_resource_access",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=500, detail="boom"),
        ):
            with pytest.raises(HTTPException) as exc:
                await get_collab_access(mock_request, activity.activity_uuid, regular_user, db)
        assert exc.value.status_code == 403

    async def test_author_of_another_org_is_refused(self, collab_key, mock_request, db, other_org, course, activity):
        outsider = await _make_user(db, 30, "user_outsider")
        db.add(ResourceAuthor(
            resource_uuid=course.course_uuid,
            user_id=outsider.id,
            authorship=ResourceAuthorshipEnum.REPORTER,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
            creation_date="",
            update_date="",
        ))
        await db.commit()
        public = PublicUser(id=30, username="user30", first_name="", last_name="", email="user30@test.com", user_uuid="user_outsider")
        with pytest.raises(HTTPException) as exc:
            await get_collab_access(mock_request, activity.activity_uuid, public, db)
        assert exc.value.status_code == 403

    async def test_user_without_a_row_is_refused(self, collab_key, mock_request, db, activity):
        ghost = PublicUser(id=999, username="ghost", first_name="", last_name="", email="g@test.com", user_uuid="user_ghost")
        with patch("src.services.courses.activities.collab.check_resource_access", new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await get_collab_access(mock_request, activity.activity_uuid, ghost, db)
        assert exc.value.status_code == 401

    def test_display_name_falls_back_to_username(self):
        assert collab.display_name(User(username="solo", first_name="", last_name="", email="", password="", user_uuid="u")) == "solo"


# ---------------------------------------------------------------------------
# State (internal)
# ---------------------------------------------------------------------------


class TestCollabStateRead:
    async def test_without_stored_ydoc(self, db, activity):
        state = await get_collab_state(activity.activity_uuid, db)
        assert state.content == activity.content
        assert state.current_version == 1
        assert state.ydoc_b64 is None and state.ydoc_version is None
        assert state.last_modified_by is None

    async def test_with_stored_ydoc_and_editor(self, db, activity, admin_user):
        activity.last_modified_by_id = admin_user.id
        db.add(activity)
        db.add(ActivityCollabState(activity_id=activity.id, org_id=activity.org_id, ydoc_state=b"\x01\x02\x03", ydoc_version=1))
        await db.commit()
        state = await get_collab_state(activity.activity_uuid, db)
        assert state.ydoc_b64 == YDOC
        assert state.ydoc_version == 1
        assert state.last_modified_by.model_dump() == {"id": admin_user.id, "name": "Admin User"}

    async def test_unknown_and_non_page_activities_are_404(self, db, org, course):
        with pytest.raises(HTTPException) as exc:
            await get_collab_state("activity_missing", db)
        assert exc.value.status_code == 404
        video = await _make_video_activity(db, org, course)
        with pytest.raises(HTTPException) as exc:
            await get_collab_state(video.activity_uuid, db)
        assert exc.value.status_code == 404


class TestCollabStateWrite:
    async def test_unknown_and_non_page_activities_are_404(self, db, org, course):
        with pytest.raises(HTTPException) as exc:
            await put_collab_state("activity_missing", CollabStateWrite(base_version=1, ydoc_b64=YDOC), db)
        assert exc.value.status_code == 404
        video = await _make_video_activity(db, org, course)
        with pytest.raises(HTTPException) as exc:
            await put_collab_state(video.activity_uuid, CollabStateWrite(base_version=1, ydoc_b64=YDOC), db)
        assert exc.value.status_code == 404

    async def test_refuses_a_stale_base_version(self, db, activity):
        with pytest.raises(HTTPException) as exc:
            await put_collab_state(activity.activity_uuid, CollabStateWrite(base_version=0, ydoc_b64=YDOC, content=DOC_A), db)
        assert exc.value.status_code == 409
        assert (await _fresh(db, activity.id)).content == {"type": "doc", "content": []}

    async def test_validates_the_body(self, db, activity, monkeypatch):
        with pytest.raises(HTTPException) as exc:
            await put_collab_state(activity.activity_uuid, CollabStateWrite(base_version=1, ydoc_b64="not base64!"), db)
        assert exc.value.status_code == 422
        monkeypatch.setattr(collab, "MAX_YDOC_BYTES", 2)
        with pytest.raises(HTTPException) as exc:
            await put_collab_state(activity.activity_uuid, CollabStateWrite(base_version=1, ydoc_b64=YDOC), db)
        assert exc.value.status_code == 413
        monkeypatch.setattr(collab, "MAX_YDOC_BYTES", 1024)
        with pytest.raises(HTTPException) as exc:
            await put_collab_state(
                activity.activity_uuid, CollabStateWrite(base_version=1, ydoc_b64=YDOC, content={"type": "paragraph"}), db
            )
        assert exc.value.status_code == 422

    async def test_ydoc_only_save_keeps_the_version(self, db, activity, rag_dispatch):
        result = await put_collab_state(activity.activity_uuid, CollabStateWrite(base_version=1, ydoc_b64=YDOC), db)
        assert result.current_version == 1 and result.version_number is None
        state = await db.get(ActivityCollabState, activity.id)
        assert state.ydoc_state == b"\x01\x02\x03" and state.ydoc_version == 1
        assert await _versions(db, activity.id) == []
        # Saved again: the row is updated, not duplicated
        await put_collab_state(activity.activity_uuid, CollabStateWrite(base_version=1, ydoc_b64=YDOC), db)
        rows = (await db.execute(select(ActivityCollabState))).scalars().all()
        assert len(rows) == 1

    async def test_content_save_bumps_the_version_and_snapshots_once(self, db, activity, admin_user, no_webhooks):
        activity.content = DOC_A
        db.add(activity)
        await db.commit()

        r1 = await put_collab_state(
            activity.activity_uuid,
            CollabStateWrite(base_version=1, ydoc_b64=YDOC, content=DOC_B, contributor_user_ids=[admin_user.id, 0, -3, 4242]),
            db,
        )
        assert r1.current_version == 2
        fresh = await _fresh(db, activity.id)
        assert fresh.content == DOC_B
        assert fresh.last_modified_by_id == admin_user.id
        versions = await _versions(db, activity.id)
        assert [(v.version_number, v.content, v.created_by_id) for v in versions] == [(1, DOC_A, admin_user.id)]
        state = await db.get(ActivityCollabState, activity.id)
        assert state.ydoc_version == 2
        assert state.last_snapshot_contributors == [admin_user.id]
        no_webhooks.assert_awaited_once()

        # Within the interval, same people: no new history entry
        r2 = await put_collab_state(
            activity.activity_uuid,
            CollabStateWrite(base_version=2, ydoc_b64=YDOC, content=DOC_A, contributor_user_ids=[admin_user.id]),
            db,
        )
        assert r2.current_version == 3
        assert len(await _versions(db, activity.id)) == 1

    async def test_someone_new_editing_starts_a_new_entry(self, db, activity, admin_user, regular_user, no_webhooks):
        activity.content = DOC_A
        db.add(activity)
        await db.commit()
        await put_collab_state(
            activity.activity_uuid,
            CollabStateWrite(base_version=1, ydoc_b64=YDOC, content=DOC_B, contributor_user_ids=[admin_user.id]),
            db,
        )
        await put_collab_state(
            activity.activity_uuid,
            CollabStateWrite(base_version=2, ydoc_b64=YDOC, content=DOC_A, contributor_user_ids=[regular_user.id]),
            db,
        )
        assert [v.version_number for v in await _versions(db, activity.id)] == [1, 2]
        # The two keep alternating: no entry per save
        await put_collab_state(
            activity.activity_uuid,
            CollabStateWrite(base_version=3, ydoc_b64=YDOC, content=DOC_B, contributor_user_ids=[admin_user.id]),
            db,
        )
        await put_collab_state(
            activity.activity_uuid,
            CollabStateWrite(base_version=4, ydoc_b64=YDOC, content=DOC_A, contributor_user_ids=[regular_user.id]),
            db,
        )
        assert len(await _versions(db, activity.id)) == 2
        state = await db.get(ActivityCollabState, activity.id)
        assert sorted(state.last_snapshot_contributors) == sorted([admin_user.id, regular_user.id])

    async def test_a_new_entry_after_the_interval(self, db, activity, admin_user, no_webhooks):
        activity.content = DOC_A
        db.add(activity)
        db.add(ActivityCollabState(
            activity_id=activity.id,
            org_id=activity.org_id,
            ydoc_version=1,
            last_snapshot_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=6),
            last_snapshot_contributors=[admin_user.id],
        ))
        await db.commit()
        await put_collab_state(
            activity.activity_uuid,
            CollabStateWrite(base_version=1, ydoc_b64=YDOC, content=DOC_B, contributor_user_ids=[admin_user.id]),
            db,
        )
        assert len(await _versions(db, activity.id)) == 1

    async def test_no_entry_for_empty_content_or_an_existing_version(self, db, activity, admin_user, no_webhooks):
        # The fixture activity starts with an empty doc ({} after clearing)
        activity.content = {}
        db.add(activity)
        await db.commit()
        await put_collab_state(activity.activity_uuid, CollabStateWrite(base_version=1, ydoc_b64=YDOC, content=DOC_A), db)
        assert await _versions(db, activity.id) == []
        # Version 2 already has an entry (a checkpoint, say): not duplicated
        db.add(ActivityVersion(activity_id=activity.id, org_id=activity.org_id, version_number=2, content=DOC_A))
        state = await db.get(ActivityCollabState, activity.id)
        state.last_snapshot_at = None
        db.add(state)
        await db.commit()
        await put_collab_state(activity.activity_uuid, CollabStateWrite(base_version=2, ydoc_b64=YDOC, content=DOC_B), db)
        assert [v.version_number for v in await _versions(db, activity.id)] == [2]

    async def test_without_contributors_the_last_editor_is_kept(self, db, activity, admin_user, no_webhooks):
        activity.last_modified_by_id = admin_user.id
        db.add(activity)
        await db.commit()
        await put_collab_state(activity.activity_uuid, CollabStateWrite(base_version=1, ydoc_b64=YDOC, content=DOC_A), db)
        assert (await _fresh(db, activity.id)).last_modified_by_id == admin_user.id

    async def test_checkpoint_saves_a_named_version_of_the_new_content(self, db, activity, admin_user, no_webhooks):
        activity.content = DOC_A
        db.add(activity)
        await db.commit()
        result = await put_collab_state(
            activity.activity_uuid,
            CollabStateWrite(
                base_version=1,
                ydoc_b64=YDOC,
                content=DOC_B,
                checkpoint=CollabCheckpoint(label="  Before review  ", user_id=admin_user.id),
            ),
            db,
        )
        assert result.version_number == 2
        versions = await _versions(db, activity.id)
        named = [v for v in versions if v.label]
        assert [(v.version_number, v.content, v.label, v.created_by_id) for v in named] == [
            (2, DOC_B, "Before review", admin_user.id)
        ]
        assert no_webhooks.await_count == len(versions)

    async def test_checkpoint_without_label_or_known_user(self, db, activity, no_webhooks):
        result = await put_collab_state(
            activity.activity_uuid,
            CollabStateWrite(base_version=1, ydoc_b64=YDOC, content=DOC_A, checkpoint=CollabCheckpoint(label=" ", user_id=4242)),
            db,
        )
        version = (await _versions(db, activity.id))[-1]
        assert result.version_number == 2
        assert version.label is None and version.created_by_id is None


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(collab_router.router, prefix="/api/v1/activities")
    app.include_router(collab_router.internal_router, prefix="/api/v1/activities")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


class TestCollabRouter:
    async def test_access_endpoint(self, collab_key, client, activity):
        res = await client.get(f"/api/v1/activities/{activity.activity_uuid}/collab/access")
        assert res.status_code == 200
        assert res.json()["role"] == "editor"

    async def test_internal_endpoints_need_the_key(self, collab_key, client, activity, monkeypatch):
        url = f"/api/v1/activities/{activity.activity_uuid}/collab/state"
        assert (await client.get(url, headers={"X-Internal-Key": "wrong"})).status_code == 403
        assert (await client.get(url)).status_code == 422
        monkeypatch.delenv("COLLAB_INTERNAL_KEY")
        assert (await client.get(url, headers={"X-Internal-Key": ""})).status_code == 403

    async def test_internal_read_and_write(self, collab_key, client, activity, no_webhooks):
        url = f"/api/v1/activities/{activity.activity_uuid}/collab/state"
        res = await client.get(url, headers={"X-Internal-Key": KEY})
        assert res.status_code == 200 and res.json()["current_version"] == 1
        res = await client.put(url, headers={"X-Internal-Key": KEY}, json={"base_version": 1, "ydoc_b64": YDOC, "content": DOC_A})
        assert res.json() == {"current_version": 2, "version_number": None}
        res = await client.put(url, headers={"X-Internal-Key": KEY}, json={"base_version": 1, "ydoc_b64": YDOC, "content": DOC_B})
        assert res.status_code == 409


# ---------------------------------------------------------------------------
# Reset notification
# ---------------------------------------------------------------------------


class _FakeClient:
    """Stands in for httpx.AsyncClient, recording posts."""

    calls: list = []
    response = httpx.Response(200)
    error: Exception | None = None

    def __init__(self, timeout):
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json, headers):
        if _FakeClient.error:
            raise _FakeClient.error
        _FakeClient.calls.append((url, json, headers, self.timeout))
        return _FakeClient.response


@pytest.fixture
def fake_http(monkeypatch):
    _FakeClient.calls = []
    _FakeClient.response = httpx.Response(200)
    _FakeClient.error = None
    monkeypatch.setattr(collab_notify.httpx, "AsyncClient", _FakeClient)
    return _FakeClient


async def _drain_notifications():
    while collab_notify._pending:
        await asyncio.gather(*list(collab_notify._pending))


class TestCollabNotify:
    async def test_posts_the_new_content_to_the_collab_server(self, collab_key, fake_http, monkeypatch, db, activity, admin_user):
        monkeypatch.setenv("LEARNHOUSE_COLLAB_INTERNAL_URL", "http://collab:4000/")
        activity.content = DOC_A
        activity.current_version = 7
        collab_notify.notify_collab_content_changed(activity, admin_user)
        await _drain_notifications()
        assert fake_http.calls == [(
            f"http://collab:4000/internal/activity/{activity.activity_uuid}/reset",
            {"content": DOC_A, "current_version": 7, "by": {"id": admin_user.id, "name": "Admin User"}},
            {"X-Internal-Key": KEY},
            collab_notify.NOTIFY_TIMEOUT_SECONDS,
        )]

    async def test_noop_without_key_for_other_types_and_outside_a_loop(self, monkeypatch, fake_http, db, org, course, activity):
        monkeypatch.delenv("COLLAB_INTERNAL_KEY", raising=False)
        collab_notify.notify_collab_content_changed(activity)
        monkeypatch.setenv("COLLAB_INTERNAL_KEY", KEY)
        video = await _make_video_activity(db, org, course)
        collab_notify.notify_collab_content_changed(video)
        await _drain_notifications()
        assert fake_http.calls == []
        # Called from synchronous code with no running loop: skipped quietly
        with patch.object(collab_notify.asyncio, "get_running_loop", side_effect=RuntimeError):
            collab_notify.notify_collab_content_changed(activity)
        assert collab_notify._pending == set()

    async def test_failures_never_raise(self, collab_key, fake_http, activity):
        fake_http.response = httpx.Response(500)
        collab_notify.notify_collab_content_changed(activity)
        await _drain_notifications()
        fake_http.error = httpx.ConnectError("refused")
        collab_notify.notify_collab_content_changed(activity)
        await _drain_notifications()
        assert len(fake_http.calls) == 1

    def test_editor_names(self):
        assert collab_notify._editor(None) is None
        assert collab_notify._editor(5) is None
        assert collab_notify._editor(MagicMock(id=0)) is None
        assert collab_notify._editor(MagicMock(id="x")) is None
        assert collab_notify._editor(MagicMock(id=3, first_name="", last_name="", username="ann")) == {"id": 3, "name": "ann"}
        assert collab_notify._editor(MagicMock(id=3, first_name=None, last_name=None, username="")) == {"id": 3, "name": "Someone"}


# ---------------------------------------------------------------------------
# Every content writer notifies
# ---------------------------------------------------------------------------


class TestContentWritersNotify:
    async def test_legacy_save_notifies_only_for_content(self, mock_request, db, activity, admin_user):
        from src.db.courses.activities import ActivityUpdate
        from src.services.courses.activities.activities import update_activity

        with patch(
            "src.services.courses.activities.activities.check_resource_access", new_callable=AsyncMock
        ), patch(
            "src.services.courses.activities.activities.create_activity_version", new_callable=AsyncMock
        ), patch(
            "src.services.courses.activities.activities.notify_collab_content_changed"
        ) as notify:
            await update_activity(mock_request, ActivityUpdate(name="Renamed"), activity.activity_uuid, admin_user, db)
            notify.assert_not_called()
            await update_activity(mock_request, ActivityUpdate(content=DOC_A), activity.activity_uuid, admin_user, db)
        notify.assert_called_once()
        written, by = notify.call_args.args
        assert written.content == DOC_A and by is admin_user

    async def test_version_restore_notifies(self, mock_request, db, activity, admin_user):
        from src.services.courses.activities.versioning import restore_activity_version

        db.add(ActivityVersion(activity_id=activity.id, org_id=activity.org_id, version_number=1, content=DOC_B))
        await db.commit()
        with patch(
            "src.services.courses.activities.versioning.check_feature_access", new_callable=AsyncMock
        ), patch(
            "src.services.courses.activities.versioning.check_resource_access", new_callable=AsyncMock
        ), patch(
            "src.services.courses.activities.versioning.dispatch_webhooks", new_callable=AsyncMock
        ), patch(
            "src.services.courses.activities.versioning.notify_collab_content_changed"
        ) as notify:
            await restore_activity_version(mock_request, activity.activity_uuid, 1, admin_user, db)
        notify.assert_called_once()
        assert notify.call_args.args[0].content == DOC_B

    async def test_course_planning_save_bumps_the_version_and_notifies(
        self, mock_request, db, org, admin_role, admin_user, course, activity
    ):
        from src.routers.ai import courseplanning as cp
        from src.services.ai.schemas.courseplanning import SaveActivityContentRequest

        with patch("src.routers.ai.courseplanning.notify_collab_content_changed") as notify:
            await cp.save_activity_content(
                mock_request, SaveActivityContentRequest(activity_uuid=activity.activity_uuid, content=DOC_A), admin_user, db
            )
        notify.assert_called_once()
        assert notify.call_args.args[0].current_version == 2
        assert (await _fresh(db, activity.id)).current_version == 2


# ---------------------------------------------------------------------------
# Naming the current version (editor outside collaborative mode)
# ---------------------------------------------------------------------------


class TestNameCurrentVersion:
    @pytest.fixture(autouse=True)
    def _versioning(self):
        with patch("src.services.courses.activities.collab.check_feature_access", new_callable=AsyncMock):
            yield

    async def test_creates_a_named_entry_for_the_current_version(self, mock_request, db, activity, admin_user, no_webhooks):
        from src.services.courses.activities.collab import NamedVersionWrite, name_current_version

        activity.content = DOC_A
        activity.current_version = 4
        db.add(activity)
        await db.commit()
        result = await name_current_version(mock_request, activity.activity_uuid, NamedVersionWrite(label="  Draft  "), admin_user, db)
        assert result.model_dump() == {"version_number": 4, "label": "Draft"}
        versions = await _versions(db, activity.id)
        assert [(v.version_number, v.label, v.content, v.created_by_id) for v in versions] == [(4, "Draft", DOC_A, admin_user.id)]
        no_webhooks.assert_awaited_once()

    async def test_names_an_existing_entry_without_duplicating(self, mock_request, db, activity, admin_user, no_webhooks):
        from src.services.courses.activities.collab import NamedVersionWrite, name_current_version

        db.add(ActivityVersion(activity_id=activity.id, org_id=activity.org_id, version_number=1, content=DOC_B))
        await db.commit()
        await name_current_version(mock_request, activity.activity_uuid, NamedVersionWrite(label="Final"), admin_user, db)
        versions = await _versions(db, activity.id)
        assert [(v.version_number, v.label, v.content) for v in versions] == [(1, "Final", DOC_B)]
        no_webhooks.assert_not_awaited()

    async def test_refuses_blank_labels_learners_and_unknown_activities(self, mock_request, db, activity, regular_user, admin_user):
        from src.services.courses.activities.collab import NamedVersionWrite, name_current_version

        with pytest.raises(HTTPException) as exc:
            await name_current_version(mock_request, activity.activity_uuid, NamedVersionWrite(label="   "), admin_user, db)
        assert exc.value.status_code == 422
        with pytest.raises(HTTPException) as exc:
            await name_current_version(mock_request, activity.activity_uuid, NamedVersionWrite(label="x"), regular_user, db)
        assert exc.value.status_code == 403
        with pytest.raises(HTTPException) as exc:
            await name_current_version(mock_request, "activity_missing", NamedVersionWrite(label="x"), admin_user, db)
        assert exc.value.status_code == 404

    async def test_router(self, client, activity, no_webhooks):
        res = await client.post(f"/api/v1/activities/{activity.activity_uuid}/versions/named", json={"label": "Named"})
        assert res.status_code == 200 and res.json()["label"] == "Named"
        assert (await client.post(f"/api/v1/activities/{activity.activity_uuid}/versions/named", json={"label": ""})).status_code == 422


# ---------------------------------------------------------------------------
# Autosave history coalescing (editor outside collaborative mode)
# ---------------------------------------------------------------------------


class TestAutosaveCoalescing:
    async def test_recent_unnamed_entry_of_the_same_user(self, db, activity, admin_user, regular_user):
        from src.services.courses.activities.collab import recently_snapshotted_by

        assert await recently_snapshotted_by(activity.id, admin_user.id, db) is False
        assert await recently_snapshotted_by(activity.id, None, db) is False
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        db.add(ActivityVersion(activity_id=activity.id, org_id=activity.org_id, version_number=1, content=DOC_A, created_by_id=admin_user.id, created_at=now))
        await db.commit()
        assert await recently_snapshotted_by(activity.id, admin_user.id, db) is True
        assert await recently_snapshotted_by(activity.id, regular_user.id, db) is False
        # Named, or older than the interval: not shared
        db.add(ActivityVersion(activity_id=activity.id, org_id=activity.org_id, version_number=2, content=DOC_A, created_by_id=admin_user.id, created_at=now, label="Kept"))
        await db.commit()
        assert await recently_snapshotted_by(activity.id, admin_user.id, db) is False
        db.add(ActivityVersion(activity_id=activity.id, org_id=activity.org_id, version_number=3, content=DOC_A, created_by_id=admin_user.id, created_at=now - timedelta(minutes=6)))
        await db.commit()
        assert await recently_snapshotted_by(activity.id, admin_user.id, db) is False
