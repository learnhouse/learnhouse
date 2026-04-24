import secrets
from typing import List, Optional
from uuid import uuid4
from datetime import datetime, timedelta, timezone
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from fastapi import HTTPException, Request, status

from src.db.api_tokens import (
    APIToken,
    APITokenCreate,
    APITokenCreatedResponse,
    APITokenRead,
    APITokenUpdate,
)
from src.db.organizations import Organization
from src.db.users import PublicUser, AnonymousUser, APITokenUser
from src.db.roles import Rights
from src.security.rbac.rbac import (
    authorization_verify_if_user_is_anon,
)
from src.security.org_auth import (
    require_org_membership,
    require_org_role_permission,
    get_user_org_role,
)
from src.security.security import (
    security_hash_token,
    security_token_needs_rehash,
    security_verify_token,
)


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
    random_part = secrets.token_urlsafe(TOKEN_BYTES)
    full_token = f"{TOKEN_PREFIX}{random_part}"
    token_prefix = full_token[:12]
    token_hash = security_hash_token(full_token)
    return full_token, token_prefix, token_hash


def hash_token(token: str) -> str:
    return security_hash_token(token)


def _block_api_tokens(current_user) -> None:
    """Block API tokens from managing other API tokens.

    SECURITY: Allowing a token to create / read / update / revoke other tokens
    is a privilege-escalation surface — a low-rights token could spawn a
    higher-rights one, or revoke the admin's active token. Token management
    is a human/admin action and must stay behind user authentication.
    """
    if isinstance(current_user, APITokenUser):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API tokens cannot manage other API tokens. Use user authentication.",
        )


def verify_token(provided_token: str, stored_hash: str) -> bool:
    """
    Verify a token against its stored hash using timing-safe comparison.

    Args:
        provided_token: The token provided in the request
        stored_hash: The hash stored in the database

    Returns:
        bool: True if the token is valid
    """
    return security_verify_token(provided_token, stored_hash)


async def create_api_token(
    request: Request,
    db_session: AsyncSession,
    token_data: APITokenCreate,
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
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
    _block_api_tokens(current_user)
    # VERIFICATION 1: User must be authenticated
    await authorization_verify_if_user_is_anon(current_user.id)

    # VERIFICATION 2: Check if the organization exists
    statement = select(Organization).where(Organization.id == org_id)
    organization = (await db_session.execute(statement)).scalars().first()

    if not organization:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    # VERIFICATION 3+4: Membership + permission (superadmins bypass)
    await require_org_role_permission(current_user.id, org_id, db_session, "roles", "action_create")

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
    existing_token = (await db_session.execute(statement)).scalars().first()

    if existing_token:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"An active API token with the name '{token_data.name}' already exists in this organization",
        )

    # VERIFICATION 7: Validate rights structure if provided
    if token_data.rights:
        user_role = await get_user_org_role(current_user.id, org_id, db_session)
        user_rights = user_role.rights if user_role else None
        await validate_rights_structure(token_data.rights, user_rights)

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
    await db_session.commit()
    await db_session.refresh(api_token)

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
    db_session: AsyncSession,
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> List[APITokenRead]:
    """List all API tokens for an organization."""
    _block_api_tokens(current_user)
    # VERIFICATION 1: User must be authenticated
    await authorization_verify_if_user_is_anon(current_user.id)

    # VERIFICATION 2: Check if the organization exists
    statement = select(Organization).where(Organization.id == org_id)
    organization = (await db_session.execute(statement)).scalars().first()

    if not organization:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    # VERIFICATION 3+4: Membership + permission (superadmins bypass)
    await require_org_role_permission(current_user.id, org_id, db_session, "roles", "action_read")

    # Get all tokens for the organization
    statement = select(APIToken).where(
        APIToken.org_id == org_id
    ).order_by(APIToken.creation_date.desc())  # type: ignore

    tokens = (await db_session.execute(statement)).scalars().all()

    return [APITokenRead(**token.model_dump()) for token in tokens]


async def get_api_token(
    request: Request,
    db_session: AsyncSession,
    org_id: int,
    token_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> APITokenRead:
    """Get a specific API token by UUID."""
    _block_api_tokens(current_user)
    # VERIFICATION 1: User must be authenticated
    await authorization_verify_if_user_is_anon(current_user.id)

    # VERIFICATION 2: Membership (superadmins bypass)
    await require_org_membership(current_user.id, org_id, db_session)

    # VERIFICATION 3: Get the token
    statement = select(APIToken).where(
        APIToken.token_uuid == token_uuid,
        APIToken.org_id == org_id
    )
    token = (await db_session.execute(statement)).scalars().first()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API token not found",
        )

    return APITokenRead(**token.model_dump())


