"""
Active-user computation and billing.

A plan includes a fixed number of members outright. Those seats are paid for by
the subscription regardless of what the members do, so nothing extra is charged
while an org stays within them. Only once an org holds MORE members than its plan
includes does activity start to matter, and then only for the members beyond the
included count: each of those who is active in the month costs
ACTIVE_USER_OVERAGE_PRICE_USD.

"Included" means the earliest joiners — members are ranked by join date, and the
first plan_limit of them are the ones the subscription already covers.

Active user = a member with >= 2 distinct UTC activity days in a calendar month
(see src/db/user_activity.py). This module only COMPUTES and EXPOSES the overage;
the platform service performs the actual Stripe charge.
"""

from datetime import date, datetime, timezone
from typing import Optional

from sqlmodel import select, func
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy import and_

from src.db.user_activity import UserActivityDay
from src.db.organization_plan_history import OrganizationPlanHistory  # noqa: F401 — register table on SQLModel.metadata
from src.db.user_organizations import UserOrganization
from src.security.features_utils.usage import _get_org_config, _get_org_plan, _is_non_saas

# Flat price per active user over the included member limit, per month.
ACTIVE_USER_OVERAGE_PRICE_USD = 1

# A user must be seen on at least this many distinct days in the month to count.
ACTIVE_DAYS_THRESHOLD = 2


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    """Return (start inclusive, end exclusive) UTC dates for a calendar month."""
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month + 1, 1)
    return start, end


def current_utc_year_month() -> tuple[int, int]:
    now = datetime.now(timezone.utc)
    return now.year, now.month


async def count_active_users(
    org_id: int, year: int, month: int, db_session: AsyncSession
) -> int:
    """Number of users with >= ACTIVE_DAYS_THRESHOLD distinct activity days in the month."""
    start, end = _month_bounds(year, month)
    per_user = (
        select(UserActivityDay.user_id)
        .where(
            UserActivityDay.org_id == org_id,
            UserActivityDay.activity_date >= start,
            UserActivityDay.activity_date < end,
        )
        .group_by(UserActivityDay.user_id)
        .having(func.count(UserActivityDay.activity_date) >= ACTIVE_DAYS_THRESHOLD)
        .subquery()
    )
    result = await db_session.execute(select(func.count()).select_from(per_user))
    return int(result.scalar_one())


async def get_member_active_status(
    org_id: int, year: int, month: int, db_session: AsyncSession
) -> dict[int, dict]:
    """
    Per-member visit count + active flag for the month, keyed by user_id.

    LEFT JOIN from org membership so members with zero visits still appear
    (visit_days=0, is_active=False).
    """
    start, end = _month_bounds(year, month)
    visit_days = func.count(UserActivityDay.id)
    stmt = (
        select(UserOrganization.user_id, visit_days.label("visit_days"))
        .select_from(UserOrganization)
        .outerjoin(
            UserActivityDay,
            and_(
                UserActivityDay.org_id == UserOrganization.org_id,
                UserActivityDay.user_id == UserOrganization.user_id,
                UserActivityDay.activity_date >= start,
                UserActivityDay.activity_date < end,
            ),
        )
        .where(UserOrganization.org_id == org_id)
        .group_by(UserOrganization.user_id)
    )
    rows = (await db_session.execute(stmt)).all()
    return {
        int(user_id): {
            "visit_days": int(days),
            "is_active": int(days) >= ACTIVE_DAYS_THRESHOLD,
        }
        for user_id, days in rows
    }


async def get_visit_days_for_users(
    org_id: int,
    user_ids: list[int],
    year: int,
    month: int,
    db_session: AsyncSession,
) -> dict[int, int]:
    """Distinct activity-day count in the month for a specific set of users."""
    if not user_ids:
        return {}
    start, end = _month_bounds(year, month)
    stmt = (
        select(UserActivityDay.user_id, func.count(UserActivityDay.id))
        .where(
            UserActivityDay.org_id == org_id,
            UserActivityDay.user_id.in_(user_ids),
            UserActivityDay.activity_date >= start,
            UserActivityDay.activity_date < end,
        )
        .group_by(UserActivityDay.user_id)
    )
    rows = (await db_session.execute(stmt)).all()
    return {int(uid): int(days) for uid, days in rows}


async def get_members_beyond_included(
    org_id: int,
    year: int,
    month: int,
    plan_limit: int,
    db_session: AsyncSession,
) -> list[int]:
    """
    User ids of the members NOT covered by the plan's included seats.

    Members are ranked by join date (earliest first) and the first `plan_limit`
    are the included ones. Only members who had joined by the end of the billed
    month count, so billing a past month doesn't rank people who joined later.

    Empty when the plan is unlimited or the org is within its included count.
    """
    if plan_limit <= 0:
        return []

    _, end = _month_bounds(year, month)
    stmt = (
        select(UserOrganization.user_id)
        .where(
            UserOrganization.org_id == org_id,
            # creation_date is stored as str(datetime) — "YYYY-MM-DD HH:MM:SS…"
            # sorts and compares correctly as a string.
            UserOrganization.creation_date < str(end),
        )
        # id is the tie-break so equal timestamps still rank deterministically.
        .order_by(UserOrganization.creation_date, UserOrganization.id)
    )
    member_ids = [int(uid) for uid in (await db_session.execute(stmt)).scalars().all()]
    return member_ids[plan_limit:]


