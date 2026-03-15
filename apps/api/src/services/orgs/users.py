from datetime import datetime, timedelta
import json
import logging

import redis
from fastapi import HTTPException, Request
from sqlalchemy.orm import aliased
from sqlmodel import Session, select, func
from src.security.features_utils.usage import decrease_feature_usage
from src.services.orgs.invites import send_invite_email
from src.services.email.utils import get_base_url_from_request
from config.config import get_learnhouse_config
from src.services.orgs.orgs import rbac_check
from src.security.rbac.constants import ADMIN_ROLE_ID
from src.security.org_auth import is_org_member
from src.db.roles import Role, RoleRead
from src.db.users import AnonymousUser, PublicUser, User, UserRead
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup, UserGroupRead
from src.db.organizations import (
    Organization,
    OrganizationRead,
    OrganizationUser,
)


async def get_organization_users(
    request: Request,
    org_id: str,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    page: int = 1,
    limit: int = 20,
    search: str = "",
    usergroup_id: int | None = None,
    usergroup_filter: str | None = None,
    sort_order: str = "desc",
    role_id: int | None = None,
    status: str | None = None,
):
    """
    Get paginated list of users in an organization.

    SECURITY:
    - Requires authentication (enforced at router level)
    - User must be a member of the organization to view member list
    - Maximum limit enforced to prevent data dumping
    """
    # SECURITY: Enforce maximum limit
    limit = min(limit, 100)
    page = max(page, 1)

    statement = select(Organization).where(Organization.id == org_id)
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # SECURITY: Verify current user is a member of this organization
    # This prevents users from enumerating members of orgs they don't belong to
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
        )

    # Membership check (superadmins bypass)
    if not is_org_member(current_user.id, org.id, db_session):
        raise HTTPException(
            status_code=403,
            detail="You must be a member of this organization to view its members",
        )

    # RBAC check (for additional permission verification) — skip for superadmins
    from src.security.superadmin import is_user_superadmin
    if not is_user_superadmin(current_user.id, db_session):
        await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    # Base query for users in the organization
    base_statement = (
        select(User)
        .join(UserOrganization)
        .join(Organization)
        .where(Organization.id == org_id)
    )

    # Apply search filter if provided
    if search:
        search_pattern = f"%{search}%"
        base_statement = base_statement.where(
            (User.first_name.ilike(search_pattern))
            | (User.last_name.ilike(search_pattern))
            | (User.username.ilike(search_pattern))
            | (User.email.ilike(search_pattern))
        )

    # Apply role filter
    if role_id is not None:
        base_statement = base_statement.where(UserOrganization.role_id == role_id)

    # Apply status filter (verified/unverified)
    if status == "verified":
        base_statement = base_statement.where(User.email_verified == True)  # noqa: E712
    elif status == "unverified":
        base_statement = base_statement.where(User.email_verified == False)  # noqa: E712

    # Compute group membership counts when usergroup_id is provided (before applying filter)
    in_group_total = None
    all_total = None
    if usergroup_id is not None:
        # Count all org users matching search (unfiltered) using SQL COUNT
        all_count_stmt = select(func.count()).select_from(base_statement.subquery())
        all_total = db_session.exec(all_count_stmt).one()

        # Count in-group users matching search using SQL COUNT
        in_group_count_stmt = (
            select(func.count(User.id))
            .join(UserOrganization)
            .join(Organization)
            .where(Organization.id == org_id)
            .join(UserGroupUser, (UserGroupUser.user_id == User.id) & (UserGroupUser.usergroup_id == usergroup_id))
        )
        if search:
            search_pattern = f"%{search}%"
            in_group_count_stmt = in_group_count_stmt.where(
                (User.first_name.ilike(search_pattern))
                | (User.last_name.ilike(search_pattern))
                | (User.username.ilike(search_pattern))
                | (User.email.ilike(search_pattern))
            )
        in_group_total = db_session.exec(in_group_count_stmt).one()

    # Apply usergroup membership filter
    if usergroup_id is not None and usergroup_filter:
        if usergroup_filter == "in_group":
            base_statement = base_statement.join(
                UserGroupUser,
                (UserGroupUser.user_id == User.id) & (UserGroupUser.usergroup_id == usergroup_id),
            )
        elif usergroup_filter == "not_in_group":
            ugu_alias = aliased(UserGroupUser)
            base_statement = base_statement.outerjoin(
                ugu_alias,
                (ugu_alias.user_id == User.id) & (ugu_alias.usergroup_id == usergroup_id),
            ).where(ugu_alias.id == None)  # noqa: E711

    # Get total count using SQL COUNT
    total = db_session.exec(select(func.count()).select_from(base_statement.subquery())).one()

    # Sort by join date — use UserOrganization.id as it's auto-increment
    # and directly correlates with join order (creation_date is a str, unreliable for sorting)
    if sort_order == "asc":
        base_statement = base_statement.order_by(UserOrganization.id.asc())
    else:
        base_statement = base_statement.order_by(UserOrganization.id.desc())

    # Apply pagination
    offset = (page - 1) * limit
    paginated_statement = base_statement.offset(offset).limit(limit)
    users = db_session.exec(paginated_statement).all()

    org_users_list = []

    if not users:
        pass
    else:
        user_ids = [user.id for user in users]

        # Batch fetch all UserOrganization records for these users
        user_orgs_statement = select(UserOrganization).where(
            UserOrganization.user_id.in_(user_ids),  # type: ignore
            UserOrganization.org_id == org_id
        )
        user_orgs = db_session.exec(user_orgs_statement).all()
        user_org_map = {uo.user_id: uo for uo in user_orgs}

        # Batch fetch all roles needed
        role_ids = list({uo.role_id for uo in user_orgs if uo.role_id is not None})
        if role_ids:
            roles_statement = select(Role).where(Role.id.in_(role_ids))  # type: ignore
            roles = db_session.exec(roles_statement).all()
            role_map = {role.id: role for role in roles}
        else:
            role_map = {}

        # Batch fetch all usergroups for these users in this org
        usergroups_statement = (
            select(UserGroupUser, UserGroup)
            .join(UserGroup, UserGroupUser.usergroup_id == UserGroup.id)  # type: ignore
            .where(
                UserGroupUser.user_id.in_(user_ids),  # type: ignore
                UserGroupUser.org_id == org_id
            )
        )
        usergroup_results = db_session.exec(usergroups_statement).all()
        user_usergroups_map: dict[int, list[UserGroupRead]] = {}
        for ugu, ug in usergroup_results:
            user_usergroups_map.setdefault(ugu.user_id, []).append(
                UserGroupRead.model_validate(ug)
            )

        for user in users:
            user_org = user_org_map.get(user.id)
            if not user_org:
                logging.error(f"User {user.id} not found")
                continue

            role = role_map.get(user_org.role_id)
            if not role:
                logging.error(f"Role {user_org.role_id} not found")
                continue

            user_read = UserRead.model_validate(user)
            role_read = RoleRead.model_validate(role)
            usergroups = user_usergroups_map.get(user.id, [])

            org_user = OrganizationUser(
                user=user_read,
                role=role_read,
                usergroups=usergroups,
                joined_at=user_org.creation_date,
            )

            org_users_list.append(org_user)

    result = {
        "items": org_users_list,
        "total": total,
        "page": page,
        "limit": limit,
    }

    if in_group_total is not None:
        result["in_group_total"] = in_group_total
    if all_total is not None:
        result["all_total"] = all_total

    return result


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
        UserOrganization.org_id == org.id, UserOrganization.role_id == ADMIN_ROLE_ID
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

    from src.routers.users import _invalidate_session_cache
    _invalidate_session_cache(user_id)

    decrease_feature_usage("members", org_id, db_session)

    return {"detail": "User removed from org"}


