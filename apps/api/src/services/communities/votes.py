from typing import List, Dict, Union
from uuid import uuid4
from datetime import datetime
from sqlmodel import Session, select
from fastapi import HTTPException, Request

from src.db.users import PublicUser, AnonymousUser, APITokenUser
from src.db.communities.communities import Community
from src.db.communities.discussions import Discussion
from src.db.communities.discussion_votes import DiscussionVote, DiscussionVoteRead
from src.security.rbac import check_resource_access, AccessAction, authorization_verify_if_user_is_anon


async def upvote_discussion(
    request: Request,
    discussion_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
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

    # Check if user has already voted
    existing_vote_statement = select(DiscussionVote).where(
        DiscussionVote.discussion_id == discussion.id,
        DiscussionVote.user_id == current_user.id,
    )
    existing_vote = db_session.exec(existing_vote_statement).first()

    if existing_vote:
        raise HTTPException(
            status_code=400,
            detail="You have already upvoted this discussion",
        )

    # Create vote
    vote = DiscussionVote(
        discussion_id=discussion.id,
        user_id=current_user.id,
        vote_uuid=f"vote_{uuid4()}",
        creation_date=str(datetime.now()),
    )

    db_session.add(vote)

    # Increment upvote count
    discussion.upvote_count += 1
    db_session.add(discussion)

    db_session.commit()
    db_session.refresh(vote)

    return DiscussionVoteRead.model_validate(vote.model_dump())


async def remove_upvote(
    request: Request,
    discussion_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
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
    discussion = db_session.exec(discussion_statement).first()

    if not discussion:
        raise HTTPException(status_code=404, detail="Discussion not found")

    # Find existing vote
    vote_statement = select(DiscussionVote).where(
        DiscussionVote.discussion_id == discussion.id,
        DiscussionVote.user_id == current_user.id,
    )
    vote = db_session.exec(vote_statement).first()

    if not vote:
        raise HTTPException(
            status_code=400,
            detail="You have not upvoted this discussion",
        )

    # Delete vote
    db_session.delete(vote)

    # Decrement upvote count (minimum 0)
    discussion.upvote_count = max(0, discussion.upvote_count - 1)
    db_session.add(discussion)

    db_session.commit()

    return {"detail": "Upvote removed"}


async def get_user_votes_for_discussions(
    request: Request,
    discussion_uuids: List[str],
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
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
    discussions = db_session.exec(discussions_statement).all()
    discussion_id_to_uuid = {d.id: d.discussion_uuid for d in discussions}

    # Get user's votes for these discussions
    votes_statement = select(DiscussionVote).where(
        DiscussionVote.discussion_id.in_(discussion_id_to_uuid.keys()),  # type: ignore
        DiscussionVote.user_id == current_user.id,
    )
    votes = db_session.exec(votes_statement).all()
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
