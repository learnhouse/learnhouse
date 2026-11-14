"""Live editing on/off (org default + per-activity override), the kick of open
collab rooms, and the autosave endpoint used when live editing is off."""

from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.activity_versions import ActivityVersion
from src.db.organization_config import OrganizationConfig
from src.routers.courses.activities import collab as collab_router
from src.security.auth import get_current_user
from src.services.courses.activities import collab_notify
from src.services.courses.activities.collab import AutosaveWrite, autosave_content, get_collab_access
from src.services.courses.activities.collab_settings import (
    ActivityLiveEditingWrite,
    OrgLiveEditingWrite,
    activity_live_editing_mode,
    get_activity_live_editing,
    get_org_live_editing,
    live_editing_enabled,
    org_live_editing,
    resolve_live_editing,
    set_activity_live_editing,
    set_org_live_editing,
)

KEY = "k" * 40
DOC_A = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "A"}]}]}
DOC_B = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "B"}]}]}


@pytest.fixture
async def org_config(db, org):
    config = OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "features": {}})
    db.add(config)
    await db.commit()
    return config


@pytest.fixture
def kicks():
    with patch("src.services.courses.activities.collab_settings.kick_collab_rooms") as mock:
        yield mock


@pytest.fixture(autouse=True)
def no_audit_or_cache():
    with patch("src.services.courses.activities.collab_settings.audit_event") as audit, patch(
        "src.services.orgs.cache.invalidate_org_config_cache"
    ):
        yield audit


async def _fresh(db, model, key):
    db.expire_all()
    return await db.get(model, key)


class TestResolution:
    def test_org_default_is_on_unless_explicitly_off(self):
        assert org_live_editing(None) is True
        assert org_live_editing({}) is True
        assert org_live_editing({"features": {"collaboration": {}}}) is True
        assert org_live_editing({"features": {"collaboration": {"live_editing": True}}}) is True
        assert org_live_editing({"features": {"collaboration": {"live_editing": False}}}) is False

    def test_activity_override(self):
        assert activity_live_editing_mode(Activity(name="x", activity_type="TYPE_DYNAMIC", activity_sub_type="SUBTYPE_DYNAMIC_PAGE", details=None)) == "default"
        assert activity_live_editing_mode(Activity(name="x", activity_type="TYPE_DYNAMIC", activity_sub_type="SUBTYPE_DYNAMIC_PAGE", details={"live_editing": "bogus"})) == "default"
        assert activity_live_editing_mode(Activity(name="x", activity_type="TYPE_DYNAMIC", activity_sub_type="SUBTYPE_DYNAMIC_PAGE", details={"live_editing": "off"})) == "off"
        assert resolve_live_editing("default", False) is False
        assert resolve_live_editing("on", False) is True
        assert resolve_live_editing("off", True) is False

    async def test_enabled_combines_both(self, db, org_config, activity):
        assert await live_editing_enabled(activity, db) is True
        org_config.config = {"features": {"collaboration": {"live_editing": False}}}
        db.add(org_config)
        await db.commit()
        assert await live_editing_enabled(activity, db) is False
        activity.details = {"live_editing": "on"}
        assert await live_editing_enabled(activity, db) is True

    async def test_enabled_without_org_config(self, db, activity):
        assert await live_editing_enabled(activity, db) is True


class TestOrgDefault:
    async def test_admin_turns_it_off_audits_and_kicks_rooms(self, mock_request, db, org, org_config, activity, admin_user, kicks, no_audit_or_cache):
        overridden = Activity(
            id=2, name="Pinned on", activity_type=ActivityTypeEnum.TYPE_DYNAMIC, activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            content={}, org_id=org.id, course_id=activity.course_id, activity_uuid="activity_pinned", details={"live_editing": "on"},
            creation_date="", update_date="",
        )
        db.add(overridden)
        await db.commit()
        result = await set_org_live_editing(mock_request, org.id, OrgLiveEditingWrite(live_editing=False), admin_user, db)
        assert result.live_editing is False
        assert (await get_org_live_editing(org.id, db)).live_editing is False
        config = (await db.execute(select(OrganizationConfig))).scalars().first()
        assert config.config["features"]["collaboration"]["live_editing"] is False
        assert config.config["config_version"] == "2.0"
        kicks.assert_called_once_with([activity.activity_uuid])
        audit = no_audit_or_cache.call_args.kwargs
        assert audit["action"] == "org.settings.updated"
        assert audit["after"] == {"features.collaboration.live_editing": False}

    async def test_turning_it_on_kicks_nobody(self, mock_request, db, org, org_config, admin_user, kicks):
        await set_org_live_editing(mock_request, org.id, OrgLiveEditingWrite(live_editing=True), admin_user, db)
        kicks.assert_not_called()

    async def test_refused_for_non_admins_and_unknown_orgs(self, mock_request, db, org, org_config, regular_user, admin_user):
        with pytest.raises(HTTPException) as exc:
            await set_org_live_editing(mock_request, org.id, OrgLiveEditingWrite(live_editing=False), regular_user, db)
        assert exc.value.status_code in (401, 403)
        with pytest.raises(HTTPException) as exc:
            await set_org_live_editing(mock_request, 999, OrgLiveEditingWrite(live_editing=False), admin_user, db)
        assert exc.value.status_code == 404

    async def test_org_without_config(self, mock_request, db, org, admin_user):
        with pytest.raises(HTTPException) as exc:
            await set_org_live_editing(mock_request, org.id, OrgLiveEditingWrite(live_editing=False), admin_user, db)
        assert exc.value.status_code == 404
        assert (await get_org_live_editing(org.id, db)).live_editing is True


