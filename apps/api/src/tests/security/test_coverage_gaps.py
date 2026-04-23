"""
Targeted tests for defensive branches and helpers not exercised by the
main router/service tests. Each test pins one small code path; they exist
so that these branches keep working and so that coverage stays honest.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException, Request


# ---------------------------------------------------------------------------
# src/security/auth.py::_mark_refresh_jti_used
# ---------------------------------------------------------------------------

def test_mark_refresh_jti_used_fails_open_when_redis_none():
    """Redis unavailable → return True so users aren't locked out."""
    from src.security import auth

    with patch.object(auth, "_get_revocation_redis_client", return_value=None):
        assert auth._mark_refresh_jti_used(user_id=1, jti="abc") is True


def test_mark_refresh_jti_used_returns_set_result_from_redis():
    """Happy path: Redis SET NX returns True on first use."""
    from src.security import auth

    fake_redis = MagicMock()
    fake_redis.set.return_value = True
    with patch.object(auth, "_get_revocation_redis_client", return_value=fake_redis):
        assert auth._mark_refresh_jti_used(user_id=1, jti="jti_first") is True
    fake_redis.set.assert_called_once()

    fake_redis.set.return_value = None  # replay — key already exists
    with patch.object(auth, "_get_revocation_redis_client", return_value=fake_redis):
        assert auth._mark_refresh_jti_used(user_id=1, jti="jti_first") is False


def test_mark_refresh_jti_used_fails_open_on_redis_exception():
    """If Redis itself raises, fail open rather than break auth."""
    from src.security import auth

    exploding = MagicMock()
    exploding.set.side_effect = RuntimeError("redis died")
    with patch.object(auth, "_get_revocation_redis_client", return_value=exploding):
        assert auth._mark_refresh_jti_used(user_id=1, jti="jti") is True


# ---------------------------------------------------------------------------
# src/security/auth.py::get_current_user — edge branches
# ---------------------------------------------------------------------------

def _make_request_with_token(token: str) -> Request:
    """Build a minimal Request that carries a Bearer token."""
    scope = {
        "type": "http",
        "headers": [(b"authorization", f"Bearer {token}".encode())],
        "method": "GET",
        "path": "/",
        "query_string": b"",
        "state": {},
    }
    return Request(scope)


@pytest.mark.asyncio
async def test_get_current_user_tolerates_bad_iat_claim(db):
    """A token with a corrupt ``iat`` (raises OSError in fromtimestamp) must
    not crash — the helper should swallow the error and continue with
    ``issued_at=None``."""
    from unittest.mock import AsyncMock

    import jwt as pyjwt

    from src.security import auth as auth_module

    # Real, decodable token so extract_jwt + decode_jwt succeed. We override
    # the payload at decode time to inject a bad iat value.
    now = int(datetime.now(tz=timezone.utc).timestamp())
    token = pyjwt.encode(
        {"sub": "user@test.com", "iat": now, "exp": now + 60},
        auth_module.JWT_SECRET_KEY,
        algorithm=auth_module.ALGORITHM,
    )
    request = _make_request_with_token(token)

    fake_user = SimpleNamespace(
        id=7,
        email="user@test.com",
        password_changed_at=None,
        model_dump=lambda: {
            "id": 7,
            "user_uuid": "user_7",
            "email": "user@test.com",
            "username": "u7",
            "first_name": "F",
            "last_name": "L",
            "avatar_image": "",
            "bio": "",
            "details": {},
            "profile": {},
            "creation_date": "2024-01-01",
            "update_date": "2024-01-01",
            "email_verified": True,
        },
    )

    # 10**20 overflows datetime.fromtimestamp on Linux/macOS → OSError.
    bad_iat_payload = {"sub": "user@test.com", "iat": 10**20, "exp": now + 60}

    with (
        patch("src.security.auth.decode_jwt", return_value=bad_iat_payload),
        patch("src.security.auth.security_get_user", new=AsyncMock(return_value=fake_user)),
        patch("src.security.auth._is_token_revoked_for_user", return_value=False),
    ):
        user = await auth_module.get_current_user(request, db_session=db)
    assert user.id == 7


