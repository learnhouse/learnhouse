"""Tests for src/services/email/utils.py."""

import smtplib
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request

import resend.exceptions as resend_exceptions

from src.services.email.utils import (
    _is_allowed_base_url,
    get_base_url_from_request,
    get_org_signup_base_url,
    send_email,
)


def _config(**overrides):
    hosting = SimpleNamespace(
        allowed_origins=overrides.pop("allowed_origins", []),
        allowed_regexp=overrides.pop("allowed_regexp", ""),
        self_hosted=overrides.pop("self_hosted", False),
        tenancy=overrides.pop("tenancy", "multi"),
        domain=overrides.pop("domain", "learnhouse.app"),
        frontend_domain=overrides.pop("frontend_domain", "app.learnhouse.app"),
        ssl=overrides.pop("ssl", True),
    )
    general = SimpleNamespace(
        development_mode=overrides.pop("development_mode", False),
    )
    mailing = SimpleNamespace(
        email_provider=overrides.pop("email_provider", "resend"),
        system_email_address=overrides.pop("system_email_address", "system@test.com"),
        resend_api_key=overrides.pop("resend_api_key", "resend-test-key"),
        smtp_host=overrides.pop("smtp_host", "smtp.test"),
        smtp_port=overrides.pop("smtp_port", 587),
        smtp_username=overrides.pop("smtp_username", "user"),
        smtp_password=overrides.pop("smtp_password", "pass"),
        smtp_use_tls=overrides.pop("smtp_use_tls", True),
        system_email_sender_name=overrides.pop(
            "system_email_sender_name", "LearnHouse"
        ),
    )
    return SimpleNamespace(
        hosting_config=hosting,
        general_config=general,
        mailing_config=mailing,
    )


def _request(headers=None, scheme="https", server=("api.test", 443)):
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [
            (key.encode(), value.encode()) for key, value in (headers or {}).items()
        ],
        "query_string": b"",
        "scheme": scheme,
        "server": server,
    }
    return Request(scope)


