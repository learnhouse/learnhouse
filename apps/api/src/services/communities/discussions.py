from typing import List, Union, Optional
from uuid import uuid4
from datetime import datetime, timezone
from enum import Enum
from sqlmodel import Session, select
from fastapi import HTTPException, Request

from src.db.users import PublicUser, AnonymousUser, APITokenUser, User, UserRead
from src.db.communities.communities import Community
from src.db.communities.discussions import (
    Discussion,
    DiscussionReadWithVoteStatus,
    DiscussionUpdate,
    DISCUSSION_LABELS,
)
from src.db.communities.discussion_votes import DiscussionVote
from src.security.rbac import (
    check_resource_access,
    AccessAction,
    authorization_verify_if_user_is_anon,
    authorization_verify_based_on_org_admin_status,
)
from src.services.communities.moderation import validate_discussion_content


class DiscussionSortBy(str, Enum):
    RECENT = "recent"      # ORDER BY creation_date DESC
    UPVOTES = "upvotes"    # ORDER BY upvote_count DESC
    HOT = "hot"            # ORDER BY hot_score DESC


def calculate_hot_score(upvotes: int, creation_date: str) -> float:
    """
    Calculate hot score using Hacker News algorithm.

    Formula: (votes - 1) / (hours + 2)^1.8

    This ensures:
    - New posts get initial visibility
    - Posts decay naturally over time
    - High-voted posts stay visible longer
    """
    GRAVITY = 1.8  # Higher = faster decay
    BASE_HOURS = 2  # Prevents division issues for new posts

    try:
        created = datetime.fromisoformat(creation_date.replace("Z", "+00:00"))
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
    except (ValueError, AttributeError):
        created = datetime.now(timezone.utc)

    now = datetime.now(timezone.utc)
    hours = max(0, (now - created).total_seconds() / 3600)

    return (upvotes - 1) / pow(hours + BASE_HOURS, GRAVITY)


def validate_label(label: str) -> str:
    """Validate that the label is a valid discussion label."""
    valid_labels = {label_def["id"] for label_def in DISCUSSION_LABELS}
    if label not in valid_labels:
        return "general"
    return label


