"""A transactional email failing must never fail the request behind it.

Every case here comes from a production incident:

* a Resend daily-quota exhaustion 503'd OAuth logins and ``POST /api/v1/users/``
  signups over mail that was a side effect of an action already committed, and
  raised one Sentry event per failed send (267 in a day). Only the welcome/
  lifecycle half is silenced here — the quota error carries the same stack and
  the same message for every sender, so password-reset, invitation and
  verification mail (all still ``critical=True``) will keep paging during a
  quota outage, by design;
* a provider rejection of a placeholder recipient domain (``example.com``,
  ``.invalid``) came back as a transient 503, inviting a retry that can never
  succeed;
* a single Resend read timeout, taken on the event loop of a single-worker
  uvicorn, froze every other in-flight request on the pod.
"""

import asyncio
import json
import logging
import threading
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
import redis
import resend
import resend.exceptions as resend_exceptions
from fastapi import HTTPException
from sqlmodel import select

from src.db.users import AnonymousUser, User, UserCreate, UserRead
from src.services.email.utils import (
    _RESEND_TIMEOUT_SECONDS,
    _is_recipient_rejected,
    _pin_resend_timeout,
    send_email,
    send_email_in_threadpool,
)
from src.services.users.email_verification import resend_verification_email
from src.services.users.emails import (
    _send_notification_email,
    send_account_creation_email,
    send_password_reset_email_platform,
)
from src.services.users.password_reset import send_reset_password_code_platform
from src.services.users.users import create_user, create_user_without_org


def _mailing_config():
    mailing = SimpleNamespace(
        email_provider="resend",
        system_email_address="system@test.com",
        resend_api_key="resend-test-key",
        smtp_host="smtp.test",
        smtp_port=587,
        smtp_username="user",
        smtp_password="pass",
        smtp_use_tls=True,
        system_email_sender_name="LearnHouse",
    )
    return SimpleNamespace(
        hosting_config=SimpleNamespace(
            allowed_origins=[],
            allowed_regexp="",
            self_hosted=False,
            tenancy="multi",
            domain="learnhouse.app",
            frontend_domain="app.learnhouse.app",
            ssl=True,
        ),
        general_config=SimpleNamespace(development_mode=False),
        mailing_config=mailing,
    )


def _quota_exhausted():
    return resend_exceptions.RateLimitError(
        message="You have reached your daily email sending quota",
        error_type="rate_limit_exceeded",
        code=429,
    )


def _recipient_rejected():
    return resend_exceptions.ValidationError(
        message=(
            "Invalid `to` field. Please use our testing email address instead "
            "of domains like `example.com`."
        ),
        error_type="validation_error",
        code=400,
    )


def _user_read():
    return UserRead(
        id=1,
        username="user",
        first_name="User",
        last_name="Test",
        email="user@test.com",
        user_uuid="user_uuid",
        email_verified=True,
        avatar_image="",
        bio="",
    )


def _user_create(username: str, email: str):
    return UserCreate(
        username=username,
        first_name="New",
        last_name="User",
        email=email,
        password="Password123!",
    )


# ---------------------------------------------------------------------------
# Permanent vs transient classification
# ---------------------------------------------------------------------------


