"""Origin trust for emailed links, and TLS verification for outbound SMTP.

Two hardening fixes in ``src/services/email/utils.py``:

* An attacker-supplied ``Origin``/``Referer`` must never become the base URL of
  a magic-login / email-verification link. The shipped ``allowed_regexp``
  default used to be a catch-all that ``re.fullmatch`` accepted for any
  ``https://host``, so ``Origin: https://evil.com`` produced a genuine
  LearnHouse email containing an attacker-hosted login link.
* ``starttls()`` with no ``context`` builds an *unverified* TLS session, so an
  on-path relay impersonator captures the SMTP credentials and every emailed
  token.
"""

import re
import ssl
import time
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
import yaml
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.users import AnonymousUser, User
from src.routers.auth import router as auth_router
from src.security.auth import get_current_user
from src.services.email.utils import (
    _is_allowed_base_url,
    _is_scoped_origin_regexp,
    _is_verified_custom_domain,
    send_email,
)

# The historical shipped default: an unanchored catch-all that `re.fullmatch`
# still accepts for any http(s) URL.
CATCH_ALL_REGEXP = r"\b((?:https?://)[^\s/$.?#].[^\s]*)\b"

API_ROOT = Path(__file__).resolve().parents[3]


def _config(**overrides):
    hosting = SimpleNamespace(
        allowed_origins=overrides.pop("allowed_origins", []),
        allowed_regexp=overrides.pop("allowed_regexp", ""),
        tenancy=overrides.pop("tenancy", "multi"),
        domain=overrides.pop("domain", "learnhouse.io"),
        frontend_domain=overrides.pop("frontend_domain", "app.learnhouse.io"),
        ssl=overrides.pop("ssl", True),
    )
    general = SimpleNamespace(
        development_mode=overrides.pop("development_mode", False),
    )
    mailing = SimpleNamespace(
        email_provider=overrides.pop("email_provider", "smtp"),
        system_email_address=overrides.pop("system_email_address", "system@test.com"),
        resend_api_key=overrides.pop("resend_api_key", ""),
        smtp_host=overrides.pop("smtp_host", "smtp.test"),
        smtp_port=overrides.pop("smtp_port", 587),
        smtp_username=overrides.pop("smtp_username", "smtp-user"),
        smtp_password=overrides.pop("smtp_password", "smtp-pass"),
        smtp_use_tls=overrides.pop("smtp_use_tls", True),
    )
    return SimpleNamespace(
        hosting_config=hosting, general_config=general, mailing_config=mailing
    )


def _patch_config(**overrides):
    return patch(
        "src.services.email.utils.get_learnhouse_config",
        return_value=_config(**overrides),
    )


def _no_platform_url():
    # Blank rather than cleared: these tests drive the real request stack, which
    # still needs the rest of the environment.
    return patch.dict(
        "src.services.email.utils.os.environ",
        {"LEARNHOUSE_PLATFORM_URL": ""},
        clear=False,
    )


class TestOriginAllowlist:
    def test_catch_all_regexp_no_longer_trusts_an_attacker_origin(self):
        # F15: with the old shipped default configured, every one of these was
        # accepted and became the host of an emailed login link.
        with _patch_config(allowed_regexp=CATCH_ALL_REGEXP), _no_platform_url():
            assert not _is_allowed_base_url("https://evil.com")
            assert not _is_allowed_base_url("http://evil.com:8443")
            assert not _is_allowed_base_url("https://learnhouse.io.evil.com")
            assert not _is_allowed_base_url("https://evil.com/learnhouse.io")

    def test_platform_domain_and_org_subdomains_are_accepted(self):
        with _patch_config(allowed_regexp=CATCH_ALL_REGEXP), _no_platform_url():
            assert _is_allowed_base_url("https://learnhouse.io")
            assert _is_allowed_base_url("https://www.learnhouse.io")
            assert _is_allowed_base_url("https://acme.learnhouse.io")
            assert _is_allowed_base_url("https://app.learnhouse.io")
            assert _is_allowed_base_url("https://learnhouse.io/")

    def test_explicit_allowed_origin_and_scoped_regexp_still_work(self):
        with _patch_config(
            allowed_origins=["https://partner.test/"],
            allowed_regexp=r"^https://scoped\.test$",
        ), _no_platform_url():
            assert _is_allowed_base_url("https://partner.test")
            assert _is_allowed_base_url("https://scoped.test")
            assert not _is_allowed_base_url("https://other.test")

    def test_non_http_scheme_is_rejected_before_any_allowlist(self):
        with _patch_config(
            allowed_origins=["javascript:alert(1)"], allowed_regexp=CATCH_ALL_REGEXP
        ), _no_platform_url():
            assert not _is_allowed_base_url("javascript:alert(1)")
            assert not _is_allowed_base_url("https://")

    def test_development_mode_localhost_still_allowed_in_multi(self):
        with _patch_config(development_mode=True), _no_platform_url():
            assert _is_allowed_base_url("http://localhost:3000")
            assert not _is_allowed_base_url("https://evil.com")

    def test_single_tenancy_behaviour_is_unchanged(self):
        with _patch_config(
            tenancy="single",
            domain="learn.myschool.org",
            frontend_domain="learn.myschool.org",
            allowed_regexp=CATCH_ALL_REGEXP,
            allowed_origins=["https://evil.com"],
        ), _no_platform_url():
            assert _is_allowed_base_url("https://learn.myschool.org")
            assert _is_allowed_base_url("https://www.learn.myschool.org")
            # Single tenancy has never honoured allowed_origins/allowed_regexp.
            assert not _is_allowed_base_url("https://evil.com")
            assert not _is_allowed_base_url("https://sub.learn.myschool.org")

    def test_platform_url_env_still_accepted_over_https_only(self):
        with _patch_config(), patch.dict(
            "src.services.email.utils.os.environ",
            {"LEARNHOUSE_PLATFORM_URL": "https://www.platform.test"},
            clear=True,
        ):
            assert _is_allowed_base_url("https://platform.test")
            assert not _is_allowed_base_url("http://platform.test")


