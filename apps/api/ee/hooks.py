import asyncio
import logging
from fastapi import FastAPI, APIRouter, Depends
from sqlmodel import Session
from src.core.events.database import engine
from ee.middleware.audit import EEAuditLogMiddleware
from ee.services.audit import flush_audit_logs_to_db
from ee.routers import cloud_internal
from ee.routers import payments
from ee.routers import info

logger = logging.getLogger(__name__)

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
    
    # Payments
    v1_router.include_router(
        payments.router, 
        prefix="/payments", 
        tags=["payments"]
    )
    
    # EE Info
    v1_router.include_router(
        info.router,
        prefix="/ee",
        tags=["ee"]
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

