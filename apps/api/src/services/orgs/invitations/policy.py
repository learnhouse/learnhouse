"""Rules shared by email invitations and invite codes.

Security model, in one place:

- Managing invitations needs the org write right (Admin or Maintainer, or an
  API token with ``organizations.action_create``), checked by ``rbac_check``.
- A role must be global or belong to the org. Only an Admin (or a superadmin)
  may grant Admin or Maintainer. Below Admin, nobody may grant a role that
  turns on a permission their own role lacks; an API token is held to its
  creator's role and to its own rights.
- User groups and courses must belong to the org (else 404, no hint).
- Invite codes only carry roles that can do no more than the built-in User
  role (no management, dashboard or content write rights): anyone holding the
  code could otherwise claim it.
- Plan capacity counts pending invitations: member caps where the plan has
  one, admin seats for roles that open the dashboard.
"""

import hashlib
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional, Sequence, Union

from fastapi import HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.courses import Course
from src.db.org_invitations import InvitationStatus, OrgInvitation
from src.db.organizations import Organization
from src.db.roles import Role
from src.db.usergroups import UserGroup
from src.db.users import (
    AnonymousUser,
    APITokenUser,
    InternalUser,
    PublicUser,
    SuperadminAPITokenUser,
)
from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS, ADMIN_ROLE_ID

Caller = Union[PublicUser, AnonymousUser, APITokenUser, InternalUser, SuperadminAPITokenUser]

USER_ROLE_ID = 4
DEFAULT_EXPIRY_DAYS = 14
MAX_EXPIRY_DAYS = 90
MAX_MESSAGE_LENGTH = 1000
MAX_TARGETS = 25
TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{32,128}")
# One "@", a dotted domain, no whitespace, ":" or control characters.
_EMAIL_RE = re.compile(r"^[^@\s:,;<>\"]{1,64}@[^@\s:,;<>\"]{1,255}\.[a-zA-Z]{2,}$")
_SPLIT_RE = re.compile(r"[\s,;]+")
_MANAGEMENT_BUCKETS = ("users", "usergroups", "roles", "organizations")
_WRITE_ACTIONS = ("action_create", "action_update", "action_delete")

