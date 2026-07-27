"""Apply/cancel pending actions by replaying them through the registry.

There is deliberately no per-tool dispatch here: applying a pending action
rebuilds a ToolContext in execute mode and funnels the stored (tool, args)
snapshot back through `run_tool`, so propose-time and apply-time behavior
can never drift.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from src.security.auth import resolve_acting_user_id
from src.services.ai.actions.pending import PendingAction, PendingStore
from src.services.ai.tools.base import ActionTier, ToolContext, ToolOutcome
from src.services.ai.tools.registry import ToolRegistry, run_tool

logger = logging.getLogger(__name__)


@dataclass
class ApplyResult:
    action: PendingAction | None
    outcome: ToolOutcome


async def apply_pending_action(
    store: PendingStore,
    registry: ToolRegistry,
    pending_id: str,
    ctx: ToolContext,
    confirmation_phrase: str | None = None,
) -> ApplyResult:
    """Apply a pending action on behalf of its creator.

    Ownership, challenge verification, and the applying/applied/failed
    transitions happen here; authorization is re-checked inside `run_tool`
    (rights may have changed since the proposal was created).
    """
    action = store.get(pending_id)
    if action is None:
        return ApplyResult(
            None, ToolOutcome.denied("pending_not_found", "Pending action not found")
        )

    acting_user_id = resolve_acting_user_id(ctx.user)
    if action.user_id != acting_user_id or action.org_id != ctx.org.id:
        # Same shape as not-found so pending ids can't be probed.
        return ApplyResult(
            None, ToolOutcome.denied("pending_not_found", "Pending action not found")
        )

    if action.requires_confirmation and not store.verify_challenge(
        action, confirmation_phrase
    ):
        return ApplyResult(
            action,
            ToolOutcome.denied(
                "challenge_failed",
                "Confirmation phrase does not match",
            ),
        )

    started = store.begin_apply(pending_id)
    if started is None:
        return ApplyResult(
            action,
            ToolOutcome.denied(
                "pending_conflict",
                f"Pending action is not applicable (status: {action.status})",
            ),
        )

    args = dict(started.args)
    if started.tier == ActionTier.DESTRUCTIVE.value:
        # The challenge was verified above; satisfy the execute-mode
        # destructive opt-in without asking the user twice.
        args["confirm"] = True

    outcome = await run_tool(registry, started.tool, args, ctx.with_mode("execute"))

    if outcome.status == "executed":
        spec = registry.get(started.tool)
        version_after = None
        if isinstance(outcome.result, dict):
            version_after = outcome.result.get("current_version") or outcome.result.get(
                "version_after"
            )
        finished = store.finish_apply(
            pending_id,
            version_after=version_after,
            with_undo=bool(spec and spec.build_undo),
        )
        return ApplyResult(finished or started, outcome)

    store.fail_apply(pending_id, outcome.reason or outcome.status)
    return ApplyResult(store.get(pending_id), outcome)


def cancel_pending_action(
    store: PendingStore,
    pending_id: str,
    ctx: ToolContext,
) -> PendingAction | None:
    """Cancel an open pending action owned by the caller."""
    action = store.get(pending_id)
    if action is None:
        return None
    if (
        action.user_id != resolve_acting_user_id(ctx.user)
        or action.org_id != ctx.org.id
    ):
        return None
    return store.cancel(pending_id)
