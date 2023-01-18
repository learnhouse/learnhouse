from fastapi import APIRouter, Depends, Request, UploadFile, Form

from src.services.courses.chapters import CourseChapter, CourseChapterMetaData, create_coursechapter, delete_coursechapter, get_coursechapter, get_coursechapters, get_coursechapters_meta, update_coursechapter, update_coursechapters_meta
from src.services.users import PublicUser
from src.dependencies.auth import get_current_user

router = APIRouter()


@router.post("/")
async def api_create_coursechapter(request: Request,coursechapter_object: CourseChapter, course_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Create new CourseChapter
    """
    return await create_coursechapter(request, coursechapter_object, course_id, current_user)


@router.get("/{coursechapter_id}")
async def api_get_coursechapter(request: Request,coursechapter_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get single CourseChapter by coursechapter_id
    """
    return await get_coursechapter(request, coursechapter_id, current_user=current_user)


@router.get("/meta/{course_id}")
async def api_get_coursechapter_meta(request: Request,course_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get coursechapter metadata
    """
    return await get_coursechapters_meta(request, course_id, current_user=current_user)


@router.put("/meta/{course_id}")
async def api_update_coursechapter_meta(request: Request,course_id: str, coursechapters_metadata: CourseChapterMetaData, current_user: PublicUser = Depends(get_current_user)):
    """
    Update coursechapter metadata
    """
    return await update_coursechapters_meta(request, course_id, coursechapters_metadata, current_user=current_user)


@router.get("/{course_id}/page/{page}/limit/{limit}")
async def api_get_coursechapter_by(request: Request,course_id: str, page: int, limit: int):
    """
    Get CourseChapters by page and limit
    """
    return await get_coursechapters(request, course_id, page, limit)


@router.put("/{coursechapter_id}")
async def api_update_coursechapter(request: Request,coursechapter_object: CourseChapter, coursechapter_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Update CourseChapters by course_id
    """
    return await update_coursechapter(request, coursechapter_object, coursechapter_id, current_user)


@router.delete("/{coursechapter_id}")
async def api_delete_coursechapter(request: Request,coursechapter_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Delete CourseChapters by ID
    """

    return await delete_coursechapter(request,coursechapter_id, current_user)
