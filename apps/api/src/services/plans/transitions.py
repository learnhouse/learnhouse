"""One place that reacts to an organization changing plan.

Plan writes come from several paths (the billing webhook through the internal
plan endpoint, the platform console, POCs, trial expiry). Each one calls
``on_plan_changed`` after its write, which:

- settles a running trial (converted by any paid plan, expired/ended on Free);
- on a paid-to-Free move, applies the Free plan's content rules and tells the
  admins what changed and how to get it back (see downgrade.py);
- on a Free-to-paid move, restores what the last downgrade changed.

``set_org_plan`` is the write itself, for callers that don't already have one.
Both are SaaS-only no-ops elsewhere, and ``on_plan_changed`` never raises: the
plan write already happened, and bookkeeping must not turn it into an error.
"""

import copy
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core import deployment_mode
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.security.features_utils.plans import PLAN_FEATURE_CONFIGS
from src.security.features_utils.usage import _plan_from_config_dict

logger = logging.getLogger(__name__)


def is_paid(plan: Optional[str]) -> bool:
    return bool(plan) and plan != "free"


async def get_org_plan_from_db(db_session: AsyncSession, org_id: int) -> Optional[str]:
    row = (
        await db_session.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org_id))
    ).scalars().first()
    return _plan_from_config_dict(row.config or {}) if row else None


def write_plan(config: dict, plan: str) -> dict:
    """A copy of ``config`` on ``plan`` (v1 and v2 layouts), with the flags a
    plan derives: the watermark is forced on for Free, and v1 configs carry
    the custom domain entitlement."""
    config = copy.deepcopy(config or {})
    plan_cfg = PLAN_FEATURE_CONFIGS[plan]
    if str(config.get("config_version", "1.0")).startswith("2"):
        config["plan"] = plan
        if plan == "free":
            config.setdefault("customization", {}).setdefault("general", {})["watermark"] = True
    else:
        config.setdefault("cloud", {})
        config["cloud"]["plan"] = plan
        config["cloud"]["custom_domain"] = plan_cfg["cloud"]["custom_domain"]
        config.setdefault("general", {})
        config["general"]["watermark"] = plan_cfg["general"]["watermark"]
    return config


async def set_org_plan(
    db_session: AsyncSession, org_id: int, plan: str, *, reason: str = "other"
) -> tuple[Optional[str], bool]:
    """Write ``plan`` into the org's config and run ``on_plan_changed``.
    Returns ``(previous_plan, changed)``; writing the current plan is a no-op."""
    from src.services.orgs.cache import invalidate_org_cache, invalidate_org_config_cache
    from src.services.orgs.plan_history import record_plan_change
    from src.services.orgs.usage import invalidate_usage_cache

    if plan not in PLAN_FEATURE_CONFIGS:
        raise ValueError(f"Unknown plan: {plan}")
    row = (
        await db_session.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org_id))
    ).scalars().first()
    if row is None:
        raise LookupError(f"Organization {org_id} has no config")
    previous = _plan_from_config_dict(row.config or {})
    if previous == plan:
        return previous, False

    await record_plan_change(org_id, previous, plan, db_session)
    row.config = write_plan(row.config or {}, plan)
    row.update_date = str(datetime.now())
    flag_modified(row, "config")
    db_session.add(row)
    await db_session.commit()

    org = await db_session.get(Organization, org_id)
    invalidate_org_config_cache(org_id)
    if org is not None:
        invalidate_org_cache(org.slug)
    invalidate_usage_cache(org_id)

    await on_plan_changed(db_session, org_id, previous, plan, reason=reason)
    return previous, True


async def on_plan_changed(
    db_session: AsyncSession,
    org_id: int,
    old_plan: Optional[str],
    new_plan: Optional[str],
    *,
    reason: str = "other",
) -> None:
    """React to a plan change that was just written. Never raises."""
    if deployment_mode.get_deployment_mode() != "saas" or not new_plan or old_plan == new_plan:
        return
    from src.core.ee_hooks import audit_event
    from src.services.plans import downgrade, notify, trial

    try:
        # One audit row per plan move, whatever the path: the Backoffice turns
        # it into its upgrade/downgrade/cancel alerts (a no-op without EE).
        in_trial = await trial.get_active_trial(db_session, org_id) is not None
        audit_event(
            None, action="billing.plan.transition", org_id=org_id,
            target_type="organization", target_id=org_id,
            changes={"plan": {"from": old_plan, "to": new_plan}},
            details={"reason": reason, "trial": in_trial},
        )
    except Exception:
        logger.exception("Recording the plan move of org %s failed", org_id)
        await db_session.rollback()

    try:
        await trial.settle_on_plan_change(db_session, org_id, new_plan, reason)
    except Exception:
        logger.exception("Settling the trial of org %s failed", org_id)
        await db_session.rollback()

    try:
        if is_paid(old_plan) and new_plan == "free":
            record = await downgrade.enforce_downgrade(
                db_session, org_id, old_plan, new_plan, reason=reason
            )
            await notify.notify_downgraded(db_session, org_id, old_plan, record, reason)
        elif not is_paid(old_plan) and is_paid(new_plan):
            records, restored = await downgrade.restore_after_upgrade(db_session, org_id, new_plan)
            if records:
                await notify.notify_restored(db_session, org_id, new_plan, restored)
    except Exception:
        logger.exception("Applying the plan change %s -> %s for org %s failed", old_plan, new_plan, org_id)
        await db_session.rollback()
