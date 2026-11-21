"""Telling an org's admins about their plan: the trial emails, and what a move
to Free changed (email + the dashboard notification center).

Every email goes through the lifecycle ledger (``nudge_send``) with a dedupe
key per org, admin and stage, written before the provider is called, so a
stage is sent once even when the job runs twice or on several pods.

Preferences: the trial sequence (welcome, tips, reminders) is optional mail
and respects the lifecycle opt-out. The notice that the org moved to Free
reports a change to the account, so it ignores the opt-out like other account
notices; an address the provider reported as bouncing or complaining is never
mailed either way.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.nudges import EmailPreference, NudgeSend, NudgeSendStatus
from src.db.org_plan_state import OrgDowngrade, OrgTrial
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.security.rbac.constants import ADMIN_ROLE_ID
from src.services.email.dates import human_date

logger = logging.getLogger(__name__)

PLAN_PAGE = "/dash/org/settings/plan"

# Trial stages in send order. Each is sent at most once per admin.
TRIAL_WELCOME = "trial_welcome"
TRIAL_TIPS = "trial_tips"
TRIAL_ENDS_3D = "trial_ends_3d"
TRIAL_ENDS_1D = "trial_ends_1d"
TRIAL_ENDED = "trial_ended"
PLAN_DOWNGRADED = "plan_downgraded"
TRIAL_STAGES = (TRIAL_WELCOME, TRIAL_TIPS, TRIAL_ENDS_3D, TRIAL_ENDS_1D)

# The welcome is only worth sending in the first days; mid-trial tips from
# day five, while the trial still has more than three days to run.
WELCOME_MAX_AGE = timedelta(days=3)
TIPS_AFTER = timedelta(days=5)


@dataclass
class Admin:
    user_id: int
    email: str
    user_uuid: str
    username: str


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def due_trial_stage(trial: OrgTrial, now: datetime) -> Optional[str]:
    """The one stage that is due for a running trial right now, or None.

    One stage per run, the most urgent first, and each stage only inside its
    window, so a scheduler that was down for days never sends a backlog
    (welcome, tips and a reminder in one morning)."""
    started, ends = _utc(trial.started_at), _utc(trial.ends_at)
    remaining = ends - now
    if remaining <= timedelta(0):
        return None
    if remaining <= timedelta(days=1):
        return TRIAL_ENDS_1D
    if remaining <= timedelta(days=3):
        return TRIAL_ENDS_3D
    age = now - started
    if age >= TIPS_AFTER:
        return TRIAL_TIPS
    if age <= WELCOME_MAX_AGE:
        return TRIAL_WELCOME
    return None


async def org_admins(db_session: AsyncSession, org_id: int) -> list[Admin]:
    """The org's admins with an email address. None for the shared demo org:
    every visitor is an admin there, so mailing its admins mails strangers."""
    from src.services.demo.guards import is_demo_org

    if await is_demo_org(org_id, db_session):
        return []
    rows = (
        await db_session.execute(
            select(User)
            .join(UserOrganization, UserOrganization.user_id == User.id)
            .where(UserOrganization.org_id == org_id, UserOrganization.role_id == ADMIN_ROLE_ID)
        )
    ).scalars().all()
    return [
        Admin(user_id=u.id, email=u.email, user_uuid=u.user_uuid, username=u.username or "")
        for u in rows
        if u.email
    ]


async def _blocked_user_ids(db_session: AsyncSession, user_ids: list[int], *, optional_mail: bool) -> set[int]:
    prefs = (
        await db_session.execute(select(EmailPreference).where(EmailPreference.user_id.in_(user_ids)))
    ).scalars().all()
    return {
        p.user_id
        for p in prefs
        if p.suppressed or (optional_mail and p.lifecycle_opt_out)
    }


async def _org_context(db_session: AsyncSession, org_id: int) -> tuple[Organization, str, str]:
    """The org, its email language and the base URL its links point at."""
    from src.services.nudges.links import org_base_url
    from src.services.orgs.orgs import get_org_default_language

    org = await db_session.get(Organization, org_id)
    config = (
        await db_session.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org_id))
    ).scalars().first()
    base = await org_base_url(org.slug, db_session, org_id)
    return org, get_org_default_language(config), base


async def _claim(db_session: AsyncSession, stage: str, key: str, org_id: int, admin: Admin, lang: str, now: datetime) -> Optional[NudgeSend]:
    row = NudgeSend(
        nudge_id=stage,
        dedupe_key=key,
        org_id=org_id,
        user_id=admin.user_id,
        status=NudgeSendStatus.CLAIMED,
        lang=lang,
        claimed_at=now,
        meta={"email": admin.email, "track": "plan"},
    )
    db_session.add(row)
    try:
        await db_session.commit()
    except IntegrityError:
        await db_session.rollback()
        return None
    return row


async def send_stage(
    db_session: AsyncSession,
    org_id: int,
    stage: str,
    *,
    dedupe_suffix: str = "",
    optional_mail: bool = True,
    cta_path: str = PLAN_PAGE,
    now: Optional[datetime] = None,
    **copy_vars,
) -> int:
    """Email one stage to every admin of the org who may receive it. Returns
    how many emails went out."""
    from src.services.email.utils import get_media_base_url
    from src.services.nudges.links import unsubscribe_url
    from src.services.users.emails import send_plan_email

    now = now or datetime.now(timezone.utc)
    admins = await org_admins(db_session, org_id)
    if not admins:
        return 0
    blocked = await _blocked_user_ids(db_session, [a.user_id for a in admins], optional_mail=optional_mail)
    org, lang, base = await _org_context(db_session, org_id)
    # Plain value: a dedupe collision below rolls back, expiring loaded rows.
    org_name = org.name
    api_base = get_media_base_url(None)
    sent = 0
    for admin in admins:
        if admin.user_id in blocked:
            continue
        key = f"{stage}:{org_id}:{admin.user_id}{dedupe_suffix}"
        row = await _claim(db_session, stage, key, org_id, admin, lang, now)
        if row is None:
            continue
        result = send_plan_email(
            stage,
            admin.email,
            org_name,
            f"{base}{cta_path}",
            lang=lang,
            unsubscribe_url=unsubscribe_url(api_base, admin.user_uuid) if optional_mail else "",
            **copy_vars,
        )
        if result is False:
            row.status = NudgeSendStatus.FAILED
            row.error = "provider rejected or unavailable"
        else:
            row.status = NudgeSendStatus.SENT
            row.sent_at = now
            if isinstance(result, dict) and result.get("id"):
                row.provider_id = str(result["id"])
            sent += 1
        db_session.add(row)
        await db_session.commit()
    return sent


def _plan_name(plan: Optional[str]) -> str:
    return " ".join(w.capitalize() for w in (plan or "free").split("-"))


async def send_due_trial_emails(db_session: AsyncSession, now: Optional[datetime] = None) -> int:
    """Send whatever trial stage is due for every running trial."""
    from src.db.org_plan_state import TrialStatus
    from src.services.plans.trial import days_left

    now = now or datetime.now(timezone.utc)
    # Detached copies: each send commits (and a failure rolls back), which
    # would expire rows still attached to the session mid-loop.
    trials = [
        OrgTrial(org_id=t.org_id, plan=t.plan, status=t.status, started_at=t.started_at, ends_at=t.ends_at)
        for t in (
            await db_session.execute(select(OrgTrial).where(OrgTrial.status == TrialStatus.ACTIVE))
        ).scalars().all()
    ]
    sent = 0
    for trial in trials:
        stage = due_trial_stage(trial, now)
        if stage is None:
            continue
        cta = {TRIAL_WELCOME: "/dash/courses", TRIAL_TIPS: "/dash/courses"}.get(stage, PLAN_PAGE)
        try:
            days = days_left(trial, now)
            sent += await send_stage(
                db_session,
                trial.org_id,
                stage,
                cta_path=cta,
                now=now,
                plan_name=_plan_name(trial.plan),
                days=days,
                end_date=human_date(_utc(trial.ends_at)),
            )
            if stage == TRIAL_ENDS_3D:
                await notify_trial_ending(db_session, trial, days)
        except Exception:
            logger.exception("Trial email %s for org %s failed", stage, trial.org_id)
            await db_session.rollback()
    return sent


async def notify_downgraded(
    db_session: AsyncSession,
    org_id: int,
    from_plan: str,
    record: Optional[OrgDowngrade],
    reason: str,
) -> None:
    """Email + notification center: the org is on Free now, here is what
    changed and what choosing a plan brings back."""
    from src.services.notifications.emit import emit_admin

    changes = (record.changes if record else None) or {}
    record_id = record.id if record else "none"
    private = len(changes.get("courses", []))
    kept = (changes.get("kept_course") or {}).get("name") or ""
    stage = TRIAL_ENDED if reason == "trial_expired" else PLAN_DOWNGRADED
    try:
        await send_stage(
            db_session,
            org_id,
            stage,
            dedupe_suffix=f":{record_id}",
            optional_mail=False,
            plan_name=_plan_name(from_plan),
            private_count=private,
            kept_course=kept,
        )
    except Exception:
        logger.exception("Downgrade email for org %s failed", org_id)
        await db_session.rollback()

    name = _plan_name(from_plan)
    await emit_admin(
        db_session,
        "plan_downgraded",
        org_id=org_id,
        title=(
            f"Your {name} trial ended. You're on Free now"
            if stage == TRIAL_ENDED
            else "Your organization is on the Free plan now"
        ),
        body=(
            f"Nothing was deleted. {private} course(s) became private and {name} features are paused. "
            "Choose a plan to restore everything."
            if private
            else f"Nothing was deleted. {name} features are paused until you choose a plan."
        ),
        params={"plan": name, "count": private},
        path=PLAN_PAGE,
        data={"from_plan": from_plan, "courses_made_private": private, "reason": reason},
        dedupe_key=f"plan_downgraded:{org_id}:{record_id}",
    )


async def notify_restored(db_session: AsyncSession, org_id: int, plan: str, restored: int) -> None:
    """Notification center only: the upgrade brought the courses back."""
    from src.services.notifications.emit import emit_admin

    await emit_admin(
        db_session,
        "plan_restored",
        org_id=org_id,
        title=f"Welcome back to {_plan_name(plan)}",
        body=(
            f"{restored} course(s) are public again, exactly as they were."
            if restored
            else "Everything your plan includes is available again."
        ),
        params={"plan": _plan_name(plan), "count": restored},
        path=PLAN_PAGE,
        data={"plan": plan, "courses_restored": restored},
    )


async def notify_trial_ending(db_session: AsyncSession, trial: OrgTrial, days: int) -> None:
    """Notification center, alongside the 3-days-left email."""
    from src.services.notifications.emit import emit_admin

    name = _plan_name(trial.plan)
    await emit_admin(
        db_session,
        "trial_ending",
        org_id=trial.org_id,
        title=f"Your {name} trial ends in {days} day(s)",
        body="Choose a plan to keep everything as it is. Nothing is deleted when the trial ends.",
        params={"plan": name, "days": days},
        path=PLAN_PAGE,
        data={"plan": trial.plan, "days": days},
        dedupe_key=f"trial_ending:{trial.org_id}",
    )
