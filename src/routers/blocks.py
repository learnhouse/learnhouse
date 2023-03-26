from fastapi import APIRouter, Depends, UploadFile, Form, Request
from src.security.auth import get_current_user
from fastapi import HTTPException, status, UploadFile
from src.services.blocks.block_types.imageBlock.images import create_image_block, get_image_block  
from src.services.blocks.block_types.videoBlock.videoBlock import create_video_block, get_video_block
from src.services.blocks.block_types.pdfBlock.pdfBlock import create_pdf_block, get_pdf_block
from src.services.blocks.block_types.quizBlock.quizBlock import create_quiz_block, get_quiz_block_answers, get_quiz_block_options, quizBlock
from src.services.users.users import PublicUser

router = APIRouter()

####################
# Image Block
####################

@router.post("/image")
async def api_create_image_file_block(request: Request, file_object: UploadFile, activity_id: str = Form(),  current_user: PublicUser = Depends(get_current_user)):
    """
    Create new image file
    """
    return await create_image_block(request, file_object, activity_id)


@router.get("/image")
async def api_get_image_file_block(request: Request, file_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get image file
    """
    return await get_image_block(request, file_id, current_user)

####################
# Video Block
####################

@router.post("/video")
async def api_create_video_file_block(request: Request, file_object: UploadFile, activity_id: str = Form(), current_user: PublicUser = Depends(get_current_user)):
    """
    Create new video file
    """
    return await create_video_block(request, file_object, activity_id)


@router.get("/video")
async def api_get_video_file_block(request: Request, file_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get video file
    """
    return await get_video_block(request, file_id, current_user)

####################
# PDF Block
####################

@router.post("/pdf")
async def api_create_pdf_file_block(request: Request, file_object: UploadFile, activity_id: str = Form(), current_user: PublicUser = Depends(get_current_user)):
    """
    Create new pdf file
    """
    return await create_pdf_block(request, file_object, activity_id)


@router.get("/pdf")
async def api_get_pdf_file_block(request: Request, file_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get pdf file
    """
    return await get_pdf_block(request, file_id, current_user)


####################
# Quiz Block
####################

@router.post("/quiz/{activity_id}")
async def api_create_quiz_block(request: Request, quiz_block: quizBlock, activity_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Create new document file
    """
    return await create_quiz_block(request, quiz_block, activity_id, current_user)


@router.get("/quiz/options")
async def api_get_quiz_options(request: Request, block_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get quiz options
    """
    return await get_quiz_block_options(request, block_id, current_user)


@router.get("/quiz/answers")
async def api_get_quiz_answers(request: Request, block_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get quiz answers
    """
    return await get_quiz_block_answers(request, block_id, current_user)