class TestPermanentFailuresAreNeverRetried:
    def test_recipient_rejection_raises_422_and_sends_once(self):
        """A rejected recipient is permanent, so it must not look transient.

        503 tells the caller (and any proxy, and the admin re-clicking the
        button) to try again; nothing about `example.com` will be different
        next time.
        """
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_mailing_config(),
        ), patch(
            "src.services.email.utils.resend.Emails.send",
            side_effect=_recipient_rejected(),
        ) as mock_send:
            with pytest.raises(HTTPException) as exc_info:
                send_email("nobody@example.com", "Subject", "<p>Body</p>")

        assert exc_info.value.status_code == 422
        assert mock_send.call_count == 1

    @pytest.mark.parametrize(
        "failure,expected",
        [
            (_recipient_rejected(), True),
            (
                resend_exceptions.ValidationError(
                    message="Invalid `from` field. The domain is not verified.",
                    error_type="validation_error",
                    code=400,
                ),
                False,
            ),
            (
                resend_exceptions.MissingRequiredFieldsError(
                    message="Missing `subject` field",
                    error_type="missing_required_field",
                    code=422,
                ),
                False,
            ),
            (
                resend_exceptions.ApplicationError(
                    message="Something went wrong",
                    error_type="application_error",
                    code=500,
                ),
                False,
            ),
            # Nudge mail sets a Reply-To header from the org's configured
            # contact address, so a bad contact address is a live source of
            # reply_to validation errors. Resend backticks the field name
            # today; the second case is the same error without them, which a
            # bare `"to field" in message` substring test misreads as a
            # recipient rejection and buries at warning level.
            (
                resend_exceptions.ValidationError(
                    message="Invalid `reply_to` field. Expected a string.",
                    error_type="validation_error",
                    code=400,
                ),
                False,
            ),
            (
                resend_exceptions.ValidationError(
                    message="Invalid reply_to field. Expected a string.",
                    error_type="validation_error",
                    code=400,
                ),
                False,
            ),
        ],
    )
    def test_only_a_to_field_validation_error_counts_as_a_rejection(
        self, failure, expected
    ):
        """Broadening this predicate would silence real outages.

        An unverified sending domain, a template regression that drops the
        subject, or a provider 5xx all break mail for everybody and must keep
        paging — only an error naming the `to` field is about one address.
        """
        assert _is_recipient_rejected(failure) is expected

    def test_quota_exhaustion_is_not_retried(self):
        """Retrying a daily-quota error only doubles the load that caused it."""
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_mailing_config(),
        ), patch(
            "src.services.email.utils.resend.Emails.send",
            side_effect=_quota_exhausted(),
        ) as mock_send:
            with pytest.raises(HTTPException) as exc_info:
                send_email("user@test.com", "Subject", "<p>Body</p>")

        assert exc_info.value.status_code == 503
        assert mock_send.call_count == 1

    def test_transient_timeout_retries_once_and_succeeds(self):
        """The read timeout that 503'd a password reset now self-heals."""
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_mailing_config(),
        ), patch(
            "src.services.email.utils.resend.Emails.send",
            side_effect=[
                resend_exceptions.ResendError(
                    message="Request failed: read timed out",
                    error_type="HttpClientError",
                    code=500,
                    suggested_action="retry",
                ),
                {"id": "msg-1"},
            ],
        ) as mock_send, patch("src.services.email.utils.time.sleep"):
            result = send_email("user@test.com", "Subject", "<p>Body</p>")

        assert result == {"id": "msg-1"}
        assert mock_send.call_count == 2


# ---------------------------------------------------------------------------
# Log level: who is waiting on this message?
# ---------------------------------------------------------------------------


class TestOnlyAwaitedMailPages:
    """Sentry's LoggingIntegration captures at ERROR (apps/api/app.py).

    So the log level a delivery failure gets IS the alerting policy: mail
    somebody is waiting on must page, mail nobody is waiting on must not.
    """

    def _quota_records(self, critical):
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_mailing_config(),
        ), patch(
            "src.services.email.utils.resend.Emails.send",
            side_effect=_quota_exhausted(),
        ), patch("src.services.email.utils.logger") as mock_logger:
            with pytest.raises(HTTPException) as exc_info:
                send_email(
                    "user@test.com", "Subject", "<p>Body</p>", critical=critical
                )
        assert exc_info.value.status_code == 503
        return mock_logger

    def test_non_critical_failure_stays_below_sentrys_capture_level(self):
        """The 267 identical Sentry events in one day came from this line.

        This removes the welcome/lifecycle contribution only: mail sent after
        the action it describes was already committed, which no operator could
        act on. The transactional senders below still page, so the issue is
        quieter, not closed.
        """
        mock_logger = self._quota_records(critical=False)
        mock_logger.error.assert_not_called()
        mock_logger.warning.assert_called_once()

    def test_critical_failure_still_pages(self):
        mock_logger = self._quota_records(critical=True)
        mock_logger.error.assert_called_once()

    def test_notification_wrapper_sends_as_non_critical(self):
        """The wrapper is what marks welcome/lifecycle mail unwatched."""
        with patch(
            "src.services.users.emails.send_email", return_value=True
        ) as mock_send:
            _send_notification_email(
                to="user@test.com", subject="Welcome", body="<p>hi</p>"
            )

        assert mock_send.call_args.kwargs["critical"] is False

    def test_password_reset_sender_stays_critical(self):
        """Mail the user is actively waiting on must keep its error log."""
        with patch(
            "src.services.users.emails.send_email", return_value=True
        ) as mock_send:
            send_password_reset_email_platform(
                generated_reset_code="RESET123",
                user=_user_read(),
                email="user@test.com",
                base_url="https://learnhouse.test",
            )

        assert mock_send.call_args.kwargs.get("critical", True) is True


