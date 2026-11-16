"""Turning live editing (real-time collaboration + autosave) on or off.

Org default: ``config["features"]["collaboration"]["live_editing"]`` in the
organization config JSON (default on). Per activity: ``details["live_editing"]``
on the activity, ``"default"`` (follow the org), ``"on"`` or ``"off"``. No
migration: both live in existing JSON fields.

When live editing ends for activities whose rooms are open, the collab server
is told to save each room and drop its connections right away (editors switch
to manual saving), instead of waiting for its periodic access re-check.
"""

import json
from datetime import datetime
from typing import Literal, Optional

from fastapi import HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.ee_hooks import audit_event
from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.courses import Course
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.users import AnonymousUser, PublicUser
from src.security.rbac import AccessAction, check_resource_access
from src.services.courses.activities.collab_notify import kick_collab_rooms

LiveEditingMode = Literal["default", "on", "off"]
LIVE_EDITING_MODES = ("default", "on", "off")


class OrgLiveEditingRead(BaseModel):
    live_editing: bool


class OrgLiveEditingWrite(BaseModel):
    live_editing: bool


class ActivityLiveEditingWrite(BaseModel):
    mode: LiveEditingMode


class ActivityLiveEditingRead(BaseModel):
    mode: LiveEditingMode
    org_default: bool
    effective: bool


def org_live_editing(config: Optional[dict]) -> bool:
    """The org default from its config JSON; on unless explicitly off."""
    value = (((config or {}).get("features") or {}).get("collaboration") or {}).get("live_editing")
    return value is not False


def activity_live_editing_mode(activity: Activity) -> LiveEditingMode:
    value = (activity.details or {}).get("live_editing") if isinstance(activity.details, dict) else None
    return value if value in LIVE_EDITING_MODES else "default"


def resolve_live_editing(mode: LiveEditingMode, org_default: bool) -> bool:
    return org_default if mode == "default" else mode == "on"


async def _org_config(org_id: int, db_session: AsyncSession) -> Optional[OrganizationConfig]:
    return (await db_session.execute(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    )).scalars().first()


async def live_editing_enabled(activity: Activity, db_session: AsyncSession) -> bool:
    """Whether the activity is edited live (collab room + autosave)."""
    mode = activity_live_editing_mode(activity)
    if mode != "default":
        return mode == "on"
    config = await _org_config(activity.org_id, db_session)
    return org_live_editing(config.config if config else None)


# ── Org default ─────────────────────────────────────────────────────────────


async def get_org_live_editing(org_id: int, db_session: AsyncSession) -> OrgLiveEditingRead:
    config = await _org_config(org_id, db_session)
    return OrgLiveEditingRead(live_editing=org_live_editing(config.config if config else None))


async def set_org_live_editing(
    request: Request,
    org_id: int,
    body: OrgLiveEditingWrite,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> OrgLiveEditingRead:
    """Org admins (org settings rights) set the default for every activity."""
    # Imported here: the orgs service imports half the app
    from src.services.orgs.orgs import rbac_check

    org = await db_session.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)
    config = await _org_config(org_id, db_session)
    if config is None:
        raise HTTPException(status_code=404, detail="Organization config not found")

    before = org_live_editing(config.config)
    updated = json.loads(json.dumps(config.config or {}))
    updated.setdefault("features", {}).setdefault("collaboration", {})["live_editing"] = body.live_editing
    config.config = updated
    config.update_date = str(datetime.now())
    db_session.add(config)
    await db_session.commit()

    from src.services.orgs.cache import invalidate_org_config_cache
    invalidate_org_config_cache(org_id)

    audit_event(
        request, action="org.settings.updated", org_id=org_id, actor=current_user,
        target_type="organization", target_id=org.org_uuid, target_name=org.name,
        before={"features.collaboration.live_editing": before},
        after={"features.collaboration.live_editing": body.live_editing},
    )

    if before and not body.live_editing:
        # Every page activity that followed the org default loses live editing
        rows = (await db_session.execute(
            select(Activity).where(
                Activity.org_id == org_id,
                Activity.activity_type == ActivityTypeEnum.TYPE_DYNAMIC,
                Activity.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            )
        )).scalars().all()
        kick_collab_rooms([a.activity_uuid for a in rows if activity_live_editing_mode(a) == "default"])

    return OrgLiveEditingRead(live_editing=body.live_editing)


# ── Per activity ────────────────────────────────────────────────────────────


async def _editable_activity(request, activity_uuid, current_user, db_session) -> Activity:
    row = (await db_session.execute(
        select(Activity, Course).join(Course, Activity.course_id == Course.id).where(Activity.activity_uuid == activity_uuid)
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="Activity not found")
    activity, course = row
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)
    return activity


async def get_activity_live_editing(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> ActivityLiveEditingRead:
    activity = await _editable_activity(request, activity_uuid, current_user, db_session)
    config = await _org_config(activity.org_id, db_session)
    org_default = org_live_editing(config.config if config else None)
    mode = activity_live_editing_mode(activity)
    return ActivityLiveEditingRead(mode=mode, org_default=org_default, effective=resolve_live_editing(mode, org_default))


async def set_activity_live_editing(
    request: Request,
    activity_uuid: str,
    body: ActivityLiveEditingWrite,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> ActivityLiveEditingRead:
    """People who can edit the course override the org default for one activity."""
    activity = await _editable_activity(request, activity_uuid, current_user, db_session)
    config = await _org_config(activity.org_id, db_session)
    org_default = org_live_editing(config.config if config else None)
    before_mode = activity_live_editing_mode(activity)
    was_live = resolve_live_editing(before_mode, org_default)

    details = dict(activity.details) if isinstance(activity.details, dict) else {}
    if body.mode == "default":
        details.pop("live_editing", None)
    else:
        details["live_editing"] = body.mode
    activity.details = details
    flag_modified(activity, "details")
    org_id, uuid, name = activity.org_id, activity.activity_uuid, activity.name
    db_session.add(activity)
    await db_session.commit()

    effective = resolve_live_editing(body.mode, org_default)
    audit_event(
        request, action="activity.updated", org_id=org_id, actor=current_user,
        target_type="activity", target_id=uuid, target_name=name,
        before={"live_editing": before_mode}, after={"live_editing": body.mode},
    )
    if was_live and not effective:
        kick_collab_rooms([uuid])
    return ActivityLiveEditingRead(mode=body.mode, org_default=org_default, effective=effective)
