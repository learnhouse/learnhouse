"""Notification sent when an account becomes a member of an organization.

Every membership path funnels through :func:`notify_user_joined_org` so a user
who joins an org gets the same greeting regardless of how they got in — invite
code, open join, an OAuth invite accepted with an existing account, or admin
provisioning.

Brand-new signups are the one exception: ``send_account_creation_email``
already welcomes them into the org they registered in, so those paths must not
call this as well or the user receives two near-identical emails.
"""

import logging
from typing import Optional

from fastapi import Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.users import User

logger = logging.getLogger(__name__)


async def notify_user_joined_org(
    request: Request,
    db_session: AsyncSession,
    user: User,
    org_id: int,
    org: Optional[Organization] = None,
) -> None:
    """Email ``user`` a greeting and a link into the org they just joined.

    Best-effort: every failure is swallowed and logged. Joining an
    organization must never fail because a mail server is down.
    """
    try:
        if not user or not getattr(user, "email", None):
            return

        if org is None:
            org = (
                await db_session.execute(
                    select(Organization).where(Organization.id == org_id)
                )
            ).scalars().first()
        if org is None:
            return

        org_config = (
            await db_session.execute(
                select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
            )
        ).scalars().first()

        # Imported here: these modules pull in org services that import this one.
        from src.services.email.utils import get_org_logo_url, get_org_signup_base_url
        from src.services.orgs.orgs import get_org_default_language
        from src.services.users.emails import send_org_join_email

        base_url = await get_org_signup_base_url(
            org.slug, request, db_session=db_session, org_id=org_id
        )

        send_org_join_email(
            email=user.email,
            username=user.username,
            org_name=org.name,
            # Org landing page, not `/home` — `/home` is the platform org
            # picker on every host and would deroute the user straight back
            # out of the org they just joined.
            cta_url=base_url.rstrip("/") or "/",
            lang=get_org_default_language(org_config),
            logo_url=get_org_logo_url(org, request),
        )
    except Exception:
        logger.warning(
            "Failed to send org join email to user %s for org %s",
            getattr(user, "id", None),
            org_id,
            exc_info=True,
        )
