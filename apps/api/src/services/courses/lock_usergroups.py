"""Attach/detach/list user groups on chapter and activity locks.

Reuses ``usergroupresource`` (resource_uuid = chapter_uuid or activity_uuid)
so locked chapters and activities share the same association table as
playgrounds. Only users with course UPDATE permission can manage these.
"""

from datetime import datetime
from typing import List

from fastapi import HTTPException, Request, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroups import UserGroup
from src.db.users import PublicUser
from src.security.rbac import AccessAction, check_resource_access


async def _load_chapter_and_course(chapter_uuid, db_session):
    chapter = (await db_session.execute(
        select(Chapter).where(Chapter.chapter_uuid == chapter_uuid)
    )).scalars().first()
    if not chapter:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chapter not found")

    course = (await db_session.execute(select(Course).where(Course.id == chapter.course_id))).scalars().first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return chapter, course


async def _load_activity_and_course(activity_uuid, db_session):
    activity = (await db_session.execute(
        select(Activity).where(Activity.activity_uuid == activity_uuid)
    )).scalars().first()
    if not activity:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Activity not found")

    course = (await db_session.execute(select(Course).where(Course.id == activity.course_id))).scalars().first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return activity, course


async def _load_usergroup(usergroup_uuid, db_session):
    ug = (await db_session.execute(
        select(UserGroup).where(UserGroup.usergroup_uuid == usergroup_uuid)
    )).scalars().first()
    if not ug:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User group not found")
    return ug


async def _attach_usergroup(resource_uuid, org_id, usergroup_id, db_session):
    existing = (await db_session.execute(
        select(UserGroupResource).where(
            UserGroupResource.resource_uuid == resource_uuid,
            UserGroupResource.usergroup_id == usergroup_id,
        )
    )).scalars().first()
    if existing:
        return {"detail": "User group already has access"}

    now = datetime.utcnow().isoformat()
    ugr = UserGroupResource(
        usergroup_id=usergroup_id,
        resource_uuid=resource_uuid,
        org_id=org_id,
        creation_date=now,
        update_date=now,
    )
    db_session.add(ugr)
    await db_session.commit()
    return {"detail": "User group added"}


async def _detach_usergroup(resource_uuid, usergroup_id, db_session):
    ugr = (await db_session.execute(
        select(UserGroupResource).where(
            UserGroupResource.resource_uuid == resource_uuid,
            UserGroupResource.usergroup_id == usergroup_id,
        )
    )).scalars().first()
    if not ugr:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User group not associated with resource",
        )
    await db_session.delete(ugr)
    await db_session.commit()
    return {"detail": "User group removed"}


async def _list_usergroups_for_resource(resource_uuid, db_session):
    ugrs = (await db_session.execute(
        select(UserGroupResource).where(UserGroupResource.resource_uuid == resource_uuid)
    )).scalars().all()
    out = []
    for ugr in ugrs:
        ug = (await db_session.execute(
            select(UserGroup).where(UserGroup.id == ugr.usergroup_id)
        )).scalars().first()
        if ug:
            out.append(
                {
                    "usergroup_id": ug.id,
                    "usergroup_uuid": ug.usergroup_uuid,
                    "name": ug.name,
                    "description": ug.description,
                }
            )
    return out


# ---------------------------------------------------------------------------
# Chapter
# ---------------------------------------------------------------------------


async def add_usergroup_to_chapter(
    request: Request,
    chapter_uuid: str,
    usergroup_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> dict:
    _, course = await _load_chapter_and_course(chapter_uuid, db_session)
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.UPDATE
    )
    ug = await _load_usergroup(usergroup_uuid, db_session)
    return await _attach_usergroup(chapter_uuid, course.org_id, ug.id, db_session)


async def remove_usergroup_from_chapter(
    request: Request,
    chapter_uuid: str,
    usergroup_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> dict:
    _, course = await _load_chapter_and_course(chapter_uuid, db_session)
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.UPDATE
    )
    ug = await _load_usergroup(usergroup_uuid, db_session)
    return await _detach_usergroup(chapter_uuid, ug.id, db_session)


async def get_chapter_usergroups(
    request: Request,
    chapter_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> List[dict]:
    _, course = await _load_chapter_and_course(chapter_uuid, db_session)
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.READ
    )
    return await _list_usergroups_for_resource(chapter_uuid, db_session)


# ---------------------------------------------------------------------------
# Activity
# ---------------------------------------------------------------------------


async def add_usergroup_to_activity(
    request: Request,
    activity_uuid: str,
    usergroup_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> dict:
    _, course = await _load_activity_and_course(activity_uuid, db_session)
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.UPDATE
    )
    ug = await _load_usergroup(usergroup_uuid, db_session)
    return await _attach_usergroup(activity_uuid, course.org_id, ug.id, db_session)


async def remove_usergroup_from_activity(
    request: Request,
    activity_uuid: str,
    usergroup_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> dict:
    _, course = await _load_activity_and_course(activity_uuid, db_session)
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.UPDATE
    )
    ug = await _load_usergroup(usergroup_uuid, db_session)
    return await _detach_usergroup(activity_uuid, ug.id, db_session)


async def get_activity_usergroups(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> List[dict]:
    _, course = await _load_activity_and_course(activity_uuid, db_session)
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.READ
    )
    return await _list_usergroups_for_resource(activity_uuid, db_session)
