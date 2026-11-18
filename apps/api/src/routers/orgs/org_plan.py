import os
from typing import Optional
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.security.rbac.constants import ADMIN_ROLE_ID
from src.services.marketing.loops import record_org_admin_in_loops
from src.services.orgs.cache import invalidate_org_cache, invalidate_org_config_cache
from src.services.orgs.orgs import update_org_with_config_no_auth
from src.services.orgs.usage import invalidate_usage_cache


# ============================================================================
# Internal router (cloud internal-key auth)
# ============================================================================

# Valid SaaS plan names (mirrors src/security/features_utils/plans.py)
VALID_PLANS = {
    "free",
    "personal",
    "personal-family",
    "standard",
    "pro",
    "business",
    "enterprise",
}


async def verify_cloud_internal_key(x_internal_key: str = Header(...)):
    """Mirror of the custom_domains internal-key check (X-Internal-Key / CLOUD_INTERNAL_KEY)."""
    expected_key = os.getenv("CLOUD_INTERNAL_KEY", "")
    if (
        not expected_key
        or not x_internal_key
        or not secrets.compare_digest(x_internal_key.encode(), expected_key.encode())
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid internal API key",
        )


internal_router = APIRouter(dependencies=[Depends(verify_cloud_internal_key)])


class UpdateOrgPlanRequest(BaseModel):
    org_id: int
    plan: str


class UpdateOrgPlanResponse(BaseModel):
    detail: str
    org_id: int
    plan: str
    # For billing's conversion analytics (no personal data): whether this
    # purchase ended a running trial, and how old the org is.
    trial_converted: bool = False
    org_age_days: Optional[int] = None


@internal_router.put(
    "/update_org_plan",
    response_model=UpdateOrgPlanResponse,
    summary="Update an organization's SaaS plan",
    description=(
        "Set the cloud plan for an organization. Protected by the internal "
        "cloud key (X-Internal-Key header). Reuses the org config service to "
        "persist the new plan into the existing organization config."
    ),
    responses={
        200: {"description": "Plan updated", "model": UpdateOrgPlanResponse},
        403: {"description": "Invalid internal API key"},
        404: {"description": "Organization or organization config not found"},
        422: {"description": "Invalid plan name"},
    },
)
async def api_update_org_plan(
    request: Request,
    body: UpdateOrgPlanRequest,
    db_session: AsyncSession = Depends(get_db_session),
) -> UpdateOrgPlanResponse:
    if body.plan not in VALID_PLANS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid plan '{body.plan}'. Valid plans: {sorted(VALID_PLANS)}",
        )

    # Load the org
    org = (
        await db_session.execute(
            select(Organization).where(Organization.id == body.org_id)
        )
    ).scalars().first()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    # The demo's plan is owned by its bundle config and is rewritten on every
    # refresh, so a write here would be silently undone within the hour. More
    # importantly, this endpoint is what the billing platform calls after a
    # successful payment; a plan write landing on the demo means somebody was
    # charged for it.
    if org.is_demo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The demo organization's plan cannot be changed.",
        )

    # Plain values: the plan-change reactions below commit (and may roll back),
    # which would expire the loaded row.
    org_slug, org_created = org.slug, org.creation_date

    # Load the existing org config (so we only mutate the plan key)
    org_config = (
        await db_session.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
        )
    ).scalars().first()
    if org_config is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization config not found",
        )

    # Preserve the existing config and only set the plan. Support both v1
    # (cloud.plan) and v2 (plan) config layouts, mirroring
    # features_utils.resolve._get_plan_from_config.
    config = dict(org_config.config or {})
    version = str(config.get("config_version", "1.0"))
    if version.startswith("2"):
        config["plan"] = body.plan
    else:
        cloud = dict(config.get("cloud", {}))
        cloud["plan"] = body.plan
        config["cloud"] = cloud

    # Persist via the existing org config service (no reimplementation). It
    # also runs the plan-change reactions (trial settled, Free plan content
    # rules on a downgrade, their undo on an upgrade).
    await update_org_with_config_no_auth(request, config, body.org_id, db_session)

    # This endpoint is what billing calls after a payment. Buying the plan the
    # trial already runs on doesn't change the plan string, so settle the trial
    # explicitly: a paying org must never be moved to Free when the date passes.
    from src.services.plans.trial import mark_converted

    trial_converted = await mark_converted(db_session, body.org_id, body.plan)

    # A plan change must be reflected immediately. Proactively invalidate every
    # cache that would otherwise serve the OLD plan/limits until its TTL lapses:
    #   - org config + org-by-slug caches (the badge / plan reads),
    #   - the usage cache (the limit denominators), which the generic config
    #     update path never invalidates, so without this a freshly-upgraded org
    #     shows its new plan badge but stale free-tier limits (e.g. Pro plan with
    #     "Courses 2/1" and "Limit reached") for up to the cache TTL.
    invalidate_org_config_cache(body.org_id)
    invalidate_org_cache(org_slug)
    invalidate_usage_cache(body.org_id)

    return UpdateOrgPlanResponse(
        detail="Organization plan updated",
        org_id=body.org_id,
        plan=body.plan,
        trial_converted=trial_converted,
        org_age_days=_age_days(org_created),
    )


def _age_days(creation_date: Optional[str]) -> Optional[int]:
    """Whole days since the org was created (creation_date is a naive string)."""
    from datetime import datetime

    try:
        created = datetime.fromisoformat(str(creation_date))
    except (TypeError, ValueError):
        return None
    return max(0, (datetime.now() - created.replace(tzinfo=None)).days)


