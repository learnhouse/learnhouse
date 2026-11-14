"""Read-only activity summaries for community moderation views.

The discussion list does not carry reply counts, so a moderation view would
otherwise need one request per thread. These summaries answer "how many
replies, and when was the last one" for a whole community, or "how busy is
each community" for an org, in a single grouped query.
"""

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Union

from fastapi import HTTPException, Request
from sqlalchemy import func
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.ee_hooks import require_ee_resource_paid_access
from src.db.communities.communities import Community
from src.db.communities.discussion_comments import DiscussionComment
from src.db.communities.discussions import Discussion
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.security.api_token_utils import require_token_content_read
from src.security.auth import resolve_acting_user_id
from src.security.org_auth import require_org_role_permission
from src.security.rbac import AccessAction, check_resource_access
from src.services.communities.communities import get_communities_by_org


class DiscussionActivity(SQLModel):
    discussion_uuid: str
    comment_count: int = 0
    last_comment_date: Optional[str] = None


class CommunitySummary(SQLModel):
    """Counts only: safe to show to anyone who can see the community."""

    community_uuid: str
    discussion_count: int = 0
    unanswered_count: int = 0
    participant_count: int = 0
    new_discussions_week: int = 0
    last_activity_date: Optional[str] = None


class CommunityActivity(SQLModel):
    community_uuid: str
    discussion_count: int = 0
    unanswered_count: int = 0
    last_activity_date: Optional[str] = None