async def remove_batch_users_from_org(
    request: Request,
    org_id: int,
    user_ids: list[int],
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

    # Get all admins for last-admin protection
    admin_statement = select(UserOrganization).where(
        UserOrganization.org_id == org.id, UserOrganization.role_id == ADMIN_ROLE_ID
    )
    admins = db_session.exec(admin_statement).all()
    admin_ids = {a.user_id for a in admins}

    # Check if removing these users would remove all admins
    remaining_admins = admin_ids - set(user_ids)
    if len(admin_ids) > 0 and len(remaining_admins) == 0:
        raise HTTPException(
            status_code=400,
            detail="Cannot remove all admins from the organization",
        )

    removed_count = 0
    for user_id in user_ids:
        statement = select(UserOrganization).where(
            UserOrganization.user_id == user_id, UserOrganization.org_id == org.id
        )
        user_org = db_session.exec(statement).first()

        if user_org:
            db_session.delete(user_org)
            removed_count += 1

    db_session.commit()

    from src.routers.users import _invalidate_session_cache
    for uid in user_ids:
        _invalidate_session_cache(uid)

    for _ in range(removed_count):
        decrease_feature_usage("members", org_id, db_session)

    return {"detail": f"{removed_count} user(s) removed from org"}


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
        UserOrganization.org_id == org.id, UserOrganization.role_id == ADMIN_ROLE_ID
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

    from src.routers.users import _invalidate_session_cache
    _invalidate_session_cache(user_org.user_id)

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

    # get User sender
    statement = select(User).where(User.id == current_user.id)
    user = db_session.exec(statement).first()

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

        org = OrganizationRead.model_validate(org)
        user = UserRead.model_validate(user)

        base_url = get_base_url_from_request(request)
        isEmailSent = send_invite_email(
            org,
            invite_code_uuid,
            user,
            email,
            base_url,
        )

        invited_user_object = {
            "email": email,
            "org_id": org.id,
            "invite_code_uuid": invite_code_uuid,
            "pending": True,
            "email_sent": isEmailSent,
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

    # Use scan_iter instead of keys() to avoid blocking Redis
    invited_users = list(r.scan_iter(match=f"invited_user:*:org:{org.org_uuid}", count=100))

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
