from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4
from fastapi import HTTPException, Request, UploadFile, status
from sqlmodel import Session, select
from src.security.features_utils.usage import (
    check_limits_with_usage,
    increase_feature_usage,
    _is_oss_mode,
)
from src.services.users.usergroups import add_users_to_usergroup
from src.services.users.emails import (
    send_account_creation_email,
)
from src.services.orgs.invites import get_invite_code
from src.services.users.avatars import upload_avatar
from src.db.roles import Role, RoleRead
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles_and_authorship,
    authorization_verify_if_user_is_anon,
)
from src.db.organizations import Organization, OrganizationRead
from src.db.users import (
    AnonymousUser,
    InternalUser,
    PublicUser,
    User,
    UserCreate,
    UserRead,
    UserRoleWithOrg,
    UserSession,
    UserUpdate,
    UserUpdatePassword,
)
from src.db.user_organizations import UserOrganization
from src.security.security import security_hash_password, security_verify_password
from src.services.security.password_validation import validate_password_complexity
from src.services.analytics.analytics import track
from src.services.analytics import events as analytics_events


async def create_user(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    user_object: UserCreate,
    org_id: int,
    is_oauth: bool = False,
    signup_provider: str = "email",
):
    # Validate password complexity (skip for OAuth users who have empty passwords)
    if user_object.password and not is_oauth:
        validation_result = validate_password_complexity(user_object.password)
        if not validation_result.is_valid:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "WEAK_PASSWORD",
                    "message": "Password does not meet security requirements",
                    "errors": validation_result.errors,
                    "requirements": validation_result.requirements,
                },
            )

    user = User.model_validate(user_object)

    # RBAC check
    await rbac_check(request, current_user, "create", "user_x", db_session)

    # Complete the user object
    user.user_uuid = f"user_{uuid4()}"
    user.password = security_hash_password(user_object.password) if user_object.password else ""

    # OAuth users and OSS mode get auto-verified email
    if is_oauth or _is_oss_mode():
        user.email_verified = True
        user.email_verified_at = datetime.now(timezone.utc).isoformat()
        user.signup_method = signup_provider if is_oauth else "email"
    else:
        user.email_verified = False
        user.email_verified_at = None
        user.signup_method = "email"

    user.creation_date = str(datetime.now())
    user.update_date = str(datetime.now())

    # Verifications

    # Check if Organization exists
    statement = select(Organization).where(Organization.id == org_id)
    result = db_session.exec(statement)

    if not result.first():
        raise HTTPException(
            status_code=400,
            detail="Organization does not exist",
        )

    # Usage check
    check_limits_with_usage("members", org_id, db_session)

    # Username
    statement = select(User).where(User.username == user.username)
    result = db_session.exec(statement)

    if result.first():
        raise HTTPException(
            status_code=400,
            detail="Username already exists",
        )

    # Email
    statement = select(User).where(User.email == user.email)
    result = db_session.exec(statement)

    if result.first():
        raise HTTPException(
            status_code=400,
            detail="Email already exists",
        )

    # Exclude unset values; strip protected fields to prevent privilege escalation
    _PROTECTED_FIELDS = {"is_superadmin", "id", "user_uuid"}
    user_data = user.model_dump(exclude_unset=True)
    for key, value in user_data.items():
        if key not in _PROTECTED_FIELDS:
            setattr(user, key, value)

    # Add user to database
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    # Link user and organization
    user_organization = UserOrganization(
        user_id=user.id if user.id else 0,
        org_id=int(org_id),
        role_id=4,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(user_organization)
    db_session.commit()
    db_session.refresh(user_organization)

    user_read = UserRead.model_validate(user)

    increase_feature_usage("members", org_id, db_session)

    # Track user signup
    await track(
        event_name=analytics_events.USER_SIGNED_UP,
        org_id=org_id,
        user_id=user.id if user.id else 0,
        properties={"signup_method": signup_provider},
    )

    # Send verification email for non-OAuth users, account creation email for OAuth users
    if is_oauth:
        send_account_creation_email(
            user=user_read,
            email=user_read.email,
        )
    else:
        # Import here to avoid circular imports
        from src.services.users.email_verification import send_verification_email
        try:
            await send_verification_email(request, db_session, user, org_id)
        except Exception:
            # Log but don't fail user creation if email fails
            pass

    return user_read


async def create_user_with_invite(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    user_object: UserCreate,
    org_id: int,
    invite_code: str,
):

    # Check if invite code exists
    inviteCode = await get_invite_code(
        request, org_id, invite_code, current_user, db_session
    )

    if not inviteCode:
        raise HTTPException(
            status_code=400,
            detail="Invite code is incorrect",
        )

    # Usage check
    check_limits_with_usage("members", org_id, db_session)

    

    user = await create_user(request, db_session, current_user, user_object, org_id, signup_provider="invite")

    # Check if invite code contains UserGroup
    if inviteCode.get("usergroup_id"): # type: ignore
        # Add user to UserGroup
        await add_users_to_usergroup(
            request,
            db_session,
            InternalUser(id=0),
            int(inviteCode.get("usergroup_id")), # type: ignore / Convert to int since usergroup_id is expected to be int
            str(user.id),
        )

    increase_feature_usage("members", org_id, db_session)

    return user


async def create_user_without_org(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    user_object: UserCreate,
    is_oauth: bool = False,
    signup_provider: str = "email",
):
    # Validate password complexity (skip for OAuth users who have empty passwords)
    if user_object.password and not is_oauth:
        validation_result = validate_password_complexity(user_object.password)
        if not validation_result.is_valid:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "WEAK_PASSWORD",
                    "message": "Password does not meet security requirements",
                    "errors": validation_result.errors,
                    "requirements": validation_result.requirements,
                },
            )

    user = User.model_validate(user_object)

    # RBAC check
    await rbac_check(request, current_user, "create", "user_x", db_session)

    # Complete the user object
    user.user_uuid = f"user_{uuid4()}"
    user.password = security_hash_password(user_object.password) if user_object.password else ""

    # OAuth users and OSS mode get auto-verified email
    if is_oauth or _is_oss_mode():
        user.email_verified = True
        user.email_verified_at = datetime.now(timezone.utc).isoformat()
        user.signup_method = signup_provider if is_oauth else "email"
    else:
        user.email_verified = False
        user.email_verified_at = None
        user.signup_method = "email"

    user.creation_date = str(datetime.now())
    user.update_date = str(datetime.now())

    # Verifications

    # Username
    statement = select(User).where(User.username == user.username)
    result = db_session.exec(statement)

    if result.first():
        raise HTTPException(
            status_code=400,
            detail="Username already exists",
        )

    # Email
    statement = select(User).where(User.email == user.email)
    result = db_session.exec(statement)

    if result.first():
        raise HTTPException(
            status_code=400,
            detail="Email already exists",
        )

    # Exclude unset values; strip protected fields to prevent privilege escalation
    _PROTECTED_FIELDS = {"is_superadmin", "id", "user_uuid"}
    user_data = user.model_dump(exclude_unset=True)
    for key, value in user_data.items():
        if key not in _PROTECTED_FIELDS:
            setattr(user, key, value)

    # Add user to database
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    user_read = UserRead.model_validate(user)

    # Send account creation email for OAuth users (they're already verified)
    # Non-OAuth users without org can't receive verification emails since they need org context
    # So we just send the welcome email
    send_account_creation_email(
        user=user_read,
        email=user_read.email,
    )

    return user_read


