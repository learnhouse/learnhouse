"""The single entry point for sending email.

Every email LearnHouse sends, from a password reset to a Backoffice deletion
warning, goes through :func:`send_email`::

    send_email("account.password_reset", to=user.email,
               context={"username": ..., "code": ..., "url": ...},
               org=branding)                 # OrgEmailBranding, Brand, or None

which looks the template up in the registry, renders it into the shared
layout (``layout.py``) with the right category colours and org branding,
derives the plain-text alternative, adds the list-unsubscribe / reply-to
headers the template asks for, and hands the result to the provider
(``transport.py``: Resend, or SMTP for self-hosted installs).

Bulk senders that pace themselves (the EE org-email throttle) render with
:func:`render_email` and deliver with :func:`deliver`, so they share the same
templates and the same transport.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional, Union

from src.services.email.layout import PLATFORM_BRAND, Brand, RenderedEmail, render_html, render_text
from src.services.email.registry import get_template
from src.services.email import transport

logger = logging.getLogger(__name__)

OrgLike = Union["Brand", Any, str, None]


def brand_for(org: OrgLike) -> Brand:
    """A :class:`Brand` from what a caller has at hand.

    * ``None``: platform mail under the LearnHouse mark.
    * a :class:`Brand`: used as is.
    * an ``OrgEmailBranding`` (or anything shaped like one): the org's own mail.
    * a plain org name: org-scoped mail without a logo or colour.
    """
    if org is None:
        return PLATFORM_BRAND
    if isinstance(org, Brand):
        return org
    if isinstance(org, str):
        from src.services.email.safe_text import email_org_name

        name = email_org_name(org)
        return Brand(name=name, org_scoped=True, powered_by=True, sender_name=name)
    from src.services.email.safe_text import email_org_name

    return Brand(
        name=email_org_name(getattr(org, "org_name", "") or ""),
        org_scoped=True,
        logo_url=getattr(org, "logo_url", None),
        color=getattr(org, "brand_color", None),
        powered_by=bool(getattr(org, "powered_by", True)),
        sender_name=getattr(org, "sender_name", None) or None,
        lang=getattr(org, "lang", None),
    )


def render_email(
    template: str,
    context: Optional[dict] = None,
    org: OrgLike = None,
    category: Optional[str] = None,
    *,
    lang: Optional[str] = None,
) -> RenderedEmail:
    """Render ``template`` with ``context`` to subject, HTML, text and headers."""
    from src.services.email.safe_text import header_safe
    from src.services.email.translations import normalize_language

    tpl = get_template(template)
    brand = brand_for(org)
    code = normalize_language(lang or brand.lang)
    email = tpl.build(dict(context or {}), code, brand)
    cat = category or tpl.category

    headers = dict(email.headers)
    if email.unsubscribe_url and email.one_click_unsubscribe:
        headers["List-Unsubscribe"] = f"<{email.unsubscribe_url}>"
        headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    if email.reply_to:
        headers["Reply-To"] = email.reply_to

    return RenderedEmail(
        subject=header_safe(email.subject),
        html=render_html(email, brand, cat, code),
        text=render_text(email, brand, code),
        headers=headers,
        sender_name=brand.sender_name if brand.org_scoped else None,
        category=cat,
        template=template,
    )


def deliver_message(**message):
    """The provider call (looked up at call time, so tests can stub either name)."""
    return transport.send_message(**message)


def deliver(rendered: RenderedEmail, to: str, *, headers: Optional[dict] = None):
    """Hand one rendered email to the provider. Raises on failure."""
    merged = {**rendered.headers, **(headers or {})}
    return deliver_message(
        to=to,
        subject=rendered.subject,
        body=rendered.html,
        text=rendered.text,
        headers=merged or None,
        sender_name=rendered.sender_name,
    )


def send_email(
    template: str,
    to: str,
    context: Optional[dict] = None,
    org: OrgLike = None,
    category: Optional[str] = None,
    *,
    lang: Optional[str] = None,
    critical: Optional[bool] = None,
    headers: Optional[dict] = None,
):
    """Render ``template`` and send it to ``to``.

    ``critical`` (default: the template's own setting) decides what a delivery
    failure does. Critical mail (reset, verification, invitation) raises, so
    the user sees the error and can retry. Everything else is a side effect of
    something that already happened: the failure is logged and ``False`` is
    returned rather than failing the caller's request.
    """
    rendered = render_email(template, context, org, category, lang=lang)
    is_critical = get_template(template).critical if critical is None else critical
    if is_critical:
        return deliver(rendered, to, headers=headers)
    try:
        return deliver(rendered, to, headers=headers)
    except Exception as exc:
        logger.warning("Email %s to %s not sent: %s", template, to, exc)
        return False


async def asend_email(*args, **kwargs):
    """:func:`send_email` from async code, on a worker thread."""
    return await asyncio.to_thread(send_email, *args, **kwargs)
