import csv
import io
import json
import logging
import re
from datetime import datetime, timedelta
from typing import Optional

import redis
from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import aliased
from sqlmodel import select, func
from sqlmodel.ext.asyncio.session import AsyncSession

from config.config import get_learnhouse_config
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization, OrganizationRead, OrganizationUser
from src.db.roles import Role, RoleRead
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup, UserGroupRead
from src.db.users import AnonymousUser, APITokenUser, PublicUser, User, UserRead
from src.security.auth import resolve_acting_user_id
from src.security.features_utils.usage import (
    check_members_limit_with_pending,
    decrease_feature_usage,
    enforce_admin_seat_limit_for_role_change,
)
from src.services.security.account_age import enforce_free_tier_age_gate
from src.services.security.rate_limiting import (
    INVITE_MAX_BATCH_SIZE,
    enforce_batch_size_limit,
    enforce_invite_rate_limit,
)
from src.security.org_auth import is_org_member, enforce_org_mfa
from src.security.rbac.constants import ADMIN_ROLE_ID
from src.services.orgs.invites import send_invite_email
from src.services.orgs.orgs import get_org_default_language, rbac_check
from src.services.search.normalization import LIKE_ESCAPE_CHAR, build_like_pattern
from src.services.users.emails import send_role_changed_email
from src.services.webhooks.dispatch import dispatch_webhooks

logger = logging.getLogger(__name__)


