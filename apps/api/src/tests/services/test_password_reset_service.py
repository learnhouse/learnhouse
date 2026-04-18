"""Tests for src/services/users/password_reset.py."""

import json
import string
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.users import AnonymousUser, User
from src.security.security import security_hash_password, security_verify_password
from src.services.users.password_reset import (
    _get_redis_connection,
    change_password_with_reset_code,
    change_password_with_reset_code_platform,
    generate_secure_reset_code,
    send_reset_password_code,
    send_reset_password_code_platform,
)


def _make_user(db, **overrides):
    user = User(
        id=overrides.pop("id", None),
        username=overrides.pop("username", "user"),
        first_name=overrides.pop("first_name", "User"),
        last_name=overrides.pop("last_name", "Test"),
        email=overrides.pop("email", "user@test.com"),
        password=overrides.pop("password", security_hash_password("OldPass123!")),
        user_uuid=overrides.pop("user_uuid", "user_test"),
        email_verified=overrides.pop("email_verified", True),
        signup_method=overrides.pop("signup_method", "email"),
        creation_date=overrides.pop("creation_date", str(datetime.now())),
        update_date=overrides.pop("update_date", str(datetime.now())),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


class TestPasswordResetService:
    def test_generate_secure_reset_code(self):
        alphabet = string.ascii_letters + string.digits
        with patch(
            "src.services.users.password_reset.secrets.choice",
            side_effect=list("AbC123xy"),
        ) as mock_choice:
            code = generate_secure_reset_code()

        assert code == "AbC123xy"
        assert mock_choice.call_count == 8
        assert all(char in alphabet for char in code)

    def test_get_redis_connection_errors(self):
        with patch(
            "src.services.users.password_reset.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="")
            ),
        ):
            with pytest.raises(HTTPException) as exc_info:
                _get_redis_connection()
        assert exc_info.value.status_code == 500

        fake_redis = MagicMock()
        fake_redis.__bool__.return_value = False
        with patch(
            "src.services.users.password_reset.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(
                    redis_connection_string="redis://test"
                )
            ),
        ), patch(
            "src.services.users.password_reset.redis.Redis.from_url",
            return_value=fake_redis,
        ):
            with pytest.raises(HTTPException) as exc_info:
                _get_redis_connection()
        assert exc_info.value.status_code == 500

    @pytest.mark.asyncio
    async def test_send_reset_password_code_org_and_platform_paths(
        self, mock_request, db, org, regular_user
    ):
        user = db.exec(
            select(User).where(User.email == regular_user.email)
        ).first()
        assert user is not None
        fake_redis = Mock()
        fake_redis.set = Mock()

        with patch(
            "src.services.users.password_reset.generate_secure_reset_code",
            return_value="RESET123",
        ), patch(
            "src.services.users.password_reset.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(
                    redis_connection_string="redis://test"
                )
            ),
        ), patch(
            "src.services.users.password_reset.redis.Redis.from_url",
            return_value=fake_redis,
        ), patch(
            "src.services.users.password_reset.get_base_url_from_request",
            return_value="https://learnhouse.test",
        ), patch(
            "src.services.users.password_reset.send_password_reset_email",
            return_value=True,
        ) as mock_send:
            result = await send_reset_password_code(
                mock_request,
                db,
                AnonymousUser(),
                org.id,
                user.email,
            )

        assert result.startswith("If an account")
        fake_redis.set.assert_called_once()
        key = fake_redis.set.call_args.args[0]
        assert key == f"pwd_reset:user:{user.user_uuid}:org:{org.org_uuid}:code:RESET123"
        payload = json.loads(fake_redis.set.call_args.args[1])
        assert payload["reset_code"] == "RESET123"
        assert payload["created_by"] == user.user_uuid
        assert payload["org_uuid"] == org.org_uuid
        assert payload["reset_code_type"] == "password_reset"
        assert mock_send.call_count == 1

        missing_platform = await send_reset_password_code_platform(
            mock_request,
            db,
            AnonymousUser(),
            "missing@test.com",
        )
        assert missing_platform.startswith("If an account")

        with patch(
            "src.services.users.password_reset.generate_secure_reset_code",
            return_value="RESET456",
        ), patch(
            "src.services.users.password_reset._get_redis_connection",
            return_value=fake_redis,
        ), patch(
            "src.services.users.password_reset.get_base_url_from_request",
            return_value="https://learnhouse.test",
        ), patch(
            "src.services.users.password_reset.send_password_reset_email_platform",
            return_value=True,
        ) as mock_platform_send:
            platform_result = await send_reset_password_code_platform(
                mock_request,
                db,
                AnonymousUser(),
                user.email,
            )

        assert platform_result.startswith("If an account")
        mock_platform_send.assert_called_once()
        platform_key = fake_redis.set.call_args_list[-1].args[0]
        assert platform_key == f"pwd_reset:user:{user.user_uuid}:platform:code:RESET456"

    @pytest.mark.asyncio
    async def test_send_reset_password_code_error_paths(self, mock_request, db, org):
        user = _make_user(
            db,
            id=30,
            username="resetuser",
            email="resetuser@test.com",
            user_uuid="user_reset",
        )

        fake_redis_ok = MagicMock()
        fake_redis_ok.incr.return_value = 1
        with patch(
            "src.services.users.password_reset._get_redis_connection",
            return_value=fake_redis_ok,
        ):
            with pytest.raises(HTTPException) as missing_org_exc:
                await send_reset_password_code(
                    mock_request,
                    db,
                    AnonymousUser(),
                    org.id + 999,
                    user.email,
                )
        assert missing_org_exc.value.status_code == 400

        with patch(
            "src.services.users.password_reset._get_redis_connection",
            return_value=fake_redis_ok,
        ):
            missing = await send_reset_password_code(
                mock_request,
                db,
                AnonymousUser(),
                org.id,
                "missing@test.com",
            )
        assert missing.startswith("If an account")

        with patch(
            "src.services.users.password_reset.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="")
            ),
        ):
            with pytest.raises(HTTPException) as redis_missing_exc:
                await send_reset_password_code(
                    mock_request,
                    db,
                    AnonymousUser(),
                    org.id,
                    user.email,
                )
        assert redis_missing_exc.value.status_code == 500

        fake_redis = MagicMock()
        fake_redis.__bool__.return_value = False
        with patch(
            "src.services.users.password_reset.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(
                    redis_connection_string="redis://test"
                )
            ),
        ), patch(
            "src.services.users.password_reset.redis.Redis.from_url",
            return_value=fake_redis,
        ):
            with pytest.raises(HTTPException) as conn_exc:
                await send_reset_password_code(
                    mock_request,
                    db,
                    AnonymousUser(),
                    org.id,
                    user.email,
                )
        assert conn_exc.value.status_code == 500

        with patch(
            "src.services.users.password_reset.generate_secure_reset_code",
            return_value="RESET999",
        ), patch(
            "src.services.users.password_reset.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(
                    redis_connection_string="redis://test"
                )
            ),
        ), patch(
            "src.services.users.password_reset.redis.Redis.from_url",
            return_value=Mock(set=Mock()),
        ), patch(
            "src.services.users.password_reset.get_base_url_from_request",
            return_value="https://learnhouse.test",
        ), patch(
            "src.services.users.password_reset.send_password_reset_email",
            return_value=False,
        ):
            with pytest.raises(HTTPException) as send_exc:
                await send_reset_password_code(
                    mock_request,
                    db,
                    AnonymousUser(),
                    org.id,
                    user.email,
                )
        assert send_exc.value.status_code == 500

    @pytest.mark.asyncio
    async def test_change_password_with_reset_code_org_paths(
        self, mock_request, db, org, regular_user
    ):
        user = db.exec(
            select(User).where(User.email == regular_user.email)
        ).first()
        assert user is not None
        old_password = user.password
        reset_code = "RESET123"
        redis_key = f"pwd_reset:user:{user.user_uuid}:org:{org.org_uuid}:code:{reset_code}"
        fake_redis = Mock()
        fake_redis.get.return_value = json.dumps(
            {
                "reset_code": reset_code,
                "reset_code_expires": int(datetime.now().timestamp()) + 3600,
                "reset_code_type": "password_reset",
                "created_at": datetime.now().isoformat(),
                "created_by": user.user_uuid,
                "org_uuid": org.org_uuid,
            }
        )

        with patch(
            "src.services.users.password_reset.validate_password_complexity",
            return_value=SimpleNamespace(is_valid=True, errors=[], requirements={}),
        ), patch(
            "src.services.users.password_reset.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(
                    redis_connection_string="redis://test"
                )
            ),
        ), patch(
            "src.services.users.password_reset.redis.Redis.from_url",
            return_value=fake_redis,
        ):
            result = await change_password_with_reset_code(
                mock_request,
                db,
                AnonymousUser(),
                "NewPassword123!",
                org.id,
                user.email,
                reset_code,
            )

        assert result == "Password changed"
        refreshed = db.exec(select(User).where(User.email == user.email)).first()
        assert refreshed is not None
        assert refreshed.password != old_password
        assert security_verify_password("NewPassword123!", refreshed.password)
        fake_redis.delete.assert_called_once_with(redis_key)

    @pytest.mark.asyncio
    async def test_change_password_with_reset_code_error_paths(
        self, mock_request, db, org, regular_user
    ):
        user = db.exec(
            select(User).where(User.email == regular_user.email)
        ).first()
        assert user is not None

        with patch(
            "src.services.users.password_reset.validate_password_complexity",
            return_value=SimpleNamespace(
                is_valid=False,
                errors=["too short"],
                requirements={"min_length": False},
            ),
        ):
            with pytest.raises(HTTPException) as weak_exc:
                await change_password_with_reset_code(
                    mock_request,
                    db,
                    AnonymousUser(),
                    "short",
                    org.id,
                    user.email,
                    "RESET123",
                )
        assert weak_exc.value.status_code == 400

        with pytest.raises(HTTPException) as missing_org_exc:
            await change_password_with_reset_code(
                mock_request,
                db,
                AnonymousUser(),
                "NewPassword123!",
                org.id + 999,
                user.email,
                "RESET123",
            )
        assert missing_org_exc.value.status_code == 400

        with patch(
            "src.services.users.password_reset.validate_password_complexity",
            return_value=SimpleNamespace(is_valid=True, errors=[], requirements={}),
        ), patch(
            "src.services.users.password_reset.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(
                    redis_connection_string="redis://test"
                )
            ),
        ), patch(
            "src.services.users.password_reset.redis.Redis.from_url",
            return_value=Mock(get=Mock(return_value=None)),
        ):
            with pytest.raises(HTTPException) as invalid_format_exc:
                await change_password_with_reset_code(
                    mock_request,
                    db,
                    AnonymousUser(),
                    "NewPassword123!",
                    org.id,
                    user.email,
                    "RESET-123",
                )
        assert invalid_format_exc.value.status_code == 400

        with pytest.raises(HTTPException) as invalid_code_exc:
            await change_password_with_reset_code(
                mock_request,
                db,
                AnonymousUser(),
                "NewPassword123!",
                org.id,
                "missing@test.com",
                "RESET123",
            )
        assert invalid_code_exc.value.status_code == 400

        with patch(
            "src.services.users.password_reset.validate_password_complexity",
            return_value=SimpleNamespace(is_valid=True, errors=[], requirements={}),
        ), patch(
            "src.services.users.password_reset.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(
                    redis_connection_string="redis://test"
                )
            ),
        ), patch(
            "src.services.users.password_reset.redis.Redis.from_url",
            return_value=Mock(get=Mock(return_value=None)),
        ):
            with pytest.raises(HTTPException) as no_match_exc:
                await change_password_with_reset_code(
                    mock_request,
                    db,
                    AnonymousUser(),
                    "NewPassword123!",
                    org.id,
                    user.email,
                    "RESET123",
                )
        assert no_match_exc.value.status_code == 400

        fake_redis = Mock()
        fake_redis.get.return_value = None
        with patch(
            "src.services.users.password_reset.validate_password_complexity",
            return_value=SimpleNamespace(is_valid=True, errors=[], requirements={}),
        ), patch(
            "src.services.users.password_reset.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(
                    redis_connection_string="redis://test"
                )
            ),
        ), patch(
            "src.services.users.password_reset.redis.Redis.from_url",
            return_value=fake_redis,
        ):
            with pytest.raises(HTTPException) as missing_value_exc:
                await change_password_with_reset_code(
                    mock_request,
                    db,
                    AnonymousUser(),
                    "NewPassword123!",
                    org.id,
                    user.email,
                    "RESET123",
                )
        assert missing_value_exc.value.status_code == 400

        fake_redis = Mock()
        fake_redis.scan_iter.return_value = [b"reset-key"]
        fake_redis.get.return_value = json.dumps(
            {
                "reset_code_expires": 0,
                "created_by": user.user_uuid,
                "org_uuid": org.org_uuid,
            }
        )
        with patch(
            "src.services.users.password_reset.validate_password_complexity",
            return_value=SimpleNamespace(is_valid=True, errors=[], requirements={}),
        ), patch(
            "src.services.users.password_reset.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(
                    redis_connection_string="redis://test"
                )
            ),
        ), patch(
            "src.services.users.password_reset.redis.Redis.from_url",
            return_value=fake_redis,
        ):
            with pytest.raises(HTTPException) as expired_exc:
                await change_password_with_reset_code(
                    mock_request,
                    db,
                    AnonymousUser(),
                    "NewPassword123!",
                    org.id,
                    user.email,
                    "RESET123",
                )
        assert expired_exc.value.status_code == 400
        fake_redis.delete.assert_called_once()

    @pytest.mark.asyncio
    async def test_platform_reset_code_paths(self, mock_request, db, regular_user):
        user = db.exec(
            select(User).where(User.email == regular_user.email)
        ).first()
        assert user is not None
        fake_redis = Mock()
        fake_redis.set = Mock()

        with patch(
            "src.services.users.password_reset.generate_secure_reset_code",
            return_value="PLAT1234",
        ), patch(
            "src.services.users.password_reset._get_redis_connection",
            return_value=fake_redis,
        ), patch(
            "src.services.users.password_reset.get_base_url_from_request",
            return_value="https://learnhouse.test",
        ), patch(
            "src.services.users.password_reset.send_password_reset_email_platform",
            return_value=True,
        ):
            result = await send_reset_password_code_platform(
                mock_request,
                db,
                AnonymousUser(),
                user.email,
            )
        assert result.startswith("If an account")
        fake_redis.set.assert_called_once()

        missing_platform = await send_reset_password_code_platform(
            mock_request,
            db,
            AnonymousUser(),
            "missing@test.com",
        )
        assert missing_platform.startswith("If an account")

        with patch(
            "src.services.users.password_reset.validate_password_complexity",
            return_value=SimpleNamespace(is_valid=True, errors=[], requirements={}),
        ), patch(
            "src.services.users.password_reset._get_redis_connection",
            return_value=Mock(get=Mock(return_value=None)),
        ):
            with pytest.raises(HTTPException) as invalid_format_exc:
                await change_password_with_reset_code_platform(
                    mock_request,
                    db,
                    AnonymousUser(),
                    "NewPassword123!",
                    user.email,
                    "PLAT-1234",
                )
        assert invalid_format_exc.value.status_code == 400

        with patch(
            "src.services.users.password_reset.validate_password_complexity",
            return_value=SimpleNamespace(is_valid=False, errors=["weak"], requirements={}),
        ):
            with pytest.raises(HTTPException) as weak_exc:
                await change_password_with_reset_code_platform(
                    mock_request,
                    db,
                    AnonymousUser(),
                    "short",
                    user.email,
                    "PLAT1234",
                )
        assert weak_exc.value.status_code == 400

        with pytest.raises(HTTPException) as missing_email_exc:
            await change_password_with_reset_code_platform(
                mock_request,
                db,
                AnonymousUser(),
                "NewPassword123!",
                "missing@test.com",
                "PLAT1234",
            )
        assert missing_email_exc.value.status_code == 400

        with patch(
            "src.services.users.password_reset.validate_password_complexity",
            return_value=SimpleNamespace(is_valid=True, errors=[], requirements={}),
        ), patch(
            "src.services.users.password_reset._get_redis_connection",
            return_value=Mock(get=Mock(return_value=None)),
        ):
            with pytest.raises(HTTPException) as no_match_exc:
                await change_password_with_reset_code_platform(
                    mock_request,
                    db,
                    AnonymousUser(),
                    "NewPassword123!",
                    user.email,
                    "PLAT1234",
                )
        assert no_match_exc.value.status_code == 400

        fake_redis = Mock()
        fake_redis.scan_iter.return_value = [b"reset-key"]
        fake_redis.get.return_value = None
        with patch(
            "src.services.users.password_reset.validate_password_complexity",
            return_value=SimpleNamespace(is_valid=True, errors=[], requirements={}),
        ), patch(
            "src.services.users.password_reset._get_redis_connection",
            return_value=fake_redis,
        ):
            with pytest.raises(HTTPException) as missing_value_exc:
                await change_password_with_reset_code_platform(
                    mock_request,
                    db,
                    AnonymousUser(),
                    "NewPassword123!",
                    user.email,
                    "PLAT1234",
                )
        assert missing_value_exc.value.status_code == 400

        fake_redis = Mock()
        fake_redis.scan_iter.return_value = [b"reset-key"]
        fake_redis.get.return_value = json.dumps(
            {
                "reset_code_expires": 0,
                "created_by": user.user_uuid,
            }
        )
        with patch(
            "src.services.users.password_reset.validate_password_complexity",
            return_value=SimpleNamespace(is_valid=True, errors=[], requirements={}),
        ), patch(
            "src.services.users.password_reset._get_redis_connection",
            return_value=fake_redis,
        ):
            with pytest.raises(HTTPException) as expired_exc:
                await change_password_with_reset_code_platform(
                    mock_request,
                    db,
                    AnonymousUser(),
                    "NewPassword123!",
                    user.email,
                    "PLAT1234",
                )
        assert expired_exc.value.status_code == 400

        fake_redis = Mock()
        fake_redis.scan_iter.return_value = [b"reset-key"]
        fake_redis.get.return_value = json.dumps(
            {
                "reset_code_expires": int(datetime.now().timestamp()) + 3600,
                "created_by": user.user_uuid,
            }
        )
        with patch(
            "src.services.users.password_reset.validate_password_complexity",
            return_value=SimpleNamespace(is_valid=True, errors=[], requirements={}),
        ), patch(
            "src.services.users.password_reset._get_redis_connection",
            return_value=fake_redis,
        ):
            result = await change_password_with_reset_code_platform(
                mock_request,
                db,
                AnonymousUser(),
                "NewPassword123!",
                user.email,
                "PLAT1234",
            )
        assert result == "Password changed"
        refreshed = db.exec(select(User).where(User.email == user.email)).first()
        assert refreshed is not None
        assert security_verify_password("NewPassword123!", refreshed.password)
