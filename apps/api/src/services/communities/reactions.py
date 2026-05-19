from typing import List, Union
from uuid import uuid4
from datetime import datetime
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from fastapi import HTTPException, Request

from src.db.users import PublicUser, AnonymousUser, APITokenUser, User
from src.db.communities.communities import Community
from src.db.communities.discussions import Discussion
from src.db.communities.discussion_reactions import (
    DiscussionReaction,
    DiscussionReactionSummary,
    ReactionUser,
)
from src.security.rbac import check_resource_access, AccessAction, authorization_verify_if_user_is_anon
from src.services.communities.moderation import get_community_settings


async def get_reactions(
    request: Request,
    discussion_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: AsyncSession,
) -> List[DiscussionReactionSummary]:
    """
    Get all reactions for a discussion, grouped by emoji.

    Returns a list of reaction summaries with emoji, count, users, and has_reacted status.
    """
    # Get the discussion
    discussion_statement = select(Discussion).where(
        Discussion.discussion_uuid == discussion_uuid
    )
    discussion = (await db_session.execute(discussion_statement)).scalars().first()

    if not discussion:
        raise HTTPException(status_code=404, detail="Discussion not found")

    # Get the community and check read access
    community_statement = select(Community).where(
        Community.id == discussion.community_id
    )
    community = (await db_session.execute(community_statement)).scalars().first()

    if not community:
        raise HTTPException(status_code=404, detail="Community not found")

    await check_resource_access(
        request, db_session, current_user, community.community_uuid, AccessAction.READ
    )

    # Get all reactions for this discussion
    reactions_statement = select(DiscussionReaction).where(
        DiscussionReaction.discussion_id == discussion.id
    )
    reactions = (await db_session.execute(reactions_statement)).scalars().all()

    # Group reactions by emoji
    emoji_groups: dict = {}
    for reaction in reactions:
        if reaction.emoji not in emoji_groups:
            emoji_groups[reaction.emoji] = []
        emoji_groups[reaction.emoji].append(reaction)

    # Batch-fetch all users referenced by any reaction in a single query,
    # then look them up by id in the per-emoji loop — eliminates N+1.
    all_user_ids = list({r.user_id for r in reactions})
    user_map: dict[int, User] = {}
    if all_user_ids:
        fetched = (await db_session.execute(select(User).where(User.id.in_(all_user_ids)))).scalars().all()  # type: ignore
        user_map = {u.id: u for u in fetched}

    # Build summary with user info
    summaries = []
    for emoji, emoji_reactions in emoji_groups.items():
        user_ids = [r.user_id for r in emoji_reactions]

        user_list = [
            ReactionUser(
                id=u.id,
                user_uuid=u.user_uuid,
                username=u.username,
                first_name=u.first_name,
                last_name=u.last_name,
                avatar_image=u.avatar_image,
            )
            for uid in user_ids
            if (u := user_map.get(uid)) is not None
        ]

        has_reacted = current_user.id in user_ids if current_user.id != 0 else False

        summaries.append(
            DiscussionReactionSummary(
                emoji=emoji,
                count=len(emoji_reactions),
                users=user_list,
                has_reacted=has_reacted,
            )
        )

    # Sort by count descending
    summaries.sort(key=lambda x: x.count, reverse=True)

    return summaries


async def toggle_reaction(
    request: Request,
    discussion_uuid: str,
    emoji: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: AsyncSession,
) -> dict:
    """
    Toggle a reaction on a discussion.

    If the user has already reacted with this emoji, it will be removed.
    If the user has not reacted with this emoji, it will be added.
    """
    # Verify user is not anonymous
    await authorization_verify_if_user_is_anon(current_user.id)

    # Get the discussion
    discussion_statement = select(Discussion).where(
        Discussion.discussion_uuid == discussion_uuid
    )
    discussion = (await db_session.execute(discussion_statement)).scalars().first()

    if not discussion:
        raise HTTPException(status_code=404, detail="Discussion not found")

    # Get the community and check read access
    community_statement = select(Community).where(
        Community.id == discussion.community_id
    )
    community = (await db_session.execute(community_statement)).scalars().first()

    if not community:
        raise HTTPException(status_code=404, detail="Community not found")

    await check_resource_access(
        request, db_session, current_user, community.community_uuid, AccessAction.READ
    )

    if get_community_settings(community).get("disable_reactions"):
        raise HTTPException(
            status_code=403,
            detail={
                "message": "Reactions are disabled in this community.",
                "code": "MODERATION_REACTIONS_DISABLED",
            },
        )

    # Check if user has already reacted with this emoji
    existing_reaction_statement = select(DiscussionReaction).where(
        DiscussionReaction.discussion_id == discussion.id,
        DiscussionReaction.user_id == current_user.id,
        DiscussionReaction.emoji == emoji,
    )
    existing_reaction = (await db_session.execute(existing_reaction_statement)).scalars().first()

    if existing_reaction:
        # Remove the reaction
        await db_session.delete(existing_reaction)
        await db_session.commit()
        return {"action": "removed", "emoji": emoji}
    else:
        # Add the reaction
        reaction = DiscussionReaction(
            discussion_id=discussion.id,
            user_id=current_user.id,
            emoji=emoji,
            reaction_uuid=f"reaction_{uuid4()}",
            creation_date=str(datetime.now()),
        )
        db_session.add(reaction)
        await db_session.commit()
        return {"action": "added", "emoji": emoji}
