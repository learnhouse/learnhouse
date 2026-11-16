"""
AI Credits Management Router

Provides endpoints for managing AI credits for organizations:
- View credit balance
- Add purchased credits (for admin use)
- Reset credit usage (for billing cycles)
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.organizations import Organization
from src.db.users import PublicUser, AnonymousUser, APITokenUser
from src.security.auth import get_current_user, resolve_acting_user_id
from src.security.features_utils.usage import (
    add_ai_credits,
    get_ai_credits_summary,
    reset_ai_credits_usage,
    set_ai_credits,
)
from src.security.org_auth import is_org_member, is_org_admin, enforce_org_mfa
from src.security.superadmin import ensure_ee_superadmin_surface, is_user_superadmin


router = APIRouter()


async def _require_platform_plan_role(user_id: int, db_session: AsyncSession) -> None:
    """On EE the platform console roles apply here too: a superadmin whose
    team role lacks ``orgs.plan`` (viewer, support, sales) can't change credits."""
    from src.core.ee_hooks import get_ee_hooks

    hooks = get_ee_hooks()
    denied = getattr(hooks, "platform_permission_denied", None) if hooks else None
    if denied is not None and await denied(db_session, user_id, "orgs.plan"):
        raise HTTPException(status_code=403, detail="Your platform role can't change AI credits")


class AddCreditsRequest(BaseModel):
    """Request body for adding AI credits."""
    amount: int


class AddCreditsResponse(BaseModel):
    """Response for adding AI credits."""
    success: bool
    new_purchased_total: int
    message: str


class SetCreditsRequest(BaseModel):
    """Request body for setting purchased AI credits to an absolute value."""
    amount: int


class SetCreditsResponse(BaseModel):
    """Response for setting purchased AI credits."""
    success: bool
    purchased_total: int
    message: str


class ResetCreditsResponse(BaseModel):
    """Response for resetting AI credits usage."""
    success: bool
    message: str


class AICreditsSummary(BaseModel):
    """AI credits summary response."""
    plan: str
    base_credits: int | str
    purchased_credits: int
    total_credits: int | str
    used_credits: int
    remaining_credits: int | str
    mode: str | None = None
    # ok | low (<= 20% left) | critical (<= 5%) | empty | unlimited
    balance_state: str = "ok"
    remaining_pct: float | None = None


async def verify_user_is_org_admin(
    user_id: int,
    org_id: int,
    db_session: AsyncSession,
) -> bool:
    """Verify that the user is an admin of the organization (superadmins bypass)."""
    return await is_org_admin(user_id, org_id, db_session)


async def verify_user_is_org_member(
    user_id: int,
    org_id: int,
    db_session: AsyncSession,
) -> bool:
    """Verify that the user is a member of the organization (superadmins bypass)."""
    member = await is_org_member(user_id, org_id, db_session)
    if member:
        await enforce_org_mfa(user_id, org_id, db_session)
    return member


