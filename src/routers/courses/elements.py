from fastapi import APIRouter, Depends, UploadFile, Form
from src.services.courses.elements.elements import *
from src.dependencies.auth import get_current_user
from src.services.courses.elements.video import create_video_element

router = APIRouter()


@router.post("/")
async def api_create_element(element_object: Element, coursechapter_id: str,  current_user: PublicUser = Depends(get_current_user)):
    """
    Create new Element
    """
    return await create_element(element_object, coursechapter_id, current_user)


@router.get("/{element_id}")
async def api_get_element(element_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get single Element by element_id
    """
    return await get_element(element_id, current_user=current_user)


@router.get("/coursechapter/{coursechapter_id}")
async def api_get_elements(coursechapter_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get CourseChapter Elements 
    """
    return await get_elements(coursechapter_id, current_user)


@router.put("/{element_id}")
async def api_update_element(element_object: Element, element_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Update Element by element_id
    """
    return await update_element(element_object, element_id, current_user)


@router.delete("/{element_id}")
async def api_delete_element(element_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Delete Element by element_id
    """
    return await delete_element(element_id, current_user)

# Video Element


@router.post("/video")
async def api_create_video_element(name: str = Form() , coursechapter_id: str = Form(),  current_user: PublicUser = Depends(get_current_user), video_file: UploadFile | None = None):
    """
    Create new Element
    """
    return await create_video_element(name, coursechapter_id, current_user, video_file)
