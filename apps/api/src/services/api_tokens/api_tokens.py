import secrets
import hashlib
from typing import List, Optional
from uuid import uuid4
from datetime import datetime
from sqlmodel import Session, select
from fastapi import HTTPException, Request, status

from src.db.api_tokens import (
    APIToken,
    APITokenCreate,
    APITokenCreatedResponse,
    APITokenRead,
    APITokenUpdate,
)
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.roles import Role, Rights
from src.db.users import PublicUser
from src.security.rbac.rbac import (
    authorization_verify_if_user_is_anon,
)
from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS


# Token generation constants
TOKEN_PREFIX = "lh_"
TOKEN_BYTES = 32  # 256 bits of entropy


def generate_api_token() -> tuple[str, str, str]:
    """
    Generate a new API token.

    Returns:
        tuple: (full_token, token_prefix, token_hash)
        - full_token: The complete token to return to the user (only shown once!)
        - token_prefix: First 12 characters of the token for display
        - token_hash: SHA-256 hash of the token for storage
    """
    # Generate cryptographically secure random bytes
    random_part = secrets.token_urlsafe(TOKEN_BYTES)
    full_token = f"{TOKEN_PREFIX}{random_part}"

    # Create prefix (first 12 chars including lh_)
    token_prefix = full_token[:12]

    # Create SHA-256 hash for storage
    token_hash = hashlib.sha256(full_token.encode()).hexdigest()

    return full_token, token_prefix, token_hash


def hash_token(token: str) -> str:
    """Hash a token for comparison."""
    return hashlib.sha256(token.encode()).hexdigest()


def verify_token(provided_token: str, stored_hash: str) -> bool:
    """
    Verify a token against its stored hash using timing-safe comparison.

    Args:
        provided_token: The token provided in the request
        stored_hash: The hash stored in the database

    Returns:
        bool: True if the token is valid
    """
    provided_hash = hash_token(provided_token)
    return secrets.compare_digest(provided_hash, stored_hash)


async def create_api_token(
    request: Request,
    db_session: Session,
    token_data: APITokenCreate,
    org_id: int,
    current_user: PublicUser,
) -> APITokenCreatedResponse:
    """
    Create a new API token for an organization.

    Args:
        request: FastAPI request object
        db_session: Database session
        token_data: Token creation data
        org_id: Organization ID
        current_user: The authenticated user creating the token

    Returns:
        APITokenCreatedResponse: The created token with the full token value (only time it's shown!)
    """
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

    # VERIFICATION 4: Check if user has permission to create API tokens (via roles permission)
    statement = select(Role).where(Role.id == user_org.role_id)
    user_role = db_session.exec(statement).first()

    if not user_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your role in this organization could not be determined",
        )

    # Check if user has role creation/management permissions (using roles as proxy for token management)
    if user_role.rights and isinstance(user_role.rights, dict):
        roles_rights = user_role.rights.get('roles', {})
        if not roles_rights.get('action_create', False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to create API tokens in this organization",
            )
    else:
        # If no rights are defined, check if user has admin role (role_id 1 or 2)
        if user_role.id not in ADMIN_OR_MAINTAINER_ROLE_IDS:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to create API tokens. Admin or Maintainer role required.",
            )

    # VERIFICATION 5: Validate token name
    if not token_data.name or token_data.name.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token name is required and cannot be empty",
        )

    if len(token_data.name.strip()) > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token name cannot exceed 100 characters",
        )

    # VERIFICATION 6: Check for duplicate token name in organization
    statement = select(APIToken).where(
        APIToken.name == token_data.name.strip(),
        APIToken.org_id == org_id,
        APIToken.is_active == True
    )
    existing_token = db_session.exec(statement).first()

    if existing_token:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"An active API token with the name '{token_data.name}' already exists in this organization",
        )

    # VERIFICATION 7: Validate rights structure if provided
    if token_data.rights:
        await validate_rights_structure(token_data.rights, user_role.rights)

    # Generate the token
    full_token, token_prefix, token_hash = generate_api_token()

    # Create the token record
    now = str(datetime.now())
    api_token = APIToken(
        token_uuid=f"apitoken_{uuid4()}",
        name=token_data.name.strip(),
        description=token_data.description,
        token_prefix=token_prefix,
        token_hash=token_hash,
        org_id=org_id,
        rights=token_data.rights.model_dump() if isinstance(token_data.rights, Rights) else token_data.rights,
        created_by_user_id=current_user.id,
        creation_date=now,
        update_date=now,
        expires_at=token_data.expires_at,
        is_active=True,
    )

    db_session.add(api_token)
    db_session.commit()
    db_session.refresh(api_token)

    # Return the created response with the full token (only time it's shown!)
    return APITokenCreatedResponse(
        token=full_token,
        token_uuid=api_token.token_uuid,
        name=api_token.name,
        description=api_token.description,
        token_prefix=api_token.token_prefix,
        org_id=api_token.org_id,
        rights=api_token.rights,
        created_by_user_id=api_token.created_by_user_id,
        creation_date=api_token.creation_date,
        expires_at=api_token.expires_at,
    )


