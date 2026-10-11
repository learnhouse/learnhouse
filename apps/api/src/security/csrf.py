"""
CSRF Protection Middleware

Validates the Origin header on state-changing requests (POST, PUT, DELETE,
PATCH) that carry browser auth cookies, to protect against Cross-Site Request
Forgery attacks.

Rule: a request is rejected only when it carries an auth cookie AND names an
Origin (or, without Origin, a Referer) that is not allowed. ``Origin: null``
counts as not allowed. Requests with neither header pass: browsers always
send Origin on cross-site non-GET requests, so a header-less request is a
server-to-server call (Next.js route handlers, collab, cron, integrations).
"""

import hmac
import logging
import os
import re
import time
from typing import Callable
from urllib.parse import urlparse
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from config.config import get_learnhouse_config
from src.core.middleware.cors import (
    _host_from,
    _single_tenancy_origin_regex,
    effective_allowed_regexp,
)
from src.security.auth import JWT_COOKIE_NAME, JWT_REFRESH_COOKIE_NAME

logger = logging.getLogger(__name__)


# Methods that require CSRF protection
STATE_CHANGING_METHODS = {"POST", "PUT", "DELETE", "PATCH"}

# Short-TTL cache for the verified-custom-domain origin check, so we don't hit the
# DB on every mutation. Only consulted when the static allowlist/regex fails, so
# platform/subdomain traffic never touches it; bounds attacker random-origin
# lookups (negative results are cached too). Capped to avoid unbounded growth.
_CUSTOM_DOMAIN_CACHE: dict[str, tuple[bool, float]] = {}
_CUSTOM_DOMAIN_TTL_SECONDS = 60.0
_CUSTOM_DOMAIN_CACHE_MAX = 2048

# Cookies that authenticate a browser session. Only requests carrying one of
# these can be forged cross-site with the victim's credentials.
AUTH_COOKIE_NAMES = (JWT_COOKIE_NAME, JWT_REFRESH_COOKIE_NAME)


def _cors_origin_regex(config) -> str | None:
    """The origin regex CORS admits with credentials, built from ``config``.

    Mirrors ``get_cors_origin_regex`` so every origin the browser is allowed to
    send credentialed requests from also passes CSRF (otherwise mounting this
    middleware would break the platform's own subdomains when
    LEARNHOUSE_ALLOWED_REGEXP is unset).
    """
    tenancy = getattr(config.hosting_config, "tenancy", None)
    if tenancy == "single":
        return _single_tenancy_origin_regex(config)
    if tenancy == "multi":
        domain = config.hosting_config.domain
        host = _host_from(domain) if isinstance(domain, str) else ""
        if host:
            return rf"^https?://(?:[a-z0-9-]+\.)*{re.escape(host)}(:\d+)?$"
    return None


def _matches_any_key(provided: str | None, env_names: tuple[str, ...]) -> bool:
    """Constant-time compare of ``provided`` against each non-empty env key."""
    if not provided:
        return False
    provided_b = provided.encode()
    matched = False
    for name in env_names:
        expected = os.getenv(name, "")
        if expected and hmac.compare_digest(provided_b, expected.encode()):
            matched = True
    return matched


