from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from sqlmodel import Session
from src.services.users.users import delete_user_by_id
from src.db.usergroups import UserGroupCreate, UserGroupRead, UserGroupUpdate
from src.db.users import PublicUser
from src.services.users.usergroups import (
    add_ressources_to_usergroup,
    add_users_to_usergroup,
    create_usergroup,
    delete_usergroup_by_id,
    read_usergroup_by_id,
    remove_ressources_from_usergroup,
    remove_users_from_usergroup,
    update_usergroup_by_id,
)
from src.services.orgs.orgs import get_org_join_mechanism
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


@router.post("/{usergroup_id}/add_ressources", tags=["usergroups"])
async def api_add_ressources_to_usergroup(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    usergroup_id: int,
    ressource_uuids: str,
) -> str:
    """
    Add Ressources to UserGroup
    """
    return await add_ressources_to_usergroup(
        request, db_session, current_user, usergroup_id, ressource_uuids
    )


@router.delete("/{usergroup_id}/remove_ressources", tags=["usergroups"])
async def api_delete_ressources_from_usergroup(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    usergroup_id: int,
    ressource_uuids: str,
) -> str:
    """
    Delete Ressources from UserGroup
    """
    return await remove_ressources_from_usergroup(
        request, db_session, current_user, usergroup_id, ressource_uuids
    )