async def list_api_tokens(
    request: Request,
    db_session: Session,
    org_id: int,
    current_user: PublicUser,
) -> List[APITokenRead]:
    """List all API tokens for an organization."""
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

    # VERIFICATION 4: Check permissions
    statement = select(Role).where(Role.id == user_org.role_id)
    user_role = db_session.exec(statement).first()

    if not user_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your role in this organization could not be determined",
        )

    # Check if user has role reading permissions
    if user_role.rights and isinstance(user_role.rights, dict):
        roles_rights = user_role.rights.get('roles', {})
        if not roles_rights.get('action_read', False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to view API tokens in this organization",
            )
    else:
        if user_role.id not in ADMIN_OR_MAINTAINER_ROLE_IDS:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to view API tokens. Admin or Maintainer role required.",
            )

    # Get all tokens for the organization
    statement = select(APIToken).where(
        APIToken.org_id == org_id
    ).order_by(APIToken.creation_date.desc())  # type: ignore

    tokens = db_session.exec(statement).all()

    return [APITokenRead(**token.model_dump()) for token in tokens]


async def get_api_token(
    request: Request,
    db_session: Session,
    org_id: int,
    token_uuid: str,
    current_user: PublicUser,
) -> APITokenRead:
    """Get a specific API token by UUID."""
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

    # VERIFICATION 3: Get the token
    statement = select(APIToken).where(
        APIToken.token_uuid == token_uuid,
        APIToken.org_id == org_id
    )
    token = db_session.exec(statement).first()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API token not found",
        )

    return APITokenRead(**token.model_dump())


async def update_api_token(
    request: Request,
    db_session: Session,
    org_id: int,
    token_uuid: str,
    token_data: APITokenUpdate,
    current_user: PublicUser,
) -> APITokenRead:
    """Update an API token."""
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

    # VERIFICATION 3: Check permissions
    statement = select(Role).where(Role.id == user_org.role_id)
    user_role = db_session.exec(statement).first()

    if not user_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your role in this organization could not be determined",
        )

    if user_role.rights and isinstance(user_role.rights, dict):
        roles_rights = user_role.rights.get('roles', {})
        if not roles_rights.get('action_update', False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to update API tokens in this organization",
            )
    else:
        if user_role.id not in ADMIN_OR_MAINTAINER_ROLE_IDS:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to update API tokens. Admin or Maintainer role required.",
            )

    # VERIFICATION 4: Get the token
    statement = select(APIToken).where(
        APIToken.token_uuid == token_uuid,
        APIToken.org_id == org_id
    )
    token = db_session.exec(statement).first()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API token not found",
        )

    # VERIFICATION 5: Validate rights if being updated
    if token_data.rights:
        await validate_rights_structure(token_data.rights, user_role.rights)

    # Update fields
    update_data = token_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if value is not None:
            if key == "rights" and isinstance(value, Rights):
                value = value.model_dump()
            setattr(token, key, value)

    token.update_date = str(datetime.now())

    db_session.add(token)
    db_session.commit()
    db_session.refresh(token)

    return APITokenRead(**token.model_dump())


async def revoke_api_token(
    request: Request,
    db_session: Session,
    org_id: int,
    token_uuid: str,
    current_user: PublicUser,
) -> dict:
    """Revoke (soft delete) an API token."""
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

    # VERIFICATION 3: Check permissions
    statement = select(Role).where(Role.id == user_org.role_id)
    user_role = db_session.exec(statement).first()

    if not user_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your role in this organization could not be determined",
        )

    if user_role.rights and isinstance(user_role.rights, dict):
        roles_rights = user_role.rights.get('roles', {})
        if not roles_rights.get('action_delete', False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to revoke API tokens in this organization",
            )
    else:
        if user_role.id not in ADMIN_OR_MAINTAINER_ROLE_IDS:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to revoke API tokens. Admin or Maintainer role required.",
            )

    # VERIFICATION 4: Get the token
    statement = select(APIToken).where(
        APIToken.token_uuid == token_uuid,
        APIToken.org_id == org_id
    )
    token = db_session.exec(statement).first()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API token not found",
        )

    # Revoke the token
    token.is_active = False
    token.update_date = str(datetime.now())

    db_session.add(token)
    db_session.commit()

    return {"message": "API token revoked successfully"}


