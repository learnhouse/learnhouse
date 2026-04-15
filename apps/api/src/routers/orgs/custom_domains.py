import os
from typing import List
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
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
    list_all_verified_domains,
    get_custom_domain,
    get_domain_verification_info,
    verify_custom_domain,
    delete_custom_domain,
    resolve_org_by_domain,
    check_domain_ssl_status,
)

# Router for authenticated endpoints (requires plan check)
router = APIRouter()

# Public router for domain resolution (no auth required)
public_router = APIRouter()

# Internal router for infrastructure (protected by internal key)
internal_router = APIRouter()


@router.post(
    "/{org_id}/domains",
    response_model=CustomDomainRead,
    summary="Add a custom domain",
    description=(
        "Add a new custom domain to an organization. This generates a "
        "verification token and returns DNS instructions. Only organization "
        "administrators can add custom domains."
    ),
    responses={
        200: {"description": "Custom domain registered with DNS verification instructions.", "model": CustomDomainRead},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization not found"},
    },
)
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


@router.get(
    "/{org_id}/domains",
    response_model=List[CustomDomainRead],
    summary="List custom domains",
    description=(
        "List all custom domains for an organization, including their "
        "verification status."
    ),
    responses={
        200: {"description": "List of custom domains for the organization.", "model": List[CustomDomainRead]},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not a member of the organization"},
        404: {"description": "Organization not found"},
    },
)
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


@router.get(
    "/{org_id}/domains/{domain_uuid}",
    response_model=CustomDomainRead,
    summary="Get a custom domain",
    description="Get details of a single custom domain by its UUID, including verification status.",
    responses={
        200: {"description": "Custom domain details.", "model": CustomDomainRead},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not a member of the organization"},
        404: {"description": "Organization or custom domain not found"},
    },
)
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


@router.get(
    "/{org_id}/domains/{domain_uuid}/verification-info",
    response_model=CustomDomainVerificationInfo,
    summary="Get DNS verification info",
    description=(
        "Return the DNS records (TXT and CNAME) that must be configured at "
        "the domain provider in order to verify the custom domain."
    ),
    responses={
        200: {"description": "DNS verification instructions for the custom domain.", "model": CustomDomainVerificationInfo},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not a member of the organization"},
        404: {"description": "Organization or custom domain not found"},
    },
)
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


@router.post(
    "/{org_id}/domains/{domain_uuid}/verify",
    summary="Verify custom domain DNS",
    description=(
        "Verify the DNS configuration for a custom domain by checking that "
        "the expected TXT verification record is in place. Only organization "
        "administrators can verify domains."
    ),
    responses={
        200: {"description": "DNS verification result for the custom domain."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization or custom domain not found"},
    },
)
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


@router.get(
    "/{org_id}/domains/{domain_uuid}/ssl-status",
    summary="Check custom domain SSL status",
    description=(
        "Check the SSL certificate status for a custom domain by performing "
        "a TLS handshake to determine whether a certificate has been provisioned."
    ),
    responses={
        200: {"description": "SSL certificate status for the custom domain."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not a member of the organization"},
        404: {"description": "Organization or custom domain not found"},
    },
)
async def api_check_domain_ssl_status(
    request: Request,
    org_id: int,
    domain_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> dict:
    """
    Check SSL certificate status for a custom domain.

    Performs a TLS handshake to determine if the certificate has been provisioned.
    """
    return await check_domain_ssl_status(
        request, db_session, org_id, domain_uuid, current_user
    )


@router.delete(
    "/{org_id}/domains/{domain_uuid}",
    summary="Delete a custom domain",
    description=(
        "Delete a custom domain. This action cannot be undone. Only "
        "organization administrators can delete custom domains."
    ),
    responses={
        200: {"description": "Custom domain deleted."},
        401: {"description": "Not authenticated"},
        403: {"description": "Caller is not an organization administrator"},
        404: {"description": "Organization or custom domain not found"},
    },
)
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


@public_router.get(
    "/resolve/domain/{domain}",
    response_model=CustomDomainResolveResponse,
    summary="Resolve custom domain to organization",
    description=(
        "Public endpoint used by the frontend proxy to route custom domain "
        "requests to the correct organization. Returns 404 if the domain is "
        "not registered or not verified."
    ),
    responses={
        200: {"description": "Organization that owns the requested custom domain.", "model": CustomDomainResolveResponse},
        404: {"description": "Domain not found or not verified"},
    },
)
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Domain not found or not verified",
        )
    return result


@internal_router.get(
    "/domains/verified",
    summary="List all verified custom domains",
    description=(
        "Return every verified custom domain across all organizations. "
        "Protected by an internal API key and used by the domain sync CronJob."
    ),
    responses={
        200: {"description": "List of every verified custom domain across organizations."},
        403: {"description": "Invalid internal API key"},
    },
)
async def api_list_all_verified_domains(
    request: Request,
    x_internal_key: str = Header(...),
    db_session: Session = Depends(get_db_session),
) -> List[dict]:
    """
    List all verified custom domains across all organizations.
    Protected by internal API key - used by the domain sync CronJob.
    """
    expected_key = os.getenv("CLOUD_INTERNAL_KEY", "")
    if not expected_key or x_internal_key != expected_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid internal API key",
        )
    return await list_all_verified_domains(db_session)
