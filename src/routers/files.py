from fastapi import APIRouter, Depends, UploadFile, Form, Request
from src.dependencies.auth import get_current_user
from fastapi import HTTPException, status, UploadFile
from src.services.blocks.files.pictures import create_picture_file, get_picture_file
from src.services.blocks.files.videos import create_video_file, get_video_file
from src.services.blocks.pdfBlock.documents import create_document_file, get_document_file
from src.services.users import PublicUser

router = APIRouter()


@router.post("/picture")
async def api_create_picture_file(request: Request, file_object: UploadFile, lecture_id: str = Form(),  current_user: PublicUser = Depends(get_current_user)):
    """
    Create new picture file
    """
    return await create_picture_file(request, file_object, lecture_id)


@router.post("/video")
async def api_create_video_file(request: Request, file_object: UploadFile, lecture_id: str = Form(), current_user: PublicUser = Depends(get_current_user)):
    """
    Create new video file
    """
    return await create_video_file(request, file_object, lecture_id)


@router.get("/picture")
async def api_get_picture_file(request: Request, file_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get picture file
    """
    return await get_picture_file(request, file_id, current_user)


@router.get("/video")
async def api_get_video_file(request: Request, file_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get video file
    """
    return await get_video_file(request, file_id, current_user)

@router.get("/document")
async def api_get_document_file(request: Request, file_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get document file
    """
    return await get_document_file(request, file_id, current_user)


@router.post("/document")
async def api_create_document_file(request: Request, file_object: UploadFile, lecture_id: str = Form(), current_user: PublicUser = Depends(get_current_user)):
    """
    Create new document file
    """
    return await create_document_file(request, file_object, lecture_id)