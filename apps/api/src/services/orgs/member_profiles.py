"""Member profile data (manager, department, title...) on the members list.

The profiles themselves are written by the Enterprise Edition (people data,
SCIM, CSV import); core only reads them here so the Users page can show and
filter by them. Without EE the table is empty and every filter is a no-op.
"""

from typing import Iterable, Optional

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from src.db.org_member_profile import OrgMemberProfile
from src.db.users import User

# Longest reporting chain walked: a guard against bad data, not a product limit.
MAX_DEPTH = 50


async def report_user_ids(db_session: AsyncSession, org_id: int, manager_id: int) -> set[int]:
    """Direct and indirect reports of ``manager_id`` in the org (cycle-safe)."""
    rows = (await db_session.execute(
        select(OrgMemberProfile.user_id, OrgMemberProfile.manager_user_id).where(
            OrgMemberProfile.org_id == org_id,
            OrgMemberProfile.manager_user_id.is_not(None),  # type: ignore[union-attr]
        )
    )).all()
    children: dict[int, list[int]] = {}
    for uid, mid in rows:
        if uid != mid:
            children.setdefault(mid, []).append(uid)
    found: set[int] = set()
    frontier = [manager_id]
    for _ in range(MAX_DEPTH):
        nxt = [c for m in frontier for c in children.get(m, ()) if c != manager_id and c not in found]
        if not nxt:
            break
        found.update(nxt)
        frontier = nxt
    return found


async def apply_profile_filters(
    statement,
    db_session: AsyncSession,
    org_id: int,
    department: Optional[str] = None,
    manager_id: Optional[int] = None,
    no_manager: bool = False,
    attributes: Optional[dict[str, str]] = None,
):
    """Narrow a ``select(User)`` members query by profile fields.

    ``attributes`` matches custom attributes exactly (``{key: value}``), e.g.
    the answer to a dropdown signup field saved to people data."""
    if not (department or manager_id or no_manager or attributes):
        return statement
    statement = statement.outerjoin(
        OrgMemberProfile,
        (OrgMemberProfile.user_id == User.id) & (OrgMemberProfile.org_id == org_id),
    )
    if department:
        statement = statement.where(func.lower(OrgMemberProfile.department) == department.strip().lower())
    if no_manager:
        statement = statement.where(OrgMemberProfile.manager_user_id.is_(None))  # type: ignore[union-attr]
    if manager_id:
        ids = await report_user_ids(db_session, org_id, manager_id)
        statement = statement.where(User.id.in_(list(ids) or [-1]))  # type: ignore[union-attr]
    for key, value in (attributes or {}).items():
        statement = statement.where(OrgMemberProfile.attributes[key].as_string() == value)  # type: ignore[index]
    return statement


def parse_attribute_filters(raw: Iterable[str]) -> dict[str, str]:
    """``["key=value", ...]`` query values into ``{key: value}``; malformed
    entries (no ``=``, empty key) are ignored."""
    out: dict[str, str] = {}
    for item in raw or []:
        key, sep, value = str(item).partition("=")
        if sep and key.strip():
            out[key.strip()[:60]] = value[:200]
    return out


async def profiles_for(db_session: AsyncSession, org_id: int, user_ids: Iterable[int]) -> dict[int, dict]:
    """``{user_id: {department, title, employee_id, location, cost_center,
    attributes, manager}}`` for the given members; members without a profile
    are left out."""
    ids = list(user_ids)
    if not ids:
        return {}
    profiles = (await db_session.execute(
        select(OrgMemberProfile).where(
            OrgMemberProfile.org_id == org_id,
            OrgMemberProfile.user_id.in_(ids),  # type: ignore[attr-defined]
        )
    )).scalars().all()
    manager_ids = {p.manager_user_id for p in profiles if p.manager_user_id}
    managers = {
        u.id: u for u in (await db_session.execute(
            select(User).where(User.id.in_(list(manager_ids)))  # type: ignore[union-attr]
        )).scalars().all()
    } if manager_ids else {}
    out: dict[int, dict] = {}
    for p in profiles:
        m = managers.get(p.manager_user_id) if p.manager_user_id else None
        out[p.user_id] = {
            "department": p.department,
            "title": p.title,
            "employee_id": p.employee_id,
            "location": p.location,
            "cost_center": p.cost_center,
            "attributes": p.attributes or {},
            "manager": {
                "id": m.id, "user_uuid": m.user_uuid, "username": m.username, "first_name": m.first_name,
                "last_name": m.last_name, "avatar_image": m.avatar_image or "",
            } if m else None,
        }
    return out
