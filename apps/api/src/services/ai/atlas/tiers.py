"""Atlas permission tier model.

Defines the four-tier classification (READ / CREATE / EDIT / DESTRUCTIVE),
the spec a tool carries when registered, the destructive-confirmation
challenge, and a structured error type that propagates back from MCP
tools without string-parsing.

The tier system is the single source of truth for:
  - whether a tool is callable by the LLM at all (apply_* tools never are);
  - whether emitting it requires a preview card and/or a typed challenge;
  - the cross-tier guard that blocks DESTRUCTIVE after any other tool in
    the same agent turn.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


Tier = Literal["READ", "CREATE", "EDIT", "DESTRUCTIVE"]


class ToolSpec(BaseModel):
    """Metadata describing one Atlas-callable MCP tool.

    Populated from the MCP tool's ``_meta`` annotations at proxy-init time.
    The pipeline reads ``is_apply`` to filter apply_* tools out of the
    LLM-visible catalog, and ``tier`` to enforce the cross-tier guard and
    decide whether to emit a preview / challenge event.
    """

    name: str
    tier: Tier
    requires_preview: bool = False
    requires_challenge: bool = False
    is_apply: bool = False
    description: str = ""

    @classmethod
    def from_mcp_meta(cls, name: str, description: str, meta: dict[str, Any]) -> "ToolSpec":
        """Build a spec from an MCP tool's ``_meta`` dict.

        Fail-safe defaults: when metadata is missing or malformed, the
        tool is treated as EDIT with a required preview, so the worst case
        is a stricter UX, never a silent destructive call.
        """
        tier = meta.get("atlas.tier", "EDIT")
        if tier not in ("READ", "CREATE", "EDIT", "DESTRUCTIVE"):
            tier = "EDIT"
        return cls(
            name=name,
            description=description,
            tier=tier,
            requires_preview=bool(meta.get("atlas.requires_preview", tier != "READ")),
            requires_challenge=bool(meta.get("atlas.requires_challenge", tier == "DESTRUCTIVE")),
            is_apply=bool(meta.get("atlas.is_apply", name.startswith("apply_"))),
        )


class ConfirmationChallenge(BaseModel):
    """The typed challenge a destructive tier requires before apply.

    The frontend renders an input pre-filled with ``action_label`` and
    ``blast_radius_summary``; the user must type ``challenge_phrase``
    verbatim. The backend re-validates the typed phrase against this
    record on ``/pending/{id}/apply`` — mismatch returns 400 before any
    service call runs.
    """

    pending_id: str
    action_label: str = Field(description='e.g. "Delete chapter \'Network basics\'"')
    blast_radius_summary: str = Field(
        description="What this irreversibly removes; used as the card subtitle."
    )
    challenge_phrase: str = Field(description="The literal text the user must type back.")
    challenge_kind: Literal["type_name", "type_phrase"] = "type_name"


class ToolError(BaseModel):
    """Structured error payload returned by an Atlas MCP tool.

    Replaces the old practice of stringifying HTTP errors into
    ``"ERROR: LearnHouse API 400: ..."`` and regex-parsing them back
    out. Atlas MCP tools must return this shape when ``ok=False``; the
    proxy parses once and emits a typed event downstream.
    """

    code: str = Field(description="Stable machine-readable code, e.g. 'not_found'.")
    message: str
    retriable: bool = False
    details: dict[str, Any] = Field(default_factory=dict)


_TRANSIENT_CODES = {"timeout", "upstream_unavailable", "rate_limited", "internal_error"}


def classify_error(err: ToolError) -> Literal["retriable", "user_input", "permission", "fatal"]:
    """Decide how the chat surface should render a tool error.

    ``retriable``: transient infra issue → ErrorBanner with Retry button.
    ``user_input``: bad arg / not found / ambiguous → surface as a hint
        message so the agent's next turn can clarify or disambiguate.
    ``permission``: 401/403 → terminate the turn with a clear refusal.
    ``fatal``: everything else; collapse the pending edit (if any) and
        show ErrorBanner without retry.
    """
    code = err.code.lower()
    if err.retriable or code in _TRANSIENT_CODES:
        return "retriable"
    if code in ("unauthorized", "forbidden", "plan_required", "rate_limited_user"):
        return "permission"
    if code in (
        "not_found",
        "ambiguous",
        "invalid_argument",
        "stale_version",
        "preconditions_failed",
        "type_not_supported",
    ):
        return "user_input"
    return "fatal"


class TurnState(BaseModel):
    """Per-turn mutable bookkeeping for the cross-tier guard.

    A fresh instance is created at the top of every ``pipeline.run_turn``.
    The dispatcher flips ``has_emitted_tools`` to ``True`` on the *first*
    tool call; any subsequent DESTRUCTIVE propose_* call is rejected
    with a synthetic error, forcing the model to wait for a new user
    turn before proposing a destructive action.
    """

    has_emitted_tools: bool = False
    emitted_tool_names: list[str] = Field(default_factory=list)


class GuardDecision(BaseModel):
    """Result of dispatching a tool call through the cross-tier guard."""

    allowed: bool
    reason: Optional[str] = None


def evaluate_guard(spec: ToolSpec, state: TurnState) -> GuardDecision:
    """Apply the two-invariant cross-tier guard.

    1. ``apply_*`` is never callable by the LLM; only the
       ``/pending/{id}/apply`` HTTP endpoint dispatches it.
    2. DESTRUCTIVE ``propose_*`` cannot run if any tool already ran in
       this turn — destructive actions need a fresh user message.
    """
    if spec.is_apply:
        return GuardDecision(
            allowed=False,
            reason=(
                "apply_* tools run only after the user confirms a pending edit. "
                "Propose the change instead."
            ),
        )
    if spec.tier == "DESTRUCTIVE" and state.has_emitted_tools:
        return GuardDecision(
            allowed=False,
            reason=(
                "Destructive actions require a fresh user message. Propose only "
                "this turn; the next turn can approve it."
            ),
        )
    return GuardDecision(allowed=True)
