import asyncio
import logging
from typing import Callable
from fastapi import FastAPI
from config.config import LearnHouseConfig, get_learnhouse_config
from src.core.events.autoinstall import auto_install
from src.core.events.content import check_content_directory
from src.core.events.database import close_database, connect_to_db
from src.core.events.logs import create_logs_dir, init_logging
from src.core.ee_hooks import run_ee_startup

logger = logging.getLogger(__name__)

_cleanup_task = None
_mcp_lifespan_stack = None


async def _periodic_migration_cleanup():
    """Run migration temp cleanup every 10 minutes."""
    from src.services.courses.migration.migration_service import cleanup_old_temp_migrations
    while True:
        await asyncio.sleep(600)  # 10 minutes
        try:
            cleanup_old_temp_migrations()
        except Exception as e:
            logger.warning("Periodic migration cleanup failed: %s", e)


async def _reconcile_packs():
    """Reconcile Redis pack credits with DB state on startup."""
    try:
        from src.core.events.database import _async_session_factory
        from src.services.packs.packs import reconcile_pack_credits
        async with _async_session_factory() as db_session:
            result = await reconcile_pack_credits(db_session)
            logger.info("Pack reconciliation on startup: %s", result)
    except Exception as e:
        logger.warning("Pack reconciliation skipped (non-fatal): %s", e)


def startup_app(app: FastAPI) -> Callable:
    async def start_app() -> None:
        # Get LearnHouse Config
        learnhouse_config: LearnHouseConfig = get_learnhouse_config()
        app.learnhouse_config = learnhouse_config  # type: ignore

        # Send application logs to stdout. Until this runs, the root logger
        # has no handler and Python's fallback drops everything below WARNING,
        # so every logger.info in the codebase is invisible in production.
        # Before the database: the schema step logs what it migrated.
        init_logging()

        # Connect to database (and bring its schema to this version)
        await connect_to_db(app)

        # Create logs directory
        await create_logs_dir()

        # Create content directory
        await check_content_directory()

        # Check if auto-installation is needed
        await auto_install()

        # Reconcile pack credits (Redis ↔ DB)
        await _reconcile_packs()

        # Clean up stale migration temp directories (on startup + every 10 min)
        from src.services.courses.migration.migration_service import cleanup_old_temp_migrations
        cleanup_old_temp_migrations()
        global _cleanup_task
        _cleanup_task = asyncio.create_task(_periodic_migration_cleanup())

        # Lifecycle nudges run on their own daily tick so the feature needs no
        # external scheduler. No-op unless enabled; never raises.
        from src.services.nudges.scheduler import start_scheduler
        start_scheduler()

        # Hourly "chapter is open" emails for courses with drip content and
        # notifications on. Never raises.
        from src.services.courses.drip_scheduler import start_scheduler as start_drip_scheduler
        start_drip_scheduler()

        # The shared demo organization refreshes itself on an interval, so the
        # feature needs no external scheduler. No-op unless
        # LEARNHOUSE_DEMO_ENABLED; never raises.
        from src.services.demo.scheduler import start_scheduler as start_demo_scheduler
        start_demo_scheduler()

        # Start the in-app HLS transcoding consumer (drains the Redis queue as a
        # background task; no separate worker). No-op unless LEARNHOUSE_HLS_ENABLED.
        from src.services.utils.hls_jobs import start_consumer
        start_consumer()

        # Start the in-app AI captions consumer (no-op without Redis; idle until an
        # instructor enables captions on a video).
        from src.services.utils.caption_jobs import start_consumer as start_captions_consumer
        start_captions_consumer()

        # Start the in-app RAG indexing consumer (no-op without Redis, where
        # indexing runs in-process instead).
        from src.services.ai.rag.queue import start_consumer as start_rag_consumer
        start_rag_consumer()
        # Every few hours, queue whatever the index is missing or behind on.
        from src.services.ai.rag.scheduler import start_scheduler as start_rag_backfill
        start_rag_backfill()
        # Every two days, re-run every content backfill (HLS, search index,
        # video chapters) for whatever slipped through.
        from src.services.backfill.scheduler import start_scheduler as start_backfill
        start_backfill()
        # Start the embedded MCP session manager when enabled. Starlette
        # mounts don't run sub-app lifespans, so the manager's run()
        # context is entered here and closed in shutdown_app — without it
        # every /mcp request fails with an uninitialized task group.
        mcp_manager = getattr(getattr(app, "state", None), "mcp_session_manager", None)
        if mcp_manager is not None:
            from contextlib import AsyncExitStack

            global _mcp_lifespan_stack
            _mcp_lifespan_stack = AsyncExitStack()
            await _mcp_lifespan_stack.enter_async_context(mcp_manager.run())
            logger.info("Embedded MCP server started on /mcp")

        # Start Enterprise Edition Startup tasks if available
        run_ee_startup(app)

    return start_app


def shutdown_app(app: FastAPI) -> Callable:
    async def close_app() -> None:
        if _cleanup_task:
            _cleanup_task.cancel()
            try:
                await _cleanup_task
            except asyncio.CancelledError:
                pass
        # Stop the in-app HLS consumer and wait for in-flight transcodes.
        from src.services.utils.hls_jobs import stop_consumer
        await stop_consumer()
        # Stop the in-app captions consumer.
        from src.services.utils.caption_jobs import stop_consumer as stop_captions_consumer
        await stop_captions_consumer()
        # Stop the RAG backfill tick, then the indexing consumer; in-flight
        # refs are re-queued.
        from src.services.backfill.scheduler import stop_scheduler as stop_backfill
        await stop_backfill()
        from src.services.ai.rag.scheduler import stop_scheduler as stop_rag_backfill
        await stop_rag_backfill()
        from src.services.ai.rag.queue import stop_consumer as stop_rag_consumer
        await stop_rag_consumer()
        # Wait for in-flight webhook deliveries before closing the HTTP client
        from src.services.webhooks.dispatch import close_webhook_client, _background_tasks as _webhook_tasks
        if _webhook_tasks:  # pragma: no cover
            await asyncio.gather(*list(_webhook_tasks), return_exceptions=True)
        await close_webhook_client()
        # Stop the daily nudge tick.
        from src.services.nudges.scheduler import stop_scheduler
        await stop_scheduler()
        from src.services.courses.drip_scheduler import stop_scheduler as stop_drip_scheduler
        await stop_drip_scheduler()
        # Stop the demo refresh tick.
        from src.services.demo.scheduler import stop_scheduler as stop_demo_scheduler
        await stop_demo_scheduler()
        # Close the embedded MCP session manager (started in startup_app).
        global _mcp_lifespan_stack
        if _mcp_lifespan_stack is not None:
            try:
                await _mcp_lifespan_stack.aclose()
            except Exception:  # pragma: no cover - defensive shutdown
                logger.exception("MCP session manager shutdown failed")
            _mcp_lifespan_stack = None
        await close_database(app)

    return close_app