# ---------------------------------------------------------------------------
# Account creation survives a dead mail provider
# ---------------------------------------------------------------------------


class TestAccountCreationSurvivesMailFailure:
    def test_welcome_email_swallows_provider_failure(self):
        """The OAuth login path must not inherit the provider's 503."""
        with patch(
            "src.services.users.emails.send_email",
            side_effect=HTTPException(status_code=503, detail="unavailable"),
        ):
            assert (
                send_account_creation_email(user=_user_read(), email="user@test.com")
                is False
            )

    @pytest.mark.asyncio
    async def test_create_user_returns_the_account_when_verification_mail_fails(
        self, mock_request, db, admin_user, org
    ):
        """The User row is committed before the email is attempted.

        Raising here answered 503 for a signup that had actually succeeded; the
        retry then answered "Email or username is already in use", which reads
        to the user as the account not existing.
        """
        with patch(
            "src.services.users.users.validate_password_complexity",
            return_value=Mock(is_valid=True),
        ), patch("src.services.users.users.check_limits_with_usage"), patch(
            "src.services.users.users.increase_feature_usage"
        ), patch(
            "src.services.users.users.track", new_callable=AsyncMock
        ), patch(
            "src.services.users.users.dispatch_webhooks", new_callable=AsyncMock
        ), patch(
            "src.services.users.email_verification.send_verification_email",
            new_callable=AsyncMock,
            side_effect=HTTPException(
                status_code=503, detail="Email service temporarily unavailable"
            ),
        ), patch(
            "src.services.users.users.get_deployment_mode", return_value="saas"
        ), patch(
            "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
            new_callable=AsyncMock,
        ):
            created = await create_user(
                mock_request,
                db,
                admin_user,
                _user_create("mailless", "mailless@test.com"),
                org.id,
            )

        assert created.email == "mailless@test.com"
        persisted = (
            await db.execute(select(User).where(User.email == "mailless@test.com"))
        ).scalars().first()
        assert persisted is not None

    @pytest.mark.asyncio
    async def test_orgless_signup_survives_a_rejected_recipient_domain(
        self, mock_request, db, admin_user
    ):
        """The permanent 422 must not fail the signup either.

        A rejection is not retryable, so failing the request strands the user
        on an account that already exists with no way to re-request mail.
        """
        with patch(
            "src.services.users.users.validate_password_complexity",
            return_value=Mock(is_valid=True),
        ), patch(
            "src.services.users.email_verification.send_verification_email",
            new_callable=AsyncMock,
            side_effect=HTTPException(
                status_code=422,
                detail="The recipient email address was rejected by the email provider",
            ),
        ), patch(
            "src.services.users.users.get_deployment_mode", return_value="saas"
        ), patch(
            "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
            new_callable=AsyncMock,
        ):
            created = await create_user_without_org(
                mock_request,
                db,
                admin_user,
                _user_create("rejected", "rejected@example.com"),
            )

        assert created.email == "rejected@example.com"
        assert created.email_verified is False


# ---------------------------------------------------------------------------
# The provider client blocks — it must not block the event loop
# ---------------------------------------------------------------------------


