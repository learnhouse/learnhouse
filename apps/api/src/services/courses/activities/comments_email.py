"""Email people who were @mentioned in an activity comment.

Runs as a background task after the comment is committed, on its own
database session: the request's session is closed by then, and a slow mail
provider must never hold up the reply. Mail goes out under the org's
branding, only to people who may still edit the course, and never to anyone
who opted out of email or whose address is suppressed.
"""

from __future__ import annotations

import html
import logging
from typing import Optional

from fastapi import Request
from sqlmodel import select

from src.db.courses.activities import Activity
from src.db.courses.courses import Course
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.users import User

logger = logging.getLogger(__name__)

# The body is quoted in the email; long comments are cut, the link has the rest.
EXCERPT_MAX = 600


def _display_name(user: Optional[User]) -> str:
    if user is None:
        return "Someone"
    full = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return full or user.username


def editor_link(base_url: str, course_uuid: str, activity_uuid: str, thread_uuid: str) -> str:
    course = course_uuid.removeprefix("course_")
    activity = activity_uuid.removeprefix("activity_")
    return f"{base_url.rstrip('/')}/course/{course}/activity/{activity}/edit?thread={thread_uuid}"


def render_mention_email(
    *,
    lang: str,
    username: str,
    author: str,
    activity_name: str,
    course_name: str,
    org_name: str,
    quote: str,
    body: str,
    cta_url: str,
    logo_url: Optional[str],
    brand_color: Optional[str],
    powered_by: bool,
) -> tuple[str, str]:
    """(subject, html) of one mention email. Every input is escaped here."""
    from src.services.email.safe_text import email_org_name, email_user_name
    from src.services.email.translations import t
    from src.services.users.emails import (
        COLORS,
        STYLES,
        _brand_logo_html,
        _button_style,
        _email_layout,
    )

    safe_user = html.escape(email_user_name(username))
    safe_author = html.escape(email_user_name(author))
    safe_activity = html.escape(email_org_name(activity_name))
    safe_course = html.escape(email_org_name(course_name))
    safe_org = html.escape(email_org_name(org_name))
    excerpt = body if len(body) <= EXCERPT_MAX else body[:EXCERPT_MAX].rstrip() + "…"
    quote_html = (
        f'<p style="{STYLES["p"]} margin-bottom: 8px; padding-left: 12px; '
        f'border-left: 3px solid #fde68a; color: {COLORS["muted"]};">{html.escape(quote)}</p>'
        if quote
        else ""
    )
    heading = t(lang, "comment_mention.heading", author=safe_author)
    body_content = f"""
        <h1 style="{STYLES['h1']}">{heading}</h1>
        <p style="{STYLES['p']}">{t(lang, "comment_mention.body", username=safe_user, author=safe_author, activity=safe_activity, course=safe_course)}</p>
        {quote_html}
        <p style="{STYLES['p']} white-space: pre-wrap; padding: 12px 14px; background-color: {COLORS['subtle']}; border: 1px solid {COLORS['border']}; border-radius: 8px;">{html.escape(excerpt)}</p>
        <a href="{html.escape(cta_url)}" style="{_button_style(brand_color)}">
            {t(lang, "comment_mention.cta")}
        </a>
        <p style="{STYLES['link_text']}">{html.escape(cta_url)}</p>
    """
    subject = t(lang, "comment_mention.subject", author=safe_author, activity=safe_activity)
    page = _email_layout(
        title=heading,
        body_content=body_content,
        footer_note=t(lang, "comment_mention.footer", course=safe_course, org_name=safe_org),
        logo_html=_brand_logo_html(logo_url, org_name),
        powered_by=powered_by,
        lang=lang,
    )
    return subject, page


async def send_mention_emails(
    request: Optional[Request],
    *,
    course_id: int,
    activity_id: int,
    thread_uuid: str,
    quote: str,
    author_id: int,
    body: str,
    mention_ids: list[int],
    db_session=None,
) -> int:
    """Send one email per mentioned person; returns how many went out."""
    args = dict(
        course_id=course_id, activity_id=activity_id, thread_uuid=thread_uuid,
        quote=quote, author_id=author_id, body=body, mention_ids=mention_ids,
    )
    if db_session is not None:
        return await _send(request, db_session, **args)
    from src.core.events.database import _async_session_factory

    async with _async_session_factory() as session:
        return await _send(request, session, **args)


async def _send(
    request: Optional[Request],
    db_session,
    *,
    course_id: int,
    activity_id: int,
    thread_uuid: str,
    quote: str,
    author_id: int,
    body: str,
    mention_ids: list[int],
) -> int:
    from src.services.email.branding import resolve_org_email_branding
    from src.services.email.utils import get_org_signup_base_url, send_email
    from src.services.nudges.preferences import get_opted_out_user_ids

    row = (await db_session.execute(
        select(Activity, Course, Organization, OrganizationConfig)
        .join(Course, Course.id == Activity.course_id)  # type: ignore[arg-type]
        .join(Organization, Organization.id == Course.org_id)  # type: ignore[arg-type]
        .outerjoin(OrganizationConfig, OrganizationConfig.org_id == Organization.id)  # type: ignore[arg-type]
        .where(Activity.id == activity_id, Course.id == course_id)
    )).first()
    if not row:
        return 0
    activity, course, org, org_config = row
    if getattr(org, "is_demo", False):
        # Demo visitors are strangers to each other: no mail between them.
        return 0

    opted_out = await get_opted_out_user_ids(db_session, mention_ids)
    ids = [i for i in mention_ids if i not in opted_out]
    if not ids:
        return 0
    users = (await db_session.execute(select(User).where(User.id.in_(ids + [author_id])))).scalars().all()  # type: ignore[union-attr]
    by_id = {u.id: u for u in users}
    author = _display_name(by_id.get(author_id))

    branding = resolve_org_email_branding(org, org_config, request)
    base_url = await get_org_signup_base_url(org.slug, request, db_session=db_session, org_id=org.id)
    link = editor_link(base_url, course.course_uuid, activity.activity_uuid, thread_uuid)

    sent = 0
    for uid in ids:
        user = by_id.get(uid)
        if user is None or not user.email:
            continue
        subject, page = render_mention_email(
            lang=branding.lang,
            username=user.first_name or user.username,
            author=author,
            activity_name=activity.name,
            course_name=course.name,
            org_name=branding.org_name or org.name,
            quote=quote,
            body=body,
            cta_url=link,
            logo_url=branding.logo_url,
            brand_color=branding.brand_color,
            powered_by=branding.powered_by,
        )
        try:
            send_email(to=user.email, subject=subject, body=page, sender_name=branding.sender_name or None)
            sent += 1
        except Exception:
            # One bad address must not stop the others.
            logger.warning("Mention email to user %s not sent", uid, exc_info=True)
    return sent