def _csv_safe(value):
    """Neutralize CSV formula injection (S12).

    Spreadsheet apps interpret a cell whose first character is one of = + - @
    (or a leading tab / carriage return) as a formula. Prefix any such string
    with a single quote so it is rendered as literal text. Non-string values
    are returned unchanged.
    """
    if isinstance(value, str) and value and value[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


# Deliberately permissive email shape check: exactly one "@", a dotted domain,
# no whitespace/control chars, bounded length. The goal is to reject malformed
# input (and ":"/whitespace that would shape the Redis invite key), not to
# fully validate deliverability — the mail provider is the source of truth.
_EMAIL_RE = re.compile(r"^[^@\s:]{1,64}@[^@\s:]{1,255}\.[a-zA-Z]{2,}$")


def _looks_like_email(value: str) -> bool:
    if not value or len(value) > 254:
        return False
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        return False
    return bool(_EMAIL_RE.match(value))


async def get_organization_users(
    request: Request,
    org_id: int,
    db_session: AsyncSession,
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
    org = (await db_session.execute(statement)).scalars().first()

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
    if not await is_org_member(acting_user_id, org.id, db_session):
        raise HTTPException(
            status_code=403,
            detail="You must be a member of this organization to view its members",
        )

    # Org-wide two-factor policy, applied after the membership gate.
    await enforce_org_mfa(acting_user_id, org.id, db_session)
    # Only admins/maintainers can list organization members
    from src.security.superadmin import is_user_superadmin
    if not await is_user_superadmin(acting_user_id, db_session):
        from src.security.org_auth import is_org_admin
        if not await is_org_admin(acting_user_id, org.id, db_session):
            raise HTTPException(
                status_code=403,
                detail="Only administrators and maintainers can view organization members",
            )

        # Org-wide two-factor policy, applied after the membership gate.
        await enforce_org_mfa(acting_user_id, org.id, db_session)
    # Base query for users in the organization
    base_statement = (
        select(User)
        .join(UserOrganization)
        .join(Organization)
        .where(Organization.id == org_id)
    )

    # Apply search filter if provided
    if search:
        search_pattern = build_like_pattern(search)
        base_statement = base_statement.where(
            (User.first_name.ilike(search_pattern, escape=LIKE_ESCAPE_CHAR))
            | (User.last_name.ilike(search_pattern, escape=LIKE_ESCAPE_CHAR))
            | (User.username.ilike(search_pattern, escape=LIKE_ESCAPE_CHAR))
            | (User.email.ilike(search_pattern, escape=LIKE_ESCAPE_CHAR))
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
        all_total = (await db_session.execute(all_count_stmt)).scalar_one()

        # Count in-group users matching search using SQL COUNT
        in_group_count_stmt = (
            select(func.count(User.id))
            .join(UserOrganization)
            .join(Organization)
            .where(Organization.id == org_id)
            .join(UserGroupUser, (UserGroupUser.user_id == User.id) & (UserGroupUser.usergroup_id == usergroup_id))
        )
        if search:
            search_pattern = build_like_pattern(search)
            in_group_count_stmt = in_group_count_stmt.where(
                (User.first_name.ilike(search_pattern, escape=LIKE_ESCAPE_CHAR))
                | (User.last_name.ilike(search_pattern, escape=LIKE_ESCAPE_CHAR))
                | (User.username.ilike(search_pattern, escape=LIKE_ESCAPE_CHAR))
                | (User.email.ilike(search_pattern, escape=LIKE_ESCAPE_CHAR))
            )
        in_group_total = (await db_session.execute(in_group_count_stmt)).scalar_one()

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
    total = (await db_session.execute(select(func.count()).select_from(base_statement.subquery()))).scalar_one()

    # Sort by join date — use UserOrganization.id as it's auto-increment
    # and directly correlates with join order (creation_date is a str, unreliable for sorting)
    if sort_order == "asc":
        base_statement = base_statement.order_by(UserOrganization.id.asc())
    else:
        base_statement = base_statement.order_by(UserOrganization.id.desc())

    # Apply pagination
    offset = (page - 1) * limit
    paginated_statement = base_statement.offset(offset).limit(limit)
    users = (await db_session.execute(paginated_statement)).scalars().all()

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
        user_orgs = (await db_session.execute(user_orgs_statement)).scalars().all()
        user_org_map = {uo.user_id: uo for uo in user_orgs}

        # Batch fetch all roles needed
        role_ids = list({uo.role_id for uo in user_orgs if uo.role_id is not None})
        if role_ids:
            roles_statement = select(Role).where(Role.id.in_(role_ids))  # type: ignore
            roles = (await db_session.execute(roles_statement)).scalars().all()
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
        usergroup_results = (await db_session.execute(usergroups_statement)).all()
        user_usergroups_map: dict[int, list[UserGroupRead]] = {}
        for ugu, ug in usergroup_results:
            user_usergroups_map.setdefault(ugu.user_id, []).append(
                UserGroupRead.model_validate(ug)
            )

        # Active-user status (current UTC month) for the users on this page.
        # Display-only enrichment: never let it break the members listing.
        from src.security.features_utils.active_users import (
            get_visit_days_for_users,
            current_utc_year_month,
            ACTIVE_DAYS_THRESHOLD,
        )
        visit_days_map: dict[int, int] = {}
        try:
            _year, _month = current_utc_year_month()
            visit_days_map = await get_visit_days_for_users(
                org_id, [uid for uid in user_ids if uid is not None], _year, _month, db_session
            )
        except Exception:
            logging.debug("visit_days enrichment unavailable", exc_info=True)

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

            _days = visit_days_map.get(user.id, 0)

            org_user = OrganizationUser(
                user=user_read,
                role=role_read,
                usergroups=usergroups,
                joined_at=user_org.creation_date,
                visit_days=_days,
                is_active=_days >= ACTIVE_DAYS_THRESHOLD,
            )

            org_users_list.append(org_user)

    result = {
        "items": org_users_list,
        "total": total,
        "page": page,
        "limit": limit,
    }

    # Org-level active-user summary (all members, current UTC month) so the
    # Users page can show "active this month / included limit (+overage)".
    try:
        from src.security.features_utils.active_users import get_active_user_summary
        result["active_users_summary"] = await get_active_user_summary(org_id, db_session)
    except Exception:
        logging.debug("active_users_summary unavailable", exc_info=True)

    if in_group_total is not None:
        result["in_group_total"] = in_group_total
    if all_total is not None:
        result["all_total"] = all_total

    return result


async def export_organization_users_csv(
    request: Request,
    org_id: int,
    db_session: AsyncSession,
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
    org = (await db_session.execute(statement)).scalars().first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    export_acting_user_id = resolve_acting_user_id(current_user)
    if not await is_org_member(export_acting_user_id, org.id, db_session):
        raise HTTPException(status_code=403, detail="You must be a member of this organization")

    # Org-wide two-factor policy, applied after the membership gate.
    await enforce_org_mfa(export_acting_user_id, org.id, db_session)
    # Only admins/maintainers can export organization members
    from src.security.superadmin import is_user_superadmin
    if not await is_user_superadmin(export_acting_user_id, db_session):
        from src.security.org_auth import is_org_admin
        if not await is_org_admin(export_acting_user_id, org.id, db_session):
            raise HTTPException(
                status_code=403,
                detail="Only administrators and maintainers can export organization members",
            )

        # Org-wide two-factor policy, applied after the membership gate.
        await enforce_org_mfa(export_acting_user_id, org.id, db_session)
    base_statement = (
        select(User)
        .join(UserOrganization)
        .join(Organization)
        .where(Organization.id == org_id)
    )

    if search:
        search_pattern = build_like_pattern(search)
        base_statement = base_statement.where(
            (User.first_name.ilike(search_pattern, escape=LIKE_ESCAPE_CHAR))
            | (User.last_name.ilike(search_pattern, escape=LIKE_ESCAPE_CHAR))
            | (User.username.ilike(search_pattern, escape=LIKE_ESCAPE_CHAR))
            | (User.email.ilike(search_pattern, escape=LIKE_ESCAPE_CHAR))
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

    users = (await db_session.execute(base_statement)).scalars().all()

    # The org's custom signup fields become extra columns, so admins can export
    # what they collected. Read from the org config rather than from whatever
    # keys happen to exist on user rows, so retired fields drop out and the
    # column set is stable across the export.
    from src.services.orgs.signup_fields import get_signup_fields

    org_config_row = (await db_session.execute(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    )).scalars().first()
    custom_fields = get_signup_fields(org_config_row.config if org_config_row else None)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Name", "Username", "Email", "Groups", "Role", "Joined",
            "Email Verified", "Signup Method", "Last Login",
        ]
        + [f.label or f.key for f in custom_fields]
    )

    if users:
        user_ids = [user.id for user in users]

        user_orgs = (await db_session.execute(
            select(UserOrganization).where(
                UserOrganization.user_id.in_(user_ids),  # type: ignore
                UserOrganization.org_id == org_id,
            )
        )).scalars().all()
        user_org_map = {uo.user_id: uo for uo in user_orgs}

        role_ids = list({uo.role_id for uo in user_orgs if uo.role_id is not None})
        role_map = {}
        if role_ids:
            roles = (await db_session.execute(select(Role).where(Role.id.in_(role_ids)))).scalars().all()  # type: ignore
            role_map = {role.id: role for role in roles}

        usergroup_results = (await db_session.execute(
            select(UserGroupUser, UserGroup)
            .join(UserGroup, UserGroupUser.usergroup_id == UserGroup.id)  # type: ignore
            .where(
                UserGroupUser.user_id.in_(user_ids),  # type: ignore
                UserGroupUser.org_id == org_id,
            )
        )).all()
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

            # Custom field answers are member-supplied text, exactly the
            # untrusted input _csv_safe's formula-injection guard exists for.
            metadata = user.extra_metadata or {}
            custom_values = []
            for field in custom_fields:
                value = metadata.get(field.key)
                if value is None:
                    custom_values.append("")
                elif isinstance(value, bool):
                    custom_values.append("Yes" if value else "No")
                else:
                    custom_values.append(_csv_safe(str(value)))

            writer.writerow([
                _csv_safe(f"{user.first_name or ''} {user.last_name or ''}".strip()),
                _csv_safe(user.username or ""),
                _csv_safe(user.email or ""),
                _csv_safe(groups),
                _csv_safe(role.name if role else ""),
                fmt_date(user_org.creation_date),
                "Yes" if user.email_verified else "No",
                _csv_safe(user.signup_method or ""),
                fmt_date(user.last_login_at) if hasattr(user, "last_login_at") else "",
            ] + custom_values)

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
    db_session: AsyncSession,
    current_user: PublicUser | AnonymousUser,
):
    statement = select(Organization).where(Organization.id == org_id)
    org = (await db_session.execute(statement)).scalars().first()

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
    user_org = (await db_session.execute(statement)).scalars().first()

    if not user_org:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    # Check if user is the last admin
    statement = select(UserOrganization).where(
        UserOrganization.org_id == org.id, UserOrganization.role_id == ADMIN_ROLE_ID
    )
    admins = (await db_session.execute(statement)).scalars().all()

    if len(admins) == 1 and admins[0].user_id == user_id:
        raise HTTPException(
            status_code=400,
            detail="You can't remove the last admin of the organization",
        )

    await db_session.delete(user_org)
    await db_session.commit()

    from src.routers.users import _invalidate_session_cache
    _invalidate_session_cache(user_id)

    await decrease_feature_usage("members", org_id, db_session)

    await dispatch_webhooks(
        event_name="user_removed_from_org",
        org_id=org_id,
        data={"user_id": user_id, "org_id": org_id},
    )

    return {"detail": "User removed from org"}


async def leave_org(
    request: Request,
    org_id: int,
    db_session: AsyncSession,
    current_user: PublicUser,
):
    """Let the CURRENT user leave an org they belong to (self-service, no admin
    rights needed). They can only remove their OWN membership — the acting user
    id comes from the authenticated session, never a request field."""
    user_id = current_user.id

    org = (await db_session.execute(
        select(Organization).where(Organization.id == org_id)
    )).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    user_org = (await db_session.execute(
        select(UserOrganization).where(
            UserOrganization.user_id == user_id, UserOrganization.org_id == org.id
        )
    )).scalars().first()
    if not user_org:
        raise HTTPException(status_code=404, detail="You are not a member of this organization")

    # The last admin can't just walk away — they'd orphan the org.
    admins = (await db_session.execute(
        select(UserOrganization).where(
            UserOrganization.org_id == org.id, UserOrganization.role_id == ADMIN_ROLE_ID
        )
    )).scalars().all()
    if len(admins) == 1 and admins[0].user_id == user_id:
        raise HTTPException(
            status_code=400,
            detail="You are the last admin of this organization. Transfer ownership or delete the organization instead.",
        )

    await db_session.delete(user_org)
    await db_session.commit()

    from src.routers.users import _invalidate_session_cache
    _invalidate_session_cache(user_id)

    await decrease_feature_usage("members", org_id, db_session)

    await dispatch_webhooks(
        event_name="user_removed_from_org",
        org_id=org_id,
        data={"user_id": user_id, "org_id": org_id, "left": True},
    )

    return {"detail": "Left organization", "org_id": org_id}


async def remove_batch_users_from_org(
    request: Request,
    org_id: int,
    user_ids: list[int],
    db_session: AsyncSession,
    current_user: PublicUser | AnonymousUser,
):
    statement = select(Organization).where(Organization.id == org_id)
    org = (await db_session.execute(statement)).scalars().first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "delete", db_session)

    enforce_batch_size_limit(len(user_ids), "users")

    # Get all admins for last-admin protection
    admin_statement = select(UserOrganization).where(
        UserOrganization.org_id == org.id, UserOrganization.role_id == ADMIN_ROLE_ID
    )
    admins = (await db_session.execute(admin_statement)).scalars().all()
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
        user_orgs_to_remove = (await db_session.execute(remove_stmt)).scalars().all()
    else:
        user_orgs_to_remove = []

    removed_count = len(user_orgs_to_remove)
    for user_org in user_orgs_to_remove:
        await db_session.delete(user_org)

    await db_session.commit()

    from src.routers.users import _invalidate_session_cache
    for uid in user_ids:
        _invalidate_session_cache(uid)

    for _ in range(removed_count):
        await decrease_feature_usage("members", org_id, db_session)

    return {"detail": f"{removed_count} user(s) removed from org"}


async def remove_all_users_from_org(
    request: Request,
    org_id: int,
    db_session: AsyncSession,
    current_user: PublicUser | AnonymousUser,
):
    """
    Remove every member from the organization except the caller.

    The organization and all of its content are kept intact. The acting admin
    is preserved so the org is never left without an administrator. Use the
    delete-organization endpoint to remove the org entirely.
    """
    statement = select(Organization).where(Organization.id == org_id)
    org = (await db_session.execute(statement)).scalars().first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "delete", db_session)

    # Keep the caller so the org always retains at least one admin.
    keep_user_id = resolve_acting_user_id(current_user)

    remove_stmt = select(UserOrganization).where(
        UserOrganization.org_id == org.id,
        UserOrganization.user_id != keep_user_id,
    )
    user_orgs_to_remove = (await db_session.execute(remove_stmt)).scalars().all()

    removed_user_ids = [uo.user_id for uo in user_orgs_to_remove]
    for user_org in user_orgs_to_remove:
        await db_session.delete(user_org)

    await db_session.commit()

    from src.routers.users import _invalidate_session_cache
    for uid in removed_user_ids:
        _invalidate_session_cache(uid)

    for _ in removed_user_ids:
        await decrease_feature_usage("members", org_id, db_session)

    return {"detail": f"{len(removed_user_ids)} user(s) removed from org"}


