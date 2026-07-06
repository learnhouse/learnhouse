"""
CSRF Protection Middleware

Validates Origin header on state-changing requests (POST, PUT, DELETE, PATCH)
to protect against Cross-Site Request Forgery attacks.
"""

import logging
import re
import time
from typing import Callable
from urllib.parse import urlparse
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from config.config import get_learnhouse_config

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
        self.allowed_regexp = config.hosting_config.allowed_regexp
        self.development_mode = config.general_config.development_mode

        # Compile the regexp for performance
        self.compiled_regexp = None
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

        if self.development_mode:
            if "localhost" in origin or "127.0.0.1" in origin:
                return True

        return False

    def is_allowed_origin(self, origin: str | None, referer: str | None = None) -> bool:
        """Check if the request origin is allowed.

        Uses Origin header first, falls back to Referer header.
        Rejects state-changing requests that have neither.
        """
        if origin:
            return self._is_origin_allowed(origin)

        # No Origin header — fall back to Referer
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
        Origin: attacker.com (rejected) — only genuine custom-domain requests carry
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
        falls back to cookie auth when the JWT is invalid — an attacker could
        send a fake Bearer header to bypass CSRF while the real auth happens
        via the victim's cookies.
        """
        auth_header = request.headers.get("authorization", "")
        # Only exempt API tokens (lh_*) — these never fall back to cookies
        if auth_header.lower().startswith("bearer lh_"):
            return True

        # Stripe webhooks use signature-based verification, not cookies
        if request.headers.get("stripe-signature"):
            return True

        # Internal service-to-service calls (collab server) use a shared key, not cookies
        if request.headers.get("x-internal-key"):
            return True

        # Platform service-to-service calls use a shared key, not cookies
        if request.headers.get("x-platform-key"):
            return True

        return False

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Only check state-changing methods
        if request.method not in STATE_CHANGING_METHODS:
            return await call_next(request)

        # Skip CSRF for requests using explicit auth (not cookie-based)
        if self._is_csrf_exempt(request):
            return await call_next(request)

        # Get origin and referer headers
        origin = request.headers.get("origin")
        referer = request.headers.get("referer")

        # Validate origin. If it fails the static allowlist/regex, fall back to a
        # DB check for VERIFIED org custom domains (which the platform-domain-only
        # config can't express), so custom-domain browsers can make same-origin
        # mutations. The DB check runs only on this slow path (cached).
        if not self.is_allowed_origin(origin, referer):
            candidate = origin or (self._extract_origin_from_url(referer) if referer else None)
            if not (candidate and await self._is_verified_custom_domain_origin(candidate)):
                return JSONResponse(
                    status_code=403,
                    content={
                        "detail": "CSRF validation failed: Origin not allowed"
                    }
                )

        return await call_next(request)
