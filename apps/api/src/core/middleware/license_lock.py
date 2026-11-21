"""Lock the platform when a self-hosted EE license has lapsed and says to lock.

Only Enterprise builds can lock, and only on signed evidence from the license
server (see ``ee.license.client._compute_lock``). The decision is cached by EE
for a minute, so this costs an attribute lookup per request.

While locked, every API and content request answers 423 except the few the
lock screen and administrators need: instance info, sign-in, the signed-in
user's profile, and license diagnostics.
"""

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from src.core.ee_hooks import get_ee_hooks

LOCKED_PREFIXES = ("/api/v1/", "/content/", "/mcp")

ALLOWED_PREFIXES = (
    "/api/v1/instance/",
    "/api/v1/auth/",
    "/api/v1/users/profile",
    "/api/v1/ee/license/",
    "/api/v1/health",
)


def license_lock_state() -> tuple[bool, str | None]:
    """(locked, reason) from EE, or (False, None) when EE is absent or errors."""
    hooks = get_ee_hooks()
    if hooks is None or not hasattr(hooks, "is_license_locked"):
        return False, None
    try:
        if not hooks.is_license_locked():
            return False, None
        reason = hooks.license_lock_reason() if hasattr(hooks, "license_lock_reason") else None
        return True, reason
    except Exception:
        # Licensing must never take the platform down by accident.
        return False, None


class LicenseLockMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") == "OPTIONS":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        if not path.startswith(LOCKED_PREFIXES) or path.startswith(ALLOWED_PREFIXES):
            await self.app(scope, receive, send)
            return
        locked, reason = license_lock_state()
        if not locked:
            await self.app(scope, receive, send)
            return
        response = JSONResponse(
            status_code=423,
            content={
                "error": "license_locked",
                "reason": reason,
                "detail": "This LearnHouse platform is unavailable because its license has lapsed.",
            },
        )
        await response(scope, receive, send)
