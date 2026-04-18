import logging
from sqlalchemy import create_engine
from sqlmodel import SQLModel, Session, select

from cli import install
from config.config import get_learnhouse_config
from src.db.organizations import Organization
from src.services.setup.setup import install_default_elements

logger = logging.getLogger(__name__)


def auto_install():
    # Get the database session
    learnhouse_config = get_learnhouse_config()
    engine = create_engine(
        learnhouse_config.database_config.sql_connection_string, echo=False, pool_pre_ping=True  # type: ignore
    )
    SQLModel.metadata.create_all(engine)

    db_session = Session(engine)

    default_org = db_session.exec(
        select(Organization).where(Organization.slug == 'default')
    ).first()

    if not default_org:
        logger.info("No default organization found. Starting auto-installation 🏗️")
        install(short=True)
    else:
        # Re-run the default-role upsert so existing installs pick up rights
        # for resources added since the last install (e.g. playgrounds, boards).
        # install_default_elements is idempotent and only touches global role IDs 1-4.
        try:
            install_default_elements(db_session)
        except Exception as e:
            logger.warning("Default-role refresh skipped (non-fatal): %s", e)
        logger.info("Organizations found. Skipping auto-installation 🚀")
