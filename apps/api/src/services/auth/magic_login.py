"""User-facing passwordless "magic link" login.

Distinct from the admin/integration magic link (``purpose: "magic_link"`` in
:mod:`src.services.admin.admin`), which an API-token integration mints for a
specific user and is delivered out-of-band. This one is requested by the end user
from the login page ("email me a login link"), is emailed by LearnHouse, and
carries ``purpose: "magic_login"``.

Security posture mirrors the admin link:
* short TTL,
* a random ``jti`` enforced single-use via a Redis ``SETNX`` marker at consume,
* consumption goes through :func:`issue_session_or_challenge`, so a user with 2FA
  still gets a second-factor challenge — a magic link is a first factor, not a
  bypass.

The request endpoint never reveals whether an address has an account (always a
200), so it cannot be used to enumerate users.
"""

import html
import logging
import secrets
from datetime import timedelta
from typing import Optional, Tuple
from urllib.parse import quote

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import Organization
from src.db.users import UserRead
from src.security.auth import create_access_token, decode_jwt
from src.services.email.utils import send_email

logger = logging.getLogger(__name__)

MAGIC_LOGIN_PURPOSE = "magic_login"
# Long enough to leave the app, open email and click; short enough that an
# intercepted-but-unused link expires quickly.
MAGIC_LOGIN_TTL = timedelta(minutes=15)


def issue_magic_login_token(email: str, org_id: Optional[int]) -> str:
    """Mint a single-use magic-login JWT for ``email`` (optionally org-bound)."""
    payload = {
        "sub": email,
        "purpose": MAGIC_LOGIN_PURPOSE,
        "jti": secrets.token_urlsafe(16),
    }
    if org_id is not None:
        payload["org_id"] = org_id
    return create_access_token(data=payload, expires_delta=MAGIC_LOGIN_TTL)


def _redis():  # pragma: no cover - thin import shim; patched out in tests
    try:
        from src.core.redis import get_redis_client

        return get_redis_client()
    except Exception:
        return None


def _burn_jti(jti: str) -> bool:
    """Atomically consume ``jti``. True on first use, False on replay.

    Fails **closed**: if Redis is unavailable we refuse the link rather than risk
    a replayable login. (The admin link fails open because it is already
    single-recipient and integration-gated; a self-service emailed link is a
    softer target, so single-use must hold even without Redis.)
    """
    r = _redis()
    if r is None:
        logger.error("Magic-login: Redis unavailable, refusing to consume (fail closed)")
        return False
    try:
        ok = r.set(
            f"magic_login_used:{jti}",
            "1",
            nx=True,
            ex=int(MAGIC_LOGIN_TTL.total_seconds()) + 60,
        )
        return bool(ok)
    except Exception:
        logger.exception("Magic-login: Redis error during single-use check")
        return False


async def resolve_org(org_slug: Optional[str], db_session: AsyncSession) -> Optional[Organization]:
    if not org_slug:
        return None
    return (
        await db_session.execute(select(Organization).where(Organization.slug == org_slug))
    ).scalars().first()


def send_magic_login_email(
    user: UserRead,
    email: str,
    base_url: str,
    token: str,
    lang: str = "en",
) -> bool:
    """Email the clickable login link. Link points at the frontend consume page,
    which posts the token back to the verify endpoint."""
    from src.services.users.emails import STYLES, _email_layout

    safe_token = quote(token, safe="")
    login_url = f"{base_url.rstrip('/')}/auth/magic?token={safe_token}"
    safe_name = html.escape(user.username or user.email)

    body_content = f"""
        <h1 style="{STYLES['h1']}">Sign in to LearnHouse</h1>
        <p style="{STYLES['p']}">
            Hi {safe_name}, click the button below to sign in. This link works
            once and expires in 15 minutes. If you didn't request it, you can
            safely ignore this email.
        </p>
        <a href="{login_url}" style="{STYLES['button']}">Sign in</a>
        <p style="{STYLES['link_text']}">
            Or paste this link into your browser:<br />{login_url}
        </p>
    """
    return send_email(
        to=email,
        subject="Your LearnHouse login link",
        body=_email_layout(
            title="Sign in to LearnHouse",
            body_content=body_content,
            footer_note="This link signs you in to your LearnHouse account.",
        ),
    )


def consume_magic_login_token(token: str) -> Tuple[str, Optional[int]]:
    """Validate + burn a magic-login token. Returns ``(email, org_id)``.

    Raises 401/410 on an invalid, expired, wrong-purpose, or already-used token.
    """
    try:
        payload = decode_jwt(token)
    except Exception:
        raise HTTPException(status_code=401, detail={"code": "MAGIC_LINK_INVALID", "message": "This login link is invalid or has expired."})

    if not payload or payload.get("purpose") != MAGIC_LOGIN_PURPOSE:
        raise HTTPException(status_code=410, detail={"code": "MAGIC_LINK_INVALID", "message": "This is not a valid login link."})

    jti = payload.get("jti")
    if not jti or not _burn_jti(jti):
        raise HTTPException(
            status_code=410,
            detail={"code": "MAGIC_LINK_USED", "message": "This login link has already been used. Please request a new one."},
        )

    email = payload.get("sub")
    if not email:
        raise HTTPException(status_code=401, detail={"code": "MAGIC_LINK_INVALID", "message": "This login link is invalid."})

    org_raw = payload.get("org_id")
    try:
        org_id = int(org_raw) if org_raw is not None else None
    except (TypeError, ValueError):
        org_id = None
    return str(email), org_id
