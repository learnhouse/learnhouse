from typing import List, Dict, Union
from uuid import uuid4
from datetime import datetime
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy import update as sql_update
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException, Request

from src.db.users import PublicUser, AnonymousUser, APITokenUser
from src.db.communities.communities import Community
from src.db.communities.discussions import Discussion
from src.db.communities.discussion_votes import DiscussionVote, DiscussionVoteRead
from src.security.rbac import check_resource_access, AccessAction, authorization_verify_if_user_is_anon
from src.services.webhooks.dispatch import dispatch_webhooks


async def upvote_discussion(
    request: Request,
    discussion_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: AsyncSession,
) -> DiscussionVoteRead:
    """
    Upvote a discussion.

    Requires authenticated user who can read the community.
    User can only upvote once per discussion.
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

    existing_vote = (await db_session.execute(
        select(DiscussionVote).where(
            DiscussionVote.discussion_id == discussion.id,
            DiscussionVote.user_id == current_user.id,
        )
    )).scalars().first()
    if existing_vote:
        raise HTTPException(
            status_code=400,
            detail="You have already upvoted this discussion",
        )

    vote = DiscussionVote(
        discussion_id=discussion.id,
        user_id=current_user.id,
        vote_uuid=f"vote_{uuid4()}",
        creation_date=str(datetime.now()),
    )
    try:
        db_session.add(vote)
        await db_session.execute(
            sql_update(Discussion)
            .where(Discussion.id == discussion.id)
            .values(upvote_count=Discussion.upvote_count + 1)
        )
        await db_session.commit()
    except IntegrityError:
        await db_session.rollback()
        raise HTTPException(
            status_code=400,
            detail="You have already upvoted this discussion",
        )

    await db_session.refresh(vote)
    await db_session.refresh(discussion)

    await dispatch_webhooks(
        event_name="discussion_vote_cast",
        org_id=community.org_id,
        data={
            "discussion_uuid": discussion.discussion_uuid,
            "user_id": current_user.id,
            "upvote_count": discussion.upvote_count,
        },
    )

    return DiscussionVoteRead.model_validate(vote.model_dump())


async def remove_upvote(
    request: Request,
    discussion_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: AsyncSession,
) -> dict:
    """
    Remove an upvote from a discussion.

    Requires authenticated user who has previously voted.
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

    # Find existing vote
    vote_statement = select(DiscussionVote).where(
        DiscussionVote.discussion_id == discussion.id,
        DiscussionVote.user_id == current_user.id,
    )
    vote = (await db_session.execute(vote_statement)).scalars().first()

    if not vote:
        raise HTTPException(
            status_code=400,
            detail="You have not upvoted this discussion",
        )

    # Delete vote
    await db_session.delete(vote)

    # Atomic decrement (floored at 0). upvote_discussion uses an atomic SQL
    # increment, so the removal path must mirror it: a Python read-modify-write
    # here loses concurrent updates and lets the cached count drift away from
    # the real number of vote rows.
    await db_session.execute(
        sql_update(Discussion)
        .where(Discussion.id == discussion.id, Discussion.upvote_count > 0)
        .values(upvote_count=Discussion.upvote_count - 1)
    )

    await db_session.commit()

    return {"detail": "Upvote removed"}


async def get_user_votes_for_discussions(
    request: Request,
    discussion_uuids: List[str],
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: AsyncSession,
) -> Dict[str, bool]:
    """
    Batch check if user has voted for multiple discussions.

    Returns a dictionary mapping discussion_uuid to voted status.
    """
    if current_user.id == 0:
        # Anonymous users haven't voted on anything
        return {uuid: False for uuid in discussion_uuids}

    # Get discussion IDs from UUIDs
    discussions_statement = select(Discussion).where(
        Discussion.discussion_uuid.in_(discussion_uuids)  # type: ignore
    )
    discussions = (await db_session.execute(discussions_statement)).scalars().all()
    discussion_id_to_uuid = {d.id: d.discussion_uuid for d in discussions}

    # Get user's votes for these discussions
    votes_statement = select(DiscussionVote).where(
        DiscussionVote.discussion_id.in_(discussion_id_to_uuid.keys()),  # type: ignore
        DiscussionVote.user_id == current_user.id,
    )
    votes = (await db_session.execute(votes_statement)).scalars().all()
    voted_discussion_ids = {v.discussion_id for v in votes}

    # Build result
    result = {}
    for uuid in discussion_uuids:
        # Find matching discussion
        discussion_id = None
        for d_id, d_uuid in discussion_id_to_uuid.items():
            if d_uuid == uuid:
                discussion_id = d_id
                break

        result[uuid] = discussion_id in voted_discussion_ids if discussion_id else False

    return result
