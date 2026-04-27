import json
import logging
from typing import Literal, List, Optional, Union
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr
from sqlmodel import Session
import redis
from config.config import get_learnhouse_config
from src.services.users.password_reset import (
    change_password_with_reset_code,
    change_password_with_reset_code_platform,
    send_reset_password_code,
    send_reset_password_code_platform,
)
from src.services.security.rate_limiting import (
    check_password_reset_rate_limit,
    check_invite_acceptance_rate_limit,
)
from src.services.orgs.orgs import get_org_join_mechanism
from src.security.auth import get_current_user, get_authenticated_user
from src.core.events.database import get_db_session
from src.db.courses.courses import CourseRead

from src.db.users import (
    AnonymousUser,
    PublicUser,
    UserCreate,
    UserRead,
    UserReadPublic,
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
from src.services.users.bulk_import import (
    BulkImportResult,
    bulk_import_users_from_csv,
)
from src.services.users.bulk_export import (
    export_users_to_csv,
    iter_csv_chunks,
)
from src.services.courses.courses import get_user_courses


logger = logging.getLogger(__name__)

router = APIRouter()

SESSION_CACHE_TTL = 600  # 10 minutes


def _get_redis_client() -> Optional[redis.Redis]:
    """Return a Redis client or None if unavailable."""
    try:
        config = get_learnhouse_config()
        conn_string = config.redis_config.redis_connection_string
        if not conn_string:
            return None
        return redis.Redis.from_url(conn_string, socket_connect_timeout=2)
    except Exception:
        return None


def _get_session_cache(user_id: int) -> Optional[dict]:
    """Get cached session data for a user."""
    r = _get_redis_client()
    if r is None:
        return None
    try:
        raw = r.get(f"session:{user_id}")
        if raw:
            return json.loads(raw)
    except Exception:
        logger.debug("Session cache read failed for user %s", user_id, exc_info=True)
    return None


def _set_session_cache(user_id: int, session_data: dict) -> None:
    """Cache session data for a user."""
    r = _get_redis_client()
    if r is None:
        return
    try:
        r.setex(f"session:{user_id}", SESSION_CACHE_TTL, json.dumps(session_data))
    except Exception:
        logger.debug("Session cache write failed for user %s", user_id, exc_info=True)


def _invalidate_session_cache(user_id: int) -> None:
    """Invalidate cached session data for a user."""
    r = _get_redis_client()
    if r is None:
        return
    try:
        r.delete(f"session:{user_id}")
    except Exception:
        logger.debug("Session cache invalidation failed for user %s", user_id, exc_info=True)


@router.get(
    "/profile",
    summary="Get current user profile",
    description="Return the currently authenticated user, or an anonymous user object if no session is present.",
    responses={
        200: {"description": "Current user profile (public or anonymous)."},
    },
)
async def api_get_current_user(
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user)
):
    """
    Get current user
    """
    return current_user.model_dump()


@router.get(
    "/session",
    response_model=UserSession,
    summary="Get current user session",
    description="Return the full session for the current user, including org memberships and roles. Cached in Redis for up to 10 minutes per user.",
    responses={
        200: {"description": "Full session info for the current user.", "model": UserSession},
    },
)
async def api_get_current_user_session(
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
) -> UserSession:
    """
    Get current user session (cached for 10 minutes).
    """
    if not isinstance(current_user, AnonymousUser):
        cached = _get_session_cache(current_user.id)
        if cached:
            return UserSession(**cached)

    session = await get_user_session(request, db_session, current_user)

    if not isinstance(current_user, AnonymousUser):
        _set_session_cache(current_user.id, session.model_dump())

    return session


@router.get(
    "/authorize/ressource/{ressource_uuid}/action/{action}",
    summary="Check authorization for resource action",
    description="Check whether the current user is authorized to perform the given action (create/read/update/delete) on a specific resource.",
    responses={
        200: {"description": "Authorization decision for the requested resource and action."},
        404: {"description": "Resource not found"},
    },
)
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


@router.post(
    "/{org_id}",
    response_model=UserRead,
    tags=["users"],
    summary="Create user in organization",
    description="Create a user and attach them to the given organization. Rejected if the organization is invite-only — use the invite-code endpoint instead.",
    responses={
        200: {"description": "User created and attached to the organization.", "model": UserRead},
        403: {"description": "Organization is invite-only; an invite code is required"},
    },
)
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


