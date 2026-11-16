"""The free trial every new SaaS organization starts with.

While a trial runs, the org's config carries the trial plan, so every feature
gate, limit and UI check works unchanged; the ``org_trial`` row is what knows
it is a trial. No card is asked for. At the end, an org that has not chosen a
plan moves to Free (see ``expire_due_trials``); buying any plan during the
trial converts it.

Self-hosted installs (OSS and EE) have no plans and therefore no trial.
"""

import logging
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import update
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core import deployment_mode
from src.db.org_plan_state import OrgTrial, TrialStatus

logger = logging.getLogger(__name__)

# The plan a trial unlocks: the one that shows the full product (certificates,
# paths, live sessions, custom domains, analytics) without Enterprise-only
# contract features. Change it here and nowhere else.
TRIAL_PLAN = "pro"
TRIAL_DAYS = 14


def _utc(value: datetime) -> datetime:
    """SQLite hands timestamps back naive; treat those as UTC."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def trials_enabled() -> bool:
    """Trials exist on SaaS only. ``LEARNHOUSE_TRIALS_DISABLED`` turns them off
    (new orgs then start on Free, as before)."""
    if deployment_mode.get_deployment_mode() != "saas":
        return False
    return os.environ.get("LEARNHOUSE_TRIALS_DISABLED", "").strip().lower() not in ("1", "true", "yes", "on")


def plan_for_new_org() -> Optional[str]:
    """The plan a newly created org starts on when it gets a trial, else None."""
    return TRIAL_PLAN if trials_enabled() else None


async def begin_trial(
    db_session: AsyncSession,
    org_id: int,
    user_id: Optional[int] = None,
    now: Optional[datetime] = None,
) -> OrgTrial:
    """Record the trial of an org whose config was created on the trial plan.
    One per organization: a second call returns the existing row."""
    existing = await get_trial(db_session, org_id)
    if existing is not None:
        return existing
    now = now or datetime.now(timezone.utc)
    trial = OrgTrial(
        org_id=org_id,
        plan=TRIAL_PLAN,
        status=TrialStatus.ACTIVE,
        started_at=now,
        ends_at=now + timedelta(days=TRIAL_DAYS),
        created_by_user_id=user_id,
    )
    db_session.add(trial)
    await db_session.commit()
    await db_session.refresh(trial)
    return trial


async def get_trial(db_session: AsyncSession, org_id: int) -> Optional[OrgTrial]:
    return (
        await db_session.execute(select(OrgTrial).where(OrgTrial.org_id == org_id))
    ).scalars().first()


async def get_active_trial(db_session: AsyncSession, org_id: int) -> Optional[OrgTrial]:
    trial = await get_trial(db_session, org_id)
    return trial if trial is not None and trial.status == TrialStatus.ACTIVE else None


async def active_trial_org_ids(db_session: AsyncSession, org_ids: list[int]) -> set[int]:
    """Which of these orgs are mid-trial (their plan is not paid for)."""
    if not org_ids:
        return set()
    rows = (
        await db_session.execute(
            select(OrgTrial.org_id).where(
                OrgTrial.org_id.in_(org_ids), OrgTrial.status == TrialStatus.ACTIVE
            )
        )
    ).scalars().all()
    return set(rows)


def days_left(trial: OrgTrial, now: Optional[datetime] = None) -> int:
    """Whole days until the trial ends, rounded up (a trial ending in 3 hours
    has 1 day left), never negative."""
    now = now or datetime.now(timezone.utc)
    remaining = (_utc(trial.ends_at) - now).total_seconds()
    return max(0, math.ceil(remaining / 86400))


def trial_state(trial: Optional[OrgTrial], now: Optional[datetime] = None) -> Optional[dict]:
    """The trial as the API returns it, or None when the org never had one."""
    if trial is None:
        return None
    now = now or datetime.now(timezone.utc)
    active = trial.status == TrialStatus.ACTIVE
    return {
        "plan": trial.plan,
        "status": trial.status,
        "active": active,
        "started_at": _utc(trial.started_at).isoformat(),
        "ends_at": _utc(trial.ends_at).isoformat(),
        "days_left": days_left(trial, now) if active else 0,
        "length_days": TRIAL_DAYS,
        "ended_at": _utc(trial.ended_at).isoformat() if trial.ended_at else None,
        "converted_plan": trial.converted_plan,
    }


async def _settle(
    db_session: AsyncSession, org_id: int, status: str, plan: Optional[str], now: datetime
) -> bool:
    """Move an active trial to a final status. Atomic (``WHERE status =
    'active'``), so two concurrent callers can't both settle it. Commits."""
    result = await db_session.execute(
        update(OrgTrial)
        .where(OrgTrial.org_id == org_id, OrgTrial.status == TrialStatus.ACTIVE)
        .values(status=status, ended_at=now, converted_plan=plan)
    )
    await db_session.commit()
    return (result.rowcount or 0) > 0