class TestSendsDoNotBlockTheEventLoop:
    @pytest.mark.asyncio
    async def test_threadpool_helper_runs_off_the_loop_thread(self):
        seen = {}

        def blocking_send(**kwargs):
            seen["main_thread"] = threading.current_thread() is threading.main_thread()
            seen["kwargs"] = kwargs
            return True

        assert await send_email_in_threadpool(blocking_send, to="a@test.com") is True
        assert seen["main_thread"] is False
        assert seen["kwargs"] == {"to": "a@test.com"}

    @pytest.mark.asyncio
    async def test_platform_password_reset_send_is_offloaded(
        self, mock_request, db, regular_user
    ):
        """Pins the offload at the call site, not just in the helper.

        resend is `requests` with a multi-second read timeout; awaiting it
        inline parks the only uvicorn worker for its full duration.
        """
        on_main_thread = []

        def recording_send(**kwargs):
            on_main_thread.append(
                threading.current_thread() is threading.main_thread()
            )
            return True

        fake_redis = Mock()
        with patch(
            "src.services.users.password_reset._get_redis_connection",
            return_value=fake_redis,
        ), patch(
            "src.services.users.password_reset.get_base_url_from_request",
            return_value="https://learnhouse.test",
        ), patch(
            "src.services.users.password_reset.send_password_reset_email_platform",
            new=recording_send,
        ):
            result = await send_reset_password_code_platform(
                mock_request, db, AnonymousUser(), regular_user.email
            )

        assert result.startswith("If an account")
        assert on_main_thread == [False]
        # The reset code was still stored, so the offload did not skip the flow.
        assert json.loads(fake_redis.set.call_args.args[1])["reset_code"]

    @pytest.mark.asyncio
    async def test_two_slow_sends_overlap_instead_of_serialising(self):
        """Two concurrent sends must not queue behind each other on the loop."""

        def slow_send(**kwargs):
            time.sleep(0.4)
            return True

        started = time.monotonic()
        await asyncio.gather(
            send_email_in_threadpool(slow_send, to="a@test.com"),
            send_email_in_threadpool(slow_send, to="b@test.com"),
        )
        elapsed = time.monotonic() - started

        assert elapsed < 0.7, f"sends serialised on the event loop ({elapsed:.2f}s)"

    @pytest.mark.asyncio
    async def test_org_created_send_is_offloaded(self, mock_request, db, org):
        """Org creation is a request the user is watching, on the shared worker.

        The confirmation mail is best-effort, but inline it still parked the
        loop for the provider's whole timeout — for every request on the pod,
        not just this one.
        """
        from src.services.orgs.orgs import _try_send_org_created

        on_main_thread = []

        def recording_send(**kwargs):
            on_main_thread.append(
                threading.current_thread() is threading.main_thread()
            )
            return True

        with patch(
            "src.services.email.utils.get_org_signup_base_url",
            new=AsyncMock(return_value="https://acme.test/"),
        ), patch(
            "src.services.users.emails.send_org_created_email", new=recording_send
        ):
            await _try_send_org_created(
                mock_request, org, SimpleNamespace(email="creator@test.com"), db
            )

        assert on_main_thread == [False]


# ---------------------------------------------------------------------------
# A swallow must not become a silence
# ---------------------------------------------------------------------------


def _error_records(caplog, logger_name):
    return [
        r for r in caplog.records if r.name == logger_name and r.levelno >= logging.ERROR
    ]