class TestEmailUtilsService:
    def test_is_allowed_base_url_matches_all_supported_sources(self):
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(
                allowed_origins=["https://app.test/"],
                allowed_regexp=r"^https://regex\.test$",
            ),
        ), patch.dict(
            "src.services.email.utils.os.environ",
            {"LEARNHOUSE_PLATFORM_URL": "https://www.platform.test"},
            clear=False,
        ):
            assert _is_allowed_base_url("https://app.test")
            assert _is_allowed_base_url("https://regex.test")
            assert _is_allowed_base_url("https://www.platform.test")

    def test_is_allowed_base_url_accepts_localhost_in_development(self):
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(development_mode=True),
        ):
            assert _is_allowed_base_url("http://localhost:3000")
            assert _is_allowed_base_url("http://127.0.0.1:8080")

    def test_is_allowed_base_url_invalid_regex_and_rejects_unknown_origin(self):
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(allowed_regexp="("),
        ), patch.dict(
            "src.services.email.utils.os.environ",
            {},
            clear=True,
        ):
            assert not _is_allowed_base_url("https://unknown.test")

    @pytest.mark.asyncio
    async def test_get_org_signup_base_url_uses_request_in_single_tenancy(self):
        request = _request({"origin": "https://app.test"})

        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(tenancy="single"),
        ), patch(
            "src.services.email.utils.get_base_url_from_request",
            return_value="https://fallback.test",
        ) as mock_base_url:
            assert await get_org_signup_base_url("acme", request) == "https://fallback.test"
            mock_base_url.assert_called_once_with(request)

    def test_is_allowed_base_url_pins_to_configured_host_in_single_tenancy(self):
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(tenancy="single"),
        ):
            assert _is_allowed_base_url("https://app.learnhouse.app")
            assert _is_allowed_base_url("https://learnhouse.app")
            assert _is_allowed_base_url("https://www.learnhouse.app")
            assert not _is_allowed_base_url("https://learn.example.org")
            assert not _is_allowed_base_url("javascript:alert(1)")
            assert not _is_allowed_base_url("https://")
            assert not _is_allowed_base_url("http://localhost:3000")

        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(tenancy="single", development_mode=True),
        ):
            assert _is_allowed_base_url("http://localhost:3000")

    def test_is_allowed_base_url_accepts_host_with_port_config_in_single_tenancy(self):
        # The shipped default config uses schemeless "host:port" values
        # (e.g. "localhost:3000"). The configured host must still match the
        # always-port-less request host instead of being silently rejected.
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(
                tenancy="single",
                frontend_domain="localhost:3000",
                domain="learn.myschool.org:8443",
            ),
        ):
            assert _is_allowed_base_url("http://localhost:3000")
            assert _is_allowed_base_url("https://learn.myschool.org:8443")
            assert _is_allowed_base_url("https://learn.myschool.org")
            assert not _is_allowed_base_url("https://evil.example.org")

    def test_is_allowed_base_url_skips_blank_configured_host_in_single_tenancy(self):
        # Line 36: a blank/whitespace configured value (here frontend_domain) is
        # skipped via `continue`; only the non-empty `domain` is honored.
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(
                tenancy="single",
                frontend_domain="   ",
                domain="learnhouse.app",
            ),
        ):
            assert _is_allowed_base_url("https://learnhouse.app")
            # The blank frontend_domain contributed no allowed host.
            assert not _is_allowed_base_url("https://other.example.org")

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "ssl,expected",
        [(True, "https://acme.learnhouse.app"), (False, "http://acme.learnhouse.app")],
    )
    async def test_get_org_signup_base_url_builds_org_subdomain(self, ssl, expected):
        request = _request({"origin": "https://app.test"})

        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(
                domain="learnhouse.app",
                ssl=ssl,
            ),
        ):
            assert await get_org_signup_base_url("acme", request) == expected

    @pytest.mark.asyncio
    async def test_get_org_signup_base_url_falls_back_for_invalid_or_localhost_domain(
        self,
    ):
        request = _request({"origin": "https://app.test"})

        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(domain="", ssl=True),
        ), patch(
            "src.services.email.utils.get_base_url_from_request",
            return_value="https://fallback.test",
        ) as mock_base_url:
            assert await get_org_signup_base_url("acme", request) == "https://fallback.test"
            mock_base_url.assert_called_once_with(request)

        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(domain="localhost:3000", ssl=True),
        ), patch(
            "src.services.email.utils.get_base_url_from_request",
            return_value="https://fallback.test",
        ) as mock_base_url:
            assert await get_org_signup_base_url("acme", request) == "https://fallback.test"
            mock_base_url.assert_called_once_with(request)

    def test_get_base_url_from_request_prefers_valid_origin_then_referer(
        self,
    ):
        origin_request = _request(
            {
                "origin": "https://allowed.test/",
                "referer": "https://ignored.test/path",
            }
        )
        referer_request = _request(
            {
                "origin": "https://blocked.test",
                "referer": "https://allowed-ref.test/path?q=1",
            }
        )

        with patch(
            "src.services.email.utils._is_allowed_base_url",
            side_effect=[True, False, True],
        ):
            assert get_base_url_from_request(origin_request) == "https://allowed.test"
            assert (
                get_base_url_from_request(referer_request)
                == "https://allowed-ref.test"
            )

    def test_get_base_url_from_request_uses_frontend_then_request_url(self):
        frontend_request = _request({"origin": "https://blocked.test"})
        url_request = _request({}, scheme="http", server=("api.learnhouse.test", 8080))

        with patch(
            "src.services.email.utils._is_allowed_base_url",
            return_value=False,
        ), patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(frontend_domain="frontend.learnhouse.app"),
        ):
            assert (
                get_base_url_from_request(frontend_request)
                == "https://frontend.learnhouse.app"
            )

        with patch(
            "src.services.email.utils._is_allowed_base_url",
            return_value=False,
        ), patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(frontend_domain=""),
        ):
            assert get_base_url_from_request(url_request) == "http://api.learnhouse.test:8080"

    def test_get_base_url_from_request_warns_on_untrusted_referer(self):
        request = _request({"referer": "https://blocked.test/path"})

        with patch(
            "src.services.email.utils._is_allowed_base_url",
            return_value=False,
        ), patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(frontend_domain="frontend.learnhouse.app"),
        ), patch(
            "src.services.email.utils.logger.warning"
        ) as mock_warning:
            assert (
                get_base_url_from_request(request)
                == "https://frontend.learnhouse.app"
            )

        mock_warning.assert_called_once_with(
            "Rejected untrusted Referer header for email URL: %s",
            "https://blocked.test",
        )

    def test_send_email_routes_to_resend_and_smtp(self):
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(
                email_provider="resend",
                system_email_address="system@test.com",
                resend_api_key="resend-key",
            ),
        ), patch(
            "src.services.email.utils.resend.Emails.send",
            return_value={"id": "msg-1"},
        ) as mock_resend_send:
            result = send_email("to@test.com", "Hello", "<p>Body</p>")

        assert result == {"id": "msg-1"}
        assert send_email.__module__ == "src.services.email.utils"
        assert mock_resend_send.call_args.args[0] == {
            "from": "LearnHouse <system@test.com>",
            "to": ["to@test.com"],
            "subject": "Hello",
            "html": "<p>Body</p>",
        }

        smtp_client = Mock()
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(
                email_provider="smtp",
                system_email_address="system@test.com",
                smtp_host="smtp.learnhouse.test",
                smtp_port=2525,
                smtp_username="smtp-user",
                smtp_password="smtp-pass",
                smtp_use_tls=True,
            ),
        ), patch(
            "src.services.email.utils.smtplib.SMTP",
            return_value=smtp_client,
        ) as mock_smtp:
            result = send_email("to@test.com", "Hello", "<p>Body</p>")

        assert result == {"id": None, "to": "to@test.com"}
        mock_smtp.assert_called_once_with("smtp.learnhouse.test", 2525, timeout=15)
        smtp_client.starttls.assert_called_once()
        smtp_client.login.assert_called_once_with("smtp-user", "smtp-pass")
        smtp_client.sendmail.assert_called_once()
        smtp_client.quit.assert_called_once()

    def test_send_email_smtp_without_tls_or_login(self):
        smtp_client = Mock()
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(
                email_provider="smtp",
                system_email_address="system@test.com",
                smtp_host="smtp.learnhouse.test",
                smtp_port=2525,
                smtp_username="",
                smtp_password="",
                smtp_use_tls=False,
            ),
        ), patch(
            "src.services.email.utils.smtplib.SMTP",
            return_value=smtp_client,
        ):
            result = send_email("to@test.com", "Hello", "<p>Body</p>")

        assert result == {"id": None, "to": "to@test.com"}
        smtp_client.starttls.assert_not_called()
        smtp_client.login.assert_not_called()
        smtp_client.sendmail.assert_called_once()
        smtp_client.quit.assert_called_once()

    def test_send_email_resend_failure_raises_503(self):
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(email_provider="resend", resend_api_key="key"),
        ), patch(
            "src.services.email.utils.resend.Emails.send",
            side_effect=Exception("API error"),
        ):
            with pytest.raises(HTTPException) as exc_info:
                send_email("to@test.com", "Subject", "<p>Body</p>")
        assert exc_info.value.status_code == 503

    def test_recipient_rejection_logs_warning_not_error(self):
        """A provider rejection of the address itself must not page.

        It still raises 503 — only the log level changes, so nothing downstream
        of send_email sees different behavior.
        """
        rejection = resend_exceptions.ValidationError(
            message=(
                "Invalid `to` field. Please use our testing email address "
                "instead of domains like `example.com`."
            ),
            error_type="validation_error",
            code=400,
        )
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(email_provider="resend", resend_api_key="key"),
        ), patch(
            "src.services.email.utils.resend.Emails.send",
            side_effect=rejection,
        ), patch("src.services.email.utils.logger") as mock_logger:
            with pytest.raises(HTTPException) as exc_info:
                send_email("nobody@example.com", "Subject", "<p>Body</p>")

        assert exc_info.value.status_code == 503
        mock_logger.error.assert_not_called()
        mock_logger.warning.assert_called_once()

    @pytest.mark.parametrize(
        "failure",
        [
            resend_exceptions.ApplicationError(
                message="Something went wrong", error_type="application_error", code=500
            ),
            resend_exceptions.RateLimitError(
                message="Too many requests", error_type="rate_limit_exceeded", code=429
            ),
            resend_exceptions.InvalidApiKeyError(
                message="Invalid API key", error_type="invalid_api_key", code=403
            ),
            resend_exceptions.MissingRequiredFieldsError(
                message="Missing `subject` field",
                error_type="missing_required_field",
                code=422,
            ),
            resend_exceptions.ValidationError(
                message="Invalid `from` field. The domain is not verified.",
                error_type="validation_error",
                code=400,
            ),
        ],
    )
    def test_deployment_wide_failures_still_log_error(self, failure):
        """Anything that is not a recipient rejection keeps paging.

        These are our-side or provider-side faults that break mail for every
        user, so they must stay at error level even though several carry a 4xx.
        """
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(email_provider="resend", resend_api_key="key"),
        ), patch(
            "src.services.email.utils.resend.Emails.send",
            side_effect=failure,
        ), patch("src.services.email.utils.logger") as mock_logger:
            with pytest.raises(HTTPException) as exc_info:
                send_email("to@test.com", "Subject", "<p>Body</p>")

        assert exc_info.value.status_code == 503
        mock_logger.error.assert_called_once()

    def test_send_email_smtp_exception_raises_503(self):
        smtp_client = Mock()
        smtp_client.sendmail.side_effect = smtplib.SMTPException("SMTP error")
        smtp_client.quit.side_effect = Exception("quit failed")
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(
                email_provider="smtp",
                smtp_use_tls=False,
                smtp_username="",
                smtp_password="",
            ),
        ), patch(
            "src.services.email.utils.smtplib.SMTP",
            return_value=smtp_client,
        ):
            with pytest.raises(HTTPException) as exc_info:
                send_email("to@test.com", "Subject", "<p>Body</p>")
        assert exc_info.value.status_code == 503

    def test_send_email_smtp_os_error_raises_503(self):
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(
                email_provider="smtp",
                smtp_use_tls=False,
                smtp_username="",
                smtp_password="",
            ),
        ), patch(
            "src.services.email.utils.smtplib.SMTP",
            side_effect=OSError("conn refused"),
        ):
            with pytest.raises(HTTPException) as exc_info:
                send_email("to@test.com", "Subject", "<p>Body</p>")
        assert exc_info.value.status_code == 503


