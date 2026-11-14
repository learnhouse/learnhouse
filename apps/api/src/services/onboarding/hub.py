"""The organizations hub: what each of the user's orgs is to them.

The hub already lists the orgs (GET /orgs/user/...). This adds what that list
can't say: the user's role in each, the plan and its state (free, paid,
trial, proof of concept, suspended, with the end date when there is one), how
far setup has gone in the orgs they run, and the invitations waiting for them.
"""

from datetime import timedelta
from typing import Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core import deployment_mode
from src.db.org_onboarding import OrgOnboarding
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.security.features_utils.resolve import _get_plan_from_config
from src.services.onboarding.invites import list_pending_invites
from src.services.onboarding.state import _now, data_signals, visible_step_ids
from src.services.orgs.plan_overview import _ee_extras, _status
from src.services.security.account_age import parse_creation_date

ROLES = {1: "admin", 2: "maintainer", 3: "instructor", 4: "member"}
MAX_ORGS = 100
# Setup progress is shown for orgs the user runs that are this young (older
# orgs are past onboarding; skipping them keeps the hub cheap).
SETUP_WINDOW_DAYS = 60


async def _setup(db_session: AsyncSession, org: Organization, row: Optional[OrgOnboarding], config: Optional[dict] = None) -> Optional[dict]:
    created = parse_creation_date(org.creation_date)
    if org.is_demo or created is None or _now() - created > timedelta(days=SETUP_WINDOW_DAYS):
        return None
    state = (row.state if row else None) or {}
    if state.get("dismissed"):
        return None
    goal = row.goal if row else None
    steps = visible_step_ids(goal, config or {}, org.id)
    done = (await data_signals(db_session, org)) | set(state.get("clicked") or []) | set(state.get("skipped") or [])
    finished = sum(1 for s in steps if s in done)
    if finished == len(steps):
        return None
    return {"done": finished, "total": len(steps), "goal": goal}


async def hub_summary(db_session: AsyncSession, user_id: int) -> dict:
    rows = (await db_session.execute(
        select(Organization, UserOrganization.role_id, OrganizationConfig)
        .join(UserOrganization, UserOrganization.org_id == Organization.id)
        .outerjoin(OrganizationConfig, OrganizationConfig.org_id == Organization.id)
        .where(UserOrganization.user_id == user_id)
        .order_by(Organization.id)
        .limit(MAX_ORGS)
    )).all()
    org_ids = [org.id for org, _, _ in rows]
    onboarding = {
        r.org_id: r
        for r in (await db_session.execute(select(OrgOnboarding).where(OrgOnboarding.org_id.in_(org_ids)))).scalars().all()
    } if org_ids else {}
    mode = deployment_mode.get_deployment_mode()

    orgs = []
    for org, role_id, cfg in rows:
        role = ROLES.get(role_id, "custom")
        manages = role in ("admin", "maintainer")
        config = (cfg.config if cfg else None) or {}
        plan = _get_plan_from_config(config) if mode == "saas" else None
        entry = {
            "org_id": org.id,
            "role": role,
            "plan": plan,
            "status": None,
            "poc_ends_at": None,
            "setup": None,
        }
        if manages and not org.is_demo:
            if mode == "saas":
                extras = await _ee_extras(org.id, db_session, mode, False)
                entry["status"] = _status(mode, plan or "free", extras["lifecycle"])
                poc = extras.get("poc")
                if poc and poc.get("state") == "active":
                    entry["poc_ends_at"] = poc.get("ends_at")
            entry["setup"] = await _setup(db_session, org, onboarding.get(org.id), config)
        orgs.append(entry)
    # Invitations are only shown to the verified owner of the address; the
    # flag lets the hub ask an unverified user to verify first.
    verified = bool((await db_session.execute(select(User.email_verified).where(User.id == user_id))).scalar())
    return {
        "mode": mode,
        "orgs": orgs,
        "email_verified": verified,
        "invites": await list_pending_invites(db_session, user_id) if verified else [],
    }