class TestActivityOverride:
    async def test_override_off_kicks_the_room_and_audits(self, mock_request, db, org_config, activity, admin_user, kicks, no_audit_or_cache):
        result = await set_activity_live_editing(mock_request, activity.activity_uuid, ActivityLiveEditingWrite(mode="off"), admin_user, db)
        assert result.model_dump() == {"mode": "off", "org_default": True, "effective": False}
        assert (await _fresh(db, Activity, activity.id)).details == {"live_editing": "off"}
        kicks.assert_called_once_with([activity.activity_uuid])
        assert no_audit_or_cache.call_args.kwargs["after"] == {"live_editing": "off"}
        read = await get_activity_live_editing(mock_request, activity.activity_uuid, admin_user, db)
        assert read.effective is False

    async def test_back_to_default_keeps_other_details(self, mock_request, db, org_config, activity, admin_user, kicks):
        activity.details = {"live_editing": "off", "other": 1}
        db.add(activity)
        await db.commit()
        result = await set_activity_live_editing(mock_request, activity.activity_uuid, ActivityLiveEditingWrite(mode="default"), admin_user, db)
        assert result.effective is True
        assert (await _fresh(db, Activity, activity.id)).details == {"other": 1}
        kicks.assert_not_called()

    async def test_refused_for_learners_and_unknown_activities(self, mock_request, db, activity, regular_user, admin_user):
        with pytest.raises(HTTPException) as exc:
            await set_activity_live_editing(mock_request, activity.activity_uuid, ActivityLiveEditingWrite(mode="off"), regular_user, db)
        assert exc.value.status_code == 403
        with pytest.raises(HTTPException) as exc:
            await get_activity_live_editing(mock_request, "activity_missing", admin_user, db)
        assert exc.value.status_code == 404

    async def test_access_is_refused_while_off(self, monkeypatch, mock_request, db, activity, admin_user):
        monkeypatch.setenv("COLLAB_INTERNAL_KEY", KEY)
        activity.details = {"live_editing": "off"}
        db.add(activity)
        await db.commit()
        with pytest.raises(HTTPException) as exc:
            await get_collab_access(mock_request, activity.activity_uuid, admin_user, db)
        assert exc.value.status_code == 403 and exc.value.detail == "collab_disabled"


class TestKickNotification:
    async def test_posts_batches_to_the_collab_server(self, monkeypatch):
        monkeypatch.setenv("COLLAB_INTERNAL_KEY", KEY)
        monkeypatch.setattr(collab_notify, "KICK_BATCH", 2)
        calls = []

        class Client:
            def __init__(self, timeout):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def post(self, url, json, headers):
                calls.append((url, json["activity_uuids"], headers))
                return httpx.Response(200 if len(calls) == 1 else 500)

        monkeypatch.setattr(collab_notify.httpx, "AsyncClient", Client)
        collab_notify.kick_collab_rooms(["a", "b", "c"])
        while collab_notify._pending:
            await __import__("asyncio").gather(*list(collab_notify._pending))
        assert [c[1] for c in calls] == [["a", "b"], ["c"]]
        assert calls[0][0].endswith("/internal/activities/kick") and calls[0][2] == {"X-Internal-Key": KEY}

    async def test_unreachable_server_and_noops(self, monkeypatch):
        class Down:
            def __init__(self, timeout):
                pass

            async def __aenter__(self):
                raise httpx.ConnectError("down")

            async def __aexit__(self, *exc):
                return False

        monkeypatch.setattr(collab_notify.httpx, "AsyncClient", Down)
        monkeypatch.delenv("COLLAB_INTERNAL_KEY", raising=False)
        collab_notify.kick_collab_rooms(["a"])
        assert not collab_notify._pending
        monkeypatch.setenv("COLLAB_INTERNAL_KEY", KEY)
        collab_notify.kick_collab_rooms([])
        assert not collab_notify._pending
        collab_notify.kick_collab_rooms(["a"])
        while collab_notify._pending:
            await __import__("asyncio").gather(*list(collab_notify._pending))


