from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from sqlmodel import Session
from src.services.users.users import delete_user_by_id
from src.db.usergroups import UserGroupCreate, UserGroupRead, UserGroupUpdate
from src.db.users import PublicUser
from src.services.users.usergroups import create_usergroup, delete_usergroup_by_id, read_usergroup_by_id, update_usergroup_by_id
from src.services.orgs.orgs import get_org_join_mechanism
from src.security.auth import get_current_user
from src.core.events.database import get_db_session


router = APIRouter()


@router.post("/", response_model=UserGroupCreate, tags=["usergroups"])
async def api_create_user_without_org(
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
    return await update_usergroup_by_id(request, db_session, current_user, usergroup_id, usergroup_object)

@router.delete("/{usergroup_id}",  tags=["usergroups"])
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
