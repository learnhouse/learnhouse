"""
CSRF Protection Middleware

Validates Origin header on state-changing requests (POST, PUT, DELETE, PATCH)
to protect against Cross-Site Request Forgery attacks.
"""

import re
from typing import Callable
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from config.config import get_learnhouse_config


# Methods that require CSRF protection
STATE_CHANGING_METHODS = {"POST", "PUT", "DELETE", "PATCH"}


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
            except re.error:
                pass

    def is_allowed_origin(self, origin: str | None) -> bool:
        """Check if the origin is allowed."""
        if not origin:
            # No origin header - could be same-origin request
            return True

        # Check explicit allowed origins
        if origin in self.allowed_origins:
            return True

        # Check against regexp
        if self.compiled_regexp and self.compiled_regexp.match(origin):
            return True

        # In development mode, allow localhost origins
        if self.development_mode:
            if "localhost" in origin or "127.0.0.1" in origin:
                return True

        return False

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Only check state-changing methods
        if request.method not in STATE_CHANGING_METHODS:
            return await call_next(request)

        # Get origin header
        origin = request.headers.get("origin")

        # Validate origin
        if not self.is_allowed_origin(origin):
            return JSONResponse(
                status_code=403,
                content={
                    "detail": "CSRF validation failed: Origin not allowed"
                }
            )

        return await call_next(request)
