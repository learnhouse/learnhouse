"""
Unified Resource Access Checker

This module provides a single, unified access checker for courses, podcasts, and communities.
It replaces the duplicated logic in courses_security.py, podcasts_security.py, and
communities_security.py (~1,200 lines) with a single configurable implementation (~300 lines).

Access Rules:
- Dashboard View: Admins/Authors always see all resources
- Public View:
    - Public + Published: Everyone can see
    - Public + Unpublished: Nobody (except dashboard)
    - UserGroup-linked + Published + User in Group: UserGroup members only
    - Not Public + Not in UserGroup: Authenticated users only
    - Author of resource: Always accessible to author
- Communities: Don't have a published field, only use public flag
"""

import logging
from typing import Union, Optional
from fastapi import HTTPException, Request, status
from sqlmodel import Session, select

from src.db.users import AnonymousUser, PublicUser, APITokenUser
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.security.rbac.types import AccessAction, AccessContext, AccessDecision, ResourceConfig
from src.security.rbac.config import get_resource_config, RESOURCE_CONFIGS
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles,
    authorization_verify_based_on_org_admin_status,
)

logger = logging.getLogger(__name__)


class ResourceAccessChecker:
    """
    Unified access checker for courses, podcasts, and communities.

    Usage:
        checker = ResourceAccessChecker(request, db_session, current_user)
        decision = await checker.check_access(
            resource_uuid,
            AccessAction.READ,
            AccessContext.PUBLIC_VIEW
        )

        if not decision.allowed:
            raise HTTPException(status_code=403, detail=decision.reason)
    """

    def __init__(
        self,
        request: Request,
        db_session: Session,
        current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    ):
        self.request = request
        self.db_session = db_session
        self.current_user = current_user
        # Per-request memoization caches. Within a single request a given course
        # page can trigger check_resource_access 2–3 times; without these caches
        # each call re-runs the same author/admin/usergroup/resource lookups.
        self._resource_cache: dict = {}
        self._author_cache: dict[str, bool] = {}
        self._admin_cache: dict[str, bool] = {}
        self._public_published_cache: dict[str, tuple[bool, bool]] = {}
        self._usergroup_cache: dict[tuple[str, bool], bool] = {}
        self._parent_uuid_cache: dict[str, Optional[str]] = {}

    async def check_access(
        self,
        resource_uuid: str,
        action: AccessAction,
        context: AccessContext = AccessContext.PUBLIC_VIEW,
        require_ownership: bool = False,
    ) -> AccessDecision:
        """
        Main entry point for access checks.

        Args:
            resource_uuid: UUID of the resource to check
            action: The action being performed (read, create, update, delete)
            context: The context (public_view or dashboard)
            require_ownership: If True, requires resource ownership for write operations

        Returns:
            AccessDecision with allowed status and reason
        """
        # Validate input
        if not resource_uuid or not resource_uuid.strip():
            return AccessDecision(
                allowed=False,
                reason="Resource UUID is required",
                resource_uuid=resource_uuid,
                action=action.value,
                context=context.value,
            )

        config = get_resource_config(resource_uuid)
        if not config:
            return AccessDecision(
                allowed=False,
                reason=f"Unknown resource type for UUID: {resource_uuid}",
                resource_uuid=resource_uuid,
                action=action.value,
                context=context.value,
            )

        # For child resources, delegate access check to the parent resource
        # This handles chapters -> courses, episodes -> podcasts, etc.
        if config.parent_resource_type:
            parent_uuid = await self._resolve_parent_resource_uuid(resource_uuid, config)
            if not parent_uuid:
                return AccessDecision(
                    allowed=False,
                    reason=f"Could not find parent resource for {config.resource_type}",
                    resource_uuid=resource_uuid,
                    action=action.value,
                    context=context.value,
                )
            # Recursively check access on the parent
            # The original resource_uuid is preserved in the decision for audit
            decision = await self.check_access(parent_uuid, action, context, require_ownership)
            # Update the decision to reflect the original resource
            decision.resource_uuid = resource_uuid
            return decision

        # Handle API token users separately
        if isinstance(self.current_user, APITokenUser):
            return await self._check_api_token_access(resource_uuid, action, config)

        # Route to appropriate check based on action
        if action == AccessAction.READ:
            return await self._check_read_access(resource_uuid, context, config)
        else:
            return await self._check_write_access(resource_uuid, action, config, require_ownership)

    async def _check_read_access(
        self,
        resource_uuid: str,
        context: AccessContext,
        config: ResourceConfig,
    ) -> AccessDecision:
        """Handle read access checks based on context."""
        user_id = self._get_user_id()

        # Anonymous user
        if user_id == 0:
            return await self._check_anonymous_read_access(resource_uuid, config)

        # Dashboard context: admins/authors see everything
        if context == AccessContext.DASHBOARD:
            return await self._check_dashboard_read_access(resource_uuid, config)

        # Public view context
        return await self._check_public_view_read_access(resource_uuid, config)

    async def _check_anonymous_read_access(
        self,
        resource_uuid: str,
        config: ResourceConfig,
    ) -> AccessDecision:
        """Check if anonymous user can read the resource."""
        is_public, is_published = await self._is_public_and_published(resource_uuid, config)

        # For resources with published field, both must be true
        if config.has_published_field:
            if is_public and is_published:
                return AccessDecision(
                    allowed=True,
                    reason="Resource is public and published",
                    via_public=True,
                    resource_uuid=resource_uuid,
                    user_id=0,
                    action="read",
                )
            return AccessDecision(
                allowed=False,
                reason="Resource is not public or not published",
                resource_uuid=resource_uuid,
                user_id=0,
                action="read",
            )

        # For resources without published field (communities), only check public
        if is_public:
            return AccessDecision(
                allowed=True,
                reason="Resource is public",
                via_public=True,
                resource_uuid=resource_uuid,
                user_id=0,
                action="read",
            )
        return AccessDecision(
            allowed=False,
            reason="Resource is not public",
            resource_uuid=resource_uuid,
            user_id=0,
            action="read",
        )

    async def _check_dashboard_read_access(
        self,
        resource_uuid: str,
        config: ResourceConfig,
    ) -> AccessDecision:
        """Check dashboard read access - admins/authors see everything."""
        user_id = self._get_user_id()

        # Check admin/maintainer status first
        is_admin = await self._is_admin_or_maintainer(resource_uuid)
        if is_admin:
            return AccessDecision(
                allowed=True,
                reason="User is admin/maintainer",
                via_admin=True,
                resource_uuid=resource_uuid,
                user_id=user_id,
                action="read",
                context="dashboard",
            )

        # Check authorship if supported
        if config.supports_authorship:
            is_author = await self._is_resource_author(resource_uuid)
            if is_author:
                return AccessDecision(
                    allowed=True,
                    reason="User is resource author",
                    via_authorship=True,
                    resource_uuid=resource_uuid,
                    user_id=user_id,
                    action="read",
                    context="dashboard",
                )

        # Fall through to public view rules. Note: public_view's usergroup rule
        # requires is_published=True, so usergroup members on unpublished
        # resources still get denied here — which is the intended behavior.
        return await self._check_public_view_read_access(resource_uuid, config)

    async def _check_public_view_read_access(
        self,
        resource_uuid: str,
        config: ResourceConfig,
    ) -> AccessDecision:
        """Check public view read access with full rule chain."""
        user_id = self._get_user_id()
        is_public, is_published = await self._is_public_and_published(resource_uuid, config)

        logger.info(f"[ACCESS_CHECK] resource_uuid={resource_uuid}, user_id={user_id}, is_public={is_public}, is_published={is_published}")

        # Rule 1: Public + published = OK for everyone
        if config.has_published_field:
            if is_public and is_published:
                return AccessDecision(
                    allowed=True,
                    reason="Resource is public and published",
                    via_public=True,
                    resource_uuid=resource_uuid,
                    user_id=user_id,
                    action="read",
                )
        else:
            # No published field (communities) - just check public
            if is_public:
                return AccessDecision(
                    allowed=True,
                    reason="Resource is public",
                    via_public=True,
                    resource_uuid=resource_uuid,
                    user_id=user_id,
                    action="read",
                )

        # Rule 2: Check authorship (if supported)
        if config.supports_authorship:
            is_author = await self._is_resource_author(resource_uuid)
            logger.info(f"[ACCESS_CHECK] Rule 2 - is_author={is_author}")
            if is_author:
                return AccessDecision(
                    allowed=True,
                    reason="User is resource author",
                    via_authorship=True,
                    resource_uuid=resource_uuid,
                    user_id=user_id,
                    action="read",
                )

        # Rule 3: Admin/maintainer always has access
        is_admin = await self._is_admin_or_maintainer(resource_uuid)
        if is_admin:
            return AccessDecision(
                allowed=True,
                reason="User is admin/maintainer",
                via_admin=True,
                resource_uuid=resource_uuid,
                user_id=user_id,
                action="read",
            )

        # Rule 4: Check role-based permissions (only for public resources)
        # Non-public resources should only be accessible via authorship, admin, or usergroup membership
        if is_public:
            has_role_permission = await authorization_verify_based_on_roles(
                self.request, user_id, "read", resource_uuid, self.db_session
            )
            if has_role_permission:
                return AccessDecision(
                    allowed=True,
                    reason="User has role permission",
                    via_role=True,
                    resource_uuid=resource_uuid,
                    user_id=user_id,
                    action="read",
                )

        # Rule 5: Check UserGroup membership (if supported)
        if config.supports_usergroups:
            has_usergroup_access = await self._check_usergroup_membership(resource_uuid, is_public)
            logger.info(f"[ACCESS_CHECK] Rule 5 - has_usergroup_access={has_usergroup_access}, is_published={is_published}")

            # For resources with published field, UserGroup access requires published=True
            if config.has_published_field:
                if has_usergroup_access and is_published:
                    return AccessDecision(
                        allowed=True,
                        reason="User is member of linked UserGroup and resource is published",
                        via_usergroup=True,
                        resource_uuid=resource_uuid,
                        user_id=user_id,
                        action="read",
                    )
            else:
                # No published field - UserGroup access is sufficient
                if has_usergroup_access:
                    return AccessDecision(
                        allowed=True,
                        reason="User is member of linked UserGroup",
                        via_usergroup=True,
                        resource_uuid=resource_uuid,
                        user_id=user_id,
                        action="read",
                    )

        # All checks failed
        return AccessDecision(
            allowed=False,
            reason="User does not have access to this resource",
            resource_uuid=resource_uuid,
            user_id=user_id,
            action="read",
        )

    async def _check_write_access(
        self,
        resource_uuid: str,
        action: AccessAction,
        config: ResourceConfig,
        require_ownership: bool,
    ) -> AccessDecision:
        """Handle write access checks (create, update, delete)."""
        user_id = self._get_user_id()

        # Anonymous users cannot write
        if user_id == 0:
            return AccessDecision(
                allowed=False,
                reason="You must be logged in to perform this action",
                resource_uuid=resource_uuid,
                user_id=0,
                action=action.value,
            )

        # Special handling for NEW resource creation (e.g., "course_x", "podcast_x")
        # These are top-level resource creations that only need role permissions
        if action == AccessAction.CREATE and resource_uuid.endswith("_x"):
            return await self._check_create_permission(resource_uuid, config)

        # SECURITY: For CREATE actions on existing resources (content creation),
        # require ownership. This prevents users from creating activities/chapters
        # in courses they don't own, even if they have general "create" permission.
        # For update/delete, always check ownership requirements.
        if require_ownership or action in [AccessAction.CREATE, AccessAction.UPDATE, AccessAction.DELETE]:
            return await self._check_ownership_access(resource_uuid, action, config)

        # Default: check role-based permissions
        has_role_permission = await authorization_verify_based_on_roles(
            self.request, user_id, action.value, resource_uuid, self.db_session
        )
        if has_role_permission:
            return AccessDecision(
                allowed=True,
                reason="User has role permission",
                via_role=True,
                resource_uuid=resource_uuid,
                user_id=user_id,
                action=action.value,
            )

        return AccessDecision(
            allowed=False,
            reason=f"User does not have permission to {action.value} this resource",
            resource_uuid=resource_uuid,
            user_id=user_id,
            action=action.value,
        )

    async def _check_create_permission(
        self,
        resource_uuid: str,
        config: ResourceConfig,
    ) -> AccessDecision:
        """Check if user can create new resources of this type."""
        user_id = self._get_user_id()

        # Check role-based create permission
        has_create_permission = await authorization_verify_based_on_roles(
            self.request, user_id, "create", resource_uuid, self.db_session
        )
        if has_create_permission:
            return AccessDecision(
                allowed=True,
                reason="User has create permission via role",
                via_role=True,
                resource_uuid=resource_uuid,
                user_id=user_id,
                action="create",
            )

        # Check admin/maintainer status
        # For creation, we check against a placeholder - need org context
        is_admin = await authorization_verify_based_on_org_admin_status(
            self.request, user_id, "create", resource_uuid, self.db_session
        )
        if is_admin:
            return AccessDecision(
                allowed=True,
                reason="User is admin/maintainer",
                via_admin=True,
                resource_uuid=resource_uuid,
                user_id=user_id,
                action="create",
            )

        return AccessDecision(
            allowed=False,
            reason=f"User does not have permission to create {config.resource_type}",
            resource_uuid=resource_uuid,
            user_id=user_id,
            action="create",
        )

    async def _check_ownership_access(
        self,
        resource_uuid: str,
        action: AccessAction,
        config: ResourceConfig,
    ) -> AccessDecision:
        """Check write access requiring ownership."""
        user_id = self._get_user_id()

        # Check authorship if supported
        if config.supports_authorship:
            is_author = await self._is_resource_author(resource_uuid)
            if is_author:
                return AccessDecision(
                    allowed=True,
                    reason=f"User is resource author and can {action.value}",
                    via_authorship=True,
                    resource_uuid=resource_uuid,
                    user_id=user_id,
                    action=action.value,
                )

        # Check admin/maintainer status
        is_admin = await self._is_admin_or_maintainer(resource_uuid)
        if is_admin:
            return AccessDecision(
                allowed=True,
                reason="User is admin/maintainer",
                via_admin=True,
                resource_uuid=resource_uuid,
                user_id=user_id,
                action=action.value,
            )

        # Check role-based permissions
        has_role_permission = await authorization_verify_based_on_roles(
            self.request, user_id, action.value, resource_uuid, self.db_session
        )
        if has_role_permission:
            return AccessDecision(
                allowed=True,
                reason="User has role permission",
                via_role=True,
                resource_uuid=resource_uuid,
                user_id=user_id,
                action=action.value,
            )

        return AccessDecision(
            allowed=False,
            reason=f"You must be the resource owner or have admin/maintainer role to {action.value} this resource",
            resource_uuid=resource_uuid,
            user_id=user_id,
            action=action.value,
        )

    async def _check_api_token_access(
        self,
        resource_uuid: str,
        action: AccessAction,
        config: ResourceConfig,
    ) -> AccessDecision:
        """Check API token permissions with org boundary enforcement."""
        api_token_user = self.current_user

        # For creation, check if token has create permission
        if action == AccessAction.CREATE and resource_uuid.endswith("_x"):
            if not api_token_user.rights:
                return AccessDecision(
                    allowed=False,
                    reason="API token has no permissions configured",
                    resource_uuid=resource_uuid,
                    action=action.value,
                )

            rights = api_token_user.rights
            if isinstance(rights, dict):
                resource_rights = rights.get(config.resource_type, {})
                has_permission = resource_rights.get("action_create", False)
            else:
                resource_rights = getattr(rights, config.resource_type, None)
                has_permission = getattr(resource_rights, "action_create", False) if resource_rights else False

            if has_permission:
                return AccessDecision(
                    allowed=True,
                    reason="API token has create permission",
                    resource_uuid=resource_uuid,
                    action=action.value,
                )
            return AccessDecision(
                allowed=False,
                reason=f"API token does not have permission to create {config.resource_type}",
                resource_uuid=resource_uuid,
                action=action.value,
            )

        # For existing resources, verify org boundary
        resource = await self._get_resource(resource_uuid, config)
        if not resource:
            return AccessDecision(
                allowed=False,
                reason="Resource not found",
                resource_uuid=resource_uuid,
                action=action.value,
            )

        # CRITICAL: Verify resource belongs to token's organization
        if hasattr(resource, 'org_id') and resource.org_id != api_token_user.org_id:
            return AccessDecision(
                allowed=False,
                reason="API token cannot access resources outside its organization",
                resource_uuid=resource_uuid,
                action=action.value,
            )

        # Check token's rights for this action
        if not api_token_user.rights:
            return AccessDecision(
                allowed=False,
                reason="API token has no permissions configured",
                resource_uuid=resource_uuid,
                action=action.value,
            )

        rights = api_token_user.rights
        if isinstance(rights, dict):
            resource_rights = rights.get(config.resource_type, {})
            has_permission = resource_rights.get(f"action_{action.value}", False)
        else:
            resource_rights = getattr(rights, config.resource_type, None)
            has_permission = getattr(resource_rights, f"action_{action.value}", False) if resource_rights else False

        if has_permission:
            return AccessDecision(
                allowed=True,
                reason=f"API token has {action.value} permission",
                resource_uuid=resource_uuid,
                action=action.value,
            )
        return AccessDecision(
            allowed=False,
            reason=f"API token does not have '{action.value}' permission for {config.resource_type}",
            resource_uuid=resource_uuid,
            action=action.value,
        )

    # Helper methods

    def _get_user_id(self) -> int:
        """Get the current user's ID."""
        if isinstance(self.current_user, APITokenUser):
            return 0  # API tokens don't have a user ID in the same sense
        return self.current_user.id if self.current_user else 0

    async def _resolve_parent_resource_uuid(
        self,
        resource_uuid: str,
        config: ResourceConfig,
    ) -> Optional[str]:
        """
        Resolve the parent resource UUID for child resources.

        For example:
        - chapter_xxx -> course_yyy
        - activity_xxx -> chapter_yyy -> course_zzz
        - episode_xxx -> podcast_yyy

        Args:
            resource_uuid: UUID of the child resource
            config: Configuration for the child resource type

        Returns:
            The parent resource's UUID, or None if not found
        """
        if not config.parent_resource_type or not config.parent_id_field:
            return None

        if resource_uuid in self._parent_uuid_cache:
            return self._parent_uuid_cache[resource_uuid]

        # Get the child resource
        resource = await self._get_resource(resource_uuid, config)
        if not resource:
            logger.warning(f"Child resource not found: {resource_uuid}")
            return None

        # Get the parent ID from the child resource
        parent_id = getattr(resource, config.parent_id_field, None)
        if not parent_id:
            logger.warning(f"Parent ID field '{config.parent_id_field}' not found on {resource_uuid}")
            return None

        # Get the parent config to determine how to look up the parent
        parent_config = RESOURCE_CONFIGS.get(config.parent_resource_type)
        if not parent_config:
            logger.error(f"Parent resource type '{config.parent_resource_type}' not found in config")
            return None

        # Look up the parent resource to get its UUID
        parent_uuid = await self._get_parent_uuid_by_id(parent_id, parent_config)
        self._parent_uuid_cache[resource_uuid] = parent_uuid
        return parent_uuid

    async def _get_parent_uuid_by_id(
        self,
        parent_id: int,
        parent_config: ResourceConfig,
    ) -> Optional[str]:
        """Look up parent resource UUID by its ID."""
        if parent_config.resource_type == "courses":
            from src.db.courses.courses import Course
            statement = select(Course).where(Course.id == parent_id)
            parent = self.db_session.exec(statement).first()
            return parent.course_uuid if parent else None

        elif parent_config.resource_type == "podcasts":
            from src.db.podcasts.podcasts import Podcast
            statement = select(Podcast).where(Podcast.id == parent_id)
            parent = self.db_session.exec(statement).first()
            return parent.podcast_uuid if parent else None

        elif parent_config.resource_type == "communities":
            from src.db.communities.communities import Community
            statement = select(Community).where(Community.id == parent_id)
            parent = self.db_session.exec(statement).first()
            return parent.community_uuid if parent else None

        elif parent_config.resource_type == "coursechapters":
            from src.db.courses.chapters import Chapter
            statement = select(Chapter).where(Chapter.id == parent_id)
            parent = self.db_session.exec(statement).first()
            return parent.chapter_uuid if parent else None

        elif parent_config.resource_type == "collections":
            from src.db.collections import Collection
            statement = select(Collection).where(Collection.id == parent_id)
            parent = self.db_session.exec(statement).first()
            return parent.collection_uuid if parent else None

        return None

    async def _is_public_and_published(
        self,
        resource_uuid: str,
        config: ResourceConfig,
    ) -> tuple[bool, bool]:
        """Check if resource is public and published."""
        cached = self._public_published_cache.get(resource_uuid)
        if cached is not None:
            return cached

        resource = await self._get_resource(resource_uuid, config)
        if not resource:
            result = (False, False)
        else:
            is_public = getattr(resource, 'public', False)
            is_published = getattr(resource, 'published', True) if config.has_published_field else True
            result = (is_public, is_published)

        self._public_published_cache[resource_uuid] = result
        return result

    async def _is_resource_author(self, resource_uuid: str) -> bool:
        """Check if current user is the author of the resource."""
        user_id = self._get_user_id()
        if user_id == 0:
            return False

        cached = self._author_cache.get(resource_uuid)
        if cached is not None:
            return cached

        statement = select(ResourceAuthor).where(
            ResourceAuthor.resource_uuid == resource_uuid,
            ResourceAuthor.user_id == user_id
        )
        resource_author = self.db_session.exec(statement).first()

        if not resource_author:
            self._author_cache[resource_uuid] = False
            return False

        valid_authorships = [
            ResourceAuthorshipEnum.CREATOR,
            ResourceAuthorshipEnum.MAINTAINER,
            ResourceAuthorshipEnum.CONTRIBUTOR,
        ]

        is_valid = (
            resource_author.authorship in valid_authorships and
            resource_author.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE
        )
        self._author_cache[resource_uuid] = is_valid
        return is_valid

    async def _is_admin_or_maintainer(self, resource_uuid: str) -> bool:
        """Check if current user is admin/maintainer in the resource's organization."""
        user_id = self._get_user_id()
        if user_id == 0:
            return False

        cached = self._admin_cache.get(resource_uuid)
        if cached is not None:
            return cached

        result = await authorization_verify_based_on_org_admin_status(
            self.request, user_id, "read", resource_uuid, self.db_session
        )
        self._admin_cache[resource_uuid] = result
        return result

    async def _check_usergroup_membership(self, resource_uuid: str, is_public: bool = False) -> bool:
        """Check if user has access via UserGroup membership."""
        user_id = self._get_user_id()
        if user_id == 0:
            return False

        cache_key = (resource_uuid, is_public)
        cached = self._usergroup_cache.get(cache_key)
        if cached is not None:
            return cached

        # Check if resource has any UserGroups linked
        usergroup_stmt = select(UserGroupResource).where(
            UserGroupResource.resource_uuid == resource_uuid
        )
        usergroup_resources = self.db_session.exec(usergroup_stmt).all()

        # If no UserGroups linked, resource is accessible to any authenticated user.
        # UsersOnly semantics: public=false + no linked group = signed-in users only;
        # the anonymous branch short-circuits above via user_id == 0.
        if not usergroup_resources:
            self._usergroup_cache[cache_key] = True
            return True

        # Check if user is a member of any linked UserGroup
        usergroup_ids = [ugr.usergroup_id for ugr in usergroup_resources]
        membership_stmt = select(UserGroupUser).where(
            UserGroupUser.usergroup_id.in_(usergroup_ids),
            UserGroupUser.user_id == user_id
        )
        membership = self.db_session.exec(membership_stmt).first()

        result = membership is not None
        self._usergroup_cache[cache_key] = result
        return result

    async def _get_resource(self, resource_uuid: str, config: ResourceConfig):
        """Get the resource from the database with caching."""
        if resource_uuid in self._resource_cache:
            return self._resource_cache[resource_uuid]

        resource = None

        # Primary resources
        if config.resource_type == "courses":
            from src.db.courses.courses import Course
            statement = select(Course).where(Course.course_uuid == resource_uuid)
            resource = self.db_session.exec(statement).first()

        elif config.resource_type == "podcasts":
            from src.db.podcasts.podcasts import Podcast
            statement = select(Podcast).where(Podcast.podcast_uuid == resource_uuid)
            resource = self.db_session.exec(statement).first()

        elif config.resource_type == "communities":
            from src.db.communities.communities import Community
            statement = select(Community).where(Community.community_uuid == resource_uuid)
            resource = self.db_session.exec(statement).first()

        elif config.resource_type == "collections":
            from src.db.collections import Collection
            statement = select(Collection).where(Collection.collection_uuid == resource_uuid)
            resource = self.db_session.exec(statement).first()

        # Child resources
        elif config.resource_type == "coursechapters":
            from src.db.courses.chapters import Chapter
            statement = select(Chapter).where(Chapter.chapter_uuid == resource_uuid)
            resource = self.db_session.exec(statement).first()

        elif config.resource_type == "activities":
            from src.db.courses.activities import Activity
            statement = select(Activity).where(Activity.activity_uuid == resource_uuid)
            resource = self.db_session.exec(statement).first()

        elif config.resource_type == "episodes":
            from src.db.podcasts.episodes import PodcastEpisode
            statement = select(PodcastEpisode).where(PodcastEpisode.episode_uuid == resource_uuid)
            resource = self.db_session.exec(statement).first()

        elif config.resource_type == "discussions":
            from src.db.communities.discussions import Discussion
            statement = select(Discussion).where(Discussion.discussion_uuid == resource_uuid)
            resource = self.db_session.exec(statement).first()

        self._resource_cache[resource_uuid] = resource
        return resource


