"""Tests for src/services/auth/utils.py."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from src.db.users import User
from src.services.auth.utils import get_google_user_info, signWithGoogle


class TestAuthUtilsService:
    @pytest.mark.asyncio
    async def test_get_google_user_info_success_and_failure(self):
        response = Mock(status_code=200)
        response.json.return_value = {"email": "google@test.com"}

        with patch("src.services.auth.utils.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=response
            )
            result = await get_google_user_info("access-token")

        assert result == {"email": "google@test.com"}
        mock_client.return_value.__aenter__.return_value.get.assert_awaited_once_with(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": "Bearer access-token"},
        )

        error_response = Mock(status_code=403)
        with patch("src.services.auth.utils.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=error_response
            )
            with pytest.raises(HTTPException) as exc_info:
                await get_google_user_info("bad-token")

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == "Failed to fetch user info from Google"

    @pytest.mark.asyncio
    async def test_sign_with_google_creates_user_with_and_without_org(
        self,
    ):
        request = Mock(spec=Request)
        current_user = Mock()
        db_session = Mock()
        db_session.exec.return_value.first.return_value = None

        without_org_result = SimpleNamespace(user_uuid="created-without-org")
        # After the F-03 fix, ``signWithGoogle`` no longer trusts the
        # body-supplied email as a fallback. Google must return a verified
        # email for the flow to proceed; the username-prefix fallback still
        # applies when ``given_name``/``family_name`` are missing from the
        # Google userinfo response.
        with patch(
            "src.services.auth.utils.get_google_user_info",
            return_value={
                "email": "fallback@test.com",
                "email_verified": True,
            },
        ), patch(
            "src.services.auth.utils.create_user_without_org",
            new_callable=AsyncMock,
            return_value=without_org_result,
        ) as mock_create_without_org, patch(
            "src.services.auth.utils.random.randint",
            return_value=42,
        ):
            result = await signWithGoogle(
                request=request,
                access_token="access-token",
                email="ignored@body.com",
                org_id=None,
                current_user=current_user,
                db_session=db_session,
            )

        assert result is without_org_result
        mock_create_without_org.assert_awaited_once()
        created_user = mock_create_without_org.call_args.args[3]
        # Server must key off Google's email, never the body-supplied one.
        assert created_user.email == "fallback@test.com"
        assert created_user.username == "fallback42"
        assert created_user.first_name == ""
        assert created_user.last_name == ""
        assert created_user.avatar_image == ""

        org_result = SimpleNamespace(user_uuid="created-with-org")
        with patch(
            "src.services.auth.utils.get_google_user_info",
            return_value={
                "email": "google@test.com",
                "email_verified": True,
                "given_name": "Ada",
                "family_name": "Lovelace",
                "picture": "https://example.com/avatar.png",
            },
        ), patch(
            "src.services.auth.utils.create_user",
            new_callable=AsyncMock,
            return_value=org_result,
        ) as mock_create_with_org, patch(
            "src.services.auth.utils.random.randint",
            return_value=42,
        ):
            result = await signWithGoogle(
                request=request,
                access_token="access-token",
                email="fallback@test.com",
                org_id=10,
                current_user=current_user,
                db_session=db_session,
            )

        assert result is org_result
        mock_create_with_org.assert_awaited_once()
        created_user = mock_create_with_org.call_args.args[3]
        assert created_user.email == "google@test.com"
        assert created_user.username == "AdaLovelace42"
        assert created_user.first_name == "Ada"
        assert created_user.last_name == "Lovelace"
        assert created_user.avatar_image == "https://example.com/avatar.png"

    @pytest.mark.asyncio
    async def test_sign_with_google_existing_user_updates_and_logs_in(
        self,
    ):
        request = Mock(spec=Request)
        request.client = SimpleNamespace(host="10.0.0.7")
        current_user = Mock()
        user = User(
            id=1,
            username="existing",
            first_name="Existing",
            last_name="User",
            email="existing@test.com",
            password="hashed",
            user_uuid="user_existing",
            email_verified=False,
            signup_method=None,
            creation_date=str(datetime.now(timezone.utc)),
            update_date=str(datetime.now(timezone.utc)),
        )
        db_session = Mock()
        db_session.exec.return_value.first.return_value = user

        with patch(
            "src.services.auth.utils.get_google_user_info",
            return_value={"email": "existing@test.com", "email_verified": True},
        ), patch(
            "src.services.auth.utils.get_client_ip",
            return_value="10.0.0.7",
        ), patch("src.services.auth.utils.update_login_info") as mock_update_login:
            result = await signWithGoogle(
                request=request,
                access_token="access-token",
                email="fallback@test.com",
                org_id=None,
                current_user=current_user,
                db_session=db_session,
            )

        assert result.email == "existing@test.com"
        assert user.email_verified is True
        assert user.signup_method == "google"
        db_session.add.assert_called_once_with(user)
        db_session.commit.assert_called_once()
        db_session.refresh.assert_called_once_with(user)
        mock_update_login.assert_called_once_with(user, "10.0.0.7", db_session)

    @pytest.mark.asyncio
    async def test_sign_with_google_username_fallback_to_user(self):
        """Covers line 76 — username_parts.append('user') when name parts are absent
        and the email has no '@', so the prefix-based branch is also skipped."""
        request = Mock(spec=Request)
        current_user = Mock()
        db_session = Mock()
        db_session.exec.return_value.first.return_value = None

        created_result = SimpleNamespace(user_uuid="created-fallback")
        fake_user_obj = Mock()
        fake_user_obj.username = None  # will be set by the code under test

        with patch(
            "src.services.auth.utils.get_google_user_info",
            # given_name / family_name absent; email has no '@' so prefix branch skipped
            return_value={"email": "noemail", "email_verified": True},
        ), patch(
            "src.services.auth.utils.UserCreate",
            side_effect=lambda **kw: SimpleNamespace(**kw),
        ), patch(
            "src.services.auth.utils.create_user_without_org",
            new_callable=AsyncMock,
            return_value=created_result,
        ) as mock_create, patch(
            "src.services.auth.utils.random.randint",
            return_value=7,
        ):
            result = await signWithGoogle(
                request=request,
                access_token="access-token",
                email="fallback@test.com",
                org_id=None,
                current_user=current_user,
                db_session=db_session,
            )

        assert result is created_result
        created_user = mock_create.call_args.args[3]
        # username must start with "user" (the default fallback) followed by randint
        assert created_user.username == "user7"

    @pytest.mark.asyncio
    async def test_sign_with_google_missing_email_raises(self):
        request = Mock(spec=Request)
        db_session = Mock()
        current_user = Mock()

        with patch(
            "src.services.auth.utils.get_google_user_info",
            return_value={},
        ):
            with pytest.raises(HTTPException) as exc_info:
                await signWithGoogle(
                    request=request,
                    access_token="access-token",
                    email="",
                    org_id=None,
                    current_user=current_user,
                    db_session=db_session,
                )

        # After the F-03 fix, a missing or unverified Google email is a 401
        # (authentication failure) rather than a 400 (malformed request) — the
        # attacker cannot compensate for it by tweaking their request body.
        assert exc_info.value.status_code == 401
        assert "verified email" in exc_info.value.detail.lower()
