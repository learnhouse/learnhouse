"""Shareable invite codes: one link or code for many people.

A code may carry a default role, user groups and courses, a use cap and an
expiry, and counts how often it was used. Joining through it applies its
settings like an invitation does (see ``apply.apply_invite_code``).

A code reaches anyone it is forwarded to, so its role is limited to roles
without management rights or dashboard access (no Admin, Maintainer,
Instructor, or a custom role that can manage people, groups, roles or the
organization). The role is checked again at each use, in case it was edited.

Codes made before this lived in Redis; they still work and are listed (with
``legacy``) until they expire or are deleted.
"""

import json
import logging
import re
import secrets
import string
import uuid
from datetime import timedelta
from typing import Optional

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.ee_hooks import audit_event
from src.db.courses.courses import Course
from src.db.org_invitations import OrgInviteCode
from src.db.organizations import Organization
from src.db.roles import Role
from src.db.usergroups import UserGroup
from src.db.users import User
from src.services.orgs.invitations import policy
from src.services.orgs.invitations.policy import Caller, aware, iso, utcnow

logger = logging.getLogger(__name__)

MAX_ACTIVE_CODES = 6
MAX_CODE_EXPIRY_DAYS = 365
MAX_USES = 100_000
CODE_LENGTH = 8
CODE_UUID_RE = re.compile(r"org_invite_code_[0-9a-fA-F-]{36}")


class InviteCodeCreate(BaseModel):
    role_id: Optional[int] = None
    role_uuid: Optional[str] = Field(default=None, max_length=100)
    usergroup_ids: list[int] = Field(default_factory=list, max_length=policy.MAX_TARGETS)
    course_uuids: list[str] = Field(default_factory=list, max_length=policy.MAX_TARGETS)
    max_uses: Optional[int] = Field(default=None, ge=1, le=MAX_USES)
    expires_in_days: Optional[int] = Field(default=None, ge=1, le=MAX_CODE_EXPIRY_DAYS)


class InviteCodeUpdate(BaseModel):
    """Only the fields sent are changed; ``max_uses``/``expires_in_days`` sent
    as null remove the cap or the expiry."""

    role_id: Optional[int] = None
    role_uuid: Optional[str] = Field(default=None, max_length=100)
    usergroup_ids: Optional[list[int]] = Field(default=None, max_length=policy.MAX_TARGETS)
    course_uuids: Optional[list[str]] = Field(default=None, max_length=policy.MAX_TARGETS)
    max_uses: Optional[int] = Field(default=None, ge=1, le=MAX_USES)
    expires_in_days: Optional[int] = Field(default=None, ge=1, le=MAX_CODE_EXPIRY_DAYS)


def code_status(code: OrgInviteCode) -> str:
    if code.revoked_at is not None:
        return "revoked"
    if code.expires_at is not None and aware(code.expires_at) <= utcnow():
        return "expired"
    if code.max_uses is not None and code.uses >= code.max_uses:
        return "used_up"
    return "active"


async def find_active_code(db_session: AsyncSession, org_id: int, code: str) -> Optional[OrgInviteCode]:
    row = (await db_session.execute(
        select(OrgInviteCode).where(OrgInviteCode.org_id == org_id, OrgInviteCode.code == code)
    )).scalars().first()
    return row if row is not None and code_status(row) == "active" else None


def as_join_data(code: OrgInviteCode) -> dict:
    """The dict the join paths read (same keys as a Redis code, plus ``source``)."""
    groups = list(code.usergroup_ids or [])
    return {
        "source": "db",
        "id": code.id,
        "invite_code": code.code,
        "invite_code_uuid": code.code_uuid,
        "invite_code_type": "signup",
        "usergroup_id": groups[0] if groups else None,
    }


