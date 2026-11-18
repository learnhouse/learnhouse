"""Cross-org Backoffice API tokens: minting helpers and sign-in validation.

Creating, listing, updating and revoking tokens is a LearnHouse Backoffice
action and lives in EE (``ee/services/platform/token_store.py``). Core keeps
what authentication needs, so a token keeps resolving to its principal.
"""

import secrets
from datetime import datetime
from typing import Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.backoffice_api_tokens import BackofficeAPIToken
from src.security.security import (
    security_hash_token,
    security_token_needs_rehash,
    security_verify_token,
)


TOKEN_PREFIX = "lh_sa_"
TOKEN_BYTES = 32  # 256 bits of entropy


def generate_token() -> tuple[str, str, str]:
    random_part = secrets.token_urlsafe(TOKEN_BYTES)
    full_token = f"{TOKEN_PREFIX}{random_part}"
    token_prefix = full_token[:15]
    token_hash = security_hash_token(full_token)
    return full_token, token_prefix, token_hash


def hash_token(token: str) -> str:
    return security_hash_token(token)


def verify_token(provided_token: str, stored_hash: str) -> bool:
    return security_verify_token(provided_token, stored_hash)


async def validate_backoffice_token_for_auth(
    token: str,
    db_session: AsyncSession,
) -> Optional[BackofficeAPIToken]:
    """Validate a presented token. Updates last_used_at on success. Returns None on any failure."""
    if not token.startswith(TOKEN_PREFIX):
        return None

    candidates = (await db_session.execute(
        select(BackofficeAPIToken).where(
            BackofficeAPIToken.token_prefix == token[:15],
            BackofficeAPIToken.is_active == True,  # noqa: E712
        )
    )).scalars().all()
    api_token = next(
        (t for t in candidates if security_verify_token(token, t.token_hash)),
        None,
    )

    if not api_token:
        return None

    if api_token.expires_at:
        try:
            expires_at = datetime.fromisoformat(api_token.expires_at.replace('Z', '+00:00'))
            now = datetime.now(expires_at.tzinfo)
        except (ValueError, TypeError, AttributeError):
            # Unparseable expiry fails closed (matches org-token behavior)
            return None
        if now > expires_at:
            return None

    try:
        api_token.last_used_at = str(datetime.now())
        if security_token_needs_rehash(api_token.token_hash):
            api_token.token_hash = security_hash_token(token)
        db_session.add(api_token)
        await db_session.commit()
        await db_session.refresh(api_token)
    except Exception:
        # Don't fail auth just because last_used_at didn't update
        pass

    return api_token
