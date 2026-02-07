from typing import List, Union
from uuid import uuid4
from datetime import datetime
from sqlmodel import Session, select
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


async def get_reactions(
    request: Request,
    discussion_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> List[DiscussionReactionSummary]:
    """
    Get all reactions for a discussion, grouped by emoji.

    Returns a list of reaction summaries with emoji, count, users, and has_reacted status.
    """
    # Get the discussion
    discussion_statement = select(Discussion).where(
        Discussion.discussion_uuid == discussion_uuid
    )
    discussion = db_session.exec(discussion_statement).first()

    if not discussion:
        raise HTTPException(status_code=404, detail="Discussion not found")

    # Get the community and check read access
    community_statement = select(Community).where(
        Community.id == discussion.community_id
    )
    community = db_session.exec(community_statement).first()

    if not community:
        raise HTTPException(status_code=404, detail="Community not found")

    await check_resource_access(
        request, db_session, current_user, community.community_uuid, AccessAction.READ
    )

    # Get all reactions for this discussion
    reactions_statement = select(DiscussionReaction).where(
        DiscussionReaction.discussion_id == discussion.id
    )
    reactions = db_session.exec(reactions_statement).all()

    # Group reactions by emoji
    emoji_groups: dict = {}
    for reaction in reactions:
        if reaction.emoji not in emoji_groups:
            emoji_groups[reaction.emoji] = []
        emoji_groups[reaction.emoji].append(reaction)

    # Build summary with user info
    summaries = []
    for emoji, emoji_reactions in emoji_groups.items():
        # Get user IDs
        user_ids = [r.user_id for r in emoji_reactions]

        # Fetch users
        users_statement = select(User).where(User.id.in_(user_ids))  # type: ignore
        users = db_session.exec(users_statement).all()

        # Build user list
        user_list = [
            ReactionUser(
                id=u.id,
                user_uuid=u.user_uuid,
                username=u.username,
                first_name=u.first_name,
                last_name=u.last_name,
                avatar_image=u.avatar_image,
            )
            for u in users
        ]

        # Check if current user has reacted with this emoji
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
    db_session: Session,
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
    discussion = db_session.exec(discussion_statement).first()

    if not discussion:
        raise HTTPException(status_code=404, detail="Discussion not found")

    # Get the community and check read access
    community_statement = select(Community).where(
        Community.id == discussion.community_id
    )
    community = db_session.exec(community_statement).first()

    if not community:
        raise HTTPException(status_code=404, detail="Community not found")

    await check_resource_access(
        request, db_session, current_user, community.community_uuid, AccessAction.READ
    )

    # Check if user has already reacted with this emoji
    existing_reaction_statement = select(DiscussionReaction).where(
        DiscussionReaction.discussion_id == discussion.id,
        DiscussionReaction.user_id == current_user.id,
        DiscussionReaction.emoji == emoji,
    )
    existing_reaction = db_session.exec(existing_reaction_statement).first()

    if existing_reaction:
        # Remove the reaction
        db_session.delete(existing_reaction)
        db_session.commit()
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
        db_session.commit()
        return {"action": "added", "emoji": emoji}
