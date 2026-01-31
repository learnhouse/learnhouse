import json
import logging
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from src.db.organizations import Organization
from src.db.courses.courses import Course
from src.db.courses.chapters import Chapter
from src.db.courses.activities import Activity, ActivityTypeEnum, ActivitySubTypeEnum
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.chapter_activities import ChapterActivity
from src.db.user_organizations import UserOrganization
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.security.features_utils.usage import (
    check_ai_credits,
    deduct_ai_credit,
)
from src.security.features_utils.plan_check import get_org_plan
from src.security.features_utils.plans import plan_meets_requirement
from src.services.ai.courseplanning import (
    get_course_planning_session,
    create_course_planning_session,
    save_course_planning_session,
    generate_course_plan_stream,
    generate_activity_content_stream,
    MAX_PLANNING_ITERATIONS,
    MAX_ACTIVITY_ITERATIONS,
    ENABLE_ACTIVITY_CONTENT_GENERATION,
)
from src.services.ai.schemas.courseplanning import (
    StartCoursePlanningSession,
    SendCoursePlanningMessage,
    FinalizeCoursePlanRequest,
    GenerateActivityContentRequest,
    SaveActivityContentRequest,
    CoursePlanningSessionResponse,
    FinalizeCoursePlanResponse,
    CoursePlanningMessage,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def event_generator(generator, session_uuid: str):
    """Convert async generator to SSE format"""
    try:
        async for chunk in generator:
            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'session_uuid': session_uuid})}\n\n"
    except Exception:
        logger.exception("Error in event_generator for session %s", session_uuid)
        yield f"data: {json.dumps({'type': 'error', 'message': 'An internal error occurred while generating the stream.'})}\n\n"


async def event_generator_with_save(generator, session_uuid: str, activity_uuid: str):
    """Convert async generator to SSE format.
    Note: Content saving is handled by the dedicated /save-activity-content endpoint
    called from the frontend after parsing the stream."""
    try:
        async for chunk in generator:
            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"

        # Content is saved via the dedicated save endpoint called from frontend
        logger.info(f"[AI Content] Streaming complete for activity {activity_uuid}, content will be saved via explicit API call")
        yield f"data: {json.dumps({'type': 'done', 'session_uuid': session_uuid})}\n\n"
    except Exception:
        logger.exception("Error in event_generator_with_save for activity %s", activity_uuid)
        yield f"data: {json.dumps({'type': 'error', 'message': 'An internal error occurred while generating activity content.'})}\n\n"


def get_org_ai_model(org_id: int, db_session: Session) -> str:
    """Get the AI model based on the organization's plan."""
    try:
        current_plan = get_org_plan(org_id, db_session)
        if plan_meets_requirement(current_plan, "pro"):
            return "gemini-2.5-pro"
        return "gemini-2.5-flash"
    except Exception:
        return "gemini-2.5-flash"


async def verify_user_org_membership(user_id: int, org_id: int, db_session: Session) -> bool:
    """Verify that the user is a member of the organization"""
    statement = select(UserOrganization).where(
        UserOrganization.user_id == user_id,
        UserOrganization.org_id == org_id
    )
    membership = db_session.exec(statement).first()
    return membership is not None


