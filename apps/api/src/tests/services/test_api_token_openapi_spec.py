"""Tests for src/services/api_tokens/openapi_spec.py."""

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from src.db.users import APITokenUser
from src.services.api_tokens import openapi_spec
from src.services.api_tokens.openapi_spec import (
    build_api_token_openapi_spec,
    get_api_token_openapi_spec,
)


def _ref(name: str) -> dict:
    return {"$ref": f"#/components/schemas/{name}"}


FULL_SPEC = {
    "openapi": "3.1.0",
    "info": {"title": "LearnHouse", "version": "1.4.3"},
    "paths": {
        "/api/v1/courses/{course_uuid}": {
            "get": {
                "tags": ["courses"],
                "responses": {"200": {"content": {"application/json": {"schema": _ref("CourseRead")}}}},
            },
            "parameters": [{"name": "course_uuid", "in": "path"}],
        },
        "/api/v1/usergroups/": {
            "post": {
                "tags": ["User Groups"],
                "requestBody": {"content": {"application/json": {"schema": _ref("UserGroupCreate")}}},
            },
        },
        "/api/v1/auth/login": {
            "post": {
                "tags": ["auth"],
                "requestBody": {"content": {"application/json": {"schema": _ref("LoginBody")}}},
            },
        },
        "/api/v1/untagged": {"get": {"responses": {}}},
    },
    "components": {
        "schemas": {
            "CourseRead": {"properties": {"authors": {"items": [_ref("AuthorRead")]}}},
            "AuthorRead": {"properties": {"user": _ref("UserRead")}},
            "UserRead": {"properties": {"author": _ref("AuthorRead")}},
            "UserGroupCreate": {"properties": {"missing": _ref("NotDefined")}},
            "LoginBody": {"properties": {"password": {"type": "string"}}},
        },
        "securitySchemes": {"internal": {"type": "http"}},
    },
}


class TestBuildApiTokenOpenapiSpec:
    def test_keeps_only_token_routes_and_their_schemas(self):
        spec = build_api_token_openapi_spec(FULL_SPEC)

        assert spec["info"] == FULL_SPEC["info"]
        assert set(spec["paths"]) == {
            "/api/v1/courses/{course_uuid}",
            "/api/v1/usergroups/",
        }
        # Path-level parameters are not operations.
        assert set(spec["paths"]["/api/v1/courses/{course_uuid}"]) == {"get"}
        # Refs are followed transitively, cycles included; unknown refs are skipped.
        assert spec["components"] == {
            "schemas": {
                "AuthorRead": FULL_SPEC["components"]["schemas"]["AuthorRead"],
                "CourseRead": FULL_SPEC["components"]["schemas"]["CourseRead"],
                "UserGroupCreate": FULL_SPEC["components"]["schemas"]["UserGroupCreate"],
                "UserRead": FULL_SPEC["components"]["schemas"]["UserRead"],
            }
        }

    def test_returns_a_copy(self):
        spec = build_api_token_openapi_spec(FULL_SPEC)
        spec["paths"]["/api/v1/usergroups/"]["post"]["tags"].append("mutated")

        assert FULL_SPEC["paths"]["/api/v1/usergroups/"]["post"]["tags"] == ["User Groups"]


class TestGetApiTokenOpenapiSpec:
    @pytest.fixture(autouse=True)
    def _reset_cache(self):
        openapi_spec._cached_spec = None
        yield
        openapi_spec._cached_spec = None

    @pytest.fixture
    def request_with_app(self):
        request = MagicMock()
        request.app.openapi.return_value = FULL_SPEC
        return request

    async def test_returns_filtered_spec_and_caches_it(self, db, org, admin_user, request_with_app):
        with patch(
            "src.services.api_tokens.openapi_spec.require_org_role_permission"
        ) as require_permission:
            first = await get_api_token_openapi_spec(request_with_app, db, org.id, admin_user)
            second = await get_api_token_openapi_spec(request_with_app, db, org.id, admin_user)

        assert "/api/v1/auth/login" not in first["paths"]
        assert second is first
        request_with_app.app.openapi.assert_called_once()
        require_permission.assert_awaited_with(admin_user.id, org.id, db, "roles", "action_read")

    async def test_missing_org(self, db, admin_user, request_with_app):
        with pytest.raises(HTTPException) as exc:
            await get_api_token_openapi_spec(request_with_app, db, 999, admin_user)

        assert exc.value.status_code == 404

    async def test_permission_denied(self, db, org, regular_user, request_with_app):
        with patch(
            "src.services.api_tokens.openapi_spec.require_org_role_permission",
            side_effect=HTTPException(status_code=403, detail="nope"),
        ):
            with pytest.raises(HTTPException) as exc:
                await get_api_token_openapi_spec(request_with_app, db, org.id, regular_user)

        assert exc.value.status_code == 403
        request_with_app.app.openapi.assert_not_called()

    async def test_anonymous_rejected(self, db, org, anonymous_user, request_with_app):
        with pytest.raises(HTTPException):
            await get_api_token_openapi_spec(request_with_app, db, org.id, anonymous_user)

    async def test_api_token_rejected(self, db, org, request_with_app):
        token_user = APITokenUser(org_id=org.id)

        with pytest.raises(HTTPException) as exc:
            await get_api_token_openapi_spec(request_with_app, db, org.id, token_user)

        assert exc.value.status_code == 403