class TestGetPrimaryVerifiedCustomDomain:
    """Tests for _get_primary_verified_custom_domain and the db_session + org_id
    branch in get_org_signup_base_url."""

    @pytest.mark.asyncio
    async def test_get_org_signup_base_url_uses_primary_custom_domain(self):
        """get_org_signup_base_url should return the verified custom domain when
        db_session + org_id are supplied and _get_primary_verified_custom_domain
        returns a domain."""
        from src.services.email.utils import get_org_signup_base_url

        request = _request()
        mock_session = AsyncMock()

        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(tenancy="multi", ssl=True, domain="learnhouse.app"),
        ), patch(
            "src.services.email.utils._get_primary_verified_custom_domain",
            new_callable=AsyncMock,
            return_value="custom.example.com",
        ):
            url = await get_org_signup_base_url(
                "myorg", request, db_session=mock_session, org_id=42
            )

        assert url == "https://custom.example.com"

    @pytest.mark.asyncio
    async def test_get_org_signup_base_url_falls_through_when_no_custom_domain(self):
        """When _get_primary_verified_custom_domain returns None, the function
        falls through to the subdomain URL (covers the `if custom_domain:` False
        branch and lines that follow)."""
        from src.services.email.utils import get_org_signup_base_url

        request = _request()
        mock_session = AsyncMock()

        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(tenancy="multi", ssl=True, domain="learnhouse.app"),
        ), patch(
            "src.services.email.utils._get_primary_verified_custom_domain",
            new_callable=AsyncMock,
            return_value=None,
        ):
            url = await get_org_signup_base_url(
                "myorg", request, db_session=mock_session, org_id=42
            )

        assert url == "https://myorg.learnhouse.app"

    @pytest.mark.asyncio
    async def test_get_primary_verified_custom_domain_returns_primary(self):
        """Should return the primary domain's name when a primary verified row
        is found (covers the execute + scalars().first() lines)."""
        from types import SimpleNamespace
        from src.services.email.utils import _get_primary_verified_custom_domain

        primary_domain = SimpleNamespace(domain="primary.example.com")

        # Simulate scalars().first() returning a domain row
        scalars_result = Mock()
        scalars_result.first = Mock(return_value=primary_domain)
        execute_result = Mock()
        execute_result.scalars = Mock(return_value=scalars_result)

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=execute_result)

        result = await _get_primary_verified_custom_domain(mock_session, org_id=1)
        assert result == "primary.example.com"

    @pytest.mark.asyncio
    async def test_get_primary_verified_custom_domain_falls_back_to_any_verified(self):
        """When no primary row exists, should query for any verified domain and
        return it (covers the any_verified execute + return lines)."""
        from types import SimpleNamespace
        from src.services.email.utils import _get_primary_verified_custom_domain

        any_domain = SimpleNamespace(domain="any-verified.example.com")

        scalars_none = Mock()
        scalars_none.first = Mock(return_value=None)
        result_none = Mock()
        result_none.scalars = Mock(return_value=scalars_none)

        scalars_any = Mock()
        scalars_any.first = Mock(return_value=any_domain)
        result_any = Mock()
        result_any.scalars = Mock(return_value=scalars_any)

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(side_effect=[result_none, result_any])

        result = await _get_primary_verified_custom_domain(mock_session, org_id=1)
        assert result == "any-verified.example.com"

    @pytest.mark.asyncio
    async def test_get_primary_verified_custom_domain_returns_none_on_exception(self):
        """Should return None and log an exception when db_session.execute raises."""
        from src.services.email.utils import _get_primary_verified_custom_domain

        bad_session = AsyncMock()
        bad_session.execute = AsyncMock(side_effect=RuntimeError("db error"))

        result = await _get_primary_verified_custom_domain(bad_session, org_id=1)
        assert result is None