async def update_user(
    request: Request,
    db_session: Session,
    user_id: int,
    current_user: PublicUser | AnonymousUser,
    user_object: UserUpdate,
):
    # Get user
    statement = select(User).where(User.id == user_id)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=400,
            detail="User does not exist",
        )

    # RBAC check
    await rbac_check(request, current_user, "update", user.user_uuid, db_session)

    # Verifications

    # Username
    statement = select(User).where(User.username == user_object.username)
    username_user = db_session.exec(statement).first()

    if username_user:
        isSameUser = username_user.id == current_user.id
        if not isSameUser:
            raise HTTPException(
                status_code=400,
                detail="Username already exists",
            )

    # Email
    statement = select(User).where(User.email == user_object.email)
    email_user = db_session.exec(statement).first()

    if email_user:
        isSameUser = email_user.id == current_user.id
        if not isSameUser:
            raise HTTPException(
                status_code=400,
                detail="Email already exists",
            )

    # Update user; strip protected fields to prevent privilege escalation
    _PROTECTED_FIELDS = {"is_superadmin", "id", "user_uuid"}
    user_data = user_object.model_dump(exclude_unset=True)
    for key, value in user_data.items():
        if key not in _PROTECTED_FIELDS:
            setattr(user, key, value)

    user.update_date = str(datetime.now())

    # Update user in database
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    user = UserRead.model_validate(user)

    return user


async def update_user_avatar(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    avatar_file: UploadFile | None = None,
):
    # Get user
    statement = select(User).where(User.id == current_user.id)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=400,
            detail="User does not exist",
        )

    # RBAC check
    await rbac_check(request, current_user, "update", user.user_uuid, db_session)

    # Upload avatar with security validation
    if avatar_file and avatar_file.filename:
        try:
            name_in_disk = await upload_avatar(avatar_file, user.user_uuid)
            user.avatar_image = name_in_disk
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Avatar upload failed: {str(e)}",
            )

    # Update user in database
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    user = UserRead.model_validate(user)

    return user