@router.post(
    "/{org_id}/bulk-import",
    response_model=BulkImportResult,
    tags=["users"],
    summary="Bulk import users from CSV",
    description=(
        "Create many users at once from a CSV upload, optionally enrolling them in "
        "user groups, courses, and collections. Required column: `email`. Optional: "
        "`first_name`, `last_name`, `username`, `password`, `role_id`, `user_groups`, "
        "`courses`, `collections`. Multi-value cells use `|` as the inner separator. "
        "Empty `password` generates a strong random one (user can recover via "
        "password reset). Each row is processed independently — failures do not "
        "abort the batch and are returned in the response `errors` list."
    ),
    responses={
        200: {"description": "Import completed; see body for per-row outcomes.", "model": BulkImportResult},
        400: {"description": "Malformed CSV or missing/unknown columns"},
        403: {"description": "Caller lacks permission to create users in this organization"},
        404: {"description": "Organization does not exist"},
    },
)
async def api_bulk_import_users(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    org_id: int,
    file: UploadFile,
) -> BulkImportResult:
    """
    Bulk-create users from a CSV file and assign them to user groups,
    courses, and collections.
    """
    if file.content_type and file.content_type not in (
        "text/csv",
        "application/vnd.ms-excel",
        "application/csv",
        "text/plain",
    ):
        raise HTTPException(
            status_code=400,
            detail=f"Expected a CSV file, got content-type: {file.content_type}",
        )

    raw = await file.read()
    try:
        csv_content = raw.decode("utf-8-sig")  # strips BOM if present
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400,
            detail="CSV file must be UTF-8 encoded",
        )

    return await bulk_import_users_from_csv(
        request=request,
        db_session=db_session,
        current_user=current_user,
        org_id=org_id,
        csv_content=csv_content,
    )


@router.get(
    "/{org_id}/bulk-export",
    tags=["users"],
    summary="Export users from organization as CSV",
    description=(
        "Stream a CSV of every user in the organization (or a single user "
        "group when `usergroup_id` is provided). Columns mirror the "
        "bulk-import format minus `password` so the file can be edited and "
        "fed back through the import endpoint. Caller needs `users.action_read`."
    ),
    responses={
        200: {
            "description": "CSV stream with users.",
            "content": {"text/csv": {}},
        },
        403: {"description": "Caller lacks permission to read users in this organization"},
        404: {"description": "Organization or user group not found"},
    },
)
async def api_bulk_export_users(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    org_id: int,
    usergroup_id: Optional[int] = Query(
        None,
        description="Restrict the export to members of this user group",
    ),
) -> StreamingResponse:
    """
    Bulk export users in the organization as CSV.
    """
    csv_content = await export_users_to_csv(
        request=request,
        db_session=db_session,
        current_user=current_user,
        org_id=org_id,
        usergroup_id=usergroup_id,
    )
    suffix = f"-usergroup-{usergroup_id}" if usergroup_id else ""
    filename = f"users-export-org-{org_id}{suffix}-{datetime.now():%Y%m%d}.csv"
    return StreamingResponse(
        iter_csv_chunks(csv_content),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post(
    "/{org_id}/invite/{invite_code}",
    response_model=UserRead,
    tags=["users"],
    summary="Create user with invite code",
    description="Create a user and attach them to the given organization using an invite code. Only valid when the organization is configured as invite-only.",
    responses={
        200: {"description": "User created and attached via invite code.", "model": UserRead},
        403: {"description": "Organization does not require an invite code"},
    },
)
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
    # Throttle invite-code guessing per IP+org. ``detail`` is a plain string
    # so the frontend's generic error path renders it as-is.
    is_allowed, retry_after = check_invite_acceptance_rate_limit(request, org_id)
    if not is_allowed:
        minutes = max(1, retry_after // 60)
        raise HTTPException(
            status_code=429,
            detail=(
                f"Too many invite-code attempts. "
                f"Please try again in about {minutes} minute"
                f"{'s' if minutes != 1 else ''}."
            ),
            headers={"Retry-After": str(retry_after)},
        )

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


@router.post(
    "/",
    response_model=UserRead,
    tags=["users"],
    summary="Create user without organization",
    description="Create a user account that is not attached to any organization at creation time.",
    responses={
        200: {"description": "User account created.", "model": UserRead},
        400: {"description": "Password fails validation, email already registered, or username taken"},
    },
)
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


@router.get(
    "/id/{user_id}",
    response_model=UserReadPublic,
    tags=["users"],
    summary="Get user by ID",
    description="Get a user by numeric ID. Requires authentication to prevent user enumeration attacks. Sensitive fields (`is_superadmin`, `signup_method`) are excluded.",
    responses={
        200: {"description": "Public view of the user.", "model": UserReadPublic},
        401: {"description": "Authentication required"},
    },
)
async def api_get_user_by_id(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_authenticated_user),
    user_id: int,
) -> UserReadPublic:
    """
    Get User by ID.

    SECURITY: Requires authentication to prevent user enumeration attacks.
    Anonymous users cannot access this endpoint.
    Returns a restricted view — sensitive fields (is_superadmin, signup_method) are excluded.
    """
    return await read_user_by_id(request, db_session, current_user, user_id)


@router.get(
    "/uuid/{user_uuid}",
    response_model=UserReadPublic,
    tags=["users"],
    summary="Get user by UUID",
    description="Get a user by UUID. Requires authentication to prevent user enumeration attacks. Sensitive fields (`is_superadmin`, `signup_method`) are excluded.",
    responses={
        200: {"description": "Public view of the user.", "model": UserReadPublic},
        401: {"description": "Authentication required"},
    },
)
async def api_get_user_by_uuid(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_authenticated_user),
    user_uuid: str,
) -> UserReadPublic:
    """
    Get User by UUID.

    SECURITY: Requires authentication to prevent user enumeration attacks.
    Returns a restricted view — sensitive fields (is_superadmin, signup_method) are excluded.
    """
    return await read_user_by_uuid(request, db_session, current_user, user_uuid)