async def _names(db_session: AsyncSession, codes: list[OrgInviteCode]) -> dict:
    role_ids = {c.role_id for c in codes if c.role_id}
    group_ids = {int(g) for c in codes for g in (c.usergroup_ids or [])}
    course_uuids = {str(u) for c in codes for u in (c.course_uuids or [])}
    user_ids = {c.created_by_user_id for c in codes if c.created_by_user_id}
    roles = groups = courses = users = {}
    if role_ids:
        roles = {r.id: r for r in (await db_session.execute(select(Role).where(Role.id.in_(role_ids)))).scalars().all()}  # type: ignore[attr-defined]
    if group_ids:
        groups = {g.id: g for g in (await db_session.execute(select(UserGroup).where(UserGroup.id.in_(group_ids)))).scalars().all()}  # type: ignore[attr-defined]
    if course_uuids:
        courses = {c.course_uuid: c for c in (await db_session.execute(select(Course).where(Course.course_uuid.in_(course_uuids)))).scalars().all()}  # type: ignore[attr-defined]
    if user_ids:
        users = {u.id: u for u in (await db_session.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()}  # type: ignore[attr-defined]
    return {"roles": roles, "groups": groups, "courses": courses, "users": users}


def serialize(code: OrgInviteCode, names: dict) -> dict:
    role = names["roles"].get(code.role_id) if code.role_id else None
    groups = [g for g in (names["groups"].get(int(i)) for i in (code.usergroup_ids or [])) if g is not None and g.org_id == code.org_id]
    courses = [c for c in (names["courses"].get(str(u)) for u in (code.course_uuids or [])) if c is not None and c.org_id == code.org_id]
    creator = names["users"].get(code.created_by_user_id)
    return {
        "invite_code": code.code,
        "invite_code_uuid": code.code_uuid,
        "invite_code_type": "signup",
        "created_at": iso(code.created_at),
        "created_by": creator.user_uuid if creator else None,
        "usergroup_id": groups[0].id if groups else None,
        "usergroup_name": groups[0].name if groups else None,
        "role": {"id": role.id, "role_uuid": role.role_uuid, "name": role.name} if role else None,
        "usergroups": [{"id": g.id, "usergroup_uuid": g.usergroup_uuid, "name": g.name} for g in groups],
        "courses": [{"course_uuid": c.course_uuid, "name": c.name} for c in courses],
        "max_uses": code.max_uses,
        "uses": code.uses,
        "expires_at": iso(code.expires_at),
        "status": code_status(code),
        "legacy": False,
    }


def _legacy_codes(org: Organization) -> list[dict]:
    from src.core.redis import get_redis_client

    r = get_redis_client()
    if r is None:
        return []
    out = []
    try:
        for key in r.scan_iter(match=f"org_invite_code_*:org:{org.org_uuid}:code:*", count=100):
            raw = r.get(key)
            if raw:
                out.append({**json.loads(raw), "legacy": True, "status": "active", "uses": None, "max_uses": None})
    except Exception:
        logger.warning("Could not read legacy invite codes for org %s", org.id, exc_info=True)
        return []
    return out


async def _active_count(db_session: AsyncSession, org: Organization) -> int:
    rows = (await db_session.execute(
        select(OrgInviteCode).where(OrgInviteCode.org_id == org.id, OrgInviteCode.revoked_at.is_(None))  # type: ignore[union-attr]
    )).scalars().all()
    return sum(1 for c in rows if code_status(c) == "active") + len(_legacy_codes(org))


async def _check_code_role(db_session: AsyncSession, org: Organization, current_user: Caller, role: Role) -> None:
    if not policy.code_role_allowed(role):
        raise HTTPException(
            status_code=400,
            detail={
                "code": "CODE_ROLE_NOT_ALLOWED",
                "message": "Invite codes can't grant a role with management rights or dashboard access. Send personal invitations instead.",
            },
        )
    await policy.assert_can_grant_role(db_session, org, current_user, role)


async def _new_code(db_session: AsyncSession, org_id: int) -> str:
    alphabet = string.ascii_letters + string.digits
    for _ in range(10):
        code = "".join(secrets.choice(alphabet) for _ in range(CODE_LENGTH))
        taken = (await db_session.execute(
            select(OrgInviteCode.id).where(OrgInviteCode.org_id == org_id, OrgInviteCode.code == code)
        )).first()
        if taken is None:
            return code
    raise HTTPException(status_code=500, detail="Could not generate an invite code, please try again")


async def _serialize_one(db_session: AsyncSession, code: OrgInviteCode) -> dict:
    return serialize(code, await _names(db_session, [code]))


async def create_code(request: Request, db_session: AsyncSession, org_id: int, body: InviteCodeCreate, current_user: Caller) -> dict:
    from src.services.analytics import events as analytics_events
    from src.services.analytics.analytics import track
    from src.services.demo.guards import require_not_demo_org
    from src.services.security.account_age import enforce_free_tier_age_gate

    # Every visitor to the shared demo holds admin on it: a code minted there
    # would let anyone have the platform onboard strangers under our domain.
    await require_not_demo_org(org_id, db_session)
    org = await policy.load_org(db_session, org_id)
    acting = await policy.require_invite_manager(request, db_session, org, current_user)
    # Shareable links are a self-service onboarding primitive: a free org
    # and its acting user must be old enough first. Paid orgs are exempt.
    await enforce_free_tier_age_gate(org.id, acting, db_session, action="create invite links")

    role = await policy.resolve_role(db_session, org, body.role_id, body.role_uuid)
    await _check_code_role(db_session, org, current_user, role)
    groups, courses = await policy.validate_targets(db_session, org, body.usergroup_ids, body.course_uuids)
    if await _active_count(db_session, org) >= MAX_ACTIVE_CODES:
        raise HTTPException(status_code=400, detail="Maximum number of invite codes reached")

    now = utcnow()
    code = OrgInviteCode(
        code_uuid=f"org_invite_code_{uuid.uuid4()}",
        org_id=org.id,
        code=await _new_code(db_session, org.id),
        role_id=role.id,
        usergroup_ids=[g.id for g in groups],
        course_uuids=[c.course_uuid for c in courses],
        max_uses=body.max_uses,
        uses=0,
        expires_at=now + timedelta(days=body.expires_in_days) if body.expires_in_days else None,
        created_by_user_id=acting or None,
        created_at=now,
        updated_at=now,
    )
    db_session.add(code)
    await db_session.commit()
    await db_session.refresh(code)

    # A shareable link invites nobody in particular yet, so no count.
    await track(
        event_name=analytics_events.USER_INVITED,
        org_id=org.id,
        user_id=acting,
        properties={"invite_method": "invite_code"},
    )
    audit_event(
        request, action="members.invite_code.created", org_id=org.id, actor=current_user,
        target_type="invite_code", target_id=code.code_uuid,
        details={
            "role": role.name,
            "usergroup_ids": code.usergroup_ids,
            "course_uuids": code.course_uuids,
            "max_uses": code.max_uses,
            "expires_at": iso(code.expires_at),
        },
    )
    return await _serialize_one(db_session, code)


async def _load_code(db_session: AsyncSession, org: Organization, code_uuid: str) -> OrgInviteCode:
    if not CODE_UUID_RE.fullmatch(code_uuid or ""):
        raise HTTPException(status_code=404, detail="Invite code not found")
    code = (await db_session.execute(
        select(OrgInviteCode).where(OrgInviteCode.code_uuid == code_uuid, OrgInviteCode.org_id == org.id)
    )).scalars().first()
    if code is None or code.revoked_at is not None:
        raise HTTPException(status_code=404, detail="Invite code not found")
    return code


async def update_code(
    request: Request, db_session: AsyncSession, org_id: int, code_uuid: str, body: InviteCodeUpdate, current_user: Caller
) -> dict:
    org = await policy.load_org(db_session, org_id)
    await policy.require_invite_manager(request, db_session, org, current_user)
    code = await _load_code(db_session, org, code_uuid)
    sent = body.model_fields_set
    changes: dict = {}
    if body.role_id is not None or body.role_uuid:
        role = await policy.resolve_role(db_session, org, body.role_id, body.role_uuid)
        await _check_code_role(db_session, org, current_user, role)
        if role.id != code.role_id:
            changes["role_id"] = {"from": code.role_id, "to": role.id}
            code.role_id = role.id
    if body.usergroup_ids is not None or body.course_uuids is not None:
        groups, courses = await policy.validate_targets(
            db_session, org,
            code.usergroup_ids if body.usergroup_ids is None else body.usergroup_ids,
            code.course_uuids if body.course_uuids is None else body.course_uuids,
        )
        changes["usergroup_ids"] = {"from": list(code.usergroup_ids or []), "to": [g.id for g in groups]}
        changes["course_uuids"] = {"from": list(code.course_uuids or []), "to": [c.course_uuid for c in courses]}
        code.usergroup_ids = [g.id for g in groups]
        code.course_uuids = [c.course_uuid for c in courses]
    if "max_uses" in sent:
        changes["max_uses"] = {"from": code.max_uses, "to": body.max_uses}
        code.max_uses = body.max_uses
    if "expires_in_days" in sent:
        code.expires_at = utcnow() + timedelta(days=body.expires_in_days) if body.expires_in_days else None
        changes["expires_at"] = {"to": iso(code.expires_at)}
    code.updated_at = utcnow()
    db_session.add(code)
    await db_session.commit()
    audit_event(
        request, action="members.invite_code.updated", org_id=org.id, actor=current_user,
        target_type="invite_code", target_id=code.code_uuid, changes=changes,
    )
    return await _serialize_one(db_session, code)


async def revoke_code(request: Request, db_session: AsyncSession, org_id: int, code_uuid: str, current_user: Caller) -> Optional[dict]:
    """Retire a code. Returns None when the uuid isn't a database code (the
    caller then tries the legacy Redis codes)."""
    org = await policy.load_org(db_session, org_id)
    await policy.require_invite_manager(request, db_session, org, current_user)
    if not CODE_UUID_RE.fullmatch(code_uuid or ""):
        raise HTTPException(status_code=404, detail="Invite code not found")
    code = (await db_session.execute(
        select(OrgInviteCode).where(OrgInviteCode.code_uuid == code_uuid, OrgInviteCode.org_id == org.id)
    )).scalars().first()
    if code is None:
        return None
    if code.revoked_at is None:
        code.revoked_at = utcnow()
        code.updated_at = code.revoked_at
        db_session.add(code)
        await db_session.commit()
        audit_event(
            request, action="members.invite_code.deleted", org_id=org.id, actor=current_user,
            target_type="invite_code", target_id=code.code_uuid, details={"uses": code.uses},
        )
    return {"invite_code_uuid": code.code_uuid, "revoked": True}


async def list_codes(request: Request, db_session: AsyncSession, org_id: int, current_user: Caller) -> list[dict]:
    """Live codes first (with usage), then expired or used-up ones, then
    legacy Redis codes."""
    org = await policy.load_org(db_session, org_id)
    await policy.require_invite_manager(request, db_session, org, current_user)
    rows = list((await db_session.execute(
        select(OrgInviteCode)
        .where(OrgInviteCode.org_id == org.id, OrgInviteCode.revoked_at.is_(None))  # type: ignore[union-attr]
        .order_by(OrgInviteCode.created_at.desc(), OrgInviteCode.id.desc())  # type: ignore[union-attr]
    )).scalars().all())
    names = await _names(db_session, rows)
    items = [serialize(c, names) for c in rows]
    items.sort(key=lambda c: c["status"] != "active")
    legacy = _legacy_codes(org)
    for item in legacy:
        group_id = item.get("usergroup_id")
        if group_id:
            group = await db_session.get(UserGroup, group_id)
            item["usergroup_name"] = group.name if group is not None and group.org_id == org.id else None
    return items + legacy

