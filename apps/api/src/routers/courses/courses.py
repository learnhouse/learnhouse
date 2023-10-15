from fastapi import APIRouter, Depends, UploadFile, Form, Request
from src.security.auth import get_current_user

from src.services.courses.courses import Course,  create_course,  get_course, get_course_meta, get_courses_orgslug, update_course, delete_course, update_course_thumbnail
from src.services.users.users import PublicUser


router = APIRouter()


@router.post("/")
async def api_create_course(request: Request, org_id: str, name: str = Form(), mini_description: str = Form(), description: str = Form(), public: bool = Form(),   current_user: PublicUser = Depends(get_current_user), thumbnail: UploadFile | None = None):
    """
    Create new Course
    """
    course = Course(name=name, mini_description=mini_description, description=description,
                    org_id=org_id, public=public, thumbnail="", chapters=[], chapters_content=[], learnings=[])
    return await create_course(request, course, org_id,  current_user, thumbnail)


@router.put("/thumbnail/{course_id}")
async def api_create_course_thumbnail(request: Request, course_id: str, thumbnail: UploadFile | None = None,   current_user: PublicUser = Depends(get_current_user)):
    """
    Update new Course Thumbnail
    """
    return await update_course_thumbnail(request, course_id,  current_user, thumbnail)


@router.get("/{course_id}")
async def api_get_course(request: Request, course_id: str,  current_user: PublicUser = Depends(get_current_user)):
    """
    Get single Course by course_id
    """
    return await get_course(request, course_id, current_user=current_user)


@router.get("/meta/{course_id}")
async def api_get_course_meta(request: Request, course_id: str,  current_user: PublicUser = Depends(get_current_user)):
    """
    Get single Course Metadata (chapters, activities) by course_id
    """
    return await get_course_meta(request, course_id, current_user=current_user)

@router.get("/org_slug/{org_slug}/page/{page}/limit/{limit}")
async def api_get_course_by_orgslug(request: Request, page: int, limit: int, org_slug: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get houses by page and limit
    """
    return await get_courses_orgslug(request, current_user, page, limit, org_slug)


@router.put("/{course_id}")
async def api_update_course(request: Request, course_object: Course, course_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Update Course by course_id
    """
    return await update_course(request, course_object, course_id, current_user)


@router.delete("/{course_id}")
async def api_delete_course(request: Request, course_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Delete Course by ID
    """

    return await delete_course(request, course_id, current_user)
