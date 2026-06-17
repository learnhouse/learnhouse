"""Tests for src/services/email/utils.py."""

import smtplib
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request

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
