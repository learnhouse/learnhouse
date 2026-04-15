from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from src.db.organizations import Organization
from src.core.events.database import get_db_session
from src.core.ee_hooks import is_multi_org_allowed
from src.core.deployment_mode import get_deployment_mode
from src.services.orgs.cache import get_cached_instance_info, set_cached_instance_info
from config.config import get_learnhouse_config

router = APIRouter()


def _strip_port(domain: str) -> str:
    """Strip port from a domain string (e.g. 'localhost:3000' -> 'localhost')."""
    return domain.split(":")[0] if ":" in domain else domain


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
async def get_instance_info(db_session: Session = Depends(get_db_session)):
    """Public endpoint returning instance configuration."""
    cached = get_cached_instance_info()
    if cached is not None:
        return cached

    default_org_slug = "default"
    try:
        statement = select(Organization).where(Organization.slug == "default")
        default_org = db_session.exec(statement).first()
        if not default_org:
            statement = select(Organization).order_by(Organization.id).limit(1)
            default_org = db_session.exec(statement).first()
        if default_org:
            default_org_slug = default_org.slug
    except Exception:
        pass

    config = get_learnhouse_config()
    frontend_domain = config.hosting_config.frontend_domain
    top_domain = _strip_port(frontend_domain)

    result = {
        "mode": get_deployment_mode(),
        "multi_org_enabled": is_multi_org_allowed(),
        "default_org_slug": default_org_slug,
        "frontend_domain": frontend_domain,
        "top_domain": top_domain,
    }

    set_cached_instance_info(result)
    return result