class TestOrgLogoUrl:
    """Absolute org-logo URL resolution for white-labeled emails."""

    def test_media_base_prefers_env_override(self):
        from src.services.email.utils import get_media_base_url

        with patch.dict(
            "src.services.email.utils.os.environ",
            {"LEARNHOUSE_MEDIA_URL": "https://cdn.acme.test/"},
            clear=False,
        ):
            assert get_media_base_url(_request()) == "https://cdn.acme.test"

    def test_media_base_derives_api_subdomain_from_domain(self):
        from src.services.email.utils import get_media_base_url

        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(domain="learnhouse.io", ssl=True),
        ), patch.dict(
            "src.services.email.utils.os.environ", {}, clear=True
        ):
            assert get_media_base_url(_request()) == "https://api.learnhouse.io"

    def test_media_base_falls_back_to_request_host_for_localhost(self):
        from src.services.email.utils import get_media_base_url

        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(domain="localhost"),
        ), patch.dict(
            "src.services.email.utils.os.environ", {}, clear=True
        ):
            base = get_media_base_url(_request(server=("api.test", 443)))
            assert base == "https://api.test"

    def test_org_logo_url_builds_content_path(self):
        from src.services.email.utils import get_org_logo_url

        org = SimpleNamespace(org_uuid="org_abc", logo_image="uuid_logo.png")
        with patch(
            "src.services.email.utils.get_media_base_url",
            return_value="https://api.learnhouse.io",
        ):
            url = get_org_logo_url(org, _request())
        assert url == "https://api.learnhouse.io/content/orgs/org_abc/logos/uuid_logo.png"

    def test_org_logo_url_none_when_no_logo(self):
        from src.services.email.utils import get_org_logo_url

        org = SimpleNamespace(org_uuid="org_abc", logo_image=None)
        assert get_org_logo_url(org, _request()) is None
        assert get_org_logo_url(None, _request()) is None


