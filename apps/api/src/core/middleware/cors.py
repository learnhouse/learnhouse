"""Tenancy-aware CORS configuration."""

import re
from urllib.parse import urlparse

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config.config import get_learnhouse_config


_SINGLE_TENANCY_LOCALHOST_REGEX = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"

# Origins no allowlist should ever accept; a regexp matching them is a catch-all
# (e.g. the shipped default `\b((?:https?://)[^\s/$.?#].[^\s]*)\b`).
_FOREIGN_ORIGIN_CANARIES = (
    "https://evil.invalid",
    "http://not-an-allowed-origin-canary.invalid:8443",
)


def is_catch_all_origin_regex(pattern: str) -> bool:
    """True when ``pattern`` matches an obviously foreign origin."""
    try:
        compiled = re.compile(pattern)
    except re.error:
        return False
    return any(compiled.fullmatch(c) for c in _FOREIGN_ORIGIN_CANARIES)


def _host_from(value: str) -> str:
    """Extract a bare hostname from a config value that may be a host or URL."""
    value = (value or "").strip().rstrip("/")
    if not value:
        return ""
    host = urlparse(value).hostname if "://" in value else value
    return (host or "").removeprefix("www.").lower()


def _single_tenancy_origin_regex(config) -> str:
    """Build a CORS origin regex pinned to the configured host(s).

    Reflecting any origin back with ``allow_credentials=True`` lets a malicious
    site make authenticated cross-origin requests (S25). In single mode we
    therefore only allow the operator's configured frontend/domain host(s)
    (with or without a ``www.`` prefix, any scheme/port), plus localhost as a
    fallback so local/dev flows keep working.
    """
    hosts = set()
    for cfg_value in (
        config.hosting_config.frontend_domain,
        config.hosting_config.domain,
    ):
        host = _host_from(cfg_value)
        # Exclude only the loopback hosts themselves (added separately below).
        # Use an exact match, not a substring check, so a legitimate operator
        # domain that merely contains "localhost" (e.g. "my-localhost-app.com")
        # is not silently dropped — which would break CORS for their frontend.
        if host and host not in ("localhost", "127.0.0.1"):
            hosts.add(host)

    if not hosts:
        return _SINGLE_TENANCY_LOCALHOST_REGEX

    host_alternation = "|".join(
        rf"(?:www\.)?{re.escape(h)}" for h in sorted(hosts)
    )
    return (
        rf"^https?://(?:{host_alternation}|localhost|127\.0\.0\.1)(:\d+)?$"
    )


def _multi_tenancy_domain_regex(config) -> str:
    """Domain-and-subdomain regex derived from the configured base domain."""
    domain = _host_from(config.hosting_config.domain)
    if domain:
        return rf"^https?://(?:[a-z0-9-]+\.)*{re.escape(domain)}(:\d+)?$"
    return _SINGLE_TENANCY_LOCALHOST_REGEX


def _is_development_mode(config) -> bool:
    general = getattr(config, "general_config", None)
    return getattr(general, "development_mode", False) is True


def get_trusted_origin_regex(config, configured: str | None) -> str | None:
    """Return ``configured`` unless it is a catch-all, in which case fall back
    to the tenancy-derived regex. Dev mode keeps the configured value."""
    if not configured or not is_catch_all_origin_regex(configured):
        return configured
    if _is_development_mode(config):
        return configured
    if config.hosting_config.tenancy == "single":
        return _single_tenancy_origin_regex(config)
    return _multi_tenancy_domain_regex(config)


def get_cors_origin_regex() -> str:
    """
    Compute the regex for ``CORSMiddleware``'s ``allow_origin_regex`` based on
    the active tenancy mode.

    - ``single`` → pin to the configured frontend/domain host(s) only (S25),
      since credentials are allowed and reflecting any origin would be unsafe.
    - ``multi``  → use the configured ``LEARNHOUSE_ALLOWED_REGEXP`` (matches
      the configured domain and its subdomains). Verified per-org custom
      domains are a known gap; they require backend restart or per-request
      DB resolution.
    """
    config = get_learnhouse_config()
    if config.hosting_config.tenancy == "single":
        return _single_tenancy_origin_regex(config)
    # Multi-tenancy: use the configured regexp. If the operator left it empty
    # (it is not required for multi mode, only the base domain is), fall back to
    # a domain-and-subdomain regex derived from the configured domain. Returning
    # an empty/None value here makes CORSMiddleware reject every cross-origin
    # request with credentials, taking the whole SaaS frontend offline.
    # A catch-all regexp (the shipped default) is ignored outside dev mode.
    allowed_regexp = get_trusted_origin_regex(
        config, config.hosting_config.allowed_regexp
    )
    if allowed_regexp:
        return allowed_regexp
    return _multi_tenancy_domain_regex(config)


def configure_cors(app: FastAPI) -> None:
    """Register CORS middleware on ``app`` with tenancy-aware origin policy."""
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=get_cors_origin_regex(),
        allow_methods=["*"],
        allow_credentials=True,
        allow_headers=["*"],
    )
