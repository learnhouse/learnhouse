from __future__ import annotations

import contextvars
from dataclasses import dataclass


@dataclass(frozen=True)
class OrgContext:
    token: str
    org_id: int
    org_slug: str
    user_uuid: str
    token_name: str


_current_ctx: contextvars.ContextVar[OrgContext | None] = contextvars.ContextVar(
    "learnhouse_mcp_org_ctx", default=None
)


def set_current_ctx(ctx: OrgContext) -> None:
    _current_ctx.set(ctx)


def get_current_ctx() -> OrgContext:
    ctx = _current_ctx.get()
    if ctx is None:
        raise RuntimeError(
            "No LearnHouse request context available. This usually means a tool was "
            "invoked outside the HTTP request flow — the auth middleware did not run."
        )
    return ctx
