"""Join codes and links: a teacher shares ``K7Q2-M9XP`` (or a link carrying
it) and whoever redeems it joins the group.

A code has an optional use limit, expiry and membership length. Redeeming
is idempotent for someone already in the group (no use is spent) and the use
counter is bumped with a conditional UPDATE, so two people racing for the
last seat can't both get it. Redeeming needs an account in the group's org:
the code adds people to a group, it never lets them into an organization.
"""

from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Any, Optional

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import update
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.user_organizations import UserOrganization
from src.db.usergroup_extras import UserGroupJoinCode
from src.db.usergroups import UserGroup
from src.services.usergroups.common import (
    actor_id,
    aware,
    iso,
    load_group,
    parse_when,
    record,
    require_org_admin,
    require_person,
    utcnow,
)
from src.services.usergroups.membership import add_source, notify_members, refresh_ancestors

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L
MAX_ACTIVE_CODES = 50


def new_code() -> str:
    raw = "".join(secrets.choice(ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def normalize(code: str) -> str:
    text = "".join(ch for ch in (code or "").upper() if ch.isalnum())
    return f"{text[:4]}-{text[4:8]}" if len(text) == 8 else text


def code_dict(c: UserGroupJoinCode) -> dict:
    now = utcnow()
    expired = c.expires_at is not None and aware(c.expires_at) <= now  # type: ignore[operator]
    full = c.max_uses is not None and c.uses >= c.max_uses
    return {
        "id": c.id, "code": c.code, "label": c.label, "max_uses": c.max_uses, "uses": c.uses,
        "expires_at": iso(c.expires_at), "membership_days": c.membership_days, "active": c.active,
        "status": "revoked" if not c.active else "expired" if expired else "full" if full else "active",
        "created_at": iso(c.created_at),
    }


class CodeBody(BaseModel):
    label: str = Field("", max_length=120)
    max_uses: Optional[int] = Field(None, ge=1, le=100000)
    expires_at: Optional[str] = None
    membership_days: Optional[int] = Field(None, ge=1, le=3650)


class CodePatchBody(BaseModel):
    label: Optional[str] = Field(None, max_length=120)
    max_uses: Optional[int] = Field(None, ge=1, le=100000)
    expires_at: Optional[str] = None
    active: Optional[bool] = None


async def list_codes(request: Request, db: AsyncSession, user: Any, group_id: int) -> dict:
    group = await load_group(db, group_id)
    await require_org_admin(request, db, user, group.org_id, "read")
    rows = (await db.execute(select(UserGroupJoinCode).where(UserGroupJoinCode.usergroup_id == group.id)
                             .order_by(UserGroupJoinCode.id.desc()))).scalars().all()  # type: ignore[union-attr]
    return {"items": [code_dict(c) for c in rows]}


async def create_code(request: Request, db: AsyncSession, user: Any, group_id: int, body: CodeBody) -> dict:
    group = await load_group(db, group_id)
    await require_org_admin(request, db, user, group.org_id)
    if group.kind == "smart":
        raise HTTPException(status_code=409, detail="Members of this group come from its rules; join codes need a manual or mixed group")
    active = (await db.execute(select(UserGroupJoinCode.id).where(
        UserGroupJoinCode.usergroup_id == group.id, UserGroupJoinCode.active == True  # noqa: E712
    ))).all()
    if len(active) >= MAX_ACTIVE_CODES:
        raise HTTPException(status_code=409, detail=f"A group can have at most {MAX_ACTIVE_CODES} active codes")
    expires = parse_when(body.expires_at, "expires_at")
    if expires is not None and expires <= utcnow():
        raise HTTPException(status_code=422, detail="The code's expiry must be in the future")
    for _ in range(5):
        code = new_code()
        clash = (await db.execute(select(UserGroupJoinCode.id).where(UserGroupJoinCode.code == code))).first()
        if clash is None:
            break
    else:  # pragma: no cover - 31^8 codes
        raise HTTPException(status_code=500, detail="Could not generate a unique code")
    row = UserGroupJoinCode(usergroup_id=group.id, org_id=group.org_id, code=code, label=body.label.strip(),
                            max_uses=body.max_uses, expires_at=expires, membership_days=body.membership_days,
                            created_by_id=actor_id(user))
    db.add(row)
    record(db, request, group, "code_created", user, details={"label": row.label, "max_uses": row.max_uses})
    await db.commit()
    await db.refresh(row)
    return code_dict(row)


async def update_code(request: Request, db: AsyncSession, user: Any, group_id: int, code_id: int, body: CodePatchBody) -> dict:
    group = await load_group(db, group_id)
    await require_org_admin(request, db, user, group.org_id)
    row = await db.get(UserGroupJoinCode, code_id)
    if row is None or row.usergroup_id != group.id:
        raise HTTPException(status_code=404, detail="Code not found")
    if body.label is not None:
        row.label = body.label.strip()
    if body.max_uses is not None:
        row.max_uses = body.max_uses
    if body.expires_at is not None:
        row.expires_at = parse_when(body.expires_at, "expires_at")
    if body.active is not None:
        row.active = body.active
    db.add(row)
    record(db, request, group, "code_revoked" if body.active is False else "code_updated", user, details={"code_id": row.id})
    await db.commit()
    await db.refresh(row)
    return code_dict(row)


async def redeem(request: Request, db: AsyncSession, user: Any, code: str) -> dict:
    """Join the group behind a code. Errors are deliberately plain: an
    unknown, revoked or expired code all read "not valid"."""
    uid = require_person(user)
    row = (await db.execute(select(UserGroupJoinCode).where(UserGroupJoinCode.code == normalize(code)))).scalars().first()
    now = utcnow()
    invalid = HTTPException(status_code=404, detail="This code is not valid. Check it with whoever shared it.")
    if row is None or not row.active or (row.expires_at is not None and aware(row.expires_at) <= now):  # type: ignore[operator]
        raise invalid
    group = await db.get(UserGroup, row.usergroup_id)
    if group is None or group.org_id != row.org_id:
        raise invalid
    from src.security.features_utils.plan_check import check_org_plan

    await check_org_plan(group.org_id, "standard", "User Groups", db)
    member = (await db.execute(select(UserOrganization.id).where(
        UserOrganization.user_id == uid, UserOrganization.org_id == group.org_id
    ))).first()
    if member is None:
        raise HTTPException(status_code=403, detail="Join this organization first, then use the code")
    from src.db.usergroup_user import UserGroupUser

    already = (await db.execute(select(UserGroupUser.id).where(
        UserGroupUser.usergroup_id == group.id, UserGroupUser.user_id == uid
    ))).first()
    if already is not None:
        return {"status": "already_member", "usergroup_uuid": group.usergroup_uuid, "name": group.name}
    stmt = update(UserGroupJoinCode).where(UserGroupJoinCode.id == row.id)  # type: ignore[arg-type]
    if row.max_uses is not None:
        stmt = stmt.where(UserGroupJoinCode.uses < row.max_uses)  # type: ignore[arg-type]
    claimed = await db.execute(stmt.values(uses=UserGroupJoinCode.uses + 1))
    if not claimed.rowcount:
        raise HTTPException(status_code=409, detail="This code has been used as many times as it allows")
    expires = now + timedelta(days=row.membership_days) if row.membership_days else None
    await add_source(db, group, uid, "code", expires_at=expires)
    record(db, request, group, "member_joined_with_code", user, via="code",
           details={"user_ids": [uid], "count": 1, "code_id": row.id})
    await db.commit()
    await refresh_ancestors(db, group)
    await notify_members(db, group, [uid], "joined")
    return {"status": "joined", "usergroup_uuid": group.usergroup_uuid, "name": group.name, "expires_at": iso(expires)}
