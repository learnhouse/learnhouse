from src.db.courses.courses import Course
from src.db.organizations import Organization
from sqlmodel import Session, select
from src.db.courses.chapters import Chapter
from src.db.courses.activities import (
    Activity,
    ActivityRead,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.course_chapters import CourseChapter
from src.db.users import AnonymousUser, PublicUser
from src.services.courses.activities.uploads.pdfs import upload_pdf
from fastapi import HTTPException, status, UploadFile, Request
from uuid import uuid4
from datetime import datetime
from src.security.rbac import check_resource_access, AccessAction


async def create_documentpdf_activity(
    request: Request,
    name: str,
    chapter_id: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
    pdf_file: UploadFile | None = None,
):
    # get chapter_id
    statement = select(Chapter).where(Chapter.id == chapter_id)
    chapter = db_session.exec(statement).first()

    if not chapter:
        raise HTTPException(
            status_code=404,
            detail="Chapter not found",
        )

    statement = select(CourseChapter).where(CourseChapter.chapter_id == chapter_id)
    coursechapter = db_session.exec(statement).first()

    if not coursechapter:
        raise HTTPException(
            status_code=404,
            detail="CourseChapter not found",
        )

    # Get course_uuid for RBAC check
    statement = select(Course).where(Course.id == coursechapter.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.CREATE)

    # get org_id
    org_id = coursechapter.org_id

    # Get org_uuid
    statement = select(Organization).where(Organization.id == coursechapter.org_id)
    organization = db_session.exec(statement).first()

    # create activity uuid
    activity_uuid = f"activity_{uuid4()}"

    # check if pdf_file is not None
    if not pdf_file:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Pdf : No pdf file provided"
        )

    if pdf_file.content_type not in ["application/pdf"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Pdf : Wrong pdf format"
        )

    if not pdf_file.filename:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Pdf : No pdf file provided"
        )

    # Upload pdf first to get safe filename
    saved_filename = None
    if pdf_file and organization and course:
        saved_filename = await upload_pdf(
            pdf_file,
            activity_uuid,
            organization.org_uuid,
            course.course_uuid,
        )

    # Create activity
    activity = Activity(
        name=name,
        activity_type=ActivityTypeEnum.TYPE_DOCUMENT,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DOCUMENT_PDF,
        content={
            "filename": saved_filename or "documentpdf",
            "activity_uuid": activity_uuid,
            },
        org_id=org_id if org_id else 0,
        course_id=coursechapter.course_id,
        activity_uuid=activity_uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    # Insert Activity in DB
    db_session.add(activity)
    db_session.commit()
    db_session.refresh(activity)

    # Find the last activity order in the chapter
    statement = (
        select(ChapterActivity)
        .where(ChapterActivity.chapter_id == int(chapter_id))
        .order_by(ChapterActivity.order)  # type: ignore
    )
    chapter_activities = db_session.exec(statement).all()
    last_order = chapter_activities[-1].order if chapter_activities else 0
    to_be_used_order = last_order + 1

    # Add activity to chapter
    activity_chapter = ChapterActivity(
        chapter_id=(int(chapter_id)),
        activity_id=activity.id,  # type: ignore
        course_id=coursechapter.course_id,
        org_id=coursechapter.org_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        order=to_be_used_order,
    )

    # Insert ChapterActivity link in DB
    db_session.add(activity_chapter)
    db_session.commit()
    db_session.refresh(activity_chapter)

    return ActivityRead.model_validate(activity)
