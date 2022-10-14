from fastapi import APIRouter, Depends, File, UploadFile, Form
from src.services.auth import get_current_user

from src.services.courses import Course, CourseChapter, create_course, create_coursechapter, delete_coursechapter, get_course, get_coursechapter, get_coursechapters, get_courses, update_course, delete_course, update_course_thumbnail, update_coursechapter
from src.services.users import PublicUser, User


router = APIRouter()


@router.post("/")
async def api_create_course(org_id :str , name : str = Form(), mini_description : str = Form() , description :str = Form(), public : bool = Form(),    current_user: PublicUser = Depends(get_current_user) , thumbnail: UploadFile | None = None):
    """
    Create new Course
    """
    course = Course(name=name, mini_description=mini_description, description=description, org_id=org_id, public=public , thumbnail="" , chapters=[], learnings=[]) 
    return await create_course(course, org_id ,  current_user, thumbnail)

@router.put("/thumbnail/{course_id}")
async def api_create_course_thumbnail(course_id : str, thumbnail: UploadFile | None = None,   current_user: PublicUser = Depends(get_current_user)):
    """
    Update new Course Thumbnail
    """
    return await update_course_thumbnail(course_id,  current_user, thumbnail)


@router.get("/{course_id}")
async def api_get_course(course_id: str, org_id : str,  current_user: PublicUser = Depends(get_current_user)):
    """
    Get single Course by course_id
    """
    return await get_course(course_id, org_id,current_user=current_user)


@router.get("/{org_id}/page/{page}/limit/{limit}")
async def api_get_course_by(page: int, limit: int, org_id: str):
    """
    Get houses by page and limit
    """
    return await get_courses(page, limit, org_id)


@router.put("/{course_id}")
async def api_update_course(course_object: Course, course_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Update Course by course_id
    """
    return await update_course(course_object, course_id, current_user)


@router.delete("/{course_id}")
async def api_delete_course(course_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Delete Course by ID
    """

    return await delete_course(course_id, current_user)

# CoursesChapters


@router.post("/chapters/")
async def api_create_coursechapter(coursechapter_object: CourseChapter, course_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Create new CourseChapter
    """
    return await create_coursechapter(coursechapter_object, course_id, current_user)


@router.get("/chapters/{coursechapter_id}")
async def api_get_coursechapter(coursechapter_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get single CourseChapter by coursechapter_id
    """
    return await get_coursechapter(coursechapter_id, current_user=current_user)


@router.get("/chapters/{course_id}/page/{page}/limit/{limit}")
async def api_get_coursechapter_by(course_id: str, page: int, limit: int):
    """
    Get CourseChapters by page and limit
    """
    return await get_coursechapters(course_id, page, limit)


@router.put("/chapters/{coursechapter_id}")
async def api_update_coursechapter(coursechapter_object: CourseChapter, coursechapter_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Update CourseChapters by course_id
    """
    return await update_coursechapter(coursechapter_object, coursechapter_id, current_user)


@router.delete("/chapters/{coursechapter_id}")
async def api_delete_coursechapter(coursechapter_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Delete CourseChapters by ID
    """

    return await delete_coursechapter(coursechapter_id, current_user)