async def regenerate_api_token(
    request: Request,
    db_session: Session,
    org_id: int,
    token_uuid: str,
    current_user: PublicUser,
) -> APITokenCreatedResponse:
    """
    Regenerate the secret for an API token.
    The old token will no longer work.
    """
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

    # VERIFICATION 3: Check permissions
    statement = select(Role).where(Role.id == user_org.role_id)
    user_role = db_session.exec(statement).first()

    if not user_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your role in this organization could not be determined",
        )

    if user_role.rights and isinstance(user_role.rights, dict):
        roles_rights = user_role.rights.get('roles', {})
        if not roles_rights.get('action_update', False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to regenerate API tokens in this organization",
            )
    else:
        if user_role.id not in ADMIN_OR_MAINTAINER_ROLE_IDS:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to regenerate API tokens. Admin or Maintainer role required.",
            )

    # VERIFICATION 4: Get the token
    statement = select(APIToken).where(
        APIToken.token_uuid == token_uuid,
        APIToken.org_id == org_id
    )
    token = db_session.exec(statement).first()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API token not found",
        )

    if not token.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot regenerate a revoked token",
        )

    # Generate new token secret
    full_token, token_prefix, token_hash = generate_api_token()

    # Update the token
    token.token_prefix = token_prefix
    token.token_hash = token_hash
    token.update_date = str(datetime.now())

    db_session.add(token)
    db_session.commit()
    db_session.refresh(token)

    # Return with the new full token
    return APITokenCreatedResponse(
        token=full_token,
        token_uuid=token.token_uuid,
        name=token.name,
        description=token.description,
        token_prefix=token.token_prefix,
        org_id=token.org_id,
        rights=token.rights,
        created_by_user_id=token.created_by_user_id,
        creation_date=token.creation_date,
        expires_at=token.expires_at,
    )


async def validate_api_token_for_auth(
    token: str,
    db_session: Session,
) -> Optional[APIToken]:
    """
    Validate an API token for authentication purposes.
    Updates last_used_at on successful validation.

    Args:
        token: The full token string (lh_...)
        db_session: Database session

    Returns:
        APIToken if valid, None otherwise
    """
    # Check token format
    if not token.startswith(TOKEN_PREFIX):
        return None

    # Hash the token for lookup
    token_hash = hash_token(token)

    # Find the token in the database
    statement = select(APIToken).where(APIToken.token_hash == token_hash)
    api_token = db_session.exec(statement).first()

    if not api_token:
        return None

    # Check if token is active
    if not api_token.is_active:
        return None

    # Check if token is expired
    if api_token.expires_at:
        try:
            expires_at = datetime.fromisoformat(api_token.expires_at.replace('Z', '+00:00'))
            now = datetime.now(expires_at.tzinfo)
            if now > expires_at:
                return None
        except (ValueError, TypeError):
            # If we can't parse the date, consider it not expired
            pass

    # Update last_used_at
    try:
        api_token.last_used_at = str(datetime.now())
        db_session.add(api_token)
        db_session.commit()
        db_session.refresh(api_token)
    except Exception:
        # Don't fail validation just because we couldn't update last_used_at
        pass

    return api_token


async def validate_rights_structure(
    rights: Optional[Rights | dict],
    user_rights: Optional[Rights | dict],
) -> None:
    """
    Validate the rights structure and ensure token rights don't exceed user rights.

    Args:
        rights: The rights to validate
        user_rights: The creating user's rights
    """
    if not rights:
        return

    # Convert to dict if needed
    if isinstance(rights, Rights):
        rights_dict = rights.model_dump()
    else:
        rights_dict = rights

    # Validate required keys - API tokens are restricted to specific resources
    required_rights = [
        'courses', 'activities', 'coursechapters', 'collections',
        'certifications', 'usergroups', 'payments', 'search'
    ]

    for required_right in required_rights:
        if required_right not in rights_dict:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Missing required right: {required_right}",
            )

        right_data = rights_dict[required_right]
        if not isinstance(right_data, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Right '{required_right}' must be a JSON object",
            )

    # Check that token rights don't exceed user rights
    if user_rights:
        user_rights_dict = user_rights.model_dump() if isinstance(user_rights, Rights) else user_rights

        for right_key, right_permissions in rights_dict.items():
            if right_key in user_rights_dict:
                user_right_permissions = user_rights_dict[right_key]

                for perm_key, perm_value in right_permissions.items():
                    if isinstance(perm_value, bool) and perm_value:
                        if isinstance(user_right_permissions, dict) and perm_key in user_right_permissions:
                            user_has_perm = user_right_permissions[perm_key]
                            if not user_has_perm:
                                raise HTTPException(
                                    status_code=status.HTTP_403_FORBIDDEN,
                                    detail=f"Cannot grant '{perm_key}' permission for '{right_key}' as you don't have this permission yourself",
                                )