@router.get(
    "/username/{username}",
    response_model=UserReadPublic,
    tags=["users"],
    summary="Get user by username",
    description="Get a user by username. Requires authentication to prevent username enumeration attacks. Sensitive fields (`is_superadmin`, `signup_method`) are excluded.",
    responses={
        200: {"description": "Public view of the user.", "model": UserReadPublic},
        401: {"description": "Authentication required"},
    },
)
async def api_get_user_by_username(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_authenticated_user),
    username: str,
) -> UserReadPublic:
    """
    Get User by Username.

    SECURITY: Requires authentication to prevent username enumeration attacks.
    Returns a restricted view — sensitive fields (is_superadmin, signup_method) are excluded.
    """
    return await read_user_by_username(request, db_session, current_user, username)


@router.put(
    "/{user_id}",
    response_model=UserRead,
    tags=["users"],
    summary="Update user",
    description="Update a user's profile fields. Invalidates the user's cached session so subsequent session reads reflect the change.",
    responses={
        200: {"description": "User updated successfully.", "model": UserRead},
        400: {"description": "Validation failed (duplicate email/username, invalid fields)"},
        403: {"description": "Caller lacks permission to update this user"},
        404: {"description": "User not found"},
    },
)
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
    result = await update_user(request, db_session, user_id, current_user, user_object)
    _invalidate_session_cache(user_id)
    return result


@router.put(
    "/update_avatar/{user_id}",
    response_model=UserRead,
    tags=["users"],
    summary="Update user avatar",
    description="Upload a new avatar image for a user. Users can only update their own avatar (the `user_id` in the URL must match the authenticated user's ID).",
    responses={
        200: {"description": "Avatar updated; cached session is invalidated so subsequent reads return the new image.", "model": UserRead},
        403: {"description": "Attempted to update another user's avatar"},
    },
)
async def api_update_avatar_user(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    user_id: int,
    avatar_file: UploadFile | None = None,
) -> UserRead:
    """
    Update User Avatar

    SECURITY: Users can only update their own avatar.
    The user_id in the URL must match the authenticated user's ID.
    """
    # SECURITY: IDOR protection - verify user can only update their own avatar
    if current_user.id != user_id:
        raise HTTPException(
            status_code=403,
            detail="You can only update your own avatar",
        )
    result = await update_user_avatar(request, db_session, current_user, avatar_file)
    # Invalidate session cache so the next session fetch returns the new avatar
    _invalidate_session_cache(user_id)
    return result


