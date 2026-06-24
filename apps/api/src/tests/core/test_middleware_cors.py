"""Tests for src/core/middleware/cors.py."""

import re
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.core.middleware.cors import (
    _SINGLE_TENANCY_LOCALHOST_REGEX,
    configure_cors,
    get_cors_origin_regex,
)


def _config(
    tenancy: str,
    allowed_regexp: str = r"^https?://acme\.test$",
    frontend_domain: str = "app.example.com",
    domain: str = "example.com",
):
    return SimpleNamespace(
        hosting_config=SimpleNamespace(
            tenancy=tenancy,
            allowed_regexp=allowed_regexp,
            frontend_domain=frontend_domain,
            domain=domain,
        )
    )


class TestGetCorsOriginRegex:
    def test_single_tenancy_pins_to_configured_hosts(self):
        with patch(
            "src.core.middleware.cors.get_learnhouse_config",
            return_value=_config("single"),
        ):
            regex = get_cors_origin_regex()
            assert re.fullmatch(regex, "https://app.example.com")
            assert re.fullmatch(regex, "https://example.com")
            assert re.fullmatch(regex, "https://www.app.example.com")
            assert re.fullmatch(regex, "http://localhost:3000")
            assert not re.fullmatch(regex, "https://evil.example.org")

    def test_single_tenancy_falls_back_to_localhost_when_unconfigured(self):
        with patch(
            "src.core.middleware.cors.get_learnhouse_config",
            return_value=_config("single", frontend_domain="", domain=""),
        ):
            regex = get_cors_origin_regex()
            assert regex == _SINGLE_TENANCY_LOCALHOST_REGEX
            assert re.fullmatch(regex, "http://localhost:3000")
            assert not re.fullmatch(regex, "https://evil.example.org")

    def test_multi_tenancy_returns_configured_regex(self):
        configured = r"^https?://(.*\.)?learnhouse\.io$"
        with patch(
            "src.core.middleware.cors.get_learnhouse_config",
            return_value=_config("multi", allowed_regexp=configured),
        ):
            assert get_cors_origin_regex() == configured

    def test_multi_tenancy_falls_back_to_domain_when_regexp_empty(self):
        # cors.py:80-82 - with no allowed_regexp configured, multi mode must
        # derive a domain-and-subdomain regex from the base domain rather than
        # returning an empty value (which would take the SaaS frontend offline).
        with patch(
            "src.core.middleware.cors.get_learnhouse_config",
            return_value=_config("multi", allowed_regexp="", domain="learnhouse.io"),
        ):
            regex = get_cors_origin_regex()
            assert re.fullmatch(regex, "https://learnhouse.io")
            assert re.fullmatch(regex, "https://acme.learnhouse.io")
            assert re.fullmatch(regex, "https://deep.sub.learnhouse.io:8443")
            assert not re.fullmatch(regex, "https://evil.example.org")

    def test_multi_tenancy_falls_back_to_localhost_when_regexp_and_domain_empty(self):
        # cors.py:83 - with neither allowed_regexp nor domain configured, multi
        # mode falls back to the localhost regex.
        with patch(
            "src.core.middleware.cors.get_learnhouse_config",
            return_value=_config("multi", allowed_regexp="", domain=""),
        ):
            regex = get_cors_origin_regex()
            assert regex == _SINGLE_TENANCY_LOCALHOST_REGEX
            assert re.fullmatch(regex, "http://localhost:3000")


class TestSingleTenancyRegex:
    """The single-mode regex must accept the configured operator origin(s)
    and reject everything else while credentials are allowed."""

    @staticmethod
    def _regex() -> str:
        with patch(
            "src.core.middleware.cors.get_learnhouse_config",
            return_value=_config("single"),
        ):
            return get_cors_origin_regex()

    def _matches(self, origin: str) -> bool:
        return re.fullmatch(self._regex(), origin) is not None

    def test_accepts_configured_https_domain(self):
        assert self._matches("https://app.example.com")

    def test_accepts_http_localhost_with_port(self):
        assert self._matches("http://localhost:3000")

    def test_accepts_configured_host_with_port(self):
        assert self._matches("https://app.example.com:8443")

    def test_rejects_unconfigured_domain(self):
        assert not self._matches("https://learn.example.org")

    def test_rejects_origin_with_path(self):
        # CORS Origin header should never include a path; reject if present.
        assert not self._matches("https://app.example.com/login")

    def test_rejects_origin_with_whitespace(self):
        assert not self._matches("https://app.example.com foo")

    def test_rejects_non_http_scheme(self):
        assert not self._matches("javascript:alert(1)")
        assert not self._matches("file:///etc/passwd")
        assert not self._matches("ftp://example.com")

    def test_rejects_empty(self):
        assert not self._matches("")


class TestConfigureCors:
    def test_registers_cors_middleware_on_app(self):
        app = FastAPI()
        with patch(
            "src.core.middleware.cors.get_learnhouse_config",
            return_value=_config("single"),
        ):
            configure_cors(app)

        # Starlette stores middleware as a list of Middleware specs; CORSMiddleware
        # should be among them after configure_cors runs.
        cls_list = [m.cls for m in app.user_middleware]
        assert CORSMiddleware in cls_list

    def test_propagates_tenancy_into_middleware_options(self):
        app = FastAPI()
        with patch(
            "src.core.middleware.cors.get_learnhouse_config",
            return_value=_config("multi", allowed_regexp=r"^https?://acme\.test$"),
        ):
            configure_cors(app)

        cors_spec = next(m for m in app.user_middleware if m.cls is CORSMiddleware)
        # Starlette renamed `options` → `kwargs` across versions; accept both.
        opts = getattr(cors_spec, "kwargs", None) or getattr(cors_spec, "options", {})
        assert opts["allow_origin_regex"] == r"^https?://acme\.test$"
        assert opts["allow_credentials"] is True
        assert opts["allow_methods"] == ["*"]
        assert opts["allow_headers"] == ["*"]
