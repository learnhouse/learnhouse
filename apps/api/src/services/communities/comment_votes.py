from typing import List, Dict, Union
from uuid import uuid4
from datetime import datetime
from sqlmodel import Session, select
from fastapi import HTTPException, Request

from src.db.users import PublicUser, AnonymousUser, APITokenUser
from src.db.communities.communities import Community
from src.db.communities.discussions import Discussion
from src.db.communities.discussion_comments import DiscussionComment
from src.db.communities.discussion_comment_votes import (
    DiscussionCommentVote,
    DiscussionCommentVoteRead,
)
from src.security.rbac import check_resource_access, AccessAction, authorization_verify_if_user_is_anon


async def upvote_comment(
    request: Request,
    comment_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> DiscussionCommentVoteRead:
    """
    Upvote a comment.

    Requires authenticated user who can read the community.
    User can only upvote once per comment.
    """
    # Verify user is not anonymous
    await authorization_verify_if_user_is_anon(current_user.id)

    # Get the comment
    comment_statement = select(DiscussionComment).where(
        DiscussionComment.comment_uuid == comment_uuid
    )
    comment = db_session.exec(comment_statement).first()

    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    # Get the discussion
    discussion_statement = select(Discussion).where(
        Discussion.id == comment.discussion_id
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
    existing_vote_statement = select(DiscussionCommentVote).where(
        DiscussionCommentVote.comment_id == comment.id,
        DiscussionCommentVote.user_id == current_user.id,
    )
    existing_vote = db_session.exec(existing_vote_statement).first()

    if existing_vote:
        raise HTTPException(
            status_code=400,
            detail="You have already upvoted this comment",
        )

    # Create vote
    vote = DiscussionCommentVote(
        comment_id=comment.id,
        user_id=current_user.id,
        vote_uuid=f"commentvote_{uuid4()}",
        creation_date=str(datetime.now()),
    )

    db_session.add(vote)

    # Increment upvote count
    comment.upvote_count += 1
    db_session.add(comment)

    db_session.commit()
    db_session.refresh(vote)

    return DiscussionCommentVoteRead.model_validate(vote.model_dump())


async def remove_comment_upvote(
    request: Request,
    comment_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> dict:
    """
    Remove an upvote from a comment.

    Requires authenticated user who has previously voted.
    """
    # Verify user is not anonymous
    await authorization_verify_if_user_is_anon(current_user.id)

    # Get the comment
    comment_statement = select(DiscussionComment).where(
        DiscussionComment.comment_uuid == comment_uuid
    )
    comment = db_session.exec(comment_statement).first()

    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    # Find existing vote
    vote_statement = select(DiscussionCommentVote).where(
        DiscussionCommentVote.comment_id == comment.id,
        DiscussionCommentVote.user_id == current_user.id,
    )
    vote = db_session.exec(vote_statement).first()

    if not vote:
        raise HTTPException(
            status_code=400,
            detail="You have not upvoted this comment",
        )

    # Delete vote
    db_session.delete(vote)

    # Decrement upvote count (minimum 0)
    comment.upvote_count = max(0, comment.upvote_count - 1)
    db_session.add(comment)

    db_session.commit()

    return {"detail": "Upvote removed"}


async def get_user_votes_for_comments(
    comment_ids: List[int],
    user_id: int,
    db_session: Session,
) -> Dict[int, bool]:
    """
    Check if user has voted for multiple comments.

    Returns a dictionary mapping comment_id to voted status.
    """
    if user_id == 0:
        # Anonymous users haven't voted on anything
        return {comment_id: False for comment_id in comment_ids}

    # Get user's votes for these comments
    votes_statement = select(DiscussionCommentVote).where(
        DiscussionCommentVote.comment_id.in_(comment_ids),  # type: ignore
        DiscussionCommentVote.user_id == user_id,
    )
    votes = db_session.exec(votes_statement).all()
    voted_comment_ids = {v.comment_id for v in votes}

    # Build result
    return {comment_id: comment_id in voted_comment_ids for comment_id in comment_ids}
