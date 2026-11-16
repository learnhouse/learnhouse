"""The signup-to-paid funnel, for the platform console.

A cohort is every account created in the window. Each step counts the
accounts (or the orgs they created) that got that far, from live rows, so the
numbers are right even for orgs whose admins never reopened the dashboard:

signed up → verified email → created an org → picked a goal → made a course
→ published a course → has a learner → on a paid plan.

Side counts come from the milestones the onboarding flow stamps (starter
applied, plan picker seen, continued free, checkout started), with a split
by goal. Demo visitors and the shared demo org are left out.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.courses import Course
from src.db.org_onboarding import OrgOnboarding
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.security.features_utils.resolve import _get_plan_from_config
from src.services.demo.flags import is_demo_email
from src.services.onboarding.goals import GOAL_IDS

ADMIN_ROLE_ID = 1
MAX_DAYS = 365
SIDE_EVENTS = ("starter_applied", "plan_picker_viewed", "continued_free", "checkout_started", "checklist_dismissed")


def _since(days: int) -> str:
    # creation_date is stored as str(datetime.now()) ("YYYY-MM-DD HH:MM:SS.ffffff"),
    # so a date prefix compares correctly as text.
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")


async def compute_funnel(db_session: AsyncSession, days: int = 30) -> dict:
    days = max(1, min(int(days or 30), MAX_DAYS))
    since = _since(days)

    users = (await db_session.execute(
        select(User.id, User.email, User.email_verified).where(User.creation_date >= since)
    )).all()
    users = [u for u in users if not is_demo_email(u.email)]
    user_ids = [u.id for u in users]
    verified = sum(1 for u in users if u.email_verified)

    # Orgs those accounts created (admin of a non-demo org created in the window).
    org_rows = (await db_session.execute(
        select(Organization.id, UserOrganization.user_id)
        .join(UserOrganization, UserOrganization.org_id == Organization.id)
        .where(
            UserOrganization.user_id.in_(user_ids),
            UserOrganization.role_id == ADMIN_ROLE_ID,
            Organization.is_demo.is_(False),
            Organization.creation_date >= since,
        )
    )).all() if user_ids else []
    org_ids = sorted({r[0] for r in org_rows})
    creators = len({r[1] for r in org_rows})

    async def orgs_with(stmt) -> set[int]:
        return set((await db_session.execute(stmt)).scalars().all()) if org_ids else set()

    with_course = await orgs_with(select(Course.org_id).where(Course.org_id.in_(org_ids)).distinct())
    published = await orgs_with(
        select(Course.org_id).where(Course.org_id.in_(org_ids), Course.published.is_(True)).distinct()
    )
    with_learner = await orgs_with(
        select(UserOrganization.org_id)
        .where(UserOrganization.org_id.in_(org_ids))
        .group_by(UserOrganization.org_id)
        .having(func.count() > 1)
    )
    configs = (await db_session.execute(
        select(OrganizationConfig.org_id, OrganizationConfig.config).where(OrganizationConfig.org_id.in_(org_ids))
    )).all() if org_ids else []
    paid = {oid for oid, cfg in configs if _get_plan_from_config(cfg or {}) not in ("free", "oss")}

    onboarding = (await db_session.execute(
        select(OrgOnboarding).where(OrgOnboarding.org_id.in_(org_ids))
    )).scalars().all() if org_ids else []
    with_goal = [r for r in onboarding if r.goal]
    by_goal = {g: 0 for g in GOAL_IDS}
    for r in with_goal:
        if r.goal in by_goal:
            by_goal[r.goal] += 1
    side = {e: sum(1 for r in onboarding if e in (r.milestones or {})) for e in SIDE_EVENTS}

    steps = [
        ("signed_up", len(users)),
        ("verified", verified),
        ("created_org", creators),
        ("picked_goal", len(with_goal)),
        ("first_course", len(with_course)),
        ("published", len(published)),
        ("first_learner", len(with_learner)),
        ("paid", len(paid)),
    ]
    top = steps[0][1] or 0
    return {
        "days": days,
        "since": since,
        "orgs": len(org_ids),
        "steps": [
            {"key": key, "count": count, "rate": round(count / top, 4) if top else 0.0}
            for key, count in steps
        ],
        "by_goal": by_goal,
        "events": side,
    }
