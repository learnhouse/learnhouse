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

    # Bootstrap only when the DB has zero orgs. Multi-tenant SaaS installs
    # don't necessarily own an org with slug=='default', so gating on that
    # slug previously skipped the role refresh on every restart.
    any_org = db_session.exec(select(Organization)).first()

    if not any_org:
        logger.info("No organizations found. Starting auto-installation 🏗️")
        install(short=True)
        return

    # Refresh global default roles (IDs 1-4) so this release's new permission
    # keys (e.g. playgrounds, boards) land in the DB. Idempotent.
    try:
        install_default_elements(db_session)
    except Exception as e:
        logger.warning("Default-role refresh skipped (non-fatal): %s", e)
    logger.info("Organizations found. Skipping auto-installation 🚀")
