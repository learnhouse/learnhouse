from datetime import datetime, timedelta
import json
import logging

import redis
from fastapi import HTTPException, Request
from sqlmodel import Session, select
from config.config import get_learnhouse_config
from src.services.orgs.orgs import rbac_check
from src.db.roles import Role, RoleRead
from src.db.users import AnonymousUser, PublicUser, User, UserRead
from src.db.user_organizations import UserOrganization
from src.db.organizations import (
    Organization,
    OrganizationUser,
)


async def get_organization_users(
    request: Request,
    org_id: str,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
) -> list[OrganizationUser]:
    statement = select(Organization).where(Organization.id == org_id)
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    statement = (
        select(User)
        .join(UserOrganization)
        .join(Organization)
        .where(Organization.id == org_id)
    )
    users = db_session.exec(statement)
    users = users.all()

    org_users_list = []

    for user in users:
        statement = select(UserOrganization).where(
            UserOrganization.user_id == user.id, UserOrganization.org_id == org_id
        )
        result = db_session.exec(statement)
        user_org = result.first()

        if not user_org:
            logging.error(f"User {user.id} not found")

            # skip this user
            continue

        statement = select(Role).where(Role.id == user_org.role_id)
        result = db_session.exec(statement)

        role = result.first()

        if not role:
            logging.error(f"Role {user_org.role_id} not found")

            # skip this user
            continue

        statement = select(User).where(User.id == user_org.user_id)
        result = db_session.exec(statement)

        user = result.first()

        if not user:
            logging.error(f"User {user_org.user_id} not found")

            # skip this user
            continue

        user = UserRead.from_orm(user)
        role = RoleRead.from_orm(role)

        org_user = OrganizationUser(
            user=user,
            role=role,
        )

        org_users_list.append(org_user)

    return org_users_list


async def remove_user_from_org(
    request: Request,
    org_id: int,
    user_id: int,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
):
    statement = select(Organization).where(Organization.id == org_id)
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "delete", db_session)

    statement = select(UserOrganization).where(
        UserOrganization.user_id == user_id, UserOrganization.org_id == org.id
    )
    result = db_session.exec(statement)

    user_org = result.first()

    if not user_org:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    # Check if user is the last admin
    statement = select(UserOrganization).where(
        UserOrganization.org_id == org.id, UserOrganization.role_id == 1
    )
    result = db_session.exec(statement)
    admins = result.all()

    if len(admins) == 1 and admins[0].user_id == user_id:
        raise HTTPException(
            status_code=400,
            detail="You can't remove the last admin of the organization",
        )

    db_session.delete(user_org)
    db_session.commit()

    return {"detail": "User removed from org"}


async def update_user_role(
    request: Request,
    org_id: str,
    user_id: str,
    role_uuid: str,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
):
    # find role
    statement = select(Role).where(Role.role_uuid == role_uuid)
    result = db_session.exec(statement)

    role = result.first()

    if not role:
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    role_id = role.id

    statement = select(Organization).where(Organization.id == org_id)
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    # Check if user is the last admin and if the new role is not admin
    statement = select(UserOrganization).where(
        UserOrganization.org_id == org.id, UserOrganization.role_id == 1
    )
    result = db_session.exec(statement)
    admins = result.all()

    if not admins:
        raise HTTPException(
            status_code=400,
            detail="There is no admin in the organization",
        )

    if (
        len(admins) == 1
        and int(admins[0].user_id) == int(user_id)
        and str(role_uuid) != "role_global_admin"
    ):
        raise HTTPException(
            status_code=400,
            detail="Organization must have at least one admin",
        )

    statement = select(UserOrganization).where(
        UserOrganization.user_id == user_id, UserOrganization.org_id == org.id
    )
    result = db_session.exec(statement)

    user_org = result.first()

    if not user_org:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    if role_id is not None:
        user_org.role_id = role_id

    db_session.add(user_org)
    db_session.commit()
    db_session.refresh(user_org)

    return {"detail": "User role updated"}


async def invite_batch_users(
    request: Request,
    org_id: int,
    emails: str,
    invite_code_uuid: str,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
):
    # Redis init
    LH_CONFIG = get_learnhouse_config()
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

    if not redis_conn_string:
        raise HTTPException(
            status_code=500,
            detail="Redis connection string not found",
        )

    statement = select(Organization).where(Organization.id == org_id)
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "create", db_session)

    # Connect to Redis
    r = redis.Redis.from_url(redis_conn_string)

    if not r:
        raise HTTPException(
            status_code=500,
            detail="Could not connect to Redis",
        )

    invite_list = emails.split(",")

    # invitations expire after 60 days
    ttl = int(timedelta(days=60).total_seconds())

    for email in invite_list:
        email = email.strip()

        # Check if user is already invited
        invited_user = r.get(f"invited_user:{email}:org:{org.org_uuid}")

        if invited_user:
            logging.error(f"User {email} already invited")
            # skip this user
            continue

        invited_user_object = {
            "email": email,
            "org_id": org.id,
            "invite_code_uuid": invite_code_uuid,
            "pending": True,
            "email_sent": False,
            "expires": ttl,
            "created_at": datetime.now().isoformat(),
            "created_by": current_user.user_uuid,
        }

        invited_user = r.set(
            f"invited_user:{email}:org:{org.org_uuid}",
            json.dumps(invited_user_object),
            ex=ttl,
        )

    return {"detail": "Users invited"}


async def get_list_of_invited_users(
    request: Request,
    org_id: int,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
):
    # Redis init
    LH_CONFIG = get_learnhouse_config()
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

    if not redis_conn_string:
        raise HTTPException(
            status_code=500,
            detail="Redis connection string not found",
        )

    statement = select(Organization).where(Organization.id == org_id)
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    # Connect to Redis
    r = redis.Redis.from_url(redis_conn_string)

    if not r:
        raise HTTPException(
            status_code=500,
            detail="Could not connect to Redis",
        )

    invited_users = r.keys(f"invited_user:*:org:{org.org_uuid}")

    invited_users_list = []

    for user in invited_users:
        invited_user = r.get(user)
        if invited_user:
            invited_user = json.loads(invited_user.decode("utf-8"))
            invited_users_list.append(invited_user)

    return invited_users_list


async def remove_invited_user(
    request: Request,
    org_id: int,
    email: str,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
):
    # Redis init
    LH_CONFIG = get_learnhouse_config()
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

    if not redis_conn_string:
        raise HTTPException(
            status_code=500,
            detail="Redis connection string not found",
        )

    statement = select(Organization).where(Organization.id == org_id)
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "delete", db_session)

    # Connect to Redis
    r = redis.Redis.from_url(redis_conn_string)

    if not r:
        raise HTTPException(
            status_code=500,
            detail="Could not connect to Redis",
        )

    invited_user = r.get(f"invited_user:{email}:org:{org.org_uuid}")

    if not invited_user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    r.delete(f"invited_user:{email}:org:{org.org_uuid}")

    return {"detail": "User removed"}