class TestSenderNameSanitization:
    """``sanitize_sender_name`` — the one place org-supplied names are cleaned.

    The name is typed by an org admin and ends up verbatim in an RFC 5322
    header, so a stray CR or LF is header injection, not a cosmetic problem.
    """

    def test_plain_name_passes_through_unchanged(self):
        from src.services.email.sender import sanitize_sender_name

        assert sanitize_sender_name("Acme Academy") == "Acme Academy"

    def test_trims_surrounding_whitespace(self):
        from src.services.email.sender import sanitize_sender_name

        assert sanitize_sender_name("   Acme Academy \t ") == "Acme Academy"

    @pytest.mark.parametrize(
        "raw",
        [
            "Acme\rAcademy",
            "Acme\nAcademy",
            "Acme\r\nAcademy",
            "Acme\x00Academy",
            "Acme\x0bAcademy",
            "Acme\x7fAcademy",
            "Acme\x85Academy",
            "Acme\u2028Academy",
            "Acme\u2029Academy",
        ],
    )
    def test_control_characters_are_removed_not_replaced(self, raw):
        from src.services.email.sender import sanitize_sender_name

        cleaned = sanitize_sender_name(raw)
        # Removed, so the two halves close up rather than being spaced apart —
        # anything else would leave a name the admin never typed.
        assert cleaned == "AcmeAcademy"
        assert not any(ch in cleaned for ch in "\r\n\x00")

    def test_collapses_internal_whitespace_runs(self):
        from src.services.email.sender import sanitize_sender_name

        assert sanitize_sender_name("Acme    \t  Academy") == "Acme Academy"

    def test_truncates_to_the_documented_maximum(self):
        from src.services.email.sender import (
            MAX_SENDER_NAME_LENGTH,
            sanitize_sender_name,
        )

        cleaned = sanitize_sender_name("a" * (MAX_SENDER_NAME_LENGTH + 40))
        assert len(cleaned) == MAX_SENDER_NAME_LENGTH

    @pytest.mark.parametrize("raw", [None, "", "   ", "\r\n", "\x00\x01"])
    def test_empty_after_sanitizing_returns_empty_string(self, raw):
        from src.services.email.sender import sanitize_sender_name

        assert sanitize_sender_name(raw) == ""

    def test_non_ascii_survives(self):
        from src.services.email.sender import sanitize_sender_name

        assert sanitize_sender_name("Académie Lumière") == "Académie Lumière"
        assert sanitize_sender_name("学院") == "学院"


