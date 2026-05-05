"""Tests for src/core/middleware/cors.py."""

import re
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.core.middleware.cors import (
    _SINGLE_TENANCY_ORIGIN_REGEX,
    configure_cors,
    get_cors_origin_regex,
)


def _config(tenancy: str, allowed_regexp: str = r"^https?://acme\.test$"):
    return SimpleNamespace(
        hosting_config=SimpleNamespace(
            tenancy=tenancy,
            allowed_regexp=allowed_regexp,
        )
    )


class TestGetCorsOriginRegex:
    def test_single_tenancy_returns_permissive_regex(self):
        with patch(
            "src.core.middleware.cors.get_learnhouse_config",
            return_value=_config("single"),
        ):
            assert get_cors_origin_regex() == _SINGLE_TENANCY_ORIGIN_REGEX

    def test_multi_tenancy_returns_configured_regex(self):
        configured = r"^https?://(.*\.)?learnhouse\.io$"
        with patch(
            "src.core.middleware.cors.get_learnhouse_config",
            return_value=_config("multi", allowed_regexp=configured),
        ):
            assert get_cors_origin_regex() == configured


class TestSingleTenancyRegex:
    """The permissive regex used in single mode must accept legitimate
    operator origins and reject obvious garbage."""

    @staticmethod
    def _matches(origin: str) -> bool:
        return re.fullmatch(_SINGLE_TENANCY_ORIGIN_REGEX, origin) is not None

    def test_accepts_https_domain(self):
        assert self._matches("https://learn.example.org")

    def test_accepts_http_localhost_with_port(self):
        assert self._matches("http://localhost:3000")

    def test_accepts_https_with_port(self):
        assert self._matches("https://app.example.com:8443")

    def test_accepts_ip_origin(self):
        # Internal pod-to-pod or dev IP origins must work in single mode.
        assert self._matches("http://10.0.0.5:3000")

    def test_rejects_origin_with_path(self):
        # CORS Origin header should never include a path; reject if present.
        assert not self._matches("https://learn.example.org/login")

    def test_rejects_origin_with_whitespace(self):
        assert not self._matches("https://learn.example.org foo")

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
