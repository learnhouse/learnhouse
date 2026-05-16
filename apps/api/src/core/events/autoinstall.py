import asyncio
import logging
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlmodel import SQLModel, Session, select
from sqlmodel.ext.asyncio.session import AsyncSession

from cli import install
from config.config import get_learnhouse_config
from src.db.organizations import Organization
from src.services.setup.setup import install_default_elements

logger = logging.getLogger(__name__)


def auto_install():
    # Get the database session
    learnhouse_config = get_learnhouse_config()
    sync_connection_string = learnhouse_config.database_config.sql_connection_string  # type: ignore
    engine = create_engine(
        sync_connection_string, echo=False, pool_pre_ping=True
    )
    SQLModel.metadata.create_all(engine)

    # Check for existing orgs using the sync engine
    with Session(engine) as db_session:
        any_org = db_session.exec(select(Organization)).first()

    if not any_org:
        logger.info("No organizations found. Starting auto-installation")
        install(short=True)
        return

    # Refresh global default roles (IDs 1-4) so this release's new permission
    # keys (e.g. playgrounds, boards) land in the DB. Idempotent.
    try:
        # Build an async connection string from the sync one
        async_connection_string = (
            str(sync_connection_string)
            .replace("postgresql://", "postgresql+asyncpg://")
            .replace("postgresql+psycopg2://", "postgresql+asyncpg://")
        )
        async_engine = create_async_engine(async_connection_string, echo=False, pool_pre_ping=True)
        factory = async_sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)

        async def _refresh_roles():
            async with factory() as session:
                await install_default_elements(session)
            await async_engine.dispose()

        asyncio.run(_refresh_roles())
    except Exception as e:
        logger.warning("Default-role refresh skipped (non-fatal): %s", e)
    logger.info("Organizations found. Skipping auto-installation")
