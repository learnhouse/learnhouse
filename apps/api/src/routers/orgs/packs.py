import hmac
import logging
import os
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.organizations import Organization
from src.db.packs import OrgPackRead
from src.db.users import PublicUser, AnonymousUser, APITokenUser
from src.security.auth import get_current_user, resolve_acting_user_id
from src.security.features_utils.packs import AVAILABLE_PACKS
from src.security.org_auth import is_org_admin, enforce_org_mfa
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

logger = logging.getLogger(__name__)

# Set the first time a request arrives with LEARNHOUSE_PLATFORM_API_KEY unset, so
# the misconfiguration is reported once per process instead of on every request.
_REPORTED_MISSING_PLATFORM_KEY = False


async def verify_platform_key(x_platform_key: str = Header(...)):
    """Fail-closed guard for the internal packs endpoints.

    Mirrors verify_cloud_internal_key in org_plan.py: every rejection is a 403, so
    a caller cannot tell an unconfigured server from a wrong key.

    Both emptiness checks are load-bearing. hmac.compare_digest(b"", b"") returns
    True, so dropping either one makes an unconfigured deployment accept every
    request on all five internal pack endpoints. Comparison is on bytes because
    compare_digest rejects non-ASCII str, and header values reach us decoded as
    latin-1 — an arbitrary caller could otherwise trigger a TypeError.
    """
    global _REPORTED_MISSING_PLATFORM_KEY

    expected_key = os.getenv("LEARNHOUSE_PLATFORM_API_KEY", "")
    if not expected_key and not _REPORTED_MISSING_PLATFORM_KEY:
        _REPORTED_MISSING_PLATFORM_KEY = True
        logger.error(
            "LEARNHOUSE_PLATFORM_API_KEY is not set on this deployment: every "
            "internal pack request is rejected, so pack activation and "
            "active-user overage billing silently do nothing until it is set."
        )

    if (
        not expected_key
        or not x_platform_key
        or not hmac.compare_digest(x_platform_key.encode(), expected_key.encode())
    ):
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
    },
)
async def api_activate_pack(
    org_id: int,
    body: ActivatePackRequest,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await activate_pack(org_id, body.pack_id, body.platform_subscription_id, db_session)


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
    },
)
async def api_mark_pack_canceling(
    org_id: int,
    body: MarkCancelingRequest,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await mark_pack_canceling(org_id, body.platform_subscription_id, db_session)


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
    },
)
async def api_deactivate_pack(
    org_id: int,
    body: DeactivatePackRequest,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await deactivate_pack(org_id, body.platform_subscription_id, db_session)


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
    },
)
async def api_deactivate_all_packs(
    org_id: int,
    db_session: AsyncSession = Depends(get_db_session),
):
    count = await deactivate_all_packs_for_org(org_id, db_session)
    return {"deactivated": count}


@internal_router.get(
    "/{org_id}/active-user-overage",
    summary="Get active-user overage for an organization (internal)",
    description=(
        "Internal endpoint used by the billing platform to pull an "
        "organization's active-user count and billable overage for a calendar "
        "month (defaults to the current UTC month). Requires a valid platform "
        "API key. This endpoint computes the number only; the platform performs "
        "the Stripe charge."
    ),
    responses={
        200: {"description": "Active-user count, included limit, and overage for the month."},
        403: {"description": "Invalid platform API key"},
    },
)
async def api_get_active_user_overage(
    org_id: int,
    year: int | None = None,
    month: int | None = None,
    db_session: AsyncSession = Depends(get_db_session),
):
    from src.security.features_utils.active_users import get_active_user_summary
    return await get_active_user_summary(org_id, db_session, year=year, month=month)


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
    db_session: AsyncSession = Depends(get_db_session),
):
    org = (await db_session.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # API tokens are scoped to a single org; do not let a token act against a
    # different org just because its creator is an admin there.
    if isinstance(current_user, APITokenUser) and current_user.org_id != org_id:
        raise HTTPException(status_code=403, detail="API token is not scoped to this organization")

    if not await is_org_admin(resolve_acting_user_id(current_user), org_id, db_session):
        raise HTTPException(status_code=403, detail="Only organization admins can view packs")
    # Org-wide two-factor policy, applied after the membership gate.
    await enforce_org_mfa(resolve_acting_user_id(current_user), org_id, db_session)

    active_packs = await get_org_active_packs(org_id, db_session)
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
        "(AI credits and active pack count). Only organization "
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
    db_session: AsyncSession = Depends(get_db_session),
):
    org = (await db_session.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # API tokens are scoped to a single org; do not let a token act against a
    # different org just because its creator is an admin there.
    if isinstance(current_user, APITokenUser) and current_user.org_id != org_id:
        raise HTTPException(status_code=403, detail="API token is not scoped to this organization")

    if not await is_org_admin(resolve_acting_user_id(current_user), org_id, db_session):
        raise HTTPException(status_code=403, detail="Only organization admins can view pack summary")
    # Org-wide two-factor policy, applied after the membership gate.
    await enforce_org_mfa(resolve_acting_user_id(current_user), org_id, db_session)

    return await get_org_pack_summary(org_id, db_session)
