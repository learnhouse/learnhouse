from typing import Literal, List
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from pydantic import EmailStr
from sqlmodel import Session
from src.services.users.password_reset import (
    change_password_with_reset_code,
    send_reset_password_code,
)
from src.services.orgs.orgs import get_org_join_mechanism
from src.security.auth import get_current_user
from src.core.events.database import get_db_session
from src.db.courses.courses import CourseRead

from src.db.users import (
    PublicUser,
    User,
    UserCreate,
    UserRead,
    UserSession,
    UserUpdate,
    UserUpdatePassword,
)
from src.services.users.users import (
    authorize_user_action,
    create_user,
    create_user_with_invite,
    create_user_without_org,
    delete_user_by_id,
    get_user_session,
    read_user_by_id,
    read_user_by_uuid,
    read_user_by_username,
    update_user,
    update_user_avatar,
    update_user_password,
)
from src.services.courses.courses import get_user_courses


router = APIRouter()


@router.get("/profile")
async def api_get_current_user(current_user: User = Depends(get_current_user)):
    """
    Get current user
    """
    return current_user.model_dump()


@router.get("/session")
async def api_get_current_user_session(
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> UserSession:
    """
    Get current user
    """
    return await get_user_session(request, db_session, current_user)


@router.get("/authorize/ressource/{ressource_uuid}/action/{action}")
async def api_get_authorization_status(
    request: Request,
    ressource_uuid: str,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Get current user authorization status
    """
    return await authorize_user_action(
        request, db_session, current_user, ressource_uuid, action
    )


@router.post("/{org_id}", response_model=UserRead, tags=["users"])
async def api_create_user_with_orgid(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    user_object: UserCreate,
    org_id: int,
) -> UserRead:
    """
    Create User with Org ID
    """

    # TODO(fix) : This is temporary, logic should be moved to service
    if (
        await get_org_join_mechanism(request, org_id, current_user, db_session)
        == "inviteOnly"
    ):
        raise HTTPException(
            status_code=403,
            detail="You need an invite to join this organization",
        )
    else:
        return await create_user(request, db_session, current_user, user_object, org_id)


@router.post("/{org_id}/invite/{invite_code}", response_model=UserRead, tags=["users"])
async def api_create_user_with_orgid_and_invite(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    user_object: UserCreate,
    invite_code: str,
    org_id: int,
) -> UserRead:
    """
    Create User with Org ID and invite code
    """

    # TODO: This is temporary, logic should be moved to service
    if (
        await get_org_join_mechanism(request, org_id, current_user, db_session)
        == "inviteOnly"
    ):
        return await create_user_with_invite(
            request, db_session, current_user, user_object, org_id, invite_code
        )
    else:
        raise HTTPException(
            status_code=403,
            detail="This organization does not require an invite code",
        )


@router.post("/", response_model=UserRead, tags=["users"])
async def api_create_user_without_org(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    user_object: UserCreate,
) -> UserRead:
    """
    Create User
    """
    return await create_user_without_org(request, db_session, current_user, user_object)


@router.get("/id/{user_id}", response_model=UserRead, tags=["users"])
async def api_get_user_by_id(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    user_id: int,
) -> UserRead:
    """
    Get User by ID
    """
    return await read_user_by_id(request, db_session, current_user, user_id)


@router.get("/uuid/{user_uuid}", response_model=UserRead, tags=["users"])
async def api_get_user_by_uuid(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    user_uuid: str,
) -> UserRead:
    """
    Get User by UUID
    """
    return await read_user_by_uuid(request, db_session, current_user, user_uuid)


@router.get("/username/{username}", response_model=UserRead, tags=["users"])
async def api_get_user_by_username(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    username: str,
) -> UserRead:
    """
    Get User by Username
    """
    return await read_user_by_username(request, db_session, current_user, username)


@router.put("/{user_id}", response_model=UserRead, tags=["users"])
async def api_update_user(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    user_id: int,
    user_object: UserUpdate,
) -> UserRead:
    """
    Update User
    """
    return await update_user(request, db_session, user_id, current_user, user_object)


@router.put("/update_avatar/{user_id}", response_model=UserRead, tags=["users"])
async def api_update_avatar_user(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    avatar_file: UploadFile | None = None,
) -> UserRead:
    """
    Update User
    """
    return await update_user_avatar(request, db_session, current_user, avatar_file)


@router.put("/change_password/{user_id}", response_model=UserRead, tags=["users"])
async def api_update_user_password(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    user_id: int,
    form: UserUpdatePassword,
) -> UserRead:
    """
    Update User Password
    """
    return await update_user_password(request, db_session, current_user, user_id, form)


@router.post("/reset_password/change_password/{email}", tags=["users"])
async def api_change_password_with_reset_code(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    new_password: str,
    email: EmailStr,
    org_id: int,
    reset_code: str,
):
    """
    Update User Password with reset code
    """
    return await change_password_with_reset_code(
        request, db_session, current_user, new_password, org_id, email, reset_code
    )


@router.post("/reset_password/send_reset_code/{email}", tags=["users"])
async def api_send_password_reset_email(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    email: EmailStr,
    org_id: int,
):
    """
    Update User Password
    """
    return await send_reset_password_code(
        request, db_session, current_user, org_id, email
    )


@router.delete("/user_id/{user_id}", tags=["users"])
async def api_delete_user(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    user_id: int,
):
    """
    Delete User
    """
    return await delete_user_by_id(request, db_session, current_user, user_id)


@router.get("/{user_id}/courses", response_model=List[CourseRead], tags=["users"])
async def api_get_user_courses(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    user_id: int,
    page: int = 1,
    limit: int = 10,
) -> List[CourseRead]:
    """
    Get courses made or contributed by a user.
    """
    return await get_user_courses(
        request=request,
        current_user=current_user,
        user_id=user_id,
        db_session=db_session,
        page=page,
        limit=limit,
    )
