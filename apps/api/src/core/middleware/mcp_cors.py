"""Open CORS for the MCP endpoint and its OAuth discovery/token routes.

Browser-based MCP clients (inspectors, web agents) call these from origins
we cannot list in advance. None of them reads a cookie: they authenticate
with a bearer token or not at all, so `*` without credentials is safe here,
unlike the rest of the API, whose CORS stays restricted.
"""

from starlette.types import ASGIApp, Message, Receive, Scope, Send

PUBLIC_PREFIXES = (
    "/mcp",
    "/.well-known/oauth-",
    "/.well-known/openid-configuration",
    "/oauth/register",
    "/oauth/token",
    "/oauth/revoke",
)

_ALLOW_HEADERS = (
    "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, "
    "Mcp-Method, Mcp-Name, Last-Event-ID"
)
_EXPOSE_HEADERS = "Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate"


def is_public_path(path: str) -> bool:
    if path == "/mcp" or path.startswith("/mcp/"):
        return True
    return any(path.startswith(prefix) for prefix in PUBLIC_PREFIXES[1:])


class PublicCORSMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not is_public_path(scope.get("path", "")):
            await self.app(scope, receive, send)
            return

        headers = {k.lower(): v for k, v in scope.get("headers") or []}
        if scope.get("method") == "OPTIONS" and b"access-control-request-method" in headers:
            await send(
                {
                    "type": "http.response.start",
                    "status": 204,
                    "headers": [
                        (b"access-control-allow-origin", b"*"),
                        (b"access-control-allow-methods", b"GET, POST, DELETE, OPTIONS"),
                        (b"access-control-allow-headers", _ALLOW_HEADERS.encode()),
                        (b"access-control-max-age", b"600"),
                        (b"content-length", b"0"),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": b""})
            return

        async def send_with_cors(message: Message) -> None:
            if message["type"] == "http.response.start":
                kept = [
                    (k, v)
                    for k, v in message.get("headers", [])
                    if not k.lower().startswith(b"access-control-")
                ]
                kept += [
                    (b"access-control-allow-origin", b"*"),
                    (b"access-control-expose-headers", _EXPOSE_HEADERS.encode()),
                ]
                message = {**message, "headers": kept}
            await send(message)

        await self.app(scope, receive, send_with_cors)
