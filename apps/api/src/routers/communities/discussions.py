from typing import List, Dict
from fastapi import APIRouter, Depends, Request, Query
from pydantic import BaseModel
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.db.communities.discussions import (
    DiscussionReadWithVoteStatus,
    DiscussionUpdate,
    DiscussionPinUpdate,
    DiscussionLockUpdate,
    DiscussionLabelInfo,
    DISCUSSION_LABELS,
)
from src.db.communities.discussion_votes import DiscussionVoteRead
from src.db.communities.discussion_comments import (
    DiscussionCommentReadWithVoteStatus,
    DiscussionCommentUpdate,
)
from src.db.communities.discussion_comment_votes import DiscussionCommentVoteRead
from src.db.communities.discussion_reactions import (
    DiscussionReactionSummary,
)
from src.security.auth import get_current_user
from src.services.communities.discussions import (
    create_discussion,
    get_discussion,
    get_discussions_by_community,
    update_discussion,
    delete_discussion,
    pin_discussion,
    lock_discussion,
    DiscussionSortBy,
)
from src.services.communities.votes import (
    upvote_discussion,
    remove_upvote,
    get_user_votes_for_discussions,
)
from src.services.communities.comments import (
    create_comment,
    get_comments_by_discussion,
    update_comment,
    delete_comment,
    get_comment_count,
)
from src.services.communities.comment_votes import (
    upvote_comment,
    remove_comment_upvote,
)
from src.services.communities.reactions import (
    get_reactions,
    toggle_reaction,
)


router = APIRouter()


class DiscussionCreateRequest(BaseModel):
    title: str
    content: str | None = None
    label: str | None = "general"
    emoji: str | None = None


@router.get("/discussions/labels")
async def api_get_discussion_labels() -> List[DiscussionLabelInfo]:
    """
    Get available discussion labels.
    """
    return [DiscussionLabelInfo(**label) for label in DISCUSSION_LABELS]


