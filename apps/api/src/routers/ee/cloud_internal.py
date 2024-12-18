import os
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfigBase
from src.services.explore.explore import get_course_for_explore, get_courses_for_an_org_explore, get_org_for_explore, get_orgs_for_explore, search_orgs_for_explore
from src.services.orgs.orgs import update_org_with_config_no_auth

router = APIRouter()

# Utils
def check_internal_cloud_key(request: Request):
    if request.headers.get("CloudInternalKey") != os.environ.get(
        "CLOUD_INTERNAL_KEY"
    ):
        raise HTTPException(status_code=403, detail="Unauthorized")

@router.get("/explore/orgs")
async def api_get_orgs_for_explore(
    request: Request,
    page: int = 1,
    limit: int = 10,
    label: str = "",
    salt: str = "",
    db_session: Session = Depends(get_db_session),
):
    return await get_orgs_for_explore(request, db_session, page, limit, label, salt)

@router.get("/explore/orgs/search")
async def api_search_orgs_for_explore(
    request: Request,
    search_query: str,  
    label: Optional[str] = None,
    db_session: Session = Depends(get_db_session),
):
    return await search_orgs_for_explore(request, db_session, search_query, label)

@router.get("/explore/orgs/{org_uuid}/courses")
async def api_get_courses_for_explore(
    request: Request,
    org_uuid: str,
    db_session: Session = Depends(get_db_session),
):
    return await get_courses_for_an_org_explore(request, db_session, org_uuid)

@router.get("/explore/courses/{course_id}")
async def api_get_course_for_explore(
    request: Request,
    course_id: str,
    db_session: Session = Depends(get_db_session),
):
    return await get_course_for_explore(request, course_id, db_session)

@router.get("/explore/orgs/{org_slug}")
async def api_get_org_for_explore(
    request: Request,
    org_slug: str,
    db_session: Session = Depends(get_db_session),
):
    return await get_org_for_explore(request, org_slug, db_session)

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