async def mark_converted(
    db_session: AsyncSession, org_id: int, plan: str, now: Optional[datetime] = None
) -> bool:
    """A plan was bought for an org mid-trial. Called by the billing plan write
    even when the plan string does not change (buying the trial plan itself),
    so a paying org is never moved to Free when its trial date passes."""
    if not plan or plan == "free":
        return False
    return await _settle(db_session, org_id, TrialStatus.CONVERTED, plan, now or datetime.now(timezone.utc))


async def settle_on_plan_change(
    db_session: AsyncSession,
    org_id: int,
    new_plan: str,
    reason: str = "other",
    now: Optional[datetime] = None,
) -> Optional[str]:
    """End a running trial because the plan changed. Returns the status it
    ended with, or None when no trial was running."""
    now = now or datetime.now(timezone.utc)
    if new_plan == "free" or reason == "poc":
        # A POC is not a purchase: the trial just ends, the POC takes over.
        status = TrialStatus.EXPIRED if reason == "trial_expired" else TrialStatus.ENDED
        settled = await _settle(db_session, org_id, status, None, now)
    else:
        status = TrialStatus.CONVERTED
        settled = await _settle(db_session, org_id, status, new_plan, now)
    return status if settled else None


async def expire_due_trials(
    db_session: AsyncSession, now: Optional[datetime] = None, org_id: Optional[int] = None
) -> list[int]:
    """Move every org whose trial has run out to the Free plan. Idempotent:
    the plan write is a no-op once the org is on Free, and the trial is only
    marked expired after the plan moved, so a failure is retried next run
    rather than leaving the org on the trial plan with a closed trial.

    An org whose plan no longer is the trial plan (changed through a path that
    skipped the trial bookkeeping) is settled without touching its plan.
    Returns the ids of the orgs moved to Free.
    """
    from src.services.plans.transitions import get_org_plan_from_db, set_org_plan

    now = now or datetime.now(timezone.utc)
    query = select(OrgTrial).where(OrgTrial.status == TrialStatus.ACTIVE, OrgTrial.ends_at <= now)
    if org_id is not None:
        query = query.where(OrgTrial.org_id == org_id)
    # Plain values: a rollback below expires every loaded row.
    due = [(t.org_id, t.plan) for t in (await db_session.execute(query)).scalars().all()]

    moved: list[int] = []
    for trial_org, trial_plan in due:
        current = await get_org_plan_from_db(db_session, trial_org)
        if current != trial_plan:
            status = TrialStatus.ENDED if current in (None, "free") else TrialStatus.CONVERTED
            plan = None if status == TrialStatus.ENDED else current
            await _settle(db_session, trial_org, status, plan, now)
            continue
        try:
            _previous, changed = await set_org_plan(db_session, trial_org, "free", reason="trial_expired")
        except Exception:
            logger.exception("Moving org %s to Free after its trial failed; retrying next run", trial_org)
            await db_session.rollback()
            continue
        # Usually already settled by the plan change itself; this covers the
        # race where another run moved the plan first.
        await _settle(db_session, trial_org, TrialStatus.EXPIRED, None, now)
        if changed:
            moved.append(trial_org)
    return moved
