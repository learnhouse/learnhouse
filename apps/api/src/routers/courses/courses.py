from typing import List
from fastapi import APIRouter, Depends, UploadFile, Form, Request
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.courses.course_updates import (
    CourseUpdateCreate,
    CourseUpdateRead,
    CourseUpdateUpdate,
)
from src.db.users import PublicUser
from src.db.courses.courses import (
    CourseCreate,
    CourseRead,
    CourseUpdate,
    FullCourseReadWithTrail,
)
from src.security.auth import get_current_user
from src.services.courses.courses import (
    create_course,
    get_course,
    get_course_by_id,
    get_course_meta,
    get_courses_orgslug,
    update_course,
    delete_course,
    update_course_thumbnail,
)
from src.services.courses.updates import (
    create_update,
    delete_update,
    get_updates_by_course_uuid,
    update_update,
)


router = APIRouter()


@router.post("/")
async def api_create_course(
    request: Request,
    org_id: int,
    name: str = Form(),
    description: str = Form(),
    public: bool = Form(),
    learnings: str = Form(None),
    tags: str = Form(None),
    about: str = Form(),
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
    thumbnail: UploadFile | None = None,
) -> CourseRead:
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
        request, org_id, course, current_user, db_session, thumbnail
    )


@router.put("/{course_uuid}/thumbnail")
async def api_create_course_thumbnail(
    request: Request,
    course_uuid: str,
    thumbnail: UploadFile | None = None,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> CourseRead:
    """
    Update new Course Thumbnail
    """
    return await update_course_thumbnail(
        request, course_uuid, current_user, db_session, thumbnail
    )


@router.get("/{course_uuid}")
async def api_get_course(
    request: Request,
    course_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> CourseRead:
    """
    Get single Course by course_uuid
    """
    return await get_course(
        request, course_uuid, current_user=current_user, db_session=db_session
    )


@router.get("/id/{course_id}")
async def api_get_course_by_id(
    request: Request,
    course_id: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> CourseRead:
    """
    Get single Course by id
    """
    return await get_course_by_id(
        request, course_id, current_user=current_user, db_session=db_session
    )


@router.get("/{course_uuid}/meta")
async def api_get_course_meta(
    request: Request,
    course_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> FullCourseReadWithTrail:
    """
    Get single Course Metadata (chapters, activities) by course_uuid
    """
    return await get_course_meta(
        request, course_uuid, current_user=current_user, db_session=db_session
    )


@router.get("/org_slug/{org_slug}/page/{page}/limit/{limit}")
async def api_get_course_by_orgslug(
    request: Request,
    page: int,
    limit: int,
    org_slug: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[CourseRead]:
    """
    Get courses by page and limit
    """
    return await get_courses_orgslug(
        request, current_user, org_slug, db_session, page, limit
    )


@router.put("/{course_uuid}")
async def api_update_course(
    request: Request,
    course_object: CourseUpdate,
    course_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> CourseRead:
    """
    Update Course by course_uuid
    """
    return await update_course(
        request, course_object, course_uuid, current_user, db_session
    )


@router.delete("/{course_uuid}")
async def api_delete_course(
    request: Request,
    course_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Delete Course by ID
    """

    return await delete_course(request, course_uuid, current_user, db_session)


@router.get("/{course_uuid}/updates")
async def api_get_course_updates(
    request: Request,
    course_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[CourseUpdateRead]:
    """
    Get Course Updates by course_uuid
    """

    return await get_updates_by_course_uuid(
        request, course_uuid, current_user, db_session
    )


@router.post("/{course_uuid}/updates")
async def api_create_course_update(
    request: Request,
    course_uuid: str,
    update_object: CourseUpdateCreate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> CourseUpdateRead:
    """
    Create new Course Update
    """

    return await create_update(
        request, course_uuid, update_object, current_user, db_session
    )


@router.put("/{course_uuid}/update/{courseupdate_uuid}")
async def api_update_course_update(
    request: Request,
    course_uuid: str,
    courseupdate_uuid: str,
    update_object: CourseUpdateUpdate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> CourseUpdateRead:
    """
    Update Course Update by courseupdate_uuid
    """

    return await update_update(
        request, courseupdate_uuid, update_object, current_user, db_session
    )


@router.delete("/{course_uuid}/update/{courseupdate_uuid}")
async def api_delete_course_update(
    request: Request,
    course_uuid: str,
    courseupdate_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Delete Course Update by courseupdate_uuid
    """

    return await delete_update(request, courseupdate_uuid, current_user, db_session)