async def update_api_token(
    request: Request,
    db_session: AsyncSession,
    org_id: int,
    token_uuid: str,
    token_data: APITokenUpdate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> APITokenRead:
    """Update an API token."""
    _block_api_tokens(current_user)
    # VERIFICATION 1: User must be authenticated
    await authorization_verify_if_user_is_anon(current_user.id)

    # VERIFICATION 2+3: Membership + permission (superadmins bypass)
    await require_org_role_permission(current_user.id, org_id, db_session, "roles", "action_update")

    # VERIFICATION 4: Get the token
    statement = select(APIToken).where(
        APIToken.token_uuid == token_uuid,
        APIToken.org_id == org_id
    )
    token = (await db_session.execute(statement)).scalars().first()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API token not found",
        )

    # VERIFICATION 5: Validate rights if being updated
    if token_data.rights:
        user_role = await get_user_org_role(current_user.id, org_id, db_session)
        user_rights = user_role.rights if user_role else None
        await validate_rights_structure(token_data.rights, user_rights)

    # Update fields
    update_data = token_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if value is not None:
            if key == "rights" and isinstance(value, Rights):
                value = value.model_dump()
            setattr(token, key, value)

    token.update_date = str(datetime.now())

    db_session.add(token)
    await db_session.commit()
    await db_session.refresh(token)

    return APITokenRead(**token.model_dump())


async def revoke_api_token(
    request: Request,
    db_session: AsyncSession,
    org_id: int,
    token_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> dict:
    """Revoke (soft delete) an API token."""
    _block_api_tokens(current_user)
    # VERIFICATION 1: User must be authenticated
    await authorization_verify_if_user_is_anon(current_user.id)

    # VERIFICATION 2+3: Membership + permission (superadmins bypass)
    await require_org_role_permission(current_user.id, org_id, db_session, "roles", "action_delete")

    # VERIFICATION 4: Get the token
    statement = select(APIToken).where(
        APIToken.token_uuid == token_uuid,
        APIToken.org_id == org_id
    )
    token = (await db_session.execute(statement)).scalars().first()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API token not found",
        )

    # Revoke the token
    token.is_active = False
    token.update_date = str(datetime.now())

    db_session.add(token)
    await db_session.commit()

    return {"message": "API token revoked successfully"}