class TestFormatSender:
    """``format_sender`` builds the From value; the ADDRESS is never variable."""

    def test_name_and_address(self):
        from src.services.email.sender import format_sender

        assert format_sender("Acme Academy", "system@test.com") == (
            "Acme Academy <system@test.com>"
        )

    @pytest.mark.parametrize(
        "raw_name",
        ["Acme, Inc.", 'Acme "The" Academy', "Acme; Academy", "Acme: Academy"],
    )
    def test_specials_are_quoted_by_the_stdlib(self, raw_name):
        from email.utils import parseaddr

        from src.services.email.sender import format_sender

        value = format_sender(raw_name, "system@test.com")
        assert value.startswith('"')
        # Round-trips: a parser reading the header recovers exactly what the
        # admin typed, and the address is untouched.
        name, addr = parseaddr(value)
        assert name == raw_name
        assert addr == "system@test.com"

    def test_non_ascii_is_rfc_2047_encoded_and_decodes_back(self):
        from email.header import decode_header, make_header
        from email.utils import parseaddr

        from src.services.email.sender import format_sender

        value = format_sender("Académie Lumière", "system@test.com")
        assert "=?utf-8?" in value.lower()
        encoded_name, addr = parseaddr(value)
        assert str(make_header(decode_header(encoded_name))) == "Académie Lumière"
        assert addr == "system@test.com"

    @pytest.mark.parametrize("display_name", [None, "", "   ", "\r\n"])
    def test_falls_back_to_platform_default(self, display_name):
        from src.services.email.sender import format_sender

        assert format_sender(display_name, "system@test.com") == (
            "LearnHouse <system@test.com>"
        )
        assert format_sender(display_name, "system@test.com", "Acme Platform") == (
            "Acme Platform <system@test.com>"
        )

    def test_bare_address_when_platform_default_is_also_empty(self):
        from src.services.email.sender import format_sender

        assert format_sender(None, "system@test.com", "") == "system@test.com"
        assert format_sender("  ", "system@test.com", "   ") == "system@test.com"

    def test_header_injection_is_neutralised(self):
        from email.utils import parseaddr

        from src.services.email.sender import format_sender

        value = format_sender(
            "Evil\r\nBcc: attacker@example.com", "system@test.com"
        )
        assert "\r" not in value and "\n" not in value
        # Whatever is left is a single quoted display name, not a second header.
        name, addr = parseaddr(value)
        assert addr == "system@test.com"
        assert name == "EvilBcc: attacker@example.com"
        assert not value.lower().startswith("bcc")


