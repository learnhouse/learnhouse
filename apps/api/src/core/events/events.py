import asyncio
import logging
from typing import Callable
from fastapi import FastAPI
from config.config import LearnHouseConfig, get_learnhouse_config
from src.core.events.autoinstall import auto_install
from src.core.events.content import check_content_directory
from src.core.events.database import close_database, connect_to_db
from src.core.events.logs import create_logs_dir
from src.core.ee_hooks import run_ee_startup

logger = logging.getLogger(__name__)

_cleanup_task = None


async def _periodic_migration_cleanup():
    """Run migration temp cleanup every 10 minutes."""
    from src.services.courses.migration.migration_service import cleanup_old_temp_migrations
    while True:
        await asyncio.sleep(600)  # 10 minutes
        try:
            cleanup_old_temp_migrations()
        except Exception as e:
            logger.warning("Periodic migration cleanup failed: %s", e)


def _reconcile_packs():
    """Reconcile Redis pack credits with DB state on startup."""
    try:
        from sqlalchemy import create_engine
        from sqlmodel import Session
        learnhouse_config = get_learnhouse_config()
        engine = create_engine(
            learnhouse_config.database_config.sql_connection_string,
            echo=False,
            pool_pre_ping=True,
        )
        db_session = Session(engine)
        try:
            from src.services.packs.packs import reconcile_pack_credits
            result = reconcile_pack_credits(db_session)
            logger.info("Pack reconciliation on startup: %s", result)
        finally:
            db_session.close()
    except Exception as e:
        logger.warning("Pack reconciliation skipped (non-fatal): %s", e)


def startup_app(app: FastAPI) -> Callable:
    async def start_app() -> None:
        # Get LearnHouse Config
        learnhouse_config: LearnHouseConfig = get_learnhouse_config()
        app.learnhouse_config = learnhouse_config  # type: ignore

        # Connect to database
        await connect_to_db(app)

        # Create logs directory
        await create_logs_dir()

        # Create content directory
        await check_content_directory()

        # Check if auto-installation is needed
        auto_install()

        # Reconcile pack credits (Redis ↔ DB)
        _reconcile_packs()

        # Clean up stale migration temp directories (on startup + every 10 min)
        from src.services.courses.migration.migration_service import cleanup_old_temp_migrations
        cleanup_old_temp_migrations()
        global _cleanup_task
        _cleanup_task = asyncio.create_task(_periodic_migration_cleanup())

        # Start Enterprise Edition Startup tasks if available
        run_ee_startup(app)

    return start_app


def shutdown_app(app: FastAPI) -> Callable:
    async def close_app() -> None:
        if _cleanup_task:
            _cleanup_task.cancel()
        # Close the webhook httpx client cleanly
        from src.services.webhooks.dispatch import close_webhook_client
        await close_webhook_client()
        await close_database(app)

    return close_app