async def update_user_role(
    request: Request,
    org_id: int,
    user_id: int,
    role_uuid: str,
    db_session: AsyncSession,
    current_user: PublicUser | AnonymousUser,
):
    # find role
    statement = select(Role).where(Role.role_uuid == role_uuid)
    role = (await db_session.execute(statement)).scalars().first()

    if not role:
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    role_id = role.id

    statement = select(Organization).where(Organization.id == org_id)
    org = (await db_session.execute(statement)).scalars().first()

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
    admins = (await db_session.execute(statement)).scalars().all()

    if not admins:
        raise HTTPException(
            status_code=400,
            detail="There is no admin in the organization",
        )

    if (
        len(admins) == 1
        and admins[0].user_id == user_id
        and str(role_uuid) != "role_global_admin"
    ):
        raise HTTPException(
            status_code=400,
            detail="Organization must have at least one admin",
        )

    statement = select(UserOrganization).where(
        UserOrganization.user_id == user_id, UserOrganization.org_id == org.id
    )
    user_org = (await db_session.execute(statement)).scalars().first()

    if not user_org:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    # Enforce the admin-seat limit: promoting a user into a dashboard-access
    # role must respect the org's plan seat cap. Demotions and admin->admin
    # swaps are never blocked (see the helper).
    await enforce_admin_seat_limit_for_role_change(org.id, user_id, role, db_session)

    if role_id is not None:
        user_org.role_id = role_id

    db_session.add(user_org)
    await db_session.commit()
    await db_session.refresh(user_org)

    from src.routers.users import _invalidate_session_cache
    _invalidate_session_cache(user_org.user_id)

    await dispatch_webhooks(
        event_name="user_role_changed",
        org_id=org_id,
        data={
            "user_id": user_id,
            "org_id": org_id,
            "new_role_uuid": role_uuid,
        },
    )

    # Send role change notification email
    role_change_user = None
    try:
        user_stmt = select(User).where(User.id == user_id)
        role_change_user = (await db_session.execute(user_stmt)).scalars().first()
        if role_change_user and role_change_user.email:
            org_config_stmt = select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
            org_config = (await db_session.execute(org_config_stmt)).scalars().first()
            # The org's own host (verified custom domain when it has one), so
            # the recipient can act on the permissions they were just given.
            from src.services.email.utils import get_org_signup_base_url

            org_base_url = await get_org_signup_base_url(
                org.slug, request, db_session=db_session, org_id=org.id
            )
            send_role_changed_email(
                email=role_change_user.email,
                username=role_change_user.username,
                org_name=org.name,
                new_role_name=role.name,
                lang=get_org_default_language(org_config),
                cta_url=org_base_url.rstrip("/") or "/",
            )
    except Exception:
        logger.warning("Failed to send role change email to user %s", user_id)

    # If the user was just promoted to ADMIN, add them to the Loops marketing
    # audience. Best-effort, SaaS-gated, never fails the role change. Note this
    # targets the PROMOTED user (not the acting admin), so the sync must happen
    # here in the API rather than from a client call that only knows the caller.
    if role_id == ADMIN_ROLE_ID:
        try:
            from src.services.marketing.loops import record_org_admin_in_loops
            if role_change_user and role_change_user.email:
                record_org_admin_in_loops(
                    email=role_change_user.email,
                    org_slug=org.slug,
                    first_name=getattr(role_change_user, "first_name", None),
                    last_name=getattr(role_change_user, "last_name", None),
                )
        except Exception:
            logger.warning("record_org_admin_in_loops failed for user %s", user_id)

    return {"detail": "User role updated"}


