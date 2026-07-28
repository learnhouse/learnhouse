"""
Public unsubscribe endpoints for lifecycle email.

Unauthenticated by design: the recipient of a nudge may not have a live session
(and if they are unsubscribing, quite likely does not want to make one). The
HMAC token in the link is the authorisation.
"""

import html
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Form, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.events.database import get_db_session
from src.services.nudges.preferences import (
    get_user_by_uuid,
    set_lifecycle_opt_out,
)
from src.services.nudges.tokens import verify_unsubscribe_token

logger = logging.getLogger(__name__)

public_router = APIRouter()


_PAGE_STYLE = (
    "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; "
    "max-width: 460px; margin: 80px auto; padding: 0 24px; text-align: center; "
    "color: #000;"
)
_H1_STYLE = "font-size: 20px; font-weight: 800; margin: 0 0 12px 0;"
_P_STYLE = "font-size: 14px; color: rgba(0,0,0,0.5); line-height: 1.7; margin: 0 0 24px 0;"
_BUTTON_STYLE = (
    "display: inline-block; padding: 12px 28px; background: #000; color: #fff; "
    "border: none; border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer;"
)


def _page(title: str, message: str, form_html: str = "") -> HTMLResponse:
    return HTMLResponse(
        f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{html.escape(title)}</title></head>
<body style="{_PAGE_STYLE}">
<h1 style="{_H1_STYLE}">{html.escape(title)}</h1>
<p style="{_P_STYLE}">{message}</p>
{form_html}
</body></html>"""
    )


def _expired_page() -> HTMLResponse:
    """Shown for any token we can't verify.

    Tampering, a mangled URL and a rotated signing secret are indistinguishable
    from here, and all three land on someone who is trying to opt out. A 403
    would read as stonewalling, so point them at a route that still works.
    """
    return _page(
        "This link has expired",
        "We couldn't confirm this unsubscribe link. You can manage email "
        "preferences from your account settings, or reply to any of our emails "
        "and we'll take care of it.",
    )


@public_router.get("/unsubscribe", response_class=HTMLResponse)
async def unsubscribe_page(
    request: Request,
    token: str = Query(..., description="Unsubscribe token from the email link"),
    db_session: AsyncSession = Depends(get_db_session),
) -> HTMLResponse:
    """Render a confirmation page. Deliberately free of side effects.

    Corporate mail scanners (Outlook Safe Links, Proofpoint and friends)
    prefetch every href in a message. If this GET unsubscribed people, those
    scanners would silently opt out users who never clicked anything.
    """
    user_uuid = verify_unsubscribe_token(token)
    if not user_uuid:
        return _expired_page()

    user = await get_user_by_uuid(db_session, user_uuid)
    if user is None:
        return _expired_page()

    escaped_token = html.escape(token)
    form_html = f"""<form method="post" action="unsubscribe">
<input type="hidden" name="token" value="{escaped_token}" />
<button type="submit" style="{_BUTTON_STYLE}">Confirm unsubscribe</button>
</form>"""
    return _page(
        "Unsubscribe from these emails?",
        f"You'll stop receiving tips and reminders at "
        f"<strong>{html.escape(str(user.email))}</strong>. Account emails like "
        "password resets and invitations will still reach you.",
        form_html,
    )


@public_router.post("/unsubscribe", response_class=HTMLResponse)
async def unsubscribe_confirm(
    request: Request,
    token: Optional[str] = Form(default=None),
    token_query: Optional[str] = Query(default=None, alias="token"),
    db_session: AsyncSession = Depends(get_db_session),
) -> HTMLResponse:
    """Apply the opt-out. Idempotent.

    This is also the RFC 8058 one-click target named by the
    ``List-Unsubscribe-Post`` header, which posts without a form body — hence
    accepting the token from either the body or the query string.
    """
    supplied = token or token_query
    user_uuid = verify_unsubscribe_token(supplied or "")
    if not user_uuid:
        return _expired_page()

    user = await get_user_by_uuid(db_session, user_uuid)
    if user is None or user.id is None:
        return _expired_page()

    await set_lifecycle_opt_out(db_session, user.id, opted_out=True, source="email_link")
    logger.info("Lifecycle email opt-out recorded for user %s", user.id)

    return _page(
        "You're unsubscribed",
        "You won't receive any more tips or reminders from us. Account emails "
        "like password resets and invitations will still reach you.",
    )
