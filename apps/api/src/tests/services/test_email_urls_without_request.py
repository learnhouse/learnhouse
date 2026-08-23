"""Tests for building email URLs with no HTTP request.

A cron job has no `Request`, so every fallback these builders take when
`request is None` is on the lifecycle-email hot path. Untested, a wrong branch
here produces a link that 404s or points at the wrong tenant — invisible from
the sending side.
"""

from types import SimpleNamespace

import pytest

from src.services.email import utils as email_utils


def _config(
    tenancy="multi", domain="learnhouse.io", frontend_domain="", ssl=True
):
    return SimpleNamespace(
        hosting_config=SimpleNamespace(
            tenancy=tenancy,
            domain=domain,
            frontend_domain=frontend_domain,
            ssl=ssl,
        ),
        general_config=SimpleNamespace(development_mode=False),
    )


@pytest.fixture
def clean_env(monkeypatch):
    for var in (
        "LEARNHOUSE_PLATFORM_URL",
        "LEARNHOUSE_MEDIA_URL",
        "LEARNHOUSE_BACKEND_URL",
    ):
        monkeypatch.delenv(var, raising=False)


class TestConfiguredFrontendBaseUrl:
    def test_platform_url_wins(self, monkeypatch, clean_env):
        monkeypatch.setenv("LEARNHOUSE_PLATFORM_URL", "https://app.example.com/")
        monkeypatch.setattr(email_utils, "get_learnhouse_config", _config)

        assert email_utils._configured_frontend_base_url() == "https://app.example.com"

    def test_falls_back_to_frontend_domain(self, monkeypatch, clean_env):
        monkeypatch.setattr(
            email_utils,
            "get_learnhouse_config",
            lambda: _config(frontend_domain="app.example.com"),
        )

        assert email_utils._configured_frontend_base_url() == "https://app.example.com"

    def test_falls_back_to_base_domain(self, monkeypatch, clean_env):
        monkeypatch.setattr(
            email_utils, "get_learnhouse_config", lambda: _config(domain="example.com")
        )

        assert email_utils._configured_frontend_base_url() == "https://example.com"

    def test_respects_the_ssl_setting(self, monkeypatch, clean_env):
        monkeypatch.setattr(
            email_utils,
            "get_learnhouse_config",
            lambda: _config(domain="example.com", ssl=False),
        )

        assert email_utils._configured_frontend_base_url() == "http://example.com"

    @pytest.mark.parametrize("value", ["", "localhost:3000"])
    def test_localhost_and_empty_are_not_usable(self, monkeypatch, clean_env, value):
        """A localhost link in an email is dead on arrival for the recipient."""
        monkeypatch.setattr(
            email_utils,
            "get_learnhouse_config",
            lambda: _config(domain=value, frontend_domain=value),
        )

        assert email_utils._configured_frontend_base_url() is None


