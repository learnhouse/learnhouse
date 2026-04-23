import logging
from typing import Tuple, Dict, Any
from fastapi import Depends, HTTPException, Request
from sqlmodel import Session, select
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.security.features_utils.usage import (
    refund_ai_credit,
    reserve_ai_credit,
)
from src.db.courses.courses import Course, CourseRead
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.db.courses.activities import Activity, ActivityRead
from src.security.auth import get_current_user, resolve_acting_user_id
from src.services.ai.base import (
    ask_ai,
    get_chat_session_history,
    save_message_to_history,
)

from src.services.ai.schemas.ai import (
    ActivityAIChatSessionResponse,
    SendActivityAIChatMessage,
    StartActivityAIChatSession,
)
from src.services.courses.activities.utils import (
    serialize_activity_text_to_ai_comprehensible_text,
    structure_activity_content_by_type,
)

logger = logging.getLogger(__name__)


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

    activity = ActivityRead.model_validate(activity)

    # Get the Course with authors
    statement = (
        select(Course)
        .join(Activity)
        .where(Activity.activity_uuid == chat_session_object.activity_uuid)
    )
    course = db_session.exec(statement).first()
    
    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )
    
    # Get course authors
    from src.db.resource_authors import ResourceAuthor
    from src.db.users import User
    from src.services.courses.courses import AuthorWithRole, UserRead
    
    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)  # type: ignore
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
        .order_by(ResourceAuthor.id.asc())  # type: ignore
    )
    author_results = db_session.exec(authors_statement).all()
    
    # Convert to AuthorWithRole objects
    authors = [
        AuthorWithRole(
            user=UserRead.model_validate(user),
            authorship=resource_author.authorship,
            authorship_status=resource_author.authorship_status,
            creation_date=resource_author.creation_date,
            update_date=resource_author.update_date
        )
        for resource_author, user in author_results
    ]
    
    course = CourseRead(**course.model_dump(), authors=authors)

    # Get the Organization
    statement = select(Organization).where(Organization.id == course.org_id)
    org = db_session.exec(statement).first()

    if not org or org.id is None:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # F-9: per-user + per-org rate limit before any compute / credit spend.
    # Resolve through helper so API tokens bucket under their creator rather
    # than all sharing user_id=0.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(resolve_acting_user_id(current_user), org.id)

    # Reserve credit atomically before the AI call; refund below on failure.
    reserve_ai_credit(org.id, db_session)

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    # Get Activity Content Blocks
    content = activity.content

    # Serialize Activity Content Blocks to a text comprehensible by the AI
    structured = structure_activity_content_by_type(content)

    isEmpty = structured == []

    ai_friendly_text = serialize_activity_text_to_ai_comprehensible_text(
        structured, course, activity, isActivityEmpty=isEmpty
    )

    # Get Activity Organization
    statement = select(Organization).where(Organization.id == course.org_id)
    org = db_session.exec(statement).first()

    # Get Organization Config
    statement = select(OrganizationConfig).where(
        OrganizationConfig.org_id == org.id  # type: ignore
    )
    result = db_session.exec(statement)
    org_config = result.first()

    org_config = OrganizationConfig.model_validate(org_config)

    # Use Gemini 2.5 Flash as the default model
    ai_model = "gemini-2.5-flash"

    chat_session = get_chat_session_history()

    message = "You are a helpful Education Assistant, and you are helping a student with the associated Course. "
    message += "Use the course content provided to answer questions about the course material."
    message += "For context, this is the Course name: "
    message += course.name
    message += " and this is the Lecture name: "
    message += activity.name
    message += "."
    message += "Use your knowledge to help the student if the context is not enough."

    try:
        response = ask_ai(
            chat_session_object.message,
            chat_session["message_history"],
            ai_friendly_text,
            message,
            ai_model,
        )
    except Exception as e:
        # Refund the credit we reserved up-front since the AI call failed.
        refund_ai_credit(org.id)
        logger.error("AI service error in ai_start_activity_chat_session: %s", e)
        raise HTTPException(status_code=503, detail={"code": "AI_UNAVAILABLE", "message": "AI service is temporarily unavailable"})

    # Save the message exchange to history
    save_message_to_history(
        chat_session["aichat_uuid"],
        chat_session_object.message,
        response["output"]
    )

    return ActivityAIChatSessionResponse(
        aichat_uuid=chat_session["aichat_uuid"],
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
    Send a message in an existing AI Chat session with a Course Activity
    """
    # Get the Activity
    statement = select(Activity).where(
        Activity.activity_uuid == chat_session_object.activity_uuid
    )
    activity = db_session.exec(statement).first()

    activity = ActivityRead.model_validate(activity)

    # Get the Course with authors
    statement = (
        select(Course)
        .join(Activity)
        .where(Activity.activity_uuid == chat_session_object.activity_uuid)
    )
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Get course authors
    from src.db.resource_authors import ResourceAuthor
    from src.db.users import User
    from src.services.courses.courses import AuthorWithRole, UserRead

    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)  # type: ignore
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
        .order_by(ResourceAuthor.id.asc())  # type: ignore
    )
    author_results = db_session.exec(authors_statement).all()

    # Convert to AuthorWithRole objects
    authors = [
        AuthorWithRole(
            user=UserRead.model_validate(user),
            authorship=resource_author.authorship,
            authorship_status=resource_author.authorship_status,
            creation_date=resource_author.creation_date,
            update_date=resource_author.update_date
        )
        for resource_author, user in author_results
    ]

    course = CourseRead(**course.model_dump(), authors=authors)

    # Get the Organization
    statement = select(Organization).where(Organization.id == course.org_id)
    org = db_session.exec(statement).first()

    # F-9: per-user + per-org rate limit before any compute / credit spend.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(resolve_acting_user_id(current_user), course.org_id)

    # Reserve credit atomically before the AI call; refund below on failure.
    reserve_ai_credit(course.org_id, db_session)

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

    # Get Activity Organization
    statement = select(Organization).where(Organization.id == course.org_id)
    org = db_session.exec(statement).first()

    # Get Organization Config
    statement = select(OrganizationConfig).where(
        OrganizationConfig.org_id == org.id  # type: ignore
    )
    result = db_session.exec(statement)
    org_config = result.first()

    org_config = OrganizationConfig.model_validate(org_config)

    # Use Gemini 2.5 Flash as the default model
    ai_model = "gemini-2.5-flash"

    chat_session = get_chat_session_history(chat_session_object.aichat_uuid)

    message = "You are a helpful Education Assistant, and you are helping a student with the associated Course. "
    message += "Use the course content provided to answer questions about the course material."
    message += "For context, this is the Course name: "
    message += course.name
    message += " and this is the Lecture name: "
    message += activity.name
    message += "."
    message += "Use your knowledge to help the student if the context is not enough."

    try:
        response = ask_ai(
            chat_session_object.message,
            chat_session["message_history"],
            ai_friendly_text,
            message,
            ai_model,
        )
    except Exception as e:
        # Refund the credit we reserved up-front since the AI call failed.
        refund_ai_credit(course.org_id)
        logger.error("AI service error in ai_send_activity_chat_message: %s", e)
        raise HTTPException(status_code=503, detail={"code": "AI_UNAVAILABLE", "message": "AI service is temporarily unavailable"})

    # Save the message exchange to history
    save_message_to_history(
        chat_session["aichat_uuid"],
        chat_session_object.message,
        response["output"]
    )

    return ActivityAIChatSessionResponse(
        aichat_uuid=chat_session["aichat_uuid"],
        activity_uuid=activity.activity_uuid,
        message=response["output"],
    )


def _get_activity_and_course_info(
    activity_uuid: str,
    db_session: Session,
) -> Tuple[ActivityRead, CourseRead, Organization, str, str]:
    """
    Helper function to get activity, course, and organization info with AI model.
    Returns: (activity, course, org, ai_model, ai_friendly_text)
    """
    # Get the Activity
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    activity = ActivityRead.model_validate(activity)

    # Get the Course with authors
    statement = (
        select(Course)
        .join(Activity)
        .where(Activity.activity_uuid == activity_uuid)
    )
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Get course authors
    from src.db.resource_authors import ResourceAuthor
    from src.db.users import User
    from src.services.courses.courses import AuthorWithRole, UserRead

    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)  # type: ignore
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
        .order_by(ResourceAuthor.id.asc())  # type: ignore
    )
    author_results = db_session.exec(authors_statement).all()

    # Convert to AuthorWithRole objects
    authors = [
        AuthorWithRole(
            user=UserRead.model_validate(user),
            authorship=resource_author.authorship,
            authorship_status=resource_author.authorship_status,
            creation_date=resource_author.creation_date,
            update_date=resource_author.update_date
        )
        for resource_author, user in author_results
    ]

    course = CourseRead(**course.model_dump(), authors=authors)

    # Get the Organization
    statement = select(Organization).where(Organization.id == course.org_id)
    org = db_session.exec(statement).first()

    if not org or org.id is None:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # Get Activity Content Blocks
    content = activity.content

    # Serialize Activity Content Blocks to a text comprehensible by the AI
    structured = structure_activity_content_by_type(content)
    isEmpty = structured == []
    ai_friendly_text = serialize_activity_text_to_ai_comprehensible_text(
        structured, course, activity, isActivityEmpty=isEmpty
    )

    # Get Organization Config
    statement = select(OrganizationConfig).where(
        OrganizationConfig.org_id == org.id  # type: ignore
    )
    result = db_session.exec(statement)
    org_config = result.first()

    org_config = OrganizationConfig.model_validate(org_config)

    # Use Gemini 2.5 Flash as the default model
    ai_model = "gemini-2.5-flash"

    return activity, course, org, ai_model, ai_friendly_text


async def ai_start_activity_chat_session_stream(
    request: Request,
    chat_session_object: StartActivityAIChatSession,
    current_user: PublicUser,
    db_session: Session,
) -> Dict[str, Any]:
    """
    Start a new AI Chat session with streaming response.
    Returns context needed for streaming.
    """
    activity, course, org, ai_model, ai_friendly_text = _get_activity_and_course_info(
        chat_session_object.activity_uuid, db_session
    )

    # F-9: per-user + per-org rate limit before any compute / credit spend.
    # Resolve through helper so API tokens bucket under their creator rather
    # than all sharing user_id=0.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(resolve_acting_user_id(current_user), org.id)

    # Atomic credit reservation to prevent concurrent over-use.
    reserve_ai_credit(org.id, db_session)

    chat_session = get_chat_session_history()

    message = "You are a helpful Education Assistant, and you are helping a student with the associated Course. "
    message += "Use the course content provided to answer questions about the course material."
    message += "For context, this is the Course name: "
    message += course.name
    message += " and this is the Lecture name: "
    message += activity.name
    message += "."
    message += "Use your knowledge to help the student if the context is not enough."

    return {
        "chat_session": chat_session,
        "activity": activity,
        "course": course,
        "ai_model": ai_model,
        "ai_friendly_text": ai_friendly_text,
        "message": message,
        "user_message": chat_session_object.message,
    }


async def ai_send_activity_chat_message_stream(
    request: Request,
    chat_session_object: SendActivityAIChatMessage,
    current_user: PublicUser,
    db_session: Session,
) -> Dict[str, Any]:
    """
    Send a message in an existing AI Chat session with streaming response.
    Returns context needed for streaming.
    """
    activity, course, org, ai_model, ai_friendly_text = _get_activity_and_course_info(
        chat_session_object.activity_uuid, db_session
    )

    # F-9: per-user + per-org rate limit before any compute / credit spend.
    # Resolve through helper so API tokens bucket under their creator rather
    # than all sharing user_id=0.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(resolve_acting_user_id(current_user), org.id)

    # Atomic credit reservation to prevent concurrent over-use.
    reserve_ai_credit(org.id, db_session)

    chat_session = get_chat_session_history(chat_session_object.aichat_uuid)

    message = "You are a helpful Education Assistant, and you are helping a student with the associated Course. "
    message += "Use the course content provided to answer questions about the course material."
    message += "For context, this is the Course name: "
    message += course.name
    message += " and this is the Lecture name: "
    message += activity.name
    message += "."
    message += "Use your knowledge to help the student if the context is not enough."

    return {
        "chat_session": chat_session,
        "activity": activity,
        "course": course,
        "ai_model": ai_model,
        "ai_friendly_text": ai_friendly_text,
        "message": message,
        "user_message": chat_session_object.message,
    }
