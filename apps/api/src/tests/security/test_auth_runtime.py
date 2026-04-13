from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException, Request
from sqlmodel import Session

from src.db.users import APITokenUser, AnonymousUser, PublicUser
from src.security.auth import (
    create_access_token,
    decode_jwt,
    get_authenticated_user,
    get_current_user,
    _verify_api_token_org_boundary,
    validate_api_token,
)


def _mock_request(auth_header: str = "", cookies: dict | None = None, path_params: dict | None = None):
    request = Mock(spec=Request)
    request.headers = Mock()
    request.headers.get = Mock(return_value=auth_header)
    request.cookies = cookies or {}
    request.path_params = path_params or {}
    request.state = SimpleNamespace()
    return request


def _make_api_token_user(org_id: int = 7, rights: dict | None = None) -> APITokenUser:
    return APITokenUser(
        id=11,
        user_uuid="apitoken_11",
        username="api_token_test",
        org_id=org_id,
        rights=rights,
        token_name="Test Token",
        created_by_user_id=22,
    )


def _make_api_token_record(org_id: int = 7, rights: dict | object | None = None):
    return SimpleNamespace(
        id=11,
        token_uuid="token_uuid_11",
        name="Test Token",
        org_id=org_id,
        rights=rights,
        created_by_user_id=22,
    )


def _required_rights() -> dict:
    return {
        "courses": {},
        "activities": {},
        "coursechapters": {},
        "collections": {},
        "certifications": {},
        "usergroups": {},
        "payments": {},
        "search": {},
    }


class _ModelDumpOnly:
    def model_dump(self):
        return {"model_dump": True}


class _DictOnly:
    def dict(self):
        return {"dict": True}


class _RawRightsDictOnly:
    def dict(self):
        return _required_rights()


