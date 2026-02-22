"""
RBAC Resource Configurations

This module defines configurations for each resource type that the RBAC system handles.
Adding a new resource type is as simple as adding a new entry to RESOURCE_CONFIGS.
"""

from src.security.rbac.types import ResourceConfig


RESOURCE_CONFIGS: dict[str, ResourceConfig] = {
    # ============================================
    # PRIMARY RESOURCES (have their own access rules)
    # ============================================
    "courses": ResourceConfig(
        resource_type="courses",
        uuid_prefix="course_",
        has_published_field=True,
        supports_usergroups=True,
        supports_authorship=True,
        model_name="Course",
        uuid_field="course_uuid",
    ),
    "podcasts": ResourceConfig(
        resource_type="podcasts",
        uuid_prefix="podcast_",
        has_published_field=True,
        supports_usergroups=True,
        supports_authorship=True,
        model_name="Podcast",
        uuid_field="podcast_uuid",
    ),
    "communities": ResourceConfig(
        resource_type="communities",
        uuid_prefix="community_",
        has_published_field=False,  # Communities only use public flag
        supports_usergroups=True,
        supports_authorship=False,  # Communities don't have authors
        model_name="Community",
        uuid_field="community_uuid",
    ),
    "collections": ResourceConfig(
        resource_type="collections",
        uuid_prefix="collection_",
        has_published_field=False,  # Collections use only public flag
        supports_usergroups=False,
        supports_authorship=False,
        model_name="Collection",
        uuid_field="collection_uuid",
    ),

    "boards": ResourceConfig(
        resource_type="boards",
        uuid_prefix="board_",
        has_published_field=False,
        supports_usergroups=True,
        supports_authorship=True,
        model_name="Board",
        uuid_field="board_uuid",
    ),

    "docspaces": ResourceConfig(
        resource_type="docspaces",
        uuid_prefix="docspace_",
        has_published_field=True,
        supports_usergroups=True,
        supports_authorship=True,
        model_name="DocSpace",
        uuid_field="docspace_uuid",
    ),

    # ============================================
    # CHILD RESOURCES (inherit access from parent)
    # ============================================
    "coursechapters": ResourceConfig(
        resource_type="coursechapters",
        uuid_prefix="chapter_",
        has_published_field=False,  # Inherits from course
        supports_usergroups=False,  # Access via course
        supports_authorship=False,  # Authorship on course level
        model_name="Chapter",
        uuid_field="chapter_uuid",
        parent_resource_type="courses",
        parent_id_field="course_id",
    ),
    "activities": ResourceConfig(
        resource_type="activities",
        uuid_prefix="activity_",
        has_published_field=False,  # Inherits from course via chapter
        supports_usergroups=False,  # Access via course
        supports_authorship=False,  # Authorship on course level
        model_name="Activity",
        uuid_field="activity_uuid",
        parent_resource_type="coursechapters",  # Activity -> Chapter -> Course
        parent_id_field="chapter_id",
    ),
    "episodes": ResourceConfig(
        resource_type="episodes",
        uuid_prefix="episode_",
        has_published_field=False,  # Inherits from podcast
        supports_usergroups=False,  # Access via podcast
        supports_authorship=False,  # Authorship on podcast level
        model_name="PodcastEpisode",
        uuid_field="episode_uuid",
        parent_resource_type="podcasts",
        parent_id_field="podcast_id",
    ),
    "docsections": ResourceConfig(
        resource_type="docsections",
        uuid_prefix="docsection_",
        has_published_field=False,
        supports_usergroups=False,
        supports_authorship=False,
        model_name="DocSection",
        uuid_field="docsection_uuid",
        parent_resource_type="docspaces",
        parent_id_field="docspace_id",
    ),
    "docgroups": ResourceConfig(
        resource_type="docgroups",
        uuid_prefix="docgroup_",
        has_published_field=False,
        supports_usergroups=False,
        supports_authorship=False,
        model_name="DocGroup",
        uuid_field="docgroup_uuid",
        parent_resource_type="docsections",
        parent_id_field="docsection_id",
    ),
    "docpages": ResourceConfig(
        resource_type="docpages",
        uuid_prefix="docpage_",
        has_published_field=False,
        supports_usergroups=False,
        supports_authorship=False,
        model_name="DocPage",
        uuid_field="docpage_uuid",
        parent_resource_type="docsections",
        parent_id_field="docsection_id",
    ),
    "discussions": ResourceConfig(
        resource_type="discussions",
        uuid_prefix="discussion_",
        has_published_field=False,
        supports_usergroups=False,  # Access via community
        supports_authorship=False,  # Discussions have author_id but different pattern
        model_name="Discussion",
        uuid_field="discussion_uuid",
        parent_resource_type="communities",
        parent_id_field="community_id",
    ),
}


def get_resource_config(resource_uuid: str) -> ResourceConfig | None:
    """
    Get the resource configuration based on the UUID prefix.

    Args:
        resource_uuid: The UUID of the resource

    Returns:
        ResourceConfig if found, None otherwise
    """
    # Handle None/empty input to avoid AttributeError
    if not resource_uuid:
        return None

    for config in RESOURCE_CONFIGS.values():
        if resource_uuid.startswith(config.uuid_prefix):
            return config
    return None


def get_resource_type(resource_uuid: str) -> str | None:
    """
    Get the resource type from a UUID.

    Args:
        resource_uuid: The UUID of the resource

    Returns:
        Resource type string if found, None otherwise
    """
    config = get_resource_config(resource_uuid)
    return config.resource_type if config else None
