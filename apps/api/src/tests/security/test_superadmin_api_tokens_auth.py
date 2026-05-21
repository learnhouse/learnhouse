# ruff: noqa: E402
"""Tests for the superadmin API token auth path.

Covers the new ``lh_sa_`` branch in ``get_current_user``, the
``require_superadmin`` extension that accepts ``SuperadminAPITokenUser``
(while re-checking the minting user's ``is_superadmin``), and the
``reject_any_api_token`` dependency that blocks token-creates-token.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

# These tests exercise EE-only code paths (the `ee/` package). OSS builds
# strip that directory, so the whole module would fail to import and
# bring pytest collection down with it. Skip the whole module instead.
ee_superadmin_tokens = pytest.importorskip(
    "ee.routers.superadmin_tokens",
    reason="EE module not available in this build",
)

from fastapi import HTTPException, Request
from sqlmodel import Session

from src.db.users import AnonymousUser, APITokenUser, PublicUser, SuperadminAPITokenUser
from src.security.auth import get_current_user, validate_superadmin_api_token
from src.security.superadmin import require_superadmin

reject_any_api_token = ee_superadmin_tokens.reject_any_api_token


def _mock_request(auth_header: str = ""):
    request = Mock(spec=Request)
    request.headers = Mock()
    request.headers.get = Mock(return_value=auth_header)
    request.cookies = {}
    request.path_params = {}
    request.state = SimpleNamespace()
    return request


def _sa_token_record(token_id=42, name="agency-test", created_by=7):
    return SimpleNamespace(
        id=token_id,
        token_uuid=f"satoken_{token_id}",
        name=name,
        created_by_user_id=created_by,
    )


class TestAuthDispatch:
    """get_current_user must route lh_sa_ to the superadmin branch BEFORE the lh_ branch."""

    async def test_lh_sa_token_returns_superadmin_principal(self):
        request = _mock_request(auth_header="Bearer lh_sa_validvalue")
        db = Mock(spec=Session)

        with patch(
            "src.services.api_tokens.superadmin_api_tokens.validate_superadmin_token_for_auth",
            new=AsyncMock(return_value=_sa_token_record()),
        ):
            result = await get_current_user(request=request, db_session=db)

        assert isinstance(result, SuperadminAPITokenUser)
        assert result.created_by_user_id == 7
        assert result.token_name == "agency-test"
        assert request.state.is_superadmin_api_token is True

    async def test_lh_sa_skips_org_boundary_check(self):
        """Superadmin tokens are cross-org by design — boundary check must NOT run."""
        request = _mock_request(auth_header="Bearer lh_sa_validvalue")
        db = Mock(spec=Session)

        with patch(
            "src.services.api_tokens.superadmin_api_tokens.validate_superadmin_token_for_auth",
            new=AsyncMock(return_value=_sa_token_record()),
        ), patch(
            "src.security.auth._verify_api_token_org_boundary",
            new=AsyncMock(),
        ) as boundary:
            await get_current_user(request=request, db_session=db)

        boundary.assert_not_awaited()

    async def test_invalid_lh_sa_token_raises_401(self):
        request = _mock_request(auth_header="Bearer lh_sa_invalid")
        db = Mock(spec=Session)

        with patch(
            "src.services.api_tokens.superadmin_api_tokens.validate_superadmin_token_for_auth",
            new=AsyncMock(return_value=None),
        ):
            with pytest.raises(HTTPException) as exc:
                await get_current_user(request=request, db_session=db)

        assert exc.value.status_code == 401

    async def test_regular_lh_token_still_hits_org_branch(self):
        """Regression: a regular lh_ (org-scoped) token must NOT be routed to the SA branch."""
        request = _mock_request(auth_header="Bearer lh_orgvalue")
        db = Mock(spec=Session)

        org_token = SimpleNamespace(
            id=11,
            token_uuid="apitoken_11",
            name="Org Token",
            org_id=5,
            rights=None,
            created_by_user_id=3,
        )
        with patch(
            "src.services.api_tokens.api_tokens.validate_api_token_for_auth",
            new=AsyncMock(return_value=org_token),
        ), patch(
            "src.security.auth._verify_api_token_org_boundary",
            new=AsyncMock(),
        ) as boundary, patch(
            "src.services.api_tokens.superadmin_api_tokens.validate_superadmin_token_for_auth",
            new=AsyncMock(return_value=None),
        ) as sa_validator:
            result = await get_current_user(request=request, db_session=db)

        sa_validator.assert_not_awaited()  # SA branch never inspects an lh_ token
        boundary.assert_awaited_once()
        assert isinstance(result, APITokenUser)
        assert result.org_id == 5


class TestValidateSuperadminApiToken:
    async def test_returns_principal_when_record_valid(self):
        db = Mock(spec=Session)
        with patch(
            "src.services.api_tokens.superadmin_api_tokens.validate_superadmin_token_for_auth",
            new=AsyncMock(return_value=_sa_token_record(token_id=99, created_by=12)),
        ):
            result = await validate_superadmin_api_token("lh_sa_x", db)
        assert isinstance(result, SuperadminAPITokenUser)
        assert result.id == 99
        assert result.created_by_user_id == 12

    async def test_returns_none_when_record_missing(self):
        db = Mock(spec=Session)
        with patch(
            "src.services.api_tokens.superadmin_api_tokens.validate_superadmin_token_for_auth",
            new=AsyncMock(return_value=None),
        ):
            assert await validate_superadmin_api_token("lh_sa_x", db) is None


class TestRequireSuperadminWithTokenPrincipal:
    async def test_accepts_superadmin_token_when_creator_is_still_superadmin(self):
        principal = SuperadminAPITokenUser(
            id=1, user_uuid="satoken_1", token_name="t", created_by_user_id=42
        )
        with patch(
            "src.security.superadmin.is_user_superadmin",
            new=AsyncMock(return_value=True),
        ) as check:
            result = await require_superadmin(current_user=principal, db_session=Mock())

        assert result is principal
        check.assert_awaited_once_with(42, check.call_args.args[1])

    async def test_rejects_superadmin_token_when_creator_demoted(self):
        principal = SuperadminAPITokenUser(
            id=1, user_uuid="satoken_1", token_name="t", created_by_user_id=42
        )
        with patch(
            "src.security.superadmin.is_user_superadmin",
            new=AsyncMock(return_value=False),
        ):
            with pytest.raises(HTTPException) as exc:
                await require_superadmin(current_user=principal, db_session=Mock())

        assert exc.value.status_code == 403
        assert "no longer a superadmin" in exc.value.detail.lower()

    async def test_rejects_org_token_even_if_creator_is_superadmin(self):
        org_token = APITokenUser(
            id=1, user_uuid="apitoken_1", org_id=5, token_name="t", created_by_user_id=42,
        )
        # Even if we'd check is_user_superadmin, an org token shouldn't get to that path.
        with patch(
            "src.security.superadmin.is_user_superadmin",
            new=AsyncMock(return_value=True),
        ) as check:
            with pytest.raises(HTTPException) as exc:
                await require_superadmin(current_user=org_token, db_session=Mock())

        assert exc.value.status_code == 403
        check.assert_not_called()


class TestRejectAnyApiToken:
    async def test_rejects_org_token(self):
        org_token = APITokenUser(
            id=1, user_uuid="apitoken_1", org_id=5, token_name="t", created_by_user_id=42,
        )
        with pytest.raises(HTTPException) as exc:
            await reject_any_api_token(user=org_token)
        assert exc.value.status_code == 403

    async def test_rejects_superadmin_token(self):
        sa = SuperadminAPITokenUser(
            id=1, user_uuid="satoken_1", token_name="t", created_by_user_id=42,
        )
        with pytest.raises(HTTPException) as exc:
            await reject_any_api_token(user=sa)
        assert exc.value.status_code == 403

    async def test_allows_public_user(self):
        user = PublicUser(
            id=1, username="u", first_name="U", last_name="U",
            email="u@u.com", user_uuid="user_u",
        )
        result = await reject_any_api_token(user=user)
        assert result is user

    async def test_allows_anonymous_user(self):
        anon = AnonymousUser()
        result = await reject_any_api_token(user=anon)
        assert result is anon
