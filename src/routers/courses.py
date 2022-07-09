from fastapi import APIRouter, Depends
from src.services.auth import get_current_user

from src.services.courses import Course, create_course, get_course, get_courses, update_course, delete_course
from src.services.users import User


router = APIRouter()


@router.post("/")
async def api_create_course(course_object: Course, current_user: User = Depends(get_current_user)):
    """
    Create new Course
    """
    return await create_course(course_object, current_user)


@router.get("/{course_id}")
async def api_get_course(course_id: str, current_user: User = Depends(get_current_user)):
    """
    Get single Course by course_id
    """
    return await get_course(course_id, current_user=current_user)


@router.get("/page/{page}/limit/{limit}")
async def api_get_course_by(page: int, limit: int):
    """
    Get houses by page and limit
    """
    return await get_courses(page, limit)


@router.put("/{course_id}")
async def api_update_course(course_object: Course, course_id: str, current_user: User = Depends(get_current_user)):
    """
    Update Course by course_id
    """
    return await update_course(course_object, course_id, current_user)


@router.delete("/{course_id}")
async def api_delete_course(course_id: str, current_user: User = Depends(get_current_user)):
    """
    Delete Course by ID
    """

    return await delete_course(course_id, current_user)
