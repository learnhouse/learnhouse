import os
import secrets
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfigBase
from src.services.orgs.orgs import update_org_with_config_no_auth

router = APIRouter()

# Utils
def check_internal_cloud_key(request: Request):
    provided_key = request.headers.get("CloudInternalKey", "")
    expected_key = os.environ.get("CLOUD_INTERNAL_KEY", "")
    # SECURITY: Use constant-time comparison to prevent timing attacks
    if not provided_key or not expected_key or not secrets.compare_digest(provided_key, expected_key):
        raise HTTPException(status_code=403, detail="Unauthorized")

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
