from datetime import datetime
from typing import Literal
from uuid import uuid4
from fastapi import HTTPException, Request, UploadFile, status
from sqlmodel import Session, select
from src.services.users.usergroups import add_users_to_usergroup
from src.services.users.emails import (
    send_account_creation_email,
)
from src.services.orgs.invites import get_invite_code
from src.services.users.avatars import upload_avatar
from src.db.roles import Role, RoleRead
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles_and_authorship_and_usergroups,
    authorization_verify_if_user_is_anon,
)
from src.db.organizations import Organization, OrganizationRead
from src.db.users import (
    AnonymousUser,
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


async def create_user(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    user_object: UserCreate,
    org_id: int,
):
    user = User.model_validate(user_object)

    # RBAC check
    await rbac_check(request, current_user, "create", "user_x", db_session)

    # Complete the user object
    user.user_uuid = f"user_{uuid4()}"
    user.password = security_hash_password(user_object.password)
    user.email_verified = False
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

    # Exclude unset values
    user_data = user.dict(exclude_unset=True)
    for key, value in user_data.items():
        setattr(user, key, value)

    # Add user to database
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    # Link user and organization
    user_organization = UserOrganization(
        user_id=user.id if user.id else 0,
        org_id=int(org_id),
        role_id=3,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(user_organization)
    db_session.commit()
    db_session.refresh(user_organization)

    user = UserRead.model_validate(user)

    # Send Account creation email
    send_account_creation_email(
        user=user,
        email=user.email,
    )

    return user


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

    # Check if invite code contains UserGroup
    if inviteCode.usergroup_id:
        # Add user to UserGroup
        await add_users_to_usergroup(
            request,
            db_session,
            current_user,
            inviteCode.usergroup_id,
            user_object.username,
        )

    user = await create_user(request, db_session, current_user, user_object, org_id)

    return user


async def create_user_without_org(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    user_object: UserCreate,
):
    user = User.model_validate(user_object)

    # RBAC check
    await rbac_check(request, current_user, "create", "user_x", db_session)

    # Complete the user object
    user.user_uuid = f"user_{uuid4()}"
    user.password = security_hash_password(user_object.password)
    user.email_verified = False
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

    # Exclude unset values
    user_data = user.dict(exclude_unset=True)
    for key, value in user_data.items():
        setattr(user, key, value)

    # Add user to database
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    user = UserRead.model_validate(user)

    # Send Account creation email
    send_account_creation_email(
        user=user,
        email=user.email,
    )

    return user


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

    # Update user
    user_data = user_object.dict(exclude_unset=True)
    for key, value in user_data.items():
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

    # Upload thumbnail
    if avatar_file and avatar_file.filename:
        name_in_disk = (
            f"{user.user_uuid}_avatar_{uuid4()}.{avatar_file.filename.split('.')[-1]}"
        )
        await upload_avatar(avatar_file, name_in_disk, user.user_uuid)

        # Update course
        if name_in_disk:
            user.avatar_image = name_in_disk
        else:
            raise HTTPException(
                status_code=500,
                detail="Issue with Avatar upload",
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
    # Get user
    statement = select(User).where(User.id == user_id)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=400,
            detail="User does not exist",
        )

    # RBAC check
    await rbac_check(request, current_user, "read", user.user_uuid, db_session)

    user = UserRead.model_validate(user)

    return user


async def read_user_by_uuid(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    user_uuid: str,
):
    # Get user
    statement = select(User).where(User.user_uuid == user_uuid)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=400,
            detail="User does not exist",
        )

    # RBAC check
    await rbac_check(request, current_user, "read", user.user_uuid, db_session)

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

    # Get roles and orgs
    statement = (
        select(UserOrganization)
        .where(UserOrganization.user_id == user.id)
        .join(Organization)
    )
    user_organizations = db_session.exec(statement).all()

    roles = []

    for user_organization in user_organizations:
        role_statement = select(Role).where(Role.id == user_organization.role_id)
        role = db_session.exec(role_statement).first()

        org_statement = select(Organization).where(
            Organization.id == user_organization.org_id
        )
        org = db_session.exec(org_statement).first()

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
        await authorization_verify_based_on_roles_and_authorship_and_usergroups(
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


async def security_get_user(request: Request, db_session: Session, email: str) -> User:
    # Check if user exists
    statement = select(User).where(User.email == email)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User with Email does not exist",
        )

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
    if action == "create":
        if current_user.id == 0:  # if user is anonymous
            return True
        else:
            await authorization_verify_based_on_roles_and_authorship_and_usergroups(
                request, current_user.id, "create", "user_x", db_session
            )

    else:
        await authorization_verify_if_user_is_anon(current_user.id)

        # if user is the same as the one being read
        if current_user.user_uuid == user_uuid:
            return True

        await authorization_verify_based_on_roles_and_authorship_and_usergroups(
            request, current_user.id, action, user_uuid, db_session
        )


## 🔒 RBAC Utils ##
