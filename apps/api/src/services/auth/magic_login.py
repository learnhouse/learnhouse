"""User-facing passwordless "magic link" login.

Distinct from the admin/integration magic link (``purpose: "magic_link"`` in
:mod:`src.services.admin.admin`), which an API-token integration mints for a
specific user and is delivered out-of-band. This one is requested by the end user
from the login page ("email me a login link"), is emailed by LearnHouse, and
carries ``purpose: "magic_login"``.

Security posture mirrors the admin link:
* short TTL,
* a random ``jti`` enforced single-use by a durable record at consume (see
  :mod:`src.services.auth.link_tokens`),
* consumption goes through :func:`issue_session_or_challenge`, so a user with 2FA
  still gets a second-factor challenge; a magic link is a first factor, not a
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
    org_name: str | None = None,
    sender_name: str | None = None,
    logo_url: str | None = None,
    brand_color: str | None = None,
    powered_by: bool = True,
) -> bool:
    """Email the clickable login link. Link points at the frontend consume page,
    which posts the token back to the verify endpoint.

    With ``org_name`` the mail is the organization's own: its name in the
    subject and copy, its logo (or name) in the header, its color on the
    button, its From display name. Without one it is a platform email.
    """
    from src.services.email.translations import t
    from src.services.users.emails import (
        LOGO_SVG,
        STYLES,
        _brand_logo_html,
        _button_style,
        _email_layout,
    )

    from src.services.email.safe_text import email_org_name, email_user_name

    # Names are attacker-controllable; never relay a link or header break.
    org_name = email_org_name(org_name) if org_name else None
    safe_token = quote(token, safe="")
    login_url = html.escape(f"{base_url.rstrip('/')}/auth/magic?token={safe_token}")
    safe_name = html.escape(email_user_name(user.username) if user.username else user.email)
    white_label = bool(org_name)
    brand = html.escape(org_name) if org_name else "LearnHouse"

    heading = t(lang, "magic_login.heading", brand=brand)
    body_text = t(lang, "magic_login.body", username=safe_name)
    cta = t(lang, "magic_login.cta")
    copy_paste = t(lang, "email_verification.copy_paste")

    body_content = f"""
        <h1 style="{STYLES['h1']}">{heading}</h1>
        <p style="{STYLES['p']}">
            {body_text}
        </p>
        <a href="{login_url}" style="{_button_style(brand_color if white_label else None)}">{cta}</a>
        <p style="{STYLES['link_text']}">
            {copy_paste}<br />{login_url}
        </p>
    """
    return send_email(
        to=email,
        # Plain-text subject: the org name must not arrive HTML-escaped.
        subject=t(lang, "magic_login.subject", brand=org_name or "LearnHouse"),
        body=_email_layout(
            title=heading,
            body_content=body_content,
            footer_note=t(lang, "magic_login.footer", brand=brand),
            logo_html=_brand_logo_html(logo_url, org_name) if white_label else LOGO_SVG,
            powered_by=white_label and powered_by,
            lang=lang,
        ),
        sender_name=sender_name,
    )


async def consume_magic_login_token(token: str, db_session: AsyncSession) -> Tuple[str, Optional[int]]:
    """Validate + spend a magic-login token. Returns ``(email, org_id)``.

    Raises 401/410 on an invalid, expired, wrong-purpose, or already-used token,
    and 503 when the use cannot be recorded (the link is refused, never let
    through unrecorded).
    """
    from src.services.auth.link_tokens import redeem_link_token

    try:
        payload = decode_jwt(token)
    except Exception:
        raise HTTPException(status_code=401, detail={"code": "MAGIC_LINK_INVALID", "message": "This login link is invalid or has expired."})

    # Links are minted by create_access_token, which stamps type "access".
    if not payload or payload.get("purpose") != MAGIC_LOGIN_PURPOSE or payload.get("type") != "access":
        raise HTTPException(status_code=410, detail={"code": "MAGIC_LINK_INVALID", "message": "This is not a valid login link."})

    email = payload.get("sub")
    if not email:
        raise HTTPException(status_code=401, detail={"code": "MAGIC_LINK_INVALID", "message": "This login link is invalid."})

    jti = payload.get("jti")
    exp = payload.get("exp")
    if not jti or not isinstance(exp, int):
        raise HTTPException(status_code=410, detail={"code": "MAGIC_LINK_INVALID", "message": "This is not a valid login link."})

    # Spend the link only once it is known to be well formed, and before
    # anything else is read or written.
    if not await redeem_link_token(db_session, jti, MAGIC_LOGIN_PURPOSE, exp):
        raise HTTPException(
            status_code=410,
            detail={"code": "MAGIC_LINK_USED", "message": "This login link has already been used. Please request a new one."},
        )

    org_raw = payload.get("org_id")
    try:
        org_id = int(org_raw) if org_raw is not None else None
    except (TypeError, ValueError):
        org_id = None
    return str(email), org_id
