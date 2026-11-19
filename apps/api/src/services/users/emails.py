"""Account, membership and lifecycle mail.

These are thin, typed wrappers kept for their many call sites: each one
gathers its values and calls the shared pipeline
(``src.services.email.pipeline.send_email``) with a registered template.
Rendering, branding, the plain-text part and delivery all happen there.

Mail the user is actively waiting on (password reset, invitation, address
verification) is ``critical``: a provider failure raises so the request can
report it. Everything else is a side effect of something that already
happened, and its failure is logged and swallowed (the call returns False).
"""

from __future__ import annotations

from typing import Optional
from urllib.parse import quote

from pydantic import EmailStr

from src.db.organizations import OrganizationRead
from src.db.users import UserRead
from src.services.email.branding import OrgEmailBranding
from src.services.email.pipeline import send_email

ACADEMY_URL = "https://university.learnhouse.io"


def org_brand(
    org_name: Optional[str],
    lang: str = "en",
    sender_name: Optional[str] = None,
    logo_url: Optional[str] = None,
    brand_color: Optional[str] = None,
    powered_by: bool = True,
) -> Optional[OrgEmailBranding]:
    """The branding of an org-scoped email from the senders' keyword arguments."""
    if not org_name:
        return None
    return OrgEmailBranding(
        org_name=org_name, lang=lang, sender_name=sender_name or "", logo_url=logo_url,
        brand_color=brand_color, powered_by=powered_by,
    )


def send_account_creation_email(
    user: UserRead,
    email: EmailStr,
    lang: str = "en",
    cta_url: str | None = None,
    org_name: str | None = None,
    logo_url: str | None = None,
    sender_name: str | None = None,
    brand_color: str | None = None,
    powered_by: bool = True,
):
    """Welcome email once an account exists; white-labeled when ``org_name`` is set."""
    return send_email(
        "account.welcome", email, {"username": user.username, "cta_url": cta_url or ACADEMY_URL},
        org=org_brand(org_name, lang, sender_name, logo_url, brand_color, powered_by), lang=lang,
    )


def send_org_created_email(
    email: EmailStr,
    org_name: str,
    dashboard_url: str,
    lang: str = "en",
    trial_plan: str | None = None,
    trial_days: int = 0,
):
    """Confirmation when a user creates an organization (mentions the trial)."""
    return send_email(
        "org.created", email,
        {"org_name": org_name, "dashboard_url": dashboard_url, "trial_plan": trial_plan, "trial_days": trial_days},
        lang=lang,
    )


def send_org_deleted_email(email: EmailStr, org_name: str, lang: str = "en"):
    """Confirmation to org admins after an organization is deleted."""
    return send_email("org.deleted", email, {"org_name": org_name}, lang=lang)


def send_account_deleted_email(email: EmailStr, username: str = "", lang: str = "en"):
    """Goodbye email after an account is deleted."""
    return send_email("account.deleted", email, {"username": username}, lang=lang)


def send_email_changed_notice(email: EmailStr, new_email: str, username: str = "", lang: str = "en"):
    """Tell the previous address that the account's email was changed, so a
    hijacked session cannot quietly move the account to another inbox."""
    return send_email("account.email_changed", email, {"username": username, "new_email": new_email}, lang=lang)


def _reset_url(base_url: str, email: str, code: str) -> str:
    return f"{base_url}/reset?email={quote(str(email), safe='')}&resetCode={quote(code, safe='')}"


def send_password_reset_email(
    generated_reset_code: str,
    user: UserRead,
    organization: OrganizationRead,
    email: EmailStr,
    base_url: str,
    lang: str = "en",
    sender_name: str | None = None,
    logo_url: str | None = None,
    brand_color: str | None = None,
    powered_by: bool = True,
):
    """Password reset for an account inside an organization, branded to it."""
    return send_email(
        "account.password_reset", email,
        {"username": user.username, "code": generated_reset_code,
         "url": _reset_url(base_url, email, generated_reset_code)},
        org=org_brand(organization.name, lang, sender_name, logo_url, brand_color, powered_by), lang=lang,
    )


def send_password_reset_email_platform(
    generated_reset_code: str,
    user: UserRead,
    email: EmailStr,
    base_url: str,
    lang: str = "en",
):
    """Platform-level password reset under the LearnHouse mark."""
    return send_email(
        "account.password_reset", email,
        {"username": user.username, "code": generated_reset_code,
         "url": _reset_url(base_url, email, generated_reset_code)},
        lang=lang,
    )


def send_invitation_email(
    email: EmailStr,
    org_name: str,
    inviter_username: str,
    signup_url: str,
    invite_code: Optional[str] = None,
    lang: str = "en",
    sender_name: str | None = None,
    logo_url: str | None = None,
    brand_color: str | None = None,
    powered_by: bool = True,
    role_name: str | None = None,
    message: str | None = None,
    expires_on: str | None = None,
):
    """Invitation into an organization, branded to that organization."""
    return send_email(
        "org.invitation", email,
        {"inviter": inviter_username, "signup_url": signup_url, "invite_code": invite_code,
         "role_name": role_name, "message": message, "expires_on": expires_on},
        org=org_brand(org_name, lang, sender_name, logo_url, brand_color, powered_by), lang=lang,
    )


