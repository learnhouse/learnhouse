from fastapi import APIRouter, Depends, UploadFile, Form
from src.dependencies.auth import get_current_user
from fastapi import HTTPException, status, UploadFile

from src.services.files.pictures import create_picture_file, get_picture_file
from src.services.files.videos import create_video_file, get_video_file
from src.services.users import PublicUser

router = APIRouter()


@router.post("/picture")
async def api_create_picture_file(file_object: UploadFile, lecture_id: str = Form(),  current_user: PublicUser = Depends(get_current_user)):
    """
    Create new picture file
    """
    return await create_picture_file(file_object, lecture_id)


@router.post("/video")
async def api_create_video_file(file_object: UploadFile,lecture_id: str = Form(), current_user: PublicUser = Depends(get_current_user)):
    """
    Create new video file
    """
    return await create_video_file(file_object, lecture_id)


@router.get("/picture")
async def api_get_picture_file(file_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get picture file
    """
    return await get_picture_file(file_id, current_user)


@router.get("/video")
async def api_get_video_file(file_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get video file
    """
    return await get_video_file(file_id, current_user)
