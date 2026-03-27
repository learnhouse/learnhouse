from typing import List
from fastapi import APIRouter, Depends, UploadFile, Form, Request, Query
from src.db.courses.activities import ActivityCreate, ActivityRead, ActivityUpdate
from src.db.courses.activity_versions import ActivityVersionRead, ActivityStateRead
from src.db.users import PublicUser
from src.core.events.database import get_db_session
from src.services.courses.activities.activities import (
    create_activity,
    get_activity,
    get_activities,
    get_activityby_id,
    update_activity,
    delete_activity,
)
from src.services.courses.activities.versioning import (
    get_activity_versions,
    get_activity_version,
    get_activity_state,
    restore_activity_version,
)
from src.security.auth import get_current_user
from src.services.courses.activities.pdf import create_documentpdf_activity
from src.services.courses.activities.video import (
    ExternalVideo,
    create_external_video_activity,
    create_video_activity,
)
from src.services.courses.activities.live_session import (
    LiveSessionCreate,
    create_live_session_activity,
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


# Versioning endpoints - MUST be before /{activity_uuid} catch-all routes


@router.get("/{activity_uuid}/versions")
async def api_get_activity_versions(
    request: Request,
    activity_uuid: str,
    limit: int = Query(default=20, le=100),
    offset: int = Query(default=0),
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> List[ActivityVersionRead]:
    """
    Get version history for an activity.
    Returns versions in descending order (newest first).
    """
    return await get_activity_versions(
        request, activity_uuid, current_user, db_session, limit, offset
    )


@router.get("/{activity_uuid}/versions/{version_number}")
async def api_get_activity_version(
    request: Request,
    activity_uuid: str,
    version_number: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ActivityVersionRead:
    """
    Get a specific version of an activity.
    """
    return await get_activity_version(
        request, activity_uuid, version_number, current_user, db_session
    )


@router.get("/{activity_uuid}/state")
async def api_get_activity_state(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ActivityStateRead:
    """
    Get the current state of an activity for conflict detection.
    Returns lightweight info: update_date, current_version, last_modified_by.
    Used by frontend to check if remote state has changed.
    """
    return await get_activity_state(
        request, activity_uuid, current_user, db_session
    )


@router.post("/{activity_uuid}/versions/{version_number}/restore")
async def api_restore_activity_version(
    request: Request,
    activity_uuid: str,
    version_number: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ActivityRead:
    """
    Restore an activity to a specific version.
    Creates a new version with the restored content.
    """
    return await restore_activity_version(
        request, activity_uuid, version_number, current_user, db_session
    )


# Activity CRUD endpoints


@router.get("/{activity_uuid}")
async def api_get_activity(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ActivityRead:
    """
    Get single activity by activity_id
    """
    return await get_activity(
        request, activity_uuid, current_user=current_user, db_session=db_session
    )

@router.get("/id/{activity_id}")
async def api_get_activityby_id(
    request: Request,
    activity_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ActivityRead:
    """
    Get single activity by activity_id
    """
    return await get_activityby_id(
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


@router.put("/{activity_uuid}")
async def api_update_activity(
    request: Request,
    activity_object: ActivityUpdate,
    activity_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ActivityRead:
    """
    Update activity by activity_id
    """
    return await update_activity(
        request, activity_object, activity_uuid, current_user, db_session
    )


@router.delete("/{activity_uuid}")
async def api_delete_activity(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Delete activity by activity_id
    """
    return await delete_activity(request, activity_uuid, current_user, db_session)


# Video activity


@router.post("/video")
async def api_create_video_activity(
    request: Request,
    name: str = Form(),
    chapter_id: str = Form(),
    details: str = Form(default="{}"),
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
        details,
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


# Live session activity


@router.post("/live_session")
async def api_create_live_session_activity(
    request: Request,
    live_session: LiveSessionCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ActivityRead:
    """
    Create new live session activity
    """
    return await create_live_session_activity(
        request, live_session, current_user, db_session
    )
