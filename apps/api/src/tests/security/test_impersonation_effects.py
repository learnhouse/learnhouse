"""Impersonation: what core does differently for
an impersonated request — org policies, the session endpoint, the session's
own routes, logout, analytics/CRM exclusion, mail, collab and notifications."""

import asyncio
import contextvars
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.security import impersonation as imp
from src.security.session_context import (
    AUTH_METHOD_IMPERSONATION,
    SessionProvenance,
    refuse_lms_session,
    set_session_provenance,
)


def _ctx(**over):
    data = dict(
        session_id="imp_abc", jti="jti-1", impersonator_id=99, org_id=1, target_user_id=2,
        target_email="regular@test.com", mode=imp.MODE_READ_ONLY, kind=imp.KIND_USER, role_id=4,
        allow_messaging=False, expires_at=int(time.time()) + 600,
    )
    data.update(over)
    _status, payload = imp.decode_impersonation_token(imp.mint_impersonation_token(**data))
    return imp.context_from_claims(payload).confirmed("Regular User")


async def _as(ctx, fn, *args, **kwargs):
    """Await ``fn`` in a task whose context carries ``ctx``."""
    async def inner():
        imp.set_impersonation(ctx)
        return await fn(*args, **kwargs)
    return await asyncio.get_running_loop().create_task(inner(), context=contextvars.copy_context())


def _sync_as(ctx, fn, *args, **kwargs):
    def inner():
        imp.set_impersonation(ctx)
        return fn(*args, **kwargs)
    return contextvars.copy_context().run(inner)


class TestOrgPolicies:
    async def test_auth_policy_holds_the_session_to_its_org(self, db, org, other_org, regular_user):
        from src.services.orgs.auth_policy import evaluate_org_auth

        ctx = _ctx(target_user_id=regular_user.id, org_id=org.id)
        assert await _as(ctx, evaluate_org_auth, db, regular_user.id, org.id) is None
        db._auth_policy_cache = {}
        block = await _as(ctx, evaluate_org_auth, db, regular_user.id, other_org.id)
        assert block == {"code": "SESSION_NOT_BOUND_TO_ORG"}

    async def test_org_2fa_requirement_does_not_strand_a_support_session(self, db, org, regular_user):
        from src.services.orgs import mfa_policy

        policy = SimpleNamespace(require_2fa=True)
        with patch.object(mfa_policy, "get_org_mfa_policy", AsyncMock(return_value=policy)), \
             patch.object(mfa_policy, "evaluate_mfa_compliance", AsyncMock(return_value=SimpleNamespace(blocking=True))):
            ctx = _ctx(target_user_id=regular_user.id, org_id=org.id)
            assert await _as(ctx, mfa_policy.is_org_mfa_blocking, db, regular_user.id, org.id) is None
            db._mfa_policy_cache = {}
            assert await mfa_policy.is_org_mfa_blocking(db, regular_user.id, org.id) is not None

    def test_account_changes_refused(self):
        def run():
            set_session_provenance(SessionProvenance(amr=AUTH_METHOD_IMPERSONATION, org_id=1))
            refuse_lms_session()
        with pytest.raises(HTTPException) as e:
            contextvars.copy_context().run(run)
        assert e.value.detail["code"] == imp.CODE_DENIED


def _app(db, user):
    from src.routers import impersonation as imp_router
    from src.routers.users import router as users_router
    from src.security.auth import get_current_user

    app = FastAPI()
    app.include_router(imp_router.router, prefix="/api/v1/auth/impersonation")
    app.include_router(users_router, prefix="/api/v1/users")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return app


