import base64
import hashlib
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from src.db.users import AnonymousUser, PublicUser, User
from src.security.security import (
    Pbkdf2Sha256Hasher,
    security_verify_and_update_password,
)
from src.security.superadmin import _get_current_user_lazy, is_user_superadmin, require_superadmin


def _make_pbkdf2_hash(password: str, salt: bytes = b"salt1234", rounds: int = 1000) -> str:
    checksum = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, rounds)

    def _ab64(value: bytes) -> str:
        return base64.b64encode(value).decode("utf-8").rstrip("=").replace("+", ".")

    return f"$pbkdf2-sha256${rounds}${_ab64(salt)}${_ab64(checksum)}"


class TestSecurityRuntime:
    def test_pbkdf2_identify_accepts_string_and_bytes(self):
        hasher = Pbkdf2Sha256Hasher()

        assert hasher.identify("$pbkdf2-sha256$1000$salt$checksum") is True
        assert hasher.identify(b"$pbkdf2-sha256$1000$salt$checksum") is True
        assert hasher.identify("$argon2id$v=19$m=65536,t=3,p=4$abc$def") is False

    def test_pbkdf2_hash_raises_not_implemented(self):
        hasher = Pbkdf2Sha256Hasher()

        with pytest.raises(NotImplementedError):
            hasher.hash("password")

    def test_pbkdf2_verify_success_with_string_inputs(self):
        hasher = Pbkdf2Sha256Hasher()
        password = "correct horse battery staple"
        hash_value = _make_pbkdf2_hash(password)

        assert hasher.verify(password, hash_value) is True

    def test_pbkdf2_verify_success_with_bytes_inputs(self):
        hasher = Pbkdf2Sha256Hasher()
        password = b"correct horse battery staple"
        hash_value = _make_pbkdf2_hash(password.decode("utf-8")).encode("utf-8")

        assert hasher.verify(password, hash_value) is True

    @pytest.mark.parametrize(
        "password,hash_value",
        [
            ("wrong password", "$pbkdf2-sha256$1000$c2FsdDEyMzQ$invalidchecksum"),
            ("correct", "$pbkdf2-sha256$not-a-number$c2FsdDEyMzQ$c2ln"),
            ("correct", "$argon2id$v=19$m=65536,t=3,p=4$abc$def"),
            ("correct", "$pbkdf2-sha256$1000$bad-base64!$c2ln"),
        ],
    )
    def test_pbkdf2_verify_failure_paths(self, password, hash_value):
        hasher = Pbkdf2Sha256Hasher()

        assert hasher.verify(password, hash_value) is False

    def test_pbkdf2_check_needs_rehash_is_always_true(self):
        hasher = Pbkdf2Sha256Hasher()

        assert hasher.check_needs_rehash("$pbkdf2-sha256$1000$salt$checksum") is True

    def test_security_verify_and_update_password_delegates(self):
        with patch("src.security.security.password_hash.verify_and_update", return_value=(True, "new-hash")) as mock_verify:
            result = security_verify_and_update_password("plain", "old-hash")

        assert result == (True, "new-hash")
        mock_verify.assert_called_once_with("plain", "old-hash")


class TestSuperadminRuntime:
    def test_is_user_superadmin_true_and_false(self):
        db_session = Mock(spec=Session)

        db_session.exec.return_value.first.return_value = True
        assert is_user_superadmin(1, db_session) is True

        db_session.exec.return_value.first.return_value = False
        assert is_user_superadmin(2, db_session) is False

        db_session.exec.return_value.first.return_value = None
        assert is_user_superadmin(3, db_session) is False

    @pytest.mark.asyncio
    async def test_get_current_user_lazy_delegates(self):
        request = Mock()
        db_session = Mock(spec=Session)
        expected_user = PublicUser(
            id=1,
            email="user@example.com",
            username="user",
            first_name="Test",
            last_name="User",
            user_uuid="user_1",
        )

        with patch("src.security.auth.get_current_user", new=AsyncMock(return_value=expected_user)) as mock_get_current_user:
            result = await _get_current_user_lazy(request, db_session)

        assert result == expected_user
        mock_get_current_user.assert_awaited_once_with(request, db_session)

    @pytest.mark.asyncio
    async def test_require_superadmin_requires_authentication(self):
        with pytest.raises(HTTPException) as exc_info:
            await require_superadmin(current_user=AnonymousUser(), db_session=Mock(spec=Session))

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Authentication required"

    @pytest.mark.asyncio
    async def test_require_superadmin_requires_superadmin_flag(self):
        current_user = PublicUser(
            id=2,
            email="user@example.com",
            username="user",
            first_name="Test",
            last_name="User",
            user_uuid="user_2",
        )

        with patch("src.security.superadmin.is_user_superadmin", return_value=False):
            with pytest.raises(HTTPException) as exc_info:
                await require_superadmin(current_user=current_user, db_session=Mock(spec=Session))

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == "Superadmin access required"

    @pytest.mark.asyncio
    async def test_require_superadmin_allows_superadmin(self):
        current_user = PublicUser(
            id=1,
            email="admin@example.com",
            username="admin",
            first_name="Admin",
            last_name="User",
            user_uuid="user_1",
        )
        db_session = Mock(spec=Session)

        with patch("src.security.superadmin.is_user_superadmin", return_value=True) as mock_is_superadmin:
            result = await require_superadmin(current_user=current_user, db_session=db_session)

        assert result == current_user
        mock_is_superadmin.assert_called_once_with(1, db_session)
