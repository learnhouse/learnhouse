from typing import Literal
from src.db.courses import Course
from src.db.organizations import Organization
from sqlmodel import Session, select
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles_and_authorship_and_usergroups,
    authorization_verify_if_user_is_anon,
)
from src.db.chapters import Chapter
from src.db.activities import (
    Activity,
    ActivityRead,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.chapter_activities import ChapterActivity
from src.db.course_chapters import CourseChapter
from src.db.users import AnonymousUser, PublicUser
from src.services.courses.activities.uploads.pdfs import upload_pdf
from fastapi import HTTPException, status, UploadFile, Request
from uuid import uuid4
from datetime import datetime


async def create_documentpdf_activity(
    request: Request,
    name: str,
    chapter_id: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
    pdf_file: UploadFile | None = None,
):
    # RBAC check
    await rbac_check(request, "activity_x", current_user, "create", db_session)

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

    # get org_id
    org_id = coursechapter.org_id

    # Get org_uuid
    statement = select(Organization).where(Organization.id == coursechapter.org_id)
    organization = db_session.exec(statement).first()

    # Get course_uuid
    statement = select(Course).where(Course.id == coursechapter.course_id)
    course = db_session.exec(statement).first()

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

    # get pdf format
    if pdf_file.filename:
        pdf_format = pdf_file.filename.split(".")[-1]

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Pdf : No pdf file provided"
        )

    # Create activity
    activity = Activity(
        name=name,
        activity_type=ActivityTypeEnum.TYPE_DOCUMENT,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DOCUMENT_PDF,
        content={
            "filename": "documentpdf." + pdf_format,
            "activity_uuid": activity_uuid,
        },
        published_version=1,
        version=1,
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

    # Add activity to chapter
    activity_chapter = ChapterActivity(
        chapter_id=(int(chapter_id)),
        activity_id=activity.id,  # type: ignore
        course_id=coursechapter.course_id,
        org_id=coursechapter.org_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        order=1,
    )

    # upload pdf
    if pdf_file:
        # get pdffile format
        await upload_pdf(
            pdf_file,
            activity.activity_uuid,
            organization.org_uuid,
            course.course_uuid,
        )

    # Insert ChapterActivity link in DB
    db_session.add(activity_chapter)
    db_session.commit()
    db_session.refresh(activity_chapter)

    return ActivityRead.from_orm(activity)


## 🔒 RBAC Utils ##


async def rbac_check(
    request: Request,
    course_id: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
):
    await authorization_verify_if_user_is_anon(current_user.id)

    await authorization_verify_based_on_roles_and_authorship_and_usergroups(
        request,
        current_user.id,
        action,
        course_id,
        db_session,
    )


## 🔒 RBAC Utils ##
