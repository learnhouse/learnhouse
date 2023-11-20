from sqlmodel import Session, select
from src.db.chapters import Chapter
from src.db.activities import (
    Activity,
    ActivityRead,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.chapter_activities import ChapterActivity
from src.db.course_chapters import CourseChapter
from src.db.users import PublicUser
from src.security.rbac.rbac import authorization_verify_based_on_roles
from src.services.courses.activities.uploads.pdfs import upload_pdf
from fastapi import HTTPException, status, UploadFile, Request
from uuid import uuid4
from datetime import datetime


async def create_documentpdf_activity(
    request: Request,
    name: str,
    chapter_id: str,
    current_user: PublicUser,
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

    # get org_id
    org_id = coursechapter.id

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
        activity_id=activity.id is not None,
        course_id=coursechapter.course_id,
        org_id=coursechapter.org_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        order=1,
    )

    # upload pdf
    if pdf_file:
        # get pdffile format
        await upload_pdf(pdf_file, activity.id, org_id, coursechapter.course_id)

    # Insert ChapterActivity link in DB
    db_session.add(activity_chapter)
    db_session.commit()
    db_session.refresh(activity_chapter)

    return ActivityRead.from_orm(activity)