class TestSendEmailSenderName:
    """``send_email`` picks up the display name and nothing else."""

    def test_org_name_reaches_the_resend_payload(self):
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(email_provider="resend"),
        ), patch(
            "src.services.email.utils.resend.Emails.send",
            return_value={"id": "msg-1"},
        ) as mock_resend_send:
            send_email(
                "to@test.com", "Hello", "<p>Body</p>", sender_name="Acme Academy"
            )

        payload = mock_resend_send.call_args.args[0]
        assert payload["from"] == "Acme Academy <system@test.com>"

    def test_platform_send_keeps_the_deployment_default(self):
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(email_provider="resend"),
        ), patch(
            "src.services.email.utils.resend.Emails.send",
            return_value={"id": "msg-1"},
        ) as mock_resend_send:
            send_email("to@test.com", "Hello", "<p>Body</p>")

        assert (
            mock_resend_send.call_args.args[0]["from"]
            == "LearnHouse <system@test.com>"
        )

    def test_deployment_default_is_configurable(self):
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(
                email_provider="resend", system_email_sender_name="Acme Platform"
            ),
        ), patch(
            "src.services.email.utils.resend.Emails.send",
            return_value={"id": "msg-1"},
        ) as mock_resend_send:
            send_email("to@test.com", "Hello", "<p>Body</p>")

        assert (
            mock_resend_send.call_args.args[0]["from"]
            == "Acme Platform <system@test.com>"
        )

    def test_address_is_never_taken_from_the_display_name(self):
        """Deliverability rests on the From address staying on the verified
        domain — a name that looks like an address must not become one."""
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(email_provider="resend"),
        ), patch(
            "src.services.email.utils.resend.Emails.send",
            return_value={"id": "msg-1"},
        ) as mock_resend_send:
            send_email(
                "to@test.com",
                "Hello",
                "<p>Body</p>",
                sender_name="evil@attacker.example",
            )

        from email.utils import parseaddr

        _, addr = parseaddr(mock_resend_send.call_args.args[0]["from"])
        assert addr == "system@test.com"

    def test_smtp_from_header_carries_no_injected_header(self):
        import email as email_module

        smtp_client = Mock()
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(email_provider="smtp", smtp_use_tls=False,
                                 smtp_username="", smtp_password=""),
        ), patch(
            "src.services.email.utils.smtplib.SMTP", return_value=smtp_client
        ):
            send_email(
                "to@test.com",
                "Hello",
                "<p>Body</p>",
                sender_name="Evil\r\nBcc: attacker@example.com",
            )

        raw = smtp_client.sendmail.call_args.args[2]
        parsed = email_module.message_from_string(raw)
        assert parsed.get("Bcc") is None
        assert "attacker@example.com" not in (parsed.get("To") or "")
        from_header = parsed["From"]
        assert "\n" not in from_header and "\r" not in from_header
        from email.utils import parseaddr

        assert parseaddr(from_header)[1] == "system@test.com"

    def test_mailing_config_without_the_field_keeps_current_behaviour(self):
        """An older config object (no ``system_email_sender_name``) must not
        break — it falls back to the built-in platform name."""
        config = _config(email_provider="resend")
        del config.mailing_config.system_email_sender_name

        with patch(
            "src.services.email.utils.get_learnhouse_config", return_value=config
        ), patch(
            "src.services.email.utils.resend.Emails.send",
            return_value={"id": "msg-1"},
        ) as mock_resend_send:
            send_email("to@test.com", "Hello", "<p>Body</p>")

        assert (
            mock_resend_send.call_args.args[0]["from"]
            == "LearnHouse <system@test.com>"
        )
