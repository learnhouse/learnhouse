"""Who may write to a community.

Reading follows ``check_resource_access`` (public communities stay readable by
anyone). Writing (posting, commenting, voting, reacting) is limited to members
of the community's org whose role grants ``discussions.action_create``; API
tokens need that right in their own rights and must belong to the same org.
"""

from typing import Union

from fastapi import HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.communities.communities import Community
from src.db.users import AnonymousUser, APITokenUser, PublicUser, SuperadminAPITokenUser
from src.security.api_token_utils import require_token_right
from src.security.org_auth import require_org_role_permission
from src.security.rbac import authorization_verify_if_user_is_anon


def require_token_in_community_org(
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    community: Community,
) -> None:
    """403 when an API token acts on a community outside its own org.

    Tokens resolve to their creator for author checks, and the creator may
    belong to other orgs; the token itself is scoped to one org only.
    """
    if isinstance(current_user, APITokenUser) and current_user.org_id != community.org_id:
        raise HTTPException(
            status_code=403,
            detail="API token cannot access resources outside its organization",
        )


async def require_community_participant(
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    community: Community,
    db_session: AsyncSession,
) -> int:
    """Gate a community write and return the real user id it is made as."""
    if isinstance(current_user, SuperadminAPITokenUser):
        # A post needs a real author; a cross-org token is not one.
        raise HTTPException(status_code=403, detail="Superadmin API tokens cannot post to communities")
    if isinstance(current_user, APITokenUser):
        require_token_in_community_org(current_user, community)
        require_token_right(current_user, "discussions", "action_create")
        return current_user.created_by_user_id

    await authorization_verify_if_user_is_anon(current_user.id)
    await require_org_role_permission(
        current_user.id, community.org_id, db_session, "discussions", "action_create"
    )
    return current_user.id
