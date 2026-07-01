import os
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.services.orgs.orgs import update_org_with_config_no_auth


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

    return UpdateOrgPlanResponse(
        detail="Organization plan updated",
        org_id=body.org_id,
        plan=body.plan,
    )
