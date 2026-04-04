import logging
from sqlalchemy import create_engine
from sqlmodel import SQLModel, Session, select

from cli import install
from config.config import get_learnhouse_config
from src.db.organizations import Organization

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
        logger.info("Organizations found. Skipping auto-installation 🚀")
