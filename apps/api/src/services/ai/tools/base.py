"""Core types for the agent tool registry.

A tool is a typed, tiered wrapper around an existing service function. Tools
are consumed by two surfaces that share one enforcement pipeline
(`registry.run_tool`):

- the in-app agent (chat), where CREATE/EDIT/DESTRUCTIVE calls may become
  pending actions the user confirms, and
- the embedded MCP server, where external agents act with an API token and
  everything is bounded by the token's rights.

Tools call service functions in-process, never over HTTP, so the services'
own RBAC checks remain the authoritative layer (the registry pre-flight is
defense in depth, not a replacement).
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Any, Awaitable, Callable, Literal, Union

from pydantic import BaseModel
from pydantic_core import to_jsonable_python
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.requests import Request

from src.db.organizations import Organization
from src.db.users import APITokenUser, PublicUser
from src.security.rbac import AccessAction

ToolMode = Literal["confirm", "autonomous", "execute"]
ToolSurface = Literal["agent", "mcp"]
# What a connection must be allowed to do to use a tool: read, change
# content, or administer the organization (members, roles, settings).
ToolAccess = Literal["read", "write", "admin"]


class ActionTier(str, Enum):
    """How dangerous a tool is; drives the permission-mode gate."""

    READ = "read"                # always executes
    CREATE = "create"            # pending in confirm mode
    EDIT = "edit"                # pending in confirm mode
    DESTRUCTIVE = "destructive"  # pending + typed challenge in confirm mode;
                                 # explicit confirm arg on the token surface


def jsonable(value: Any) -> Any:
    """Convert service-layer output (SQLModel/pydantic models, lists,
    datetimes, ...) into plain JSON-safe data for the model / MCP client."""
    return to_jsonable_python(value, fallback=str)


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
    # "agent" is the in-app agent (spends AI credits, so the org AI switch
    # applies); "mcp" is an external client bringing its own model.
    surface: ToolSurface = "agent"
    # A read-only grant (OAuth `mcp:read` only) may run READ tools alone.
    read_only: bool = False
    # The connection may run admin tools (OAuth `mcp:admin`). API tokens and
    # the in-app agent are bounded by their own rights instead.
    can_admin: bool = True
    # A person approved this exact call (MCP approval flow). Tools marked
    # `approval` refuse to run in `execute` mode without it.
    approved: bool = False

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
    # "course" | "community" | ...: used for events, summaries, challenges.
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
    # Plan feature the tool belongs to ("communities", "boards", ...). When the
    # org's plan or admin toggle has it off, the tool is hidden and denied,
    # the same as the feature's HTTP routes.
    feature: str | None = None
    # Short human name for clients that show one (MCP `title`).
    title: str | None = None
    # Reaches outside LearnHouse (fetches a URL the caller gave).
    open_world: bool = False
    # Group name MCP clients can filter on (?toolsets=courses,content).
    toolset: str | None = None
    # Connection access the tool needs; None derives it from the tier
    # (READ -> "read", anything else -> "write").
    access: ToolAccess | None = None
    # Needs a person's yes before it runs on MCP: deletions, changes to who
    # can do or see what, publishing, sending email, fetching outside URLs.
    # None derives it from the tier (DESTRUCTIVE only). `approval_if` makes it
    # depend on the arguments (an update that publishes, not one that renames).
    approval: bool | None = None
    approval_if: Callable[[BaseModel], bool] | None = None
    # The tool itself may decide mid-call (require_approval) that this call
    # needs approval, from state the arguments do not show.
    approval_in_call: bool = False
    # Calling twice with the same arguments leaves the same state.
    idempotent: bool = False
    # False where the matching HTTP route refuses API tokens.
    api_tokens: bool = True
    # Access checked on `target_param` when it differs from `access_action`
    # (posting in a community needs to read it, not to edit it).
    target_access: AccessAction | None = None

    @property
    def required_access(self) -> ToolAccess:
        if self.access:
            return self.access
        return "read" if self.tier is ActionTier.READ else "write"

    @property
    def may_need_approval(self) -> bool:
        """Whether some call of this tool needs approval (for listings)."""
        return self.approval_in_call or self.approval_if is not None or self.approval_for(None)

    def approval_for(self, params: BaseModel | None) -> bool:
        """Whether this call needs a person's approval."""
        if self.approval is not None:
            base = self.approval
        else:
            base = self.tier is ActionTier.DESTRUCTIVE
        if base or self.approval_if is None or params is None:
            return base
        try:
            return bool(self.approval_if(params))
        except Exception:
            return True  # fail closed


class ApprovalNeeded(Exception):
    """Raised by a tool, before it changes anything, when this particular call
    needs a person's approval and the arguments alone could not tell (a
    moderator rewriting someone else's post, not their own)."""


class ToolDenied(Exception):
    """Raised by a tool to refuse with an exact denial code, such as one
    passed on from a tool it ran on the caller's behalf."""

    def __init__(self, code: str, reason: str):
        super().__init__(reason)
        self.code = code
        self.reason = reason


def require_approval(ctx: "ToolContext", reason: str) -> None:
    """Stop here unless a person approved this call."""
    if not ctx.approved:
        raise ApprovalNeeded(reason)


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
