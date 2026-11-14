"""Impersonation: the core side.

Token, claims, request policy, the gate middleware, the ORM org scope, the
auth resolution (with the EE confirmation hook faked) and every place core
code treats an impersonated request differently.
"""

import contextvars
import time
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import jwt
import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlmodel import select
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute
from starlette.applications import Starlette

from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User
from src.security import impersonation as imp
from src.security.security import ALGORITHM, SECRET_KEY


def _token(**over):
    data = dict(
        session_id="imp_abc", jti="jti-1", impersonator_id=99, org_id=1, target_user_id=2,
        target_email="regular@test.com", mode=imp.MODE_READ_ONLY, kind=imp.KIND_USER, role_id=4,
        allow_messaging=False, expires_at=int(time.time()) + 600,
    )
    data.update(over)
    return imp.mint_impersonation_token(**data)


def _ctx(**over):
    status, payload = imp.decode_impersonation_token(_token(**over))
    assert status == "ok"
    return imp.context_from_claims(payload)


def _run(ctx, fn, *args):
    """Run ``fn`` with ``ctx`` as the current impersonation, in a copied context."""
    def inner():
        imp.set_impersonation(ctx)
        return fn(*args)
    return contextvars.copy_context().run(inner)


async def _arun(ctx, coro_fn, *args, **kwargs):
    token = imp.set_impersonation(ctx)
    try:
        return await coro_fn(*args, **kwargs)
    finally:
        imp.reset_impersonation(token)


# ── token and claims ────────────────────────────────────────────────────


