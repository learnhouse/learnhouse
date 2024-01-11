from uuid import uuid4
from fastapi import Depends, HTTPException, Request
from requests import session
from sqlmodel import Session, select
from src.db.courses import Course, CourseRead
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.db.activities import Activity, ActivityRead
from src.security.auth import get_current_user
from langchain.memory.chat_message_histories import RedisChatMessageHistory
from src.services.ai.base import ask_ai, get_chat_session_history

from src.services.ai.schemas.ai import (
    ActivityAIChatSessionResponse,
    SendActivityAIChatMessage,
    StartActivityAIChatSession,
)
from src.services.courses.activities.utils import (
    serialize_activity_text_to_ai_comprehensible_text,
    structure_activity_content_by_type,
)


def ai_start_activity_chat_session(
    request: Request,
    chat_session_object: StartActivityAIChatSession,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> ActivityAIChatSessionResponse:
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
    statement = (
        select(Course)
        .join(Activity)
        .where(Activity.activity_uuid == chat_session_object.activity_uuid)
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
    ai_friendly_text = serialize_activity_text_to_ai_comprehensible_text(
        structured, course, activity
    )

    chat_session = get_chat_session_history()

    response = ask_ai(
        chat_session_object.message,
        chat_session['message_history'],
        ai_friendly_text,
        "You are a helpful Education Assistant, and you are helping a student with the associated Course. "
        "Use the available tools to get context about this question even if the question is not specific enough."
        "For context, this is the Course name :"
        + course.name
        + " and this is the Lecture name :"
        + activity.name
        + "."
        "Use your knowledge to help the student.",
    )

    return ActivityAIChatSessionResponse(
        aichat_uuid=chat_session['aichat_uuid'],
        activity_uuid=activity.activity_uuid,
        message=response["output"],
    )

def ai_send_activity_chat_message(
    request: Request,
    chat_session_object: SendActivityAIChatMessage,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> ActivityAIChatSessionResponse:
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
    statement = (
        select(Course)
        .join(Activity)
        .where(Activity.activity_uuid == chat_session_object.activity_uuid)
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
    ai_friendly_text = serialize_activity_text_to_ai_comprehensible_text(
        structured, course, activity
    )

    chat_session = get_chat_session_history(chat_session_object.aichat_uuid)

    response = ask_ai(
        chat_session_object.message,
        chat_session['message_history'],
        ai_friendly_text,
        "You are a helpful Education Assistant, and you are helping a student with the associated Course. "
        "Use the available tools to get context about this question even if the question is not specific enough."
        "For context, this is the Course name :"
        + course.name
        + " and this is the Lecture name :"
        + activity.name
        + "."
        "Use your knowledge to help the student if the context is not enough.",
    )

    return ActivityAIChatSessionResponse(
        aichat_uuid=chat_session['aichat_uuid'],
        activity_uuid=activity.activity_uuid,
        message=response["output"],
    )
