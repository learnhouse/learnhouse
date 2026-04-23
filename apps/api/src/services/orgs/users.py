import csv
import io
import json
import logging
from datetime import datetime, timedelta
from typing import Optional

import redis
from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import aliased
from sqlmodel import Session, select, func

from config.config import get_learnhouse_config
from src.db.organizations import Organization, OrganizationRead, OrganizationUser
from src.db.roles import Role, RoleRead
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup, UserGroupRead
from src.db.users import AnonymousUser, APITokenUser, PublicUser, User, UserRead
from src.security.auth import resolve_acting_user_id
from src.security.features_utils.usage import decrease_feature_usage
from src.security.org_auth import is_org_member
from src.security.rbac.constants import ADMIN_ROLE_ID
from src.services.orgs.invites import send_invite_email
from src.services.orgs.orgs import rbac_check
from src.services.users.emails import send_role_changed_email
from src.services.webhooks.dispatch import dispatch_webhooks

logger = logging.getLogger(__name__)


async def get_organization_users(
    request: Request,
    org_id: str,
    db_session: Session,
    current_user: PublicUser | AnonymousUser | APITokenUser,
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

    acting_user_id = resolve_acting_user_id(current_user)

    # Membership check (superadmins bypass)
    if not is_org_member(acting_user_id, org.id, db_session):
        raise HTTPException(
            status_code=403,
            detail="You must be a member of this organization to view its members",
        )

    # Only admins/maintainers can list organization members
    from src.security.superadmin import is_user_superadmin
    if not is_user_superadmin(acting_user_id, db_session):
        from src.security.org_auth import is_org_admin
        if not is_org_admin(acting_user_id, org.id, db_session):
            raise HTTPException(
                status_code=403,
                detail="Only administrators and maintainers can view organization members",
            )

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


async def export_organization_users_csv(
    request: Request,
    org_id: str,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    search: str = "",
    usergroup_id: int | None = None,
    usergroup_filter: str | None = None,
    sort_order: str = "desc",
    role_id: int | None = None,
    status: str | None = None,
):
    """
    Export all organization users as CSV.
    Reuses the same auth/filtering logic as get_organization_users but without pagination.
    """
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    export_acting_user_id = resolve_acting_user_id(current_user)
    if not is_org_member(export_acting_user_id, org.id, db_session):
        raise HTTPException(status_code=403, detail="You must be a member of this organization")

    # Only admins/maintainers can export organization members
    from src.security.superadmin import is_user_superadmin
    if not is_user_superadmin(export_acting_user_id, db_session):
        from src.security.org_auth import is_org_admin
        if not is_org_admin(export_acting_user_id, org.id, db_session):
            raise HTTPException(
                status_code=403,
                detail="Only administrators and maintainers can export organization members",
            )

    base_statement = (
        select(User)
        .join(UserOrganization)
        .join(Organization)
        .where(Organization.id == org_id)
    )

    if search:
        search_pattern = f"%{search}%"
        base_statement = base_statement.where(
            (User.first_name.ilike(search_pattern))
            | (User.last_name.ilike(search_pattern))
            | (User.username.ilike(search_pattern))
            | (User.email.ilike(search_pattern))
        )

    if role_id is not None:
        base_statement = base_statement.where(UserOrganization.role_id == role_id)

    if status == "verified":
        base_statement = base_statement.where(User.email_verified == True)  # noqa: E712
    elif status == "unverified":
        base_statement = base_statement.where(User.email_verified == False)  # noqa: E712

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

    if sort_order == "asc":
        base_statement = base_statement.order_by(UserOrganization.id.asc())
    else:
        base_statement = base_statement.order_by(UserOrganization.id.desc())

    users = db_session.exec(base_statement).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Name", "Username", "Email", "Groups", "Role", "Joined", "Email Verified", "Signup Method", "Last Login"])

    if users:
        user_ids = [user.id for user in users]

        user_orgs = db_session.exec(
            select(UserOrganization).where(
                UserOrganization.user_id.in_(user_ids),  # type: ignore
                UserOrganization.org_id == org_id,
            )
        ).all()
        user_org_map = {uo.user_id: uo for uo in user_orgs}

        role_ids = list({uo.role_id for uo in user_orgs if uo.role_id is not None})
        role_map = {}
        if role_ids:
            roles = db_session.exec(select(Role).where(Role.id.in_(role_ids))).all()  # type: ignore
            role_map = {role.id: role for role in roles}

        usergroup_results = db_session.exec(
            select(UserGroupUser, UserGroup)
            .join(UserGroup, UserGroupUser.usergroup_id == UserGroup.id)  # type: ignore
            .where(
                UserGroupUser.user_id.in_(user_ids),  # type: ignore
                UserGroupUser.org_id == org_id,
            )
        ).all()
        user_usergroups_map: dict[int, list[str]] = {}
        for ugu, ug in usergroup_results:
            user_usergroups_map.setdefault(ugu.user_id, []).append(ug.name)

        def fmt_date(d):
            if not d:
                return ""
            try:
                dt = datetime.fromisoformat(str(d)) if not isinstance(d, datetime) else d
                return dt.strftime("%b %d, %Y")
            except Exception:
                return str(d)

        for user in users:
            user_org = user_org_map.get(user.id)
            if not user_org:
                continue
            role = role_map.get(user_org.role_id)
            groups = "; ".join(user_usergroups_map.get(user.id, []))

            writer.writerow([
                f"{user.first_name or ''} {user.last_name or ''}".strip(),
                user.username or "",
                user.email or "",
                groups,
                role.name if role else "",
                fmt_date(user_org.creation_date),
                "Yes" if user.email_verified else "No",
                user.signup_method or "",
                fmt_date(user.last_login_at) if hasattr(user, "last_login_at") else "",
            ])

    output.seek(0)
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=users-export.csv"},
    )


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

    await dispatch_webhooks(
        event_name="user_removed_from_org",
        org_id=org_id,
        data={"user_id": user_id, "org_id": org_id},
    )

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

    if user_ids:
        remove_stmt = select(UserOrganization).where(
            UserOrganization.user_id.in_(user_ids),
            UserOrganization.org_id == org.id,
        )
        user_orgs_to_remove = db_session.exec(remove_stmt).all()
    else:
        user_orgs_to_remove = []

    removed_count = len(user_orgs_to_remove)
    for user_org in user_orgs_to_remove:
        db_session.delete(user_org)

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

    await dispatch_webhooks(
        event_name="user_role_changed",
        org_id=int(org_id),
        data={
            "user_id": int(user_id),
            "org_id": int(org_id),
            "new_role_uuid": role_uuid,
        },
    )

    # Send role change notification email
    try:
        user = db_session.exec(
            select(User).where(User.id == int(user_id))
        ).first()
        if user and user.email:
            send_role_changed_email(
                email=user.email,
                username=user.username,
                org_name=org.name,
                new_role_name=role.name,
            )
    except Exception:
        logger.warning("Failed to send role change email to user %s", user_id)

    return {"detail": "User role updated"}


