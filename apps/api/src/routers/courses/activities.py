from typing import List
from fastapi import APIRouter, Depends, UploadFile, Form, Request
from src.db.activities import ActivityCreate, ActivityRead, ActivityUpdate
from src.db.users import PublicUser
from src.core.events.database import get_db_session
from src.services.courses.activities.activities import (
    create_activity,
    get_activity,
    get_activities,
    update_activity,
    delete_activity,
)
from src.security.auth import get_current_user
from src.services.courses.activities.pdf import create_documentpdf_activity
from src.services.courses.activities.video import (
    ExternalVideo,
    create_external_video_activity,
    create_video_activity,
)

router = APIRouter()


@router.post("/")
async def api_create_activity(
    request: Request,
    activity_object: ActivityCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ActivityRead:
    """
    Create new activity
    """
    return await create_activity(request, activity_object, current_user, db_session)


@router.get("/{activity_id}")
async def api_get_activity(
    request: Request,
    activity_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ActivityRead:
    """
    Get single activity by activity_id
    """
    return await get_activity(
        request, activity_id, current_user=current_user, db_session=db_session
    )


@router.get("/chapter/{chapter_id}")
async def api_get_chapter_activities(
    request: Request,
    chapter_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> List[ActivityRead]:
    """
    Get Activities for a chapter
    """
    return await get_activities(request, chapter_id, current_user, db_session)


@router.put("/{activity_id}")
async def api_update_activity(
    request: Request,
    activity_object: ActivityUpdate,
    activity_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ActivityRead:
    """
    Update activity by activity_id
    """
    return await update_activity(
        request, activity_object, activity_id, current_user, db_session
    )


@router.delete("/{activity_id}")
async def api_delete_activity(
    request: Request,
    activity_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Delete activity by activity_id
    """
    return await delete_activity(request, activity_id, current_user, db_session)


# Video activity


@router.post("/video")
async def api_create_video_activity(
    request: Request,
    name: str = Form(),
    chapter_id: str = Form(),
    current_user: PublicUser = Depends(get_current_user),
    video_file: UploadFile | None = None,
    db_session=Depends(get_db_session),
) -> ActivityRead:
    """
    Create new activity
    """
    return await create_video_activity(
        request,
        name,
        chapter_id,
        current_user,
        db_session,
        video_file,
    )


@router.post("/external_video")
async def api_create_external_video_activity(
    request: Request,
    external_video: ExternalVideo,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ActivityRead:
    """
    Create new activity
    """
    return await create_external_video_activity(
        request, current_user, external_video, db_session
    )


@router.post("/documentpdf")
async def api_create_documentpdf_activity(
    request: Request,
    name: str = Form(),
    chapter_id: str = Form(),
    current_user: PublicUser = Depends(get_current_user),
    pdf_file: UploadFile | None = None,
    db_session=Depends(get_db_session),
) -> ActivityRead:
    """
    Create new activity
    """
    return await create_documentpdf_activity(
        request, name, chapter_id, current_user, db_session, pdf_file
    )