@router.post("/courseplanning/start")
async def start_course_planning_session(
    request: Request,
    session_request: StartCoursePlanningSession,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Start a new course planning AI session with streaming response.
    Returns Server-Sent Events (SSE) stream.
    """
    # Validate organization exists
    statement = select(Organization).where(Organization.id == session_request.org_id)
    org = db_session.exec(statement).first()

    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Verify user is a member of the organization
    if not await verify_user_org_membership(current_user.id, org.id, db_session):
        raise HTTPException(status_code=403, detail="User is not a member of this organization")

    # Check limits and usage
    check_ai_credits(org.id, db_session)
    deduct_ai_credit(org.id, db_session)

    # Get AI model
    ai_model = get_org_ai_model(org.id, db_session)

    # Create new session with language
    session = create_course_planning_session(org_id=org.id, language=session_request.language)

    # Generate with streaming (include attachments if provided)
    stream = generate_course_plan_stream(
        prompt=session_request.prompt,
        session=session,
        gemini_model_name=ai_model,
        attachments=session_request.attachments
    )

    return StreamingResponse(
        event_generator(stream, session.session_uuid),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post("/courseplanning/iterate")
async def iterate_course_planning_session(
    request: Request,
    message_request: SendCoursePlanningMessage,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Continue an existing course planning session with a new message.
    Returns Server-Sent Events (SSE) stream.
    """
    # Get existing session
    session = get_course_planning_session(message_request.session_uuid)

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Check iteration limit
    if session.planning_iteration_count >= session.max_planning_iterations:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum planning iterations ({MAX_PLANNING_ITERATIONS}) reached"
        )

    # Get the organization
    statement = select(Organization).where(Organization.id == session.org_id)
    org = db_session.exec(statement).first()

    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Verify user is a member of the organization
    if not await verify_user_org_membership(current_user.id, org.id, db_session):
        raise HTTPException(status_code=403, detail="User is not a member of this organization")

    # Check limits and usage
    check_ai_credits(org.id, db_session)
    deduct_ai_credit(org.id, db_session)

    # Get AI model
    ai_model = get_org_ai_model(org.id, db_session)

    # Use provided plan or session's current plan
    current_plan = message_request.current_plan or session.current_plan

    # Generate with streaming (include attachments if provided)
    stream = generate_course_plan_stream(
        prompt=message_request.message,
        session=session,
        gemini_model_name=ai_model,
        current_plan=current_plan,
        attachments=message_request.attachments
    )

    return StreamingResponse(
        event_generator(stream, session.session_uuid),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post("/courseplanning/finalize")
async def finalize_course_plan(
    request: Request,
    finalize_request: FinalizeCoursePlanRequest,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> FinalizeCoursePlanResponse:
    """
    Finalize the course plan and create the course structure in the database.
    Creates course, chapters, and activities.
    """
    # Get existing session
    session = get_course_planning_session(finalize_request.session_uuid)

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Check if already finalized
    if session.course_id is not None:
        raise HTTPException(status_code=400, detail="Course already created from this session")

    # Get the organization
    statement = select(Organization).where(Organization.id == session.org_id)
    org = db_session.exec(statement).first()

    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Verify user is a member of the organization
    if not await verify_user_org_membership(current_user.id, org.id, db_session):
        raise HTTPException(status_code=403, detail="User is not a member of this organization")

    plan = finalize_request.plan

    # Create the course
    course = Course(
        course_uuid=f"course_{uuid4()}",
        name=plan.name,
        description=plan.description,
        about=plan.description,
        learnings=plan.learnings,
        tags=plan.tags,
        public=False,  # Start as unpublished
        published=False,
        open_to_contributors=False,
        org_id=org.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)

    created_chapters = []

    # Create chapters and activities
    for chapter_index, chapter_plan in enumerate(plan.chapters):
        # Create chapter
        chapter = Chapter(
            chapter_uuid=f"chapter_{uuid4()}",
            name=chapter_plan.name,
            description=chapter_plan.description,
            course_id=course.id,
            org_id=org.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )

        db_session.add(chapter)
        db_session.commit()
        db_session.refresh(chapter)

        # Create course-chapter link
        course_chapter = CourseChapter(
            course_id=course.id,
            chapter_id=chapter.id,
            org_id=org.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
            order=chapter_index,
        )

        db_session.add(course_chapter)
        db_session.commit()

        created_activities = []

        # Create activities
        for activity_index, activity_plan in enumerate(chapter_plan.activities):
            activity = Activity(
                activity_uuid=f"activity_{uuid4()}",
                name=activity_plan.name,
                activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
                activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
                content={},  # Empty dict, content will be generated later
                details={"description": activity_plan.description},
                published=False,
                course_id=course.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )

            db_session.add(activity)
            db_session.commit()
            db_session.refresh(activity)

            # Create chapter-activity link
            chapter_activity = ChapterActivity(
                chapter_id=chapter.id,
                activity_id=activity.id,
                course_id=course.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
                order=activity_index,
            )

            db_session.add(chapter_activity)
            db_session.commit()

            created_activities.append({
                "activity_uuid": activity.activity_uuid,
                "activity_id": activity.id,
                "name": activity.name,
                "description": activity_plan.description,
                "suggested_blocks": activity_plan.suggested_blocks,
            })

        created_chapters.append({
            "chapter_uuid": chapter.chapter_uuid,
            "chapter_id": chapter.id,
            "name": chapter.name,
            "activities": created_activities,
        })

    # Update session with course_id
    session.course_id = course.id
    save_course_planning_session(session)

    return FinalizeCoursePlanResponse(
        course_uuid=course.course_uuid,
        course_id=course.id,  # type: ignore
        chapters=created_chapters,
    )


@router.post("/courseplanning/generate-activity")
async def generate_activity_content(
    request: Request,
    content_request: GenerateActivityContentRequest,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Generate content for a specific activity with streaming response.
    Returns Server-Sent Events (SSE) stream.
    """
    # Check if feature is enabled
    if not ENABLE_ACTIVITY_CONTENT_GENERATION:
        raise HTTPException(
            status_code=403,
            detail="Activity content generation is currently disabled"
        )

    # Get existing session
    session = get_course_planning_session(content_request.session_uuid)

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Check activity iteration limit
    activity_uuid = content_request.activity_uuid
    iteration_count = session.activity_iteration_counts.get(activity_uuid, 0)

    if iteration_count >= session.max_activity_iterations:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum activity iterations ({MAX_ACTIVITY_ITERATIONS}) reached"
        )

    # Validate activity exists
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Get the organization
    statement = select(Organization).where(Organization.id == session.org_id)
    org = db_session.exec(statement).first()

    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Verify user is a member of the organization
    if not await verify_user_org_membership(current_user.id, org.id, db_session):
        raise HTTPException(status_code=403, detail="User is not a member of this organization")

    # Check limits and usage
    check_ai_credits(org.id, db_session)
    deduct_ai_credit(org.id, db_session)

    # Get AI model
    ai_model = get_org_ai_model(org.id, db_session)

    # Get current content if iterating
    current_content = None
    if activity.content and iteration_count > 0:
        current_content = json.dumps(activity.content)

    # Generate with streaming
    stream = generate_activity_content_stream(
        session=session,
        activity_uuid=activity_uuid,
        activity_name=content_request.activity_name,
        activity_description=content_request.activity_description,
        chapter_name=content_request.chapter_name,
        course_name=content_request.course_name,
        course_description=content_request.course_description,
        gemini_model_name=ai_model,
        prompt=content_request.prompt,
        current_content=current_content
    )

    # Use event_generator_with_save to automatically save content to database when streaming completes
    return StreamingResponse(
        event_generator_with_save(stream, session.session_uuid, activity_uuid),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


def validate_prosemirror_content(content: dict) -> tuple[bool, str]:
    """Validate that content is a valid ProseMirror document structure."""
    if not isinstance(content, dict):
        return False, "Content must be a JSON object"

    if content.get("type") != "doc":
        return False, "Content must have 'type': 'doc' at root level"

    if "content" not in content:
        return False, "Content must have a 'content' array"

    if not isinstance(content["content"], list):
        return False, "Content 'content' field must be an array"

    # Valid ProseMirror block types used in the editor
    valid_block_types = {
        "paragraph", "heading", "bulletList", "orderedList", "listItem",
        "codeBlock", "blockQuiz", "flipcard", "calloutInfo", "calloutWarning",
        "blockEmbed", "blockImage", "blockVideo", "blockPDF", "blockMathEquation",
        "table", "tableRow", "tableCell", "tableHeader", "horizontalRule",
        "hardBreak", "text", "scenarios", "blockUser", "blockWebPreview", "button", "badge"
    }

    def check_node(node: dict, path: str = "root") -> tuple[bool, str]:
        if not isinstance(node, dict):
            return False, f"Node at {path} must be an object"

        node_type = node.get("type")
        if not node_type:
            return False, f"Node at {path} must have a 'type' field"

        if node_type not in valid_block_types and node_type != "doc":
            # Allow unknown types but log warning - editor may have new block types
            import logging
            logging.getLogger(__name__).warning(f"Unknown block type '{node_type}' at {path}")

        # Recursively check children
        if "content" in node and isinstance(node["content"], list):
            for i, child in enumerate(node["content"]):
                valid, msg = check_node(child, f"{path}.content[{i}]")
                if not valid:
                    return False, msg

        return True, ""

    # Validate each block in content array
    for i, block in enumerate(content["content"]):
        valid, msg = check_node(block, f"content[{i}]")
        if not valid:
            return False, msg

    return True, ""


@router.post("/courseplanning/save-activity-content")
async def save_activity_content(
    request: Request,
    save_request: SaveActivityContentRequest,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Save AI-generated content to an activity.
    Validates content structure before saving.
    """
    import logging
    logger = logging.getLogger(__name__)

    activity_uuid = save_request.activity_uuid
    content = save_request.content

    logger.info("[Save Activity Content] === START ===")
    logger.info(f"[Save Activity Content] Activity UUID: {activity_uuid}")
    logger.info(f"[Save Activity Content] Content type: {type(content)}")
    if isinstance(content, dict):
        logger.info(f"[Save Activity Content] Content keys: {list(content.keys())}")
        content_str = json.dumps(content)
        logger.info(f"[Save Activity Content] Content size: {len(content_str)} bytes")
        logger.info(f"[Save Activity Content] Content preview: {content_str[:500]}")

        # Validate ProseMirror structure
        is_valid, validation_error = validate_prosemirror_content(content)
        if not is_valid:
            logger.error(f"[Save Activity Content] Validation failed: {validation_error}")
            raise HTTPException(status_code=400, detail=f"Invalid content structure: {validation_error}")

    # Validate activity exists first
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        logger.error(f"[Save Activity Content] Activity not found: {activity_uuid}")
        raise HTTPException(status_code=404, detail="Activity not found")

    logger.info(f"[Save Activity Content] Found activity ID: {activity.id}, name: {activity.name}")
    logger.info(f"[Save Activity Content] Current content size: {len(json.dumps(activity.content)) if activity.content else 0} bytes")

    # Get organization for permission check
    statement = select(Organization).where(Organization.id == activity.org_id)
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Verify user is a member of the organization
    if not await verify_user_org_membership(current_user.id, org.id, db_session):
        raise HTTPException(status_code=403, detail="User is not a member of this organization")

    # Direct update using SQLAlchemy ORM
    try:
        # Update activity directly - ensure fresh reference
        logger.info("[Save Activity Content] Updating activity.content...")

        # Set content directly on the model
        activity.content = content
        activity.update_date = str(datetime.now())

        # Explicitly mark as modified to ensure SQLAlchemy tracks the change
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(activity, "content")

        # Add and commit
        db_session.add(activity)
        db_session.commit()

        logger.info("[Save Activity Content] Commit completed")

        # Verify by re-fetching with a fresh query
        db_session.expire_all()  # Clear any cached data
        statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
        verified_activity = db_session.exec(statement).first()

        if verified_activity and verified_activity.content:
            content_keys = list(verified_activity.content.keys()) if isinstance(verified_activity.content, dict) else 'N/A'
            content_size = len(json.dumps(verified_activity.content)) if verified_activity.content else 0
            logger.info(f"[Save Activity Content] Verified from DB - content keys: {content_keys}, size: {content_size} bytes")
        else:
            logger.warning("[Save Activity Content] Verification failed - content is empty!")
            logger.warning(f"[Save Activity Content] Verified activity content: {verified_activity.content if verified_activity else 'None'}")

        logger.info("[Save Activity Content] === SUCCESS ===")
        return {"success": True, "activity_uuid": activity_uuid}
    except Exception as e:
        logger.error("[Save Activity Content] === FAILED ===")
        logger.error(f"[Save Activity Content] Error: {e}")
        import traceback
        logger.error(f"[Save Activity Content] Traceback: {traceback.format_exc()}")
        db_session.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save content: {str(e)}")


@router.get("/courseplanning/session/{session_uuid}")
async def get_session_state(
    session_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CoursePlanningSessionResponse:
    """
    Get the current state of a course planning session.
    """
    session = get_course_planning_session(session_uuid)

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return CoursePlanningSessionResponse(
        session_uuid=session.session_uuid,
        planning_iteration_count=session.planning_iteration_count,
        max_planning_iterations=session.max_planning_iterations,
        current_plan=session.current_plan,
        message_history=[
            CoursePlanningMessage(role=msg.role, content=msg.content)
            for msg in session.message_history
        ],
        course_id=session.course_id,
    )
