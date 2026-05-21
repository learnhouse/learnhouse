"""Service module for cross-org superadmin API tokens.

This is deliberately separate from ``src.services.api_tokens.api_tokens`` —
the org-scoped service is entangled with org_id, Rights, and per-org RBAC
checks. Sharing helpers would leak superadmin concepts into the org service
and vice versa, so the two stay parallel.
"""

import hashlib
import secrets
from datetime import datetime
from typing import List, Optional
from uuid import uuid4

from fastapi import HTTPException, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.superadmin_api_tokens import (
    SuperadminAPIToken,
    SuperadminAPITokenCreate,
    SuperadminAPITokenCreatedResponse,
    SuperadminAPITokenRead,
    SuperadminAPITokenUpdate,
)


TOKEN_PREFIX = "lh_sa_"
TOKEN_BYTES = 32  # 256 bits of entropy


def generate_token() -> tuple[str, str, str]:
    """Generate a new superadmin API token.

    Returns:
        (full_token, token_prefix, token_hash)
        - full_token: complete token, only returned to the user once on creation
        - token_prefix: first 15 chars for display (``lh_sa_xxxxxxxxx``)
        - token_hash: SHA-256 hex for storage and lookup
    """
    random_part = secrets.token_urlsafe(TOKEN_BYTES)
    full_token = f"{TOKEN_PREFIX}{random_part}"
    token_prefix = full_token[:15]
    token_hash = hashlib.sha256(full_token.encode()).hexdigest()
    return full_token, token_prefix, token_hash


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def verify_token(provided_token: str, stored_hash: str) -> bool:
    """Timing-safe comparison of a provided token against a stored hash."""
    return secrets.compare_digest(hash_token(provided_token), stored_hash)


async def create_superadmin_token(
    db_session: AsyncSession,
    token_data: SuperadminAPITokenCreate,
    created_by_user_id: int,
) -> SuperadminAPITokenCreatedResponse:
    """Mint a new superadmin token. Returns the plaintext token (only place it appears)."""
    name = (token_data.name or "").strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token name is required and cannot be empty",
        )
    if len(name) > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token name cannot exceed 100 characters",
        )

    # Duplicate-active-name check scoped to the minting user. Different
    # superadmins can use the same name without colliding.
    existing = (await db_session.execute(
        select(SuperadminAPIToken).where(
            SuperadminAPIToken.name == name,
            SuperadminAPIToken.created_by_user_id == created_by_user_id,
            SuperadminAPIToken.is_active == True,  # noqa: E712
        )
    )).scalars().first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"An active superadmin API token named '{name}' already exists for this user",
        )

    full_token, token_prefix, token_hash = generate_token()
    now = str(datetime.now())
    token = SuperadminAPIToken(
        token_uuid=f"satoken_{uuid4()}",
        name=name,
        description=token_data.description,
        token_prefix=token_prefix,
        token_hash=token_hash,
        created_by_user_id=created_by_user_id,
        creation_date=now,
        update_date=now,
        expires_at=token_data.expires_at,
        is_active=True,
    )
    db_session.add(token)
    await db_session.commit()
    await db_session.refresh(token)

    return SuperadminAPITokenCreatedResponse(
        token=full_token,
        token_uuid=token.token_uuid,
        name=token.name,
        description=token.description,
        token_prefix=token.token_prefix,
        created_by_user_id=token.created_by_user_id,
        creation_date=token.creation_date,
        expires_at=token.expires_at,
    )


async def list_superadmin_tokens(db_session: AsyncSession) -> List[SuperadminAPITokenRead]:
    """List all superadmin tokens platform-wide (every superadmin is a peer)."""
    statement = select(SuperadminAPIToken).order_by(SuperadminAPIToken.creation_date.desc())  # type: ignore
    tokens = (await db_session.execute(statement)).scalars().all()
    return [SuperadminAPITokenRead(**t.model_dump()) for t in tokens]


async def get_superadmin_token(
    db_session: AsyncSession,
    token_uuid: str,
) -> SuperadminAPITokenRead:
    token = (await db_session.execute(
        select(SuperadminAPIToken).where(SuperadminAPIToken.token_uuid == token_uuid)
    )).scalars().first()
    if not token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Superadmin API token not found")
    return SuperadminAPITokenRead(**token.model_dump())


async def update_superadmin_token(
    db_session: AsyncSession,
    token_uuid: str,
    token_data: SuperadminAPITokenUpdate,
) -> SuperadminAPITokenRead:
    token = (await db_session.execute(
        select(SuperadminAPIToken).where(SuperadminAPIToken.token_uuid == token_uuid)
    )).scalars().first()
    if not token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Superadmin API token not found")

    update_data = token_data.model_dump(exclude_unset=True)
    if "name" in update_data and update_data["name"] is not None:
        new_name = update_data["name"].strip()
        if not new_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Token name cannot be empty",
            )
        if len(new_name) > 100:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Token name cannot exceed 100 characters",
            )
        update_data["name"] = new_name

    for key, value in update_data.items():
        if value is not None:
            setattr(token, key, value)

    token.update_date = str(datetime.now())
    db_session.add(token)
    await db_session.commit()
    await db_session.refresh(token)
    return SuperadminAPITokenRead(**token.model_dump())


async def revoke_superadmin_token(
    db_session: AsyncSession,
    token_uuid: str,
) -> dict:
    """Soft-revoke (is_active=False). Matches the existing org-token pattern."""
    token = (await db_session.execute(
        select(SuperadminAPIToken).where(SuperadminAPIToken.token_uuid == token_uuid)
    )).scalars().first()
    if not token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Superadmin API token not found")
    token.is_active = False
    token.update_date = str(datetime.now())
    db_session.add(token)
    await db_session.commit()
    return {"message": "Superadmin API token revoked successfully"}


async def validate_superadmin_token_for_auth(
    token: str,
    db_session: AsyncSession,
) -> Optional[SuperadminAPIToken]:
    """Validate a presented token. Updates last_used_at on success. Returns None on any failure."""
    if not token.startswith(TOKEN_PREFIX):
        return None

    token_hash = hash_token(token)
    api_token = (await db_session.execute(
        select(SuperadminAPIToken).where(SuperadminAPIToken.token_hash == token_hash)
    )).scalars().first()

    if not api_token:
        return None
    if not api_token.is_active:
        return None

    if api_token.expires_at:
        try:
            expires_at = datetime.fromisoformat(api_token.expires_at.replace('Z', '+00:00'))
            now = datetime.now(expires_at.tzinfo)
            if now > expires_at:
                return None
        except (ValueError, TypeError):
            # Unparseable expiry — fail safe by treating as not expired (matches org-token behavior)
            pass

    try:
        api_token.last_used_at = str(datetime.now())
        db_session.add(api_token)
        await db_session.commit()
        await db_session.refresh(api_token)
    except Exception:
        # Don't fail auth just because last_used_at didn't update
        pass

    return api_token
