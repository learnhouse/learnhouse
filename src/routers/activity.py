from fastapi import APIRouter, Depends, Request
from src.security.auth import get_current_user
from src.services.activity import Activity, add_activity_to_activity, close_activity, create_activity, get_user_activities, get_user_activities_orgslug


router = APIRouter()


@router.post("/start")
async def api_start_activity(request: Request, activity_object: Activity, user=Depends(get_current_user)):
    """
    Start activity 
    """
    return await create_activity(request, user, activity_object)

# TODO : get activity by user_is and org_id and course_id


@router.get("/org_id/{org_id}/activities")
async def api_get_activity_by_orgid(request: Request, org_id: str, user=Depends(get_current_user)):
    """
    Get a user activities
    """
    return await get_user_activities(request, user, org_id=org_id)

@router.get("/org_slug/{org_slug}/activities")
async def api_get_activity_by_orgslug(request: Request, org_slug: str, user=Depends(get_current_user)):
    """
    Get a user activities using org slug
    """
    return await get_user_activities_orgslug(request, user, org_slug=org_slug)


@router.post("/{org_id}/add_activity/{course_id}/{activity_id}")
async def api_add_activity_to_activity(request: Request, org_id: str, course_id: str, activity_id: str, user=Depends(get_current_user)):
    """
    Add activity to activity
    """
    return await add_activity_to_activity(request, user, org_id, course_id, activity_id)


@router.patch("/{org_id}/close_activity/{activity_id}")
async def api_close_activity(request: Request, org_id: str, activity_id: str, user=Depends(get_current_user)):
    """
    Close activity
    """
    return await close_activity(request, user, org_id, activity_id)