def send_org_join_email(
    email: EmailStr,
    username: str,
    org_name: str,
    cta_url: str,
    lang: str = "en",
    logo_url: str | None = None,
    sender_name: str | None = None,
    brand_color: str | None = None,
    powered_by: bool = True,
):
    """Greeting sent when an EXISTING account becomes a member of an organization."""
    return send_email(
        "org.joined", email, {"username": username, "cta_url": cta_url},
        org=org_brand(org_name, lang, sender_name, logo_url, brand_color, powered_by), lang=lang,
    )


def send_drip_unlocked_email(
    email: EmailStr,
    username: str,
    org_name: str,
    course_name: str,
    chapter_names: list[str],
    cta_url: str,
    lang: str = "en",
    logo_url: str | None = None,
    sender_name: str | None = None,
    brand_color: str | None = None,
    powered_by: bool = True,
):
    """Tell an enrolled learner that scheduled chapters of a course just opened."""
    return send_email(
        "learning.drip_unlocked", email,
        {"username": username, "course": course_name, "chapters": list(chapter_names), "cta_url": cta_url},
        org=org_brand(org_name, lang, sender_name, logo_url, brand_color, powered_by), lang=lang,
    )


def send_role_changed_email(
    email: EmailStr,
    username: str,
    org_name: str,
    new_role_name: str,
    lang: str = "en",
    cta_url: str | None = None,
    sender_name: str | None = None,
    logo_url: str | None = None,
    brand_color: str | None = None,
    powered_by: bool = True,
):
    """A member's role in an organization changed; links back to the org."""
    return send_email(
        "org.role_changed", email, {"username": username, "role_name": new_role_name, "cta_url": cta_url},
        org=org_brand(org_name, lang, sender_name, logo_url, brand_color, powered_by), lang=lang,
    )


def send_email_verification_email(
    token: str,
    user: UserRead,
    organization: OrganizationRead | None,
    email: EmailStr,
    base_url: str,
    lang: str = "en",
    sender_name: str | None = None,
    logo_url: str | None = None,
    brand_color: str | None = None,
    powered_by: bool = True,
):
    """Address verification link; branded to ``organization`` when there is one."""
    org_uuid = organization.org_uuid if organization else "none"
    url = (
        f"{base_url}/verify-email?token={quote(token, safe='')}"
        f"&user={quote(user.user_uuid, safe='')}&org={quote(org_uuid, safe='')}"
    )
    return send_email(
        "account.email_verification", email, {"username": user.username, "url": url},
        org=org_brand(organization.name if organization else None, lang, sender_name, logo_url, brand_color, powered_by),
        lang=lang,
    )


def send_nudge_email(
    nudge_id: str,
    email: EmailStr,
    org_name: str,
    cta_url: str,
    unsubscribe_url: str,
    lang: str = "en",
    logo_url: str | None = None,
    has_cta: bool = True,
    track: str = "",
    stats: list[tuple[str, int]] | None = None,
    sender_name: str | None = None,
    brand_color: str | None = None,
    powered_by: bool = True,
    **copy_vars,
):
    """One lifecycle nudge; ``copy_vars`` fill the nudge's placeholders."""
    return send_email(
        "learning.nudge", email,
        {"nudge_id": nudge_id, "cta_url": cta_url, "unsubscribe_url": unsubscribe_url, "has_cta": has_cta,
         "track": track, "stats": list(stats or []), "copy": copy_vars},
        org=org_brand(org_name, lang, sender_name, logo_url, brand_color, powered_by), lang=lang,
    )


def send_unread_messages_email(
    email: EmailStr,
    username: str,
    org_name: str,
    conversations: list[dict],
    cta_url: str,
    settings_url: str,
    lang: str = "en",
    logo_url: str | None = None,
    sender_name: str | None = None,
    brand_color: str | None = None,
    powered_by: bool = True,
):
    """Messages left unread for a while: one email covering every conversation."""
    return send_email(
        "messages.unread", email,
        {"username": username, "conversations": conversations, "cta_url": cta_url, "settings_url": settings_url},
        org=org_brand(org_name, lang, sender_name, logo_url, brand_color, powered_by), lang=lang,
    )


def send_plan_email(
    stage: str,
    email: EmailStr,
    org_name: str,
    cta_url: str,
    lang: str = "en",
    unsubscribe_url: str = "",
    **copy_vars,
):
    """Mail from LearnHouse to an org's admins about its own plan (platform-branded)."""
    return send_email(
        "billing.plan", email,
        {"stage": stage, "org_name": org_name, "cta_url": cta_url, "unsubscribe_url": unsubscribe_url,
         "copy": copy_vars},
        lang=lang,
    )