class TestSwallowedFailuresStillReachSentry:
    """Swallowing the send is right; swallowing the signal is not.

    The signup guards catch every exception so a dead provider cannot 503 a
    signup that already committed. But ``send_verification_email`` also opens a
    Redis connection, reads the Organization tables and renders a template, and
    Sentry's LoggingIntegration only captures at ``logging.ERROR``
    (apps/api/app.py). Logging the whole guard at warning meant a Redis outage
    returned 200 to every SaaS signup, wrote no token, sent no mail and produced
    zero Sentry events — nobody paged while every new account was unverifiable.

    So the level is split by cause. These tests pin both halves: the provider
    case stays quiet (``send_email`` already reported it), everything else pages.
    """

    _USERS_LOGGER = "src.services.users.users"

    def _signup_patches(self):
        return (
            patch(
                "src.services.users.users.validate_password_complexity",
                return_value=Mock(is_valid=True),
            ),
            patch("src.services.users.users.get_deployment_mode", return_value="saas"),
            patch(
                "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
                new_callable=AsyncMock,
            ),
        )

    async def _signup_with_failing_verification(
        self, mock_request, db, admin_user, failure, username, email
    ):
        complexity, mode, authz = self._signup_patches()
        with complexity, mode, authz, patch(
            "src.services.users.email_verification.send_verification_email",
            new_callable=AsyncMock,
            side_effect=failure,
        ):
            return await create_user_without_org(
                mock_request, db, admin_user, _user_create(username, email)
            )

    @pytest.mark.asyncio
    async def test_redis_outage_during_signup_pages(
        self, mock_request, db, admin_user, caplog
    ):
        """The exact incident this guard could have hidden.

        ``get_redis_connection`` raises HTTPException(500) when the connection
        string is missing or the client cannot be built. Nothing else logs it,
        so a guard that records it at warning never lets it leave the pod.
        """
        with caplog.at_level(logging.WARNING, logger=self._USERS_LOGGER):
            created = await self._signup_with_failing_verification(
                mock_request,
                db,
                admin_user,
                HTTPException(status_code=500, detail="Could not connect to Redis"),
                "redisdown",
                "redisdown@test.com",
            )

        # Still a successful signup — the swallow itself is not the bug.
        assert created.email == "redisdown@test.com"
        errors = _error_records(caplog, self._USERS_LOGGER)
        assert errors, "a Redis failure during signup produced no ERROR record"
        assert errors[0].exc_info is not None, "no traceback attached for Sentry"

    @pytest.mark.asyncio
    async def test_non_http_failure_during_signup_pages(
        self, mock_request, db, admin_user, caplog
    ):
        """Redis client errors are not HTTPExceptions at all."""
        with caplog.at_level(logging.WARNING, logger=self._USERS_LOGGER):
            created = await self._signup_with_failing_verification(
                mock_request,
                db,
                admin_user,
                redis.exceptions.ConnectionError("Connection refused"),
                "redisrefused",
                "redisrefused@test.com",
            )

        assert created.email == "redisrefused@test.com"
        assert _error_records(caplog, self._USERS_LOGGER)

    @pytest.mark.asyncio
    async def test_provider_delivery_failure_during_signup_stays_quiet(
        self, mock_request, db, admin_user, caplog
    ):
        """``send_email`` already emitted this one — a second event is noise."""
        with caplog.at_level(logging.WARNING, logger=self._USERS_LOGGER):
            created = await self._signup_with_failing_verification(
                mock_request,
                db,
                admin_user,
                HTTPException(
                    status_code=503, detail="Email service temporarily unavailable"
                ),
                "quiet",
                "quiet@test.com",
            )

        assert created.email == "quiet@test.com"
        assert not _error_records(caplog, self._USERS_LOGGER)
        # ...but it is still recorded, just below Sentry's capture level.
        assert [r for r in caplog.records if r.name == self._USERS_LOGGER]

    @pytest.mark.asyncio
    async def test_org_signup_guard_splits_the_level_too(
        self, mock_request, db, admin_user, org, caplog
    ):
        """The org-signup guard is a second copy of the same swallow."""
        complexity, mode, authz = self._signup_patches()
        with caplog.at_level(
            logging.WARNING, logger=self._USERS_LOGGER
        ), complexity, mode, authz, patch(
            "src.services.users.users.check_limits_with_usage"
        ), patch(
            "src.services.users.users.increase_feature_usage"
        ), patch(
            "src.services.users.users.track", new_callable=AsyncMock
        ), patch(
            "src.services.users.users.dispatch_webhooks", new_callable=AsyncMock
        ), patch(
            "src.services.users.email_verification.send_verification_email",
            new_callable=AsyncMock,
            side_effect=HTTPException(
                status_code=500, detail="Redis connection string not found"
            ),
        ):
            created = await create_user(
                mock_request,
                db,
                admin_user,
                _user_create("orgredis", "orgredis@test.com"),
                org.id,
            )

        assert created.email == "orgredis@test.com"
        assert _error_records(caplog, self._USERS_LOGGER)

    def test_notification_wrapper_pages_on_a_non_delivery_failure(self, caplog):
        """The lifecycle-mail wrapper has the same shape and had the same hole.

        A template regression or a config blow-up inside ``send_email`` is our
        bug, not the provider's, and nothing else records it.
        """
        logger_name = "src.services.users.emails"
        with caplog.at_level(logging.WARNING, logger=logger_name), patch(
            "src.services.users.emails.send_email", side_effect=KeyError("cta_url")
        ):
            assert (
                _send_notification_email(
                    to="user@test.com", subject="Welcome", body="<p>hi</p>"
                )
                is False
            )

        assert _error_records(caplog, logger_name)

    def test_notification_wrapper_stays_quiet_on_a_delivery_failure(self, caplog):
        """The 267-event quota day must not come back through this path."""
        logger_name = "src.services.users.emails"
        with caplog.at_level(logging.WARNING, logger=logger_name), patch(
            "src.services.users.emails.send_email",
            side_effect=HTTPException(
                status_code=503, detail="Email service temporarily unavailable"
            ),
        ):
            assert (
                _send_notification_email(
                    to="user@test.com", subject="Welcome", body="<p>hi</p>"
                )
                is False
            )

        assert not _error_records(caplog, logger_name)

    @pytest.mark.asyncio
    async def test_missing_org_row_pages_from_the_raise_site(
        self, mock_request, db, regular_user, caplog
    ):
        """The one org-table failure the swallow cannot classify.

        ``send_verification_email`` raises 400 when the org row is missing, and
        400 is in ``EMAIL_DELIVERY_STATUS_CODES`` because ``send_email`` uses it
        for an invalid recipient — so every caller's swallow files this as a
        delivery failure and keeps it at warning, below Sentry's capture level.
        It is not a delivery failure: the signup just linked the account to that
        org_id. Logging it where it is raised is what closes that hole, and it
        does not depend on matching ``detail`` text at the swallow site.
        """
        from src.services.users.email_verification import send_verification_email

        logger_name = "src.services.users.email_verification"
        with caplog.at_level(logging.WARNING, logger=logger_name):
            with pytest.raises(HTTPException) as exc_info:
                await send_verification_email(
                    mock_request, db, regular_user, org_id=999999
                )

        assert exc_info.value.status_code == 400
        assert _error_records(caplog, logger_name)


