from typing import Union
from fastapi import APIRouter, Depends, UploadFile, Form, Request
from src.db.courses.blocks import BlockRead
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
from src.services.blocks.block_types.audioBlock.audioBlock import (
    create_audio_block,
    get_audio_block,
)

from src.db.users import AnonymousUser, PublicUser

router = APIRouter()

####################
# Image Block
####################


@router.post(
    "/image",
    response_model=BlockRead,
    summary="Create image block",
    description="Upload an image file and create a new image block attached to the given activity.",
    responses={
        200: {"description": "Image block created and returned.", "model": BlockRead},
        401: {"description": "Authentication required"},
    },
)
async def api_create_image_file_block(
    request: Request,
    file_object: UploadFile,
    activity_uuid: str = Form(),
    db_session=Depends(get_db_session),
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
) -> BlockRead:
    """
    Create new image file
    """
    return await create_image_block(request, file_object, activity_uuid, db_session)


@router.get(
    "/image",
    response_model=BlockRead,
    summary="Get image block",
    description="Retrieve an image block by its UUID.",
    responses={
        200: {"description": "Image block returned.", "model": BlockRead},
        401: {"description": "Authentication required"},
        404: {"description": "Image block not found"},
    },
)
async def api_get_image_file_block(
    request: Request,
    block_uuid: str,
    db_session=Depends(get_db_session),
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
) -> BlockRead:
    """
    Get image file
    """
    return await get_image_block(request, block_uuid, current_user, db_session)


####################
# Video Block
####################


@router.post(
    "/video",
    response_model=BlockRead,
    summary="Create video block",
    description="Upload a video file and create a new video block attached to the given activity.",
    responses={
        200: {"description": "Video block created and returned.", "model": BlockRead},
        401: {"description": "Authentication required"},
    },
)
async def api_create_video_file_block(
    request: Request,
    file_object: UploadFile,
    activity_uuid: str = Form(),
    db_session=Depends(get_db_session),
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
) -> BlockRead:
    """
    Create new video file
    """
    return await create_video_block(request, file_object, activity_uuid, db_session)


@router.get(
    "/video",
    response_model=BlockRead,
    summary="Get video block",
    description="Retrieve a video block by its UUID.",
    responses={
        200: {"description": "Video block returned.", "model": BlockRead},
        401: {"description": "Authentication required"},
        404: {"description": "Video block not found"},
    },
)
async def api_get_video_file_block(
    request: Request,
    block_uuid: str,
    db_session=Depends(get_db_session),
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
) -> BlockRead:
    """
    Get video file
    """
    return await get_video_block(request, block_uuid, current_user, db_session)


####################
# PDF Block
####################


@router.post(
    "/pdf",
    response_model=BlockRead,
    summary="Create PDF block",
    description="Upload a PDF file and create a new PDF block attached to the given activity.",
    responses={
        200: {"description": "PDF block created and returned.", "model": BlockRead},
        401: {"description": "Authentication required"},
    },
)
async def api_create_pdf_file_block(
    request: Request,
    file_object: UploadFile,
    activity_uuid: str = Form(),
    db_session=Depends(get_db_session),
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
) -> BlockRead:
    """
    Create new pdf file
    """
    return await create_pdf_block(request, file_object, activity_uuid, db_session)


@router.get(
    "/pdf",
    response_model=BlockRead,
    summary="Get PDF block",
    description="Retrieve a PDF block by its UUID.",
    responses={
        200: {"description": "PDF block returned.", "model": BlockRead},
        401: {"description": "Authentication required"},
        404: {"description": "PDF block not found"},
    },
)
async def api_get_pdf_file_block(
    request: Request,
    block_uuid: str,
    db_session=Depends(get_db_session),
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
) -> BlockRead:
    """
    Get pdf file
    """
    return await get_pdf_block(request, block_uuid, current_user, db_session)


####################
# Audio Block
####################


@router.post(
    "/audio",
    response_model=BlockRead,
    summary="Create audio block",
    description="Upload an audio file and create a new audio block attached to the given activity.",
    responses={
        200: {"description": "Audio block created and returned.", "model": BlockRead},
        401: {"description": "Authentication required"},
    },
)
async def api_create_audio_file_block(
    request: Request,
    file_object: UploadFile,
    activity_uuid: str = Form(),
    db_session=Depends(get_db_session),
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
) -> BlockRead:
    """
    Create new audio file
    """
    return await create_audio_block(request, file_object, activity_uuid, db_session)


@router.get(
    "/audio",
    response_model=BlockRead,
    summary="Get audio block",
    description="Retrieve an audio block by its UUID.",
    responses={
        200: {"description": "Audio block returned.", "model": BlockRead},
        401: {"description": "Authentication required"},
        404: {"description": "Audio block not found"},
    },
)
async def api_get_audio_file_block(
    request: Request,
    block_uuid: str,
    db_session=Depends(get_db_session),
    current_user: Union[PublicUser, AnonymousUser] = Depends(get_current_user),
) -> BlockRead:
    """
    Get audio file
    """
    return await get_audio_block(request, block_uuid, current_user, db_session)
