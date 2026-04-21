from typing import Dict, Any
from fastapi import HTTPException
from sqlmodel import Session, select

from src.db.organizations import Organization
from src.security.features_utils.usage import reserve_ai_credit
from src.db.courses.courses import Course, CourseRead
from src.db.users import PublicUser
from src.db.courses.activities import Activity, ActivityRead
from src.services.ai.base import get_chat_session_history
from src.services.ai.schemas.editor import (
    StartEditorAIChatSession,
    SendEditorAIChatMessage,
    EDITOR_AI_SYSTEM_PROMPT,
)


def _serialize_tiptap_content_to_text(content: Any) -> str:
    """
    Convert TipTap JSON content to a plain text representation for AI context.
    """
    if not content:
        return ""

    text_parts = []

    def extract_text(node: Any) -> None:
        if isinstance(node, dict):
            node_type = node.get('type', '')

            # Handle text nodes
            if node_type == 'text':
                text_parts.append(node.get('text', ''))
                return

            # Handle heading nodes - add level indicator
            if node_type == 'heading':
                level = node.get('attrs', {}).get('level', 1)
                text_parts.append(f"\n{'#' * level} ")

            # Handle list items
            if node_type == 'listItem':
                text_parts.append("\n- ")

            # Handle callouts
            if node_type in ['calloutInfo', 'calloutWarning']:
                text_parts.append(f"\n[{node_type.replace('callout', '').upper()}] ")

            # Handle blockquotes
            if node_type == 'blockquote':
                text_parts.append("\n> ")

            # Handle code blocks
            if node_type == 'codeBlock':
                lang = node.get('attrs', {}).get('language', '')
                text_parts.append(f"\n```{lang}\n")

            # Handle paragraphs
            if node_type == 'paragraph':
                text_parts.append("\n")

            # Handle quiz blocks
            if node_type == 'blockQuiz':
                questions = node.get('attrs', {}).get('questions', [])
                for q in questions:
                    text_parts.append(f"\n[QUIZ] {q.get('question', '')}")
                    for a in q.get('answers', []):
                        marker = '(correct)' if a.get('isCorrect') else ''
                        text_parts.append(f"\n  - {a.get('text', '')} {marker}")
                return

            # Handle flipcards
            if node_type == 'flipcard':
                attrs = node.get('attrs', {})
                text_parts.append(f"\n[FLIPCARD]\nQ: {attrs.get('question', '')}\nA: {attrs.get('answer', '')}")
                return

            # Recursively process content
            content = node.get('content', [])
            if isinstance(content, list):
                for child in content:
                    extract_text(child)

            # Close code blocks
            if node_type == 'codeBlock':
                text_parts.append("\n```")

        elif isinstance(node, list):
            for item in node:
                extract_text(item)

    # Process the content
    if isinstance(content, dict):
        content_array = content.get('content', [])
        extract_text(content_array)
    elif isinstance(content, list):
        extract_text(content)

    return ''.join(text_parts).strip()


async def editor_ai_start_chat_session_stream(
    chat_session_object: StartEditorAIChatSession,
    current_user: PublicUser,
    db_session: Session,
) -> Dict[str, Any]:
    """
    Start a new AI Editor chat session with streaming response.
    Returns context needed for streaming.
    """
    # Get the Activity
    statement = select(Activity).where(
        Activity.activity_uuid == chat_session_object.activity_uuid
    )
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    activity = ActivityRead.model_validate(activity)

    # Get the Course
    statement = (
        select(Course)
        .join(Activity)
        .where(Activity.activity_uuid == chat_session_object.activity_uuid)
    )
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

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
        raise HTTPException(status_code=404, detail="Organization not found")

    # F-9: per-user + per-org rate limit before any compute / credit spend.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(current_user.id, org.id)

    # Atomic credit reservation to prevent concurrent over-use.
    reserve_ai_credit(org.id, db_session)

    # Serialize current content to text for AI context
    content_text = _serialize_tiptap_content_to_text(chat_session_object.current_content)

    # Build context with selected text if provided
    context_parts = [
        f"Course: {course.name}",
        f"Lecture: {activity.name}",
        f"\nCurrent Editor Content:\n{content_text[:4000]}"  # Limit content size
    ]

    if chat_session_object.selected_text:
        context_parts.append(f"\n\nUser has selected this text (your content will REPLACE this selection): \"{chat_session_object.selected_text}\"")
    else:
        context_parts.append("\n\nNo text is selected. Your content will be INSERTED at the cursor position.")

    ai_friendly_text = "\n".join(context_parts)

    chat_session = get_chat_session_history()

    # Use Gemini 2.5 Flash as the default model
    ai_model = "gemini-2.5-flash"

    return {
        "chat_session": chat_session,
        "activity": activity,
        "course": course,
        "ai_model": ai_model,
        "ai_friendly_text": ai_friendly_text,
        "system_prompt": EDITOR_AI_SYSTEM_PROMPT,
        "user_message": chat_session_object.message,
        "current_content": chat_session_object.current_content,
        "selected_text": chat_session_object.selected_text,
    }


async def editor_ai_send_message_stream(
    chat_session_object: SendEditorAIChatMessage,
    current_user: PublicUser,
    db_session: Session,
) -> Dict[str, Any]:
    """
    Send a message in an existing AI Editor chat session with streaming response.
    Returns context needed for streaming.
    """
    # Get the Activity
    statement = select(Activity).where(
        Activity.activity_uuid == chat_session_object.activity_uuid
    )
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    activity = ActivityRead.model_validate(activity)

    # Get the Course
    statement = (
        select(Course)
        .join(Activity)
        .where(Activity.activity_uuid == chat_session_object.activity_uuid)
    )
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

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
        raise HTTPException(status_code=404, detail="Organization not found")

    # F-9: per-user + per-org rate limit before any compute / credit spend.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(current_user.id, org.id)

    # Atomic credit reservation to prevent concurrent over-use.
    reserve_ai_credit(org.id, db_session)

    # Serialize current content to text for AI context
    content_text = _serialize_tiptap_content_to_text(chat_session_object.current_content)

    # Build context with selected text if provided
    context_parts = [
        f"Course: {course.name}",
        f"Lecture: {activity.name}",
        f"\nCurrent Editor Content:\n{content_text[:4000]}"  # Limit content size
    ]

    if chat_session_object.selected_text:
        context_parts.append(f"\n\nUser has selected this text (your content will REPLACE this selection): \"{chat_session_object.selected_text}\"")
    else:
        context_parts.append("\n\nNo text is selected. Your content will be INSERTED at the cursor position.")

    ai_friendly_text = "\n".join(context_parts)

    chat_session = get_chat_session_history(chat_session_object.aichat_uuid)

    # Use Gemini 2.5 Flash as the default model
    ai_model = "gemini-2.5-flash"

    return {
        "chat_session": chat_session,
        "activity": activity,
        "course": course,
        "ai_model": ai_model,
        "ai_friendly_text": ai_friendly_text,
        "system_prompt": EDITOR_AI_SYSTEM_PROMPT,
        "user_message": chat_session_object.message,
        "current_content": chat_session_object.current_content,
        "selected_text": chat_session_object.selected_text,
    }
