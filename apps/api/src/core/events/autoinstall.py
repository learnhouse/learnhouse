import logging
from sqlmodel import select

from cli import _install_async
from src.core.events.database import _async_session_factory
from src.db.organizations import Organization
from src.db.user_activity import UserActivityDay  # noqa: F401 — register table on SQLModel.metadata
from src.db.organization_plan_history import OrganizationPlanHistory  # noqa: F401 — register table on SQLModel.metadata
from src.services.setup.setup import install_default_elements

logger = logging.getLogger(__name__)


async def auto_install():
    """
    Bootstrap a brand-new deployment (no orgs yet) and refresh the global
    default roles on every boot.

    Both steps run on the application engine (``_async_session_factory``).
    Creating a dedicated engine here used to open a *second* connection pool
    per pod on top of the app pool: on a pooled Postgres (Supavisor/PgBouncer)
    with a small upstream limit that doubled every pod's connection footprint,
    and once the pooler was saturated the extra pool raised during startup —
    which aborted the whole boot and put the pod into a crash loop that opened
    yet more connections on the next attempt.

    Tables are already created by ``connect_to_db``, which runs before this.
    """
    async with _async_session_factory() as db_session:
        any_org = (
            await db_session.execute(select(Organization).limit(1))
        ).scalars().first()

    if not any_org:
        logger.info("No organizations found. Starting auto-installation")
        await _install_async(short=True)
        return

    # Refresh global default roles (IDs 1-4) so this release's new permission
    # keys (e.g. playgrounds, boards) land in the DB. Idempotent.
    try:
        async with _async_session_factory() as session:
            await install_default_elements(session)
    except Exception as e:
        logger.warning("Default-role refresh skipped (non-fatal): %s", e)
    logger.info("Organizations found. Skipping auto-installation")
