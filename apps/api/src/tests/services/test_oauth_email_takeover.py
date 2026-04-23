"""
Regression tests for the F-03 Google OAuth account-takeover fix.

Before the fix, ``signWithGoogle`` fell back to the body-supplied email when
Google's userinfo response omitted it (which happens whenever the access token
was minted without the ``email`` scope). An attacker holding any valid Google
token could therefore submit a victim's email in the request body and receive
a session cookie for that victim.

The fix trusts only the Google-returned ``email`` + ``email_verified``.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException, Request

from src.services.auth.utils import signWithGoogle


@pytest.fixture
def mock_request(db):
    # ``signWithGoogle`` passes ``request`` straight to ``update_login_info`` /
    # ``create_user``; a bare Request with a client is enough for the code we
    # exercise here because all side-effecting branches are either mocked or
    # unreachable (we never hit the "create new user" branch).
    scope = {
        "type": "http",
        "method": "POST",
        "headers": [],
        "client": ("127.0.0.1", 0),
    }
    return Request(scope)


@pytest.mark.asyncio
async def test_rejects_when_google_omits_email(db, mock_request):
    """Access token without ``email`` scope: Google returns no email -> reject."""
    with patch(
        "src.services.auth.utils.get_google_user_info",
        new=AsyncMock(return_value={"sub": "attacker_sub", "name": "Attacker"}),
    ):
        with pytest.raises(HTTPException) as excinfo:
            await signWithGoogle(
                mock_request,
                access_token="attacker_token",
                email="victim@company.com",
                org_id=None,
                current_user=None,
                db_session=db,
            )
    assert excinfo.value.status_code == 401
    assert "verified email" in excinfo.value.detail.lower()


@pytest.mark.asyncio
async def test_rejects_when_google_email_not_verified(db, mock_request):
    """Google returns an email but flags it unverified -> reject."""
    with patch(
        "src.services.auth.utils.get_google_user_info",
        new=AsyncMock(
            return_value={
                "sub": "attacker_sub",
                "email": "victim@company.com",
                "email_verified": False,
            }
        ),
    ):
        with pytest.raises(HTTPException) as excinfo:
            await signWithGoogle(
                mock_request,
                access_token="attacker_token",
                email="victim@company.com",
                org_id=None,
                current_user=None,
                db_session=db,
            )
    assert excinfo.value.status_code == 401


@pytest.mark.asyncio
async def test_body_email_is_ignored_when_google_returns_different_email(
    db, mock_request, admin_user
):
    """
    When Google returns a *different* verified email than what the client
    submitted in the body, the server must trust Google's value. ``admin_user``
    fixture exists with ``admin@test.com``; we make Google report that email
    and have the client body falsely claim ``attacker@elsewhere.com``.
    """
    google_payload = {
        "sub": "google_admin_sub",
        "email": admin_user.email,
        "email_verified": True,
    }

    with patch(
        "src.services.auth.utils.get_google_user_info",
        new=AsyncMock(return_value=google_payload),
    ), patch("src.services.auth.utils.update_login_info", return_value=None):
        result = await signWithGoogle(
            mock_request,
            access_token="legit_google_token",
            email="attacker@elsewhere.com",
            org_id=None,
            current_user=None,
            db_session=db,
        )

    assert result.email == admin_user.email, (
        "server must key off Google's email, never the body-supplied one"
    )


@pytest.mark.asyncio
async def test_happy_path_matching_email(db, mock_request, admin_user):
    """A well-formed request where body email matches Google's email still works."""
    google_payload = {
        "sub": "google_admin_sub",
        "email": admin_user.email,
        "email_verified": True,
    }
    with patch(
        "src.services.auth.utils.get_google_user_info",
        new=AsyncMock(return_value=google_payload),
    ), patch("src.services.auth.utils.update_login_info", return_value=None):
        result = await signWithGoogle(
            mock_request,
            access_token="legit_google_token",
            email=admin_user.email,
            org_id=None,
            current_user=None,
            db_session=db,
        )

    assert result.email == admin_user.email
