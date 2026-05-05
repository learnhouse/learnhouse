"""Tenancy-aware CORS configuration."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config.config import get_learnhouse_config


# Permissive regex used in `single` tenancy: matches any well-formed http(s)
# origin. The operator's host is the only valid origin in single mode, and
# auth cookies are host-only — cross-origin attackers cannot read them or
# forge authenticated requests, so echoing the request Origin back is safe.
_SINGLE_TENANCY_ORIGIN_REGEX = r"^https?://[^/\s]+$"


def get_cors_origin_regex() -> str:
    """
    Compute the regex for ``CORSMiddleware``'s ``allow_origin_regex`` based on
    the active tenancy mode.

    - ``single`` → accept any well-formed http(s) origin (see comment above).
    - ``multi``  → use the configured ``LEARNHOUSE_ALLOWED_REGEXP`` (matches
      the configured domain and its subdomains). Verified per-org custom
      domains are a known gap; they require backend restart or per-request
      DB resolution.
    """
    config = get_learnhouse_config()
    if config.hosting_config.tenancy == "single":
        return _SINGLE_TENANCY_ORIGIN_REGEX
    return config.hosting_config.allowed_regexp


def configure_cors(app: FastAPI) -> None:
    """Register CORS middleware on ``app`` with tenancy-aware origin policy."""
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=get_cors_origin_regex(),
        allow_methods=["*"],
        allow_credentials=True,
        allow_headers=["*"],
    )
