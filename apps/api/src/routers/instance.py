from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from src.db.organizations import Organization
from src.core.events.database import get_db_session
from src.core.ee_hooks import is_ee_available, is_multi_org_allowed
from config.config import get_learnhouse_config

router = APIRouter()


def _strip_port(domain: str) -> str:
    """Strip port from a domain string (e.g. 'localhost:3000' -> 'localhost')."""
    return domain.split(":")[0] if ":" in domain else domain


@router.get("/info")
async def get_instance_info(db_session: Session = Depends(get_db_session)):
    """Public endpoint returning instance configuration."""
    # Get default org slug (first org by ID)
    default_org_slug = "default"
    try:
        statement = select(Organization).order_by(Organization.id).limit(1)
        first_org = db_session.exec(statement).first()
        if first_org:
            default_org_slug = first_org.slug
    except Exception:
        pass

    config = get_learnhouse_config()
    frontend_domain = config.hosting_config.frontend_domain
    top_domain = _strip_port(frontend_domain)

    return {
        "multi_org_enabled": is_multi_org_allowed(),
        "default_org_slug": default_org_slug,
        "ee_enabled": is_ee_available(),
        "frontend_domain": frontend_domain,
        "top_domain": top_domain,
    }
