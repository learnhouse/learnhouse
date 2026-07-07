"""Core types for the agent tool registry.

A tool is a typed, tiered wrapper around an existing service function. Tools
are consumed by two surfaces that share one enforcement pipeline
(`registry.run_tool`):

- the in-app agent (chat), where CREATE/EDIT/DESTRUCTIVE calls may become
  pending actions the user confirms, and
- the embedded MCP server, where external agents act with an API token and
  everything is bounded by the token's rights.

Tools call service functions in-process — never HTTP — so the services'
own RBAC checks remain the authoritative layer (the registry pre-flight is
defense in depth, not a replacement).
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Any, Awaitable, Callable, Literal, Union

from pydantic import BaseModel
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.requests import Request

from src.db.organizations import Organization
from src.db.users import APITokenUser, PublicUser
from src.security.rbac import AccessAction

ToolMode = Literal["confirm", "autonomous", "execute"]


class ActionTier(str, Enum):
    """How dangerous a tool is; drives the permission-mode gate."""

    READ = "read"                # always executes
    CREATE = "create"            # pending in confirm mode
    EDIT = "edit"                # pending in confirm mode
    DESTRUCTIVE = "destructive"  # pending + typed challenge in confirm mode;
                                 # explicit confirm arg on the token surface


def make_synthetic_request() -> Request:
    """Build a minimal Starlette request for service calls made outside a
    FastAPI handler (MCP tool calls, pending-action applies).

    The RBAC stack only ever touches `request.state` (which Starlette lazily
    initialises on any request object), so a bare HTTP scope is sufficient.
    """
    return Request(
        scope={
            "type": "http",
            "method": "POST",
            "path": "/internal/agent",
            "headers": [],
            "query_string": b"",
        }
    )


@dataclass
class ToolContext:
    """Everything a tool execution needs, resolved by the calling surface."""

    request: Request
    db_session: AsyncSession
    user: Union[PublicUser, APITokenUser]
    org: Organization
    org_slug: str
    mode: ToolMode = "confirm"
    # Pending-action index key: the chat uuid for the in-app agent, or
    # "token:{token_uuid}" for the MCP surface.
    scope_key: str = ""

    def with_mode(self, mode: ToolMode) -> "ToolContext":
        return replace(self, mode=mode)


@dataclass(frozen=True)
class ToolSpec:
    """Declarative description of one agent tool."""

    name: str
    description: str
    params_model: type[BaseModel]
    tier: ActionTier
    # Rights bucket on src/db/roles.py::Rights ("courses", "boards", ...)
    # used for the API-token pre-flight. None = no bucket gate (e.g. the
    # entity resolver, which delegates to per-type checks inside services).
    rights_bucket: str | None
    access_action: AccessAction
    execute: Callable[[ToolContext, BaseModel], Awaitable[Any]]
    # Name of the param carrying the target resource uuid; when set (and the
    # uuid's prefix is RBAC-registered) the pipeline pre-flights
    # check_resource_access on it.
    target_param: str | None = None
    # "course" | "community" | ... — used for events, summaries, challenges.
    target_kind: str | None = None
    # Human summary for pending previews; defaults to the description.
    summarize: Callable[[BaseModel], str] | None = None
    # When set, applied actions get an undo token and this builds the undo.
    build_undo: (
        Callable[[ToolContext, BaseModel, Any], Awaitable[dict[str, Any] | None]]
        | None
    ) = None
    # Extra pre-flight hook (e.g. org-admin requirement for org tools).
    preflight: (
        Callable[[ToolContext, BaseModel], Awaitable[str | None]] | None
    ) = None


@dataclass(frozen=True)
class PendingProposal:
    """A CREATE/EDIT/DESTRUCTIVE tool call held for user confirmation.

    Persisting it (Redis) is the pending-engine's job; the registry only
    describes what would run.
    """

    tool: str
    args: dict[str, Any]
    tier: ActionTier
    target: dict[str, Any]
    summary: str
    requires_confirmation: bool
    scope_key: str
    org_id: int
    user_id: int


@dataclass
class ToolOutcome:
    """Result of `run_tool`: executed, proposed (pending), or denied."""

    status: Literal["executed", "proposed", "denied"]
    result: Any = None
    proposal: PendingProposal | None = None
    reason: str | None = None
    denied_code: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def executed(cls, result: Any) -> "ToolOutcome":
        return cls(status="executed", result=result)

    @classmethod
    def proposed(cls, proposal: PendingProposal) -> "ToolOutcome":
        return cls(status="proposed", proposal=proposal)

    @classmethod
    def denied(cls, code: str, reason: str) -> "ToolOutcome":
        return cls(status="denied", denied_code=code, reason=reason)
