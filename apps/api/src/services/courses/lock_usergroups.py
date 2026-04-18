"""Attach/detach/list user groups on chapter and activity locks.

Reuses ``usergroupresource`` (resource_uuid = chapter_uuid or activity_uuid)
so locked chapters and activities share the same association table as
playgrounds. Only users with course UPDATE permission can manage these.
"""

from datetime import datetime
from typing import List

from fastapi import HTTPException, Request, status
from sqlmodel import Session, select

from src.db.courses.activities import Activity
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroups import UserGroup
from src.db.users import PublicUser
from src.security.rbac import AccessAction, check_resource_access


def _load_chapter_and_course(chapter_uuid, db_session):
    chapter = db_session.exec(
        select(Chapter).where(Chapter.chapter_uuid == chapter_uuid)
    ).first()
    if not chapter:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chapter not found")

    course = db_session.exec(select(Course).where(Course.id == chapter.course_id)).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return chapter, course


def _load_activity_and_course(activity_uuid, db_session):
    activity = db_session.exec(
        select(Activity).where(Activity.activity_uuid == activity_uuid)
    ).first()
    if not activity:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Activity not found")

    course = db_session.exec(select(Course).where(Course.id == activity.course_id)).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return activity, course


def _load_usergroup(usergroup_uuid, db_session):
    ug = db_session.exec(
        select(UserGroup).where(UserGroup.usergroup_uuid == usergroup_uuid)
    ).first()
    if not ug:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User group not found")
    return ug


def _attach_usergroup(resource_uuid, org_id, usergroup_id, db_session):
    existing = db_session.exec(
        select(UserGroupResource).where(
            UserGroupResource.resource_uuid == resource_uuid,
            UserGroupResource.usergroup_id == usergroup_id,
        )
    ).first()
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
    db_session.commit()
    return {"detail": "User group added"}


def _detach_usergroup(resource_uuid, usergroup_id, db_session):
    ugr = db_session.exec(
        select(UserGroupResource).where(
            UserGroupResource.resource_uuid == resource_uuid,
            UserGroupResource.usergroup_id == usergroup_id,
        )
    ).first()
    if not ugr:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User group not associated with resource",
        )
    db_session.delete(ugr)
    db_session.commit()
    return {"detail": "User group removed"}


def _list_usergroups_for_resource(resource_uuid, db_session):
    ugrs = db_session.exec(
        select(UserGroupResource).where(UserGroupResource.resource_uuid == resource_uuid)
    ).all()
    out = []
    for ugr in ugrs:
        ug = db_session.get(UserGroup, ugr.usergroup_id)
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
    db_session: Session,
) -> dict:
    _, course = _load_chapter_and_course(chapter_uuid, db_session)
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.UPDATE
    )
    ug = _load_usergroup(usergroup_uuid, db_session)
    return _attach_usergroup(chapter_uuid, course.org_id, ug.id, db_session)


async def remove_usergroup_from_chapter(
    request: Request,
    chapter_uuid: str,
    usergroup_uuid: str,
    current_user: PublicUser,
    db_session: Session,
) -> dict:
    _, course = _load_chapter_and_course(chapter_uuid, db_session)
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.UPDATE
    )
    ug = _load_usergroup(usergroup_uuid, db_session)
    return _detach_usergroup(chapter_uuid, ug.id, db_session)


async def get_chapter_usergroups(
    request: Request,
    chapter_uuid: str,
    current_user: PublicUser,
    db_session: Session,
) -> List[dict]:
    _, course = _load_chapter_and_course(chapter_uuid, db_session)
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.READ
    )
    return _list_usergroups_for_resource(chapter_uuid, db_session)


# ---------------------------------------------------------------------------
# Activity
# ---------------------------------------------------------------------------


async def add_usergroup_to_activity(
    request: Request,
    activity_uuid: str,
    usergroup_uuid: str,
    current_user: PublicUser,
    db_session: Session,
) -> dict:
    _, course = _load_activity_and_course(activity_uuid, db_session)
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.UPDATE
    )
    ug = _load_usergroup(usergroup_uuid, db_session)
    return _attach_usergroup(activity_uuid, course.org_id, ug.id, db_session)


async def remove_usergroup_from_activity(
    request: Request,
    activity_uuid: str,
    usergroup_uuid: str,
    current_user: PublicUser,
    db_session: Session,
) -> dict:
    _, course = _load_activity_and_course(activity_uuid, db_session)
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.UPDATE
    )
    ug = _load_usergroup(usergroup_uuid, db_session)
    return _detach_usergroup(activity_uuid, ug.id, db_session)


async def get_activity_usergroups(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser,
    db_session: Session,
) -> List[dict]:
    _, course = _load_activity_and_course(activity_uuid, db_session)
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.READ
    )
    return _list_usergroups_for_resource(activity_uuid, db_session)
