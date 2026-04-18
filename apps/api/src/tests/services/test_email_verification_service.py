"""Tests for src/services/users/email_verification.py."""

import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.users import User
from src.services.users.email_verification import (
    NO_ORG_UUID,
    TOKEN_TTL_SECONDS,
    generate_verification_token,
    get_redis_connection,
    invalidate_verification_tokens,
    resend_verification_email,
    send_verification_email,
    verify_email_token,
)


def _make_user(db, **overrides):
    user = User(
        id=overrides.pop("id", None),
        username=overrides.pop("username", "user"),
        first_name=overrides.pop("first_name", "User"),
        last_name=overrides.pop("last_name", "Test"),
        email=overrides.pop("email", "user@test.com"),
        password=overrides.pop("password", "hashed"),
        user_uuid=overrides.pop("user_uuid", "user_test"),
        email_verified=overrides.pop("email_verified", False),
        email_verified_at=overrides.pop("email_verified_at", None),
        signup_method=overrides.pop("signup_method", "email"),
        creation_date=overrides.pop("creation_date", str(datetime.now())),
        update_date=overrides.pop("update_date", str(datetime.now())),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


class TestEmailVerificationService:
    def test_generate_verification_token(self):
        with patch(
            "src.services.users.email_verification.secrets.token_urlsafe",
            return_value="secure-token",
        ) as mock_token:
            token = generate_verification_token()

        assert token == "secure-token"
        mock_token.assert_called_once_with(32)

    def test_get_redis_connection_errors(self):
        with patch(
            "src.services.users.email_verification.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="")
            ),
        ):
            with pytest.raises(HTTPException) as exc_info:
                get_redis_connection()
        assert exc_info.value.status_code == 500

        fake_redis = MagicMock()
        fake_redis.__bool__.return_value = False
        with patch(
            "src.services.users.email_verification.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(
                    redis_connection_string="redis://test"
                )
            ),
        ), patch(
            "src.services.users.email_verification.redis.Redis.from_url",
            return_value=fake_redis,
        ):
            with pytest.raises(HTTPException) as exc_info:
                get_redis_connection()
        assert exc_info.value.status_code == 500

    @pytest.mark.asyncio
    async def test_send_verification_email_org_and_platform(self, mock_request, db, org):
        user = _make_user(
            db,
            id=20,
            username="newuser",
            email="newuser@test.com",
            user_uuid="user_new",
        )
        fake_redis = Mock()
        fake_redis.setex = Mock()

        with patch(
            "src.services.users.email_verification.get_redis_connection",
            return_value=fake_redis,
        ), patch(
            "src.services.users.email_verification.generate_verification_token",
            return_value="verification-token",
        ), patch(
            "src.services.users.email_verification.get_base_url_from_request",
            return_value="https://learnhouse.test",
        ), patch(
            "src.services.users.email_verification.send_email_verification_email",
            return_value=True,
        ) as mock_send:
            result = await send_verification_email(
                mock_request,
                db,
                user,
                org.id,
            )

            platform_result = await send_verification_email(
                mock_request,
                db,
                user,
                None,
            )

        assert result == "Verification email sent"
        assert platform_result == "Verification email sent"
        assert fake_redis.setex.call_count == 2
        first_key = fake_redis.setex.call_args_list[0].args[0]
        assert first_key.startswith(
            f"email_verification:{user.user_uuid}:org:{org.org_uuid}:token:"
        )
        assert fake_redis.setex.call_args_list[0].args[1] == TOKEN_TTL_SECONDS
        payload = json.loads(fake_redis.setex.call_args_list[0].args[2])
        assert payload["user_uuid"] == user.user_uuid
        assert payload["org_uuid"] == org.org_uuid
        assert payload["email"] == user.email
        assert payload["token"] == "verification-token"
        assert payload["created_at"]
        assert payload["expires_at"] > datetime.now(timezone.utc).timestamp()
        assert fake_redis.setex.call_args_list[1].args[0].startswith(
            f"email_verification:{user.user_uuid}:org:{NO_ORG_UUID}:token:"
        )
        assert mock_send.call_count == 2
        assert mock_send.call_args_list[0].kwargs["organization"] is not None
        assert mock_send.call_args_list[1].kwargs["organization"] is None

    @pytest.mark.asyncio
    async def test_send_verification_email_errors(self, mock_request, db, org):
        user = _make_user(
            db,
            id=21,
            username="sendfail",
            email="sendfail@test.com",
            user_uuid="user_sendfail",
        )

        with pytest.raises(HTTPException) as missing_org_exc:
            await send_verification_email(
                mock_request,
                db,
                user,
                org.id + 999,
            )
        assert missing_org_exc.value.status_code == 400

        with patch(
            "src.services.users.email_verification.get_redis_connection",
            return_value=Mock(setex=Mock()),
        ), patch(
            "src.services.users.email_verification.generate_verification_token",
            return_value="verification-token",
        ), patch(
            "src.services.users.email_verification.get_base_url_from_request",
            return_value="https://learnhouse.test",
        ), patch(
            "src.services.users.email_verification.send_email_verification_email",
            return_value=False,
        ):
            with pytest.raises(HTTPException) as send_exc:
                await send_verification_email(mock_request, db, user, org.id)
        assert send_exc.value.status_code == 500

    @pytest.mark.asyncio
    async def test_verify_email_token_paths(
        self, mock_request, db, org, regular_user
    ):
        user = db.exec(
            select(User).where(User.email == regular_user.email)
        ).first()
        assert user is not None

        base_token = "verify-token"
        redis_key = (
            f"email_verification:{user.user_uuid}:org:{org.org_uuid}:token:{base_token}"
        )
        token_payload = {
            "token": base_token,
            "user_uuid": user.user_uuid,
            "org_uuid": org.org_uuid,
            "email": user.email,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": datetime.now(timezone.utc).timestamp() + TOKEN_TTL_SECONDS,
        }

        fake_redis = Mock()
        fake_redis.get.return_value = json.dumps(token_payload)
        fake_redis.scan_iter.return_value = []

        with patch(
            "src.services.users.email_verification.get_redis_connection",
            return_value=fake_redis,
        ):
            with pytest.raises(HTTPException) as missing_exc:
                await verify_email_token(
                    mock_request,
                    db,
                    base_token,
                    "wrong-user",
                    org.org_uuid,
                )
        assert missing_exc.value.status_code == 400

        fake_redis.get.return_value = json.dumps(
            {**token_payload, "user_uuid": "missing-user"}
        )
        with patch(
            "src.services.users.email_verification.get_redis_connection",
            return_value=fake_redis,
        ):
            with pytest.raises(HTTPException) as user_missing_exc:
                await verify_email_token(
                    mock_request,
                    db,
                    base_token,
                    "missing-user",
                    org.org_uuid,
                )
        assert user_missing_exc.value.status_code == 400

        fake_redis.get.return_value = json.dumps(
            {**token_payload, "expires_at": 0}
        )
        with patch(
            "src.services.users.email_verification.get_redis_connection",
            return_value=fake_redis,
        ):
            with pytest.raises(HTTPException) as expired_exc:
                await verify_email_token(
                    mock_request,
                    db,
                    base_token,
                    user.user_uuid,
                    org.org_uuid,
                )
        assert expired_exc.value.status_code == 400
        fake_redis.delete.assert_called_with(redis_key)

        fake_redis.get.return_value = json.dumps(token_payload)
        with patch(
            "src.services.users.email_verification.get_redis_connection",
            return_value=fake_redis,
        ), patch(
            "src.services.users.email_verification.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_dispatch:
            result = await verify_email_token(
                mock_request,
                db,
                base_token,
                user.user_uuid,
                org.org_uuid,
            )
        assert result == "Email verified successfully"
        mock_dispatch.assert_awaited_once()
        assert db.exec(
            select(User).where(User.user_uuid == user.user_uuid)
        ).first().email_verified is True

    @pytest.mark.asyncio
    async def test_verify_email_token_already_verified_and_user_missing(
        self, mock_request, db, org
    ):
        verified_user = _make_user(
            db,
            id=22,
            username="verified",
            email="verified@test.com",
            user_uuid="user_verified",
            email_verified=True,
            email_verified_at=datetime.now(timezone.utc).isoformat(),
        )
        token = "verified-token"
        redis_key = (
            f"email_verification:{verified_user.user_uuid}:org:{org.org_uuid}:token:{token}"
        )
        fake_redis = Mock()
        fake_redis.get.return_value = json.dumps(
            {
                "token": token,
                "user_uuid": verified_user.user_uuid,
                "org_uuid": org.org_uuid,
                "email": verified_user.email,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "expires_at": datetime.now(timezone.utc).timestamp()
                + TOKEN_TTL_SECONDS,
            }
        )

        with patch(
            "src.services.users.email_verification.get_redis_connection",
            return_value=fake_redis,
        ):
            already_verified = await verify_email_token(
                mock_request,
                db,
                token,
                verified_user.user_uuid,
                org.org_uuid,
            )
        assert already_verified == "Email already verified"
        assert fake_redis.delete.called

        fake_redis.get.return_value = None
        with patch(
            "src.services.users.email_verification.get_redis_connection",
            return_value=fake_redis,
        ):
            with pytest.raises(HTTPException) as invalid_exc:
                await verify_email_token(
                    mock_request,
                    db,
                    token,
                    verified_user.user_uuid,
                    org.org_uuid,
                )
        assert invalid_exc.value.status_code == 400
        assert fake_redis.get.call_count >= 2

        fake_redis.get.return_value = json.dumps(
            {
                "token": token,
                "user_uuid": verified_user.user_uuid,
                "org_uuid": org.org_uuid,
                "email": verified_user.email,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "expires_at": datetime.now(timezone.utc).timestamp()
                + TOKEN_TTL_SECONDS,
            }
        )
        with patch(
            "src.services.users.email_verification.get_redis_connection",
            return_value=fake_redis,
        ), patch(
            "src.services.users.email_verification.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_dispatch:
            result = await verify_email_token(
                mock_request,
                db,
                token,
                verified_user.user_uuid,
                org.org_uuid,
            )
        assert result == "Email already verified"
        mock_dispatch.assert_not_called()
        assert fake_redis.delete.call_args.args[0] == redis_key

    @pytest.mark.asyncio
    async def test_resend_verification_email_paths(
        self, mock_request, db, org, regular_user
    ):
        user = db.exec(
            select(User).where(User.email == regular_user.email)
        ).first()
        assert user is not None

        with patch(
            "src.services.users.email_verification.check_verification_resend_rate_limit",
            return_value=(False, 3600),
        ):
            with pytest.raises(HTTPException) as rate_exc:
                await resend_verification_email(
                    mock_request,
                    db,
                    user.email,
                    org.id,
                )
        assert rate_exc.value.status_code == 429

        with patch(
            "src.services.users.email_verification.check_verification_resend_rate_limit",
            return_value=(True, 0),
        ):
            missing = await resend_verification_email(
                mock_request,
                db,
                "missing@test.com",
                org.id,
            )
        assert missing.startswith("If an account")

        verified_user = db.exec(
            select(User).where(User.email == user.email)
        ).first()
        verified_user.email_verified = True
        db.add(verified_user)
        db.commit()

        with patch(
            "src.services.users.email_verification.check_verification_resend_rate_limit",
            return_value=(True, 0),
        ):
            already = await resend_verification_email(
                mock_request,
                db,
                verified_user.email,
                org.id,
            )
        assert already == "Email is already verified"

        verified_user.email_verified = False
        db.add(verified_user)
        db.commit()

        with patch(
            "src.services.users.email_verification.check_verification_resend_rate_limit",
            return_value=(True, 0),
        ), patch(
            "src.services.users.email_verification.send_verification_email",
            new_callable=AsyncMock,
            return_value="Verification email sent",
        ) as mock_send:
            result = await resend_verification_email(
                mock_request,
                db,
                verified_user.email,
                org.id,
            )
        assert result.startswith("If an account")
        mock_send.assert_awaited_once()

    def test_invalidate_verification_tokens(self):
        fake_redis = Mock()
        fake_redis.scan_iter.return_value = [b"token-1", b"token-2"]

        with patch(
            "src.services.users.email_verification.get_redis_connection",
            return_value=fake_redis,
        ):
            invalidate_verification_tokens("user-1", "org-1")

        fake_redis.delete.assert_called_once_with(b"token-1", b"token-2")

    def test_get_redis_connection_success_returns_client(self):
        from unittest.mock import MagicMock, patch
        fake_redis = MagicMock()
        fake_redis.__bool__ = MagicMock(return_value=True)
        with patch(
            "src.services.users.email_verification.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="redis://test")
            ),
        ), patch(
            "src.services.users.email_verification.redis.Redis.from_url",
            return_value=fake_redis,
        ):
            result = get_redis_connection()
        assert result is fake_redis
