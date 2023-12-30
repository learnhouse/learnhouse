from fastapi import Depends, HTTPException, Request
from sqlmodel import Session, select
from src.db.courses import Course, CourseRead
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.db.activities import Activity, ActivityRead
from src.security.auth import get_current_user
from src.services.ai.base import ask_ai

from src.services.ai.schemas.ai import StartActivityAIChatSession
from src.services.courses.activities.utils import (
    serialize_activity_text_to_ai_comprehensible_text,
    structure_activity_content_by_type,
)


def ai_start_activity_chat_session(
    request: Request,
    chat_session_object: StartActivityAIChatSession,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Start a new AI Chat session with a Course Activity
    """
    # Get the Activity
    statement = select(Activity).where(
        Activity.activity_uuid == chat_session_object.activity_uuid
    )
    activity = db_session.exec(statement).first()

    activity = ActivityRead.from_orm(activity)

    # Get the Course
    statement = select(Course).join(Activity).where(
        Activity.activity_uuid == chat_session_object.activity_uuid
    )
    course = db_session.exec(statement).first()
    course = CourseRead.from_orm(course)


    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    # Get Activity Content Blocks
    content = activity.content

    # Serialize Activity Content Blocks to a text comprehensible by the AI
    structured = structure_activity_content_by_type(content)
    ai_friendly_text = serialize_activity_text_to_ai_comprehensible_text(structured,course,activity)

    response = ask_ai(
        chat_session_object.message,
        [],
        ai_friendly_text,
        "You are a helpful Education Assistant, and you are helping a student with the associated Course. "
        "Use the available tools to get context about this question even if the question is not specific enough."
        "For context, this is the Course name :" + course.name + " and this is the Lecture name :" + activity.name + "."
        "Use your knowledge to help the student."
    )

    return response['output'] 
