"""
AI Credits Management Router

Provides endpoints for managing AI credits for organizations:
- View credit balance
- Add purchased credits (for admin use)
- Reset credit usage (for billing cycles)
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from src.core.events.database import get_db_session
from src.db.organizations import Organization
from src.db.users import PublicUser, AnonymousUser, APITokenUser
from src.security.auth import get_current_user, resolve_acting_user_id
from src.security.features_utils.usage import (
    add_ai_credits,
    get_ai_credits_summary,
    reset_ai_credits_usage,
)
from src.security.org_auth import is_org_member, is_org_admin


router = APIRouter()


class AddCreditsRequest(BaseModel):
    """Request body for adding AI credits."""
    amount: int


class AddCreditsResponse(BaseModel):
    """Response for adding AI credits."""
    success: bool
    new_purchased_total: int
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


async def verify_user_is_org_admin(
    user_id: int,
    org_id: int,
    db_session: Session,
) -> bool:
    """Verify that the user is an admin of the organization (superadmins bypass)."""
    return is_org_admin(user_id, org_id, db_session)


async def verify_user_is_org_member(
    user_id: int,
    org_id: int,
    db_session: Session,
) -> bool:
    """Verify that the user is a member of the organization (superadmins bypass)."""
    return is_org_member(user_id, org_id, db_session)


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
    db_session: Session = Depends(get_db_session),
) -> AICreditsSummary:
    """
    Get the AI credits summary for an organization.

    Returns:
        AI credits summary including base, purchased, used, and remaining credits.
    """
    # Validate organization exists
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Verify user is a member of the organization
    if not await verify_user_is_org_member(resolve_acting_user_id(current_user), org_id, db_session):
        raise HTTPException(
            status_code=403,
            detail="User is not a member of this organization",
        )

    summary = get_ai_credits_summary(org_id, db_session)

    if "error" in summary:
        raise HTTPException(status_code=404, detail=summary["error"])

    return AICreditsSummary(**summary)


@router.post(
    "/{org_id}/ai-credits/add",
    response_model=AddCreditsResponse,
    summary="Add purchased AI credits",
    description=(
        "Add purchased AI credits to an organization. Only organization admins "
        "can add credits and the amount must be a positive integer."
    ),
    responses={
        200: {"description": "Credits added and new purchased total returned.", "model": AddCreditsResponse},
        400: {"description": "Credit amount must be a positive number"},
        403: {"description": "Only organization admins can add AI credits"},
        404: {"description": "Organization not found"},
    },
)
async def add_org_ai_credits(
    org_id: int,
    request: AddCreditsRequest,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> AddCreditsResponse:
    """
    Add purchased AI credits to an organization.

    Only organization admins can add credits.

    Args:
        org_id: The organization ID
        request: Contains the amount of credits to add

    Returns:
        Success status and new total purchased credits.
    """
    # Validate organization exists
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Verify user is an admin of the organization
    if not await verify_user_is_org_admin(resolve_acting_user_id(current_user), org_id, db_session):
        raise HTTPException(
            status_code=403,
            detail="Only organization admins can add AI credits",
        )

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
    summary="Reset AI credits usage",
    description=(
        "Reset AI credits usage for an organization. Typically used at the "
        "start of a new billing period. Only organization admins can reset credits."
    ),
    responses={
        200: {"description": "AI credits usage reset to zero.", "model": ResetCreditsResponse},
        403: {"description": "Only organization admins can reset AI credits"},
        404: {"description": "Organization not found"},
    },
)
async def reset_org_ai_credits(
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> ResetCreditsResponse:
    """
    Reset AI credits usage for an organization.

    This is typically used at the start of a new billing period.
    Only organization admins can reset credits.

    Args:
        org_id: The organization ID

    Returns:
        Success status.
    """
    # Validate organization exists
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Verify user is an admin of the organization
    if not await verify_user_is_org_admin(resolve_acting_user_id(current_user), org_id, db_session):
        raise HTTPException(
            status_code=403,
            detail="Only organization admins can reset AI credits",
        )

    # Reset usage
    reset_ai_credits_usage(org_id)

    return ResetCreditsResponse(
        success=True,
        message="AI credits usage has been reset to 0",
    )
