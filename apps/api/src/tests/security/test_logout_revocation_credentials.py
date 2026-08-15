"""
``DELETE /auth/logout`` must revoke server-side sessions whenever it can name
the user — from the access token or from the refresh cookie.

It used to accept the access credential only. A caller presenting just the
refresh cookie got a 401, ``revoke_user_sessions_before`` never ran, and the
logout degraded to clearing cookies in the browser while every issued token
stayed live until natural expiry. Nothing failed loudly. These tests pin the
behaviour to the backend so it cannot regress on a client-side change.
"""

from unittest.mock import patch

import pytest
from fastapi import HTTPException, Response

from src.routers.auth import logout
from src.security.auth import (
    JWT_COOKIE_NAME,
    JWT_REFRESH_COOKIE_NAME,
    create_access_token,
    create_refresh_token,
)
from starlette.requests import Request


def _request_with_cookies(**cookies) -> Request:
    cookie_header = "; ".join(f"{name}={value}" for name, value in cookies.items())
    headers = [(b"cookie", cookie_header.encode())] if cookie_header else []
    return Request(
        {
            "type": "http",
            "method": "DELETE",
            "path": "/api/v1/auth/logout",
            "headers": headers,
            "query_string": b"",
        }
    )


@pytest.mark.asyncio
async def test_logout_revokes_with_access_cookie_only(db, admin_user):
    request = _request_with_cookies(
        **{JWT_COOKIE_NAME: create_access_token({"sub": admin_user.email})}
    )

    with patch("src.routers.auth.revoke_user_sessions_before") as revoke:
        await logout(request, Response(), db)

    revoke.assert_called_once_with(admin_user.id)


@pytest.mark.asyncio
async def test_logout_revokes_with_refresh_cookie_only(db, admin_user):
    """The half that broke: only the refresh cookie reaches the backend."""
    request = _request_with_cookies(
        **{JWT_REFRESH_COOKIE_NAME: create_refresh_token({"sub": admin_user.email})}
    )

    with patch("src.routers.auth.revoke_user_sessions_before") as revoke:
        await logout(request, Response(), db)

    revoke.assert_called_once_with(admin_user.id)


@pytest.mark.asyncio
async def test_logout_revokes_with_both_cookies(db, admin_user):
    request = _request_with_cookies(
        **{
            JWT_COOKIE_NAME: create_access_token({"sub": admin_user.email}),
            JWT_REFRESH_COOKIE_NAME: create_refresh_token({"sub": admin_user.email}),
        }
    )

    with patch("src.routers.auth.revoke_user_sessions_before") as revoke:
        await logout(request, Response(), db)

    revoke.assert_called_once_with(admin_user.id)


@pytest.mark.asyncio
async def test_logout_falls_back_to_refresh_when_access_token_is_junk(db, admin_user):
    """An expired or malformed access cookie must not shadow a usable refresh
    cookie — otherwise the most common real-world logout (stale access token)
    is exactly the one that skips revocation."""
    request = _request_with_cookies(
        **{
            JWT_COOKIE_NAME: "not-a-jwt",
            JWT_REFRESH_COOKIE_NAME: create_refresh_token({"sub": admin_user.email}),
        }
    )

    with patch("src.routers.auth.revoke_user_sessions_before") as revoke:
        await logout(request, Response(), db)

    revoke.assert_called_once_with(admin_user.id)


@pytest.mark.asyncio
async def test_logout_without_any_credential_is_unauthenticated(db):
    with patch("src.routers.auth.revoke_user_sessions_before") as revoke:
        with pytest.raises(HTTPException) as exc:
            await logout(_request_with_cookies(), Response(), db)

    assert exc.value.status_code == 401
    revoke.assert_not_called()
