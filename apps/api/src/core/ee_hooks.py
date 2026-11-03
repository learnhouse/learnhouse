import logging
import importlib.util
import os

logger = logging.getLogger(__name__)

def is_ee_available():
    """
    Check if the Enterprise Edition code is present on disk and not disabled.

    NOTE: This does NOT indicate the deployment mode is 'ee'.
    SaaS deployments also ship with the EE folder present.
    Use get_deployment_mode() from src.core.deployment_mode to determine the actual mode.
    """
    if os.environ.get("LEARNHOUSE_DISABLE_EE") == "1":
        return False
    # Require the hooks module itself, not merely a directory named "ee":
    # a directory without it imports nothing, so it is not an EE install.
    return os.path.isdir("ee") and os.path.isfile(os.path.join("ee", "hooks.py"))

def get_ee_hooks():
    """Safely import and return the EE hooks module if available."""
    if not is_ee_available():
        return None
    
    try:
        # We use importlib to avoid hardcoded top-level imports that might 
        # fail during linting or when the folder is missing.
        spec = importlib.util.find_spec("ee.hooks")
        if spec is None:
            return None
        
        module = importlib.import_module("ee.hooks")
        return module
    except ImportError as e:
        logger.error(f"Failed to import EE hooks: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error loading EE hooks: {e}")
        return None

def register_ee_middlewares(app):
    """Call EE to register its middlewares."""
    from config.config import get_learnhouse_config
    if get_learnhouse_config().general_config.saas_mode:
        return
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "register_middlewares"):
        hooks.register_middlewares(app)

def register_ee_routers(v1_router):
    """Call EE to register its routers."""
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "register_routers"):
        hooks.register_routers(v1_router)

def run_ee_startup(app):
    """Call EE to run its startup tasks."""
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "on_startup"):
        hooks.on_startup(app)

def register_ee_rag_sources():
    """Let EE register extractors for its own content types (e.g. SCORM) with
    the AI search source registry."""
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "register_rag_sources"):
        try:
            hooks.register_rag_sources()
        except Exception as e:
            logger.error(f"Failed to register EE AI search sources: {e}")

def register_ee_calendar_sources():
    """Let EE add its own dated things (e.g. live sessions) to the user
    calendar's source registry."""
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "register_calendar_sources"):
        try:
            hooks.register_calendar_sources()
        except Exception as e:
            logger.error(f"Failed to register EE calendar sources: {e}")

def is_multi_org_allowed() -> bool:
    """Check if multi-org mode is allowed (requires EE or SaaS)."""
    from src.core.deployment_mode import get_deployment_mode
    mode = get_deployment_mode()
    return mode in ('ee', 'saas')


async def check_ee_live_board_access(board_id, user_id, db_session) -> bool:
    """True when EE lets the user edit a board because they are in the room of
    a live session that uses it. Always False without EE."""
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "has_live_board_access"):
        try:
            return await hooks.has_live_board_access(board_id, user_id, db_session)
        except Exception as e:
            logger.error(f"EE live board access check failed: {e}")
    return False


async def check_ee_activity_paid_access(request, activity_id, user, db_session) -> bool:
    """
    Check if a user has paid access to an activity via EE.
    Returns True if EE is not available (free access fallback).
    """
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "check_activity_paid_access"):
        return await hooks.check_activity_paid_access(request, activity_id, user, db_session)
    # If EE is not available, grant access (free tier behavior)
    return True



async def require_ee_resource_paid_access(request, db_session, current_user, resource_uuid: str) -> None:
    """Raise 402 when a resource's content is sold through an offer and the
    caller has not bought it. A no-op without EE (nothing can be sold).

    Call it where content is read (posts, episodes, a board, a playground), not
    where a resource's name and description are, so its page can still show
    what is for sale. API tokens act for the org itself and are never paywalled.
    """
    from src.db.users import AnonymousUser, PublicUser

    if not isinstance(current_user, (PublicUser, AnonymousUser)):
        return
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "require_resource_paid_access"):
        await hooks.require_resource_paid_access(request, resource_uuid, current_user, db_session)


async def is_ee_resource_locked(request, db_session, current_user, resource_uuid: str) -> bool:
    """Whether the caller would get a 402 reading this resource's content."""
    from fastapi import HTTPException

    try:
        await require_ee_resource_paid_access(request, db_session, current_user, resource_uuid)
    except HTTPException as e:
        if e.status_code == 402:
            return True
        raise
    return False


async def get_ee_paid_locked_activity_ids(request, course_id: int, user, db_session) -> set | None:
    """Ids of a course's lessons the caller has not bought. None without EE, or
    on an EE without per-lesson selling (callers then fall back to the
    course-wide check)."""
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "paid_locked_activity_ids"):
        return await hooks.paid_locked_activity_ids(request, course_id, user, db_session)
    return None


def notify_ee_course_content_changed(course_id: int) -> None:
    """Tell EE a course's content changed (title, activities, publication,
    assignment due dates) so LTI can update the LMS gradebook columns placed
    from it. Fire-and-forget, like notify_ee_learner_progress."""
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "on_course_content_changed"):
        try:
            hooks.on_course_content_changed(course_id)
        except Exception:
            logger.exception("EE course-content hook failed")


def notify_ee_learner_progress(user_id: int, course_id: int) -> None:
    """Tell EE a learner's progress in a course changed (e.g. so LTI can push
    the new score to the LMS gradebook). Fire-and-forget: EE schedules its own
    background work and failures never reach the caller."""
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "on_learner_progress"):
        try:
            hooks.on_learner_progress(user_id, course_id)
        except Exception:
            logger.exception("EE learner-progress hook failed")
