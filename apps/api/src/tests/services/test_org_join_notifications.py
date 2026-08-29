"""Tests for src/services/orgs/join_notifications.py."""

import re
import threading
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

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

    @pytest.mark.asyncio
    async def test_send_runs_off_the_event_loop_thread(self, mock_request, db, org):
        """The provider client blocks; admin provisioning walks this per user.

        Inline, one stalled send parks the single uvicorn worker for the whole
        timeout-plus-retry window and every unrelated request with it.
        """
        user = await _make_user(db, user_uuid="user_offload")
        on_main_thread = []

        def recording_send(**kwargs):
            on_main_thread.append(threading.current_thread() is threading.main_thread())
            return True

        with patch(
            "src.services.email.utils.get_org_signup_base_url",
            new=AsyncMock(return_value="https://acme.test/"),
        ), patch("src.services.users.emails.send_email", new=recording_send):
            await notify_user_joined_org(mock_request, db, user, org.id)

        assert on_main_thread == [False]

    @pytest.mark.asyncio
    async def test_lookup_failure_is_logged_at_error(self, mock_request, db, org):
        """The swallow also covers the queries and the URL resolution.

        Those failures break the greeting on every join path and nothing else
        reports them, so a warning (which Sentry's ERROR-level capture never
        sees) would make them invisible.
        """
        user = await _make_user(db, user_uuid="user_url_broken")

        with patch(
            "src.services.email.utils.get_org_signup_base_url",
            new=AsyncMock(side_effect=RuntimeError("no base url")),
        ), patch(
            "src.services.orgs.join_notifications.logger.exception"
        ) as exception_mock, patch(
            "src.services.orgs.join_notifications.logger.warning"
        ) as warning_mock:
            await notify_user_joined_org(mock_request, db, user, org.id)

        exception_mock.assert_called_once()
        warning_mock.assert_not_called()

    @pytest.mark.asyncio
    async def test_delivery_failure_stays_at_warning(self, mock_request, db, org):
        """A provider failure has already logged itself inside `send_email`."""
        user = await _make_user(db, user_uuid="user_provider_down")

        with patch(
            "src.services.email.utils.get_org_signup_base_url",
            new=AsyncMock(return_value="https://acme.test/"),
        ), patch(
            "src.services.orgs.join_notifications.logger.exception"
        ) as exception_mock, patch(
            "src.services.orgs.join_notifications.logger.warning"
        ) as warning_mock, patch(
            "src.services.users.emails.send_org_join_email",
            side_effect=HTTPException(
                status_code=503, detail="Email service temporarily unavailable"
            ),
        ):
            await notify_user_joined_org(mock_request, db, user, org.id)

        warning_mock.assert_called_once()
        exception_mock.assert_not_called()