@router.post("/communities/{community_uuid}/discussions")
async def api_create_discussion(
    request: Request,
    community_uuid: str,
    discussion_data: DiscussionCreateRequest,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> DiscussionReadWithVoteStatus:
    """
    Create a new discussion in a community.

    Requires authenticated user who can read the community.
    """
    return await create_discussion(
        request,
        community_uuid,
        discussion_data.title,
        discussion_data.content or "",
        discussion_data.label or "general",
        current_user,
        db_session,
        emoji=discussion_data.emoji,
    )


@router.get("/communities/{community_uuid}/discussions")
async def api_get_discussions_by_community(
    request: Request,
    community_uuid: str,
    sort_by: DiscussionSortBy = Query(default=DiscussionSortBy.RECENT),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=10, ge=1, le=100),
    label: str | None = Query(default=None),
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[DiscussionReadWithVoteStatus]:
    """
    Get paginated list of discussions for a community with sorting.

    Sort options:
    - recent: Order by creation date (newest first)
    - upvotes: Order by upvote count (highest first)
    - hot: Order by hot score (combination of recency and upvotes)

    Optionally filter by label.
    Pinned discussions are always returned first.
    """
    return await get_discussions_by_community(
        request, community_uuid, current_user, db_session, sort_by, page, limit, label
    )


@router.get("/discussions/{discussion_uuid}")
async def api_get_discussion(
    request: Request,
    discussion_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> DiscussionReadWithVoteStatus:
    """
    Get a discussion by UUID.
    """
    return await get_discussion(request, discussion_uuid, current_user, db_session)


@router.put("/discussions/{discussion_uuid}")
async def api_update_discussion(
    request: Request,
    discussion_uuid: str,
    discussion_data: DiscussionUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> DiscussionReadWithVoteStatus:
    """
    Update a discussion.

    Requires discussion author or admin role.
    """
    return await update_discussion(
        request, discussion_uuid, discussion_data, current_user, db_session
    )


@router.put("/discussions/{discussion_uuid}/pin")
async def api_pin_discussion(
    request: Request,
    discussion_uuid: str,
    pin_data: DiscussionPinUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> DiscussionReadWithVoteStatus:
    """
    Pin or unpin a discussion.

    Requires discussion author or admin role.
    """
    return await pin_discussion(
        request, discussion_uuid, pin_data.is_pinned, current_user, db_session
    )


@router.put("/discussions/{discussion_uuid}/lock")
async def api_lock_discussion(
    request: Request,
    discussion_uuid: str,
    lock_data: DiscussionLockUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> DiscussionReadWithVoteStatus:
    """
    Lock or unlock a discussion.

    Requires discussion author or admin role.
    """
    return await lock_discussion(
        request, discussion_uuid, lock_data.is_locked, current_user, db_session
    )


@router.delete("/discussions/{discussion_uuid}")
async def api_delete_discussion(
    request: Request,
    discussion_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> dict:
    """
    Delete a discussion.

    Requires discussion author or admin role.
    """
    return await delete_discussion(request, discussion_uuid, current_user, db_session)


@router.post("/discussions/{discussion_uuid}/vote")
async def api_upvote_discussion(
    request: Request,
    discussion_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> DiscussionVoteRead:
    """
    Upvote a discussion.

    Requires authenticated user who can read the community.
    """
    return await upvote_discussion(request, discussion_uuid, current_user, db_session)


@router.delete("/discussions/{discussion_uuid}/vote")
async def api_remove_upvote(
    request: Request,
    discussion_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> dict:
    """
    Remove an upvote from a discussion.

    Requires authenticated user who has previously voted.
    """
    return await remove_upvote(request, discussion_uuid, current_user, db_session)


@router.post("/discussions/votes/batch")
async def api_get_user_votes_batch(
    request: Request,
    discussion_uuids: List[str],
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> Dict[str, bool]:
    """
    Batch check if user has voted for multiple discussions.

    Returns a dictionary mapping discussion_uuid to voted status.
    """
    return await get_user_votes_for_discussions(
        request, discussion_uuids, current_user, db_session
    )


# ============================================================================
# Comment Endpoints
# ============================================================================


class CommentCreateRequest(BaseModel):
    content: str


@router.post("/discussions/{discussion_uuid}/comments")
async def api_create_comment(
    request: Request,
    discussion_uuid: str,
    comment_data: CommentCreateRequest,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> DiscussionCommentReadWithVoteStatus:
    """
    Create a new comment on a discussion.

    Requires authenticated user who can read the community.
    Discussion must not be locked.
    """
    return await create_comment(
        request,
        discussion_uuid,
        comment_data.content,
        current_user,
        db_session,
    )


@router.get("/discussions/{discussion_uuid}/comments")
async def api_get_comments_by_discussion(
    request: Request,
    discussion_uuid: str,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[DiscussionCommentReadWithVoteStatus]:
    """
    Get paginated list of comments for a discussion.
    """
    return await get_comments_by_discussion(
        request, discussion_uuid, current_user, db_session, page, limit
    )


@router.get("/discussions/{discussion_uuid}/comments/count")
async def api_get_comment_count(
    discussion_uuid: str,
    db_session: Session = Depends(get_db_session),
) -> dict:
    """
    Get the count of comments for a discussion.
    """
    count = await get_comment_count(discussion_uuid, db_session)
    return {"count": count}


@router.put("/comments/{comment_uuid}")
async def api_update_comment(
    request: Request,
    comment_uuid: str,
    comment_data: DiscussionCommentUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> DiscussionCommentReadWithVoteStatus:
    """
    Update a comment.

    Requires comment author.
    """
    return await update_comment(
        request, comment_uuid, comment_data, current_user, db_session
    )


@router.post("/comments/{comment_uuid}/vote")
async def api_upvote_comment(
    request: Request,
    comment_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> DiscussionCommentVoteRead:
    """
    Upvote a comment.

    Requires authenticated user who can read the community.
    """
    return await upvote_comment(request, comment_uuid, current_user, db_session)


@router.delete("/comments/{comment_uuid}/vote")
async def api_remove_comment_upvote(
    request: Request,
    comment_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> dict:
    """
    Remove an upvote from a comment.

    Requires authenticated user who has previously voted.
    """
    return await remove_comment_upvote(request, comment_uuid, current_user, db_session)


@router.delete("/comments/{comment_uuid}")
async def api_delete_comment(
    request: Request,
    comment_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> dict:
    """
    Delete a comment.

    Requires comment author or community admin.
    """
    return await delete_comment(request, comment_uuid, current_user, db_session)


# ============================================================================
# Reaction Endpoints
# ============================================================================


class ReactionRequest(BaseModel):
    emoji: str


@router.get("/discussions/{discussion_uuid}/reactions")
async def api_get_reactions(
    request: Request,
    discussion_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[DiscussionReactionSummary]:
    """
    Get all reactions for a discussion, grouped by emoji.

    Returns a list of reaction summaries with:
    - emoji: The emoji used
    - count: Number of users who reacted with this emoji
    - users: List of users who reacted (for tooltip display)
    - has_reacted: Whether the current user has reacted with this emoji
    """
    return await get_reactions(request, discussion_uuid, current_user, db_session)


@router.post("/discussions/{discussion_uuid}/reactions")
async def api_toggle_reaction(
    request: Request,
    discussion_uuid: str,
    reaction_data: ReactionRequest,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> dict:
    """
    Toggle a reaction on a discussion.

    If the user has already reacted with this emoji, it will be removed.
    If the user has not reacted with this emoji, it will be added.

    Requires authenticated user who can read the community.
    """
    return await toggle_reaction(
        request, discussion_uuid, reaction_data.emoji, current_user, db_session
    )