class TestAuthRuntime:
    def test_decode_jwt_valid_token(self):
        token = create_access_token({"sub": "runtime@example.com"})

        payload = decode_jwt(token)

        assert payload is not None
        assert payload["sub"] == "runtime@example.com"
        assert "exp" in payload

    def test_decode_jwt_invalid_token(self):
        assert decode_jwt("not-a-token") is None

    @pytest.mark.asyncio
    async def test_get_current_user_api_token_success(self):
        request = _mock_request(auth_header="Bearer lh_test_token")
        db_session = Mock(spec=Session)
        api_token_record = _make_api_token_record(
            rights={
                "courses": _ModelDumpOnly(),
                "activities": _DictOnly(),
                "coursechapters": "plain",
                "collections": 1,
                "certifications": None,
                "usergroups": True,
                "payments": False,
                "search": ["query"],
            }
        )

        with patch("src.services.api_tokens.api_tokens.validate_api_token_for_auth", new=AsyncMock(return_value=api_token_record)) as mock_validate, patch(
            "src.security.auth._verify_api_token_org_boundary",
            new=AsyncMock(),
        ) as mock_boundary:
            result = await get_current_user(request=request, db_session=db_session)

        assert result.username == "api_token_Test Token"
        assert request.state.user == result
        assert request.state.is_api_token is True
        mock_validate.assert_awaited_once_with("lh_test_token", db_session)
        mock_boundary.assert_awaited_once()
        assert result.rights["courses"] == {"model_dump": True}
        assert result.rights["activities"] == {"dict": True}
        assert result.rights["coursechapters"] == "plain"
        assert result.rights["collections"] == 1

    @pytest.mark.asyncio
    async def test_get_current_user_api_token_rejected_when_invalid(self):
        request = _mock_request(auth_header="Bearer lh_invalid")
        db_session = Mock(spec=Session)

        with patch("src.services.api_tokens.api_tokens.validate_api_token_for_auth", new=AsyncMock(return_value=None)):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(request=request, db_session=db_session)

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Could not validate credentials"

    @pytest.mark.asyncio
    async def test_get_authenticated_user_rejects_anonymous(self):
        request = _mock_request()

        with patch("src.security.auth.get_current_user", new=AsyncMock(return_value=AnonymousUser())):
            with pytest.raises(HTTPException) as exc_info:
                await get_authenticated_user(request=request, db_session=Mock(spec=Session))

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Authentication required"

    @pytest.mark.asyncio
    async def test_get_authenticated_user_returns_authenticated_user(self):
        request = _mock_request()
        public_user = PublicUser(
            id=1,
            email="test@example.com",
            username="testuser",
            first_name="Test",
            last_name="User",
            user_uuid="user_1",
        )

        with patch("src.security.auth.get_current_user", new=AsyncMock(return_value=public_user)):
            result = await get_authenticated_user(request=request, db_session=Mock(spec=Session))

        assert result == public_user
        assert isinstance(result, PublicUser)

    @pytest.mark.asyncio
    async def test_validate_api_token_returns_none_when_service_rejects(self):
        db_session = Mock(spec=Session)

        with patch("src.services.api_tokens.api_tokens.validate_api_token_for_auth", new=AsyncMock(return_value=None)):
            result = await validate_api_token("lh_invalid", db_session)

        assert result is None

    @pytest.mark.asyncio
    async def test_validate_api_token_preserves_none_rights(self):
        db_session = Mock(spec=Session)
        api_token = _make_api_token_record(rights=None)

        with patch("src.services.api_tokens.api_tokens.validate_api_token_for_auth", new=AsyncMock(return_value=api_token)):
            result = await validate_api_token("lh_valid", db_session)

        assert result is not None
        assert result.rights is None

    @pytest.mark.asyncio
    async def test_validate_api_token_normalizes_plain_dict_rights(self):
        db_session = Mock(spec=Session)
        api_token = _make_api_token_record(
            rights={
                "courses": _ModelDumpOnly(),
                "activities": _DictOnly(),
                "coursechapters": 9,
                "collections": "value",
                "certifications": None,
                "usergroups": True,
                "payments": False,
                "search": [],
            }
        )

        with patch("src.services.api_tokens.api_tokens.validate_api_token_for_auth", new=AsyncMock(return_value=api_token)):
            result = await validate_api_token("lh_valid", db_session)

        assert result is not None
        assert result.username == "api_token_Test Token"
        assert result.rights["courses"] == {"model_dump": True}
        assert result.rights["activities"] == {"dict": True}
        assert result.rights["coursechapters"] == 9
        assert result.rights["collections"] == "value"
        assert result.token_name == "Test Token"
        assert result.created_by_user_id == 22

    @pytest.mark.asyncio
    async def test_validate_api_token_preserves_nested_dict_rights(self):
        db_session = Mock(spec=Session)
        api_token = _make_api_token_record(
            rights={
                "courses": {"scope": "read"},
                "activities": {},
                "coursechapters": {"scope": "write"},
                "collections": {},
                "certifications": {},
                "usergroups": {},
                "payments": {},
                "search": {},
            }
        )

        with patch("src.services.api_tokens.api_tokens.validate_api_token_for_auth", new=AsyncMock(return_value=api_token)):
            result = await validate_api_token("lh_valid", db_session)

        assert result is not None
        assert result.rights["courses"] == {"scope": "read"}
        assert result.rights["coursechapters"] == {"scope": "write"}

    @pytest.mark.asyncio
    async def test_validate_api_token_normalizes_model_rights(self):
        db_session = Mock(spec=Session)
        api_token = _make_api_token_record(rights=_RawRightsDictOnly())

        with patch("src.services.api_tokens.api_tokens.validate_api_token_for_auth", new=AsyncMock(return_value=api_token)):
            result = await validate_api_token("lh_valid", db_session)

        assert result is not None
        assert result.rights == _required_rights()

    @pytest.mark.asyncio
    async def test_verify_api_token_org_boundary_org_id_mismatch(self):
        request = _mock_request(path_params={"org_id": "99"})
        api_token_user = _make_api_token_user(org_id=7)
        db_session = Mock(spec=Session)

        with pytest.raises(HTTPException) as exc_info:
            await _verify_api_token_org_boundary(request, api_token_user, db_session)

        assert exc_info.value.status_code == 403
        assert "outside its organization" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_verify_api_token_org_boundary_org_slug_mismatch(self):
        request = _mock_request(path_params={"org_slug": "acme"})
        api_token_user = _make_api_token_user(org_id=7)
        org = Mock()
        org.id = 13
        exec_result = Mock()
        exec_result.first.return_value = org
        db_session = Mock(spec=Session)
        db_session.exec.return_value = exec_result

        with pytest.raises(HTTPException) as exc_info:
            await _verify_api_token_org_boundary(request, api_token_user, db_session)

        assert exc_info.value.status_code == 403
        assert "outside its organization" in exc_info.value.detail
        db_session.exec.assert_called_once()

    @pytest.mark.asyncio
    async def test_verify_api_token_org_boundary_allows_non_matching_org_id_strings(self):
        request = _mock_request(path_params={"org_id": "not-an-int"})
        api_token_user = _make_api_token_user(org_id=7)
        db_session = Mock(spec=Session)

        await _verify_api_token_org_boundary(request, api_token_user, db_session)

    @pytest.mark.asyncio
    async def test_verify_api_token_org_boundary_allows_matching_org_slug(self):
        request = _mock_request(path_params={"org_slug": "acme"})
        api_token_user = _make_api_token_user(org_id=7)
        org = Mock()
        org.id = 7
        exec_result = Mock()
        exec_result.first.return_value = org
        db_session = Mock(spec=Session)
        db_session.exec.return_value = exec_result

        await _verify_api_token_org_boundary(request, api_token_user, db_session)

        db_session.exec.assert_called_once()