class TestAutosave:
    @pytest.fixture(autouse=True)
    def _quiet(self):
        with patch("src.services.courses.activities.collab.dispatch_webhooks", new_callable=AsyncMock), patch(
            "src.services.courses.activities.collab_notify.notify_collab_content_changed"
        ) as notify:
            self.notify = notify
            yield

    async def _versions(self, db, activity_id):
        return (await db.execute(select(ActivityVersion).where(ActivityVersion.activity_id == activity_id))).scalars().all()

    async def test_saves_with_one_history_entry_per_person_and_interval(self, mock_request, db, activity, admin_user):
        activity.content = DOC_A
        db.add(activity)
        await db.commit()
        r1 = await autosave_content(mock_request, activity.activity_uuid, AutosaveWrite(content=DOC_B, base_version=1), admin_user, db)
        r2 = await autosave_content(mock_request, activity.activity_uuid, AutosaveWrite(content=DOC_A, base_version=2), admin_user, db)
        assert (r1.current_version, r2.current_version) == (2, 3)
        assert len(await self._versions(db, activity.id)) == 1
        fresh = await _fresh(db, Activity, activity.id)
        assert fresh.content == DOC_A and fresh.last_modified_by_id == admin_user.id
        assert self.notify.call_count == 2

    async def test_first_save_of_an_empty_page_takes_no_snapshot(self, mock_request, db, activity, admin_user):
        activity.content = {}
        db.add(activity)
        await db.commit()
        await autosave_content(mock_request, activity.activity_uuid, AutosaveWrite(content=DOC_A, base_version=1), admin_user, db)
        assert await self._versions(db, activity.id) == []

    async def test_conflict_names_who_saved(self, mock_request, db, activity, admin_user):
        activity.current_version = 5
        activity.last_modified_by_id = admin_user.id
        db.add(activity)
        await db.commit()
        with pytest.raises(HTTPException) as exc:
            await autosave_content(mock_request, activity.activity_uuid, AutosaveWrite(content=DOC_B, base_version=4), admin_user, db)
        assert exc.value.status_code == 409
        assert exc.value.detail["current_version"] == 5 and exc.value.detail["last_modified_by"] == "Admin User"
        activity.last_modified_by_id = None
        db.add(activity)
        await db.commit()
        with pytest.raises(HTTPException) as exc:
            await autosave_content(mock_request, activity.activity_uuid, AutosaveWrite(content=DOC_B, base_version=4), admin_user, db)
        assert exc.value.detail["last_modified_by"] is None

    async def test_refusals(self, mock_request, db, org, course, activity, admin_user, regular_user):
        with pytest.raises(HTTPException) as exc:
            await autosave_content(mock_request, "activity_missing", AutosaveWrite(content=DOC_A, base_version=1), admin_user, db)
        assert exc.value.status_code == 404
        with pytest.raises(HTTPException) as exc:
            await autosave_content(mock_request, activity.activity_uuid, AutosaveWrite(content=DOC_A, base_version=1), regular_user, db)
        assert exc.value.status_code == 403
        with pytest.raises(HTTPException) as exc:
            await autosave_content(mock_request, activity.activity_uuid, AutosaveWrite(content={"type": "x"}, base_version=1), admin_user, db)
        assert exc.value.status_code == 422
        video = Activity(
            id=60, name="v", activity_type=ActivityTypeEnum.TYPE_VIDEO, activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
            content={}, org_id=org.id, course_id=course.id, activity_uuid="activity_v60", creation_date="", update_date="",
        )
        db.add(video)
        await db.commit()
        with pytest.raises(HTTPException) as exc:
            await autosave_content(mock_request, video.activity_uuid, AutosaveWrite(content=DOC_A, base_version=1), admin_user, db)
        assert exc.value.status_code == 404


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(collab_router.router, prefix="/api/v1/activities")
    app.include_router(collab_router.org_router, prefix="/api/v1/orgs")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


class TestRouters:
    async def test_endpoints(self, client, org, org_config, activity, kicks):
        with patch("src.services.courses.activities.collab.dispatch_webhooks", new_callable=AsyncMock), patch(
            "src.services.courses.activities.collab_notify.notify_collab_content_changed"
        ):
            assert (await client.get(f"/api/v1/orgs/{org.id}/live-editing")).json() == {"live_editing": True}
            assert (await client.put(f"/api/v1/orgs/{org.id}/live-editing", json={"live_editing": False})).json() == {"live_editing": False}
            res = await client.get(f"/api/v1/activities/{activity.activity_uuid}/live-editing")
            assert res.json() == {"mode": "default", "org_default": False, "effective": False}
            res = await client.put(f"/api/v1/activities/{activity.activity_uuid}/live-editing", json={"mode": "on"})
            assert res.json()["effective"] is True
            assert (await client.put(f"/api/v1/activities/{activity.activity_uuid}/live-editing", json={"mode": "maybe"})).status_code == 422
            res = await client.put(f"/api/v1/activities/{activity.activity_uuid}/content/autosave", json={"content": DOC_A, "base_version": 1})
            assert res.status_code == 200 and res.json()["current_version"] == 2