@pytest.mark.asyncio
async def test_get_current_user_rejects_revoked_token(db):
    """If ``_is_token_revoked_for_user`` returns True, raise 401."""
    import jwt as pyjwt
    from unittest.mock import AsyncMock

    from src.security import auth as auth_module

    now = int(datetime.now(tz=timezone.utc).timestamp())
    payload = {"sub": "user@test.com", "iat": now, "exp": now + 60}
    token = pyjwt.encode(payload, auth_module.JWT_SECRET_KEY, algorithm=auth_module.ALGORITHM)

    request = _make_request_with_token(token)

    fake_user = SimpleNamespace(
        id=42,
        email="user@test.com",
        password_changed_at=None,
        model_dump=lambda: {"id": 42, "email": "user@test.com"},
    )

    with patch("src.security.auth.security_get_user", new=AsyncMock(return_value=fake_user)):
        with patch("src.security.auth._is_token_revoked_for_user", return_value=True):
            with pytest.raises(HTTPException) as exc:
                await auth_module.get_current_user(request, db_session=db)
    assert exc.value.status_code == 401


# ---------------------------------------------------------------------------
# src/security/features_utils/usage.py::_load_org_config_for_ai
# ---------------------------------------------------------------------------

def test_load_org_config_for_ai_returns_row_for_existing_org(db, org):
    """Direct-call coverage for the tiny DB helper used by AI credit paths."""
    from src.db.organization_config import OrganizationConfig
    from src.security.features_utils import usage as usage_module

    db.add(OrganizationConfig(org_id=org.id, config={}))
    db.commit()

    result = usage_module._load_org_config_for_ai(org.id, db)
    assert result is not None
    assert result.org_id == org.id


def test_load_org_config_for_ai_returns_none_for_missing_org(db):
    """Unknown org id → no config row."""
    from src.security.features_utils import usage as usage_module

    assert usage_module._load_org_config_for_ai(999_999, db) is None


# ---------------------------------------------------------------------------
# src/services/courses/transfer/import_service.py — uncompressed size cap
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_analyze_import_package_rejects_oversized_uncompressed(
    db, org, admin_user, mock_request, tmp_path, monkeypatch
):
    """Aggregate uncompressed size > MAX_PACKAGE_SIZE must 400.

    The streaming check at line 133 is on compressed bytes; this test pushes
    the uncompressed total past the cap while keeping the on-disk zip small
    enough to pass the streaming check.
    """
    import zipfile as zf
    from io import BytesIO
    from unittest.mock import AsyncMock

    from fastapi import UploadFile

    from src.services.courses.transfer.import_service import analyze_import_package

    # Build a highly-compressible zip: ~100KB of zeros deflates to <1KB.
    buf = BytesIO()
    with zf.ZipFile(buf, "w", compression=zf.ZIP_DEFLATED) as zp:
        zp.writestr("manifest.json", b"\x00" * (100 * 1024))
    package_bytes = buf.getvalue()
    assert len(package_bytes) < 5000  # sanity: compressed stays under cap below

    monkeypatch.setattr(
        "src.services.courses.transfer.import_service.TEMP_IMPORT_DIR",
        str(tmp_path),
    )
    # Cap at 5000 bytes: on-disk zip (<5000) passes line 133, uncompressed
    # (100KB) trips line 178.
    monkeypatch.setattr(
        "src.services.courses.transfer.import_service.MAX_PACKAGE_SIZE", 5000
    )
    monkeypatch.setattr(
        "src.services.courses.transfer.import_service.MAX_ENTRY_SIZE", 10 * 1024 * 1024
    )

    upload = UploadFile(filename="package.zip", file=BytesIO(package_bytes))

    with patch(
        "src.services.courses.transfer.import_service.check_resource_access",
        new_callable=AsyncMock,
    ):
        with pytest.raises(HTTPException) as exc:
            await analyze_import_package(mock_request, upload, org.id, admin_user, db)
    assert exc.value.status_code == 400
    assert "uncompressed size" in exc.value.detail
