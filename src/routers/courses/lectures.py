from fastapi import APIRouter, Depends, UploadFile, Form
from src.services.courses.lectures.lectures import *
from src.dependencies.auth import get_current_user
from src.services.courses.lectures.video import create_video_lecture

router = APIRouter()


@router.post("/")
async def api_create_lecture(lecture_object: Lecture, coursechapter_id: str,  current_user: PublicUser = Depends(get_current_user)):
    """
    Create new lecture
    """
    return await create_lecture(lecture_object, coursechapter_id, current_user)


@router.get("/{lecture_id}")
async def api_get_lecture(lecture_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get single lecture by lecture_id
    """
    return await get_lecture(lecture_id, current_user=current_user)


@router.get("/coursechapter/{coursechapter_id}")
async def api_get_lectures(coursechapter_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get CourseChapter lectures 
    """
    return await get_lectures(coursechapter_id, current_user)


@router.put("/{lecture_id}")
async def api_update_lecture(lecture_object: Lecture, lecture_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Update lecture by lecture_id
    """
    return await update_lecture(lecture_object, lecture_id, current_user)


@router.delete("/{lecture_id}")
async def api_delete_lecture(lecture_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Delete lecture by lecture_id
    """
    return await delete_lecture(lecture_id, current_user)

# Video lecture


@router.post("/video")
async def api_create_video_lecture(name: str = Form(), coursechapter_id: str = Form(),  current_user: PublicUser = Depends(get_current_user), video_file: UploadFile | None = None):
    """
    Create new lecture
    """
    return await create_video_lecture(name, coursechapter_id, current_user, video_file)