INVALID_INVITATION = {
    "code": "INVITE_LINK_INVALID",
    "message": "This invitation is no longer valid. Ask for a new invitation.",
}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware(value: Optional[datetime]) -> Optional[datetime]:
    """SQLite hands datetimes back naive; every stored value is UTC."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def iso(value: Optional[datetime]) -> Optional[str]:
    value = aware(value)
    return value.isoformat() if value else None


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def mint_token() -> tuple[str, str]:
    """A personal link token (43 URL-safe characters) and its SHA-256."""
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)


def new_invitation_uuid() -> str:
    return f"invitation_{uuid.uuid4()}"


def normalize_email(value: str) -> str:
    return (value or "").strip().lower()


def looks_like_email(value: str) -> bool:
    if not value or len(value) > 254:
        return False
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        return False
    return bool(_EMAIL_RE.match(value))


def parse_emails(raw: Union[str, Sequence[str], None]) -> tuple[list[str], list[str]]:
    """Split pasted text on commas, semicolons, spaces and new lines.

    Returns (valid, invalid): valid addresses lower-cased and deduplicated in
    the order given, invalid entries as typed (deduplicated too)."""
    parts: list[str] = []
    for chunk in ([raw] if isinstance(raw, str) else list(raw or [])):
        parts.extend(p for p in _SPLIT_RE.split(str(chunk or "")) if p)
    valid: list[str] = []
    invalid: list[str] = []
    for part in parts:
        email = normalize_email(part)
        if looks_like_email(email):
            if email not in valid:
                valid.append(email)
        elif part not in invalid:
            invalid.append(part[:254])
    return valid, invalid


def clean_message(value: Optional[str]) -> Optional[str]:
    """The personal note goes out in an email from our domain, so it is plain
    text, bounded, and may not carry links (a phishing vector)."""
    from src.services.security.profile_validation import contains_url

    text = "".join(c for c in (value or "") if c in "\n\t" or ord(c) >= 32).strip()
    if not text:
        return None
    if len(text) > MAX_MESSAGE_LENGTH:
        raise HTTPException(
            status_code=400,
            detail={"code": "INVITE_MESSAGE_TOO_LONG", "message": f"The personal message can be at most {MAX_MESSAGE_LENGTH} characters."},
        )
    if contains_url(text):
        raise HTTPException(
            status_code=400,
            detail={"code": "INVITE_MESSAGE_HAS_LINK", "message": "The personal message can't contain links."},
        )
    return text


def expiry_from_days(days: Optional[int]) -> datetime:
    days = DEFAULT_EXPIRY_DAYS if days is None else int(days)
    if days < 1 or days > MAX_EXPIRY_DAYS:
        raise HTTPException(
            status_code=400,
            detail={"code": "INVITE_EXPIRY_INVALID", "message": f"Choose an expiry between 1 and {MAX_EXPIRY_DAYS} days."},
        )
    return utcnow() + timedelta(days=days)


def is_expired(inv: OrgInvitation, now: Optional[datetime] = None) -> bool:
    return aware(inv.expires_at) <= (now or utcnow())


def effective_status(inv: OrgInvitation, now: Optional[datetime] = None) -> str:
    if inv.status == InvitationStatus.PENDING.value and is_expired(inv, now):
        return InvitationStatus.EXPIRED.value
    return inv.status


def rights_dict(rights) -> dict:
    if rights is None:
        return {}
    if isinstance(rights, dict):
        return rights
    return rights.model_dump()


def rights_within(granted, held) -> bool:
    """Whether every permission ``granted`` turns on is also on in ``held``."""
    held_rights = rights_dict(held)
    for bucket, perms in rights_dict(granted).items():
        if not isinstance(perms, dict):
            continue
        held_perms = held_rights.get(bucket)
        held_perms = held_perms if isinstance(held_perms, dict) else {}
        for perm, value in perms.items():
            if value is True and held_perms.get(perm) is not True:
                return False
    return True


def occupies_seat(role: Optional[Role]) -> bool:
    """An admin seat is a role that opens the dashboard (as in plan usage)."""
    if role is None:
        return False
    dashboard = rights_dict(role.rights).get("dashboard")
    return bool(isinstance(dashboard, dict) and dashboard.get("action_access"))


def has_management_rights(role: Optional[Role]) -> bool:
    """Admin, Maintainer, dashboard access, or write access to people, groups,
    roles or the organization itself."""
    if role is None:
        return False
    if role.id in ADMIN_OR_MAINTAINER_ROLE_IDS or occupies_seat(role):
        return True
    rights = rights_dict(role.rights)
    for bucket in _MANAGEMENT_BUCKETS:
        perms = rights.get(bucket)
        if isinstance(perms, dict) and any(perms.get(a) is True for a in _WRITE_ACTIONS):
            return True
    return False


def code_role_allowed(role: Optional[Role], user_role: Optional[Role]) -> bool:
    """A role an invite code may carry: no management rights, and nothing the
    built-in User role can't do (so no course or content write access either).
    Fails closed without the User role to compare with."""
    if role is None or user_role is None or has_management_rights(role):
        return False
    return role.id == user_role.id or rights_within(role.rights, user_role.rights)


async def builtin_user_role(db_session: AsyncSession) -> Optional[Role]:
    return await db_session.get(Role, USER_ROLE_ID)


def dedupe_ints(values: Iterable) -> list[int]:
    out: list[int] = []
    for value in values or []:
        try:
            number = int(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="User group ids must be numbers")
        if number not in out:
            out.append(number)
    return out


def dedupe_strs(values: Iterable) -> list[str]:
    out: list[str] = []
    for value in values or []:
        text = str(value or "").strip()
        if text and text not in out:
            out.append(text)
    return out


# ---------------------------------------------------------------------------
# Loading and permission checks
# ---------------------------------------------------------------------------


async def load_org(db_session: AsyncSession, org_id: int) -> Organization:
    org = await db_session.get(Organization, org_id)
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


async def require_invite_manager(request: Request, db_session: AsyncSession, org: Organization, current_user: Caller) -> int:
    """The org write right (Admin/Maintainer, or an API token allowed to write
    the org). Returns the acting user's id (a token's creator)."""
    from src.security.auth import resolve_acting_user_id
    from src.services.orgs.orgs import rbac_check

    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")
    await rbac_check(request, org.org_uuid, current_user, "create", db_session)
    return resolve_acting_user_id(current_user)


async def resolve_role(
    db_session: AsyncSession,
    org: Organization,
    role_id: Optional[int] = None,
    role_uuid: Optional[str] = None,
) -> Role:
    """The role to grant: global or this org's own, else 404. Defaults to User."""
    if role_id is None and not role_uuid:
        role_id = USER_ROLE_ID
    statement = select(Role).where(Role.id == role_id) if role_id is not None else select(Role).where(Role.role_uuid == role_uuid)
    role = (await db_session.execute(statement)).scalars().first()
    if role is None or (role.org_id is not None and role.org_id != org.id):
        raise HTTPException(status_code=404, detail="Role not found")
    return role