class TestToken:
    def test_round_trip(self):
        ctx = _ctx(mode=imp.MODE_FULL, allow_messaging=True, role_id=None)
        assert ctx.session_id == "imp_abc" and ctx.impersonator_id == 99 and ctx.org_id == 1
        assert ctx.target_user_id == 2 and ctx.mode == imp.MODE_FULL and ctx.allow_messaging
        assert ctx.role_id is None and not ctx.read_only and not ctx.verified
        confirmed = ctx.confirmed("Regular User")
        assert confirmed.verified and confirmed.target_label == "Regular User"
        assert confirmed.audit_details() == {"by": imp.SUPPORT_LABEL, "session": "imp_abc", "mode": imp.MODE_FULL}

    def test_payload_is_never_a_session(self):
        payload = jwt.decode(_token(), SECRET_KEY, algorithms=[ALGORITHM])
        assert payload["purpose"] == imp.IMPERSONATION_PURPOSE and payload["type"] == "access"

    def test_classification(self):
        assert imp.decode_impersonation_token(None) == ("none", None)
        assert imp.decode_impersonation_token("not-a-jwt") == ("none", None)
        assert imp.decode_impersonation_token(_token(expires_at=int(time.time()) - 5)) == ("expired", None)
        forged = jwt.encode({"sub": "x", "exp": int(time.time()) + 60, "purpose": "impersonation"}, "wrong-key-wrong-key-wrong-key-123", algorithm=ALGORITHM)
        assert imp.decode_impersonation_token(forged) == ("invalid", None)
        session = jwt.encode({"sub": "x", "exp": int(time.time()) + 60, "purpose": "session"}, SECRET_KEY, algorithm=ALGORITHM)
        assert imp.decode_impersonation_token(session) == ("none", None)
        expired_session = jwt.encode({"sub": "x", "exp": int(time.time()) - 60, "purpose": "session"}, SECRET_KEY, algorithm=ALGORITHM)
        assert imp.decode_impersonation_token(expired_session) == ("none", None)
        bad_other = jwt.encode({"sub": "x", "exp": int(time.time()) + 60}, "wrong-key-wrong-key-wrong-key-123", algorithm=ALGORITHM)
        assert imp.decode_impersonation_token(bad_other) == ("none", None)
        assert imp._unverified_purpose("a.b.c") is None

    @pytest.mark.parametrize("payload", [
        None,
        {"imp": "x"},
        {"imp": {"sid": "s", "mode": "read_only", "kind": "user", "by": 1, "org": 1, "tgt": 2}, "exp": 1},  # no jti
        {"imp": {"sid": "", "mode": "read_only", "kind": "user", "by": 1, "org": 1, "tgt": 2}, "jti": "j", "exp": 1},
        {"imp": {"sid": "s", "mode": "god", "kind": "user", "by": 1, "org": 1, "tgt": 2}, "jti": "j", "exp": 1},
        {"imp": {"sid": "s", "mode": "read_only", "kind": "user", "by": "x", "org": 1, "tgt": 2}, "jti": "j", "exp": 1},
    ])
    def test_malformed_claims(self, payload):
        assert imp.context_from_claims(payload) is None

    def test_one_resolver_for_gate_and_auth(self):
        tok = _token()
        session = jwt.encode({"sub": "x", "exp": int(time.time()) + 60, "purpose": "session"}, SECRET_KEY, algorithm=ALGORITHM)
        r = imp.resolve_credential
        # Bearer wins; LH_imp wins over LH_access; API tokens are not session credentials.
        assert r({"authorization": f"Bearer {tok}"}, {imp.ACCESS_COOKIE: session}).status == "ok"
        assert r({"authorization": f"Bearer {session}"}, {imp.IMPERSONATION_COOKIE: tok}).status == "session"
        assert r({}, {imp.IMPERSONATION_COOKIE: tok, imp.ACCESS_COOKIE: session}).source == imp.SOURCE_IMP_COOKIE
        assert r({"authorization": "Bearer lh_token"}, {imp.IMPERSONATION_COOKIE: tok}).status == "none"
        assert r({"authorization": "Bearer "}, {}).status == "none"
        assert r({"Authorization": f"Bearer {tok}"}, {}).status == "ok"  # plain dicts too
        assert r({}, {}).status == "none"
        assert r({}, {imp.ACCESS_COOKIE: session}).status == "session"
        # An impersonation token is never honoured from LH_access...
        misplaced = r({}, {imp.ACCESS_COOKIE: tok})
        assert misplaced.status == "misplaced" and misplaced.refused and misplaced.payload
        assert r({}, {imp.ACCESS_COOKIE: _token(expires_at=1)}).status == "misplaced"
        # ...and LH_imp never carries anything but one.
        assert r({}, {imp.IMPERSONATION_COOKIE: session}).status == "foreign"
        assert r({}, {imp.IMPERSONATION_COOKIE: "garbage"}).refused
        assert r({}, {imp.IMPERSONATION_COOKIE: _token(expires_at=1)}).status == "expired"

    def test_report_misplaced(self):
        cred = imp.resolve_credential({}, {imp.ACCESS_COOKIE: _token()})
        with patch.object(imp, "report_denied") as report:
            imp.report_misplaced(cred, "PUT", "/x")
            imp.report_misplaced(imp.SessionCredential("t", imp.SOURCE_ACCESS_COOKIE, "misplaced", None), "PUT", "/x")
        report.assert_called_once()
        assert report.call_args.args[3] == imp.CODE_MISPLACED

    def test_shadow_email_and_hash(self):
        assert imp.is_shadow_email("support-x@" + imp.SHADOW_EMAIL_DOMAIN)
        assert not imp.is_shadow_email("a@b.com") and not imp.is_shadow_email(None)
        assert imp.token_hash("x") == imp.token_hash("x") != imp.token_hash("y")


# ── request policy ──────────────────────────────────────────────────────


