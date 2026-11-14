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

def get_ee_module(name: str):
    """Import an EE module by dotted path (e.g. ``"ee.db.playgrounds"``), or
    None when EE is absent or disabled.

    For core code that touches an EE-owned feature (Plays, boards) in passing: search,
    folders, RBAC uuid lookups. Callers treat None as "the feature does not
    exist on this install" and carry on without it.
    """
    if not is_ee_available():
        return None
    try:
        return importlib.import_module(name)
    except ImportError as e:
        logger.error(f"Failed to import EE module {name}: {e}")
        return None


def register_ee_middlewares(app):
    """Call EE to register its middlewares."""
    from config.config import get_learnhouse_config
    hooks = get_ee_hooks()
    if get_learnhouse_config().general_config.saas_mode:
        if hooks and hasattr(hooks, "register_saas_middlewares"):
            hooks.register_saas_middlewares(app)
        return
    if hooks and hasattr(hooks, "register_middlewares"):
        hooks.register_middlewares(app)

def register_ee_routers(v1_router):
    """Call EE to register its routers."""
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "register_routers"):
        hooks.register_routers(v1_router)

def register_ee_platform_mcp(app):
    """Let EE mount the platform (superadmin) MCP server at /mcp/platform.
    Called only when MCP is enabled; nothing is mounted without EE."""
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "register_platform_mcp"):
        try:
            hooks.register_platform_mcp(app)
        except Exception as e:
            logger.error(f"Failed to mount the platform MCP server: {e}")

def run_ee_startup(app):
    """Call EE to run its startup tasks."""
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "on_startup"):
        hooks.on_startup(app)


async def run_ee_shutdown(app):
    """Let EE stop its background tasks and write what it still holds (e.g.
    queued analytics events). Never raises: shutdown carries on regardless."""
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "on_shutdown"):
        try:
            await hooks.on_shutdown(app)
        except Exception:
            logger.exception("EE shutdown hook failed")

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


async def get_ee_member_risk_reasons(org_id, user_id, db_session) -> list:
    """Extra at-risk reasons for the Users page member panel (EE: overdue
    required training), as `{code, params}` dicts. Empty without EE."""
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "member_risk_reasons"):
        try:
            return list(await hooks.member_risk_reasons(org_id, user_id, db_session))
        except Exception as e:
            logger.error(f"EE member risk reasons failed: {e}")
    return []


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
    # Progress can move someone in or out of a smart user group (enrolled,
    # completed, progress rules): queue a debounced sync of its org.
    from src.services.usergroups.sync import on_course_progress

    on_course_progress(course_id)
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "on_learner_progress"):
        try:
            hooks.on_learner_progress(user_id, course_id)
        except Exception:
            logger.exception("EE learner-progress hook failed")


async def sync_ee_signup_answers(
    org_id: int, user_id: int, db_session, *, actor=None, request=None
) -> dict | None:
    """Copy a member's signup answers to their people data, for the fields the
    org mapped to it (department, title, manager...). People data is an EE
    feature: without EE, or when it is off, this does nothing. Never raises:
    a profile that can't be written must not fail a signup."""
    hooks = get_ee_hooks()
    hook = getattr(hooks, "on_signup_answers", None) if hooks else None
    if hook is None:
        return None
    try:
        return await hook(org_id, user_id, db_session, actor=actor, request=request)
    except Exception:
        logger.exception("EE signup-answers hook failed (org %s, user %s)", org_id, user_id)
        return None


async def track_ee_analytics_event(**event) -> None:
    """Hand an analytics event (the arguments of
    ``src.services.analytics.analytics.track``) to EE, which stores it. Org
    analytics is an EE feature: without EE this does nothing."""
    hooks = get_ee_hooks()
    hook = getattr(hooks, "track_analytics_event", None) if hooks else None
    if hook is not None:
        await hook(**event)


async def get_ee_user_behavior(user_id: int, org_id: int, days: int) -> dict:
    """One member's behavioural analytics in an org (time per course, views,
    searches...), keyed by section, for the per-student audit. Comes from EE
    analytics; empty without EE."""
    hooks = get_ee_hooks()
    hook = getattr(hooks, "user_analytics_behavior", None) if hooks else None
    if hook is None:
        return {}
    return await hook(user_id, org_id, days)