def _parse(value: Optional[str]) -> Optional[datetime]:
    """Dates are stored as strings in two shapes (isoformat and str(datetime));
    parse both so "latest" compares instants, not text."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _latest(*values: Optional[str]) -> Optional[str]:
    best: Optional[str] = None
    best_at: Optional[datetime] = None
    for value in values:
        at = _parse(value)
        if at is not None and (best_at is None or at > best_at):
            best, best_at = value, at
    return best


async def _comment_stats(
    db_session: AsyncSession, discussion_ids: List[int]
) -> Dict[int, tuple]:
    """discussion_id -> (comment_count, latest comment date) in one query."""
    if not discussion_ids:
        return {}
    statement = (
        select(
            DiscussionComment.discussion_id,
            func.count(DiscussionComment.id),
            func.max(DiscussionComment.creation_date),
        )
        .where(DiscussionComment.discussion_id.in_(discussion_ids))  # type: ignore
        .group_by(DiscussionComment.discussion_id)
    )
    rows = (await db_session.execute(statement)).all()
    return {row[0]: (int(row[1] or 0), row[2]) for row in rows}


async def get_community_discussions_activity(
    request: Request,
    community_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: AsyncSession,
) -> List[DiscussionActivity]:
    """Reply count and last reply date for every discussion of a community.

    Same access as listing the community's discussions: these are counts the
    reader could already compute thread by thread.
    """
    await check_resource_access(
        request, db_session, current_user, community_uuid, AccessAction.READ
    )
    await require_ee_resource_paid_access(request, db_session, current_user, community_uuid)

    community = (
        await db_session.execute(
            select(Community).where(Community.community_uuid == community_uuid)
        )
    ).scalars().first()
    if not community:
        raise HTTPException(status_code=404, detail="Community not found")

    discussions = (
        await db_session.execute(
            select(Discussion.id, Discussion.discussion_uuid).where(
                Discussion.community_id == community.id
            )
        )
    ).all()
    stats = await _comment_stats(db_session, [d[0] for d in discussions])

    return [
        DiscussionActivity(
            discussion_uuid=uuid,
            comment_count=stats.get(discussion_id, (0, None))[0],
            last_comment_date=stats.get(discussion_id, (0, None))[1],
        )
        for discussion_id, uuid in discussions
    ]


async def get_org_communities_activity(
    request: Request,
    org_id: int,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: AsyncSession,
) -> List[CommunityActivity]:
    """Thread count, unanswered threads and latest activity per community.

    For the dashboard's community list, so limited to people who manage
    communities in this org (admins and maintainers, or a matching role).
    """
    if isinstance(current_user, APITokenUser):
        if current_user.org_id != org_id:
            raise HTTPException(
                status_code=403,
                detail="API token cannot access resources outside its organization",
            )
        require_token_content_read(current_user, "communities")
    else:
        acting_user_id = resolve_acting_user_id(current_user)
        if isinstance(current_user, AnonymousUser) or acting_user_id == 0:
            raise HTTPException(status_code=401, detail="Authentication required")
        await require_org_role_permission(
            acting_user_id, org_id, db_session, "communities", "action_update"
        )

    communities = (
        await db_session.execute(
            select(Community.id, Community.community_uuid).where(Community.org_id == org_id)
        )
    ).all()
    if not communities:
        return []

    discussions = (
        await db_session.execute(
            select(
                Discussion.id,
                Discussion.community_id,
                Discussion.creation_date,
            ).where(Discussion.community_id.in_([c[0] for c in communities]))  # type: ignore
        )
    ).all()
    stats = await _comment_stats(db_session, [d[0] for d in discussions])

    summary: Dict[int, CommunityActivity] = {
        community_id: CommunityActivity(community_uuid=uuid)
        for community_id, uuid in communities
    }
    # Pinning and locking touch update_date too, so activity means new
    # threads and new replies only.
    for discussion_id, community_id, created in discussions:
        entry = summary[community_id]
        count, last_comment = stats.get(discussion_id, (0, None))
        entry.discussion_count += 1
        if count == 0:
            entry.unanswered_count += 1
        entry.last_activity_date = _latest(entry.last_activity_date, created, last_comment)

    return list(summary.values())


# get_communities_by_org caps a page at 50; enough pages for any real org.
_SUMMARY_PAGE = 50
_SUMMARY_MAX_PAGES = 20


async def get_org_communities_summary(
    request: Request,
    org_id: int,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: AsyncSession,
) -> List[CommunitySummary]:
    """Public activity counts for the communities the caller can see.

    Visibility is exactly that of the community list (same function), so a
    restricted community never shows up for someone outside it. Only
    aggregate numbers are returned: no names, no content.
    """
    visible = []
    for page in range(1, _SUMMARY_MAX_PAGES + 1):
        batch = await get_communities_by_org(
            request, org_id, current_user, db_session, page, _SUMMARY_PAGE
        )
        visible.extend(batch)
        if len(batch) < _SUMMARY_PAGE:
            break
    if not visible:
        return []

    by_id: Dict[int, CommunitySummary] = {
        c.id: CommunitySummary(community_uuid=c.community_uuid) for c in visible
    }
    participants: Dict[int, set] = {cid: set() for cid in by_id}

    discussions = (
        await db_session.execute(
            select(
                Discussion.id,
                Discussion.community_id,
                Discussion.creation_date,
                Discussion.author_id,
            ).where(Discussion.community_id.in_(list(by_id)))  # type: ignore
        )
    ).all()
    stats = await _comment_stats(db_session, [d[0] for d in discussions])

    comment_authors = (
        await db_session.execute(
            select(Discussion.community_id, DiscussionComment.author_id)
            .join(Discussion, Discussion.id == DiscussionComment.discussion_id)
            .where(Discussion.community_id.in_(list(by_id)))  # type: ignore
            .distinct()
        )
    ).all()
    for community_id, author_id in comment_authors:
        participants[community_id].add(author_id)

    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    for discussion_id, community_id, created, author_id in discussions:
        entry = by_id[community_id]
        count, last_comment = stats.get(discussion_id, (0, None))
        entry.discussion_count += 1
        if count == 0:
            entry.unanswered_count += 1
        created_at = _parse(created)
        if created_at is not None and created_at >= week_ago:
            entry.new_discussions_week += 1
        participants[community_id].add(author_id)
        entry.last_activity_date = _latest(entry.last_activity_date, created, last_comment)

    for community_id, entry in by_id.items():
        entry.participant_count = len(participants[community_id])
    return list(by_id.values())