async def invite_batch_users(
    request: Request,
    org_id: int,
    emails: str,
    invite_code_uuid: Optional[str],
    db_session: AsyncSession,
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
    org = (await db_session.execute(statement)).scalars().first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # get User sender
    statement = select(User).where(User.id == current_user.id)
    user = (await db_session.execute(statement)).scalars().first()

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "create", db_session)

    acting_user_id = resolve_acting_user_id(current_user)

    # Free-tier abuse gate: the org AND the acting user must be at least
    # FREE_TIER_MIN_AGE_DAYS old before invites can be sent. This stops a
    # freshly-registered free org from being spun up purely to relay spam.
    await enforce_free_tier_age_gate(
        org.id, acting_user_id, db_session, action="invite members"
    )

    # Connect to Redis
    r = redis.Redis.from_url(redis_conn_string)

    if not r:
        raise HTTPException(
            status_code=500,
            detail="Could not connect to Redis",
        )

    # Normalize + dedupe requested emails up front, then cap the batch size so
    # a single request cannot fan out unbounded email. Malformed addresses are
    # rejected here (never sent), which also prevents ':'/whitespace-bearing
    # input from shaping the ``invited_user:{email}:org:{uuid}`` Redis key.
    seen_emails = set()
    invite_list = []
    invalid_results = []
    for raw_email in emails.split(","):
        candidate = raw_email.strip()
        if not candidate or candidate.lower() in seen_emails:
            continue
        seen_emails.add(candidate.lower())
        if not _looks_like_email(candidate):
            invalid_results.append({"email": candidate, "status": "invalid_email"})
            continue
        # Key invites on the lower-cased address. Every reader lower-cases before
        # looking the key up (the OAuth invite gate, signup's invite consumption),
        # so storing the admin's typed casing made an invite to "Jane.Doe@x.com"
        # permanently unmatchable: the invitee could never consume it, it stayed
        # "Pending" in the dashboard forever, and it kept occupying a member seat.
        invite_list.append(candidate.lower())

    if len(invite_list) > INVITE_MAX_BATCH_SIZE:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVITE_BATCH_TOO_LARGE",
                "message": (
                    f"You can invite at most {INVITE_MAX_BATCH_SIZE} people at "
                    f"a time."
                ),
                "max_batch_size": INVITE_MAX_BATCH_SIZE,
            },
        )

    # Which requested emails are genuinely new (not already pending)?
    new_emails = [
        e for e in invite_list
        if not r.get(f"invited_user:{e}:org:{org.org_uuid}")
    ]

    # Count pending invites toward the member limit (not just joined members),
    # so a free org can't queue invitations that would exceed its cap once
    # accepted. Existing pending + new invites are both counted.
    #
    # Only the ones still PENDING, though. Accepted invites keep their Redis key
    # (flipped to pending=False) for the full 60 day TTL, so counting every key
    # charged an accepted invitee twice — once as a real member and once as a
    # phantom pending invite — and an org that had filled its seats through
    # invitations was told it had hit the member limit while well under it.
    existing_pending = 0
    for key in r.scan_iter(match=f"invited_user:*:org:{org.org_uuid}", count=1000):
        try:
            record = json.loads(r.get(key))
            if record.get("pending", True):
                existing_pending += 1
        except Exception:
            # Unreadable record: count it, so a corrupt entry can't be used to
            # slip past the cap.
            existing_pending += 1
    await check_members_limit_with_pending(
        org.id, existing_pending + len(new_emails), db_session
    )

    # Per-org AND per-user daily invite rate limit, reserving capacity for the
    # new emails about to be sent.
    if new_emails:
        enforce_invite_rate_limit(org.id, acting_user_id, len(new_emails))

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

        isEmailSent = await send_invite_email(
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

    # Surface malformed addresses that were rejected before sending.
    results.extend(invalid_results)

    sent = sum(1 for r in results if r["status"] == "sent")
    failed = sum(1 for r in results if r["status"] == "email_failed")
    skipped = sum(1 for r in results if r["status"] == "already_invited")
    invalid = sum(1 for r in results if r["status"] == "invalid_email")

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
            "invalid_email": invalid,
        },
    }


