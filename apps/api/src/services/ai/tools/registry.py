"""Agent tool registry and the single enforcement pipeline.

Every surface (in-app agent chat, embedded MCP server, pending-action
apply) funnels tool calls through `run_tool`, so authorization and the
permission-mode gate are written exactly once:

    1. validate args against the tool's params model
    2. org AI kill switch (admin toggle / plan, via resolve_feature)
    3. principal gate — org membership (sessions) / org scope (API tokens)
    4. rights pre-flight — token bucket rights; resource RBAC when the tool
       names a target uuid; per-spec extra preflight (e.g. org admin)
    5. permission-mode gate — execute now, or return a PendingProposal
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
from src.security.rbac import AccessAction, AccessContext, check_resource_access
from src.services.ai.tools.base import (
    ActionTier,
    PendingProposal,
    ToolContext,
    ToolOutcome,
    ToolSpec,
)

logger = logging.getLogger(__name__)

# UUID prefixes registered with the resource-access checker; targets outside
# this set (playgrounds, usergroups, roles, ...) rely on token bucket rights
# + the services' own checks.
_RBAC_PREFIXES = (
    "course_",
    "chapter_",
    "activity_",
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


async def _ai_enabled_for_org(ctx: ToolContext) -> bool:
    """Org-level AI kill switch (admin toggle / plan entitlement)."""
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
        return False
    config = (org_config.config or {}) if org_config else {}
    resolved = resolve_feature("ai", config, ctx.org.id)
    return bool(resolved["enabled"])


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

    # 2. Org AI kill switch.
    if not await _ai_enabled_for_org(ctx):
        return ToolOutcome.denied(
            "ai_disabled", "AI is not enabled for this organization"
        )

    # 3. Principal gate.
    if isinstance(ctx.user, APITokenUser):
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

    # 4b. Resource RBAC pre-flight when the tool names a registered target.
    target_uuid = (
        getattr(params, spec.target_param, None) if spec.target_param else None
    )
    if target_uuid and isinstance(target_uuid, str) and target_uuid.startswith(
        _RBAC_PREFIXES
    ):
        try:
            decision = await check_resource_access(
                ctx.request,
                ctx.db_session,
                ctx.user,
                target_uuid,
                spec.access_action,
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
        if mode == "confirm":
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
        if mode == "execute" and spec.tier is ActionTier.DESTRUCTIVE:
            # Token surface: destructive calls need the explicit opt-in arg
            # (injected into the tool schema by the MCP adapter).
            if not (raw_args or {}).get("confirm"):
                return ToolOutcome.denied(
                    "confirmation_required",
                    "Destructive action: retry with confirm=true after "
                    "reviewing what will be deleted",
                )

    # 6. Execute.
    try:
        result = await spec.execute(ctx, params)
    except HTTPException as e:
        # Services speak HTTP; translate to a denial the model can read.
        return ToolOutcome.denied(f"http_{e.status_code}", str(e.detail))
    return ToolOutcome.executed(result)


def _validation_summary(e: ValidationError) -> str:
    parts = []
    for err in e.errors()[:5]:
        loc = ".".join(str(p) for p in err.get("loc", ()))
        parts.append(f"{loc}: {err.get('msg')}")
    return "Invalid arguments — " + "; ".join(parts)
