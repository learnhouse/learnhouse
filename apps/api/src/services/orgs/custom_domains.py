import os
import re
import secrets
import logging
from typing import List, Optional, Tuple
from uuid import uuid4
from datetime import datetime
from sqlmodel import Session, select
from fastapi import HTTPException, Request, status

from src.db.custom_domains import (
    CustomDomain,
    CustomDomainCreate,
    CustomDomainRead,
    CustomDomainVerificationInfo,
    CustomDomainResolveResponse,
)
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.roles import Role
from src.db.users import PublicUser
from src.security.rbac.rbac import authorization_verify_if_user_is_anon
from src.security.rbac.constants import ADMIN_ROLE_ID, ADMIN_OR_MAINTAINER_ROLE_IDS, is_admin_or_maintainer

logger = logging.getLogger(__name__)

# Reserved domains that cannot be used as custom domains
RESERVED_DOMAIN_PATTERNS = [
    r'.*\.learnhouse\.io$',
    r'.*\.learnhouse\.app$',
    r'^learnhouse\.io$',
    r'^learnhouse\.app$',
    r'^localhost$',
    r'^127\.0\.0\.1$',
]

# Learnhouse domain for CNAME instructions
LEARNHOUSE_DOMAIN = os.getenv('LEARNHOUSE_DOMAIN', 'learnhouse.io')


def generate_verification_token() -> str:
    """Generate a secure random verification token."""
    return secrets.token_urlsafe(32)


def is_valid_domain(domain: str) -> bool:
    """Validate domain format."""
    # Domain regex pattern
    pattern = r'^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,}$'
    return bool(re.match(pattern, domain))


def is_reserved_domain(domain: str) -> bool:
    """Check if domain matches any reserved patterns."""
    for pattern in RESERVED_DOMAIN_PATTERNS:
        if re.match(pattern, domain.lower()):
            return True
    return False


def get_verification_instructions(domain: str, token: str, org_slug: str) -> CustomDomainVerificationInfo:
    """Generate DNS verification instructions for a domain."""
    txt_record_host = f"_learnhouse-verification.{domain}"
    txt_record_value = f"learnhouse-verify={token}"
    cname_record_host = domain
    cname_record_value = f"{org_slug}.{LEARNHOUSE_DOMAIN}"

    instructions = f"""
To verify your domain, add the following DNS records at your domain provider:

1. TXT Record (for verification):
   Host: _learnhouse-verification.{domain}
   Value: learnhouse-verify={token}

2. CNAME Record (for routing):
   Host: {domain}
   Value: {org_slug}.{LEARNHOUSE_DOMAIN}

After adding these records, click "Verify" to complete the setup.
DNS propagation may take up to 48 hours, but usually completes within a few minutes.
"""

    return CustomDomainVerificationInfo(
        domain=domain,
        status="pending",
        txt_record_host=txt_record_host,
        txt_record_value=txt_record_value,
        cname_record_host=cname_record_host,
        cname_record_value=cname_record_value,
        instructions=instructions.strip(),
    )


async def verify_domain_dns(domain: CustomDomain, db_session: Session, org_slug: str) -> Tuple[bool, str]:
    """
    Verify DNS configuration for a custom domain.
    Returns (success, message) tuple.
    """
    # Development mode bypass
    if os.getenv('LEARNHOUSE_CUSTOM_DOMAIN_DEV_MODE') == 'true':
        logger.warning(f"DEV MODE: Skipping DNS verification for {domain.domain}")
        domain.status = "verified"
        domain.verified_at = str(datetime.now())
        domain.last_check_at = str(datetime.now())
        domain.check_error = None
        db_session.add(domain)
        db_session.commit()
        return True, "Verified (dev mode)"

    try:
        import dns.resolver

        # Check TXT record
        txt_host = f"_learnhouse-verification.{domain.domain}"
        expected_txt = f"learnhouse-verify={domain.verification_token}"

        try:
            txt_answers = dns.resolver.resolve(txt_host, 'TXT')
            txt_found = False
            for rdata in txt_answers:
                txt_value = str(rdata).strip('"')
                if txt_value == expected_txt:
                    txt_found = True
                    break

            if not txt_found:
                domain.status = "pending"
                domain.last_check_at = str(datetime.now())
                domain.check_error = "TXT record found but value doesn't match"
                db_session.add(domain)
                db_session.commit()
                return False, "TXT record found but value doesn't match expected value"

        except dns.resolver.NXDOMAIN:
            domain.status = "pending"
            domain.last_check_at = str(datetime.now())
            domain.check_error = "TXT record not found"
            db_session.add(domain)
            db_session.commit()
            return False, "TXT record not found. Please add the verification TXT record and try again."
        except dns.resolver.NoAnswer:
            domain.status = "pending"
            domain.last_check_at = str(datetime.now())
            domain.check_error = "TXT record not found (no answer)"
            db_session.add(domain)
            db_session.commit()
            return False, "TXT record not found. Please add the verification TXT record and try again."

        # TXT record verified - mark domain as verified
        domain.status = "verified"
        domain.verified_at = str(datetime.now())
        domain.last_check_at = str(datetime.now())
        domain.check_error = None
        db_session.add(domain)
        db_session.commit()

        return True, "Domain verified successfully"

    except ImportError:
        logger.error("dnspython not installed. Please install it with: pip install dnspython")
        domain.status = "pending"
        domain.last_check_at = str(datetime.now())
        domain.check_error = "DNS verification unavailable"
        db_session.add(domain)
        db_session.commit()
        return False, "DNS verification is temporarily unavailable. Please try again later."
    except Exception as e:
        logger.error(f"DNS verification error for {domain.domain}: {str(e)}")
        domain.status = "pending"
        domain.last_check_at = str(datetime.now())
        domain.check_error = str(e)
        db_session.add(domain)
        db_session.commit()
        return False, f"DNS verification failed: {str(e)}"


