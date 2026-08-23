from typing import Dict, Any, Optional
from fastapi import HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import Organization
from src.security.features_utils.usage import reserve_ai_credit
from src.db.courses.courses import Course, CourseRead
from src.db.users import PublicUser
from src.security.auth import resolve_acting_user_id
from src.security.org_auth import enforce_org_mfa, is_org_member
from src.security.rbac import check_resource_access, AccessAction
from src.db.courses.activities import Activity, ActivityRead
from src.services.ai.base import get_chat_session_history
from src.services.ai.llm import model_for_tier
from src.services.ai.schemas.editor import (
    StartEditorAIChatSession,
    SendEditorAIChatMessage,
    EDITOR_AI_SYSTEM_PROMPT,
)


# ProseMirror only defines heading levels 1-6.
MAX_HEADING_LEVEL = 6


def _safe_heading_level(attrs: Any) -> int:
    """Clamp a client-supplied heading level to the ProseMirror range.

    ``level`` is used as a string repeat count, so an unbounded (or negative,
    or non-integer) value straight out of the request body would either ask for
    a multi-gigabyte allocation or raise. Anything that isn't a real int falls
    back to 1.
    """
    if not isinstance(attrs, dict):
        return 1
    level = attrs.get('level', 1)
    if isinstance(level, bool) or not isinstance(level, int):
        return 1
    return max(1, min(level, MAX_HEADING_LEVEL))


def _node_attrs(node: Any) -> dict:
    """Read a node's ``attrs`` defensively — the document is free-form JSON."""
    attrs = node.get('attrs') if isinstance(node, dict) else None
    return attrs if isinstance(attrs, dict) else {}


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
                level = _safe_heading_level(node.get('attrs'))
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
                lang = _node_attrs(node).get('language', '')
                text_parts.append(f"\n```{lang}\n")

            # Handle paragraphs
            if node_type == 'paragraph':
                text_parts.append("\n")

            # Handle quiz blocks
            if node_type == 'blockQuiz':
                questions = _node_attrs(node).get('questions', [])
                for q in questions if isinstance(questions, list) else []:
                    if not isinstance(q, dict):
                        continue
                    text_parts.append(f"\n[QUIZ] {q.get('question', '')}")
                    answers = q.get('answers', [])
                    for a in answers if isinstance(answers, list) else []:
                        if not isinstance(a, dict):
                            continue
                        # TipTap quiz answers use 'answer'/'correct' (see Quiz block schema);
                        # accept legacy 'text'/'isCorrect' as a fallback.
                        marker = '(correct)' if (a.get('correct') or a.get('isCorrect')) else ''
                        answer_text = a.get('answer', '') or a.get('text', '')
                        text_parts.append(f"\n  - {answer_text} {marker}")
                return

            # Handle flipcards
            if node_type == 'flipcard':
                attrs = _node_attrs(node)
                text_parts.append(f"\n[FLIPCARD]\nQ: {attrs.get('question', '')}\nA: {attrs.get('answer', '')}")
                return

            # A library block only references an asset; name it so the model has
            # something to reason about instead of an empty node.
            if node_type == 'blockLibrary':
                attrs = _node_attrs(node)
                snapshot = attrs.get('snapshot') or {}
                if not isinstance(snapshot, dict):
                    snapshot = {}
                name = snapshot.get('name') or attrs.get('resourceUuid', '')
                kind = attrs.get('resourceType', 'resource')
                text_parts.append(f"\n[LIBRARY {str(kind).upper()}] {name}")
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


async def _authorize_editor_ai_access(
    course: CourseRead,
    org_id: int,
    current_user: PublicUser,
    db_session: AsyncSession,
    request: Optional[Request] = None,
) -> None:
    """Gate editor AI on the organization owning the client-supplied activity.

    Without it an outsider can point the endpoint at any activity, drain that
    org's AI credits and read back its course/activity names. Runs before rate
    limiting and credit reservation, mirroring the MagicBlocks gate. When a
    Request is available we also check course-level write rights, since using
    the editor assistant is an authoring action.
    """
    acting_user_id = resolve_acting_user_id(current_user)
    if not await is_org_member(acting_user_id, org_id, db_session):
        raise HTTPException(
            status_code=403,
            detail="You are not a member of this organization",
        )
    await enforce_org_mfa(acting_user_id, org_id, db_session)
    if request is not None:
        await check_resource_access(
            request, db_session, current_user, course.course_uuid, AccessAction.UPDATE
        )


async def editor_ai_start_chat_session_stream(
    chat_session_object: StartEditorAIChatSession,
    current_user: PublicUser,
    db_session: AsyncSession,
    request: Optional[Request] = None,
) -> Dict[str, Any]:
    """
    Start a new AI Editor chat session with streaming response.
    Returns context needed for streaming.
    """
    # Get the Activity
    statement = select(Activity).where(
        Activity.activity_uuid == chat_session_object.activity_uuid
    )
    activity = (await db_session.execute(statement)).scalars().first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    activity = ActivityRead.model_validate(activity)

    # Get the Course
    statement = (
        select(Course)
        .join(Activity)
        .where(Activity.activity_uuid == chat_session_object.activity_uuid)
    )
    course = (await db_session.execute(statement)).scalars().first()

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
    author_results = (await db_session.execute(authors_statement)).all()

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
    org = (await db_session.execute(statement)).scalars().first()

    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    # F32: authorize the caller against the owning org before any spend.
    await _authorize_editor_ai_access(
        course, org.id, current_user, db_session, request
    )

    # F-9: per-user + per-org rate limit before any compute / credit spend.
    # Resolve through helper so API tokens bucket under their creator rather
    # than all sharing user_id=0.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(resolve_acting_user_id(current_user), org.id)

    # Atomic credit reservation to prevent concurrent over-use.
    await reserve_ai_credit(org.id, db_session)

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

    # Default editor model (provider-agnostic; resolved from AI config)
    ai_model = model_for_tier("standard")

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
    db_session: AsyncSession,
    request: Optional[Request] = None,
) -> Dict[str, Any]:
    """
    Send a message in an existing AI Editor chat session with streaming response.
    Returns context needed for streaming.
    """
    # Get the Activity
    statement = select(Activity).where(
        Activity.activity_uuid == chat_session_object.activity_uuid
    )
    activity = (await db_session.execute(statement)).scalars().first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    activity = ActivityRead.model_validate(activity)

    # Get the Course
    statement = (
        select(Course)
        .join(Activity)
        .where(Activity.activity_uuid == chat_session_object.activity_uuid)
    )
    course = (await db_session.execute(statement)).scalars().first()

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
    author_results = (await db_session.execute(authors_statement)).all()

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
    org = (await db_session.execute(statement)).scalars().first()

    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    # F32: authorize the caller against the owning org before any spend.
    await _authorize_editor_ai_access(
        course, org.id, current_user, db_session, request
    )

    # F-9: per-user + per-org rate limit before any compute / credit spend.
    # Resolve through helper so API tokens bucket under their creator rather
    # than all sharing user_id=0.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(resolve_acting_user_id(current_user), org.id)

    # Atomic credit reservation to prevent concurrent over-use.
    await reserve_ai_credit(org.id, db_session)

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

    # Default editor model (provider-agnostic; resolved from AI config)
    ai_model = model_for_tier("standard")

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
