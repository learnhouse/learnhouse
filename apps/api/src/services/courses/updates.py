from datetime import datetime
from typing import List
from uuid import uuid4
from fastapi import HTTPException, Request, status
from sqlmodel import Session, col, select
from src.db.courses.course_updates import (
    CourseUpdate,
    CourseUpdateCreate,
    CourseUpdateRead,
    CourseUpdateUpdate,
)
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.users import AnonymousUser, PublicUser
from src.services.courses.courses import rbac_check


async def create_update(
    request: Request,
    course_uuid: str,
    update_object: CourseUpdateCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> CourseUpdateRead:

    # CHekc if org exists
    statement_org = select(Organization).where(Organization.id == update_object.org_id)
    org = db_session.exec(statement_org).first()

    if not org or org.id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization does not exist"
        )

    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course or course.id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist"
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "update", db_session)

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

    db_session.commit()
    db_session.refresh(update)

    return CourseUpdateRead(**update.model_dump())


# Update Course Update
async def update_update(
    request: Request,
    courseupdate_uuid: str,
    update_object: CourseUpdateUpdate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> CourseUpdateRead:
    statement = select(CourseUpdate).where(
        CourseUpdate.courseupdate_uuid == courseupdate_uuid
    )
    update = db_session.exec(statement).first()

    if not update or update.id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Update does not exist"
        )

    # RBAC check
    await rbac_check(
        request, update.courseupdate_uuid, current_user, "update", db_session
    )

    for key, value in update_object.model_dump().items():
        if value is not None:
            setattr(update, key, value)

    db_session.add(update)

    db_session.commit()
    db_session.refresh(update)

    return CourseUpdateRead(**update.model_dump())


# Delete Course Update
async def delete_update(
    request: Request,
    courseupdate_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(CourseUpdate).where(
        CourseUpdate.courseupdate_uuid == courseupdate_uuid
    )
    update = db_session.exec(statement).first()

    if not update or update.id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Update does not exist"
        )

    # RBAC check
    await rbac_check(
        request, update.courseupdate_uuid, current_user, "delete", db_session
    )

    db_session.delete(update)
    db_session.commit()

    return {"message": "Update deleted successfully"}


# Get Course Updates by Course ID
async def get_updates_by_course_uuid(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> List[CourseUpdateRead]:
    # FInd if course exists
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course or course.id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist"
        )

    statement = (
        select(CourseUpdate)
        .where(CourseUpdate.course_id == course.id)
        .order_by(col(CourseUpdate.creation_date).desc())
    )  # https://sqlmodel.tiangolo.com/tutorial/where/#type-annotations-and-errors
    updates = db_session.exec(statement).all()

    return [CourseUpdateRead(**update.model_dump()) for update in updates]
