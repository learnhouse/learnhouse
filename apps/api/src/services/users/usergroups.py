from datetime import datetime
import logging
from typing import Literal
from uuid import uuid4
from fastapi import HTTPException, Request
from sqlmodel import Session, select
from src.security.features_utils.usage import (
    check_limits_with_usage,
    increase_feature_usage,
)
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles_and_authorship,
    authorization_verify_based_on_roles_and_authorship_or_api_token,
    authorization_verify_if_user_is_anon,
)
from src.security.rbac.config import get_resource_config
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.organizations import Organization
from src.db.usergroups import UserGroup, UserGroupCreate, UserGroupRead, UserGroupUpdate
from src.db.users import AnonymousUser, APITokenUser, InternalUser, PublicUser, User, UserRead


async def _validate_resource_exists_and_belongs_to_org(
    resource_uuid: str,
    org_id: int,
    db_session: Session,
) -> bool:
    """
    Validate that a resource exists and belongs to the specified organization.

    Args:
        resource_uuid: UUID of the resource (course_xxx, podcast_xxx, community_xxx)
        org_id: Organization ID the resource should belong to
        db_session: Database session

    Returns:
        True if resource exists and belongs to org

    Raises:
        HTTPException: If resource doesn't exist or doesn't belong to org
    """
    config = get_resource_config(resource_uuid)
    if not config:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown resource type for UUID: {resource_uuid}",
        )

    # Import the appropriate model based on resource type
    resource = None

    if config.resource_type == "courses":
        from src.db.courses.courses import Course
        statement = select(Course).where(Course.course_uuid == resource_uuid)
        resource = db_session.exec(statement).first()
    elif config.resource_type == "podcasts":
        from src.db.podcasts.podcasts import Podcast
        statement = select(Podcast).where(Podcast.podcast_uuid == resource_uuid)
        resource = db_session.exec(statement).first()
    elif config.resource_type == "communities":
        from src.db.communities.communities import Community
        statement = select(Community).where(Community.community_uuid == resource_uuid)
        resource = db_session.exec(statement).first()
    elif config.resource_type == "collections":
        from src.db.collections import Collection
        statement = select(Collection).where(Collection.collection_uuid == resource_uuid)
        resource = db_session.exec(statement).first()
    elif config.resource_type == "docspaces":
        from src.db.docs.docspaces import DocSpace
        statement = select(DocSpace).where(DocSpace.docspace_uuid == resource_uuid)
        resource = db_session.exec(statement).first()
    elif config.resource_type == "boards":
        from src.db.boards import Board
        statement = select(Board).where(Board.board_uuid == resource_uuid)
        resource = db_session.exec(statement).first()
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Resource type '{config.resource_type}' is not supported for UserGroup linking",
        )

    if not resource:
        raise HTTPException(
            status_code=404,
            detail=f"Resource {resource_uuid} not found",
        )

    # Verify resource belongs to the same organization
    # All supported resource types (courses, podcasts, communities, collections) have org_id
    if not hasattr(resource, 'org_id'):
        raise HTTPException(
            status_code=500,
            detail=f"Resource {resource_uuid} does not have organization association",
        )

    if resource.org_id != org_id:
        raise HTTPException(
            status_code=403,
            detail=f"Resource {resource_uuid} does not belong to this organization",
        )

    return True


async def create_usergroup(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    usergroup_create: UserGroupCreate,
) -> UserGroupRead:

    usergroup = UserGroup.model_validate(usergroup_create)

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid="usergroup_X",
        current_user=current_user,
        action="create",
        db_session=db_session,
    )

    # Check if Organization exists
    statement = select(Organization).where(Organization.id == usergroup_create.org_id)
    org = db_session.exec(statement).first()

    if not org or org.id is None:
        raise HTTPException(
            status_code=400,
            detail="Organization does not exist",
        )

    # Usage check
    check_limits_with_usage("courses", org.id, db_session)

    # Complete the object
    usergroup.usergroup_uuid = f"usergroup_{uuid4()}"
    usergroup.creation_date = str(datetime.now())
    usergroup.update_date = str(datetime.now())

    # Save the object
    db_session.add(usergroup)
    db_session.commit()
    db_session.refresh(usergroup)

    # Feature usage
    increase_feature_usage("usergroups", org.id, db_session)

    usergroup = UserGroupRead.model_validate(usergroup)

    return usergroup


async def read_usergroup_by_id(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    usergroup_id: int,
) -> UserGroupRead:

    statement = select(UserGroup).where(UserGroup.id == usergroup_id)
    usergroup = db_session.exec(statement).first()

    if not usergroup:
        raise HTTPException(
            status_code=404,
            detail="UserGroup not found",
        )

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid=usergroup.usergroup_uuid,
        current_user=current_user,
        action="read",
        db_session=db_session,
    )

    usergroup = UserGroupRead.model_validate(usergroup)

    return usergroup