class TestSessionRoutes:
    async def _call(self, app, method, path, ctx=None):
        async def go():
            if ctx is not None:
                imp.set_impersonation(ctx)
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
                return await c.request(method, path)
        return await asyncio.get_running_loop().create_task(go(), context=contextvars.copy_context())

    async def test_status_and_end(self, db, org, regular_user):
        app = _app(db, regular_user)
        hooks = SimpleNamespace(
            describe_impersonation=AsyncMock(return_value={"session_uuid": "imp_abc"}),
            end_impersonation_session=AsyncMock(return_value={"ended": True}),
        )
        ctx = _ctx(target_user_id=regular_user.id)
        with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks):
            r = await self._call(app, "GET", "/api/v1/auth/impersonation/status", ctx)
            assert r.status_code == 200 and r.json() == {"session_uuid": "imp_abc"}
            r = await self._call(app, "POST", "/api/v1/auth/impersonation/end", ctx)
            assert r.json() == {"ended": True}
            # Not in a session, or an unconfirmed one.
            assert (await self._call(app, "GET", "/api/v1/auth/impersonation/status")).status_code == 404
            unconfirmed = imp.context_from_claims(imp.decode_impersonation_token(
                imp.mint_impersonation_token(session_id="s", jti="j", impersonator_id=1, org_id=1, target_user_id=2,
                                             target_email="x@y.z", mode="read_only", kind="user", role_id=None,
                                             allow_messaging=False, expires_at=int(time.time()) + 60))[1])
            assert (await self._call(app, "POST", "/api/v1/auth/impersonation/end", unconfirmed)).status_code == 404
        with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
            assert (await self._call(app, "GET", "/api/v1/auth/impersonation/status", ctx)).status_code == 404

    async def test_switch_and_targets(self, db, org, regular_user):
        app = _app(db, regular_user)
        switch = AsyncMock(return_value={"session": {"session_uuid": "imp_next"}, "token": "t"})
        targets = AsyncMock(return_value={"members": []})
        hooks = SimpleNamespace(switch_impersonation=switch, impersonation_targets=targets)
        ctx = _ctx(target_user_id=regular_user.id)

        async def call(method, path, **kw):
            async def go():
                imp.set_impersonation(ctx)
                async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
                    return await c.request(method, path, **kw)
            return await asyncio.get_running_loop().create_task(go(), context=contextvars.copy_context())

        with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks):
            r = await call("POST", "/api/v1/auth/impersonation/switch", json={"user_id": 7, "mode": "read_only"})
            assert r.status_code == 200 and r.json()["token"] == "t"
            assert switch.await_args.args[2] == {"user_id": 7, "role_id": None, "mode": "read_only", "allow_messaging": None}
            r = await call("GET", "/api/v1/auth/impersonation/targets?q=lea")
            assert r.json() == {"members": []} and targets.await_args.args[2] == "lea"

    async def test_user_session_carries_the_session_and_skips_the_cache(self, db, org, regular_user):
        app = _app(db, regular_user)
        hooks = SimpleNamespace(describe_impersonation=AsyncMock(return_value={"mode": "read_only"}))
        ctx = _ctx(target_user_id=regular_user.id)
        with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks), \
             patch("src.routers.users._get_session_cache") as cache_get, \
             patch("src.routers.users._set_session_cache") as cache_set:
            r = await self._call(app, "GET", "/api/v1/users/session", ctx)
        assert r.status_code == 200 and r.json()["impersonation"] == {"mode": "read_only"}
        cache_get.assert_not_called()
        cache_set.assert_not_called()
        with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
            r = await self._call(app, "GET", "/api/v1/users/session", ctx)
        assert r.json()["impersonation"] is None


class TestLogout:
    @pytest.fixture
    async def client(self, db):
        from src.routers.auth import router as auth_router

        app = FastAPI()
        app.include_router(auth_router, prefix="/api/v1/auth")
        app.dependency_overrides[get_db_session] = lambda: db
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            yield c

    async def test_an_impersonation_token_never_signs_the_member_out(self, client):
        with patch("src.routers.auth.extract_jwt_from_request", return_value="tok"), \
             patch("src.routers.auth.decode_jwt", return_value={"sub": "regular@test.com", "purpose": "impersonation"}), \
             patch("src.routers.auth.revoke_user_sessions_before") as revoke:
            r = await client.delete("/api/v1/auth/logout")
        assert r.status_code == 403 and r.json()["detail"]["code"] == imp.CODE_DENIED
        revoke.assert_not_called()

    async def test_signing_out_ends_the_sessions_you_opened(self, client, admin_user):
        with patch("src.routers.auth.extract_jwt_from_request", return_value="tok"), \
             patch("src.routers.auth.decode_jwt", return_value={"sub": admin_user.email}), \
             patch("src.routers.auth.revoke_user_sessions_before"), \
             patch("src.routers.auth.end_impersonations_started_by", new_callable=AsyncMock) as end:
            r = await client.delete("/api/v1/auth/logout")
        assert r.status_code == 200
        end.assert_awaited_once()
        assert end.await_args.args[1] == admin_user.id


