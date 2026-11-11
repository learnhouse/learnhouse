"""Embed sessions: minting, what they can reach, and where they are held.

An embed session is a learner session a host app mints with its org API token
and hands to a browser, so every boundary is tested: route allowlist, org
binding, account-security refusal, the org policies, and the mint gates.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

import jwt
import pytest
from fastapi import HTTPException

from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, User
from src.security.auth import get_current_user
from src.security.embed_session import (
    EMBED_SESSION_DEFAULT_TTL,
    enforce_embed_scope,
    is_embed_route,
)
from src.security.security import ALGORITHM, SECRET_KEY
from src.security.session_context import (
    AUTH_METHOD_EMBED,
    SessionProvenance,
    get_session_provenance,
    held_org_id,
    refuse_lms_session,
    refuse_outside_held_org,
    set_session_provenance,
)
from src.services.admin.admin import issue_embed_session
from src.services.orgs.auth_policy import (
    METHOD_NOT_ALLOWED_CODE,
    SESSION_NOT_BOUND_CODE,
    enforce_org_auth_policy,
)
from src.services.orgs.mfa_policy import evaluate_mfa_compliance

from src.tests.security.test_auth_policy import _set_auth_policy
from src.tests.security.test_mfa_org_policy import _set_policy as _set_mfa_policy


@pytest.fixture(autouse=True)
def _clear_provenance():
    set_session_provenance(None)
    yield
    set_session_provenance(None)


FULL_RIGHTS = {
    bucket: {"action_create": True, "action_read": True, "action_update": True, "action_delete": True}
    for bucket in ("users", "roles", "courses", "certifications", "usergroups")
}


@pytest.fixture
def token(org, admin_user):
    return APITokenUser(
        id=1,
        user_uuid="apitoken_embed",
        username="api_token",
        org_id=org.id,
        rights=FULL_RIGHTS,
        token_name="embed",
        created_by_user_id=admin_user.id,
    )


async def _member(db, user_id, org_ids, role_id=4):
    user = User(
        id=user_id,
        username=f"u{user_id}",
        first_name="F",
        last_name="L",
        email=f"u{user_id}@example.com",
        password="hashed",
        user_uuid=f"user_{user_id}",
        email_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    for oid in org_ids:
        db.add(UserOrganization(
            user_id=user.id, org_id=oid, role_id=role_id,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
    await db.commit()
    return user


def _decode(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


# -- route allowlist ------------------------------------------------------------


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/api/v1/courses/course_abc/meta"),
        ("GET", "/api/v1/courses/course_abc"),
        ("GET", "/api/v1/courses/id/12"),
        ("GET", "/api/v1/chapters/course/course_abc/meta"),
        ("GET", "/api/v1/activities/activity_abc"),
        ("GET", "/api/v1/activities/activity_abc/state"),
        ("HEAD", "/api/v1/activities/id/4"),
        ("GET", "/api/v1/trail/org/3/trail"),
        ("GET", "/api/v1/assignments/activity/activity_abc"),
        ("GET", "/api/v1/assignments/assignment_abc/tasks"),
        ("GET", "/api/v1/assignments/assignment_abc/submissions/me"),
        ("GET", "/api/v1/assignments/assignment_abc/tasks/submissions/me"),
        ("GET", "/api/v1/assignments/assignment_abc/submissions/7/grade"),
        ("GET", "/api/v1/blocks/video"),
        ("GET", "/api/v1/media/media_abc/file"),
        ("GET", "/api/v1/users/session"),
        ("GET", "/api/v1/users/id/5"),
        ("GET", "/api/v1/orgs/slug/acme"),
        ("GET", "/api/v1/boards/board_abc/membership"),
        ("GET", "/api/v1/courses/course_abc/"),
        ("POST", "/api/v1/trail/add_activity/activity_abc"),
        ("DELETE", "/api/v1/trail/remove_activity/activity_abc"),
        ("PUT", "/api/v1/assignments/assignment_abc/tasks/task_abc/submissions"),
        ("POST", "/api/v1/assignments/assignment_abc/tasks/task_abc/sub_file"),
        ("POST", "/api/v1/assignments/assignment_abc/submissions"),
        ("POST", "/api/v1/assignments/assignment_abc/submissions/me/retry"),
        ("POST", "/api/v1/code/execute"),
        ("POST", "/api/v1/code/execute-batch"),
        ("POST", "/api/v1/code/submissions/save"),
    ],
)
def test_embed_routes_allowed(method, path):
    assert is_embed_route(method, path) is True


@pytest.mark.parametrize(
    "method,path",
    [
        # Account and session management.
        ("PUT", "/api/v1/users/5"),
        ("PUT", "/api/v1/users/change_password/5"),
        ("DELETE", "/api/v1/users/5"),
        ("POST", "/api/v1/auth/logout"),
        ("POST", "/api/v1/auth/mfa/disable"),
        ("GET", "/api/v1/mcp/oauth/authorize"),
        ("POST", "/api/v1/orgs/1/api-tokens"),
        # Authoring and other people's work.
        ("PUT", "/api/v1/activities/activity_abc"),
        ("POST", "/api/v1/courses/"),
        ("PUT", "/api/v1/assignments/assignment_abc/submissions/7"),
        ("POST", "/api/v1/assignments/assignment_abc/submissions/7/grade"),
        ("GET", "/api/v1/assignments/assignment_abc/submissions"),
        ("GET", "/api/v1/assignments/assignment_abc/tasks/task_abc/submissions/user/7"),
        ("POST", "/api/v1/trail/add_course/course_abc"),
        ("GET", "/api/v1/orgs/1/users/export"),
        ("GET", "/api/v1/boards/board_abc/ydoc"),
        ("PUT", "/api/v1/boards/board_abc"),
        # Shapes the allowlist must not stretch to.
        ("GET", "/api/v1/courses/course_abc/meta/extra"),
        ("PATCH", "/api/v1/trail/add_activity/activity_abc"),
        ("GET", "/content/orgs/x/file.png"),
        ("GET", "/api/v1"),
    ],
)
def test_other_routes_refused(method, path):
    assert is_embed_route(method, path) is False


def _scope_request(method="GET", path="/api/v1/users/session", path_params=None, query=None):
    req = Mock()
    req.method = method
    req.url = SimpleNamespace(path=path)
    req.path_params = path_params or {}
    req.query_params = query or {}
    return req


def test_scope_refuses_token_without_org():
    with pytest.raises(HTTPException) as exc:
        enforce_embed_scope(_scope_request(), None)
    assert exc.value.status_code == 401


def test_scope_refuses_other_routes():
    with pytest.raises(HTTPException) as exc:
        enforce_embed_scope(_scope_request("PUT", "/api/v1/users/5"), 3)
    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "EMBED_SESSION_ROUTE_NOT_ALLOWED"


@pytest.mark.parametrize(
    "path_params,query",
    [({"org_id": 9}, None), ({}, {"org_id": "9"})],
)
def test_scope_refuses_other_org_in_path_or_query(path_params, query):
    req = _scope_request("GET", "/api/v1/trail/org/9/trail", path_params, query)
    with pytest.raises(HTTPException) as exc:
        enforce_embed_scope(req, 3)
    assert exc.value.detail["code"] == "SESSION_NOT_BOUND_TO_ORG"


def test_scope_allows_own_org():
    req = _scope_request("GET", "/api/v1/trail/org/3/trail", {"org_id": 3})
    enforce_embed_scope(req, 3)


# -- get_current_user with an embed token -------------------------------------------


def _auth_request(token: str, method: str, path: str) -> Mock:
    req = Mock()
    req.headers = {"Authorization": f"Bearer {token}"}
    req.cookies = {}
    req.state = SimpleNamespace()
    req.method = method
    req.url = SimpleNamespace(path=path)
    req.path_params = {}
    req.query_params = {}
    return req


@pytest.mark.asyncio
class TestEmbedTokenAuth:
    async def test_embed_token_authenticates_on_embed_route(self, db, org, token):
        learner = await _member(db, 501, [org.id])
        result = await issue_embed_session(token, learner.id, db)

        req = _auth_request(result["access_token"], "GET", "/api/v1/users/session")
        with patch("src.security.auth._record_activity_from_request"):
            user = await get_current_user(req, db)

        assert user.id == learner.id
        prov = get_session_provenance()
        assert prov.amr == AUTH_METHOD_EMBED
        assert prov.org_id == org.id

    async def test_embed_token_refused_elsewhere(self, db, org, token):
        learner = await _member(db, 502, [org.id])
        result = await issue_embed_session(token, learner.id, db)

        req = _auth_request(result["access_token"], "PUT", f"/api/v1/users/{learner.id}")
        with pytest.raises(HTTPException) as exc:
            await get_current_user(req, db)
        assert exc.value.status_code == 403
        assert exc.value.detail["code"] == "EMBED_SESSION_ROUTE_NOT_ALLOWED"

    async def test_embed_token_without_org_refused(self, db, org):
        learner = await _member(db, 503, [org.id])
        forged = jwt.encode(
            {
                "sub": learner.email,
                "purpose": "session",
                "type": "access",
                "amr": AUTH_METHOD_EMBED,
                "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
                "iat": datetime.now(timezone.utc),
            },
            SECRET_KEY,
            algorithm=ALGORITHM,
        )
        req = _auth_request(forged, "GET", "/api/v1/users/session")
        with pytest.raises(HTTPException) as exc:
            await get_current_user(req, db)
        assert exc.value.status_code == 401


# -- held to its org, never on the account ---------------------------------------------


def test_embed_session_is_held_to_its_org():
    set_session_provenance(SessionProvenance(amr=AUTH_METHOD_EMBED, org_id=4))
    assert held_org_id() == 4
    refuse_outside_held_org(4)
    with pytest.raises(HTTPException) as exc:
        refuse_outside_held_org(5)
    assert exc.value.detail["code"] == "SESSION_NOT_BOUND_TO_ORG"


def test_embed_session_refused_on_account_routes():
    set_session_provenance(SessionProvenance(amr=AUTH_METHOD_EMBED, org_id=4))
    with pytest.raises(HTTPException) as exc:
        refuse_lms_session()
    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "EMBED_SESSION_NOT_ALLOWED"


def test_other_sessions_pass_account_guard():
    set_session_provenance(SessionProvenance(amr="password", org_id=4))
    refuse_lms_session()


@pytest.mark.asyncio
class TestEmbedOrgPolicies:
    async def test_admitted_by_its_org_under_method_policy(self, db, org, regular_user):
        await _set_auth_policy(db, org.id, allowed_auth_methods=["sso"])
        set_session_provenance(SessionProvenance(amr=AUTH_METHOD_EMBED, org_id=org.id))
        await enforce_org_auth_policy(db, regular_user.id, org.id)

    async def test_refused_by_another_org_under_method_policy(self, db, org, regular_user):
        await _set_auth_policy(db, org.id, allowed_auth_methods=["sso"])
        set_session_provenance(SessionProvenance(amr=AUTH_METHOD_EMBED, org_id=org.id + 999))
        with pytest.raises(HTTPException) as exc:
            await enforce_org_auth_policy(db, regular_user.id, org.id)
        assert exc.value.detail["code"] == METHOD_NOT_ALLOWED_CODE

    async def test_never_reaches_another_org_even_with_sharing_on(self, db, org, regular_user):
        set_session_provenance(SessionProvenance(amr=AUTH_METHOD_EMBED, org_id=org.id + 999))
        with pytest.raises(HTTPException) as exc:
            await enforce_org_auth_policy(db, regular_user.id, org.id)
        assert exc.value.detail["code"] == SESSION_NOT_BOUND_CODE

    async def test_mfa_policy_exempt_only_in_its_org(self, db, org, regular_user):
        await _set_mfa_policy(
            db, org.id, require_2fa=True, require_2fa_enabled_at=datetime.now().isoformat()
        )
        user = await db.get(User, regular_user.id)
        user.signup_method = "password"
        db.add(user)
        await db.commit()

        set_session_provenance(SessionProvenance(amr=AUTH_METHOD_EMBED, org_id=org.id))
        assert (await evaluate_mfa_compliance(db, user, org.id)).satisfied is True

        set_session_provenance(SessionProvenance(amr=AUTH_METHOD_EMBED, org_id=org.id + 1000))
        assert (await evaluate_mfa_compliance(db, user, org.id)).satisfied is False


# -- minting -----------------------------------------------------------------------------


@pytest.mark.asyncio
class TestIssueEmbedSession:
    async def test_default_session(self, db, org, token):
        learner = await _member(db, 510, [org.id])
        before = datetime.now(timezone.utc)
        result = await issue_embed_session(token, learner.id, db)

        claims = _decode(result["access_token"])
        assert claims["sub"] == learner.email
        assert claims["purpose"] == "session"
        assert claims["type"] == "access"
        assert claims["amr"] == AUTH_METHOD_EMBED
        assert claims["sorg"] == org.id
        assert "jti" not in claims  # access token only, no refresh
        assert result["expires_in"] == int(EMBED_SESSION_DEFAULT_TTL.total_seconds())
        assert abs(claims["exp"] - result["expires_at"]) <= 1
        assert result["expires_at"] >= int((before + EMBED_SESSION_DEFAULT_TTL).timestamp())
        assert result["user_id"] == learner.id
        assert result["user_uuid"] == learner.user_uuid
        assert result["org_id"] == org.id
        assert set(result) == {
            "access_token", "token_type", "expires_in", "expires_at", "user_id", "user_uuid", "org_id",
        }

    async def test_custom_ttl(self, db, org, token):
        learner = await _member(db, 511, [org.id])
        result = await issue_embed_session(token, learner.id, db, ttl_seconds=3600)
        assert result["expires_in"] == 3600

    @pytest.mark.parametrize("ttl", [0, 59, 3601, -5])
    async def test_ttl_out_of_range(self, db, org, token, ttl):
        learner = await _member(db, 520 + abs(ttl) % 7, [org.id])
        with pytest.raises(HTTPException) as exc:
            await issue_embed_session(token, learner.id, db, ttl_seconds=ttl)
        assert exc.value.status_code == 422

    async def test_requires_users_update_right(self, db, org, admin_user):
        learner = await _member(db, 530, [org.id])
        read_only = APITokenUser(
            id=2, user_uuid="apitoken_ro", username="api_token", org_id=org.id,
            rights={"users": {"action_read": True}}, token_name="ro",
            created_by_user_id=admin_user.id,
        )
        with pytest.raises(HTTPException) as exc:
            await issue_embed_session(read_only, learner.id, db)
        assert exc.value.status_code == 403

    async def test_refuses_admins(self, db, org, token):
        admin = await _member(db, 531, [org.id], role_id=1)
        with pytest.raises(HTTPException) as exc:
            await issue_embed_session(token, admin.id, db)
        assert exc.value.status_code == 403

    async def test_refuses_users_of_other_orgs(self, db, org, other_org, token):
        outsider = await _member(db, 532, [other_org.id])
        with pytest.raises(HTTPException) as exc:
            await issue_embed_session(token, outsider.id, db)
        assert exc.value.status_code == 403

    async def test_refuses_shared_accounts(self, db, org, other_org, token):
        shared = await _member(db, 533, [org.id, other_org.id])
        with pytest.raises(HTTPException) as exc:
            await issue_embed_session(token, shared.id, db)
        assert exc.value.status_code == 403

    async def test_unknown_user(self, db, org, token):
        with pytest.raises(HTTPException) as exc:
            await issue_embed_session(token, 999_999, db)
        assert exc.value.status_code == 404
