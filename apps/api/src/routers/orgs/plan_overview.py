"""Settings → Plan & usage: the org's plan, status, POC brief and feature matrix."""

from fastapi import APIRouter, Depends
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.security.auth import get_current_user, resolve_acting_user_id
from src.security.org_auth import require_org_admin
from src.services.orgs.plan_overview import get_plan_overview

router = APIRouter()


@router.get(
    "/{org_id}/plan-overview",
    summary="Get the organization's plan overview",
    description=(
        "The organization's plan and status (paid, free, trial, proof of concept, "
        "self-hosted), a brief of a running or recent proof of concept, and every "
        "feature grouped by area with its state: included, unlocked by the POC, "
        "an add-on, not in the plan (with the plan that has it) or needing the "
        "Enterprise Edition. Admins and maintainers only."
    ),
    responses={
        200: {"description": "Plan, status, POC brief and feature matrix."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an administrator or maintainer of the organization"},
        404: {"description": "Organization not found"},
    },
)
async def api_get_plan_overview(
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    await require_org_admin(resolve_acting_user_id(current_user), org_id, db_session)
    return await get_plan_overview(org_id, db_session)


@router.get(
    "/{org_id}/trial",
    summary="Get the organization's trial",
    description=(
        "The organization's free trial (SaaS): its plan, status (active, converted, "
        "expired, ended), dates and whole days left. `trial` is null when the "
        "organization never had one, including on self-hosted installs. Admins and "
        "maintainers only."
    ),
    responses={
        200: {"description": "The trial, or null."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an administrator or maintainer of the organization"},
    },
)
async def api_get_trial(
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    from src.core.deployment_mode import get_deployment_mode
    from src.services.plans.trial import get_trial, trial_state

    await require_org_admin(resolve_acting_user_id(current_user), org_id, db_session)
    if get_deployment_mode() != "saas":
        return {"trial": None}
    return {"trial": trial_state(await get_trial(db_session, org_id))}