def audit_event(request=None, *, action: str, org_id, **event) -> None:
    """Record a typed entry in the organization's audit log (an Enterprise
    feature): who did what to which target, the outcome, and for updates a
    field-level diff of ``before``/``after``.

    ``action`` is a dotted verb (``course.updated``, ``auth.login.failed``).
    Optional: ``actor`` (user, API token user or user id; defaults to the
    request's principal), ``target_type``/``target_id``/``target_name``,
    ``outcome`` (success, denied, failed), ``reason``, ``before``/``after``
    (dict snapshots), ``fields``, ``details``.

    Fire-and-forget: never raises, never waits, a no-op without EE. EE
    decides whether the org keeps a log and strips credentials.
    """
    hooks = get_ee_hooks()
    hook = getattr(hooks, "record_audit_event", None) if hooks else None
    if hook is None:
        return
    try:
        hook(request, action=action, org_id=org_id, **event)
    except Exception:
        logger.exception("EE audit hook failed for %s", action)


def audit_agent_action(**event) -> None:
    """Hand the record of one executed MCP tool call to the audit log, which
    merges it with the typed events the tool's services recorded. A no-op
    without EE."""
    hooks = get_ee_hooks()
    hook = getattr(hooks, "record_agent_audit", None) if hooks else None
    if hook is None:
        return
    try:
        hook(**event)
    except Exception:
        logger.exception("EE agent audit hook failed")


async def send_ee_usergroup_email(db_session, org_id: int, actor, user_ids: list, subject: str, text: str) -> dict | None:
    """Email a user group's members through the newsletter's individual-email
    path (EE: deliverability rules, suppression, sending limits). None
    without EE."""
    hooks = get_ee_hooks()
    hook = getattr(hooks, "send_usergroup_email", None) if hooks else None
    if hook is None:
        return None
    return await hook(db_session, org_id, actor, user_ids, subject, text)


async def send_ee_usergroup_digest(db_session, group) -> dict | None:
    """Email one group's progress digest to its managers who opted in (EE).
    None without EE."""
    hooks = get_ee_hooks()
    hook = getattr(hooks, "send_usergroup_digest", None) if hooks else None
    if hook is None:
        return None
    return await hook(db_session, group)


async def run_ee_usergroup_digests(db_session, now) -> int:
    """The weekly manager digests for every group (EE). Never raises; 0
    without EE."""
    hooks = get_ee_hooks()
    hook = getattr(hooks, "run_usergroup_digests", None) if hooks else None
    if hook is None:
        return 0
    try:
        return int(await hook(db_session, now) or 0)
    except Exception:
        logger.exception("EE user group digests failed")
        return 0


def _impersonating() -> bool:
    from src.security.impersonation import is_impersonating

    return is_impersonating()


def notify_ee_event(event_name: str, org_id: int, data: dict) -> None:
    """Hand a webhook-catalog event to EE (CRM integrations sync it to the
    org's CRM). Fire-and-forget: never raises, a no-op without EE. Skipped
    for an impersonation: it is not the member's engagement."""
    hooks = get_ee_hooks()
    hook = getattr(hooks, "on_event", None) if hooks else None
    if hook is None or _impersonating():
        return
    try:
        hook(event_name, org_id, data)
    except Exception:
        logger.exception("EE event hook failed for %s", event_name)


def notify_ee_user_changed(user_id: int) -> None:
    """Tell EE a member's account fields changed (name, email, username), so
    connected CRMs update the contact. Fire-and-forget, a no-op without EE."""
    hooks = get_ee_hooks()
    hook = getattr(hooks, "on_user_changed", None) if hooks else None
    if hook is None or _impersonating():
        return
    try:
        hook(user_id)
    except Exception:
        logger.exception("EE user-changed hook failed")


async def notify_ee_user_deleting(user_id: int, db_session) -> None:
    """Tell EE an account is about to be deleted, in the caller's session and
    before the delete (connected CRMs capture the contact to remove or
    anonymize). Never raises: a deletion must not fail over an integration."""
    hooks = get_ee_hooks()
    hook = getattr(hooks, "on_user_deleting", None) if hooks else None
    if hook is None:
        return
    try:
        await hook(user_id, db_session)
    except Exception:
        logger.exception("EE user-deleting hook failed")


def notify_ee_email_verified(user_id: int) -> None:
    """Tell EE a member just proved their email address (verification link,
    Google sign-in), so grants held for that address (CRM rules) apply.
    Fire-and-forget: never raises, a no-op without EE."""
    hooks = get_ee_hooks()
    hook = getattr(hooks, "on_email_verified", None) if hooks else None
    if hook is None:
        return
    try:
        hook(user_id)
    except Exception:
        logger.exception("EE email-verified hook failed")