async def calculate_active_user_overage(
    org_id: int,
    year: int,
    month: int,
    plan_limit: int,
    db_session: AsyncSession,
) -> dict:
    """
    Active-user overage for an org in a calendar month.

    The plan's included seats are free whatever their holders do. Overage is the
    number of members BEYOND those seats who were active in the month — an org
    inside its included count never has any, however active it is.
    """
    active = await count_active_users(org_id, year, month, db_session)

    excess_member_ids = await get_members_beyond_included(
        org_id, year, month, plan_limit, db_session
    )
    if excess_member_ids:
        visit_days = await get_visit_days_for_users(
            org_id, excess_member_ids, year, month, db_session
        )
        overage_units = sum(
            1 for uid in excess_member_ids
            if visit_days.get(uid, 0) >= ACTIVE_DAYS_THRESHOLD
        )
    else:
        overage_units = 0

    return {
        "feature": "active_members",
        "year": year,
        "month": month,
        "active_users": active,
        "limit": plan_limit if plan_limit > 0 else "unlimited",
        "members_beyond_included": len(excess_member_ids),
        "overage_units": overage_units,
        "overage_usd": overage_units * ACTIVE_USER_OVERAGE_PRICE_USD,
    }


async def get_all_orgs_with_active_user_overage(
    year: int, month: int, db_session: AsyncSession
) -> list[dict]:
    """
    Month-end batch: active-user overage summary for every org that had any
    activity in the month and is over its included member limit.

    Computes only — the platform service performs the Stripe charge.
    """
    start, end = _month_bounds(year, month)
    org_ids = (
        await db_session.execute(
            select(UserActivityDay.org_id)
            .where(
                UserActivityDay.activity_date >= start,
                UserActivityDay.activity_date < end,
            )
            .distinct()
        )
    ).scalars().all()

    results = []
    for org_id in org_ids:
        summary = await get_active_user_summary(org_id, db_session, year=year, month=month)
        if summary["overage_units"] > 0:
            results.append(summary)
    return results


async def get_active_user_summary(
    org_id: int,
    db_session: AsyncSession,
    year: Optional[int] = None,
    month: Optional[int] = None,
) -> dict:
    """
    Full active-user + overage summary for an org (defaults to current UTC month).

    Resolves the plan and member limit that applied during the requested month
    via resolve_plan_for_month, not the org's plan today — overage is billed in
    arrears. In non-SaaS mode the limit is treated as unlimited (no overage).
    """
    if year is None or month is None:
        year, month = current_utc_year_month()

    # The demo organization seeds UserActivityDay rows so its dashboards and
    # the Users page are not empty. Those rows are synthetic, and this function
    # is what the platform reads to build a Stripe invoice line — so the demo
    # is zeroed here, at the single point both the per-org endpoint and the
    # month-end batch (get_all_orgs_with_active_user_overage) funnel through.
    # Returning zero overage_units also drops it from that batch's results.
    from src.services.demo.guards import is_demo_org

    if await is_demo_org(org_id, db_session):
        return {
            "org_id": org_id,
            "plan": "demo",
            "year": year,
            "month": month,
            "active_users": 0,
            "plan_limit": 0,
            "members_beyond_included": 0,
            "overage_units": 0,
            "overage_usd": 0,
        }

    if _is_non_saas():
        plan = "self-hosted"
        plan_limit = 0
    else:
        from src.services.orgs.plan_history import resolve_plan_for_month

        org_config = await _get_org_config(org_id, db_session)
        current_plan = _get_org_plan(org_config) if org_config is not None else "free"
        # Bill a past month against the plan that applied during it, not the
        # plan the org happens to be on now. Falls back to the current plan when
        # no history covers the month.
        plan, plan_limit = await resolve_plan_for_month(
            org_id, year, month, current_plan, db_session
        )

    overage = await calculate_active_user_overage(
        org_id, year, month, plan_limit, db_session
    )
    return {
        "org_id": org_id,
        "plan": plan,
        "year": year,
        "month": month,
        "active_users": overage["active_users"],
        "plan_limit": plan_limit,
        # How many members sit beyond the included seats. Zero means the org is
        # inside its plan and activity is not billable at all — the surface that
        # renders this should stay quiet in that case.
        "members_beyond_included": overage["members_beyond_included"],
        "overage_units": overage["overage_units"],
        "overage_usd": overage["overage_usd"],
    }