class CSRFProtectionMiddleware(BaseHTTPMiddleware):
    """
    Middleware that validates Origin header on state-changing requests.

    This protects against CSRF attacks by ensuring that requests come from
    allowed origins. The allowed origins are configured in the LearnHouse config.
    """

    def __init__(self, app):
        super().__init__(app)
        config = get_learnhouse_config()
        self.allowed_origins = config.hosting_config.allowed_origins
        # Shares the catch-all guard with CORS: a pattern that admits any
        # origin is treated as unset rather than disabling the check.
        self.allowed_regexp = effective_allowed_regexp(config)
        self.development_mode = config.general_config.development_mode

        # Compile the regexp for performance
        self.compiled_regexp = None
        self.cors_regexp = None
        cors_pattern = _cors_origin_regex(config)
        if cors_pattern:
            self.cors_regexp = re.compile(cors_pattern)
        if self.allowed_regexp:
            try:
                self.compiled_regexp = re.compile(self.allowed_regexp)
            except re.error as e:
                logger.error(
                    "CSRF: Failed to compile allowed_regexp '%s': %s. "
                    "Regex-based origin matching is DISABLED.",
                    self.allowed_regexp, e,
                )

    def _extract_origin_from_url(self, url: str) -> str | None:
        """Extract origin (scheme + host) from a URL."""
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            if parsed.scheme and parsed.netloc:
                return f"{parsed.scheme}://{parsed.netloc}"
        except Exception:
            pass
        return None

    def _is_origin_allowed(self, origin: str) -> bool:
        """Check a single origin value against allowed list."""
        if origin in self.allowed_origins:
            return True

        if self.compiled_regexp and self.compiled_regexp.fullmatch(origin):
            return True

        if self.cors_regexp and self.cors_regexp.fullmatch(origin):
            return True

        if self.development_mode:
            if "localhost" in origin or "127.0.0.1" in origin:
                return True

        return False

    def is_allowed_origin(self, origin: str | None, referer: str | None = None) -> bool:
        """Check if the request origin is allowed.

        Uses Origin header first, falls back to Referer header. Returns False
        when neither is present; ``dispatch`` decides what that means.
        """
        if origin:
            return self._is_origin_allowed(origin)

        # No Origin header: fall back to Referer
        if referer:
            referer_origin = self._extract_origin_from_url(referer)
            if referer_origin:
                return self._is_origin_allowed(referer_origin)

        return False

    async def _is_verified_custom_domain_origin(self, candidate_origin: str) -> bool:
        """Allow an origin whose host is a VERIFIED org custom domain.

        The static allowlist/regex only covers the platform domain, so browsers on
        a custom domain (learn.acme.org) would otherwise fail CSRF on same-origin
        mutations. We resolve the host against the custom_domains table (verified
        only), short-cached. This does NOT weaken CSRF: browsers set the Origin
        header themselves, so a cross-site request from attacker.com carries
        Origin: attacker.com (rejected); only genuine custom-domain requests carry
        the custom-domain Origin.
        """
        try:
            host = (urlparse(candidate_origin).hostname or "").lower()
        except Exception:
            return False
        if not host:
            return False

        now = time.monotonic()
        cached = _CUSTOM_DOMAIN_CACHE.get(host)
        if cached and cached[1] > now:
            return cached[0]

        allowed = False
        try:
            from sqlmodel import select
            from src.db.custom_domains import CustomDomain
            from src.core.events.database import _async_session_factory

            async with _async_session_factory() as session:
                row = (await session.execute(
                    select(CustomDomain).where(
                        CustomDomain.domain == host,
                        CustomDomain.status == "verified",
                    )
                )).scalars().first()
                allowed = row is not None
        except Exception:
            logger.exception("CSRF: custom-domain verification failed for host %s", host)
            allowed = False

        if len(_CUSTOM_DOMAIN_CACHE) >= _CUSTOM_DOMAIN_CACHE_MAX:
            _CUSTOM_DOMAIN_CACHE.clear()
        _CUSTOM_DOMAIN_CACHE[host] = (allowed, now + _CUSTOM_DOMAIN_TTL_SECONDS)
        return allowed

    def _is_csrf_exempt(self, request: Request) -> bool:
        """Check if the request is exempt from CSRF validation.

        CSRF attacks exploit browser-sent cookies. Only requests that use
        auth mechanisms which NEVER fall back to cookies are exempt:

        - API tokens (Bearer lh_*): validated independently, rejected if invalid
          (auth.py never falls back to cookies for lh_ tokens)
        - Stripe webhooks: use HMAC signature verification, no cookies involved

        Regular Bearer JWT tokens are NOT exempt because get_current_user()
        falls back to cookie auth when the JWT is invalid, so an attacker could
        send a fake Bearer header to bypass CSRF while the real auth happens
        via the victim's cookies.
        """
        auth_header = request.headers.get("authorization", "")
        # Only exempt API tokens (lh_*); these never fall back to cookies
        if auth_header.lower().startswith("bearer lh_"):
            return True

        # Stripe webhooks use signature-based verification, not cookies
        if request.headers.get("stripe-signature"):
            return True

        # Service-to-service calls use a shared key, not cookies; only a valid
        # key exempts (a bare header would let any page skip CSRF).
        if _matches_any_key(
            request.headers.get("x-internal-key"),
            ("COLLAB_INTERNAL_KEY", "CLOUD_INTERNAL_KEY"),
        ):
            return True

        if _matches_any_key(
            request.headers.get("x-platform-key"),
            ("LEARNHOUSE_PLATFORM_API_KEY",),
        ):
            return True

        return False

    @staticmethod
    def _has_auth_cookie(request: Request) -> bool:
        cookies = request.cookies
        return any(cookies.get(name) for name in AUTH_COOKIE_NAMES)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Only check state-changing methods
        if request.method not in STATE_CHANGING_METHODS:
            return await call_next(request)

        # Skip CSRF for requests using explicit auth (not cookie-based)
        if self._is_csrf_exempt(request):
            return await call_next(request)

        # Without a browser auth cookie there is nothing to forge.
        if not self._has_auth_cookie(request):
            return await call_next(request)

        origin = request.headers.get("origin")
        referer = request.headers.get("referer")

        # Browsers always send Origin on cross-site non-GET requests, so a
        # request with neither header is a server-to-server call.
        if origin:
            candidate = origin
        elif referer:
            candidate = self._extract_origin_from_url(referer)
            if candidate is None:
                return self._reject()
        else:
            return await call_next(request)

        # "null" (sandboxed iframes, data: URLs, some redirects) never matches
        # the allowlist and has no host, so it is rejected below.
        if self._is_origin_allowed(candidate):
            return await call_next(request)

        # Fall back to a DB check for VERIFIED org custom domains (which the
        # platform-domain-only config can't express). Slow path only, cached.
        if await self._is_verified_custom_domain_origin(candidate):
            return await call_next(request)

        return self._reject()

    @staticmethod
    def _reject() -> JSONResponse:
        return JSONResponse(
            status_code=403,
            content={"detail": "CSRF validation failed: Origin not allowed"},
        )
