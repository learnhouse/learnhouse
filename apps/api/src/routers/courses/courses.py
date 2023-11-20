from fastapi import APIRouter, Depends, UploadFile, Form, Request
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.db.courses import CourseCreate, CourseUpdate
from src.security.auth import get_current_user

from src.services.courses.courses import (
    create_course,
    get_course,
    get_course_meta,
    get_courses_orgslug,
    update_course,
    delete_course,
    update_course_thumbnail,
)


router = APIRouter()


@router.post("/")
async def api_create_course(
    request: Request,
    org_id: int,
    name: str = Form(),
    description: str = Form(),
    public: bool = Form(),
    learnings: str = Form(),
    tags: str = Form(),
    about: str = Form(),
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
    thumbnail: UploadFile | None = None,
):
    """
    Create new Course
    """
    course = CourseCreate(
        name=name,
        description=description,
        org_id=org_id,
        public=public,
        thumbnail_image="",
        about=about,
        learnings=learnings,
        tags=tags,
    )
    return await create_course(
        request, course, current_user, db_session, thumbnail
    )


@router.put("/thumbnail/{course_id}")
async def api_create_course_thumbnail(
    request: Request,
    course_id: str,
    thumbnail: UploadFile | None = None,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Update new Course Thumbnail
    """
    return await update_course_thumbnail(
        request, course_id, current_user, db_session, thumbnail
    )


@router.get("/{course_id}")
async def api_get_course(
    request: Request,
    course_id: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Get single Course by course_id
    """
    return await get_course(
        request, course_id, current_user=current_user, db_session=db_session
    )


@router.get("/meta/{course_id}")
async def api_get_course_meta(
    request: Request,
    course_id: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Get single Course Metadata (chapters, activities) by course_id
    """
    return await get_course_meta(
        request, course_id, current_user=current_user, db_session=db_session
    )


@router.get("/org_slug/{org_slug}/page/{page}/limit/{limit}")
async def api_get_course_by_orgslug(
    request: Request,
    page: int,
    limit: int,
    org_slug: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Get houses by page and limit
    """
    return await get_courses_orgslug(request, current_user, page, limit, org_slug)


@router.put("/")
async def api_update_course(
    request: Request,
    course_object: CourseUpdate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Update Course by course_id
    """
    return await update_course(request, course_object, current_user, db_session)


@router.delete("/{course_id}")
async def api_delete_course(
    request: Request,
    course_id: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Delete Course by ID
    """

    return await delete_course(request, course_id, current_user, db_session)
