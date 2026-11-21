from fastapi import APIRouter, Depends
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.core.events.database import get_db_session
from src.core.deployment_mode import get_deployment_mode
from src.core.ee_hooks import get_ee_hooks
from src.core.middleware.license_lock import license_lock_state
from src.security.auth import get_authenticated_user
from src.security.backoffice import is_user_backoffice_staff
from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS
from src.services.orgs.cache import get_cached_instance_info, set_cached_instance_info
from config.config import get_learnhouse_config

router = APIRouter()


def _strip_port(domain: str) -> str:
    """Strip port from a domain string (e.g. 'localhost:3000' -> 'localhost')."""
    return domain.split(":")[0] if ":" in domain else domain


def _live_fields(tenancy: str) -> dict:
    """The license-derived part of the payload, never cached.

    Resolves the mode once. is_multi_org_allowed() calls get_deployment_mode()
    internally, so asking for both separately doubles the work on a public
    endpoint that runs this per request.
    """
    mode = get_deployment_mode()
    return {
        "mode": mode,
        # True only on a self-hosted EE install whose license lapsed with
        # lock-on-lapse; the frontend shows its lock screen.
        "license_locked": license_lock_state()[0],
        # Deprecated: prefer `tenancy`. Will be removed in a future release.
        "multi_org_enabled": tenancy == "multi" and mode in ("ee", "saas"),
    }


@router.get(
    "/info",
    summary="Get instance info",
    description=(
        "Public endpoint returning instance configuration (deployment mode, default org slug, "
        "frontend domain, and multi-org flag). Result is cached for performance."
    ),
    responses={
        200: {"description": "Instance configuration for the current deployment."},
    },
)
async def get_instance_info(db_session: AsyncSession = Depends(get_db_session)):
    """Public endpoint returning instance configuration."""
    # Only the DB lookup is cached. `mode` and `multi_org_enabled` are derived
    # from live license state and are recomputed on every request: the license
    # can flip mid-runtime (a heartbeat recovering, a revocation landing), and
    # baking those into a 600s blob meant an operator who fixed a bad license
    # key watched /instance/info keep reporting mode "oss" for ten minutes and
    # concluded the fix had not worked.
    #
    # This is not free: get_deployment_mode() resolves the whole config, which
    # is why config.yaml parsing is memoised. Measured at ~0.2ms per request
    # against ~26ms before that memoisation.
    cached = get_cached_instance_info()
    if cached is not None:
        return {**cached, **_live_fields(cached.get("tenancy", "single"))}

    default_org_slug = "default"
    try:
        statement = select(Organization).where(Organization.slug == "default")
        default_org = (await db_session.execute(statement)).scalars().first()
        if not default_org:
            statement = select(Organization).order_by(Organization.id).limit(1)
            default_org = (await db_session.execute(statement)).scalars().first()
        if default_org:
            default_org_slug = default_org.slug
    except Exception:
        pass

    config = get_learnhouse_config()
    frontend_domain = config.hosting_config.frontend_domain
    top_domain = _strip_port(frontend_domain)
    tenancy = config.hosting_config.tenancy

    cacheable = {
        "tenancy": tenancy,
        "default_org_slug": default_org_slug,
        "frontend_domain": frontend_domain,
        "top_domain": top_domain,
    }
    set_cached_instance_info(cacheable)
    return {**cacheable, **_live_fields(tenancy)}


async def _is_license_admin(user, db_session: AsyncSession) -> bool:
    """Backoffice staff, or an admin/maintainer of any organization."""
    user_id = getattr(user, "id", None)
    if not isinstance(user_id, int):
        return False
    if await is_user_backoffice_staff(user_id, db_session):
        return True
    row = (
        await db_session.execute(
            select(UserOrganization.id)
            .where(UserOrganization.user_id == user_id)
            .where(UserOrganization.role_id.in_(ADMIN_OR_MAINTAINER_ROLE_IDS))
            .limit(1)
        )
    ).first()
    return row is not None


@router.get(
    "/license",
    summary="Get license status",
    description=(
        "License status of a self-hosted Enterprise install, for the admin banner. "
        "Administrators get the full status (notices, term, features); other "
        "signed-in users only the mode, status and lock flag."
    ),
    responses={
        200: {"description": "License status for the current deployment."},
        401: {"description": "Authentication required."},
    },
)
async def get_instance_license(
    user=Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    mode = get_deployment_mode()
    locked, lock_reason = license_lock_state()
    hooks = get_ee_hooks()
    getter = getattr(hooks, "get_license_status", None) if hooks is not None else None
    if mode == "saas" or getter is None:
        return {"mode": mode, "status": "unlicensed", "locked": False, "notices": []}
    try:
        status = dict(getter())
    except Exception:
        status = {"status": "inactive", "reason": "status_unavailable", "notices": []}
    status["mode"] = mode
    status["locked"] = locked
    status.setdefault("lock_reason", lock_reason)
    if not await _is_license_admin(user, db_session):
        return {"mode": mode, "status": status.get("status", "inactive"), "locked": locked}
    return status