class TestPolicy:
    ro = None

    def setup_method(self):
        self.ro = _ctx()
        self.full = _ctx(mode=imp.MODE_FULL)
        self.full_msg = _ctx(mode=imp.MODE_FULL, allow_messaging=True)

    @pytest.mark.parametrize("method", ["GET", "POST", "PUT", "PATCH", "DELETE"])
    def test_read_only_blocks_every_write(self, method):
        expected = None if method == "GET" else imp.CODE_READ_ONLY
        assert imp.request_policy(method, "/api/v1/courses/course_x", self.ro) == expected
        assert imp.request_policy(method, "/api/v1/blocks/image", self.ro) == expected

    def test_read_only_allows_read_posts_and_own_controls(self):
        assert imp.request_policy("POST", "/api/v1/discussions/votes/batch", self.ro) is None
        assert imp.request_policy("POST", "/api/v1/auth/impersonation/end", self.ro) is None
        assert imp.request_policy("POST", "/api/v1/auth/impersonation/switch", self.ro) is None
        assert imp.request_policy("GET", "/api/v1/auth/impersonation/targets", self.ro) is None
        assert imp.request_policy("GET", "/api/v1/auth/impersonation/status", self.ro) is None
        assert imp.request_policy("OPTIONS", "/api/v1/courses/", self.ro) is None
        assert imp.request_policy(None, "/api/v1/courses/", self.ro) is None

    def test_analytics_is_swallowed(self):
        for path in ("/api/v1/signals/batch", "/api/v1/analytics/events", "/api/v1/demo-instance/track"):
            assert imp.request_policy("POST", path, self.full) == "swallow"

    @pytest.mark.parametrize("method,path", [
        ("POST", "/api/v1/auth/login"),
        ("GET", "/api/v1/auth/refresh"),
        ("POST", "/api/v1/auth/mfa/disable"),
        ("PUT", "/api/v1/users/change_password/2"),
        ("PUT", "/api/v1/users/2"),
        ("DELETE", "/api/v1/users/user_id/2"),
        ("DELETE", "/api/v1/orgs/1"),
        ("DELETE", "/api/v1/orgs/1/leave"),
        ("GET", "/api/v1/orgs/1/api-tokens"),
        ("POST", "/api/v1/orgs/1/webhooks"),
        ("POST", "/api/v1/orgs/1/ai-credits/add"),
        ("POST", "/api/v1/orgs/1/domains"),
        ("GET", "/api/v1/payments/1/config"),
        ("POST", "/api/v1/scim/admin/1/tokens"),
        ("POST", "/api/v1/lti/link/abc"),
        ("POST", "/api/v1/admin/default/auth/token"),
        ("GET", "/api/v1/orgs/1/users/export"),
        ("GET", "/api/v1/ee/audit_logs/1/export"),
        ("POST", "/api/v1/ee/superadmin/impersonations"),
        ("GET", "/api/v1/ee/superadmin/me"),
        ("POST", "/api/v1/ee/license/activate"),
        ("POST", "/api/v1/mcp/oauth/approve"),
        ("POST", "/mcp"),
        ("POST", "/api/v1/integrations/zapier/token"),
        ("POST", "/api/v1/tools/create_course"),
        ("GET", "/api/v1/dev/x"),
        ("POST", "/api/v1/notifications/devices"),
        ("GET", "/api/v1/messaging/stream"),
    ])
    def test_denylist_holds_in_full_mode(self, method, path):
        assert imp.request_policy(method, path, self.full_msg) == imp.CODE_DENIED

    def test_org_2fa_policy_read_is_allowed(self):
        assert imp.request_policy("GET", "/api/v1/auth/mfa/org-policy/1", self.ro) is None
        assert imp.request_policy("PUT", "/api/v1/auth/mfa/org-policy/1", self.full_msg) == imp.CODE_DENIED

    def test_denylist_keeps_safe_neighbours(self):
        assert imp.request_policy("GET", "/api/v1/users/2", self.full) is None
        assert imp.request_policy("GET", "/api/v1/orgs/1/domains", self.full) is None
        assert imp.request_policy("PUT", "/api/v1/users/update_avatar/2", self.full) is None

    @pytest.mark.parametrize("path", [
        "/api/v1/messaging/conversations",
        "/api/v1/communities/c_1/discussions",
        "/api/v1/discussions/d_1/upvote",
        "/api/v1/activities/a_1/comments",
        "/api/v1/newsletter/campaigns",
        "/api/v1/usergroups/g_1/email",
        "/api/v1/live_sessions/l_1/join",
        "/api/v1/boards/b_1/meet/token",
        "/api/v1/emails/unsubscribe",
    ])
    def test_messaging(self, path):
        assert imp.request_policy("POST", path, self.full) == imp.CODE_MESSAGING
        assert imp.request_policy("POST", path, self.full_msg) is None
        assert imp.request_policy("POST", path, self.ro) == imp.CODE_READ_ONLY

    def test_full_mode_writes_content(self):
        assert imp.request_policy("PUT", "/api/v1/courses/course_x", self.full) is None

    def test_refusal_helpers(self):
        imp.refuse_under_impersonation()
        imp.refuse_writes_under_read_only()
        with pytest.raises(HTTPException) as e:
            _run(self.ro, imp.refuse_under_impersonation)
        assert e.value.status_code == 403 and e.value.detail["code"] == imp.CODE_DENIED
        with pytest.raises(HTTPException) as e:
            _run(self.ro, imp.refuse_writes_under_read_only)
        assert e.value.detail["code"] == imp.CODE_READ_ONLY
        _run(self.full, imp.refuse_writes_under_read_only)
        assert imp.error_detail(imp.CODE_ENDED)["message"]


