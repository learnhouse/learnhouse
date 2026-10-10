"""Admin API endpoints enforce the API token's rights buckets.

Passing the org boundary only decides which org a token reaches. What it may do
there is its ``rights``: a read-only integration token must not be able to
rewrite emails, change roles, anonymize members, mint sessions, enroll users,
award certificates or manage cohorts.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.roles import Permission
from src.db.usergroups import UserGroup
from src.db.users import APITokenUser, SuperadminAPITokenUser
from src.routers.admin import router as admin_router
from src.security.auth import get_current_user
from src.services.admin.admin import _require_token_right


BUCKETS = ("users", "roles", "courses", "certifications", "usergroups")
ORG = "test-org"
USER = 2  # conftest regular_user, an ordinary member of the org
COURSE = "course_test"  # conftest course


def _perm(**granted) -> dict:
    base = dict.fromkeys(
        ("action_create", "action_read", "action_update", "action_delete"), False
    )
    base.update(granted)
    return base


READ_ONLY_RIGHTS = {bucket: _perm(action_read=True) for bucket in BUCKETS}


def _rights_for(required) -> dict:
    """Read on every bucket, plus exactly the writes ``required`` lists."""
    rights = {bucket: _perm(action_read=True) for bucket in BUCKETS}
    for resource, action in required:
        rights[resource][f"action_{action}"] = True
    return rights


# (method, path, json body, rights the route requires)
WRITE_ROUTES = [
    ("POST", f"/{ORG}/auth/token", {"user_id": USER}, [("users", "update")]),
    ("POST", f"/{ORG}/auth/magic-link", {"user_id": USER}, [("users", "update")]),
    (
        "POST", f"/{ORG}/users",
        {"email": "new@example.com", "username": "newbie"},
        [("users", "create")],
    ),
    ("PATCH", f"/{ORG}/users/{USER}", {"email": "evil@example.com"}, [("users", "update")]),
    (
        "PATCH", f"/{ORG}/users/{USER}/role", {"role_id": 4},
        [("users", "update"), ("roles", "update")],
    ),
    ("DELETE", f"/{ORG}/users/{USER}", None, [("users", "delete")]),
    ("POST", f"/{ORG}/users/{USER}/anonymize", None, [("users", "delete")]),
    ("POST", f"/{ORG}/enrollments/{USER}/{COURSE}", None, [("courses", "update")]),
    ("DELETE", f"/{ORG}/enrollments/{USER}/{COURSE}", None, [("courses", "update")]),
    (
        "POST", f"/{ORG}/enrollments/bulk",
        {"course_uuid": COURSE, "user_ids": [USER]}, [("courses", "update")],
    ),
    (
        "POST", f"/{ORG}/enrollments/bulk/unenroll",
        {"course_uuid": COURSE, "user_ids": [USER]}, [("courses", "update")],
    ),
    (
        "POST", f"/{ORG}/progress/{USER}/activities/activity_x/complete", None,
        [("courses", "update")],
    ),
    (
        "DELETE", f"/{ORG}/progress/{USER}/activities/activity_x/complete", None,
        [("courses", "update")],
    ),
    ("POST", f"/{ORG}/progress/{USER}/{COURSE}/complete", None, [("courses", "update")]),
    ("POST", f"/{ORG}/progress/{USER}/{COURSE}/reset", None, [("courses", "update")]),
    (
        "POST", f"/{ORG}/certifications/{USER}/{COURSE}/award", None,
        [("certifications", "create")],
    ),
    (
        "DELETE", f"/{ORG}/certifications/{USER}/certuser_x", None,
        [("certifications", "delete")],
    ),
    ("POST", f"/{ORG}/usergroups", {"name": "Cohort"}, [("usergroups", "create")]),
    ("DELETE", f"/{ORG}/usergroups/ug_x", None, [("usergroups", "delete")]),
    ("POST", f"/{ORG}/usergroups/ug_x/members/{USER}", None, [("usergroups", "update")]),
    ("DELETE", f"/{ORG}/usergroups/ug_x/members/{USER}", None, [("usergroups", "update")]),
    ("POST", f"/{ORG}/usergroups/ug_x/courses/{COURSE}", None, [("usergroups", "update")]),
    ("DELETE", f"/{ORG}/usergroups/ug_x/courses/{COURSE}", None, [("usergroups", "update")]),
]

READ_ROUTES = [
    ("GET", f"/{ORG}/users/by-email/regular@test.com", [("users", "read")]),
    ("GET", f"/{ORG}/users/{USER}/export", [("users", "read")]),
    ("GET", f"/{ORG}/users/{USER}/groups", [("usergroups", "read")]),
    ("GET", f"/{ORG}/courses/{COURSE}/access/{USER}", [("courses", "read")]),
    ("GET", f"/{ORG}/courses/{COURSE}/enrollments", [("courses", "read")]),
    ("GET", f"/{ORG}/courses/{COURSE}/analytics", [("courses", "read")]),
    ("GET", f"/{ORG}/enrollments/{USER}", [("courses", "read")]),
    ("GET", f"/{ORG}/progress/{USER}", [("courses", "read")]),
    ("GET", f"/{ORG}/progress/{USER}/{COURSE}", [("courses", "read")]),
    ("GET", f"/{ORG}/trails/{USER}", [("courses", "read")]),
    ("GET", f"/{ORG}/trails/{USER}/courses/{COURSE}", [("courses", "read")]),
    ("GET", f"/{ORG}/certifications/{USER}", [("certifications", "read")]),
    ("GET", f"/{ORG}/usergroups/ug_x/members", [("usergroups", "read")]),
]

# Public browser endpoint: authenticates with the magic-link JWT, not a token.
UNTOKENED_ROUTES = {("GET", "/{org_slug}/auth/magic-consume")}


def _ids(routes):
    return [f"{r[0]} {r[1]}" for r in routes]


def _rights_denial(resp) -> bool:
    return resp.status_code == 403 and "permission for" in resp.json().get("detail", "")


@pytest.fixture
def token():
    return APITokenUser(
        id=42,
        user_uuid="apitoken_rights",
        username="api_token",
        org_id=1,
        rights=READ_ONLY_RIGHTS,
        token_name="Reporting",
        created_by_user_id=1,
    )


@pytest.fixture
async def client(db, org, regular_user, course, token):
    db.add(UserGroup(name="Cohort X", description="", org_id=org.id, usergroup_uuid="ug_x"))
    await db.commit()

    app = FastAPI()
    app.include_router(admin_router, prefix="/api/v1/admin")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: token
    with patch("src.services.admin.admin.get_org_plan", new=AsyncMock(return_value="pro")), \
            patch(
                "src.services.security.rate_limiting.check_admin_user_lookup_rate_limit",
                return_value=(True, 0),
            ), \
            patch(
                "src.services.security.rate_limiting.check_admin_user_provision_rate_limit",
                return_value=(True, 0),
            ), \
            patch("src.services.admin.admin.dispatch_webhooks"), \
            patch("src.services.admin.admin.track"), \
            patch("src.services.admin.admin.check_limits_with_usage", new=AsyncMock()):
        async with AsyncClient(
            # A later failure past the gate surfaces as a 500, not an exception.
            transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test/api/v1/admin"
        ) as c:
            yield c


class TestReadOnlyTokenCannotWrite:
    @pytest.mark.parametrize("method,path,body,required", WRITE_ROUTES, ids=_ids(WRITE_ROUTES))
    async def test_write_route_is_refused(self, client, method, path, body, required):
        resp = await client.request(method, path, json=body)

        assert resp.status_code == 403, resp.text
        resource, action = next(r for r in required if r[1] != "read")
        assert resp.json()["detail"] == (
            f"API token does not have '{action}' permission for {resource}"
        )

    @pytest.mark.parametrize("method,path,required", READ_ROUTES, ids=_ids(READ_ROUTES))
    async def test_read_route_is_allowed(self, client, method, path, required):
        resp = await client.request(method, path)

        assert resp.status_code == 200, resp.text


class TestMatchingRightsPassTheGate:
    @pytest.mark.parametrize("method,path,body,required", WRITE_ROUTES, ids=_ids(WRITE_ROUTES))
    async def test_required_rights_clear_the_rights_check(
        self, client, token, method, path, body, required
    ):
        token.rights = _rights_for(required)

        resp = await client.request(method, path, json=body)

        # Later checks (missing fixtures, privileged targets) may still refuse,
        # but never the rights gate.
        assert not _rights_denial(resp), resp.text

    @pytest.mark.parametrize("method,path,required", READ_ROUTES, ids=_ids(READ_ROUTES))
    async def test_read_route_without_its_bucket_is_refused(
        self, client, token, method, path, required
    ):
        rights = _rights_for([])
        for resource, _ in required:
            rights[resource] = _perm()
        token.rights = rights

        resp = await client.request(method, path)

        assert _rights_denial(resp), resp.text

    async def test_create_usergroup_succeeds_with_usergroups_create(self, client, token):
        token.rights = _rights_for([("usergroups", "create")])

        resp = await client.post(f"/{ORG}/usergroups", json={"name": "Cohort"})

        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == "Cohort"

    async def test_role_change_needs_roles_update_too(self, client, token):
        token.rights = _rights_for([("users", "update")])

        resp = await client.patch(f"/{ORG}/users/{USER}/role", json={"role_id": 4})

        assert resp.status_code == 403
        assert resp.json()["detail"] == "API token does not have 'update' permission for roles"


def test_every_tokened_admin_route_is_covered():
    """A new admin route must be added to this matrix (and gated)."""
    declared = {
        (next(iter(r.methods)), r.path)
        for r in admin_router.routes
        if isinstance(r, APIRoute)
    } - UNTOKENED_ROUTES

    covered = set()
    for method, path, *_ in WRITE_ROUTES + READ_ROUTES:
        for r in admin_router.routes:
            if isinstance(r, APIRoute) and method in r.methods and r.path_regex.match(path):
                covered.add((method, r.path))
                break
    assert declared - covered == set()


class TestRequireTokenRightHelper:
    def _tok(self, rights):
        return APITokenUser(id=1, org_id=1, rights=rights, created_by_user_id=1)

    def test_dict_rights(self):
        _require_token_right(self._tok({"users": _perm(action_update=True)}), "users", "update")

    def test_model_rights(self):
        class _Rights:
            users = Permission(**_perm(action_delete=True))

        tok = self._tok(None)
        tok.rights = _Rights()
        _require_token_right(tok, "users", "delete")
        with pytest.raises(HTTPException) as exc:
            _require_token_right(tok, "users", "update")
        assert exc.value.status_code == 403

    @pytest.mark.parametrize(
        "rights",
        [None, {}, {"users": None}, {"users": {}}, {"users": {"action_update": "true"}}],
        ids=["none", "empty", "null-bucket", "empty-bucket", "truthy-string"],
    )
    def test_missing_or_non_boolean_grant_is_denied(self, rights):
        with pytest.raises(HTTPException) as exc:
            _require_token_right(self._tok(rights), "users", "update")
        assert exc.value.status_code == 403

    def test_superadmin_token_keeps_full_access(self):
        _require_token_right(SuperadminAPITokenUser(id=1), "users", "delete")

    def test_unknown_action_is_a_programming_error(self):
        with pytest.raises(ValueError):
            _require_token_right(self._tok(READ_ONLY_RIGHTS), "users", "write")
