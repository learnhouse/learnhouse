"""The setup checklist of an organization, kept on the server.

Completion comes from the org's own data (a course exists, a lesson exists,
a course is published, a logo is set, someone else joined or was invited...),
never from "the page was opened". What only the admin can decide (put the
checklist away, skip a step, which finished steps were celebrated) is stored
in ``org_onboarding``, so it follows them across browsers and devices.

Every time a step is first seen done, its milestone is stamped: the funnel the
platform reads (services/onboarding/funnel.py) is built on those stamps plus
live counts.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core import deployment_mode
from src.db.communities.communities import Community
from src.db.courses.activities import Activity
from src.db.courses.courses import Course
from src.db.landing_pages import LandingPage
from src.db.org_onboarding import OrgOnboarding
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.usergroups import UserGroup
from src.db.users import User
from src.security.features_utils.resolve import _get_plan_from_config, resolve_feature
from src.services.onboarding import goals as goal_defs
from src.services.security.account_age import FREE_TIER_MIN_AGE_DAYS, parse_creation_date

logger = logging.getLogger(__name__)

# Orgs older than this when their row is first created were set up before the
# checklist moved to the server: don't greet their admins with the welcome
# again.
EXISTING_ORG_DAYS = 14

# Events the web app may record (first occurrence only). Click steps from
# goals.STEPS are accepted too: recording one completes the step.
CLIENT_EVENTS = frozenset({
    "welcome_completed",
    "starter_skipped",
    "plan_picker_viewed",
    "continued_free",
    "checkout_started",
    "invite_link_copied",
    "learners_imported",
    "first_publish_celebrated",
    "checklist_dismissed",
})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def stamp(row: OrgOnboarding, key: str, when: Optional[datetime] = None) -> bool:
    """Record the first time ``key`` happened. Returns True when it is new."""
    if key in (row.milestones or {}):
        return False
    row.milestones = {**(row.milestones or {}), key: _iso(when or _now())}
    return True


def _set_state(row: OrgOnboarding, **changes) -> None:
    # Reassigned, not mutated in place: a plain JSON column only notices a new value.
    row.state = {**(row.state or {}), **changes}
    row.updated_at = _now()


async def get_org(db_session: AsyncSession, org_id: int) -> Organization:
    org = (await db_session.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


async def get_or_create(db_session: AsyncSession, org: Organization) -> OrgOnboarding:
    row = (await db_session.execute(select(OrgOnboarding).where(OrgOnboarding.org_id == org.id))).scalars().first()
    if row is not None:
        return row
    created = parse_creation_date(org.creation_date)
    established = created is not None and _now() - created > timedelta(days=EXISTING_ORG_DAYS)
    row = OrgOnboarding(org_id=org.id, state={"welcome_seen": established}, milestones={})
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    return row


async def _config(db_session: AsyncSession, org_id: int) -> dict:
    row = (await db_session.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org_id))).scalars().first()
    return (row.config if row else None) or {}


async def _count(db_session: AsyncSession, model, *where) -> int:
    return int((await db_session.execute(select(func.count()).select_from(model).where(*where))).scalar() or 0)


def _has_pending_invite(org: Organization) -> bool:
    from src.core.redis import get_redis_client

    r = get_redis_client()
    if r is None:
        return False
    try:
        for _ in r.scan_iter(match=f"invited_user:*:org:{org.org_uuid}", count=200):
            return True
    except Exception:
        logger.warning("Could not read pending invites for org %s", org.id, exc_info=True)
    return False


async def data_signals(db_session: AsyncSession, org: Organization) -> set[str]:
    """The data-backed steps this org has done."""
    done: set[str] = set()
    if await _count(db_session, Course, Course.org_id == org.id):
        done.add("create_course")
    if await _count(db_session, Activity, Activity.org_id == org.id):
        done.add("add_content")
    if await _count(db_session, Course, Course.org_id == org.id, Course.published.is_(True)):
        done.add("publish_course")
    if org.logo_image:
        done.add("brand_school")
    if await _count(db_session, UserOrganization, UserOrganization.org_id == org.id) > 1 or _has_pending_invite(org):
        done.add("invite_learners")
    if await _count(db_session, Community, Community.org_id == org.id):
        done.add("build_community")
    if await _count(db_session, UserGroup, UserGroup.org_id == org.id):
        done.add("create_group")
    # The homepage is published (the template starter does this, or the
    # website builder). Clicking the step still completes it for older orgs.
    if await _count(db_session, LandingPage, LandingPage.org_id == org.id, LandingPage.slug == "", LandingPage.published_version > 0):
        done.add("share_grow")
    return done


async def invite_gate(db_session: AsyncSession, org: Organization, user_id: Optional[int]) -> dict:
    """Whether invitations are held back for a brand-new free org, and until when.

    Mirrors services/security/account_age: in SaaS, a free org and the account
    sending invites must both be FREE_TIER_MIN_AGE_DAYS old. The join link of
    an open org still works meanwhile, so the checklist says so instead of
    leading to a refused request.
    """
    from src.services.security.account_age import is_free_tier_age_gated

    if user_id is None:
        return {"gated": False, "unlocks_at": None}
    too_new = await is_free_tier_age_gated(org.id, user_id, db_session)
    if not too_new:
        return {"gated": False, "unlocks_at": None}
    user = (await db_session.execute(select(User).where(User.id == user_id))).scalars().first()
    dates = [parse_creation_date(org.creation_date)]
    if user is not None:
        dates.append(parse_creation_date(user.creation_date))
    known = [d for d in dates if d is not None]
    unlocks = max(known) + timedelta(days=FREE_TIER_MIN_AGE_DAYS) if known else None
    return {"gated": True, "unlocks_at": _iso(unlocks) if unlocks else None}


def visible_step_ids(goal: Optional[str], config: dict, org_id: int) -> list[str]:
    """The goal's steps the org's plan includes. A step whose feature isn't in
    the plan is left out: onboarding teaches the product, it doesn't sell it."""
    out = []
    for step_id in goal_defs.steps_for(goal):
        feature = goal_defs.STEPS[step_id]["feature"]
        if feature and not resolve_feature(feature, config, org_id)["available"]:
            continue
        out.append(step_id)
    return out