async def role_for_grant(db_session: AsyncSession, org_id: int, role_id: Optional[int]) -> Optional[Role]:
    """The stored role when it still exists and is still valid for the org."""
    role = await db_session.get(Role, role_id) if role_id else None
    if role is None or (role.org_id is not None and role.org_id != org_id):
        role = await db_session.get(Role, USER_ROLE_ID)
    return role


async def caller_grant_ceiling(db_session: AsyncSession, org: Organization, current_user: Caller) -> tuple[bool, Optional[Role]]:
    """(unrestricted, caller's role). Unrestricted: internal calls, superadmins
    and org Admins (an API token is held to its creator)."""
    from src.security.auth import resolve_acting_user_id
    from src.security.org_auth import get_user_org
    from src.security.superadmin import is_user_superadmin

    if isinstance(current_user, (InternalUser, SuperadminAPITokenUser)):
        return True, None
    acting = resolve_acting_user_id(current_user)
    if not isinstance(current_user, APITokenUser) and await is_user_superadmin(acting, db_session):
        return True, None
    membership = await get_user_org(acting, org.id, db_session)
    role = await db_session.get(Role, membership.role_id) if membership is not None else None
    return bool(membership is not None and membership.role_id == ADMIN_ROLE_ID), role


def grant_refusal(role: Role, unrestricted: bool, caller_role: Optional[Role], current_user: Caller) -> Optional[str]:
    """Why ``current_user`` may not grant ``role``, or None when they may."""
    if role.id in ADMIN_OR_MAINTAINER_ROLE_IDS and not unrestricted:
        return "ADMIN_ONLY"
    if not unrestricted and (caller_role is None or not rights_within(role.rights, caller_role.rights)):
        return "ABOVE_YOUR_ROLE"
    if isinstance(current_user, APITokenUser) and not rights_within(role.rights, current_user.rights):
        return "ABOVE_TOKEN"
    return None


_REFUSALS = {
    "ADMIN_ONLY": "Only organization administrators can invite people as Admin or Maintainer",
    "ABOVE_YOUR_ROLE": "You cannot invite people with a role that has permissions you don't have",
    "ABOVE_TOKEN": "This API token cannot grant a role with permissions it doesn't have",
}


async def assert_can_grant_role(db_session: AsyncSession, org: Organization, current_user: Caller, role: Role) -> None:
    unrestricted, caller_role = await caller_grant_ceiling(db_session, org, current_user)
    reason = grant_refusal(role, unrestricted, caller_role, current_user)
    if reason:
        raise HTTPException(status_code=403, detail={"code": f"ROLE_{reason}", "message": _REFUSALS[reason]})


