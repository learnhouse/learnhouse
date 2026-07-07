"""Bearer authentication for the embedded MCP server (`/mcp` mount).

Pure-ASGI middleware: external agents authenticate with a LearnHouse API
token (`lh_...`), resolved IN-PROCESS via `validate_api_token` — no HTTP
self-call. The resolved `APITokenUser` principal is exposed to tool
handlers through a contextvar; everything a tool can do is bounded by the
token's rights and org scope (enforced by the tool registry pipeline).

Superadmin tokens (`lh_sa_...`) are rejected: they are cross-org and the
MCP surface is strictly org-scoped.

A small TTL cache keyed by the token's SHA-256 avoids a DB lookup per
request; revocation therefore propagates within CACHE_TTL_SECONDS.
"""

from __future__ import annotations

import hashlib
import json
import time
from contextvars import ContextVar
from typing import Any

from src.core.events.database import _async_session_factory
from src.db.users import APITokenUser
from src.security.auth import validate_api_token

TOKEN_PREFIX = "lh_"
SUPERADMIN_PREFIX = "lh_sa_"
CACHE_TTL_SECONDS = 60

# The authenticated principal for the current MCP request.
current_mcp_principal: ContextVar[APITokenUser | None] = ContextVar(
    "current_mcp_principal", default=None
)


class _TokenCache:
    """In-memory token→principal cache with TTL, keyed by token hash."""

    def __init__(self, ttl_seconds: int = CACHE_TTL_SECONDS, max_entries: int = 1024):
        self._ttl = ttl_seconds
        self._max = max_entries
        self._entries: dict[str, tuple[float, APITokenUser]] = {}

    @staticmethod
    def _key(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def get(self, token: str) -> APITokenUser | None:
        entry = self._entries.get(self._key(token))
        if not entry:
            return None
        expires_at, principal = entry
        if time.monotonic() >= expires_at:
            self._entries.pop(self._key(token), None)
            return None
        return principal

    def put(self, token: str, principal: APITokenUser) -> None:
        if len(self._entries) >= self._max:
            # Drop the oldest entries; simple and good enough at this size.
            for key in sorted(self._entries, key=lambda k: self._entries[k][0])[
                : self._max // 4
            ]:
                self._entries.pop(key, None)
        self._entries[self._key(token)] = (
            time.monotonic() + self._ttl,
            principal,
        )

    def clear(self) -> None:
        self._entries.clear()


async def _reject(send: Any, status: int, detail: str) -> None:
    body = json.dumps({"detail": detail}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"www-authenticate", b"Bearer"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class MCPAuthMiddleware:
    """Wraps the MCP ASGI app; only authenticated `lh_` tokens get through."""

    def __init__(self, app: Any, cache_ttl_seconds: int = CACHE_TTL_SECONDS):
        self.app = app
        self.cache = _TokenCache(ttl_seconds=cache_ttl_seconds)

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            # Lifespan/websocket scopes pass through untouched.
            await self.app(scope, receive, send)
            return

        headers = {
            k.decode().lower(): v.decode()
            for k, v in scope.get("headers") or []
        }
        authorization = headers.get("authorization", "")

        if not authorization.startswith("Bearer "):
            await _reject(send, 401, "Missing bearer token")
            return

        token = authorization[len("Bearer "):].strip()
        if token.startswith(SUPERADMIN_PREFIX):
            await _reject(send, 401, "Superadmin tokens are not accepted here")
            return
        if not token.startswith(TOKEN_PREFIX):
            await _reject(
                send, 401, "Invalid token: expected a LearnHouse API token (lh_...)"
            )
            return

        principal = self.cache.get(token)
        if principal is None:
            principal = await self._validate(token)
            if principal is None:
                await _reject(send, 401, "Invalid or revoked API token")
                return
            self.cache.put(token, principal)

        ctx_token = current_mcp_principal.set(principal)
        try:
            await self.app(scope, receive, send)
        finally:
            current_mcp_principal.reset(ctx_token)

    async def _validate(self, token: str) -> APITokenUser | None:
        async with _async_session_factory() as session:
            return await validate_api_token(token, session)
