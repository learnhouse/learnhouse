"""Per-request auth context.

The API attaches three headers to every outbound MCP call:

  Authorization: Bearer lh_*    — session token, used by LHClient
  X-LH-Org-Id: 5                — numeric org id of the current scope
  X-LH-Org-Slug: my-org         — slug of the same org (avoids a lookup)

The Streamable HTTP ASGI middleware reads these into ContextVars before
the downstream MCP app dispatches the tool, so tool bodies can call
`auth.get_token()` / `auth.get_org_id()` / `auth.get_org_slug()`.
"""

from contextvars import ContextVar

from .errors import AtlasToolError

_current_token: ContextVar[str | None] = ContextVar("lh_token", default=None)
_current_org_id: ContextVar[int | None] = ContextVar("lh_org_id", default=None)
_current_org_slug: ContextVar[str | None] = ContextVar("lh_org_slug", default=None)


def set_context(token: str | None, org_id: int | None, org_slug: str | None) -> None:
    _current_token.set(token)
    _current_org_id.set(org_id)
    _current_org_slug.set(org_slug)


def get_token() -> str:
    token = _current_token.get()
    if not token:
        raise AtlasToolError(
            code="UNAUTHENTICATED",
            message="No LearnHouse session token attached to this MCP request.",
        )
    return token


def get_org_id() -> int:
    org_id = _current_org_id.get()
    if org_id is None:
        raise AtlasToolError(
            code="UNAUTHENTICATED",
            message="No org scope attached to this MCP request.",
        )
    return org_id


def get_org_slug() -> str:
    slug = _current_org_slug.get()
    if not slug:
        raise AtlasToolError(
            code="UNAUTHENTICATED",
            message="No org slug attached to this MCP request.",
        )
    return slug
