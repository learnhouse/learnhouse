import asyncio
import logging
from fastapi import FastAPI, APIRouter, Depends
from sqlmodel import Session
from src.core.events.database import engine
from src.security.auth import get_current_user
from src.security.api_token_utils import require_non_api_token_user
from src.security.features_utils.plan_check import require_plan
from ee.middleware.audit import EEAuditLogMiddleware
from ee.services.audit import flush_audit_logs_to_db
from ee.routers import cloud_internal
from ee.routers import payments
from ee.routers import info
from ee.routers import audit_logs
from ee.routers import scorm
from ee.routers import sso
from ee.routers import superadmin

logger = logging.getLogger(__name__)

# Helper dependency to reject API token access
async def get_non_api_token_user(user = Depends(get_current_user)):
    """Dependency that rejects API token access."""
    return await require_non_api_token_user(user)


async def require_non_oss_mode():
    """Dependency that blocks access in OSS mode (superadmin, etc.)."""
    from src.core.deployment_mode import get_deployment_mode
    from fastapi import HTTPException
    if get_deployment_mode() == 'oss':
        raise HTTPException(
            status_code=403,
            detail="This feature is not available in OSS mode.",
        )

def register_middlewares(app: FastAPI):
    """Register Enterprise Edition middlewares."""
    app.add_middleware(EEAuditLogMiddleware)
    logger.info("EE Middlewares registered")

def register_routers(v1_router: APIRouter):
    """Register Enterprise Edition routers."""
    # Cloud Internal
    v1_router.include_router(
        cloud_internal.router,
        prefix="/cloud_internal",
        tags=["cloud_internal"],
        dependencies=[Depends(cloud_internal.check_internal_cloud_key)],
    )
    
    # Payments — webhook routes are registered separately without the plan
    # dependency because Stripe sends webhooks without any org_id parameter.
    # The plan gate on the main router was returning 400 on every webhook call.
    v1_router.include_router(
        payments.webhook_router,
        prefix="/payments",
        tags=["payments"],
    )
    v1_router.include_router(
        payments.router,
        prefix="/payments",
        tags=["payments"],
        dependencies=[Depends(require_plan("standard", "payments"))],
    )
    
    # EE Info
    v1_router.include_router(
        info.router,
        prefix="/ee",
        tags=["ee"],
        dependencies=[Depends(get_non_api_token_user)]
    )

    # Audit Logs
    v1_router.include_router(
        audit_logs.router,
        prefix="/ee/audit_logs",
        tags=["ee", "audit_logs"],
        dependencies=[Depends(get_non_api_token_user)]
    )

    # SCORM
    v1_router.include_router(
        scorm.router,
        prefix="/scorm",
        tags=["scorm"],
        dependencies=[Depends(get_non_api_token_user)]
    )

    # SSO - Admin endpoints require authentication, auth endpoints are public
    v1_router.include_router(
        sso.router,
        prefix="/auth/sso",
        tags=["sso", "auth"],
    )

    # Superadmin
    v1_router.include_router(
        superadmin.router,
        prefix="/ee/superadmin",
        tags=["ee", "superadmin"],
        dependencies=[Depends(require_non_oss_mode)],
    )

    logger.info("EE Routers registered")

def on_startup(app: FastAPI):
    """Run Enterprise Edition startup tasks."""
    
    # Start Audit Log Flusher
    async def audit_log_flusher():
        while True:
            await asyncio.sleep(60)  # Flush every minute
            try:
                with Session(engine) as session:
                    flush_audit_logs_to_db(session)
            except Exception as e:
                logger.error(f"EE Audit log flusher error: {e}")

    asyncio.create_task(audit_log_flusher())
    logger.info("EE Startup tasks initiated")

# Payments hooks
async def check_activity_paid_access(request, activity_id, user, db_session) -> bool:
    """Check if a user has paid access to an activity."""
    from ee.services.payments.payments_access import check_activity_paid_access as ee_check_activity_paid_access
    return await ee_check_activity_paid_access(request, activity_id, user, db_session)

