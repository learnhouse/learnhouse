"""FastMCP server with Streamable HTTP transport.

Exposes Atlas tools at `/mcp` and propagates the calling user's LH session
token via an ASGI middleware that reads `Authorization: Bearer` into a
ContextVar (`auth.set_token`). Tools then call `auth.get_token()` to
authenticate downstream LH API requests.

Plain ASGI middleware is used (not Starlette's `BaseHTTPMiddleware`)
because ContextVar values must be set in the same task that handles the
downstream call — `BaseHTTPMiddleware` runs middleware in a separate task
and breaks ContextVar propagation.
"""

from collections.abc import Awaitable, Callable

from mcp.server.fastmcp import FastMCP

from . import auth
from .config import Settings
from .lh_client import LHClient
from .tools import register_all


ASGIApp = Callable[[dict, Callable[[], Awaitable[dict]], Callable[[dict], Awaitable[None]]], Awaitable[None]]


class BearerTokenMiddleware:
    """ASGI middleware that captures `Authorization: Bearer …` into the
    `current_lh_token` ContextVar before the downstream MCP app runs."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            token: str | None = None
            org_id: int | None = None
            org_slug: str | None = None
            for raw_name, raw_value in scope.get("headers", []):
                name = raw_name.lower()
                value = raw_value.decode("latin-1")
                if name == b"authorization":
                    if value.lower().startswith("bearer "):
                        token = value[7:].strip() or None
                elif name == b"x-lh-org-id":
                    try:
                        org_id = int(value.strip())
                    except ValueError:
                        org_id = None
                elif name == b"x-lh-org-slug":
                    org_slug = value.strip() or None
            auth.set_context(token, org_id, org_slug)
        await self.app(scope, receive, send)


def build_server(settings: Settings | None = None):
    """Build the FastMCP server + ASGI app wrapped with auth middleware.

    FastMCP's `streamable_http_app()` already mounts the MCP endpoint at
    `/mcp` internally, so we wrap it directly with our auth middleware
    instead of mounting it under another prefix.
    """
    settings = settings or Settings.load()
    mcp = FastMCP("learnhouse-atlas")
    lh = LHClient(settings)
    register_all(mcp, lh)

    inner = mcp.streamable_http_app()
    app = BearerTokenMiddleware(inner)
    return mcp, app