@router.get(
    "/{org_id}/ai-credits",
    response_model=AICreditsSummary,
    summary="Get AI credits summary",
    description=(
        "Return the AI credits summary for an organization, including base, "
        "purchased, used, and remaining credits. The caller must be a member "
        "of the organization."
    ),
    responses={
        200: {"description": "AI credits summary for the organization.", "model": AICreditsSummary},
        403: {"description": "User is not a member of this organization"},
        404: {"description": "Organization not found or credits summary unavailable"},
    },
)
async def get_org_ai_credits(
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> AICreditsSummary:
    """
    Get the AI credits summary for an organization.

    Returns:
        AI credits summary including base, purchased, used, and remaining credits.
    """
    # Validate organization exists
    statement = select(Organization).where(Organization.id == org_id)
    org = (await db_session.execute(statement)).scalars().first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # API tokens are scoped to a single org; do not let a token authenticate
    # against a different org just because its creator is a member there.
    if isinstance(current_user, APITokenUser) and current_user.org_id != org_id:
        raise HTTPException(
            status_code=403,
            detail="API token is not scoped to this organization",
        )

    # Verify user is a member of the organization
    if not await verify_user_is_org_member(resolve_acting_user_id(current_user), org_id, db_session):
        raise HTTPException(
            status_code=403,
            detail="User is not a member of this organization",
        )

    summary = await get_ai_credits_summary(org_id, db_session)

    if "error" in summary:
        raise HTTPException(status_code=404, detail=summary["error"])

    from src.services.ai.usage_reports import balance_state

    state = balance_state(summary.get("remaining_credits"), summary.get("total_credits"))
    return AICreditsSummary(**summary, balance_state=state["state"], remaining_pct=state["remaining_pct"])


async def _require_member(org_id: int, current_user, db_session: AsyncSession, *, admin: bool = False) -> None:
    org = (await db_session.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    if isinstance(current_user, APITokenUser) and current_user.org_id != org_id:
        raise HTTPException(status_code=403, detail="API token is not scoped to this organization")
    user_id = resolve_acting_user_id(current_user)
    check = verify_user_is_org_admin if admin else verify_user_is_org_member
    if not user_id or not await check(user_id, org_id, db_session):
        raise HTTPException(
            status_code=403,
            detail="Admin rights required" if admin else "User is not a member of this organization",
        )


@router.get(
    "/{org_id}/ai-credits/prices",
    summary="AI credit prices per feature",
    description=(
        "The published credit price of every AI feature. Metered features charge at "
        "least their price; long or heavy requests (many Atlas steps, long audio) charge "
        "their real usage. The caller must be a member of the organization."
    ),
)
async def get_org_ai_prices(
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    await _require_member(org_id, current_user, db_session)
    from src.services.ai.pricing import public_price_table
    from src.services.ai.usage_reports import CRITICAL_BALANCE_PCT, LOW_BALANCE_PCT

    return {
        "features": public_price_table(),
        "low_balance_pct": LOW_BALANCE_PCT,
        "critical_balance_pct": CRITICAL_BALANCE_PCT,
    }


@router.get(
    "/{org_id}/ai-credits/usage",
    summary="AI credit usage breakdown",
    description=(
        "Credits used over the last `days` days, by feature, by member and by day. "
        "Organization admins only."
    ),
)
async def get_org_ai_usage(
    org_id: int,
    days: int = Query(30, ge=1, le=366),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    await _require_member(org_id, current_user, db_session, admin=True)
    from src.services.ai.usage_reports import org_usage

    return await org_usage(db_session, org_id, days=days)


@router.post(
    "/{org_id}/ai-credits/add",
    response_model=AddCreditsResponse,
    summary="Add purchased AI credits (superadmin only)",
    description=(
        "Add purchased AI credits to an organization. Restricted to superadmins "
        "because it grants paid quota with no payment verification; the amount "
        "must be a positive integer."
    ),
    responses={
        200: {"description": "Credits added and new purchased total returned.", "model": AddCreditsResponse},
        400: {"description": "Credit amount must be a positive number"},
        403: {"description": "Superadmin access required"},
        404: {"description": "Organization not found"},
    },
)
async def add_org_ai_credits(
    org_id: int,
    request: AddCreditsRequest,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> AddCreditsResponse:
    """
    Add purchased AI credits to an organization.

    Restricted to superadmins (grants paid quota with no payment check).

    Args:
        org_id: The organization ID
        request: Contains the amount of credits to add

    Returns:
        Success status and new total purchased credits.
    """
    # Validate organization exists
    statement = select(Organization).where(Organization.id == org_id)
    org = (await db_session.execute(statement)).scalars().first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Granting "purchased" AI credits adds paid quota for an arbitrary,
    # client-supplied amount with NO payment verification. Allowing any org
    # admin here lets a tenant mint unlimited free AI credits for itself
    # (revenue/quota bypass), so this must be a billing-platform / superadmin
    # operation, same posture as the /set endpoint.
    ensure_ee_superadmin_surface()
    user_id = resolve_acting_user_id(current_user)
    if not user_id or not await is_user_superadmin(user_id, db_session):
        raise HTTPException(
            status_code=403,
            detail="Superadmin access required",
        )
    await _require_platform_plan_role(user_id, db_session)

    # Validate amount
    if request.amount <= 0:
        raise HTTPException(
            status_code=400,
            detail="Credit amount must be a positive number",
        )

    # Add credits
    new_total = add_ai_credits(org_id, request.amount)

    return AddCreditsResponse(
        success=True,
        new_purchased_total=new_total,
        message=f"Successfully added {request.amount} AI credits. New purchased total: {new_total}",
    )


@router.post(
    "/{org_id}/ai-credits/reset",
    response_model=ResetCreditsResponse,
    summary="Reset AI credits usage (superadmin only)",
    description=(
        "Reset AI credits usage for an organization. Typically used at the "
        "start of a new billing period. Restricted to superadmins because it "
        "clears metered usage and would otherwise let a tenant bypass its quota."
    ),
    responses={
        200: {"description": "AI credits usage reset to zero.", "model": ResetCreditsResponse},
        403: {"description": "Superadmin access required"},
        404: {"description": "Organization not found"},
    },
)
async def reset_org_ai_credits(
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> ResetCreditsResponse:
    """
    Reset AI credits usage for an organization.

    This is typically used at the start of a new billing period.
    Restricted to superadmins (clears metered usage / quota).

    Args:
        org_id: The organization ID

    Returns:
        Success status.
    """
    # Validate organization exists
    statement = select(Organization).where(Organization.id == org_id)
    org = (await db_session.execute(statement)).scalars().first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Resetting consumed usage effectively grants free metered AI usage, letting
    # a tenant zero out its own usage at will and bypass the plan's AI quota.
    # This is a billing-platform / superadmin operation (same posture as /set).
    ensure_ee_superadmin_surface()
    user_id = resolve_acting_user_id(current_user)
    if not user_id or not await is_user_superadmin(user_id, db_session):
        raise HTTPException(
            status_code=403,
            detail="Superadmin access required",
        )
    await _require_platform_plan_role(user_id, db_session)

    # Reset usage
    reset_ai_credits_usage(org_id)

    return ResetCreditsResponse(
        success=True,
        message="AI credits usage has been reset to 0",
    )


@router.post(
    "/{org_id}/ai-credits/set",
    response_model=SetCreditsResponse,
    summary="Set purchased AI credits (superadmin only)",
    description=(
        "Overwrite the org's purchased AI credit balance to an absolute value. "
        "Restricted to superadmins; bypasses the additive /add flow so it can "
        "grant, correct, or zero out credits in one call."
    ),
    responses={
        200: {"description": "Credits set; returns the new purchased total.", "model": SetCreditsResponse},
        400: {"description": "Credit amount must be non-negative"},
        403: {"description": "Superadmin access required"},
        404: {"description": "Organization not found"},
    },
)
async def set_org_ai_credits(
    org_id: int,
    request: SetCreditsRequest,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> SetCreditsResponse:
    statement = select(Organization).where(Organization.id == org_id)
    org = (await db_session.execute(statement)).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    ensure_ee_superadmin_surface()
    user_id = resolve_acting_user_id(current_user)
    if not user_id or not await is_user_superadmin(user_id, db_session):
        raise HTTPException(status_code=403, detail="Superadmin access required")
    await _require_platform_plan_role(user_id, db_session)

    if request.amount < 0:
        raise HTTPException(status_code=400, detail="Credit amount must be non-negative")

    new_total = set_ai_credits(org_id, request.amount)

    return SetCreditsResponse(
        success=True,
        purchased_total=new_total,
        message=f"Purchased AI credits set to {new_total}",
    )