def _step_view(step_id: str, done: set[str], skipped: Iterable[str]) -> dict:
    spec = goal_defs.STEPS[step_id]
    return {
        "id": step_id,
        "kind": spec["kind"],
        "minutes": spec["minutes"],
        "done": step_id in done,
        "skipped": step_id in skipped and step_id not in done,
    }


async def build_state(db_session: AsyncSession, org: Organization, user_id: Optional[int]) -> dict:
    """The checklist as the dashboard shows it. Stamps newly done steps."""
    row = await get_or_create(db_session, org)
    state = dict(row.state or {})
    config = await _config(db_session, org.id)
    mode = deployment_mode.get_deployment_mode()
    plan = _get_plan_from_config(config) if mode == "saas" else None

    done = await data_signals(db_session, org) | set(state.get("clicked") or [])
    skipped = set(state.get("skipped") or [])
    steps = [_step_view(s, done, skipped) for s in visible_step_ids(row.goal, config, org.id)]

    changed = False
    for s in steps:
        if s["done"]:
            changed |= stamp(row, f"step:{s['id']}")
    finished = [s["id"] for s in steps if s["done"]]
    if not state.get("seeded"):
        # Whatever the org already had when the checklist first looked is
        # done silently; only what the admin does from now on is celebrated.
        _set_state(row, seeded=True, celebrated=sorted(set(state.get("celebrated") or []) | set(finished)))
        state = dict(row.state)
        changed = True
    if changed:
        db_session.add(row)
        await db_session.commit()
        await db_session.refresh(row)

    celebrated = set(state.get("celebrated") or [])
    open_steps = [s for s in steps if not s["done"] and not s["skipped"]]
    next_step = open_steps[0]["id"] if open_steps else None
    done_count = sum(1 for s in steps if s["done"] or s["skipped"])
    return {
        "org_id": org.id,
        "goal": row.goal,
        "goals": list(goal_defs.GOAL_IDS),
        "mode": mode,
        "plan": plan,
        "steps": steps,
        "done_count": done_count,
        "total": len(steps),
        "all_done": done_count == len(steps),
        "next_step": next_step,
        "celebrate": [s["id"] for s in steps if s["done"] and s["id"] not in celebrated],
        "dismissed": bool(state.get("dismissed")),
        "welcome_seen": bool(state.get("welcome_seen")),
        "starter_applied": "starter_applied" in (row.milestones or {}),
        "recommended_plan": goal_defs.recommended_plan(row.goal) if mode == "saas" else None,
        "invites": await invite_gate(db_session, org, user_id),
        "milestones": dict(row.milestones or {}),
    }


async def update_state(
    db_session: AsyncSession,
    org: Organization,
    *,
    goal: Optional[str] = None,
    clear_goal: bool = False,
    dismissed: Optional[bool] = None,
    welcome_seen: Optional[bool] = None,
    skip: Optional[str] = None,
    unskip: Optional[str] = None,
    celebrated: Optional[list[str]] = None,
) -> None:
    row = await get_or_create(db_session, org)
    state = dict(row.state or {})
    for step in (skip, unskip, *(celebrated or [])):
        if step is not None and step not in goal_defs.STEPS:
            raise HTTPException(status_code=400, detail=f"Unknown setup step '{step}'")
    if goal is not None:
        if not goal_defs.is_goal(goal):
            raise HTTPException(status_code=400, detail=f"Unknown goal '{goal}'")
        row.goal = goal
        stamp(row, "goal_selected")
    elif clear_goal:
        row.goal = None
    changes: dict = {}
    if dismissed is not None:
        changes["dismissed"] = dismissed
        if dismissed:
            stamp(row, "checklist_dismissed")
    if welcome_seen is not None:
        changes["welcome_seen"] = welcome_seen
    if skip:
        changes["skipped"] = sorted(set(state.get("skipped") or []) | {skip})
    if unskip:
        changes["skipped"] = sorted(set(changes.get("skipped", state.get("skipped") or [])) - {unskip})
    if celebrated:
        changes["celebrated"] = sorted(set(state.get("celebrated") or []) | set(celebrated))
    _set_state(row, **changes)
    db_session.add(row)
    await db_session.commit()


async def record_event(db_session: AsyncSession, org: Organization, event: str) -> bool:
    """Stamp a client event (first time only). Click steps also complete."""
    is_click_step = goal_defs.STEPS.get(event, {}).get("kind") == "click"
    if event not in CLIENT_EVENTS and not is_click_step:
        raise HTTPException(status_code=400, detail=f"Unknown onboarding event '{event}'")
    row = await get_or_create(db_session, org)
    new = stamp(row, event)
    if is_click_step:
        clicked = set((row.state or {}).get("clicked") or [])
        if event not in clicked:
            _set_state(row, clicked=sorted(clicked | {event}))
    if new or is_click_step:
        db_session.add(row)
        await db_session.commit()
    return new
