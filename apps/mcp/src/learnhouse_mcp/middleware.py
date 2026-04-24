from __future__ import annotations

import json
import logging
from typing import Awaitable, Callable

from .client import LearnHouseAPIError, LearnHouseClient
from .runtime import OrgContext, set_current_ctx

logger = logging.getLogger("learnhouse_mcp.auth")

Send = Callable[[dict], Awaitable[None]]
Receive = Callable[[], Awaitable[dict]]
Scope = dict


class LearnHouseAuthMiddleware:
    """ASGI middleware that pins each MCP request to the caller's LearnHouse token.

    - Rejects any HTTP request that does not carry ``Authorization: Bearer lh_...``.
    - Resolves the token to its org scope via ``/auth/me`` (cached) and stores
      the result in a contextvar that the shared ``LearnHouseClient`` reads on
      every downstream API call.
    - The LearnHouse API itself enforces org isolation; this middleware exists
      to attach identity, not to authorize.
    """

    def __init__(self, app, client: LearnHouseClient):
        self.app = app
        self.client = client

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        auth_header = ""
        for key, value in scope.get("headers", []):
            if key == b"authorization":
                auth_header = value.decode("latin-1").strip()
                break

        lowered = auth_header.lower()
        if not lowered.startswith("bearer "):
            await self._reject(
                send,
                401,
                "Missing Authorization header. Connect with 'Authorization: Bearer lh_...'.",
            )
            return

        token = auth_header[7:].strip()
        if not token.startswith("lh_"):
            await self._reject(
                send,
                401,
                "This MCP server only accepts LearnHouse API tokens (must start with 'lh_').",
            )
            return

        try:
            entry = await self.client.resolve_token(token)
        except LearnHouseAPIError as exc:
            code = exc.status_code or 500
            if code < 400 or code >= 600:
                code = 502
            await self._reject(send, code, str(exc))
            return
        except Exception as exc:  # noqa: BLE001 — protect the server loop
            logger.exception("Unexpected error while resolving LearnHouse token")
            await self._reject(send, 500, f"Internal error resolving token: {exc}")
            return

        set_current_ctx(
            OrgContext(
                token=token,
                org_id=entry.org_id,
                org_slug=entry.org_slug,
                user_uuid=entry.user_uuid,
                token_name=entry.token_name,
            )
        )
        await self.app(scope, receive, send)

    @staticmethod
    async def _reject(send: Send, status_code: int, message: str) -> None:
        body = json.dumps({"error": message}).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": status_code,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                    (b"www-authenticate", b"Bearer"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body, "more_body": False})
