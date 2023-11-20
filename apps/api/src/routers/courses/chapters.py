from typing import List
from fastapi import APIRouter, Depends, Request
from src.core.events.database import get_db_session
from src.db.chapters import (
    ChapterCreate,
    ChapterRead,
    ChapterUpdate,
    ChapterUpdateOrder,
    DepreceatedChaptersRead,
)
from src.services.courses.chapters import (
    create_chapter,
    delete_chapter,
    get_chapter,
    get_course_chapters,
    get_depreceated_course_chapters,
    reorder_chapters_and_activities,
    update_chapter,
)

from src.services.users.users import PublicUser
from src.security.auth import get_current_user

router = APIRouter()


@router.post("/")
async def api_create_coursechapter(
    request: Request,
    coursechapter_object: ChapterCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ChapterRead:
    """
    Create new Course Chapter
    """
    return await create_chapter(request, coursechapter_object, current_user, db_session)


@router.get("/{chapter_id}")
async def api_get_coursechapter(
    request: Request,
    chapter_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ChapterRead:
    """
    Get single CourseChapter by chapter_id
    """
    return await get_chapter(request, chapter_id, current_user, db_session)


@router.get("/meta/{course_id}")
async def api_get_chapter_meta(
    request: Request,
    course_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> DepreceatedChaptersRead:
    """
    Get Chapters metadata
    """
    return await get_depreceated_course_chapters(request, course_id, current_user, db_session)


@router.put("/order/{course_id}")
async def api_update_chapter_meta(
    request: Request,
    course_id: int,
    order: ChapterUpdateOrder,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Update Chapter metadata
    """
    return await reorder_chapters_and_activities(
        request, course_id, order, current_user, db_session
    )


@router.get("/{course_id}/page/{page}/limit/{limit}")
async def api_get_chapter_by(
    request: Request,
    course_id: int,
    page: int,
    limit: int,
    db_session=Depends(get_db_session),
) -> List[ChapterRead]:
    """
    Get Course Chapters by page and limit
    """
    return await get_course_chapters(request, course_id, db_session, page, limit)


@router.put("/{coursechapter_id}")
async def api_update_coursechapter(
    request: Request,
    coursechapter_object: ChapterUpdate,
    coursechapter_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ChapterRead:
    """
    Update CourseChapters by course_id
    """
    return await update_chapter(request, coursechapter_object, current_user, db_session)


@router.delete("/{coursechapter_id}")
async def api_delete_coursechapter(
    request: Request,
    coursechapter_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Delete CourseChapters by ID
    """

    return await delete_chapter(
        request, coursechapter_id, current_user, db_session
    )
