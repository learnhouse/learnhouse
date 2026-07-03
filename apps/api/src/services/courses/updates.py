from datetime import datetime
from typing import List
from uuid import uuid4
from fastapi import HTTPException, Request, status
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession
from src.db.courses.course_updates import (
    CourseUpdate,
    CourseUpdateCreate,
    CourseUpdateRead,
    CourseUpdateUpdate,
)
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.users import AnonymousUser, PublicUser
from src.security.rbac import check_resource_access, AccessAction
from src.services.webhooks.dispatch import dispatch_webhooks


async def create_update(
    request: Request,
    course_uuid: str,
    update_object: CourseUpdateCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> CourseUpdateRead:

    # CHekc if org exists
    statement_org = select(Organization).where(Organization.id == update_object.org_id)
    org = (await db_session.execute(statement_org)).scalars().first()

    if not org or org.id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization does not exist"
        )

    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = (await db_session.execute(statement)).scalars().first()

    if not course or course.id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist"
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # Generate UUID
    courseupdate_uuid = str(f"courseupdate_{uuid4()}")

    update = CourseUpdate(
        **update_object.model_dump(),
        course_id=course.id,
        courseupdate_uuid=courseupdate_uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(update)

    await db_session.commit()
    await db_session.refresh(update)

    await dispatch_webhooks(
        event_name="course_update_published",
        org_id=update_object.org_id,
        data={
            "courseupdate_uuid": update.courseupdate_uuid,
            "course_uuid": course_uuid,
        },
    )

    return CourseUpdateRead(**update.model_dump())


# Update Course Update
async def update_update(
    request: Request,
    courseupdate_uuid: str,
    update_object: CourseUpdateUpdate,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> CourseUpdateRead:
    statement = select(CourseUpdate).where(
        CourseUpdate.courseupdate_uuid == courseupdate_uuid
    )
    update = (await db_session.execute(statement)).scalars().first()

    if not update or update.id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Update does not exist"
        )

    # RBAC check
    await check_resource_access(
        request, db_session, current_user, update.courseupdate_uuid, AccessAction.UPDATE
    )

    for key, value in update_object.model_dump().items():
        if value is not None:
            setattr(update, key, value)

    db_session.add(update)

    await db_session.commit()
    await db_session.refresh(update)

    return CourseUpdateRead(**update.model_dump())


# Delete Course Update
async def delete_update(
    request: Request,
    courseupdate_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
):
    statement = select(CourseUpdate).where(
        CourseUpdate.courseupdate_uuid == courseupdate_uuid
    )
    update = (await db_session.execute(statement)).scalars().first()

    if not update or update.id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Update does not exist"
        )

    # RBAC check
    await check_resource_access(
        request, db_session, current_user, update.courseupdate_uuid, AccessAction.DELETE
    )

    await db_session.delete(update)
    await db_session.commit()

    return {"message": "Update deleted successfully"}


# Get Course Updates by Course ID
async def get_updates_by_course_uuid(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> List[CourseUpdateRead]:
    # FInd if course exists
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = (await db_session.execute(statement)).scalars().first()

    if not course or course.id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist"
        )

    # RBAC check — course updates inherit the course's visibility. Without this
    # any caller (including anonymous users) could read the update feed of a
    # private / unpublished course just by knowing its uuid.
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    statement = (
        select(CourseUpdate)
        .where(CourseUpdate.course_id == course.id)
        .order_by(col(CourseUpdate.creation_date).desc())
    )  # https://sqlmodel.tiangolo.com/tutorial/where/#type-annotations-and-errors
    updates = (await db_session.execute(statement)).scalars().all()

    return [CourseUpdateRead(**update.model_dump()) for update in updates]