async def get_list_of_invited_users(
    request: Request,
    org_id: int,
    db_session: AsyncSession,
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
    org = (await db_session.execute(statement)).scalars().first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # SECURITY: pending invites carry the invitee's email address and the
    # invite code — a ready-made phishing list. rbac_check short-circuits every
    # "read" to True, so it is no gate at all here: mirror the member-listing
    # path instead and require an admin/maintainer of *this* org.
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
        )

    acting_user_id = resolve_acting_user_id(current_user)

    if not await is_org_member(acting_user_id, org.id, db_session):
        raise HTTPException(
            status_code=403,
            detail="You must be a member of this organization to view its invites",
        )

    # Org-wide two-factor policy, applied after the membership gate.
    await enforce_org_mfa(acting_user_id, org.id, db_session)

    from src.security.superadmin import is_user_superadmin
    if not await is_user_superadmin(acting_user_id, db_session):
        from src.security.org_auth import is_org_admin
        if not await is_org_admin(acting_user_id, org.id, db_session):
            raise HTTPException(
                status_code=403,
                detail="Only administrators and maintainers can view organization invites",
            )

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
    db_session: AsyncSession,
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
    org = (await db_session.execute(statement)).scalars().first()

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

    # Invites are keyed on the lower-cased address (see invite_batch_users), so
    # normalise here too — otherwise an admin who typed the address with any
    # capitals could never withdraw the invitation they had just sent.
    email = email.strip().lower()

    invited_user = r.get(f"invited_user:{email}:org:{org.org_uuid}")

    if not invited_user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    r.delete(f"invited_user:{email}:org:{org.org_uuid}")

    return {"detail": "User removed"}