async def update_user_password(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    user_id: int,
    form: UserUpdatePassword,
):
    """
    Update user password.

    SECURITY: Users can only change their own password. This function:
    1. Validates that user_id matches current_user.id (IDOR protection)
    2. Verifies the old password before allowing change
    3. Validates password complexity requirements
    """
    
    # Users can ONLY change their own password
    if current_user.id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only change your own password",
        )

    # Validate new password complexity
    validation_result = validate_password_complexity(form.new_password)
    if not validation_result.is_valid:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "WEAK_PASSWORD",
                "message": "Password does not meet security requirements",
                "errors": validation_result.errors,
                "requirements": validation_result.requirements,
            },
        )

    # Get user (we already verified it's the current user)
    statement = select(User).where(User.id == user_id)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=400,
            detail="User does not exist",
        )

    # Verify old password before allowing change
    if not security_verify_password(form.old_password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong password"
        )

    # Update user
    user.password = security_hash_password(form.new_password)
    user.update_date = str(datetime.now())

    # Update user in database
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    user = UserRead.model_validate(user)

    return user


async def read_user_by_id(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    user_id: int,
):
    """
    Get user by ID.

    SECURITY: Returns 404 with generic message to prevent user enumeration.
    """
    # Get user
    statement = select(User).where(User.id == user_id)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=404,
            detail="Resource not found",  # Generic message prevents enumeration
        )

    user = UserRead.model_validate(user)

    return user


async def read_user_by_uuid(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    user_uuid: str,
):
    """
    Get user by UUID.

    SECURITY: Returns 404 with generic message to prevent user enumeration.
    """
    # Get user
    statement = select(User).where(User.user_uuid == user_uuid)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=404,
            detail="Resource not found",  # Generic message prevents enumeration
        )

    user = UserRead.model_validate(user)

    return user


async def read_user_by_username(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    username: str,
):
    """
    Get user by username.

    SECURITY: Returns 404 with generic message to prevent username enumeration.
    """
    # Get user
    statement = select(User).where(User.username == username)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=404,
            detail="Resource not found",  # Generic message prevents enumeration
        )

    user = UserRead.model_validate(user)

    return user


async def get_user_session(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
) -> UserSession:
    # Get user
    statement = select(User).where(User.user_uuid == current_user.user_uuid)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=400,
            detail="User does not exist",
        )

    user = UserRead.model_validate(user)

    # Get roles and orgs in a single JOIN query (avoids N+1)
    statement = (
        select(Role, Organization)
        .join(UserOrganization, UserOrganization.role_id == Role.id)
        .join(Organization, Organization.id == UserOrganization.org_id)
        .where(UserOrganization.user_id == user.id)
    )
    results = db_session.exec(statement).all()

    roles = []

    for role, org in results:
        roles.append(
            UserRoleWithOrg(
                role=RoleRead.model_validate(role),
                org=OrganizationRead.model_validate(org),
            )
        )

    user_session = UserSession(
        user=user,
        roles=roles,
    )

    return user_session


async def authorize_user_action(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    resource_uuid: str,
    action: Literal["create", "read", "update", "delete"],
):
    # Get user
    statement = select(User).where(User.user_uuid == current_user.user_uuid)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=400,
            detail="User does not exist",
        )

    # RBAC check
    authorized = (
        await authorization_verify_based_on_roles_and_authorship(
            request, current_user.id, action, resource_uuid, db_session
        )
    )

    if authorized:
        return True
    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to perform this action",
        )


async def delete_user_by_id(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    user_id: int,
):
    # Get user
    statement = select(User).where(User.id == user_id)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=400,
            detail="User does not exist",
        )

    # RBAC check
    await rbac_check(request, current_user, "delete", user.user_uuid, db_session)

    # Delete user
    db_session.delete(user)
    db_session.commit()

    return "User deleted"


# Utils & Security functions


async def security_get_user(request: Request, db_session: Session, email: str) -> User | None:
    """
    Get user by email for security/authentication purposes.

    Returns None if user doesn't exist (rather than throwing an exception)
    to allow the caller to handle the "user not found" case appropriately
    and prevent email enumeration vulnerabilities.
    """
    # Check if user exists
    statement = select(User).where(User.email == email)
    user = db_session.exec(statement).first()

    if not user:
        return None

    user = User(**user.model_dump())

    return user


## 🔒 RBAC Utils ##


async def rbac_check(
    request: Request,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    user_uuid: str,
    db_session: Session,
):
    if action == "create" or action == "read":
        if current_user.id == 0:  # if user is anonymous
            return True
        else:
            await authorization_verify_based_on_roles_and_authorship(
                request, current_user.id, "create", "user_x", db_session
            )

    else:
        await authorization_verify_if_user_is_anon(current_user.id)

        # if user is the same as the one being read
        if current_user.user_uuid == user_uuid:
            return True

        await authorization_verify_based_on_roles_and_authorship(
            request, current_user.id, action, user_uuid, db_session
        )


## 🔒 RBAC Utils ##
