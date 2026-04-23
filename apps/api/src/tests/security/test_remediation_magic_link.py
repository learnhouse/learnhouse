"""
F-06: magic-link tokens are single-use.

The consume endpoint sets a Redis key for the jti with NX+TTL on first use.
A second consume of the same jti must return 410.
"""

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from src.services.admin.admin import consume_magic_link_token


@pytest.fixture
def legit_payload():
    return {
        "sub": "user@test.com",
        "purpose": "magic_link",
        "org_id": 1,
        "redirect_to": "/dashboard",
        "jti": "one-shot-jti",
    }


@pytest.mark.asyncio
async def test_magic_link_single_use_blocks_replay(legit_payload):
    """F-06: second consume of the same jti returns 410."""
    redis_client = MagicMock()
    redis_client.set.side_effect = [True, False]

    user_row = MagicMock(id=99, email=legit_payload["sub"])
    membership = MagicMock()

    db_mock = MagicMock()
    db_mock.exec.return_value.first.side_effect = [
        user_row, membership,
        user_row, membership,
    ]

    fake_cfg = MagicMock()
    fake_cfg.redis_config.redis_connection_string = "redis://fake"

    with patch(
        "src.security.auth.decode_jwt",
        return_value=legit_payload,
    ), patch(
        "src.services.admin.admin._validate_magic_link_redirect",
        return_value="/dashboard",
    ), patch(
        "src.services.admin.admin.create_access_token",
        return_value="new-access",
    ), patch(
        "src.services.admin.admin.create_refresh_token",
        return_value="new-refresh",
    ), patch(
        "redis.Redis.from_url",
        return_value=redis_client,
    ), patch(
        "config.config.get_learnhouse_config",
        return_value=fake_cfg,
    ):
        _, access, refresh, redirect_to = await consume_magic_link_token(
            token="legit-jwt",
            db_session=db_mock,
        )
        assert access == "new-access"
        assert refresh == "new-refresh"
        assert redirect_to == "/dashboard"

        with pytest.raises(HTTPException) as exc:
            await consume_magic_link_token(
                token="legit-jwt",
                db_session=db_mock,
            )
        assert exc.value.status_code == 410
        assert "already" in str(exc.value.detail).lower()


@pytest.mark.asyncio
async def test_magic_link_falls_through_when_redis_unavailable(legit_payload):
    """Fail-open: with Redis down, consume still succeeds (JWT exp bounds window)."""
    user_row = MagicMock(id=99, email=legit_payload["sub"])
    membership = MagicMock()
    db_mock = MagicMock()
    db_mock.exec.return_value.first.side_effect = [user_row, membership]

    fake_cfg = MagicMock()
    fake_cfg.redis_config.redis_connection_string = "redis://fake"

    with patch(
        "src.security.auth.decode_jwt",
        return_value=legit_payload,
    ), patch(
        "src.services.admin.admin._validate_magic_link_redirect",
        return_value=None,
    ), patch(
        "src.services.admin.admin.create_access_token",
        return_value="new-access",
    ), patch(
        "src.services.admin.admin.create_refresh_token",
        return_value="new-refresh",
    ), patch(
        "redis.Redis.from_url",
        side_effect=RuntimeError("redis down"),
    ), patch(
        "config.config.get_learnhouse_config",
        return_value=fake_cfg,
    ):
        result = await consume_magic_link_token(
            token="legit-jwt",
            db_session=db_mock,
        )
        assert result[1] == "new-access"
