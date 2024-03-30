from fastapi import APIRouter, Depends, Request
from sqlmodel import Session
from src.db.usergroups import UserGroupCreate, UserGroupRead, UserGroupUpdate
from src.db.users import PublicUser, UserRead
from src.services.users.usergroups import (
    add_resources_to_usergroup,
    add_users_to_usergroup,
    create_usergroup,
    delete_usergroup_by_id,
    get_usergroups_by_resource,
    get_users_linked_to_usergroup,
    read_usergroup_by_id,
    read_usergroups_by_org_id,
    remove_resources_from_usergroup,
    remove_users_from_usergroup,
    update_usergroup_by_id,
)
from src.security.auth import get_current_user
from src.core.events.database import get_db_session


router = APIRouter()


@router.post("/", response_model=UserGroupRead, tags=["usergroups"])
async def api_create_usergroup(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    usergroup_object: UserGroupCreate,
) -> UserGroupRead:
    """
    Create User
    """
    return await create_usergroup(request, db_session, current_user, usergroup_object)


@router.get("/{usergroup_id}", response_model=UserGroupRead, tags=["usergroups"])
async def api_get_usergroup(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    usergroup_id: int,
) -> UserGroupRead:
    """
    Get UserGroup
    """
    return await read_usergroup_by_id(request, db_session, current_user, usergroup_id)


@router.get("/{usergroup_id}/users", response_model=list[UserRead], tags=["usergroups"])
async def api_get_users_linked_to_usergroup(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    usergroup_id: int,
) -> list[UserRead]:
    """
    Get Users linked to UserGroup
    """
    return await get_users_linked_to_usergroup(
        request, db_session, current_user, usergroup_id
    )


@router.get("/org/{org_id}", response_model=list[UserGroupRead], tags=["usergroups"])
async def api_get_usergroups(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    org_id: int,
) -> list[UserGroupRead]:
    """
    Get UserGroups by Org
    """
    return await read_usergroups_by_org_id(request, db_session, current_user, org_id)


@router.get(
    "/resource/{resource_uuid}", response_model=list[UserGroupRead], tags=["usergroups"]
)
async def api_get_usergroupsby_resource(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    resource_uuid: str,
) -> list[UserGroupRead]:
    """
    Get UserGroups by Org
    """
    return await get_usergroups_by_resource(
        request, db_session, current_user, resource_uuid
    )


@router.put("/{usergroup_id}", response_model=UserGroupRead, tags=["usergroups"])
async def api_update_usergroup(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    usergroup_id: int,
    usergroup_object: UserGroupUpdate,
) -> UserGroupRead:
    """
    Update UserGroup
    """
    return await update_usergroup_by_id(
        request, db_session, current_user, usergroup_id, usergroup_object
    )


@router.delete("/{usergroup_id}", tags=["usergroups"])
async def api_delete_usergroup(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    usergroup_id: int,
) -> str:
    """
    Delete UserGroup
    """
    return await delete_usergroup_by_id(request, db_session, current_user, usergroup_id)


@router.post("/{usergroup_id}/add_users", tags=["usergroups"])
async def api_add_users_to_usergroup(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    usergroup_id: int,
    user_ids: str,
) -> str:
    """
    Add Users to UserGroup
    """
    return await add_users_to_usergroup(
        request, db_session, current_user, usergroup_id, user_ids
    )


@router.delete("/{usergroup_id}/remove_users", tags=["usergroups"])
async def api_delete_users_from_usergroup(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    usergroup_id: int,
    user_ids: str,
) -> str:
    """
    Delete Users from UserGroup
    """
    return await remove_users_from_usergroup(
        request, db_session, current_user, usergroup_id, user_ids
    )


@router.post("/{usergroup_id}/add_resources", tags=["usergroups"])
async def api_add_resources_to_usergroup(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    usergroup_id: int,
    resource_uuids: str,
) -> str:
    """
    Add Resources to UserGroup
    """
    return await add_resources_to_usergroup(
        request, db_session, current_user, usergroup_id, resource_uuids
    )


@router.delete("/{usergroup_id}/remove_resources", tags=["usergroups"])
async def api_delete_resources_from_usergroup(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    usergroup_id: int,
    resource_uuids: str,
) -> str:
    """
    Delete Resources from UserGroup
    """
    return await remove_resources_from_usergroup(
        request, db_session, current_user, usergroup_id, resource_uuids
    )
