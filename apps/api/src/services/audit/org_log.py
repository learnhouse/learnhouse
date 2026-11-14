"""Helpers for the organization audit log (an EE feature, see
``src.core.ee_hooks.audit_event``) shared by core call sites."""

from __future__ import annotations

from typing import Any, Optional

from src.core.ee_hooks import audit_event


def audit_account_event(request: Any, action: str, user: Any, **event: Any) -> None:
    """An account-level event (2FA, password, email): filed under the org the
    session was signed in for, or, from the apex, under every org the user
    belongs to. The user is both actor and target unless given otherwise."""
    from src.security.session_context import held_org_id

    org_id: Optional[int] = event.pop("org_id", None) or held_org_id()
    event.setdefault("actor", user)
    event.setdefault("target_type", "user")
    event.setdefault("target_id", getattr(user, "user_uuid", None))
    event.setdefault("target_name", getattr(user, "username", None))
    audit_event(request, action=action, org_id=org_id, member_orgs=True, **event)


def snapshot(obj: Any, fields: tuple[str, ...]) -> dict:
    """The named attributes of ``obj`` as a dict, for a before/after diff."""
    out = {}
    for f in fields:
        value = getattr(obj, f, None)
        if hasattr(value, "model_dump"):
            value = value.model_dump()
        elif isinstance(value, dict):
            value = dict(value)
        out[f] = value
    return out


async def user_label(db_session: Any, user_id: Optional[int]) -> tuple[Optional[str], Optional[str]]:
    """``(user_uuid, display name)`` of a user, for an entry's target."""
    if not user_id:
        return None, None
    try:
        from src.db.users import User

        user = await db_session.get(User, user_id)
    except Exception:
        return None, None
    if user is None:
        return None, None
    name = " ".join(p for p in (user.first_name, user.last_name) if p).strip()
    return user.user_uuid, (name or user.username)


async def role_name(db_session: Any, role_id: Optional[int]) -> Optional[str]:
    if not role_id:
        return None
    try:
        from src.db.roles import Role

        role = await db_session.get(Role, role_id)
    except Exception:
        return None
    return role.name if role else None


async def course_ref(db_session: Any, course_uuid: str) -> tuple[Optional[int], Optional[str]]:
    """``(org_id, name)`` of a course, for entries about it."""
    try:
        from sqlmodel import select

        from src.db.courses.courses import Course

        row = (await db_session.execute(
            select(Course.org_id, Course.name).where(Course.course_uuid == course_uuid)
        )).first()
    except Exception:
        return None, None
    return (row[0], row[1]) if row else (None, None)
