import logging
import os
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select
from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig, OrganizationConfigBase
from src.db.organizations import Organization
from src.services.orgs.orgs import update_org_with_config_no_auth
from src.security.features_utils.plans import (
    PLAN_FEATURE_CONFIGS,
    PLAN_HIERARCHY,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# ── Utils ────────────────────────────────────────────────────────────────────

def check_internal_cloud_key(request: Request):
    provided_key = request.headers.get("CloudInternalKey", "")
    expected_key = os.environ.get("CLOUD_INTERNAL_KEY", "")
    # SECURITY: Use constant-time comparison to prevent timing attacks
    if not provided_key or not expected_key or not secrets.compare_digest(provided_key, expected_key):
        raise HTTPException(status_code=403, detail="Unauthorized")


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.put("/update_org_config")
async def update_org_Config(
    request: Request,
    org_id: int,
    config_object: OrganizationConfigBase,
    db_session: Session = Depends(get_db_session),
):

    res = await update_org_with_config_no_auth(
        request, config_object, org_id, db_session
    )
    return res


class UpdateOrgPlanRequest(BaseModel):
    org_id: int
    plan: str


@router.put("/update_org_plan")
async def update_org_plan(
    request: Request,
    body: UpdateOrgPlanRequest,
    db_session: Session = Depends(get_db_session),
):
    """
    Update an organization's plan. Only changes the plan string.
    All feature limits/enabled flags are resolved at runtime from
    the plan name via plans.py — no config overwrite needed.
    """
    check_internal_cloud_key(request)

    plan_config = PLAN_FEATURE_CONFIGS.get(body.plan)
    if not plan_config:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown plan: {body.plan}. Valid plans: {', '.join(PLAN_FEATURE_CONFIGS.keys())}",
        )

    # Find the org
    org = db_session.exec(
        select(Organization).where(Organization.id == body.org_id)
    ).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Find the org config
    org_config = db_session.exec(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
    ).first()
    if not org_config:
        raise HTTPException(status_code=404, detail="Organization config not found")

    import json
    existing = json.loads(json.dumps(org_config.config or {}))
    version = existing.get("config_version", "1.0")

    if version.startswith("2"):
        # v2: plan is a top-level string
        existing["plan"] = body.plan
        # Free plan forces watermark on
        if body.plan == "free":
            existing.setdefault("customization", {}).setdefault("general", {})
            existing["customization"]["general"]["watermark"] = True
    else:
        # v1: plan is under cloud.plan, also update derived flags
        existing.setdefault("cloud", {})
        existing["cloud"]["plan"] = body.plan
        existing["cloud"]["custom_domain"] = plan_config["cloud"]["custom_domain"]
        existing.setdefault("general", {})
        existing["general"]["watermark"] = plan_config["general"]["watermark"]

    org_config.config = existing
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    logger.info("Updated org %d to plan '%s'", body.org_id, body.plan)
    return {"detail": f"Organization plan updated to '{body.plan}'"}


@router.get("/plans")
async def get_available_plans(request: Request):
    """
    Return all available plan configs. The platform app uses this
    instead of maintaining its own copy.
    """
    check_internal_cloud_key(request)
    return {
        "plans": PLAN_FEATURE_CONFIGS,
        "hierarchy": PLAN_HIERARCHY,
    }
