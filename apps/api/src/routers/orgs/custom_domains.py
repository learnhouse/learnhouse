from typing import List
from fastapi import APIRouter, Depends, Request
from sqlmodel import Session

from src.core.events.database import get_db_session
from src.db.custom_domains import (
    CustomDomainCreate,
    CustomDomainRead,
    CustomDomainVerificationInfo,
    CustomDomainResolveResponse,
)
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.orgs.custom_domains import (
    add_custom_domain,
    list_custom_domains,
    get_custom_domain,
    get_domain_verification_info,
    verify_custom_domain,
    delete_custom_domain,
    resolve_org_by_domain,
)

# Router for authenticated endpoints (requires plan check)
router = APIRouter()

# Public router for domain resolution (no auth required)
public_router = APIRouter()


@router.post("/{org_id}/domains", response_model=CustomDomainRead)
async def api_add_custom_domain(
    request: Request,
    org_id: int,
    domain_data: CustomDomainCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CustomDomainRead:
    """
    Add a new custom domain to an organization.

    This will generate a verification token and return DNS instructions.
    Only organization administrators can add custom domains.
    """
    return await add_custom_domain(
        request, db_session, domain_data, org_id, current_user
    )


@router.get("/{org_id}/domains", response_model=List[CustomDomainRead])
async def api_list_custom_domains(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[CustomDomainRead]:
    """
    List all custom domains for an organization.

    Returns domain details including verification status.
    """
    return await list_custom_domains(request, db_session, org_id, current_user)


@router.get("/{org_id}/domains/{domain_uuid}", response_model=CustomDomainRead)
async def api_get_custom_domain(
    request: Request,
    org_id: int,
    domain_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CustomDomainRead:
    """
    Get details of a specific custom domain.
    """
    return await get_custom_domain(request, db_session, org_id, domain_uuid, current_user)


@router.get("/{org_id}/domains/{domain_uuid}/verification-info", response_model=CustomDomainVerificationInfo)
async def api_get_domain_verification_info(
    request: Request,
    org_id: int,
    domain_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CustomDomainVerificationInfo:
    """
    Get DNS verification instructions for a custom domain.

    Returns the TXT and CNAME records that need to be configured
    at the domain provider.
    """
    return await get_domain_verification_info(
        request, db_session, org_id, domain_uuid, current_user
    )


@router.post("/{org_id}/domains/{domain_uuid}/verify")
async def api_verify_custom_domain(
    request: Request,
    org_id: int,
    domain_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> dict:
    """
    Verify DNS configuration for a custom domain.

    Checks that the TXT verification record is properly configured.
    Only organization administrators can verify domains.
    """
    return await verify_custom_domain(
        request, db_session, org_id, domain_uuid, current_user
    )


@router.delete("/{org_id}/domains/{domain_uuid}")
async def api_delete_custom_domain(
    request: Request,
    org_id: int,
    domain_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> dict:
    """
    Delete a custom domain.

    This action cannot be undone. Only organization administrators
    can delete custom domains.
    """
    return await delete_custom_domain(
        request, db_session, org_id, domain_uuid, current_user
    )


@public_router.get("/resolve/domain/{domain}", response_model=CustomDomainResolveResponse)
async def api_resolve_domain(
    request: Request,
    domain: str,
    db_session: Session = Depends(get_db_session),
) -> CustomDomainResolveResponse:
    """
    Resolve a custom domain to an organization.

    This is a public endpoint used by the frontend proxy to
    route custom domain requests to the correct organization.
    Returns 404 if the domain is not registered or not verified.
    """
    result = await resolve_org_by_domain(db_session, domain)
    if not result:
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain not found or not verified",
        )
    return result