async def regenerate_api_token(
    request: Request,
    db_session: AsyncSession,
    org_id: int,
    token_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> APITokenCreatedResponse:
    """
    Regenerate the secret for an API token.
    The old token will no longer work.
    """
    _block_api_tokens(current_user)
    # VERIFICATION 1: User must be authenticated
    await authorization_verify_if_user_is_anon(current_user.id)

    # VERIFICATION 2+3: Membership + permission (superadmins bypass)
    await require_org_role_permission(current_user.id, org_id, db_session, "roles", "action_update")

    # VERIFICATION 4: Get the token
    statement = select(APIToken).where(
        APIToken.token_uuid == token_uuid,
        APIToken.org_id == org_id
    )
    token = (await db_session.execute(statement)).scalars().first()

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
    await db_session.commit()
    await db_session.refresh(token)

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
    db_session: AsyncSession,
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
    if not token.startswith(TOKEN_PREFIX):
        return None

    statement = select(APIToken).where(
        APIToken.token_prefix == token[:12],
        APIToken.is_active == True,  # noqa: E712
    )
    candidates = (await db_session.execute(statement)).scalars().all()
    api_token = next(
        (t for t in candidates if security_verify_token(token, t.token_hash)),
        None,
    )

    if not api_token:
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

    # Update last_used_at and opportunistically upgrade legacy hashes.
    try:
        api_token.last_used_at = str(datetime.now())
        if security_token_needs_rehash(api_token.token_hash):
            api_token.token_hash = security_hash_token(token)
        db_session.add(api_token)
        await db_session.commit()
        await db_session.refresh(api_token)
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


# Atlas session tokens: minted on demand for the in-product agent, scoped to
# the acting user's org, ~15min TTL. Shape-identical to regular API tokens so
# the MCP server needs no special-case logic.

ATLAS_SESSION_TOKEN_NAME_PREFIX = "__atlas_session__"
ATLAS_SESSION_TTL_MINUTES = 15


# Full-access rights, used only when the acting user is a superadmin (who
# otherwise has no org role row to copy rights from).
_ATLAS_SUPERADMIN_RIGHTS: dict = {
    "courses": {
        "action_create": True,
        "action_read": True,
        "action_read_own": True,
        "action_update": True,
        "action_update_own": True,
        "action_delete": True,
        "action_delete_own": True,
    },
    "users": {"action_create": True, "action_read": True, "action_update": True, "action_delete": True},
    "usergroups": {"action_create": True, "action_read": True, "action_update": True, "action_delete": True},
    "collections": {"action_create": True, "action_read": True, "action_update": True, "action_delete": True},
    "organizations": {"action_create": True, "action_read": True, "action_update": True, "action_delete": True},
    "coursechapters": {"action_create": True, "action_read": True, "action_update": True, "action_delete": True},
    "activities": {"action_create": True, "action_read": True, "action_update": True, "action_delete": True},
    "roles": {"action_create": True, "action_read": True, "action_update": True, "action_delete": True},
    "dashboard": {"action_access": True},
    "communities": {"action_create": True, "action_read": True, "action_update": True, "action_delete": True},
    "discussions": {
        "action_create": True, "action_read": True, "action_read_own": True,
        "action_update": True, "action_update_own": True,
        "action_delete": True, "action_delete_own": True,
    },
    "podcasts": {
        "action_create": True, "action_read": True, "action_read_own": True,
        "action_update": True, "action_update_own": True,
        "action_delete": True, "action_delete_own": True,
    },
    "boards": {
        "action_create": True, "action_read": True, "action_read_own": True,
        "action_update": True, "action_update_own": True,
        "action_delete": True, "action_delete_own": True,
    },
    "playgrounds": {
        "action_create": True, "action_read": True, "action_read_own": True,
        "action_update": True, "action_update_own": True,
        "action_delete": True, "action_delete_own": True,
    },
}


async def _resolve_atlas_rights(db_session: AsyncSession, user_id: int, org_id: int) -> dict:
    """Copy the acting user's org-role rights onto the Atlas token so the
    token behaves exactly like the user. Superadmins get a full-access dict
    (they don't have an org role row to copy from)."""
    from src.security.org_auth import get_user_org_role
    from src.security.superadmin import is_user_superadmin

    if await is_user_superadmin(user_id, db_session):
        return dict(_ATLAS_SUPERADMIN_RIGHTS)

    role = await get_user_org_role(user_id, org_id, db_session)
    if role is None or not role.rights:
        # User exists in the org but has no role rights. This shouldn't happen
        # for a user who can open the Atlas page (they passed org-membership),
        # but if it does, fall back to read-only rights so the agent can at
        # least list things — writes will 403 cleanly at the RBAC layer.
        return {
            "courses": {"action_read": True, "action_read_own": True},
            "coursechapters": {"action_read": True},
            "activities": {"action_read": True},
            "collections": {"action_read": True},
            "podcasts": {"action_read": True, "action_read_own": True},
            "communities": {"action_read": True},
            "discussions": {"action_read": True, "action_read_own": True},
            "boards": {"action_read": True, "action_read_own": True},
            "playgrounds": {"action_read": True, "action_read_own": True},
            "dashboard": {"action_access": True},
        }

    rights = role.rights
    if hasattr(rights, "model_dump"):
        return rights.model_dump()
    return dict(rights)


async def create_atlas_session_token(
    db_session: AsyncSession,
    user_id: int,
    org_id: int,
    ttl_minutes: int = ATLAS_SESSION_TTL_MINUTES,
) -> tuple[str, APIToken]:
    full_token, token_prefix, token_hash = generate_api_token()

    now_dt = datetime.now(timezone.utc)
    expires_at_dt = now_dt + timedelta(minutes=ttl_minutes)
    now = now_dt.isoformat()
    expires_at = expires_at_dt.isoformat()

    rights = await _resolve_atlas_rights(db_session, user_id, org_id)

    api_token = APIToken(
        token_uuid=f"apitoken_{uuid4()}",
        # Name suffix avoids the unique-active-name-per-org constraint when a
        # user has overlapping Atlas sessions.
        name=f"{ATLAS_SESSION_TOKEN_NAME_PREFIX}:{uuid4().hex[:12]}",
        description="Short-lived token minted for the Atlas dashboard agent.",
        token_prefix=token_prefix,
        token_hash=token_hash,
        org_id=org_id,
        rights=rights,
        created_by_user_id=user_id,
        creation_date=now,
        update_date=now,
        expires_at=expires_at,
        is_active=True,
    )

    db_session.add(api_token)
    await db_session.commit()
    await db_session.refresh(api_token)

    return full_token, api_token


async def revoke_atlas_session_token(
    db_session: AsyncSession,
    token_uuid: str,
    user_id: int,
) -> bool:
    statement = select(APIToken).where(
        APIToken.token_uuid == token_uuid,
        APIToken.created_by_user_id == user_id,
        APIToken.is_active == True,
    )
    token = (await db_session.execute(statement)).scalars().first()
    if not token:
        return False
    token.is_active = False
    token.update_date = datetime.now(timezone.utc).isoformat()
    db_session.add(token)
    await db_session.commit()
    return True
