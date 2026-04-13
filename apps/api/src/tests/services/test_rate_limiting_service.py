from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from src.services.security.rate_limiting import (
    RateLimitExceeded,
    _is_trusted_proxy,
    check_api_token_rate_limit,
    check_email_verification_rate_limit,
    check_login_rate_limit,
    check_password_reset_rate_limit,
    check_rate_limit,
    check_refresh_rate_limit,
    check_signup_rate_limit,
    check_verification_resend_rate_limit,
    get_client_ip,
    get_redis_connection,
)


def _request(client_host=None, headers=None):
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [
            (key.lower().encode(), value.encode())
            for key, value in (headers or {}).items()
        ],
        "query_string": b"",
    }
    if client_host is not None:
        scope["client"] = (client_host, 12345)
    return Request(scope)


def test_rate_limit_exceeded_keeps_message_and_retry_after():
    exc = RateLimitExceeded("Too many requests", 17)

    assert exc.message == "Too many requests"
    assert exc.retry_after == 17
    assert str(exc) == "Too many requests"


def test_get_redis_connection_success_and_missing_config():
    redis_client = object()

    with patch(
        "src.services.security.rate_limiting.get_learnhouse_config"
    ) as mock_config, patch(
        "src.services.security.rate_limiting.redis.Redis.from_url",
        return_value=redis_client,
    ) as mock_from_url:
        mock_config.return_value = SimpleNamespace(
            redis_config=SimpleNamespace(redis_connection_string="redis://example")
        )
        assert get_redis_connection() is redis_client
        mock_from_url.assert_called_once_with("redis://example")

    with patch(
        "src.services.security.rate_limiting.get_learnhouse_config"
    ) as mock_config:
        mock_config.return_value = SimpleNamespace(
            redis_config=SimpleNamespace(redis_connection_string="")
        )

        with pytest.raises(HTTPException) as exc_info:
            get_redis_connection()

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "Redis connection string not found"


@pytest.mark.parametrize(
    "client_host,headers,expected",
    [
        (
            "127.0.0.1",
            {"X-Forwarded-For": "203.0.113.9, 10.0.0.2"},
            "203.0.113.9",
        ),
        (
            "127.0.0.1",
            {"X-Forwarded-For": "garbage", "X-Real-IP": "198.51.100.7"},
            "198.51.100.7",
        ),
        (
            "8.8.8.8",
            {"X-Forwarded-For": "203.0.113.8"},
            "8.8.8.8",
        ),
        ("not-an-ip", {"X-Forwarded-For": "203.0.113.8"}, "not-an-ip"),
        (None, {}, "unknown"),
    ],
)
def test_get_client_ip_handles_proxy_and_fallback_paths(
    client_host, headers, expected
):
    assert get_client_ip(_request(client_host=client_host, headers=headers)) == expected


def test_is_trusted_proxy_checks_loopback_and_private_ranges():
    assert _is_trusted_proxy("127.0.0.1") is True
    assert _is_trusted_proxy("10.1.2.3") is True
    assert _is_trusted_proxy("8.8.8.8") is False
    assert _is_trusted_proxy("not-an-ip") is False


def test_check_rate_limit_first_attempt_uses_default_redis_connection():
    fake_redis = Mock()
    fake_redis.get.return_value = None
    fake_redis.ttl.return_value = -1

    with patch(
        "src.services.security.rate_limiting.get_redis_connection",
        return_value=fake_redis,
    ) as mock_conn:
        allowed, count, retry_after = check_rate_limit(
            key="login:203.0.113.9",
            max_attempts=3,
            window_seconds=60,
        )

    assert allowed is True
    assert count == 1
    assert retry_after == 60
    mock_conn.assert_called_once()
    fake_redis.setex.assert_called_once_with("rate_limit:login:203.0.113.9", 60, 1)


def test_check_rate_limit_blocks_when_limit_is_reached():
    fake_redis = Mock()
    fake_redis.get.return_value = b"3"
    fake_redis.ttl.return_value = -1

    allowed, count, retry_after = check_rate_limit(
        key="login:203.0.113.9",
        max_attempts=3,
        window_seconds=60,
        r=fake_redis,
    )

    assert allowed is False
    assert count == 3
    assert retry_after == 60
    fake_redis.incr.assert_not_called()


def test_check_rate_limit_increments_existing_counter():
    fake_redis = Mock()
    fake_redis.get.return_value = b"1"
    fake_redis.ttl.return_value = 15
    fake_redis.incr.return_value = 2

    allowed, count, retry_after = check_rate_limit(
        key="signup:203.0.113.9",
        max_attempts=10,
        window_seconds=3600,
        r=fake_redis,
    )

    assert allowed is True
    assert count == 2
    assert retry_after == 15
    fake_redis.incr.assert_called_once_with("rate_limit:signup:203.0.113.9")


@pytest.mark.parametrize(
    "func,expected_key,max_attempts,window_seconds",
    [
        (check_login_rate_limit, "login:203.0.113.9", 30, 5 * 60),
        (check_signup_rate_limit, "signup:203.0.113.9", 10, 60 * 60),
        (check_refresh_rate_limit, "refresh:203.0.113.9", 60, 60),
        (check_api_token_rate_limit, "api_token:203.0.113.9", 10, 60 * 60),
    ],
)
def test_ip_based_wrappers_delegate_with_expected_limits(
    func, expected_key, max_attempts, window_seconds
):
    request = _request(client_host="203.0.113.9")

    with patch(
        "src.services.security.rate_limiting.get_client_ip",
        return_value="203.0.113.9",
    ), patch(
        "src.services.security.rate_limiting.check_rate_limit",
        return_value=(True, 1, 9),
    ) as mock_check:
        allowed, retry_after = func(request)

    assert allowed is True
    assert retry_after == 9
    mock_check.assert_called_once_with(
        key=expected_key,
        max_attempts=max_attempts,
        window_seconds=window_seconds,
    )


@pytest.mark.parametrize(
    "func,input_value,expected_key",
    [
        (check_verification_resend_rate_limit, "User@Example.com", "verify_resend:user@example.com"),
        (check_password_reset_rate_limit, "User@Example.com", "password_reset:user@example.com"),
        (check_email_verification_rate_limit, "User@Example.com", "email_verify:user@example.com"),
    ],
)
def test_email_based_wrappers_lowercase_inputs(func, input_value, expected_key):
    with patch(
        "src.services.security.rate_limiting.check_rate_limit",
        return_value=(False, 1, 33),
    ) as mock_check:
        allowed, retry_after = func(input_value)

    assert allowed is False
    assert retry_after == 33
    mock_check.assert_called_once()
    assert mock_check.call_args.kwargs["key"] == expected_key
