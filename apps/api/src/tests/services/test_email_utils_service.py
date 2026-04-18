"""Tests for src/services/email/utils.py."""

import smtplib
from types import SimpleNamespace
from unittest.mock import Mock, patch

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

    def test_get_org_signup_base_url_uses_request_when_self_hosted_or_dev(self):
        request = _request({"origin": "https://app.test"})

        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(self_hosted=True),
        ), patch(
            "src.services.email.utils.get_base_url_from_request",
            return_value="https://fallback.test",
        ) as mock_base_url:
            assert get_org_signup_base_url("acme", request) == "https://fallback.test"
            mock_base_url.assert_called_once_with(request)

        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(development_mode=True),
        ), patch(
            "src.services.email.utils.get_base_url_from_request",
            return_value="https://fallback.test",
        ) as mock_base_url:
            assert get_org_signup_base_url("acme", request) == "https://fallback.test"
            mock_base_url.assert_called_once_with(request)

    @pytest.mark.parametrize(
        "ssl,expected",
        [(True, "https://acme.learnhouse.app"), (False, "http://acme.learnhouse.app")],
    )
    def test_get_org_signup_base_url_builds_org_subdomain(self, ssl, expected):
        request = _request({"origin": "https://app.test"})

        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(
                domain="learnhouse.app",
                ssl=ssl,
            ),
        ):
            assert get_org_signup_base_url("acme", request) == expected

    def test_get_org_signup_base_url_falls_back_for_invalid_or_localhost_domain(
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
            assert get_org_signup_base_url("acme", request) == "https://fallback.test"
            mock_base_url.assert_called_once_with(request)

        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(domain="localhost:3000", ssl=True),
        ), patch(
            "src.services.email.utils.get_base_url_from_request",
            return_value="https://fallback.test",
        ) as mock_base_url:
            assert get_org_signup_base_url("acme", request) == "https://fallback.test"
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
