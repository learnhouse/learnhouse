"""Bearer authentication for the MCP server (`/mcp`).

Two kinds of credential get through:

* OAuth access tokens (`lho_at_...`) from src/services/mcp/oauth.py. They act
  as the member who consented, inside the org they picked. This is what MCP
  clients use, and it works on every plan.
* LearnHouse API tokens (`lh_...`), bounded by the token's own rights. Handy
  for scripts and CI. Superadmin tokens (`lh_sa_...`) are refused: they are
  cross-org and the MCP surface is strictly org scoped.

Anything else gets a 401 whose `WWW-Authenticate` header points at the
protected resource metadata, which is how a client discovers where to sign in
(RFC 9728). The resolved principal is put on the ASGI scope state (handlers
read it from the request) and on a contextvar.

A small TTL cache keyed by the token's SHA-256 avoids a database lookup on
every request, so a revocation takes effect within CACHE_TTL_SECONDS.
"""

from __future__ import annotations

import hashlib
import json
import time
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Literal, Optional, Union

from starlette.requests import Request

from src.core.events.database import _async_session_factory
from src.db.users import APITokenUser, PublicUser
from src.security.auth import validate_api_token
from src.services.mcp import oauth

API_TOKEN_PREFIX = "lh_"
SUPERADMIN_PREFIX = "lh_sa_"
CACHE_TTL_SECONDS = 30


@dataclass(frozen=True)
class MCPPrincipal:
    """Who is calling, and how far they may go."""

    user: Union[PublicUser, APITokenUser]
    org_id: int
    scopes: frozenset[str]
    kind: Literal["oauth", "api_token"]
    client_name: str = ""
    auth_method: Optional[str] = None
    grant_uuid: Optional[str] = None

    @property
    def can_write(self) -> bool:
        return oauth.SCOPE_WRITE in self.scopes

    @property
    def can_admin(self) -> bool:
        return oauth.SCOPE_ADMIN in self.scopes

    @property
    def connection_id(self) -> str:
        """Stable id of this connection, for approvals and rate limits."""
        if self.grant_uuid:
            return self.grant_uuid
        return f"{self.kind}:{getattr(self.user, 'user_uuid', '') or getattr(self.user, 'id', '')}"


current_mcp_principal: ContextVar[MCPPrincipal | None] = ContextVar(
    "current_mcp_principal", default=None
)


class _TokenCache:
    """In-memory token to principal cache with TTL, keyed by token hash."""

    def __init__(self, ttl_seconds: int = CACHE_TTL_SECONDS, max_entries: int = 2048):
        self._ttl = ttl_seconds
        self._max = max_entries
        self._entries: dict[str, tuple[float, MCPPrincipal]] = {}

    @staticmethod
    def _key(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def get(self, token: str) -> MCPPrincipal | None:
        key = self._key(token)
        entry = self._entries.get(key)
        if not entry:
            return None
        expires_at, principal = entry
        if time.monotonic() >= expires_at:
            self._entries.pop(key, None)
            return None
        return principal

    def put(self, token: str, principal: MCPPrincipal, ttl: float | None = None) -> None:
        if len(self._entries) >= self._max:
            for key in sorted(self._entries, key=lambda k: self._entries[k][0])[: self._max // 4]:
                self._entries.pop(key, None)
        self._entries[self._key(token)] = (
            time.monotonic() + min(ttl if ttl is not None else self._ttl, self._ttl),
            principal,
        )

    def clear(self) -> None:
        self._entries.clear()


def _challenge(request: Request, error: Optional[str], description: str) -> str:
    parts = [f'resource_metadata="{oauth.resource_metadata_url(request)}"']
    if error:
        parts.append(f'error="{error}"')
        parts.append(f'error_description="{description}"')
    parts.append(f'scope="{" ".join(oauth.SUPPORTED_SCOPES)}"')
    return "Bearer " + ", ".join(parts)


async def _reject(
    scope: Any, send: Any, status: int, error: Optional[str], description: str
) -> None:
    request = Request(scope)
    body = json.dumps(
        {"error": error or "invalid_token", "error_description": description}
    ).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"www-authenticate", _challenge(request, error, description).encode()),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class MCPAuthMiddleware:
    """Wraps the MCP ASGI app; only authenticated callers get through."""

    def __init__(self, app: Any, cache_ttl_seconds: int = CACHE_TTL_SECONDS):
        self.app = app
        self.cache = _TokenCache(ttl_seconds=cache_ttl_seconds)

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if scope.get("method") == "OPTIONS":
            # CORS preflight carries no credentials; PublicCORSMiddleware answers it.
            await self.app(scope, receive, send)
            return

        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers") or []}
        authorization = headers.get("authorization", "")
        if not authorization.lower().startswith("bearer "):
            await _reject(scope, send, 401, None, "Sign in to connect to LearnHouse")
            return

        token = authorization[7:].strip()
        if token.startswith(SUPERADMIN_PREFIX):
            await _reject(scope, send, 401, "invalid_token", "Superadmin tokens are not accepted here")
            return

        request = Request(scope)
        # Keyed with the resource too: a token bound to one public URL must
        # not be let in on another host because it was cached.
        cache_key = f"{oauth.mcp_resource_url(request)} {token}"
        principal = self.cache.get(cache_key)
        if principal is None:
            principal = await self._resolve(token, request)
            if principal is None:
                await _reject(scope, send, 401, "invalid_token", "The token is invalid, expired or revoked")
                return
            self.cache.put(cache_key, principal)

        scope.setdefault("state", {})["mcp_principal"] = principal
        ctx_token = current_mcp_principal.set(principal)
        try:
            await self.app(scope, receive, send)
        finally:
            current_mcp_principal.reset(ctx_token)

    async def _resolve(self, token: str, request: Request) -> MCPPrincipal | None:
        async with _async_session_factory() as session:
            if token.startswith(oauth.ACCESS_TOKEN_PREFIX):
                found = await oauth.verify_access_token(
                    token, oauth.mcp_resource_url(request), session
                )
                if found is None:
                    return None
                return MCPPrincipal(
                    user=found.user,
                    org_id=found.org_id,
                    scopes=frozenset(found.scopes),
                    kind="oauth",
                    client_name=found.client_name,
                    auth_method=found.auth_method,
                    grant_uuid=found.grant_uuid,
                )
            if token.startswith(API_TOKEN_PREFIX):
                api_user = await validate_api_token(token, session)
                if api_user is None:
                    return None
                return MCPPrincipal(
                    user=api_user,
                    org_id=api_user.org_id,
                    scopes=frozenset(oauth.SUPPORTED_SCOPES),
                    kind="api_token",
                    client_name=api_user.token_name or "API token",
                )
        return None


def principal_from_request(request: Any) -> MCPPrincipal | None:
    """The principal for an MCP request: scope state first, contextvar second."""
    state = getattr(request, "scope", {}).get("state", {}) if request is not None else {}
    found = state.get("mcp_principal") if isinstance(state, dict) else None
    return found or current_mcp_principal.get()
