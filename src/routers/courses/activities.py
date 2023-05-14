from fastapi import APIRouter, Depends, UploadFile, Form, Request
from src.services.courses.activities.activities import *
from src.security.auth import get_current_user
from src.services.courses.activities.pdf import create_documentpdf_activity
from src.services.courses.activities.video import (
    ExternalVideo,
    create_external_video_activity,
    create_video_activity,
)

router = APIRouter()


@router.post("/")
async def api_create_activity(
    request: Request,
    activity_object: Activity,
    org_id: str,
    coursechapter_id: str,
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Create new activity
    """
    return await create_activity(
        request, activity_object, org_id, coursechapter_id, current_user
    )


@router.get("/{activity_id}")
async def api_get_activity(
    request: Request,
    activity_id: str,
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Get single activity by activity_id
    """
    return await get_activity(request, activity_id, current_user=current_user)


@router.get("/coursechapter/{coursechapter_id}")
async def api_get_activities(
    request: Request,
    coursechapter_id: str,
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Get CourseChapter activities
    """
    return await get_activities(request, coursechapter_id, current_user)


@router.put("/{activity_id}")
async def api_update_activity(
    request: Request,
    activity_object: Activity,
    activity_id: str,
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Update activity by activity_id
    """
    return await update_activity(request, activity_object, activity_id, current_user)


@router.delete("/{activity_id}")
async def api_delete_activity(
    request: Request,
    activity_id: str,
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Delete activity by activity_id
    """
    return await delete_activity(request, activity_id, current_user)


# Video activity


@router.post("/video")
async def api_create_video_activity(
    request: Request,
    name: str = Form(),
    coursechapter_id: str = Form(),
    current_user: PublicUser = Depends(get_current_user),
    video_file: UploadFile | None = None,
):
    """
    Create new activity
    """
    return await create_video_activity(
        request, name, coursechapter_id, current_user, video_file
    )


@router.post("/external_video")
async def api_create_external_video_activity(
    request: Request,
    external_video: ExternalVideo,
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Create new activity
    """
    return await create_external_video_activity(
        request, current_user, external_video
    )


@router.post("/documentpdf")
async def api_create_documentpdf_activity(
    request: Request,
    name: str = Form(),
    coursechapter_id: str = Form(),
    current_user: PublicUser = Depends(get_current_user),
    pdf_file: UploadFile | None = None,
):
    """
    Create new activity
    """
    return await create_documentpdf_activity(
        request, name, coursechapter_id, current_user, pdf_file
    )
