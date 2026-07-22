"""Tests for the third_party_login OAuth handler in src/routers/auth.py.

Covers the unsupported-provider guard and the org_id validation block, which
must mirror the rules the email/password signup endpoints apply: an open org is
joinable by anyone, an invite-only org requires an invite.
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException, Response, status

from src.db.organization_config import OrganizationConfig
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, User
from src.routers.auth import third_party_login


async def _set_signup_mode(db, org_id: int, signup_mode: str):
    db.add(
        OrganizationConfig(
            org_id=org_id,
            config={
                "config_version": "1.0",
                "features": {"members": {"signup_mode": signup_mode}},
            },
        )
    )
    await db.commit()


def _google_body(email="invitee@example.com"):
    return SimpleNamespace(email=email, provider="google", access_token="tok")


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
async def test_third_party_login_rejects_unknown_org(db):
    with pytest.raises(HTTPException) as exc_info:
        await third_party_login(
            request=SimpleNamespace(),
            response=Response(),
            body=_google_body(),
            org_id=99999,
            current_user=AnonymousUser(),
            db_session=db,
        )

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
    assert exc_info.value.detail == "Invalid org_id"


@pytest.mark.asyncio
async def test_open_org_keeps_org_id_without_any_invite(db, org):
    """The bug this endpoint used to have: an open org still required a pending
    email invite, so a Google sign-up was created with no organization at all
    while the equivalent form signup joined the org."""
    await _set_signup_mode(db, org.id, "open")

    sign_with_google = AsyncMock(return_value=SimpleNamespace(id=7, email="invitee@example.com"))

    with patch("src.routers.auth.signWithGoogle", sign_with_google), patch(
        "src.routers.auth.set_auth_cookies"
    ), patch("src.routers.auth.UserRead") as user_read:
        user_read.model_validate.side_effect = lambda u: u
        await third_party_login(
            request=SimpleNamespace(),
            response=Response(),
            body=_google_body(),
            org_id=org.id,
            current_user=AnonymousUser(),
            db_session=db,
        )

    # org_id is passed through to the sign-in service instead of being dropped.
    assert sign_with_google.await_args.args[3] == org.id


@pytest.mark.asyncio
async def test_invite_only_org_without_invite_is_rejected(db, org):
    """No silent downgrade: the user is told they need an invite rather than
    being signed in with no organization."""
    await _set_signup_mode(db, org.id, "inviteOnly")

    mock_redis = Mock(get=Mock(return_value=None), close=Mock())
    mock_config = SimpleNamespace(
        redis_config=SimpleNamespace(redis_connection_string="redis://localhost:6379")
    )

    with patch(
        "src.routers.auth.get_learnhouse_config", return_value=mock_config
    ), patch("redis.Redis.from_url", return_value=mock_redis), patch(
        "src.routers.auth.get_google_user_info",
        AsyncMock(return_value={"email": "invitee@example.com", "email_verified": True}),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await third_party_login(
                request=SimpleNamespace(),
                response=Response(),
                body=_google_body(),
                org_id=org.id,
                current_user=AnonymousUser(),
                db_session=db,
            )

    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN
    mock_redis.get.assert_called_once_with(
        f"invited_user:invitee@example.com:org:{org.org_uuid}"
    )
    mock_redis.close.assert_called_once()


@pytest.mark.asyncio
async def test_invite_only_org_accepts_invite_code(db, org):
    """An invite *code* link is proof of invitation, exactly as it is for
    POST /users/{org_id}/invite/{code}."""
    await _set_signup_mode(db, org.id, "inviteOnly")

    sign_with_google = AsyncMock(return_value=SimpleNamespace(id=7, email="invitee@example.com"))

    with patch("src.routers.auth.signWithGoogle", sign_with_google), patch(
        "src.routers.auth.set_auth_cookies"
    ), patch("src.routers.auth.UserRead") as user_read, patch(
        "src.routers.auth.get_google_user_info",
        AsyncMock(return_value={"email": "invitee@example.com", "email_verified": True}),
    ), patch(
        "src.services.orgs.invites.get_invite_code",
        AsyncMock(return_value={"invite_code": "CODE123", "usergroup_id": None}),
    ):
        user_read.model_validate.side_effect = lambda u: u
        await third_party_login(
            request=SimpleNamespace(),
            response=Response(),
            body=_google_body(),
            org_id=org.id,
            invite_code="CODE123",
            current_user=AnonymousUser(),
            db_session=db,
        )

    assert sign_with_google.await_args.args[3] == org.id


@pytest.mark.asyncio
async def test_invite_only_org_lets_existing_member_sign_in(db, org):
    """The org cookie is set on the login page too, so an existing member must
    not be locked out of their own invite-only org."""
    await _set_signup_mode(db, org.id, "inviteOnly")

    user = User(
        email="Member@Example.com",
        username="member",
        first_name="Test",
        last_name="Member",
        password="",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    db.add(
        UserOrganization(
            user_id=user.id,
            org_id=org.id,
            role_id=4,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()

    sign_with_google = AsyncMock(return_value=SimpleNamespace(id=user.id, email=user.email))

    with patch("src.routers.auth.signWithGoogle", sign_with_google), patch(
        "src.routers.auth.set_auth_cookies"
    ), patch("src.routers.auth.UserRead") as user_read, patch(
        "src.routers.auth.get_google_user_info",
        AsyncMock(return_value={"email": "member@example.com", "email_verified": True}),
    ):
        user_read.model_validate.side_effect = lambda u: u
        await third_party_login(
            request=SimpleNamespace(),
            response=Response(),
            body=_google_body("member@example.com"),
            org_id=org.id,
            current_user=AnonymousUser(),
            db_session=db,
        )

    assert sign_with_google.await_args.args[3] == org.id


@pytest.mark.asyncio
async def test_invite_only_org_fails_loudly_when_redis_is_down(db, org):
    """Continuing here used to create an org-less account that looked like a
    successful signup."""
    await _set_signup_mode(db, org.id, "inviteOnly")

    mock_config = SimpleNamespace(
        redis_config=SimpleNamespace(redis_connection_string="redis://localhost:6379")
    )

    with patch(
        "src.routers.auth.get_learnhouse_config", return_value=mock_config
    ), patch("redis.Redis.from_url", side_effect=OSError("connection refused")), patch(
        "src.routers.auth.get_google_user_info",
        AsyncMock(return_value={"email": "invitee@example.com", "email_verified": True}),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await third_party_login(
                request=SimpleNamespace(),
                response=Response(),
                body=_google_body(),
                org_id=org.id,
                current_user=AnonymousUser(),
                db_session=db,
            )

    assert exc_info.value.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