class ReconcileAdminsResponse(BaseModel):
    detail: str
    admins_synced: int


@internal_router.post(
    "/reconcile_loops_admins",
    response_model=ReconcileAdminsResponse,
    summary="Backfill existing org admins into the Loops marketing audience",
    description=(
        "Enumerate every current org ADMIN (role_id=1) across all organizations "
        "and ensure each is on the Loops mailing list. Idempotent: Loops "
        "contact upsert means re-running is safe. Protected by the internal "
        "cloud key (X-Internal-Key header). Best-effort & SaaS-only; a no-op "
        "when LOOPS_API_KEY is unset. The sync itself is fire-and-forget, so a "
        "200 means the sync was scheduled for each admin, not that Loops "
        "acknowledged every contact."
    ),
    responses={
        200: {"description": "Reconcile scheduled", "model": ReconcileAdminsResponse},
        403: {"description": "Invalid internal API key"},
    },
)
async def api_reconcile_loops_admins(
    db_session: AsyncSession = Depends(get_db_session),
) -> ReconcileAdminsResponse:
    # One admin can administer several orgs; de-dupe by user so each contact is
    # upserted once. We pick a representative org_slug per user (their first
    # admin membership) purely as a contact property; Loops keys on email.
    rows = (
        await db_session.execute(
            select(User, Organization.slug)
            .join(UserOrganization, UserOrganization.user_id == User.id)
            .join(Organization, Organization.id == UserOrganization.org_id)
            .where(UserOrganization.role_id == ADMIN_ROLE_ID)
        )
    ).all()

    seen: set[int] = set()
    synced = 0
    for user, org_slug in rows:
        if user is None or user.id in seen or not user.email:
            continue
        seen.add(user.id)
        record_org_admin_in_loops(
            email=user.email,
            org_slug=org_slug,
            first_name=getattr(user, "first_name", None),
            last_name=getattr(user, "last_name", None),
        )
        synced += 1

    return ReconcileAdminsResponse(
        detail="Loops admin reconcile scheduled",
        admins_synced=synced,
    )


class FastForwardTrialRequest(BaseModel):
    days: float


@internal_router.post(
    "/trials/run",
    summary="Run the trial job now",
    description=(
        "Moves organizations whose trial ran out to the Free plan, then sends any "
        "trial email that is due. The same job runs hourly inside the API; this "
        "runs it on demand. Idempotent. Protected by the internal cloud key."
    ),
    responses={200: {"description": "Orgs moved to Free and emails sent"}, 403: {"description": "Invalid internal API key"}},
)
async def api_run_trial_job(db_session: AsyncSession = Depends(get_db_session)) -> dict:
    from src.services.plans.scheduler import run_once

    return await run_once(db_session)


@internal_router.post(
    "/trials/{org_id}/fast_forward",
    summary="Move a trial forward in time",
    description=(
        "Shifts an organization's trial start and end dates `days` into the past "
        "and runs the trial job, as if that much time had passed. For staging and "
        "end-to-end tests of the trial emails and the move to Free. Protected by "
        "the internal cloud key."
    ),
    responses={
        200: {"description": "The trial after the shift, and what the job did"},
        403: {"description": "Invalid internal API key"},
        404: {"description": "Organization has no trial"},
    },
)
async def api_fast_forward_trial(
    org_id: int,
    body: FastForwardTrialRequest,
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    from datetime import timedelta

    from src.services.plans.scheduler import run_once
    from src.services.plans.trial import get_trial, trial_state

    trial = await get_trial(db_session, org_id)
    if trial is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization has no trial")
    shift = timedelta(days=body.days)
    trial.started_at = trial.started_at - shift
    trial.ends_at = trial.ends_at - shift
    db_session.add(trial)
    await db_session.commit()
    job = await run_once(db_session)
    await db_session.refresh(trial)
    return {"trial": trial_state(trial), "job": job}


class SendBillingEmailRequest(BaseModel):
    template: str
    to: list[str]
    context: dict = {}


@internal_router.post(
    "/send_billing_email",
    summary="Send a Stripe billing email through the shared mail pipeline",
    description=(
        "Used by the web app's Stripe webhook so billing mail renders with the "
        "same templates and goes through the same provider as every other "
        "email. Only the billing templates are accepted. Protected by the "
        "internal cloud key (X-Internal-Key header)."
    ),
)
async def send_billing_email_internal(body: SendBillingEmailRequest):
    from src.services.email.pipeline import asend_email
    from src.services.email.templates.billing import WEB_BILLING_TEMPLATES

    if body.template not in WEB_BILLING_TEMPLATES:
        raise HTTPException(status_code=400, detail="Unknown billing email template")
    recipients = list(dict.fromkeys(e.strip() for e in body.to if e and "@" in e))[:20]
    context = dict(body.context)
    if context.get("org_slug") and not context.get("billing_url"):
        from src.services.email.utils import get_org_signup_base_url

        base = await get_org_signup_base_url(str(context["org_slug"]))
        if base:
            context["billing_url"] = f"{base.rstrip('/')}/dash/org/settings/plan"
    sent = 0
    for to in recipients:
        if await asend_email(body.template, to, context, critical=False) is not False:
            sent += 1
    return {"sent": sent, "recipients": len(recipients)}
