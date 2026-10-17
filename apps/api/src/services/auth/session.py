"""Single chokepoint for minting user sessions.

Every flow that signs a user in (password login, magic link, email-verification
auto-signin) routes through :func:`issue_session_or_challenge` instead of
calling ``create_access_token`` directly. That is what makes second-factor
enforcement complete rather than best-effort: a new sign-in path added later
gets the MFA gate by construction, not by the author remembering.

The interim "MFA pending" token carries ``purpose: "mfa_pending"``. Because
:func:`src.security.auth.get_current_user` rejects any token whose ``purpose``
is not ``"session"``, that token is inert against every authenticated endpoint
in the app the moment it is minted; it can only be spent at the MFA
verification endpoint, which decodes it explicitly.
"""

import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Optional

from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.users import User
from src.security.auth import create_access_token, create_refresh_token, decode_jwt
from src.security.session_context import (
    AMR_CLAIM,
    CUSTOM_DOMAIN_CLAIM,
    SORG_CLAIM,
    session_claims,
)
from src.services.auth.mfa import is_mfa_active

MFA_PENDING_PURPOSE = "mfa_pending"
# Long enough to open an authenticator app and read a code, short enough that a
# stolen interim token is near-worthless. Users who exceed it re-enter their
# password, which is a mild annoyance rather than a lockout.
MFA_PENDING_TTL = timedelta(minutes=5)


@dataclass
class SessionIssueResult:
    """Either a live session, or a demand for a second factor, never both."""

    mfa_required: bool
    mfa_token: Optional[str] = None
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None


def create_mfa_pending_token(
    email: str,
    amr: Optional[str] = None,
    org_id: Optional[int] = None,
    custom_domain: bool = False,
) -> str:
    """Mint the interim token. It carries the session's provenance (``amr`` /
    ``sorg``) so that when the second factor is completed at ``/auth/login/mfa``
    the real session is minted with the same method and org it was started for."""
    return create_access_token(
        data={
            "sub": email,
            "purpose": MFA_PENDING_PURPOSE,
            # Single use: completing the second factor spends it, so a pending
            # token seen once cannot start another session.
            "jti": secrets.token_urlsafe(16),
            **session_claims(amr, org_id, custom_domain=custom_domain),
        },
        expires_delta=MFA_PENDING_TTL,
    )


async def mfa_pending_token_usable(db_session: AsyncSession, token: str) -> bool:
    """Read-only pre-check, before a code is spent on it: the pending token
    carries a ``jti`` that has not been redeemed yet."""
    from src.services.auth.link_tokens import link_token_spent

    payload = decode_jwt(token) or {}
    jti = payload.get("jti")
    if not jti or not isinstance(payload.get("exp"), int):
        return False
    return not await link_token_spent(db_session, jti)


async def spend_mfa_pending_token(db_session: AsyncSession, token: str) -> bool:
    """Record a pending token as used once its second factor is accepted.
    False when it was already spent or carries no ``jti``."""
    from src.services.auth.link_tokens import redeem_link_token

    payload = decode_jwt(token) or {}
    jti, exp = payload.get("jti"), payload.get("exp")
    if not jti or not isinstance(exp, int):
        return False
    return await redeem_link_token(db_session, jti, MFA_PENDING_PURPOSE, exp)


def decode_mfa_pending_token(token: str) -> Optional[str]:
    """Return the email a pending token was minted for, or None if it is not a
    valid, unexpired token of exactly that purpose."""
    payload = decode_jwt(token)
    if not payload:
        return None
    if payload.get("purpose") != MFA_PENDING_PURPOSE:
        return None
    sub = payload.get("sub")
    return str(sub) if sub else None


def decode_mfa_pending_provenance(token: str) -> tuple[Optional[str], Optional[int]]:
    """Return ``(amr, org_id)`` carried by a pending token, or ``(None, None)``.

    Does not re-validate purpose/expiry; always call after
    :func:`decode_mfa_pending_token` has confirmed the token is genuine.
    """
    payload = decode_jwt(token) or {}
    org_raw = payload.get(SORG_CLAIM)
    try:
        org_id = int(org_raw) if org_raw is not None else None
    except (TypeError, ValueError):  # pragma: no cover - defensive: non-int sorg in a crafted token
        org_id = None
    return payload.get(AMR_CLAIM), org_id


def decode_mfa_pending_custom_domain(token: str) -> bool:
    """Whether a pending token was started on an org's custom domain, so the
    session completed from it stays bound to that org. Same caveat as
    :func:`decode_mfa_pending_provenance`."""
    return (decode_jwt(token) or {}).get(CUSTOM_DOMAIN_CLAIM) is True


def mint_session_tokens(
    email: str,
    amr: Optional[str] = None,
    org_id: Optional[int] = None,
    custom_domain: bool = False,
) -> SessionIssueResult:
    """Mint a real session unconditionally. Only for callers that have already
    satisfied (or deliberately bypassed) the second factor.

    ``amr`` records how the user authenticated and ``org_id`` records which org
    the session was established for; both are stamped into the token so the
    per-org auth-method / session-sharing policy can evaluate the session later.
    ``custom_domain`` marks a session signed in on the org's own domain, which
    that policy then holds to ``org_id`` alone.
    """
    claims = session_claims(amr, org_id, custom_domain=custom_domain)
    return SessionIssueResult(
        mfa_required=False,
        access_token=create_access_token(data={"sub": email, "purpose": "session", **claims}),
        refresh_token=create_refresh_token(data={"sub": email, "purpose": "session", **claims}),
    )


async def issue_session_or_challenge(
    db_session: AsyncSession,
    user: User,
    amr: Optional[str] = None,
    org_id: Optional[int] = None,
    custom_domain: bool = False,
) -> SessionIssueResult:
    """Mint a session, unless the user has a confirmed second factor, in which
    case mint a short-lived pending token instead and demand a code. Provenance
    (``amr`` / ``org_id``) is carried through both branches."""
    if await is_mfa_active(db_session, user.id):
        return SessionIssueResult(
            mfa_required=True,
            mfa_token=create_mfa_pending_token(user.email, amr, org_id, custom_domain),
        )
    return mint_session_tokens(user.email, amr, org_id, custom_domain)