async def create_discussion(
    request: Request,
    community_uuid: str,
    title: str,
    content: str,
    label: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
    emoji: Optional[str] = None,
) -> DiscussionReadWithVoteStatus:
    """
    Create a new discussion in a community.

    Requires authenticated user who can read the community.
    Author automatically upvotes their own discussion.
    """
    # Verify user is not anonymous
    await authorization_verify_if_user_is_anon(current_user.id)

    # Check if user can read the community
    await check_resource_access(
        request, db_session, current_user, community_uuid, AccessAction.READ
    )

    # Get the community
    community_statement = select(Community).where(
        Community.community_uuid == community_uuid
    )
    community = db_session.exec(community_statement).first()

    if not community:
        raise HTTPException(status_code=404, detail="Community not found")

    # Check content moderation
    await validate_discussion_content(title, content, community.id, db_session)

    # Validate label
    validated_label = validate_label(label)

    # Create discussion
    discussion = Discussion(
        title=title,
        content=content,
        label=validated_label,
        emoji=emoji,
        community_id=community.id,
        org_id=community.org_id,
        author_id=current_user.id,
        discussion_uuid=f"discussion_{uuid4()}",
        upvote_count=1,  # Author's auto-upvote
        is_pinned=False,
        is_locked=False,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(discussion)
    db_session.commit()
    db_session.refresh(discussion)

    # Create auto-upvote from author
    vote = DiscussionVote(
        discussion_id=discussion.id,
        user_id=current_user.id,
        vote_uuid=f"vote_{uuid4()}",
        creation_date=str(datetime.now()),
    )
    db_session.add(vote)
    db_session.commit()

    # Get author info
    author_statement = select(User).where(User.id == discussion.author_id)
    author = db_session.exec(author_statement).first()

    return DiscussionReadWithVoteStatus(
        **discussion.model_dump(),
        author=UserRead.model_validate(author.model_dump()) if author else None,
        has_voted=True,
    )


async def get_discussion(
    request: Request,
    discussion_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> DiscussionReadWithVoteStatus:
    """
    Get a discussion by UUID.
    """
    # Get discussion
    statement = select(Discussion).where(Discussion.discussion_uuid == discussion_uuid)
    discussion = db_session.exec(statement).first()

    if not discussion:
        raise HTTPException(status_code=404, detail="Discussion not found")

    # Get community and check access
    community_statement = select(Community).where(Community.id == discussion.community_id)
    community = db_session.exec(community_statement).first()

    if not community:
        raise HTTPException(status_code=404, detail="Community not found")

    await check_resource_access(request, db_session, current_user, community.community_uuid, AccessAction.READ)

    # Get author info
    author_statement = select(User).where(User.id == discussion.author_id)
    author = db_session.exec(author_statement).first()

    # Check if user has voted
    has_voted = False
    if current_user.id != 0:
        vote_statement = select(DiscussionVote).where(
            DiscussionVote.discussion_id == discussion.id,
            DiscussionVote.user_id == current_user.id,
        )
        vote = db_session.exec(vote_statement).first()
        has_voted = vote is not None

    return DiscussionReadWithVoteStatus(
        **discussion.model_dump(),
        author=UserRead.model_validate(author.model_dump()) if author else None,
        has_voted=has_voted,
    )


async def get_discussions_by_community(
    request: Request,
    community_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
    sort_by: DiscussionSortBy = DiscussionSortBy.RECENT,
    page: int = 1,
    limit: int = 10,
    label: Optional[str] = None,
) -> List[DiscussionReadWithVoteStatus]:
    """
    Get paginated list of discussions for a community with sorting.
    Pinned discussions are always returned first.
    """
    # Check if user can read the community
    await check_resource_access(
        request, db_session, current_user, community_uuid, AccessAction.READ
    )

    # Get the community
    community_statement = select(Community).where(
        Community.community_uuid == community_uuid
    )
    community = db_session.exec(community_statement).first()

    if not community:
        raise HTTPException(status_code=404, detail="Community not found")

    offset = (page - 1) * limit

    # Base query
    query = select(Discussion).where(Discussion.community_id == community.id)

    # Apply label filter if specified
    if label:
        query = query.where(Discussion.label == label)

    # For first page, get pinned discussions first
    pinned_discussions = []
    if page == 1:
        pinned_query = select(Discussion).where(
            Discussion.community_id == community.id,
            Discussion.is_pinned == True,
        )
        if label:
            pinned_query = pinned_query.where(Discussion.label == label)
        pinned_discussions = list(db_session.exec(pinned_query).all())

    # Get non-pinned discussions with sorting
    non_pinned_query = select(Discussion).where(
        Discussion.community_id == community.id,
        Discussion.is_pinned == False,
    )
    if label:
        non_pinned_query = non_pinned_query.where(Discussion.label == label)

    # Apply sorting
    if sort_by == DiscussionSortBy.RECENT:
        non_pinned_query = non_pinned_query.order_by(Discussion.creation_date.desc())  # type: ignore
    elif sort_by == DiscussionSortBy.UPVOTES:
        non_pinned_query = non_pinned_query.order_by(Discussion.upvote_count.desc())  # type: ignore
    # For HOT sorting, we'll fetch all and sort in Python

    # Calculate adjusted offset and limit for non-pinned discussions
    pinned_count = len(pinned_discussions) if page == 1 else 0
    adjusted_offset = max(0, offset - pinned_count) if page > 1 else 0
    adjusted_limit = limit - pinned_count if page == 1 else limit

    if adjusted_limit > 0:
        non_pinned_query = non_pinned_query.offset(adjusted_offset).limit(adjusted_limit)
        non_pinned_discussions = list(db_session.exec(non_pinned_query).all())
    else:
        non_pinned_discussions = []

    # If hot sorting, calculate scores and sort
    if sort_by == DiscussionSortBy.HOT and non_pinned_discussions:
        discussions_with_scores = [
            (d, calculate_hot_score(d.upvote_count, d.creation_date))
            for d in non_pinned_discussions
        ]
        discussions_with_scores.sort(key=lambda x: x[1], reverse=True)
        non_pinned_discussions = [d[0] for d in discussions_with_scores]

    # Combine: pinned first (only on page 1), then non-pinned
    discussions = (pinned_discussions if page == 1 else []) + non_pinned_discussions

    # Get all discussion IDs for batch operations
    discussion_ids = [d.id for d in discussions]
    author_ids = [d.author_id for d in discussions]

    # Batch fetch authors
    if author_ids:
        authors_query = select(User).where(User.id.in_(author_ids))  # type: ignore
        authors = db_session.exec(authors_query).all()
        authors_map = {a.id: a for a in authors}
    else:
        authors_map = {}

    # Batch fetch user votes
    user_votes = set()
    if current_user.id != 0 and discussion_ids:
        votes_query = select(DiscussionVote).where(
            DiscussionVote.discussion_id.in_(discussion_ids),  # type: ignore
            DiscussionVote.user_id == current_user.id,
        )
        votes = db_session.exec(votes_query).all()
        user_votes = {v.discussion_id for v in votes}

    # Build response
    result = []
    for discussion in discussions:
        author = authors_map.get(discussion.author_id)
        has_voted = discussion.id in user_votes

        result.append(
            DiscussionReadWithVoteStatus(
                **discussion.model_dump(),
                author=UserRead.model_validate(author.model_dump()) if author else None,
                has_voted=has_voted,
            )
        )

    return result


async def update_discussion(
    request: Request,
    discussion_uuid: str,
    discussion_object: DiscussionUpdate,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> DiscussionReadWithVoteStatus:
    """
    Update a discussion.

    Requires discussion author or admin role.
    Authors can edit their discussions up to 2 times.
    """
    # Verify user is not anonymous
    await authorization_verify_if_user_is_anon(current_user.id)

    # Get discussion
    statement = select(Discussion).where(Discussion.discussion_uuid == discussion_uuid)
    discussion = db_session.exec(statement).first()

    if not discussion:
        raise HTTPException(status_code=404, detail="Discussion not found")

    # Get community
    community_statement = select(Community).where(Community.id == discussion.community_id)
    community = db_session.exec(community_statement).first()

    if not community:
        raise HTTPException(status_code=404, detail="Community not found")

    # Check if user is author or admin
    is_author = discussion.author_id == current_user.id
    is_admin = await authorization_verify_based_on_org_admin_status(
        request, current_user.id, "update", community.community_uuid, db_session
    )

    if not is_author and not is_admin:
        raise HTTPException(status_code=403, detail="You don't have permission to update this discussion")

    # Check edit limit for authors (admins can edit unlimited)
    is_author = discussion.author_id == current_user.id
    max_edits = 2

    if is_author and discussion.edit_count >= max_edits:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "EDIT_LIMIT_REACHED",
                "message": f"You have reached the maximum number of edits ({max_edits}). You can no longer edit this discussion.",
                "edit_count": discussion.edit_count,
                "max_edits": max_edits,
            }
        )

    # Check content moderation for updated fields
    title_to_check = discussion_object.title if discussion_object.title is not None else discussion.title
    content_to_check = discussion_object.content if discussion_object.content is not None else discussion.content
    await validate_discussion_content(title_to_check, content_to_check or "", discussion.community_id, db_session)

    # Update fields
    if discussion_object.title is not None:
        discussion.title = discussion_object.title
    if discussion_object.content is not None:
        discussion.content = discussion_object.content
    if discussion_object.label is not None:
        discussion.label = validate_label(discussion_object.label)
    if discussion_object.emoji is not None:
        # Allow setting emoji to empty string to clear it
        discussion.emoji = discussion_object.emoji if discussion_object.emoji else None

    # Increment edit count for authors
    if is_author:
        discussion.edit_count += 1

    discussion.update_date = str(datetime.now())

    db_session.add(discussion)
    db_session.commit()
    db_session.refresh(discussion)

    # Get author info
    author_statement = select(User).where(User.id == discussion.author_id)
    author = db_session.exec(author_statement).first()

    # Check if user has voted
    vote_statement = select(DiscussionVote).where(
        DiscussionVote.discussion_id == discussion.id,
        DiscussionVote.user_id == current_user.id,
    )
    vote = db_session.exec(vote_statement).first()

    return DiscussionReadWithVoteStatus(
        **discussion.model_dump(),
        author=UserRead.model_validate(author.model_dump()) if author else None,
        has_voted=vote is not None,
    )


async def pin_discussion(
    request: Request,
    discussion_uuid: str,
    is_pinned: bool,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> DiscussionReadWithVoteStatus:
    """
    Pin or unpin a discussion.

    Requires discussion author or admin role.
    """
    # Verify user is not anonymous
    await authorization_verify_if_user_is_anon(current_user.id)

    # Get discussion
    statement = select(Discussion).where(Discussion.discussion_uuid == discussion_uuid)
    discussion = db_session.exec(statement).first()

    if not discussion:
        raise HTTPException(status_code=404, detail="Discussion not found")

    # Get community
    community_statement = select(Community).where(Community.id == discussion.community_id)
    community = db_session.exec(community_statement).first()

    if not community:
        raise HTTPException(status_code=404, detail="Community not found")

    # Check if user is author or admin
    is_author = discussion.author_id == current_user.id
    is_admin = await authorization_verify_based_on_org_admin_status(
        request, current_user.id, "update", community.community_uuid, db_session
    )

    if not is_author and not is_admin:
        raise HTTPException(status_code=403, detail="You don't have permission to pin this discussion")

    discussion.is_pinned = is_pinned
    discussion.update_date = str(datetime.now())

    db_session.add(discussion)
    db_session.commit()
    db_session.refresh(discussion)

    # Get author info
    author_statement = select(User).where(User.id == discussion.author_id)
    author = db_session.exec(author_statement).first()

    # Check if user has voted
    vote_statement = select(DiscussionVote).where(
        DiscussionVote.discussion_id == discussion.id,
        DiscussionVote.user_id == current_user.id,
    )
    vote = db_session.exec(vote_statement).first()

    return DiscussionReadWithVoteStatus(
        **discussion.model_dump(),
        author=UserRead.model_validate(author.model_dump()) if author else None,
        has_voted=vote is not None,
    )


async def lock_discussion(
    request: Request,
    discussion_uuid: str,
    is_locked: bool,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> DiscussionReadWithVoteStatus:
    """
    Lock or unlock a discussion.

    Requires discussion author or admin role.
    """
    # Verify user is not anonymous
    await authorization_verify_if_user_is_anon(current_user.id)

    # Get discussion
    statement = select(Discussion).where(Discussion.discussion_uuid == discussion_uuid)
    discussion = db_session.exec(statement).first()

    if not discussion:
        raise HTTPException(status_code=404, detail="Discussion not found")

    # Get community
    community_statement = select(Community).where(Community.id == discussion.community_id)
    community = db_session.exec(community_statement).first()

    if not community:
        raise HTTPException(status_code=404, detail="Community not found")

    # Check if user is author or admin
    is_author = discussion.author_id == current_user.id
    is_admin = await authorization_verify_based_on_org_admin_status(
        request, current_user.id, "update", community.community_uuid, db_session
    )

    if not is_author and not is_admin:
        raise HTTPException(status_code=403, detail="You don't have permission to lock this discussion")

    discussion.is_locked = is_locked
    discussion.update_date = str(datetime.now())

    db_session.add(discussion)
    db_session.commit()
    db_session.refresh(discussion)

    # Get author info
    author_statement = select(User).where(User.id == discussion.author_id)
    author = db_session.exec(author_statement).first()

    # Check if user has voted
    vote_statement = select(DiscussionVote).where(
        DiscussionVote.discussion_id == discussion.id,
        DiscussionVote.user_id == current_user.id,
    )
    vote = db_session.exec(vote_statement).first()

    return DiscussionReadWithVoteStatus(
        **discussion.model_dump(),
        author=UserRead.model_validate(author.model_dump()) if author else None,
        has_voted=vote is not None,
    )


async def delete_discussion(
    request: Request,
    discussion_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> dict:
    """
    Delete a discussion.

    Requires discussion author or admin role.
    """
    # Verify user is not anonymous
    await authorization_verify_if_user_is_anon(current_user.id)

    # Get discussion
    statement = select(Discussion).where(Discussion.discussion_uuid == discussion_uuid)
    discussion = db_session.exec(statement).first()

    if not discussion:
        raise HTTPException(status_code=404, detail="Discussion not found")

    # Get community
    community_statement = select(Community).where(Community.id == discussion.community_id)
    community = db_session.exec(community_statement).first()

    if not community:
        raise HTTPException(status_code=404, detail="Community not found")

    # Check if user is author or admin
    is_author = discussion.author_id == current_user.id
    is_admin = await authorization_verify_based_on_org_admin_status(
        request, current_user.id, "delete", community.community_uuid, db_session
    )

    if not is_author and not is_admin:
        raise HTTPException(status_code=403, detail="You don't have permission to delete this discussion")

    db_session.delete(discussion)
    db_session.commit()

    return {"detail": "Discussion deleted"}
