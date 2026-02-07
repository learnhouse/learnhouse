from typing import List, Union
from uuid import uuid4
from datetime import datetime
from sqlmodel import Session, select
from fastapi import HTTPException, Request

from src.db.users import PublicUser, AnonymousUser, APITokenUser, User, UserRead
from src.db.communities.communities import Community
from src.db.communities.discussions import Discussion
from src.db.communities.discussion_comments import (
    DiscussionComment,
    DiscussionCommentReadWithVoteStatus,
    DiscussionCommentUpdate,
)
from src.services.communities.comment_votes import get_user_votes_for_comments
from src.security.rbac import check_resource_access, AccessAction, authorization_verify_if_user_is_anon
from src.services.communities.moderation import validate_comment_content


async def create_comment(
    request: Request,
    discussion_uuid: str,
    content: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> DiscussionCommentReadWithVoteStatus:
    """
    Create a new comment on a discussion.

    Requires authenticated user who can read the community.
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

    # Check if discussion is locked
    if discussion.is_locked:
        raise HTTPException(
            status_code=403,
            detail="This discussion is locked and cannot receive new comments"
        )

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

    # Check content moderation
    await validate_comment_content(content, community.id, db_session)

    # Create comment
    comment = DiscussionComment(
        content=content,
        discussion_id=discussion.id,
        author_id=current_user.id,
        comment_uuid=f"comment_{uuid4()}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(comment)
    db_session.commit()
    db_session.refresh(comment)

    # Get author info
    author_statement = select(User).where(User.id == comment.author_id)
    author = db_session.exec(author_statement).first()

    return DiscussionCommentReadWithVoteStatus(
        **comment.model_dump(),
        author=UserRead.model_validate(author.model_dump()) if author else None,
        has_voted=False,  # User just created it, hasn't voted yet
    )


async def get_comments_by_discussion(
    request: Request,
    discussion_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
    page: int = 1,
    limit: int = 50,
) -> List[DiscussionCommentReadWithVoteStatus]:
    """
    Get paginated list of comments for a discussion.
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

    offset = (page - 1) * limit

    # Get comments
    query = (
        select(DiscussionComment)
        .where(DiscussionComment.discussion_id == discussion.id)
        .order_by(DiscussionComment.creation_date.asc())  # type: ignore
        .offset(offset)
        .limit(limit)
    )

    comments = db_session.exec(query).all()

    # Batch fetch authors
    author_ids = [c.author_id for c in comments]
    authors_query = select(User).where(User.id.in_(author_ids))  # type: ignore
    authors = db_session.exec(authors_query).all()
    authors_map = {a.id: a for a in authors}

    # Get user's votes for these comments
    comment_ids = [c.id for c in comments]
    user_votes = await get_user_votes_for_comments(
        comment_ids, current_user.id, db_session
    )

    # Build response
    result = []
    for comment in comments:
        author = authors_map.get(comment.author_id)
        result.append(
            DiscussionCommentReadWithVoteStatus(
                **comment.model_dump(),
                author=UserRead.model_validate(author.model_dump()) if author else None,
                has_voted=user_votes.get(comment.id, False),
            )
        )

    return result


async def update_comment(
    request: Request,
    comment_uuid: str,
    comment_update: DiscussionCommentUpdate,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> DiscussionCommentReadWithVoteStatus:
    """
    Update a comment.

    Requires comment author or admin role.
    """
    await authorization_verify_if_user_is_anon(current_user.id)

    # Get the comment
    comment_statement = select(DiscussionComment).where(
        DiscussionComment.comment_uuid == comment_uuid
    )
    comment = db_session.exec(comment_statement).first()

    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    # Check if user is the author
    if comment.author_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="You can only edit your own comments"
        )

    # Get the discussion to find community for moderation
    discussion_statement = select(Discussion).where(
        Discussion.id == comment.discussion_id
    )
    discussion = db_session.exec(discussion_statement).first()

    # Check content moderation for updated content
    if comment_update.content is not None and discussion:
        await validate_comment_content(
            comment_update.content, discussion.community_id, db_session
        )

    # Update fields
    if comment_update.content is not None:
        comment.content = comment_update.content

    comment.update_date = str(datetime.now())

    db_session.add(comment)
    db_session.commit()
    db_session.refresh(comment)

    # Get author info
    author_statement = select(User).where(User.id == comment.author_id)
    author = db_session.exec(author_statement).first()

    # Get user's vote status
    user_votes = await get_user_votes_for_comments(
        [comment.id], current_user.id, db_session
    )

    return DiscussionCommentReadWithVoteStatus(
        **comment.model_dump(),
        author=UserRead.model_validate(author.model_dump()) if author else None,
        has_voted=user_votes.get(comment.id, False),
    )


async def delete_comment(
    request: Request,
    comment_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> dict:
    """
    Delete a comment.

    Requires comment author or admin role.
    """
    await authorization_verify_if_user_is_anon(current_user.id)

    # Get the comment
    comment_statement = select(DiscussionComment).where(
        DiscussionComment.comment_uuid == comment_uuid
    )
    comment = db_session.exec(comment_statement).first()

    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    # Get discussion to check community admin status
    discussion_statement = select(Discussion).where(
        Discussion.id == comment.discussion_id
    )
    discussion = db_session.exec(discussion_statement).first()

    # Check if user is the author or has admin rights
    is_author = comment.author_id == current_user.id

    if not is_author:
        # Check if user is admin of the community
        if discussion:
            community_statement = select(Community).where(
                Community.id == discussion.community_id
            )
            community = db_session.exec(community_statement).first()

            if community:
                try:
                    await check_resource_access(
                        request, db_session, current_user, community.community_uuid, AccessAction.DELETE
                    )
                except HTTPException:
                    raise HTTPException(
                        status_code=403,
                        detail="You can only delete your own comments"
                    )
            else:
                raise HTTPException(
                    status_code=403,
                    detail="You can only delete your own comments"
                )
        else:
            raise HTTPException(
                status_code=403,
                detail="You can only delete your own comments"
            )

    db_session.delete(comment)
    db_session.commit()

    return {"detail": "Comment deleted"}


async def get_comment_count(
    discussion_uuid: str,
    db_session: Session,
) -> int:
    """
    Get the count of comments for a discussion.
    """
    discussion_statement = select(Discussion).where(
        Discussion.discussion_uuid == discussion_uuid
    )
    discussion = db_session.exec(discussion_statement).first()

    if not discussion:
        return 0

    from sqlalchemy import func
    count_statement = select(func.count(DiscussionComment.id)).where(
        DiscussionComment.discussion_id == discussion.id
    )
    count = db_session.exec(count_statement).first()

    return count or 0