async def add_custom_domain(
    request: Request,
    db_session: Session,
    domain_data: CustomDomainCreate,
    org_id: int,
    current_user: PublicUser,
) -> CustomDomainRead:
    """Add a new custom domain for an organization."""
    # VERIFICATION 1: User must be authenticated
    await authorization_verify_if_user_is_anon(current_user.id)

    # VERIFICATION 2: Check if the organization exists
    statement = select(Organization).where(Organization.id == org_id)
    organization = db_session.exec(statement).first()

    if not organization:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    # VERIFICATION 3: Check if user is a member of the organization
    statement = select(UserOrganization).where(
        UserOrganization.user_id == current_user.id,
        UserOrganization.org_id == org_id
    )
    user_org = db_session.exec(statement).first()

    if not user_org:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this organization",
        )

    # VERIFICATION 4: Check if user has admin permissions
    statement = select(Role).where(Role.id == user_org.role_id)
    user_role = db_session.exec(statement).first()

    if not user_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your role in this organization could not be determined",
        )

    # Only admins and maintainers can manage custom domains
    if not is_admin_or_maintainer(user_role.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only organization administrators and maintainers can manage custom domains",
        )

    # VERIFICATION 5: Validate domain format
    domain = domain_data.domain.lower().strip()

    # Remove protocol if present
    if domain.startswith('http://'):
        domain = domain[7:]
    if domain.startswith('https://'):
        domain = domain[8:]

    # Remove trailing slash and path
    domain = domain.split('/')[0]

    if not is_valid_domain(domain):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid domain format. Please enter a valid domain (e.g., learn.mycompany.com)",
        )

    # VERIFICATION 6: Check if domain is reserved
    if is_reserved_domain(domain):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This domain is reserved and cannot be used as a custom domain",
        )

    # VERIFICATION 7: Check if domain is already registered
    statement = select(CustomDomain).where(CustomDomain.domain == domain)
    existing_domain = db_session.exec(statement).first()

    if existing_domain:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This domain is already registered",
        )

    # Create the custom domain
    now = str(datetime.now())
    verification_token = generate_verification_token()

    custom_domain = CustomDomain(
        domain_uuid=f"domain_{uuid4()}",
        domain=domain,
        org_id=org_id,
        status="pending",
        verification_token=verification_token,
        primary=False,
        creation_date=now,
        update_date=now,
    )

    db_session.add(custom_domain)
    db_session.commit()
    db_session.refresh(custom_domain)

    return CustomDomainRead(**custom_domain.model_dump())


async def list_custom_domains(
    request: Request,
    db_session: Session,
    org_id: int,
    current_user: PublicUser,
) -> List[CustomDomainRead]:
    """List all custom domains for an organization."""
    # VERIFICATION 1: User must be authenticated
    await authorization_verify_if_user_is_anon(current_user.id)

    # VERIFICATION 2: Check if the organization exists
    statement = select(Organization).where(Organization.id == org_id)
    organization = db_session.exec(statement).first()

    if not organization:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    # VERIFICATION 3: Check if user is a member of the organization
    statement = select(UserOrganization).where(
        UserOrganization.user_id == current_user.id,
        UserOrganization.org_id == org_id
    )
    user_org = db_session.exec(statement).first()

    if not user_org:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this organization",
        )

    # Get all custom domains for the organization
    statement = select(CustomDomain).where(
        CustomDomain.org_id == org_id
    ).order_by(CustomDomain.creation_date.desc())  # type: ignore

    domains = db_session.exec(statement).all()

    return [CustomDomainRead(**domain.model_dump()) for domain in domains]


async def get_custom_domain(
    request: Request,
    db_session: Session,
    org_id: int,
    domain_uuid: str,
    current_user: PublicUser,
) -> CustomDomainRead:
    """Get a specific custom domain by UUID."""
    # VERIFICATION 1: User must be authenticated
    await authorization_verify_if_user_is_anon(current_user.id)

    # VERIFICATION 2: Check if user is a member of the organization
    statement = select(UserOrganization).where(
        UserOrganization.user_id == current_user.id,
        UserOrganization.org_id == org_id
    )
    user_org = db_session.exec(statement).first()

    if not user_org:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this organization",
        )

    # Get the custom domain
    statement = select(CustomDomain).where(
        CustomDomain.domain_uuid == domain_uuid,
        CustomDomain.org_id == org_id
    )
    domain = db_session.exec(statement).first()

    if not domain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Custom domain not found",
        )

    return CustomDomainRead(**domain.model_dump())


