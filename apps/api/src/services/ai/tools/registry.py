"""Agent tool registry and the single enforcement pipeline.

Every surface (in-app agent chat, embedded MCP server, pending-action
apply) funnels tool calls through `run_tool`, so authorization and the
permission-mode gate are written exactly once:

    1. validate args against the tool's params model
    2. org AI kill switch (in-app agent only: it spends AI credits), the
       tool's plan feature, and the read-only scope
    3. principal gate: org membership (sessions) / org scope (API tokens)
    4. rights pre-flight: token bucket rights; resource RBAC when the tool
       names a target uuid; per-spec extra preflight (e.g. org admin)
    5. permission-mode gate: execute now, or return a PendingProposal
    6. execute the wrapped service function (services re-check RBAC
       internally: defense in depth)
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError
from sqlmodel import select

from src.db.organization_config import OrganizationConfig
from src.db.users import APITokenUser, PublicUser
from src.security.auth import resolve_acting_user_id
from src.security.features_utils.resolve import resolve_feature
from src.security.org_auth import is_org_admin, is_org_member
from src.security.org_scope import org_scope
from src.security.rbac import AccessAction, AccessContext, check_resource_access
from src.services.ai.tools import refs
from src.services.ai.tools.base import (
    ActionTier,
    ApprovalNeeded,
    PendingProposal,
    ToolContext,
    ToolDenied,
    ToolOutcome,
    ToolSpec,
)

logger = logging.getLogger(__name__)

# UUID prefixes we can safely pre-flight through check_resource_access.
# Targets outside this set (activities, playgrounds, usergroups, roles, ...)
# rely on token bucket rights + the services' own authoritative checks.
#
# `activity_` is deliberately excluded: activities have no chapter_id column
# (they link to chapters via the ChapterActivity association table), so the
# shared checker's parent resolution can never find their parent and always
# denies. The activity services resolve the parent course themselves and call
# check_resource_access on it, so access is still enforced, just at the
# service layer, not this pre-flight.
_RBAC_PREFIXES = (
    "course_",
    "chapter_",
    "podcast_",
    "episode_",
    "community_",
    "discussion_",
    "folder_",
    "media_",
    "board_",
)

_ACTION_FIELD = {
    AccessAction.CREATE: "action_create",
    AccessAction.READ: "action_read",
    AccessAction.UPDATE: "action_update",
    AccessAction.DELETE: "action_delete",
}


class ToolRegistry:
    """Name → ToolSpec lookup. Built once at import time per process."""

    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        if spec.name in self._tools:
            raise ValueError(f"duplicate tool name: {spec.name}")
        self._tools[spec.name] = spec

    def register_all(self, specs: list[ToolSpec]) -> None:
        for spec in specs:
            self.register(spec)

    def get(self, name: str) -> ToolSpec | None:
        return self._tools.get(name)

    def specs(self) -> list[ToolSpec]:
        return list(self._tools.values())


def _token_bucket_allows(
    rights: Any, bucket: str, action: AccessAction
) -> bool:
    """Read a Rights model or plain dict: does `bucket` grant `action`?"""
    if not rights:
        return False
    if isinstance(rights, dict):
        bucket_rights = rights.get(bucket)
    else:
        bucket_rights = getattr(rights, bucket, None)
    if not bucket_rights:
        return False
    field = _ACTION_FIELD[action]
    if isinstance(bucket_rights, dict):
        return bool(bucket_rights.get(field, False))
    return bool(getattr(bucket_rights, field, False))


async def _org_config(ctx: ToolContext) -> dict | None:
    """The org's config blob, or None when it cannot be read (fail closed)."""
    try:
        org_config = (
            await ctx.db_session.execute(
                select(OrganizationConfig).where(
                    OrganizationConfig.org_id == ctx.org.id
                )
            )
        ).scalars().first()
    except Exception:
        logger.exception(
            "agent-tools: failed to load org config for org %s", ctx.org.id
        )
        return None
    return (org_config.config or {}) if org_config else {}