async def get_users_linked_to_usergroup(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    usergroup_id: int,
) -> list[UserRead]:

    statement = select(UserGroup).where(UserGroup.id == usergroup_id)
    usergroup = db_session.exec(statement).first()

    if not usergroup:
        raise HTTPException(
            status_code=404,
            detail="UserGroup not found",
        )

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid=usergroup.usergroup_uuid,
        current_user=current_user,
        action="read",
        db_session=db_session,
    )

    # Batch fetch users linked to this usergroup in a single query
    statement = (
        select(User)
        .join(UserGroupUser, UserGroupUser.user_id == User.id)  # type: ignore
        .where(UserGroupUser.usergroup_id == usergroup_id)
    )
    users = db_session.exec(statement).all()

    return [UserRead.model_validate(user) for user in users]


async def read_usergroups_by_org_id(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    org_id: int,
) -> list[UserGroupRead]:

    statement = select(UserGroup).where(UserGroup.org_id == org_id).order_by(UserGroup.creation_date.desc())
    usergroups = db_session.exec(statement).all()

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid="usergroup_X",
        current_user=current_user,
        action="read",
        db_session=db_session,
    )

    usergroups = [UserGroupRead.model_validate(usergroup) for usergroup in usergroups]

    return usergroups


async def get_usergroups_by_resource(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    resource_uuid: str,
) -> list[UserGroupRead]:

    statement = select(UserGroupResource).where(
        UserGroupResource.resource_uuid == resource_uuid
    )
    usergroup_resources = db_session.exec(statement).all()

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid="usergroup_X",
        current_user=current_user,
        action="read",
        db_session=db_session,
    )

    # Batch fetch all usergroups in a single query
    usergroup_ids = [ug.usergroup_id for ug in usergroup_resources]
    if not usergroup_ids:
        return []

    statement = select(UserGroup).where(UserGroup.id.in_(usergroup_ids))  # type: ignore
    usergroups = db_session.exec(statement).all()

    return [UserGroupRead.model_validate(ug) for ug in usergroups]


async def update_usergroup_by_id(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    usergroup_id: int,
    usergroup_update: UserGroupUpdate,
) -> UserGroupRead:

    statement = select(UserGroup).where(UserGroup.id == usergroup_id)
    usergroup = db_session.exec(statement).first()

    if not usergroup:
        raise HTTPException(
            status_code=404,
            detail="UserGroup not found",
        )

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid=usergroup.usergroup_uuid,
        current_user=current_user,
        action="update",
        db_session=db_session,
    )

    usergroup.name = usergroup_update.name
    usergroup.description = usergroup_update.description
    usergroup.update_date = str(datetime.now())

    db_session.add(usergroup)
    db_session.commit()
    db_session.refresh(usergroup)

    usergroup = UserGroupRead.model_validate(usergroup)

    return usergroup


async def delete_usergroup_by_id(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    usergroup_id: int,
) -> str:

    statement = select(UserGroup).where(UserGroup.id == usergroup_id)
    usergroup = db_session.exec(statement).first()

    if not usergroup:
        raise HTTPException(
            status_code=404,
            detail="UserGroup not found",
        )

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid=usergroup.usergroup_uuid,
        current_user=current_user,
        action="delete",
        db_session=db_session,
    )

    # Feature usage
    increase_feature_usage("usergroups", usergroup.org_id, db_session)

    db_session.delete(usergroup)
    db_session.commit()

    return "UserGroup deleted successfully"


async def add_users_to_usergroup(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser | InternalUser,
    usergroup_id: int,
    user_ids: str,
) -> str:

    statement = select(UserGroup).where(UserGroup.id == usergroup_id)
    usergroup = db_session.exec(statement).first()

    if not usergroup:
        raise HTTPException(
            status_code=404,
            detail="UserGroup not found",
        )

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid=usergroup.usergroup_uuid,
        current_user=current_user,
        action="create",
        db_session=db_session,
    )

    user_ids_array = user_ids.split(",")

    for user_id in user_ids_array:
        statement = select(User).where(User.id == user_id)
        user = db_session.exec(statement).first()

        # Check if User is already Linked to UserGroup
        statement = select(UserGroupUser).where(
            UserGroupUser.usergroup_id == usergroup_id,
            UserGroupUser.user_id == user_id,
        )
        usergroup_user = db_session.exec(statement).first()

        if usergroup_user:
            logging.error(f"User with id {user_id} already exists in UserGroup")
            continue

        if user:
            # Add user to UserGroup
            if user.id is not None:
                usergroup_obj = UserGroupUser(
                    usergroup_id=usergroup_id,
                    user_id=user.id,
                    org_id=usergroup.org_id,
                    creation_date=str(datetime.now()),
                    update_date=str(datetime.now()),
                )

                db_session.add(usergroup_obj)
        else:
            logging.error(f"User with id {user_id} not found")

    db_session.commit()

    return "Users added to UserGroup successfully"


