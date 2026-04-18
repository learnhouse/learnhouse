from typing import Optional
from fastapi import HTTPException, status
from sqlmodel import Session, select


async def check_element_type(element_uuid):
    """
    Check if the element is a course, a user, a house or a collection, by checking its prefix
    """
    if element_uuid.startswith("course_") or element_uuid.startswith("courseupdate_"):
        return "courses"
    elif element_uuid.startswith("user_"):
        return "users"
    elif element_uuid.startswith("usergroup_"):
        return "usergroups"
    elif element_uuid.startswith("house_"):
        return "houses"
    elif element_uuid.startswith("org_"):
        return "organizations"
    elif element_uuid.startswith("chapter_"):
        return "coursechapters"
    elif element_uuid.startswith("collection_"):
        return "collections"
    elif element_uuid.startswith("activity_"):
        return "activities"
    elif element_uuid.startswith("role_"):
        return "roles"
    elif element_uuid.startswith("community_"):
        return "communities"
    elif element_uuid.startswith("discussion_"):
        return "discussions"
    elif element_uuid.startswith("vote_"):
        return "votes"
    elif element_uuid.startswith("podcast_"):
        return "podcasts"
    elif element_uuid.startswith("episode_"):
        return "episodes"
    elif element_uuid.startswith("board_"):
        return "boards"
    elif element_uuid.startswith("playground_"):
        return "playgrounds"
    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User rights : Issue verifying element nature",
        )


async def check_course_permissions_with_own(
    element_rights,
    action: str,
    is_author: bool = False
) -> bool:
    """
    Check course-specific permissions including "own" permissions.

    Args:
        element_rights: The rights object for courses (PermissionsWithOwn) or dict from JSON
        action: The action to check ("read", "update", "delete", "create")
        is_author: Whether the user is the author of the course

    Returns:
        bool: True if permission is granted, False otherwise
    """
    if not element_rights:
        return False

    # Handle both dict (from JSON storage) and object access
    def get_permission(key: str) -> bool:
        if isinstance(element_rights, dict):
            return element_rights.get(key, False)
        return getattr(element_rights, key, False)

    # Check for general permission first
    if get_permission(f"action_{action}"):
        return True

    # Check for "own" permission if user is the author
    if is_author:
        own_action = f"action_{action}_own"
        if get_permission(own_action):
            return True

    return False


async def get_singular_form_of_element(element_uuid):
    element_type = await check_element_type(element_uuid)

    if element_type == "activities":
        return "activity"
    else:
        singular_form_element = element_type[:-1]
        return singular_form_element


async def get_id_identifier_of_element(element_uuid):
    singular_form_element = await get_singular_form_of_element(element_uuid)

    if singular_form_element == "organization":
        return "org_id"
    else:
        return str(singular_form_element) + "_id"


async def get_element_organization_id(
    element_uuid: str,
    db_session: Session,
) -> Optional[int]:
    """
    Get the organization ID that an element belongs to.

    This is CRITICAL for API token authorization - tokens can only access
    resources within their organization.

    Args:
        element_uuid: The UUID of the element
        db_session: Database session

    Returns:
        Optional[int]: The organization ID, or None if not applicable
    """
    # Import models here to avoid circular imports
    from src.db.courses.courses import Course
    from src.db.courses.chapters import Chapter
    from src.db.courses.activities import Activity
    from src.db.collections import Collection
    from src.db.organizations import Organization
    from src.db.roles import Role
    from src.db.usergroups import UserGroup

    element_type = await check_element_type(element_uuid)

    if element_type == "courses":
        return db_session.exec(select(Course.org_id).where(Course.course_uuid == element_uuid)).first()

    elif element_type == "coursechapters":
        # Chapter stores org_id directly, no need to join Course
        return db_session.exec(select(Chapter.org_id).where(Chapter.chapter_uuid == element_uuid)).first()

    elif element_type == "activities":
        # Activity stores org_id directly, no need to join Course
        return db_session.exec(select(Activity.org_id).where(Activity.activity_uuid == element_uuid)).first()

    elif element_type == "collections":
        return db_session.exec(select(Collection.org_id).where(Collection.collection_uuid == element_uuid)).first()

    elif element_type == "organizations":
        return db_session.exec(select(Organization.id).where(Organization.org_uuid == element_uuid)).first()

    elif element_type == "roles":
        return db_session.exec(select(Role.org_id).where(Role.role_uuid == element_uuid)).first()

    elif element_type == "usergroups":
        return db_session.exec(select(UserGroup.org_id).where(UserGroup.usergroup_uuid == element_uuid)).first()

    elif element_type == "users":
        return None

    elif element_type == "houses":
        return None

    elif element_type == "communities":
        from src.db.communities.communities import Community
        return db_session.exec(select(Community.org_id).where(Community.community_uuid == element_uuid)).first()

    elif element_type == "discussions":
        from src.db.communities.discussions import Discussion
        return db_session.exec(select(Discussion.org_id).where(Discussion.discussion_uuid == element_uuid)).first()

    elif element_type == "votes":
        from src.db.communities.discussion_votes import DiscussionVote
        from src.db.communities.discussions import Discussion
        return db_session.exec(
            select(Discussion.org_id)
            .join(DiscussionVote, Discussion.id == DiscussionVote.discussion_id)
            .where(DiscussionVote.vote_uuid == element_uuid)
        ).first()

    elif element_type == "podcasts":
        from src.db.podcasts.podcasts import Podcast
        return db_session.exec(select(Podcast.org_id).where(Podcast.podcast_uuid == element_uuid)).first()

    elif element_type == "episodes":
        from src.db.podcasts.episodes import PodcastEpisode
        from src.db.podcasts.podcasts import Podcast
        return db_session.exec(
            select(Podcast.org_id)
            .join(PodcastEpisode, Podcast.id == PodcastEpisode.podcast_id)
            .where(PodcastEpisode.episode_uuid == element_uuid)
        ).first()

    elif element_type == "boards":
        from src.db.boards import Board
        return db_session.exec(select(Board.org_id).where(Board.board_uuid == element_uuid)).first()

    return None
