# ruff: noqa: E402
"""Tests for the backoffice API token auth path.

Covers the new ``lh_sa_`` branch in ``get_current_user``, the
``require_backoffice`` extension that accepts ``BackofficeAPITokenUser``
(while re-checking the minting user's ``is_backoffice_staff``), and the
``reject_any_api_token`` dependency that blocks token-creates-token.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

# These tests exercise EE-only code paths (the `ee/` package). OSS builds
# strip that directory, so the whole module would fail to import and
# bring pytest collection down with it. Skip the whole module instead.
ee_backoffice_tokens = pytest.importorskip(
    "ee.routers.backoffice_tokens",
    reason="EE module not available in this build",
)

from fastapi import HTTPException, Request
from sqlmodel import Session

from src.db.users import AnonymousUser, APITokenUser, PublicUser, BackofficeAPITokenUser
from src.security.auth import get_current_user, validate_backoffice_api_token
from src.security.backoffice import require_backoffice

reject_any_api_token = ee_backoffice_tokens.reject_any_api_token


@pytest.fixture(autouse=True)
def _enterprise_mode(monkeypatch):
    """Run these as an Enterprise deployment, which is what they describe.

    conftest pins LEARNHOUSE_DISABLE_EE=1 for the whole suite, so
    get_deployment_mode() answers 'oss' and require_backoffice refuses with
    403 ee_required before any of the token logic below is reached. The module
    still imported (importorskip only asks whether the ee/ package is on disk),
    so on a checkout that has it every test here failed on the gate rather than
    on what it was written to check.

    Patching the definition rather than an importer is deliberate:
    src/security/backoffice.py imports the function inside the call, so this
    reaches it.
    """
    import src.core.deployment_mode as deployment_mode

    monkeypatch.setattr(deployment_mode, "get_deployment_mode", lambda: "ee")


@pytest.fixture
def _creator_is_backoffice_staff():
    """The token path re-checks that its minter is still a backoffice staff member
    (src/security/auth.py::validate_backoffice_api_token). These tests use a
    bare Mock session, so answer that check here."""
    with patch("src.security.backoffice.is_user_backoffice_staff", new=AsyncMock(return_value=True)) as m:
        yield m


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


@pytest.mark.usefixtures("_creator_is_backoffice_staff")
class TestAuthDispatch:
    """get_current_user must route lh_sa_ to the backoffice staff member branch BEFORE the lh_ branch."""

    async def test_lh_sa_token_returns_backoffice_principal(self):
        request = _mock_request(auth_header="Bearer lh_sa_validvalue")
        db = Mock(spec=Session)

        with patch(
            "src.services.api_tokens.backoffice_api_tokens.validate_backoffice_token_for_auth",
            new=AsyncMock(return_value=_sa_token_record()),
        ):
            result = await get_current_user(request=request, db_session=db)

        assert isinstance(result, BackofficeAPITokenUser)
        assert result.created_by_user_id == 7
        assert result.token_name == "agency-test"
        assert request.state.is_backoffice_api_token is True

    async def test_lh_sa_skips_org_boundary_check(self):
        """Backoffice tokens are cross-org by design, so the boundary check must NOT run."""
        request = _mock_request(auth_header="Bearer lh_sa_validvalue")
        db = Mock(spec=Session)

        with patch(
            "src.services.api_tokens.backoffice_api_tokens.validate_backoffice_token_for_auth",
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
            "src.services.api_tokens.backoffice_api_tokens.validate_backoffice_token_for_auth",
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
            "src.services.api_tokens.backoffice_api_tokens.validate_backoffice_token_for_auth",
            new=AsyncMock(return_value=None),
        ) as sa_validator:
            result = await get_current_user(request=request, db_session=db)

        sa_validator.assert_not_awaited()  # SA branch never inspects an lh_ token
        boundary.assert_awaited_once()
        assert isinstance(result, APITokenUser)
        assert result.org_id == 5


@pytest.mark.usefixtures("_creator_is_backoffice_staff")
class TestValidateBackofficeApiToken:
    async def test_returns_principal_when_record_valid(self):
        db = Mock(spec=Session)
        with patch(
            "src.services.api_tokens.backoffice_api_tokens.validate_backoffice_token_for_auth",
            new=AsyncMock(return_value=_sa_token_record(token_id=99, created_by=12)),
        ):
            result = await validate_backoffice_api_token("lh_sa_x", db)
        assert isinstance(result, BackofficeAPITokenUser)
        assert result.id == 99
        assert result.created_by_user_id == 12

    async def test_returns_none_when_record_missing(self):
        db = Mock(spec=Session)
        with patch(
            "src.services.api_tokens.backoffice_api_tokens.validate_backoffice_token_for_auth",
            new=AsyncMock(return_value=None),
        ):
            assert await validate_backoffice_api_token("lh_sa_x", db) is None

    async def test_returns_none_when_creator_demoted(self, _creator_is_backoffice_staff):
        _creator_is_backoffice_staff.return_value = False
        db = Mock(spec=Session)
        with patch(
            "src.services.api_tokens.backoffice_api_tokens.validate_backoffice_token_for_auth",
            new=AsyncMock(return_value=_sa_token_record(created_by=12)),
        ):
            assert await validate_backoffice_api_token("lh_sa_x", db) is None


class TestRequireBackofficeWithTokenPrincipal:
    async def test_accepts_backoffice_token_when_creator_is_still_backoffice(self):
        principal = BackofficeAPITokenUser(
            id=1, user_uuid="satoken_1", token_name="t", created_by_user_id=42
        )
        with patch(
            "src.security.backoffice.is_user_backoffice_staff",
            new=AsyncMock(return_value=True),
        ) as check:
            result = await require_backoffice(current_user=principal, db_session=Mock())

        assert result is principal
        check.assert_awaited_once_with(42, check.call_args.args[1])

    async def test_rejects_backoffice_token_when_creator_demoted(self):
        principal = BackofficeAPITokenUser(
            id=1, user_uuid="satoken_1", token_name="t", created_by_user_id=42
        )
        with patch(
            "src.security.backoffice.is_user_backoffice_staff",
            new=AsyncMock(return_value=False),
        ):
            with pytest.raises(HTTPException) as exc:
                await require_backoffice(current_user=principal, db_session=Mock())

        assert exc.value.status_code == 403
        assert "no longer a backoffice staff member" in exc.value.detail.lower()

    async def test_rejects_org_token_even_if_creator_is_backoffice_staff(self):
        org_token = APITokenUser(
            id=1, user_uuid="apitoken_1", org_id=5, token_name="t", created_by_user_id=42,
        )
        # Even if we'd check is_user_backoffice_staff, an org token shouldn't get to that path.
        with patch(
            "src.security.backoffice.is_user_backoffice_staff",
            new=AsyncMock(return_value=True),
        ) as check:
            with pytest.raises(HTTPException) as exc:
                await require_backoffice(current_user=org_token, db_session=Mock())

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

    async def test_rejects_backoffice_token(self):
        sa = BackofficeAPITokenUser(
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