class TestScopedOriginRegexp:
    @pytest.mark.parametrize(
        "pattern",
        [
            CATCH_ALL_REGEXP,
            r".*",
            r"^https?://.*$",
            r"(",  # unparsable
        ],
    )
    def test_catch_all_and_broken_patterns_are_refused(self, pattern):
        assert not _is_scoped_origin_regexp(pattern)

    @pytest.mark.parametrize(
        "pattern",
        [
            r"^https://scoped\.test$",
            r"^https://(?:[a-z0-9-]+\.)*learnhouse\.io$",
        ],
    )
    def test_domain_scoped_patterns_are_accepted(self, pattern):
        assert _is_scoped_origin_regexp(pattern)

    def test_shipped_catch_all_default_cannot_host_an_email_link(self):
        """The shipped default stays a catch-all on purpose — the same value
        drives CORS and CSRF, so narrowing it would lock out every deployment
        that relies on it. What must hold is that a catch-all can never decide
        the host of an emailed link: it is recognized and ignored."""
        shipped = yaml.safe_load((API_ROOT / "config" / "config.yaml").read_text())
        pattern = shipped["hosting_config"]["allowed_regexp"]

        # It really does match anything (that is why CORS/CSRF still work)...
        assert re.fullmatch(pattern, "https://evil.com")
        # ...and it is exactly why email link building refuses to trust it.
        assert not _is_scoped_origin_regexp(pattern)


class TestVerifiedCustomDomains:
    """Custom-domain tenants must keep receiving links on their own host."""

    @pytest.fixture(autouse=True)
    def _clean_cache(self):
        from src.security.csrf import _CUSTOM_DOMAIN_CACHE

        _CUSTOM_DOMAIN_CACHE.clear()
        yield
        _CUSTOM_DOMAIN_CACHE.clear()

    def _seed(self, host, allowed, ttl=60.0):
        from src.security.csrf import _CUSTOM_DOMAIN_CACHE

        _CUSTOM_DOMAIN_CACHE[host] = (allowed, time.monotonic() + ttl)

    def test_verified_custom_domain_is_accepted(self):
        self._seed("learn.acme.org", True)
        with _patch_config(), _no_platform_url():
            assert _is_allowed_base_url("https://learn.acme.org")

    def test_unverified_and_expired_and_unknown_hosts_are_rejected(self):
        self._seed("notverified.acme.org", False)
        self._seed("stale.acme.org", True, ttl=-1.0)
        with _patch_config(), _no_platform_url():
            assert not _is_allowed_base_url("https://notverified.acme.org")
            assert not _is_allowed_base_url("https://stale.acme.org")
            assert not _is_allowed_base_url("https://never-seen.acme.org")

    def test_helper_rejects_empty_host(self):
        assert not _is_verified_custom_domain("")