# ---------------------------------------------------------------------------
# The recovery path has to survive the outage it recovers from
# ---------------------------------------------------------------------------


class TestResendVerificationIsTheRecoveryPath:
    """Signup's swallow is only acceptable because resend-verification exists.

    It was the one call site not wrapped, so during a provider outage the
    recovery endpoint failed too. Failing also breaks its own documented
    contract: a 422 "recipient rejected" is deterministic and per-address and is
    only reachable when the account exists AND is unverified, which makes it an
    account-enumeration oracle.
    """

    async def _unverified_user(self, db, regular_user):
        user = (
            await db.execute(select(User).where(User.email == regular_user.email))
        ).scalars().first()
        user.email_verified = False
        db.add(user)
        await db.commit()
        return user

    @pytest.mark.asyncio
    async def test_provider_failure_still_returns_the_generic_response(
        self, mock_request, db, regular_user, org, caplog
    ):
        user = await self._unverified_user(db, regular_user)
        logger_name = "src.services.users.email_verification"
        with caplog.at_level(logging.WARNING, logger=logger_name), patch(
            "src.services.users.email_verification.check_verification_resend_rate_limit",
            return_value=(True, 0),
        ), patch(
            "src.services.users.email_verification.send_verification_email",
            new_callable=AsyncMock,
            side_effect=HTTPException(
                status_code=422,
                detail="The recipient email address was rejected by the email provider",
            ),
        ):
            result = await resend_verification_email(
                mock_request, db, user.email, org.id
            )

        # Byte-identical to the response for an address that does not exist.
        assert result.startswith("If an account")
        assert not _error_records(caplog, logger_name)

    @pytest.mark.asyncio
    async def test_redis_failure_on_the_recovery_path_pages(
        self, mock_request, db, regular_user, org, caplog
    ):
        user = await self._unverified_user(db, regular_user)
        logger_name = "src.services.users.email_verification"
        with caplog.at_level(logging.WARNING, logger=logger_name), patch(
            "src.services.users.email_verification.check_verification_resend_rate_limit",
            return_value=(True, 0),
        ), patch(
            "src.services.users.email_verification.send_verification_email",
            new_callable=AsyncMock,
            side_effect=HTTPException(
                status_code=500, detail="Could not connect to Redis"
            ),
        ):
            result = await resend_verification_email(
                mock_request, db, user.email, org.id
            )

        assert result.startswith("If an account")
        assert _error_records(caplog, logger_name)


# ---------------------------------------------------------------------------
# The provider client's own timeout
# ---------------------------------------------------------------------------


class TestResendClientTimeoutIsPinned:
    """The only part of this sweep that changes real provider behaviour.

    ``resend/request.py`` reads ``resend.default_http_client`` at call time, so
    swapping the module attribute at import takes effect — but an SDK bump that
    renames ``RequestsClient`` or stops reading ``default_http_client`` would
    silently restore the 30s read timeout with a green suite. It is also a
    module-level side effect shared with ``src/services/nudges/delivery.py``.
    """

    def test_import_pins_the_read_timeout(self):
        assert (
            getattr(resend.default_http_client, "_timeout", None)
            == _RESEND_TIMEOUT_SECONDS
        )

    def test_pin_is_a_no_op_when_the_sdk_has_no_pluggable_client(self):
        """An SDK without RequestsClient must not crash the import."""
        before = resend.default_http_client
        with patch.object(resend, "RequestsClient", None):
            _pin_resend_timeout()
        assert resend.default_http_client is before
