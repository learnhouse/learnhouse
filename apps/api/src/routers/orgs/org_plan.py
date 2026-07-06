import os
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
    "enterprise",
}


async def verify_cloud_internal_key(x_internal_key: str = Header(...)):
    """Mirror of the custom_domains internal-key check (X-Internal-Key / CLOUD_INTERNAL_KEY)."""
    expected_key = os.getenv("CLOUD_INTERNAL_KEY", "")
    if (
        not expected_key
        or not x_internal_key
        or not secrets.compare_digest(x_internal_key, expected_key)
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

    # Persist via the existing org config service (no reimplementation)
    await update_org_with_config_no_auth(request, config, body.org_id, db_session)

    # A plan change must be reflected immediately. Proactively invalidate every
    # cache that would otherwise serve the OLD plan/limits until its TTL lapses:
    #   - org config + org-by-slug caches (the badge / plan reads),
    #   - the usage cache (the limit denominators) — which the generic config
    #     update path never invalidates, so without this a freshly-upgraded org
    #     shows its new plan badge but stale free-tier limits (e.g. Pro plan with
    #     "Courses 2/1 — Limit reached") for up to the cache TTL.
    invalidate_org_config_cache(body.org_id)
    invalidate_org_cache(org.slug)
    invalidate_usage_cache(body.org_id)

    return UpdateOrgPlanResponse(
        detail="Organization plan updated",
        org_id=body.org_id,
        plan=body.plan,
    )


class ReconcileAdminsResponse(BaseModel):
    detail: str
    admins_synced: int


@internal_router.post(
    "/reconcile_loops_admins",
    response_model=ReconcileAdminsResponse,
    summary="Backfill existing org admins into the Loops marketing audience",
    description=(
        "Enumerate every current org ADMIN (role_id=1) across all organizations "
        "and ensure each is on the Loops mailing list. Idempotent — Loops "
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
    # admin membership) purely as a contact property — Loops keys on email.
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