async def remove_users_from_usergroup(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    usergroup_id: int,
    user_ids: str,
) -> str:

    statement = select(UserGroup).where(UserGroup.id == usergroup_id)
    usergroup = db_session.exec(statement).first()

    if not usergroup:
        raise HTTPException(
            status_code=404,
            detail="UserGroup not found",
        )

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid=usergroup.usergroup_uuid,
        current_user=current_user,
        action="delete",
        db_session=db_session,
    )

    user_ids_array = user_ids.split(",")

    for user_id in user_ids_array:
        statement = select(UserGroupUser).where(
            UserGroupUser.user_id == user_id, UserGroupUser.usergroup_id == usergroup_id
        )
        usergroup_user = db_session.exec(statement).first()

        if usergroup_user:
            db_session.delete(usergroup_user)
        else:
            logging.error(f"User with id {user_id} not found in UserGroup")

    db_session.commit()

    return "Users removed from UserGroup successfully"


async def add_resources_to_usergroup(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    usergroup_id: int,
    resources_uuids: str,
) -> str:

    statement = select(UserGroup).where(UserGroup.id == usergroup_id)
    usergroup = db_session.exec(statement).first()

    if not usergroup:
        raise HTTPException(
            status_code=404,
            detail="UserGroup not found",
        )

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid=usergroup.usergroup_uuid,
        current_user=current_user,
        action="create",
        db_session=db_session,
    )

    resources_uuids_array = resources_uuids.split(",")

    for resource_uuid in resources_uuids_array:
        # Check if a link between UserGroup and Resource already exists
        statement = select(UserGroupResource).where(
            UserGroupResource.usergroup_id == usergroup_id,
            UserGroupResource.resource_uuid == resource_uuid,
        )
        usergroup_resource = db_session.exec(statement).first()

        if usergroup_resource:
            logging.error(f"Resource {resource_uuid} already exists in UserGroup")
            continue

        # Validate that resource exists and belongs to this organization
        await _validate_resource_exists_and_belongs_to_org(
            resource_uuid, usergroup.org_id, db_session
        )

        usergroup_obj = UserGroupResource(
            usergroup_id=usergroup_id,
            resource_uuid=resource_uuid,
            org_id=usergroup.org_id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )

        db_session.add(usergroup_obj)

    db_session.commit()

    return "Resources added to UserGroup successfully"


async def remove_resources_from_usergroup(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    usergroup_id: int,
    resources_uuids: str,
) -> str:

    statement = select(UserGroup).where(UserGroup.id == usergroup_id)
    usergroup = db_session.exec(statement).first()

    if not usergroup:
        raise HTTPException(
            status_code=404,
            detail="UserGroup not found",
        )

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid=usergroup.usergroup_uuid,
        current_user=current_user,
        action="delete",
        db_session=db_session,
    )

    resources_uuids_array = resources_uuids.split(",")

    for resource_uuid in resources_uuids_array:
        statement = select(UserGroupResource).where(
            UserGroupResource.resource_uuid == resource_uuid,
            UserGroupResource.usergroup_id == usergroup_id,
        )
        usergroup_resource = db_session.exec(statement).first()

        if usergroup_resource:
            db_session.delete(usergroup_resource)
        else:
            logging.error(f"resource with uuid {resource_uuid} not found in UserGroup")

    db_session.commit()

    return "Resources removed from UserGroup successfully"


## 🔒 RBAC Utils ##


async def rbac_check(
    request: Request,
    usergroup_uuid: str,
    current_user: PublicUser | AnonymousUser | InternalUser | APITokenUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
):
    if isinstance(current_user, InternalUser):
        return True

    # Handle both regular users and API tokens
    if isinstance(current_user, APITokenUser):
        await authorization_verify_based_on_roles_and_authorship_or_api_token(
            request,
            current_user,
            action,
            usergroup_uuid,
            db_session,
        )
    else:
        await authorization_verify_if_user_is_anon(current_user.id)

        await authorization_verify_based_on_roles_and_authorship(
            request,
            current_user.id,
            action,
            usergroup_uuid,
            db_session,
        )


## 🔒 RBAC Utils ##