@pytest.fixture
def magic_app(db):
    app = FastAPI()
    app.include_router(auth_router, prefix="/api/v1/auth")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def magic_client(magic_app):
    async with AsyncClient(
        transport=ASGITransport(app=magic_app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture
async def link_user(db):
    user = User(
        id=871,
        username="linkuser",
        first_name="Link",
        last_name="User",
        email="link-victim@test.com",
        password="hashed_password",
        user_uuid="user_link_victim",
        email_verified=True,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


class TestMagicLinkUrlInEmailBody:
    """The URL that actually reaches the victim is the thing under test."""

    async def _request_link(self, client, email, headers):
        sent = {}

        def _capture(to, subject, body):
            sent["to"] = to
            sent["body"] = body
            return {"id": "msg"}

        with patch(
            "src.routers.auth.check_login_rate_limit", return_value=(True, None)
        ), patch(
            "src.services.auth.magic_login.issue_magic_login_token", return_value="tok"
        ), patch(
            "src.services.auth.magic_login.send_email", side_effect=_capture
        ), _patch_config(
            allowed_regexp=CATCH_ALL_REGEXP
        ), _no_platform_url():
            response = await client.post(
                "/api/v1/auth/magic-link/request",
                json={"email": email},
                headers=headers,
            )
        return response, sent

    async def test_attacker_origin_does_not_reach_the_emailed_link(
        self, magic_client, link_user
    ):
        response, sent = await self._request_link(
            magic_client, link_user.email, {"origin": "https://evil.com"}
        )
        assert response.status_code == 200
        assert sent["to"] == link_user.email
        assert "evil.com" not in sent["body"]
        # Falls back to the configured canonical frontend, not the attacker host.
        assert "https://app.learnhouse.io/auth/magic?token=tok" in sent["body"]

    async def test_attacker_referer_does_not_reach_the_emailed_link(
        self, magic_client, link_user
    ):
        response, sent = await self._request_link(
            magic_client, link_user.email, {"referer": "https://evil.com/login"}
        )
        assert response.status_code == 200
        assert "evil.com" not in sent["body"]
        assert "https://app.learnhouse.io/auth/magic?token=tok" in sent["body"]

    async def test_legitimate_org_subdomain_origin_is_preserved(
        self, magic_client, link_user
    ):
        response, sent = await self._request_link(
            magic_client, link_user.email, {"origin": "https://acme.learnhouse.io"}
        )
        assert response.status_code == 200
        assert "https://acme.learnhouse.io/auth/magic?token=tok" in sent["body"]


class TestSmtpTls:
    def test_starttls_uses_a_verifying_context(self):
        smtp_client = Mock()
        with _patch_config(email_provider="smtp", smtp_port=587), patch(
            "src.services.email.utils.smtplib.SMTP", return_value=smtp_client
        ):
            assert send_email("to@test.com", "Hi", "<p>b</p>") == {
                "id": None,
                "to": "to@test.com",
            }

        smtp_client.starttls.assert_called_once()
        context = smtp_client.starttls.call_args.kwargs["context"]
        assert context.verify_mode is ssl.CERT_REQUIRED
        assert context.check_hostname is True
        assert context.minimum_version is ssl.TLSVersion.TLSv1_2
        smtp_client.login.assert_called_once_with("smtp-user", "smtp-pass")

    def test_implicit_tls_port_uses_smtp_ssl_with_the_same_context(self):
        smtp_client = Mock()
        with _patch_config(email_provider="smtp", smtp_port=465), patch(
            "src.services.email.utils.smtplib.SMTP_SSL", return_value=smtp_client
        ) as mock_smtp_ssl:
            send_email("to@test.com", "Hi", "<p>b</p>")

        smtp_client.starttls.assert_not_called()
        context = mock_smtp_ssl.call_args.kwargs["context"]
        assert context.verify_mode is ssl.CERT_REQUIRED
        assert context.check_hostname is True
        smtp_client.sendmail.assert_called_once()

    def test_non_numeric_port_falls_back_to_starttls(self):
        smtp_client = Mock()
        with _patch_config(email_provider="smtp", smtp_port=None), patch(
            "src.services.email.utils.smtplib.SMTP", return_value=smtp_client
        ):
            send_email("to@test.com", "Hi", "<p>b</p>")

        smtp_client.starttls.assert_called_once()

    def test_credentials_are_never_sent_over_a_cleartext_session(self):
        smtp_client = Mock()
        with _patch_config(
            email_provider="smtp", smtp_use_tls=False
        ), patch("src.services.email.utils.smtplib.SMTP", return_value=smtp_client):
            with pytest.raises(HTTPException) as exc_info:
                send_email("to@test.com", "Hi", "<p>b</p>")

        assert exc_info.value.status_code == 503
        assert "TLS" in exc_info.value.detail
        smtp_client.login.assert_not_called()
        smtp_client.sendmail.assert_not_called()

    def test_tls_verification_failure_reports_a_diagnosable_error(self):
        smtp_client = Mock()
        smtp_client.starttls.side_effect = ssl.SSLError("certificate verify failed")
        with _patch_config(email_provider="smtp"), patch(
            "src.services.email.utils.smtplib.SMTP", return_value=smtp_client
        ):
            with pytest.raises(HTTPException) as exc_info:
                send_email("to@test.com", "Hi", "<p>b</p>")

        assert exc_info.value.status_code == 503
        assert exc_info.value.detail == "Email service TLS verification failed"
        smtp_client.login.assert_not_called()