async def _ai_enabled_for_org(ctx: ToolContext) -> bool:
    """Org-level AI kill switch (admin toggle / plan entitlement)."""
    config = await _org_config(ctx)
    if config is None:
        return False
    resolved = resolve_feature("ai", config, ctx.org.id)
    return bool(resolved["enabled"])


def feature_state(spec: ToolSpec, config: dict, org_id: int) -> dict | None:
    """resolve_feature() for the tool's plan feature; None when it has none."""
    if not spec.feature:
        return None
    return resolve_feature(spec.feature, config, org_id)


def tool_available(
    spec: ToolSpec, config: dict, org_id: int, read_only: bool, can_admin: bool = True
) -> bool:
    """Whether a caller with this org config and scope may see the tool."""
    if read_only and spec.required_access != "read":
        return False
    if spec.required_access == "admin" and not can_admin:
        return False
    state = feature_state(spec, config, org_id)
    return state is None or bool(state["enabled"])


async def _effective_mode(ctx: ToolContext) -> str:
    """Resolve the requested mode: `autonomous` is honored only for org
    admins/maintainers; everyone else is downgraded to `confirm`."""
    if ctx.mode != "autonomous":
        return ctx.mode
    acting_user_id = resolve_acting_user_id(ctx.user)
    if await is_org_admin(acting_user_id, ctx.org.id, ctx.db_session):
        return "autonomous"
    return "confirm"


def _summary_for(spec: ToolSpec, params: BaseModel) -> str:
    if spec.summarize:
        try:
            return spec.summarize(params)
        except Exception:  # pragma: no cover - defensive
            logger.exception("agent-tools: summarize failed for %s", spec.name)
    return spec.description


def _target_for(spec: ToolSpec, params: BaseModel) -> dict[str, Any]:
    target: dict[str, Any] = {"kind": spec.target_kind or "resource"}
    if spec.target_param:
        target["uuid"] = getattr(params, spec.target_param, None)
    name = getattr(params, "name", None) or getattr(params, "title", None)
    if name:
        target["name"] = name
    return target


async def run_tool(
    registry: ToolRegistry,
    name: str,
    raw_args: dict[str, Any],
    ctx: ToolContext,
) -> ToolOutcome:
    """The single enforcement pipeline for every agent tool call."""

    spec = registry.get(name)
    if spec is None:
        return ToolOutcome.denied("unknown_tool", f"Unknown tool: {name}")

    # 1. Validate args.
    try:
        params = spec.params_model.model_validate(raw_args or {})
    except ValidationError as e:
        return ToolOutcome.denied("invalid_args", _validation_summary(e))

    # 1b. Tiers the caller was limited to (scheduled agents never delete).
    if ctx.allowed_tiers is not None and spec.tier.value not in ctx.allowed_tiers:
        return ToolOutcome.denied(
            "tier_not_allowed",
            f"This agent is not allowed to run {spec.tier.value} actions.",
        )

    # 2. Org AI kill switch (the in-app agent spends org AI credits; an MCP
    #    client brings its own model), plan feature, read-only scope.
    if ctx.surface == "agent" and not await _ai_enabled_for_org(ctx):
        return ToolOutcome.denied(
            "ai_disabled", "AI is not enabled for this organization"
        )
    if ctx.read_only and spec.required_access != "read":
        return ToolOutcome.denied(
            "insufficient_scope",
            "This connection is read-only. Reconnect the app with write access "
            "to make changes.",
        )
    if spec.required_access == "admin" and not ctx.can_admin:
        return ToolOutcome.denied(
            "insufficient_scope",
            "This connection was not given admin access. Reconnect the app with "
            "admin access to manage members, roles and settings.",
        )
    if spec.feature:
        config = await _org_config(ctx)
        state = feature_state(spec, config or {}, ctx.org.id) if config is not None else None
        if state is None or not state["enabled"]:
            return ToolOutcome.denied(
                "feature_unavailable", _feature_denial(spec.feature, state, config or {})
            )

    # 3. Principal gate.
    if isinstance(ctx.user, APITokenUser):
        if not spec.api_tokens:
            return ToolOutcome.denied(
                "not_for_api_tokens",
                "This tool acts as a person and does not accept API tokens.",
            )
        if ctx.user.org_id != ctx.org.id:
            return ToolOutcome.denied(
                "org_mismatch",
                "API token cannot act outside its organization",
            )
    elif isinstance(ctx.user, PublicUser):
        acting_user_id = resolve_acting_user_id(ctx.user)
        if not await is_org_member(acting_user_id, ctx.org.id, ctx.db_session):
            return ToolOutcome.denied(
                "not_a_member", "User is not a member of this organization"
            )
    else:  # AnonymousUser or anything else
        return ToolOutcome.denied("unauthenticated", "Authentication required")

    # 4a. API-token bucket rights (uniform across all buckets).
    if isinstance(ctx.user, APITokenUser) and spec.rights_bucket:
        if not _token_bucket_allows(
            ctx.user.rights, spec.rights_bucket, spec.access_action
        ):
            return ToolOutcome.denied(
                "missing_right",
                f"API token lacks {spec.rights_bucket}."
                f"{_ACTION_FIELD[spec.access_action]}",
            )

    with org_scope(ctx.org.id):
        # 4. Names given where an id goes ("the solar course") become ids,
        #    looked up only where the caller can see.
        named = await resolve_names(spec, raw_args or {}, ctx)
        if isinstance(named, ToolOutcome):
            return named
        args, resolved = named
        if resolved:
            try:
                params = spec.params_model.model_validate(args)
            except ValidationError as e:
                return ToolOutcome.denied("invalid_args", _validation_summary(e))
        outcome = await _gate_and_execute(spec, params, args, ctx)
        if resolved and outcome.status == "executed" and isinstance(outcome.result, dict):
            # Say what the names were taken to mean, so a wrong guess is visible.
            outcome.result.setdefault("resolved", resolved)
        return outcome


