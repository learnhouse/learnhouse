"""AI credits tool: the organization's AI balance and where credits go.

Calls the AI credits routes' own handlers, so the rules are theirs: any member
sees the balance; the usage breakdown (by feature, member and day) is for org
admins. An API token acts for the member who created it, in its own
organization only.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, Field

from src.routers.orgs import ai_credits as routes
from src.security.rbac import AccessAction
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec


class GetAICreditsParams(BaseModel):
    usage_days: int = Field(
        30, ge=0, le=366, description="Also break down the last N days of usage (org admins); 0 for the balance only."
    )
    include_prices: bool = Field(False, description="Also list the credit price of every AI feature.")


async def _get_ai_credits(ctx: ToolContext, p: GetAICreditsParams) -> dict[str, Any]:
    summary = await routes.get_org_ai_credits(ctx.org.id, ctx.user, ctx.db_session)
    out: dict[str, Any] = {"balance": summary.model_dump()}
    if p.usage_days:
        try:
            usage = await routes.get_org_ai_usage(ctx.org.id, p.usage_days, ctx.user, ctx.db_session)
            out["usage"] = {k: usage[k] for k in ("from", "to", "days", "total_credits", "total_requests", "by_feature", "by_member") if k in usage}
        except HTTPException as e:
            if e.status_code != 403:
                raise
            out["usage"] = None
            out["note"] = "The usage breakdown is for organization admins."
    if p.include_prices:
        out["prices"] = (await routes.get_org_ai_prices(ctx.org.id, ctx.user, ctx.db_session))["features"]
    base = await refs.web_base(ctx)
    out["url"] = f"{base}/dash/org/settings/ai" if base else None
    return out


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="get_ai_credits",
        title="AI credits",
        description=(
            "The organization's AI credits: plan allowance, purchased, used and remaining, and the balance state "
            "(ok, low, critical, empty, unlimited). Admins also get usage by feature and by member over usage_days."
        ),
        params_model=GetAICreditsParams,
        tier=ActionTier.READ,
        rights_bucket=None,
        access_action=AccessAction.READ,
        execute=_get_ai_credits,
        idempotent=True,
    ),
]