async def invite_batch_users(
    request: Request,
    org_id: int,
    emails: str,
    invite_code_uuid: Optional[str],
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

    results = []

    for email in invite_list:
        email = email.strip()
        if not email:
            continue

        # Check if user is already invited
        invited_user = r.get(f"invited_user:{email}:org:{org.org_uuid}")

        if invited_user:
            results.append({"email": email, "status": "already_invited"})
            continue

        org = OrganizationRead.model_validate(org)
        user = UserRead.model_validate(user)

        isEmailSent = send_invite_email(
            org,
            invite_code_uuid,
            user,
            email,
            request,
            db_session=db_session,
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

        r.set(
            f"invited_user:{email}:org:{org.org_uuid}",
            json.dumps(invited_user_object),
            ex=ttl,
        )

        results.append({
            "email": email,
            "status": "sent" if isEmailSent else "email_failed",
        })

    sent = sum(1 for r in results if r["status"] == "sent")
    failed = sum(1 for r in results if r["status"] == "email_failed")
    skipped = sum(1 for r in results if r["status"] == "already_invited")

    await dispatch_webhooks(
        event_name="user_invited_to_org",
        org_id=org_id,
        data={
            "org_id": org_id,
            "emails": invite_list,
            "invite_code_uuid": invite_code_uuid,
            "invited_by": current_user.user_uuid,
        },
    )

    return {
        "detail": "Users invited",
        "results": results,
        "summary": {
            "total": len(results),
            "sent": sent,
            "failed": failed,
            "already_invited": skipped,
        },
    }


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