@router.put(
    "/change_password/{user_id}",
    response_model=UserRead,
    tags=["users"],
    summary="Change user password",
    description="Update a user's password. The authenticated user must either be the target user or otherwise authorized by the service layer.",
    responses={
        200: {"description": "Password changed successfully.", "model": UserRead},
        400: {"description": "New password fails validation"},
        401: {"description": "Wrong current password"},
        403: {"description": "Caller cannot change this user's password"},
        404: {"description": "User not found"},
    },
)
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


class ResetPasswordRequest(BaseModel):
    # Email is optional so the legacy path-param variant can reuse the same
    # body model; the v2 handlers require it.
    email: Optional[EmailStr] = None
    new_password: str
    org_id: int
    reset_code: str


class SendResetCodeRequest(BaseModel):
    email: EmailStr
    org_id: int


@router.post(
    "/reset_password/change_password",
    tags=["users"],
    summary="Change password with reset code",
    description="Change a user's password using a reset code. Email, reset code and new password are all supplied in the request body so they never appear in server logs or browser history.",
    responses={
        200: {"description": "Password updated successfully using the reset code."},
        429: {"description": "Too many password reset attempts for this email"},
    },
)
async def api_change_password_with_reset_code_v2(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    body: ResetPasswordRequest,
):
    """
    Update User Password with reset code (email in body).
    """
    if not body.email:
        raise HTTPException(status_code=422, detail="email is required")

    # Rate limit: 5 attempts per 5 minutes per email
    is_allowed, retry_after = check_password_reset_rate_limit(body.email)
    if not is_allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Too many password reset attempts. Please try again in {retry_after // 60} minutes.",
        )

    return await change_password_with_reset_code(
        request,
        db_session,
        current_user,
        body.new_password,
        body.org_id,
        body.email,
        body.reset_code,
    )


@router.post(
    "/reset_password/change_password/{email}",
    tags=["users"],
    summary="Change password with reset code (legacy path)",
    description="Deprecated: use /reset_password/change_password with email in the body. This path variant leaks the email into server access logs and exists only for backward compatibility.",
    deprecated=True,
    responses={
        200: {"description": "Password updated successfully using the reset code."},
        429: {"description": "Too many password reset attempts for this email"},
    },
)
async def api_change_password_with_reset_code(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    email: EmailStr,
    body: ResetPasswordRequest,
):
    # Rate limit: 5 attempts per 5 minutes per email
    is_allowed, retry_after = check_password_reset_rate_limit(email)
    if not is_allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Too many password reset attempts. Please try again in {retry_after // 60} minutes.",
        )

    return await change_password_with_reset_code(
        request, db_session, current_user, body.new_password, body.org_id, email, body.reset_code
    )


@router.post(
    "/reset_password/send_reset_code",
    tags=["users"],
    summary="Send password reset code",
    description="Dispatch an org-scoped password reset code to the given email address (email supplied in body so it never appears in access logs). Returns a generic response regardless of whether the email exists to avoid user enumeration.",
    responses={
        200: {"description": "Reset code email dispatch requested."},
        400: {"description": "Organization not found"},
    },
)
async def api_send_password_reset_email_v2(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    body: SendResetCodeRequest,
):
    return await send_reset_password_code(
        request, db_session, current_user, body.org_id, body.email
    )


@router.post(
    "/reset_password/send_reset_code/{email}",
    tags=["users"],
    summary="Send password reset code (legacy path)",
    description="Deprecated: use /reset_password/send_reset_code with email in the body.",
    deprecated=True,
    responses={
        200: {"description": "Reset code email dispatch requested."},
        400: {"description": "Organization not found"},
    },
)
async def api_send_password_reset_email(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    email: EmailStr,
    org_id: int,
):
    return await send_reset_password_code(
        request, db_session, current_user, org_id, email
    )


class PlatformResetPasswordRequest(BaseModel):
    email: Optional[EmailStr] = None
    new_password: str
    reset_code: str


class SendPlatformResetCodeRequest(BaseModel):
    email: EmailStr


