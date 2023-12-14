from fastapi import APIRouter, Depends, UploadFile, Form, Request
from src.db.blocks import BlockRead
from src.core.events.database import get_db_session
from src.security.auth import get_current_user
from src.services.blocks.block_types.imageBlock.imageBlock import (
    create_image_block,
    get_image_block,
)
from src.services.blocks.block_types.videoBlock.videoBlock import (
    create_video_block,
    get_video_block,
)
from src.services.blocks.block_types.pdfBlock.pdfBlock import (
    create_pdf_block,
    get_pdf_block,
)

from src.services.users.users import PublicUser

router = APIRouter()

####################
# Image Block
####################


@router.post("/image")
async def api_create_image_file_block(
    request: Request,
    file_object: UploadFile,
    activity_uuid: str = Form(),
    db_session=Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BlockRead:
    """
    Create new image file
    """
    return await create_image_block(request, file_object, activity_uuid, db_session)


@router.get("/image")
async def api_get_image_file_block(
    request: Request,
    block_uuid: str,
    db_session=Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BlockRead:
    """
    Get image file
    """
    return await get_image_block(request, block_uuid, current_user, db_session)


####################
# Video Block
####################


@router.post("/video")
async def api_create_video_file_block(
    request: Request,
    file_object: UploadFile,
    activity_uuid: str = Form(),
    db_session=Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BlockRead:
    """
    Create new video file
    """
    return await create_video_block(request, file_object, activity_uuid, db_session)


@router.get("/video")
async def api_get_video_file_block(
    request: Request,
    block_uuid: str,
    db_session=Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BlockRead:
    """
    Get video file
    """
    return await get_video_block(request, block_uuid, current_user, db_session)


####################
# PDF Block
####################


@router.post("/pdf")
async def api_create_pdf_file_block(
    request: Request,
    file_object: UploadFile,
    activity_uuid: str = Form(),
    db_session=Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BlockRead:
    """
    Create new pdf file
    """
    return await create_pdf_block(request, file_object, activity_uuid, db_session)


@router.get("/pdf")
async def api_get_pdf_file_block(
    request: Request,
    block_uuid: str,
    db_session=Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> BlockRead:
    """
    Get pdf file
    """
    return await get_pdf_block(request, block_uuid, current_user, db_session)
