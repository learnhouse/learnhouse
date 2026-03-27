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
    return os.path.exists("ee")

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

def is_multi_org_allowed() -> bool:
    """Check if multi-org mode is allowed (requires EE or SaaS)."""
    from src.core.deployment_mode import get_deployment_mode
    mode = get_deployment_mode()
    return mode in ('ee', 'saas')


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

