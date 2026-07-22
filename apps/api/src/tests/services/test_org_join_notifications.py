"""Tests for src/services/orgs/join_notifications.py."""

import re
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from src.db.users import User
from src.services.orgs.join_notifications import notify_user_joined_org


def _cta_hrefs(body: str) -> list[str]:
    """The href of every link (button) in an email body."""
    return re.findall(r'href="([^"]+)"', body)


async def _make_user(db, **overrides):
    user = User(
        username=overrides.pop("username", "joiner"),
        first_name="Join",
        last_name="User",
        email=overrides.pop("email", "joiner@test.com"),
        password="hashed",
        user_uuid=overrides.pop("user_uuid", "user_notify"),
        email_verified=True,
        signup_method="email",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


class TestNotifyUserJoinedOrg:
    @pytest.mark.asyncio
    async def test_sends_org_scoped_greeting(self, mock_request, db, org):
        user = await _make_user(db)

        org_host = "https://acme.test"
        with patch(
            "src.services.email.utils.get_org_signup_base_url",
            new=AsyncMock(return_value=org_host + "/"),
        ), patch(
            "src.services.users.emails.send_email", return_value=True
        ) as send_email:
            await notify_user_joined_org(mock_request, db, user, org.id)

        call = send_email.call_args.kwargs
        assert call["to"] == "joiner@test.com"
        assert org.name in call["subject"]
        # Lands the user in the org they just joined, on the org's own host.
        # Not `/home`: that is the org picker on every host, so it would send
        # them straight back out of the org this email is about.
        hrefs = _cta_hrefs(call["body"])
        assert any(h == org_host for h in hrefs)
        assert not any(h.endswith("/home") for h in hrefs)

    @pytest.mark.asyncio
    async def test_skips_user_without_email(self, mock_request, db, org):
        user = await _make_user(db, email="", user_uuid="user_no_email")

        with patch("src.services.users.emails.send_email") as send_email:
            await notify_user_joined_org(mock_request, db, user, org.id)

        send_email.assert_not_called()

    @pytest.mark.asyncio
    async def test_unknown_org_sends_nothing(self, mock_request, db):
        user = await _make_user(db, user_uuid="user_no_org")

        with patch("src.services.users.emails.send_email") as send_email:
            await notify_user_joined_org(mock_request, db, user, 999999)

        send_email.assert_not_called()

    @pytest.mark.asyncio
    async def test_mail_failure_never_propagates(self, mock_request, db, org):
        """A dead mail provider must not fail the join it is reporting on."""
        user = await _make_user(db, user_uuid="user_mail_down")

        with patch(
            "src.services.users.emails.send_email",
            side_effect=RuntimeError("provider down"),
        ):
            await notify_user_joined_org(mock_request, db, user, org.id)
