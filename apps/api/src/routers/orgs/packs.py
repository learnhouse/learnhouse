import hmac
import os
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from src.core.events.database import get_db_session
from src.db.organizations import Organization
from src.db.packs import OrgPackRead
from src.db.users import PublicUser, AnonymousUser, APITokenUser
from src.security.auth import get_current_user, resolve_acting_user_id
from src.security.features_utils.packs import AVAILABLE_PACKS
from src.security.org_auth import is_org_admin
from src.services.packs.packs import (
    activate_pack,
    deactivate_pack,
    deactivate_all_packs_for_org,
    mark_pack_canceling,
    get_org_active_packs,
    get_org_pack_summary,
)


# ============================================================================
# Internal router (platform-key auth)
# ============================================================================

async def verify_platform_key(x_platform_key: str = Header(...)):
    expected_key = os.getenv("LEARNHOUSE_PLATFORM_API_KEY", "")
    if not expected_key:
        raise HTTPException(
            status_code=500,
            detail="LEARNHOUSE_PLATFORM_API_KEY is not configured on the server",
        )
    if not hmac.compare_digest(x_platform_key, expected_key):
        raise HTTPException(status_code=403, detail="Invalid platform API key")


internal_router = APIRouter(dependencies=[Depends(verify_platform_key)])


class ActivatePackRequest(BaseModel):
    pack_id: str
    platform_subscription_id: str


class DeactivatePackRequest(BaseModel):
    platform_subscription_id: str


class MarkCancelingRequest(BaseModel):
    platform_subscription_id: str


@internal_router.post(
    "/{org_id}/activate",
    response_model=OrgPackRead,
    summary="Activate a pack for an organization",
    description=(
        "Internal endpoint used by the billing platform to activate a pack "
        "on an organization after a successful purchase. Requires a valid "
        "platform API key."
    ),
    responses={
        200: {"description": "Pack activated for the organization.", "model": OrgPackRead},
        403: {"description": "Invalid platform API key"},
        500: {"description": "LEARNHOUSE_PLATFORM_API_KEY is not configured on the server"},
    },
)
async def api_activate_pack(
    org_id: int,
    body: ActivatePackRequest,
    db_session: Session = Depends(get_db_session),
):
    return activate_pack(org_id, body.pack_id, body.platform_subscription_id, db_session)


@internal_router.patch(
    "/{org_id}/mark-canceling",
    response_model=OrgPackRead,
    summary="Mark a pack as canceling",
    description=(
        "Internal endpoint used by the billing platform to mark a pack as "
        "pending cancellation for the given subscription. Requires a valid "
        "platform API key."
    ),
    responses={
        200: {"description": "Pack marked as canceling.", "model": OrgPackRead},
        403: {"description": "Invalid platform API key"},
        500: {"description": "LEARNHOUSE_PLATFORM_API_KEY is not configured on the server"},
    },
)
async def api_mark_pack_canceling(
    org_id: int,
    body: MarkCancelingRequest,
    db_session: Session = Depends(get_db_session),
):
    return mark_pack_canceling(org_id, body.platform_subscription_id, db_session)


@internal_router.delete(
    "/{org_id}/deactivate",
    response_model=OrgPackRead,
    summary="Deactivate a pack",
    description=(
        "Internal endpoint used by the billing platform to deactivate a "
        "single pack tied to a subscription ID. Requires a valid platform "
        "API key."
    ),
    responses={
        200: {"description": "Pack deactivated.", "model": OrgPackRead},
        403: {"description": "Invalid platform API key"},
        500: {"description": "LEARNHOUSE_PLATFORM_API_KEY is not configured on the server"},
    },
)
async def api_deactivate_pack(
    org_id: int,
    body: DeactivatePackRequest,
    db_session: Session = Depends(get_db_session),
):
    return deactivate_pack(org_id, body.platform_subscription_id, db_session)


@internal_router.delete(
    "/{org_id}/deactivate-all",
    summary="Deactivate all packs for an organization",
    description=(
        "Internal endpoint used by the billing platform to deactivate every "
        "pack currently attached to the organization. Requires a valid "
        "platform API key."
    ),
    responses={
        200: {"description": "All packs deactivated; returns the number of packs affected."},
        403: {"description": "Invalid platform API key"},
        500: {"description": "LEARNHOUSE_PLATFORM_API_KEY is not configured on the server"},
    },
)
async def api_deactivate_all_packs(
    org_id: int,
    db_session: Session = Depends(get_db_session),
):
    count = deactivate_all_packs_for_org(org_id, db_session)
    return {"deactivated": count}


# ============================================================================
# Org-facing router (user auth, admin only)
# ============================================================================

router = APIRouter()


class PackCatalogItem(BaseModel):
    pack_id: str
    type: str
    quantity: int
    label: str


class OrgPacksResponse(BaseModel):
    active_packs: list[OrgPackRead]
    available_packs: list[PackCatalogItem]


class PackSummaryResponse(BaseModel):
    ai_credits: int
    member_seats: int
    active_pack_count: int


@router.get(
    "/{org_id}/packs",
    response_model=OrgPacksResponse,
    summary="List active and available packs",
    description=(
        "Return the organization's active packs along with the full catalog of "
        "available packs. Only organization admins can view packs."
    ),
    responses={
        200: {"description": "Active packs and available pack catalog.", "model": OrgPacksResponse},
        403: {"description": "Only organization admins can view packs"},
        404: {"description": "Organization not found"},
    },
)
async def api_get_org_packs(
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if not is_org_admin(resolve_acting_user_id(current_user), org_id, db_session):
        raise HTTPException(status_code=403, detail="Only organization admins can view packs")

    active_packs = get_org_active_packs(org_id, db_session)
    catalog = [
        PackCatalogItem(pack_id=k, type=v["type"], quantity=v["quantity"], label=v["label"])
        for k, v in AVAILABLE_PACKS.items()
    ]

    return OrgPacksResponse(active_packs=active_packs, available_packs=catalog)


@router.get(
    "/{org_id}/packs/summary",
    response_model=PackSummaryResponse,
    summary="Get pack totals summary",
    description=(
        "Return aggregated totals from the organization's active packs "
        "(AI credits, member seats, and active pack count). Only organization "
        "admins can view the summary."
    ),
    responses={
        200: {"description": "Aggregated pack totals for the organization.", "model": PackSummaryResponse},
        403: {"description": "Only organization admins can view pack summary"},
        404: {"description": "Organization not found"},
    },
)
async def api_get_org_pack_summary(
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if not is_org_admin(resolve_acting_user_id(current_user), org_id, db_session):
        raise HTTPException(status_code=403, detail="Only organization admins can view pack summary")

    return get_org_pack_summary(org_id, db_session)
