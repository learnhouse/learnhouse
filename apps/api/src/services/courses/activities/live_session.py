from urllib.parse import urlparse
from pydantic import BaseModel
from typing import Optional
from sqlmodel import Session, select
from src.db.courses.courses import Course
from src.db.courses.chapters import Chapter
from src.db.courses.activities import (
    Activity,
    ActivityRead,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.course_chapters import CourseChapter
from src.db.users import PublicUser
from fastapi import HTTPException, Request
from uuid import uuid4
from datetime import datetime
from src.security.rbac import check_resource_access, AccessAction


class LiveSessionCreate(BaseModel):
    name: str
    chapter_id: str
    url: str
    start_datetime: str
    end_datetime: str
    timezone: str
    recurrence_rule: Optional[str] = None
    recurrence_end_date: Optional[str] = None


def detect_provider(url: str) -> str:
    """Auto-detect meeting provider from URL."""
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname or ""
    except Exception:
        return "other"

    if hostname.endswith("zoom.us"):
        return "zoom"
    elif hostname == "meet.google.com":
        return "google_meet"
    elif hostname.endswith("teams.microsoft.com") or hostname.endswith("teams.live.com"):
        return "teams"
    else:
        return "other"


async def create_live_session_activity(
    request: Request,
    data: LiveSessionCreate,
    current_user: PublicUser,
    db_session: Session,
):
    # Get chapter
    statement = select(Chapter).where(Chapter.id == data.chapter_id)
    chapter = db_session.exec(statement).first()

    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    statement = select(CourseChapter).where(CourseChapter.chapter_id == data.chapter_id)
    coursechapter = db_session.exec(statement).first()

    if not coursechapter:
        raise HTTPException(status_code=404, detail="CourseChapter not found")

    # Get course for RBAC check
    statement = select(Course).where(Course.id == coursechapter.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # RBAC check
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.CREATE
    )

    # Generate activity_uuid
    activity_uuid = str(f"activity_{uuid4()}")

    # Detect provider from URL
    provider = detect_provider(data.url)

    # Build recurrence object
    recurrence = None
    if data.recurrence_rule:
        recurrence = {
            "rule": data.recurrence_rule,
            "end_date": data.recurrence_end_date,
        }

    # Build content
    content = {
        "url": data.url,
        "provider": provider,
        "session_type": "external",
        "schedule": {
            "start_datetime": data.start_datetime,
            "end_datetime": data.end_datetime,
            "timezone": data.timezone,
            "recurrence": recurrence,
        },
    }

    activity_object = Activity(
        name=data.name,
        activity_type=ActivityTypeEnum.TYPE_LIVE_SESSION,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_LIVE_SESSION_EXTERNAL,
        activity_uuid=activity_uuid,
        course_id=coursechapter.course_id,
        org_id=coursechapter.org_id,
        content=content,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    activity = Activity.model_validate(activity_object)
    db_session.add(activity)
    db_session.commit()
    db_session.refresh(activity)

    # Find last activity order in the chapter
    statement = (
        select(ChapterActivity)
        .where(ChapterActivity.chapter_id == chapter.id)
        .order_by(ChapterActivity.order)  # type: ignore
    )
    chapter_activities = db_session.exec(statement).all()
    last_order = chapter_activities[-1].order if chapter_activities else 0
    to_be_used_order = last_order + 1

    # Create chapter-activity link
    chapter_activity_object = ChapterActivity(
        chapter_id=chapter.id,  # type: ignore
        activity_id=activity.id,  # type: ignore
        course_id=coursechapter.course_id,
        org_id=coursechapter.org_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        order=to_be_used_order,
    )

    db_session.add(chapter_activity_object)
    db_session.commit()
    db_session.refresh(chapter_activity_object)

    return ActivityRead.model_validate(activity)
