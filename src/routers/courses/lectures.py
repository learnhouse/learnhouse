from fastapi import APIRouter, Depends, UploadFile, Form, Request
from src.services.courses.lectures.lectures import *
from src.dependencies.auth import get_current_user
from src.services.courses.lectures.video import create_video_lecture

router = APIRouter()


@router.post("/")
async def api_create_lecture(request: Request, lecture_object: Lecture,  org_id: str, coursechapter_id: str,  current_user: PublicUser = Depends(get_current_user)):
    """
    Create new lecture
    """
    return await create_lecture(request, lecture_object, org_id, coursechapter_id, current_user)


@router.get("/{lecture_id}")
async def api_get_lecture(request: Request, lecture_id: str,  current_user: PublicUser = Depends(get_current_user)):
    """
    Get single lecture by lecture_id
    """
    return await get_lecture(request, lecture_id, current_user=current_user)


@router.get("/coursechapter/{coursechapter_id}")
async def api_get_lectures(request: Request, coursechapter_id: str,   current_user: PublicUser = Depends(get_current_user)):
    """
    Get CourseChapter lectures 
    """
    return await get_lectures(request, coursechapter_id, current_user)


@router.put("/{lecture_id}")
async def api_update_lecture(request: Request, lecture_object: Lecture, lecture_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Update lecture by lecture_id
    """
    return await update_lecture(request, lecture_object, lecture_id, current_user)


@router.delete("/{lecture_id}")
async def api_delete_lecture(request: Request, lecture_id: str,  org_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Delete lecture by lecture_id
    """
    return await delete_lecture(request, lecture_id, current_user)

# Video play


@router.post("/video")
async def api_create_video_lecture(request: Request,  org_id: str, name: str = Form(), coursechapter_id: str = Form(),  current_user: PublicUser = Depends(get_current_user), video_file: UploadFile | None = None):
    """
    Create new lecture
    """
    return await create_video_lecture(request, name, coursechapter_id, current_user, video_file)