async def resolve_names(
    spec: ToolSpec, args: dict[str, Any], ctx: ToolContext
) -> tuple[dict[str, Any], dict[str, dict]] | ToolOutcome:
    """The call's arguments with names in id parameters swapped for ids
    (discovery.resolve_names), or the refusal to return instead."""
    from src.services.ai.tools import discovery

    fields = set(spec.params_model.model_fields)
    if not any(
        param in fields and isinstance(args.get(param), str) and args[param].strip()
        and not discovery._looks_like_id(args[param])
        for param, _kind in discovery.NAMEABLE
    ):
        return args, {}
    try:
        return await discovery.resolve_names(ctx, fields, args)
    except HTTPException as e:
        return ToolOutcome.denied(f"http_{e.status_code}", str(e.detail))


async def _gate_and_execute(
    spec: ToolSpec, params: BaseModel, raw_args: dict[str, Any], ctx: ToolContext
) -> ToolOutcome:
    """Steps 4 to 6, inside the caller's organization boundary."""
    # 4b. Resource RBAC pre-flight when the tool names a registered target.
    target_uuid = (
        getattr(params, spec.target_param, None) if spec.target_param else None
    )
    if target_uuid and isinstance(target_uuid, str) and target_uuid.startswith(
        _RBAC_PREFIXES
    ):
        # Missing, wrong kind or another organization's: all answer "not
        # found", so a call never confirms that an id exists elsewhere.
        kind = refs.kind_of(target_uuid)
        if kind:
            try:
                await refs.load(ctx, kind, target_uuid)
            except HTTPException as e:
                return ToolOutcome.denied(f"http_{e.status_code}", str(e.detail))
        try:
            decision = await check_resource_access(
                ctx.request,
                ctx.db_session,
                ctx.user,
                target_uuid,
                spec.target_access or spec.access_action,
                context=AccessContext.DASHBOARD,
                raise_on_deny=False,
            )
        except HTTPException as e:
            return ToolOutcome.denied("rbac_denied", str(e.detail))
        except Exception:
            logger.exception(
                "agent-tools: RBAC pre-flight failed for %s on %s",
                spec.name,
                target_uuid,
            )
            return ToolOutcome.denied(
                "rbac_error", "Could not verify access to the target resource"
            )
        if not decision.allowed:
            return ToolOutcome.denied(
                "rbac_denied",
                decision.reason or "Access denied to the target resource",
            )

    # 4c. Per-spec extra preflight (e.g. org-admin requirement).
    if spec.preflight:
        denial = await spec.preflight(ctx, params)
        if denial:
            return ToolOutcome.denied("preflight_denied", denial)

    # 5. Permission-mode gate.
    mode = await _effective_mode(ctx)
    if spec.tier is not ActionTier.READ:
        # In the in-app agent, changes that need a person's yes stay proposals
        # even in autonomous mode.
        if mode == "confirm" or (mode == "autonomous" and spec.approval_for(params)):
            proposal = PendingProposal(
                tool=spec.name,
                args=params.model_dump(mode="json"),
                tier=spec.tier,
                target=_target_for(spec, params),
                summary=_summary_for(spec, params),
                requires_confirmation=spec.tier is ActionTier.DESTRUCTIVE,
                scope_key=ctx.scope_key,
                org_id=ctx.org.id,
                user_id=resolve_acting_user_id(ctx.user),
            )
            return ToolOutcome.proposed(proposal)
        if mode == "execute" and spec.approval_for(params) and not ctx.approved:
            # The MCP layer collects the approval (a form in the client, a
            # page in LearnHouse, or confirm=true for API tokens) and marks
            # the context; nothing else can.
            return ToolOutcome.denied(
                "approval_required",
                "This change needs the user's approval before it runs.",
            )

    # 6. Execute. The in-app agent (Atlas) writes as itself in live rooms.
    from src.services.courses.activities.collab_notify import writing_agent

    agent_token = writing_agent.set("Atlas") if ctx.surface == "agent" else None
    try:
        result = await spec.execute(ctx, params)
    except ToolDenied as e:
        return ToolOutcome.denied(e.code, e.reason)
    except ApprovalNeeded as e:
        if mode == "execute" and not ctx.approved:
            return ToolOutcome.denied("approval_required", str(e) or "This change needs the user's approval.")
        if mode != "execute":
            return ToolOutcome.proposed(
                PendingProposal(
                    tool=spec.name,
                    args=params.model_dump(mode="json"),
                    tier=spec.tier,
                    target=_target_for(spec, params),
                    summary=_summary_for(spec, params),
                    requires_confirmation=False,
                    scope_key=ctx.scope_key,
                    org_id=ctx.org.id,
                    user_id=resolve_acting_user_id(ctx.user),
                )
            )
        raise
    except HTTPException as e:
        # Services speak HTTP; translate to a denial the model can read.
        detail = str(e.detail)
        if e.status_code == 403 and "usage limit" in detail.lower():
            return ToolOutcome.denied("plan_limit", detail)
        return ToolOutcome.denied(f"http_{e.status_code}", detail)
    finally:
        if agent_token is not None:
            writing_agent.reset(agent_token)
    return ToolOutcome.executed(result)


def _feature_denial(feature: str, state: dict | None, config: dict) -> str:
    label = feature.replace("_", " ").capitalize()
    if state is None or state.get("available"):
        return f"{label} is turned off for this organization."
    from src.security.features_utils.plans import plan_meets_requirement

    if str(config.get("config_version", "1.0")).startswith("2"):
        plan = config.get("plan", "free")
    else:
        plan = config.get("cloud", {}).get("plan", "free")
    required = state.get("required_plan")
    if required and not plan_meets_requirement(plan, required):
        return f"{label} is not included in the {plan} plan; it is available from the {required} plan."
    return f"{label} is not included in this organization's {plan} plan."


def _validation_summary(e: ValidationError) -> str:
    parts = []
    for err in e.errors()[:5]:
        loc = ".".join(str(p) for p in err.get("loc", ()))
        parts.append(f"{loc}: {err.get('msg')}")
    return "Invalid arguments: " + "; ".join(parts)
