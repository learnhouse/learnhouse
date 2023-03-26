from typing import Optional
from fastapi import APIRouter, Depends, Request
from src.security.auth import get_current_user
from src.services.trail import Trail, add_activity_to_trail, add_course_to_trail,  create_trail, get_user_trail_with_orgslug, get_user_trail, remove_course_from_trail


router = APIRouter()


@router.post("/start")
async def api_start_trail(request: Request, trail_object: Trail, org_id: str, user=Depends(get_current_user)) -> Trail:
    """
    Start trail 
    """
    return await create_trail(request, user, org_id, trail_object)


@router.get("/org_id/{org_id}/trail")
async def api_get_trail_by_orgid(request: Request, org_slug: str, user=Depends(get_current_user)):
    """
    Get a user trails
    """
    return await get_user_trail(request, user=user, org_slug=org_slug)


@router.get("/org_slug/{org_slug}/trail")
async def api_get_trail_by_orgslug(request: Request, org_slug: str, user=Depends(get_current_user)):
    """
    Get a user trails using org slug
    """
    return await get_user_trail_with_orgslug(request, user, org_slug=org_slug)


@router.post("/{org_slug}/add_course/{course_id}")
async def api_add_course_to_trail(request: Request,  course_id: str, org_slug: str,   user=Depends(get_current_user)):
    """
    Add Course to trail
    """
    return await add_course_to_trail(request, user,   org_slug, course_id)


@router.post("/{org_slug}/remove_course/{course_id}")
async def api_remove_course_to_trail(request: Request,  course_id: str, org_slug: str,   user=Depends(get_current_user)):
    """
    Remove Course from trail
    """
    return await remove_course_from_trail(request, user,   org_slug, course_id)