class TestExclusions:
    async def test_analytics_skips_support_sessions_but_keeps_the_audit(self):
        from src.services.analytics import analytics

        with patch.object(analytics, "track_ee_analytics_event", new_callable=AsyncMock) as ee, \
             patch.object(analytics, "_audit_bridge") as bridge:
            await _as(_ctx(), analytics.track, "page_view", 1, 2)
            ee.assert_not_called()
            bridge.assert_called_once()
            await analytics.track("page_view", 1, 2)
            ee.assert_awaited_once()

    def test_crm_hooks_skip_support_sessions(self):
        from src.core import ee_hooks

        on_event, on_user_changed = MagicMock(), MagicMock()
        hooks = SimpleNamespace(on_event=on_event, on_user_changed=on_user_changed)
        with patch.object(ee_hooks, "get_ee_hooks", return_value=hooks):
            _sync_as(_ctx(), ee_hooks.notify_ee_event, "course.updated", 1, {})
            _sync_as(_ctx(), ee_hooks.notify_ee_user_changed, 2)
            on_event.assert_not_called()
            on_user_changed.assert_not_called()
            ee_hooks.notify_ee_event("course.updated", 1, {})
            ee_hooks.notify_ee_user_changed(2)
        on_event.assert_called_once()
        on_user_changed.assert_called_once()

    def test_shadow_members_never_get_mail(self):
        from src.services.email import utils

        with patch.object(utils, "_send_email_resend") as resend, patch.object(utils, "_send_email_smtp") as smtp:
            assert utils.send_email(f"support-x@{imp.SHADOW_EMAIL_DOMAIN}", "Hi", "<p>x</p>") is None
        resend.assert_not_called()
        smtp.assert_not_called()


class TestNotifications:
    def test_support_sessions_are_labelled(self):
        from src.services.notifications import notifications as n

        items = [n.NotificationInput(user_id=5, org_id=1, type="course_update", title="t", data={"path": "/x"})]
        assert n._label_support_session(items) is items and "via_support" not in items[0].data
        labelled = _sync_as(_ctx(), n._label_support_session, items)
        assert labelled[0].data["via_support"]["on_behalf_of"] == "Regular User"
        assert labelled[0].data["path"] == "/x"

    def test_support_actor_name(self):
        from src.services.notifications import notifications as n

        actor = {"id": 2, "name": "Regular User"}
        assert n._support_actor(actor, {}) is actor
        assert n._support_actor(None, {"via_support": {"label": "x"}}) is None
        labelled = n._support_actor(actor, {"via_support": {"label": "x"}})
        assert labelled["name"] == f"{imp.SUPPORT_LABEL} (on behalf of Regular User)" and labelled["via_support"]
        class Row(SimpleNamespace):
            def __getattr__(self, name):  # columns added later read as unset
                return None

        row = Row(
            notification_uuid="n", org_id=1, type="t", category="c", title="t", body="", data={"via_support": {}},
            count=1, creation_date="now", actor_id=2,
        )
        assert n.serialize(row, {2: actor})["actor"]["via_support"] is True


class TestCollab:
    async def test_read_only_support_session_joins_as_a_labelled_viewer(self, monkeypatch, mock_request, db, activity, admin_user):
        from src.services.courses.activities.collab import get_collab_access

        monkeypatch.setenv("COLLAB_INTERNAL_KEY", "k" * 32)
        ctx = _ctx(target_user_id=admin_user.id)
        result = await _as(ctx, get_collab_access, mock_request, activity.activity_uuid, admin_user, db)
        assert result.role == "viewer" and result.user.display_name.endswith(f"({imp.SUPPORT_LABEL})")
        full = _ctx(target_user_id=admin_user.id, mode=imp.MODE_FULL)
        result = await _as(full, get_collab_access, mock_request, activity.activity_uuid, admin_user, db)
        assert result.role == "editor" and imp.SUPPORT_LABEL in result.user.display_name
