from fastapi import APIRouter, Depends, Request
from src.dependencies.auth import get_current_user
from src.services.activity import Activity, add_chapter_to_activity, close_activity, create_activity, get_user_activities


router = APIRouter()


@router.post("/")
async def api_start_activity(request: Request, activity_object: Activity, user=Depends(get_current_user)):
    """
    Start activity
    """
    return await create_activity(request, user, activity_object)


@router.get("{org_id}/activities")
async def api_get_activity_by_userid(request: Request, org_id: str, user=Depends(get_current_user)):
    """
    Get a user activities
    """
    return await get_user_activities(request, user, org_id)


@router.post("/{org_id}/add_chapter/{course_id}/{chapter_id}")
async def api_add_chapter_to_activity(request: Request, org_id: str, course_id: str, chapter_id: str, user=Depends(get_current_user)):
    """
    Add chapter to activity
    """
    return await add_chapter_to_activity(request, user, org_id, course_id, chapter_id)


@router.patch("{org_id}/close_activity/{activity_id}")
async def api_close_activity(request: Request, org_id: str, activity_id: str, user=Depends(get_current_user)):
    """
    Close activity
    """
    return await close_activity(request, user, org_id, activity_id)