# Convenience functions for quick access checks

def _get_request_checker(
    request: Request,
    db_session: Session,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
) -> "ResourceAccessChecker":
    """
    Return a ResourceAccessChecker scoped to the current request, reusing the
    same instance (and its memoization caches) across every RBAC call within
    that request. This collapses what was previously 2–3× redundant author /
    admin / usergroup / resource lookups per course endpoint.
    """
    existing = getattr(request.state, "rbac_checker", None)
    if (
        existing is not None
        and existing.db_session is db_session
        and existing.current_user is current_user
    ):
        return existing

    checker = ResourceAccessChecker(request, db_session, current_user)
    try:
        request.state.rbac_checker = checker
    except Exception:
        # request.state may be unavailable in non-HTTP contexts (tests, tasks)
        pass
    return checker


async def check_resource_access(
    request: Request,
    db_session: Session,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    resource_uuid: str,
    action: AccessAction,
    context: AccessContext = AccessContext.PUBLIC_VIEW,
    require_ownership: bool = False,
    raise_on_deny: bool = True,
) -> AccessDecision:
    """
    Convenience function for checking resource access.

    Args:
        request: FastAPI request object
        db_session: Database session
        current_user: Current user
        resource_uuid: UUID of the resource
        action: Action to perform
        context: Access context
        require_ownership: Whether ownership is required for write operations
        raise_on_deny: If True, raises HTTPException on denial

    Returns:
        AccessDecision

    Raises:
        HTTPException: If access denied and raise_on_deny is True
    """
    checker = _get_request_checker(request, db_session, current_user)
    decision = await checker.check_access(resource_uuid, action, context, require_ownership)

    if not decision.allowed and raise_on_deny:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=decision.reason,
        )

    return decision
