"""Tests for the third_party_login OAuth handler in src/routers/auth.py.

Targets the `else: raise HTTPException(...)` branch (line ~497) that rejects any
provider other than the supported ones (currently only "google").
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException, Response, status

from src.db.users import AnonymousUser
from src.routers.auth import third_party_login


@pytest.mark.asyncio
async def test_third_party_login_rejects_unsupported_provider():
    # provider != "google" with org_id=None skips the org-validation block and
    # falls straight through to the unsupported-provider `else: raise`.
    body = SimpleNamespace(
        email="user@example.com",
        provider="facebook",
        access_token="tok",
    )

    with pytest.raises(HTTPException) as exc_info:
        await third_party_login(
            request=SimpleNamespace(),
            response=Response(),
            body=body,
            org_id=None,
            current_user=AnonymousUser(),
            db_session=AsyncMock(),
        )

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
    assert exc_info.value.detail == "Unsupported provider"


@pytest.mark.asyncio
async def test_third_party_login_non_google_org_id_uses_body_email(db, org):
    """With a valid org_id but a non-google provider, the invite-email is taken
    from ``body.email`` (the ``else`` branch, line 502), the Redis invite key is
    read, and the Redis connection is closed in the finally block before the
    unsupported-provider guard rejects the request with 400."""
    body = SimpleNamespace(
        email="invitee@example.com",
        provider="facebook",
        access_token="tok",
    )
    close_mock = Mock()
    mock_redis = Mock(get=Mock(return_value=None), close=close_mock)
    mock_config = SimpleNamespace(
        redis_config=SimpleNamespace(redis_connection_string="redis://localhost:6379")
    )

    with patch(
        "src.routers.auth.get_learnhouse_config", return_value=mock_config
    ), patch("redis.Redis.from_url", return_value=mock_redis):
        with pytest.raises(HTTPException) as exc_info:
            await third_party_login(
                request=SimpleNamespace(),
                response=Response(),
                body=body,
                org_id=org.id,
                current_user=AnonymousUser(),
                db_session=db,
            )

    # Non-google providers key the invite on the raw body email.
    mock_redis.get.assert_called_once_with(
        f"invited_user:invitee@example.com:org:{org.org_uuid}"
    )
    close_mock.assert_called_once()
    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
    assert exc_info.value.detail == "Unsupported provider"