async def validate_targets(
    db_session: AsyncSession,
    org: Organization,
    usergroup_ids: Iterable,
    course_uuids: Iterable,
) -> tuple[list[UserGroup], list[Course]]:
    """Groups and courses to grant, all of them this org's (else 404)."""
    group_ids = dedupe_ints(usergroup_ids)
    uuids = dedupe_strs(course_uuids)
    if len(group_ids) > MAX_TARGETS or len(uuids) > MAX_TARGETS:
        raise HTTPException(status_code=400, detail=f"Pick at most {MAX_TARGETS} user groups and {MAX_TARGETS} courses")
    groups: list[UserGroup] = []
    if group_ids:
        groups = list((await db_session.execute(
            select(UserGroup).where(UserGroup.id.in_(group_ids), UserGroup.org_id == org.id)  # type: ignore[attr-defined]
        )).scalars().all())
        if len(groups) != len(group_ids):
            raise HTTPException(status_code=404, detail="User group not found")
        groups.sort(key=lambda g: group_ids.index(g.id))
    courses: list[Course] = []
    if uuids:
        courses = list((await db_session.execute(
            select(Course).where(Course.course_uuid.in_(uuids), Course.org_id == org.id)  # type: ignore[attr-defined]
        )).scalars().all())
        if len(courses) != len(uuids):
            raise HTTPException(status_code=404, detail="Course not found")
        courses.sort(key=lambda c: uuids.index(c.course_uuid))
    return groups, courses


# ---------------------------------------------------------------------------
# Plan capacity
# ---------------------------------------------------------------------------


async def pending_invitations(db_session: AsyncSession, org_id: int) -> list[OrgInvitation]:
    return list((await db_session.execute(
        select(OrgInvitation).where(
            OrgInvitation.org_id == org_id,
            OrgInvitation.status == InvitationStatus.PENDING.value,
            OrgInvitation.expires_at > utcnow(),
        )
    )).scalars().all())


async def capacity(db_session: AsyncSession, org_id: int) -> dict:
    """Members and admin seats: used, pending, and the plan limit (None when
    the plan has none or the deployment isn't SaaS)."""
    from src.security.features_utils.plans import get_plan_limit
    from src.security.features_utils.resolve import resolve_feature
    from src.security.features_utils.usage import (
        _get_actual_admin_seat_count,
        _get_actual_member_count,
        _get_org_config,
        _get_org_plan,
        _is_non_saas,
    )

    pending = await pending_invitations(db_session, org_id)
    role_ids = {inv.role_id for inv in pending if inv.role_id}
    roles = {}
    if role_ids:
        roles = {r.id: r for r in (await db_session.execute(select(Role).where(Role.id.in_(role_ids)))).scalars().all()}  # type: ignore[attr-defined]
    pending_seats = sum(1 for inv in pending if occupies_seat(roles.get(inv.role_id)))

    plan = None
    member_limit = seat_limit = None
    if not _is_non_saas():
        config = await _get_org_config(org_id, db_session)
        if config is not None:
            plan = _get_org_plan(config)
            resolved = resolve_feature("members", config.config or {}, org_id)
            # Members switched off: no one may be added (limit 0 refuses all).
            member_limit = (resolved["limit"] or None) if resolved["enabled"] else 0
            seat_limit = get_plan_limit(plan, "admin_seats") or None
    return {
        "plan": plan,
        "members": {
            "limit": member_limit,
            "used": await _get_actual_member_count(org_id, db_session),
            "pending": len(pending),
        },
        "admin_seats": {
            "limit": seat_limit,
            "used": await _get_actual_admin_seat_count(org_id, db_session),
            "pending": pending_seats,
        },
    }


def capacity_refusal(cap: dict, new_members: int, new_seats: int) -> Optional[dict]:
    """The 403 detail when adding these would pass a plan limit, else None."""
    from src.security.features_utils.usage import _limit_detail

    for key, feature, code, extra in (
        ("members", "members", "MEMBER_LIMIT_REACHED", new_members),
        ("admin_seats", "admin_seats", "ADMIN_SEAT_LIMIT_REACHED", new_seats),
    ):
        bucket = cap[key]
        limit = bucket["limit"]
        if limit is None or extra <= 0:
            continue
        if bucket["used"] + bucket["pending"] + extra > limit:
            return {
                "code": code,
                "message": _limit_detail(feature, limit),
                "limit": limit,
                "used": bucket["used"],
                "pending": bucket["pending"],
                "requested": extra,
            }
    return None


async def check_capacity(db_session: AsyncSession, org_id: int, new_members: int, new_seats: int) -> dict:
    cap = await capacity(db_session, org_id)
    refusal = capacity_refusal(cap, new_members, new_seats)
    if refusal:
        raise HTTPException(status_code=403, detail=refusal)
    return cap