# ── EE hand-offs ────────────────────────────────────────────────────────


class TestHooks:
    def test_report_denied(self):
        ctx = _ctx()
        with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
            imp.report_denied(ctx, "POST", "/x", imp.CODE_READ_ONLY)
        hook = MagicMock()
        with patch("src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace(record_impersonation_denied=hook)):
            imp.report_denied(ctx, "POST", "/x", imp.CODE_READ_ONLY)
        hook.assert_called_once_with(ctx, "POST", "/x", imp.CODE_READ_ONLY)
        boom = MagicMock(side_effect=RuntimeError("x"))
        with patch("src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace(record_impersonation_denied=boom)):
            imp.report_denied(ctx, "POST", "/x", imp.CODE_READ_ONLY)

    async def test_end_started_by(self):
        with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
            assert await imp.end_impersonations_started_by(None, 1) == 0
        ok = AsyncMock(return_value=2)
        with patch("src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace(end_impersonations_started_by=ok)):
            assert await imp.end_impersonations_started_by("db", 1, "logout") == 2
        ok.assert_awaited_once_with("db", 1, "logout")
        boom = AsyncMock(side_effect=RuntimeError("x"))
        with patch("src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace(end_impersonations_started_by=boom)):
            assert await imp.end_impersonations_started_by("db", 1) == 0


# ── middleware ──────────────────────────────────────────────────────────


def _gate_app(seen):
    async def endpoint(request):
        seen.append(imp.current_impersonation())
        return JSONResponse({"ok": True})

    async def ws(websocket):  # pragma: no cover - the gate closes it first
        await websocket.accept()

    app = Starlette(routes=[
        Route("/api/v1/{path:path}", endpoint, methods=["GET", "POST", "PUT", "DELETE"]),
        WebSocketRoute("/ws", ws),
    ])
    return imp.ImpersonationGateMiddleware(app)


class TestGate:
    async def _req(self, method, path, token=None, cookie=None):
        seen = []
        app = _gate_app(seen)
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if cookie:
            headers["Cookie"] = f"{imp.IMPERSONATION_COOKIE}={cookie}"
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            r = await c.request(method, path, headers=headers)
        return r, seen

    async def test_normal_requests_pass_untouched(self):
        r, seen = await self._req("POST", "/api/v1/courses/x")
        assert r.status_code == 200 and seen == [None]

    async def test_read_only_write_refused_and_reported(self):
        with patch.object(imp, "report_denied") as report:
            r, seen = await self._req("PUT", "/api/v1/courses/x", token=_token())
        assert r.status_code == 403 and r.json()["detail"]["code"] == imp.CODE_READ_ONLY and seen == []
        report.assert_called_once()

    async def test_cookie_counts_without_bearer(self):
        r, _ = await self._req("DELETE", "/api/v1/courses/x", cookie=_token())
        assert r.status_code == 403

    async def test_reads_run_with_the_context_set(self):
        r, seen = await self._req("GET", "/api/v1/courses/x", token=_token())
        assert r.status_code == 200 and seen[0].session_id == "imp_abc"
        assert imp.current_impersonation() is None

    async def test_analytics_swallowed(self):
        r, seen = await self._req("POST", "/api/v1/signals/batch", token=_token(mode=imp.MODE_FULL))
        assert r.status_code == 202 and r.json() == {"dropped": True} and seen == []

    async def test_spent_tokens_are_401_never_a_fallback(self):
        r, _ = await self._req("GET", "/api/v1/courses/x", cookie=_token(expires_at=int(time.time()) - 1))
        assert r.status_code == 401 and r.json()["detail"]["code"] == imp.CODE_ENDED
        bad = jwt.encode({"sub": "x", "exp": int(time.time()) + 60, "purpose": "impersonation"}, SECRET_KEY, algorithm=ALGORITHM)
        r, _ = await self._req("GET", "/api/v1/courses/x", token=bad)
        assert r.status_code == 401

    async def test_gate_and_auth_agree_on_misplaced_and_foreign_tokens(self):
        seen = []
        app = _gate_app(seen)
        session = jwt.encode({"sub": "x", "exp": int(time.time()) + 60, "purpose": "session"}, SECRET_KEY, algorithm=ALGORITHM)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            with patch.object(imp, "report_denied") as report:
                r = await c.put("/api/v1/courses/x", headers={"Cookie": f"LH_access={_token(mode=imp.MODE_FULL)}"})
            assert r.status_code == 401 and report.call_args.args[3] == imp.CODE_MISPLACED
            r = await c.get("/api/v1/courses/x", headers={"Cookie": f"{imp.IMPERSONATION_COOKIE}={session}"})
            assert r.status_code == 401
            r = await c.put("/api/v1/courses/x", headers={"Cookie": f"LH_access={session}"})
            assert r.status_code == 200
        assert seen == [None]

    async def test_websocket_refused(self):
        app = _gate_app([])
        sent = []

        async def receive():  # pragma: no cover - never awaited
            return {"type": "websocket.connect"}

        async def send(message):
            sent.append(message)

        scope = {"type": "websocket", "path": "/ws", "headers": [(b"authorization", f"Bearer {_token()}".encode())]}
        await app(scope, receive, send)
        assert sent == [{"type": "websocket.close", "code": 4403}]
        sent.clear()
        scope["headers"] = [(b"authorization", f"Bearer {_token(expires_at=1)}".encode())]
        await app(scope, receive, send)
        assert sent == [{"type": "websocket.close", "code": 4401}]

    async def test_lifespan_passes(self):
        inner = AsyncMock()
        await imp.ImpersonationGateMiddleware(inner)({"type": "lifespan"}, None, None)
        inner.assert_awaited_once()


# ── ORM org scope ───────────────────────────────────────────────────────


class TestOrmScope:
    async def test_other_org_memberships_disappear(self, db, org, other_org, regular_user, admin_user):
        imp.install_orm_scope()
        imp.install_orm_scope()  # idempotent
        db.add(UserOrganization(user_id=regular_user.id, org_id=other_org.id, role_id=4,
                                creation_date=str(datetime.now()), update_date=str(datetime.now())))
        db.add(UserOrganization(user_id=admin_user.id, org_id=other_org.id, role_id=1,
                                creation_date=str(datetime.now()), update_date=str(datetime.now())))
        await db.commit()

        async def orgs_of(uid):
            return sorted((await db.execute(select(UserOrganization.org_id).where(UserOrganization.user_id == uid))).scalars().all())

        assert await orgs_of(regular_user.id) == [1, 2]
        ctx = _ctx(target_user_id=regular_user.id, org_id=org.id)
        assert await _arun(ctx, orgs_of, regular_user.id) == [1]
        # Everyone else is untouched.
        assert await _arun(ctx, orgs_of, admin_user.id) == [1, 2]
        # Writes are not filtered (only selects).
        await _arun(ctx, db.commit)


# ── auth resolution ─────────────────────────────────────────────────────


def _request(token=None, cookie=None, path="/api/v1/courses/x", query=b"", method="GET", path_params=None):
    headers = []
    if token:
        headers.append((b"authorization", f"Bearer {token}".encode()))
    if cookie:
        headers.append((b"cookie", cookie.encode()))
    scope = {"type": "http", "method": method, "path": path, "headers": headers, "query_string": query,
             "path_params": path_params or {}, "state": {}}
    return Request(scope)


class TestResolve:
    async def _resolve(self, db, request, confirm=None, hooks=True):
        from src.security.auth import get_current_user

        ns = SimpleNamespace(confirm_impersonation=confirm) if hooks else None
        with patch("src.core.ee_hooks.get_ee_hooks", return_value=ns):
            return await get_current_user(request, db)

    async def _row(self, db, uid):
        return await db.get(User, uid)

    async def test_resolves_the_target_exactly(self, db, org, regular_user):
        row = await self._row(db, regular_user.id)
        confirm = AsyncMock(return_value=row)
        request = _request(token=_token())
        holder = {}

        async def go():
            user = await self._resolve(db, request, confirm)
            holder["ctx"] = imp.current_impersonation()
            from src.security.session_context import get_session_provenance, held_org_id

            holder["prov"] = get_session_provenance()
            holder["held"] = held_org_id()
            return user

        user = await _in_ctx(contextvars.copy_context(), go)
        assert isinstance(user, PublicUser) and user.id == regular_user.id
        assert holder["ctx"].verified and holder["ctx"].target_label == "Regular User"
        assert holder["prov"].amr == "impersonation" and holder["held"] == org.id
        assert request.state.impersonation.verified and db._superadmin_cache[regular_user.id] is False

    async def test_tokens_outside_lh_imp_or_bearer_are_refused(self, db, org, regular_user):
        """An impersonation token in LH_access is a 401 (and audited), never a
        session the gate didn't see; a normal token in LH_imp is a 401 too."""
        from src.security.auth import create_access_token

        row = await self._row(db, regular_user.id)
        confirm = AsyncMock(return_value=row)
        with patch.object(imp, "report_denied") as report:
            with pytest.raises(HTTPException) as e:
                await self._resolve(db, _request(cookie=f"LH_access={_token(mode=imp.MODE_FULL)}", method="PUT"), confirm)
        assert e.value.status_code == 401 and e.value.detail["code"] == imp.CODE_ENDED
        assert report.call_args.args[3] == imp.CODE_MISPLACED
        confirm.assert_not_called()
        normal = create_access_token({"sub": row.email, "purpose": "session"})
        with pytest.raises(HTTPException) as e:
            await self._resolve(db, _request(cookie=f"{imp.IMPERSONATION_COOKIE}={normal}; LH_access={normal}"), confirm)
        assert e.value.status_code == 401
        # The normal token still works where it belongs.
        user = await _in_ctx(contextvars.copy_context(), self._resolve, db, _request(cookie=f"LH_access={normal}"), confirm)
        assert user.id == regular_user.id

    async def test_auth_applies_the_policy_itself(self, db, org, regular_user):
        """Even with no gate in front, the resolved principal is held to the
        session's mode and the denylist."""
        row = await self._row(db, regular_user.id)
        with patch("src.security.auth.report_impersonation_denied") as report:
            for method, path, mode, code in (
                ("PUT", "/api/v1/courses/x", imp.MODE_READ_ONLY, imp.CODE_READ_ONLY),
                ("POST", "/api/v1/auth/mfa/disable", imp.MODE_FULL, imp.CODE_DENIED),
                ("POST", "/api/v1/signals/batch", imp.MODE_FULL, imp.CODE_DENIED),
            ):
                for req in (_request(token=_token(mode=mode), method=method, path=path),
                            _request(cookie=f"{imp.IMPERSONATION_COOKIE}={_token(mode=mode)}", method=method, path=path)):
                    with pytest.raises(HTTPException) as e:
                        await self._resolve(db, req, AsyncMock(return_value=row))
                    assert e.value.status_code == 403 and e.value.detail["code"] == code
        assert report.call_count == 6
        user = await _in_ctx(contextvars.copy_context(), self._resolve, db,
                             _request(token=_token(mode=imp.MODE_FULL), method="PUT"), AsyncMock(return_value=row))
        assert user.id == regular_user.id

    async def test_no_ee_or_no_record_is_401(self, db, org, regular_user):
        with pytest.raises(HTTPException) as e:
            await self._resolve(db, _request(token=_token()), hooks=False)
        assert e.value.status_code == 401 and e.value.detail["code"] == imp.CODE_ENDED
        with pytest.raises(HTTPException):
            await self._resolve(db, _request(token=_token()), AsyncMock(return_value=None))

    async def test_spent_or_malformed_token_is_401(self, db, org):
        with pytest.raises(HTTPException) as e:
            await self._resolve(db, _request(cookie=f"{imp.IMPERSONATION_COOKIE}={_token(expires_at=1)}"))
        assert e.value.status_code == 401
        bad = jwt.encode({"sub": "x", "exp": int(time.time()) + 60, "purpose": "impersonation", "imp": {}}, SECRET_KEY, algorithm=ALGORITHM)
        with pytest.raises(HTTPException):
            await self._resolve(db, _request(token=bad), AsyncMock())

    async def test_other_org_is_refused(self, db, org, other_org, regular_user):
        row = await self._row(db, regular_user.id)
        for request in (
            _request(token=_token(), query=b"org_id=2"),
            _request(token=_token(), path_params={"org_slug": "other-org"}),
            _request(token=_token(), path_params={"org_uuid": "org_other"}),
        ):
            with pytest.raises(HTTPException) as e:
                await self._resolve(db, request, AsyncMock(return_value=row))
            assert e.value.status_code == 403 and e.value.detail["code"] == imp.CODE_WRONG_ORG
        # Its own org passes, by id or slug.
        await _in_ctx(contextvars.copy_context(), self._resolve, db,
                      _request(token=_token(), path_params={"org_slug": "test-org"}), AsyncMock(return_value=row))


class TestSuperadminOrgBypass:
    def test_blocking_rules(self):
        from src.security import superadmin as sa

        def check(path):
            def inner():
                sa.block_superadmin_org_bypass(7, path)
                return sa.superadmin_org_bypass_blocked(7), sa.superadmin_org_bypass_blocked(8)
            return contextvars.copy_context().run(inner)

        assert check("/api/v1/ee/superadmin/organizations") == (False, False)
        assert check("/api/v1/ee/superadmin") == (False, False)
        assert check("/api/v1/courses/x") == (True, False)
        assert check("/api/v1/ee/superadminx") == (True, False)
        assert sa.superadmin_org_bypass_blocked(None) is False

    async def test_own_session_is_an_ordinary_user_outside_the_console(self, db, org, admin_user):
        """No implicit org access for a superadmin's own session, reads
        included; real memberships still work; the console still sees them as
        a superadmin."""
        from src.security import org_auth
        from src.security.auth import create_access_token, get_current_user
        from src.security.superadmin import is_user_superadmin, superadmin_org_bypass_blocked

        row = await db.get(User, admin_user.id)
        row.is_superadmin = True
        db.add(row)
        await db.commit()
        token = create_access_token({"sub": row.email, "purpose": "session"})

        async def as_request(method, path, org_id):
            request = _request(token=token, method=method, path=path)
            user = await get_current_user(request, db)
            return (
                superadmin_org_bypass_blocked(admin_user.id),
                await org_auth.is_org_member(admin_user.id, org_id, db),
                await is_user_superadmin(admin_user.id, db),
                user.is_superadmin,
            )

        for method in ("GET", "POST"):
            blocked, member_elsewhere, sa_flag, row_flag = await _in_ctx(
                contextvars.copy_context(), as_request, method, "/api/v1/courses/x", 99)
            assert blocked and not member_elsewhere and sa_flag is False and row_flag is True
        blocked, member_home, _, _ = await _in_ctx(contextvars.copy_context(), as_request, "POST", "/api/v1/courses/x", org.id)
        assert blocked and member_home
        blocked, _, sa_flag, _ = await _in_ctx(contextvars.copy_context(), as_request, "GET", "/api/v1/ee/superadmin/me", 99)
        assert not blocked and sa_flag is True


async def _in_ctx(ctx, fn, *args):
    import asyncio

    return await asyncio.get_running_loop().create_task(fn(*args), context=ctx)