async def get_domain_verification_info(
    request: Request,
    db_session: Session,
    org_id: int,
    domain_uuid: str,
    current_user: PublicUser,
) -> CustomDomainVerificationInfo:
    """Get DNS verification instructions for a custom domain."""
    # VERIFICATION 1: User must be authenticated
    await authorization_verify_if_user_is_anon(current_user.id)

    # VERIFICATION 2: Check if user is a member of the organization
    statement = select(UserOrganization).where(
        UserOrganization.user_id == current_user.id,
        UserOrganization.org_id == org_id
    )
    user_org = db_session.exec(statement).first()

    if not user_org:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this organization",
        )

    # Get the organization for the slug
    statement = select(Organization).where(Organization.id == org_id)
    organization = db_session.exec(statement).first()

    if not organization:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    # Get the custom domain
    statement = select(CustomDomain).where(
        CustomDomain.domain_uuid == domain_uuid,
        CustomDomain.org_id == org_id
    )
    domain = db_session.exec(statement).first()

    if not domain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Custom domain not found",
        )

    info = get_verification_instructions(domain.domain, domain.verification_token, organization.slug)
    info.status = domain.status
    return info


async def verify_custom_domain(
    request: Request,
    db_session: Session,
    org_id: int,
    domain_uuid: str,
    current_user: PublicUser,
) -> dict:
    """Verify DNS configuration for a custom domain."""
    # VERIFICATION 1: User must be authenticated
    await authorization_verify_if_user_is_anon(current_user.id)

    # VERIFICATION 2: Check if user is a member of the organization
    statement = select(UserOrganization).where(
        UserOrganization.user_id == current_user.id,
        UserOrganization.org_id == org_id
    )
    user_org = db_session.exec(statement).first()

    if not user_org:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this organization",
        )

    # VERIFICATION 3: Check admin permission
    statement = select(Role).where(Role.id == user_org.role_id)
    user_role = db_session.exec(statement).first()

    if not user_role or not is_admin_or_maintainer(user_role.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only organization administrators and maintainers can verify custom domains",
        )

    # Get the organization for the slug
    statement = select(Organization).where(Organization.id == org_id)
    organization = db_session.exec(statement).first()

    if not organization:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    # Get the custom domain
    statement = select(CustomDomain).where(
        CustomDomain.domain_uuid == domain_uuid,
        CustomDomain.org_id == org_id
    )
    domain = db_session.exec(statement).first()

    if not domain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Custom domain not found",
        )

    # Verify DNS
    success, message = await verify_domain_dns(domain, db_session, organization.slug)

    if success:
        return {"success": True, "message": message, "status": domain.status}
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message,
        )


async def delete_custom_domain(
    request: Request,
    db_session: Session,
    org_id: int,
    domain_uuid: str,
    current_user: PublicUser,
) -> dict:
    """Delete a custom domain."""
    # VERIFICATION 1: User must be authenticated
    await authorization_verify_if_user_is_anon(current_user.id)

    # VERIFICATION 2: Check if user is a member of the organization
    statement = select(UserOrganization).where(
        UserOrganization.user_id == current_user.id,
        UserOrganization.org_id == org_id
    )
    user_org = db_session.exec(statement).first()

    if not user_org:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this organization",
        )

    # VERIFICATION 3: Check admin permission
    statement = select(Role).where(Role.id == user_org.role_id)
    user_role = db_session.exec(statement).first()

    if not user_role or not is_admin_or_maintainer(user_role.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only organization administrators and maintainers can delete custom domains",
        )

    # Get the custom domain
    statement = select(CustomDomain).where(
        CustomDomain.domain_uuid == domain_uuid,
        CustomDomain.org_id == org_id
    )
    domain = db_session.exec(statement).first()

    if not domain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Custom domain not found",
        )

    # Delete the domain
    db_session.delete(domain)
    db_session.commit()

    return {"message": "Custom domain deleted successfully"}


async def resolve_org_by_domain(
    db_session: Session,
    domain: str,
) -> Optional[CustomDomainResolveResponse]:
    """
    Resolve an organization by custom domain.
    This is a public endpoint that doesn't require authentication.
    """
    # Normalize domain
    domain = domain.lower().strip()

    # Get the custom domain
    statement = select(CustomDomain).where(
        CustomDomain.domain == domain,
        CustomDomain.status == "verified"
    )
    custom_domain = db_session.exec(statement).first()

    if not custom_domain:
        return None

    # Get the organization
    statement = select(Organization).where(Organization.id == custom_domain.org_id)
    organization = db_session.exec(statement).first()

    if not organization:
        return None

    return CustomDomainResolveResponse(
        org_id=organization.id,
        org_slug=organization.slug,
        org_uuid=organization.org_uuid,
    )