class TestOrgSignupBaseUrlWithoutRequest:
    async def test_multi_tenant_builds_the_org_subdomain(self, monkeypatch, clean_env):
        monkeypatch.setattr(email_utils, "get_learnhouse_config", _config)

        url = await email_utils.get_org_signup_base_url("acme")
        assert url == "https://acme.learnhouse.io"

    async def test_single_tenant_uses_configured_url(self, monkeypatch, clean_env):
        monkeypatch.setenv("LEARNHOUSE_PLATFORM_URL", "https://school.example.com")
        monkeypatch.setattr(
            email_utils, "get_learnhouse_config", lambda: _config(tenancy="single")
        )

        assert await email_utils.get_org_signup_base_url("acme") == (
            "https://school.example.com"
        )

    async def test_single_tenant_with_nothing_configured_returns_empty(
        self, monkeypatch, clean_env
    ):
        """Better an obviously-empty base than a link to the wrong host."""
        monkeypatch.setattr(
            email_utils,
            "get_learnhouse_config",
            lambda: _config(tenancy="single", domain="", frontend_domain=""),
        )

        assert await email_utils.get_org_signup_base_url("acme") == ""

    async def test_multi_tenant_with_localhost_domain_falls_back(
        self, monkeypatch, clean_env
    ):
        monkeypatch.setenv("LEARNHOUSE_PLATFORM_URL", "https://app.example.com")
        monkeypatch.setattr(
            email_utils,
            "get_learnhouse_config",
            lambda: _config(domain="localhost:3000"),
        )

        assert await email_utils.get_org_signup_base_url("acme") == (
            "https://app.example.com"
        )

    async def test_multi_tenant_with_nothing_configured_returns_empty(
        self, monkeypatch, clean_env
    ):
        monkeypatch.setattr(
            email_utils,
            "get_learnhouse_config",
            lambda: _config(domain="", frontend_domain=""),
        )

        assert await email_utils.get_org_signup_base_url("acme") == ""

    async def test_a_verified_custom_domain_still_wins(self, monkeypatch, clean_env):
        """An org on a custom domain keeps its session there — linking to the
        generic subdomain would land the reader cross-origin."""
        monkeypatch.setattr(email_utils, "get_learnhouse_config", _config)

        async def fake_custom_domain(_db, _org_id):
            return "learn.acme.com"

        monkeypatch.setattr(
            email_utils, "_get_primary_verified_custom_domain", fake_custom_domain
        )

        url = await email_utils.get_org_signup_base_url(
            "acme", None, db_session=object(), org_id=1
        )
        assert url == "https://learn.acme.com"


class TestMediaBaseUrlWithoutRequest:
    def test_explicit_override_wins(self, monkeypatch, clean_env):
        monkeypatch.setenv("LEARNHOUSE_MEDIA_URL", "https://media.example.com/")
        assert email_utils.get_media_base_url(None) == "https://media.example.com"

    def test_backend_url_is_also_honoured(self, monkeypatch, clean_env):
        monkeypatch.setenv("LEARNHOUSE_BACKEND_URL", "https://api.example.com")
        assert email_utils.get_media_base_url(None) == "https://api.example.com"

    def test_saas_convention_is_derived_from_the_domain(self, monkeypatch, clean_env):
        monkeypatch.setattr(email_utils, "get_learnhouse_config", _config)
        assert email_utils.get_media_base_url(None) == "https://api.learnhouse.io"

    def test_no_request_and_nothing_configured_returns_empty(
        self, monkeypatch, clean_env
    ):
        monkeypatch.setattr(
            email_utils, "get_learnhouse_config", lambda: _config(domain="localhost")
        )
        assert email_utils.get_media_base_url(None) == ""


class TestOrgLogoUrlWithoutRequest:
    ORG = SimpleNamespace(logo_image="logo.png", org_uuid="org_abc")

    def test_builds_an_absolute_url(self, monkeypatch, clean_env):
        monkeypatch.setattr(email_utils, "get_learnhouse_config", _config)

        assert email_utils.get_org_logo_url(self.ORG, None) == (
            "https://api.learnhouse.io/content/orgs/org_abc/logos/logo.png"
        )

    def test_unresolvable_media_host_falls_back_to_the_default_mark(
        self, monkeypatch, clean_env
    ):
        """A relative src renders broken in every mail client, so returning
        None (and letting the caller use the LearnHouse wordmark) is the only
        acceptable outcome."""
        monkeypatch.setattr(
            email_utils, "get_learnhouse_config", lambda: _config(domain="localhost")
        )

        assert email_utils.get_org_logo_url(self.ORG, None) is None

    def test_org_without_a_logo_returns_none(self, monkeypatch, clean_env):
        monkeypatch.setattr(email_utils, "get_learnhouse_config", _config)
        bare = SimpleNamespace(logo_image="", org_uuid="org_abc")

        assert email_utils.get_org_logo_url(bare, None) is None


class TestRecipientValidation:
    @pytest.mark.parametrize("bad", ["", "   ", "not-an-email"])
    def test_malformed_recipients_are_refused(self, bad):
        """Surfaces here rather than as an opaque provider 4xx."""
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as excinfo:
            email_utils.send_email(bad, "hi", "<p>hi</p>")

        assert excinfo.value.status_code == 400
