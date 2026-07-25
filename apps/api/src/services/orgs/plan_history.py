"""
Plan history: which plan an organization held during a past calendar month.

Active-user overage is billed in arrears — a month in arrears for monthly
subscriptions, up to a year for annual ones. Resolving the member limit from the
org's *current* plan would therefore bill a past month against a limit the org
may never have had that month. This module records plan changes as they happen
and answers "what limit applied during month X".
"""

import logging
from calendar import monthrange
from datetime import datetime, timezone
from typing import Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organization_plan_history import OrganizationPlanHistory
from src.security.features_utils.plans import get_plan_limit

logger = logging.getLogger(__name__)


def month_bounds_utc(year: int, month: int) -> tuple[datetime, datetime]:
    """[start, end) of a UTC calendar month."""
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    last_day = monthrange(year, month)[1]
    end = datetime(year, month, last_day, 23, 59, 59, 999999, tzinfo=timezone.utc)
    return start, end


async def record_plan_change(
    org_id: int,
    old_plan: Optional[str],
    new_plan: Optional[str],
    db_session: AsyncSession,
) -> bool:
    """
    Append a history row when an org's plan actually changed. Best-effort:
    never raises, so a bookkeeping failure can't block the plan change itself.

    Returns True when a row was written.
    """
    try:
        if not new_plan or old_plan == new_plan:
            return False
        db_session.add(
            OrganizationPlanHistory(
                org_id=org_id,
                plan=new_plan,
                effective_from=datetime.now(timezone.utc),
            )
        )
        # Flushed with the caller's transaction: the history row and the config
        # write land together or not at all.
        await db_session.flush()
        return True
    except Exception:
        logger.warning(
            "failed to record plan change for org %s (%s -> %s)",
            org_id, old_plan, new_plan, exc_info=True,
        )
        return False


def _limit_rank(limit: int) -> float:
    """Sort key for member limits, where 0 means unlimited."""
    return float("inf") if limit <= 0 else float(limit)


async def resolve_plan_for_month(
    org_id: int,
    year: int,
    month: int,
    current_plan: str,
    db_session: AsyncSession,
) -> tuple[str, int]:
    """
    The plan and member limit to bill `org_id` against for a calendar month.

    Policy: the most generous member limit the org held at any point during the
    month. An org is never billed against a limit lower than one it was paying
    for during that month, which keeps a retroactive charge defensible. The
    trade-off is a small under-bill when an org upgrades late in a month.

    Falls back to `current_plan` when no history covers the month — orgs that
    predate this table, or that never changed plan.
    """
    start, end = month_bounds_utc(year, month)

    rows = (
        await db_session.execute(
            select(OrganizationPlanHistory)
            .where(
                OrganizationPlanHistory.org_id == org_id,
                OrganizationPlanHistory.effective_from <= end,
            )
            .order_by(OrganizationPlanHistory.effective_from)
        )
    ).scalars().all()

    if not rows:
        return current_plan, get_plan_limit(current_plan, "members")

    # The plan in force when the month opened is the last change at or before
    # the start; every change inside the month is a candidate on top of that.
    candidates: list[str] = []
    opening: Optional[str] = None
    for row in rows:
        effective_from = row.effective_from
        if effective_from.tzinfo is None:
            effective_from = effective_from.replace(tzinfo=timezone.utc)
        if effective_from <= start:
            opening = row.plan
        else:
            candidates.append(row.plan)

    if opening is not None:
        candidates.append(opening)
    elif not candidates:
        # History exists but starts after this month — nothing covers it.
        return current_plan, get_plan_limit(current_plan, "members")

    best_plan = max(candidates, key=lambda p: _limit_rank(get_plan_limit(p, "members")))
    return best_plan, get_plan_limit(best_plan, "members")