@router.post(
    "/reset_password/platform/send_reset_code",
    tags=["users"],
    summary="Send platform password reset code",
    description="Dispatch a platform-level password reset code (email supplied in body so it does not appear in access logs). Subject to rate limiting per email.",
    responses={
        200: {"description": "Reset code email dispatch requested."},
        429: {"description": "Too many password reset attempts for this email"},
    },
)
async def api_send_password_reset_email_platform_v2(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    body: SendPlatformResetCodeRequest,
):
    is_allowed, retry_after = check_password_reset_rate_limit(body.email)
    if not is_allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Too many password reset attempts. Please try again in {retry_after // 60} minutes.",
        )
    return await send_reset_password_code_platform(
        request, db_session, current_user, body.email
    )


@router.post(
    "/reset_password/platform/send_reset_code/{email}",
    tags=["users"],
    summary="Send platform password reset code (legacy path)",
    description="Deprecated: use /reset_password/platform/send_reset_code with email in the body.",
    deprecated=True,
    responses={
        200: {"description": "Reset code email dispatch requested."},
        429: {"description": "Too many password reset attempts for this email"},
    },
)
async def api_send_password_reset_email_platform(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    email: EmailStr,
):
    is_allowed, retry_after = check_password_reset_rate_limit(email)
    if not is_allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Too many password reset attempts. Please try again in {retry_after // 60} minutes.",
        )

    return await send_reset_password_code_platform(
        request, db_session, current_user, email
    )


@router.post(
    "/reset_password/platform/change_password",
    tags=["users"],
    summary="Change platform password with reset code",
    description="Change a user's password at the platform level (email + reset code + new password all supplied in the body so none of them appear in server access logs).",
    responses={
        200: {"description": "Password updated successfully using the reset code."},
        429: {"description": "Too many password reset attempts for this email"},
    },
)
async def api_change_password_with_reset_code_platform_v2(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    body: PlatformResetPasswordRequest,
):
    if not body.email:
        raise HTTPException(status_code=422, detail="email is required")
    is_allowed, retry_after = check_password_reset_rate_limit(body.email)
    if not is_allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Too many password reset attempts. Please try again in {retry_after // 60} minutes.",
        )
    return await change_password_with_reset_code_platform(
        request, db_session, current_user, body.new_password, body.email, body.reset_code
    )


@router.post(
    "/reset_password/platform/change_password/{email}",
    tags=["users"],
    summary="Change platform password with reset code (legacy path)",
    description="Deprecated: use /reset_password/platform/change_password with email in the body.",
    deprecated=True,
    responses={
        200: {"description": "Password updated successfully using the reset code."},
        429: {"description": "Too many password reset attempts for this email"},
    },
)
async def api_change_password_with_reset_code_platform(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    email: EmailStr,
    body: PlatformResetPasswordRequest,
):
    is_allowed, retry_after = check_password_reset_rate_limit(email)
    if not is_allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Too many password reset attempts. Please try again in {retry_after // 60} minutes.",
        )

    return await change_password_with_reset_code_platform(
        request, db_session, current_user, body.new_password, email, body.reset_code
    )


@router.delete(
    "/user_id/{user_id}",
    tags=["users"],
    summary="Delete user",
    description="Delete a user by ID. Invalidates the user's cached session so stale session data is not served.",
    responses={
        200: {"description": "User deleted successfully."},
        403: {"description": "Caller cannot delete this user"},
        404: {"description": "User not found"},
    },
)
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
    result = await delete_user_by_id(request, db_session, current_user, user_id)
    _invalidate_session_cache(user_id)
    return result


@router.get(
    "/{user_id}/courses",
    response_model=List[CourseRead],
    tags=["users"],
    summary="List courses for user",
    description="List courses authored or contributed to by a user. Paginated; the maximum page size is 50 to prevent bulk data extraction.",
    responses={
        200: {"description": "Paginated list of the user's courses (max 50 per page)."},
        404: {"description": "User not found"},
    },
)
async def api_get_user_courses(
    *,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
    user_id: int,
    page: int = Query(default=1, ge=1, description="Page number"),
    limit: int = Query(default=10, ge=1, le=50, description="Items per page (max 50)"),
) -> List[CourseRead]:
    """
    Get courses made or contributed by a user.

    SECURITY: Maximum limit is 50 to prevent data dumping.
    """
    return await get_user_courses(
        request=request,
        current_user=current_user,
        user_id=user_id,
        db_session=db_session,
        page=page,
        limit=limit,
    )
