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

router = APIRouter()


@router.post(
    "/",
    response_model=ActivityRead,
    summary="Create activity",
    description="Create a new activity inside a chapter. The authenticated user must have permission to edit the parent course.",
    responses={
        200: {"description": "Activity created and returned.", "model": ActivityRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to create activities in this chapter"},
        404: {"description": "Parent chapter or course not found"},
    },
)
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


@router.get(
    "/{activity_uuid}/versions",
    response_model=List[ActivityVersionRead],
    summary="List activity versions",
    description="Get the version history for an activity, ordered newest first. Supports pagination via limit and offset.",
    responses={
        200: {"description": "List of activity versions.", "model": List[ActivityVersionRead]},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view this activity's versions"},
        404: {"description": "Activity not found"},
    },
)
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


@router.get(
    "/{activity_uuid}/versions/{version_number}",
    response_model=ActivityVersionRead,
    summary="Get activity version",
    description="Get a specific historical version of an activity by its version number.",
    responses={
        200: {"description": "Activity version returned.", "model": ActivityVersionRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view this activity version"},
        404: {"description": "Activity or version not found"},
    },
)
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


@router.get(
    "/{activity_uuid}/state",
    response_model=ActivityStateRead,
    summary="Get activity state",
    description="Get the current state of an activity for conflict detection. Returns lightweight info (update_date, current_version, last_modified_by) used by the frontend to detect remote changes.",
    responses={
        200: {"description": "Current activity state.", "model": ActivityStateRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view this activity"},
        404: {"description": "Activity not found"},
    },
)
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


@router.post(
    "/{activity_uuid}/versions/{version_number}/restore",
    response_model=ActivityRead,
    summary="Restore activity version",
    description="Restore an activity to a previous version. Creates a new version with the restored content rather than rewriting history.",
    responses={
        200: {"description": "Activity restored; returns the updated activity.", "model": ActivityRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to restore this activity"},
        404: {"description": "Activity or version not found"},
    },
)
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


@router.get(
    "/{activity_uuid}",
    response_model=ActivityRead,
    summary="Get activity by UUID",
    description="Get a single activity by its UUID.",
    responses={
        200: {"description": "Activity returned.", "model": ActivityRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view this activity"},
        404: {"description": "Activity not found"},
    },
)
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

@router.get(
    "/id/{activity_id}",
    response_model=ActivityRead,
    summary="Get activity by ID",
    description="Get a single activity by its numeric database ID.",
    responses={
        200: {"description": "Activity returned.", "model": ActivityRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view this activity"},
        404: {"description": "Activity not found"},
    },
)
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

@router.get(
    "/chapter/{chapter_id}",
    response_model=List[ActivityRead],
    summary="List chapter activities",
    description="Get all activities that belong to the given chapter, in their configured order.",
    responses={
        200: {"description": "List of activities for the chapter.", "model": List[ActivityRead]},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view this chapter"},
        404: {"description": "Chapter not found"},
    },
)
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


@router.put(
    "/{activity_uuid}",
    response_model=ActivityRead,
    summary="Update activity",
    description="Update an activity's fields by its UUID. Creates a new version when content changes.",
    responses={
        200: {"description": "Activity updated and returned.", "model": ActivityRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to update this activity"},
        404: {"description": "Activity not found"},
    },
)
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


@router.delete(
    "/{activity_uuid}",
    summary="Delete activity",
    description="Delete an activity by its UUID. The authenticated user must have permission to edit the parent course.",
    responses={
        200: {"description": "Activity deleted."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to delete this activity"},
        404: {"description": "Activity not found"},
    },
)
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


@router.post(
    "/video",
    response_model=ActivityRead,
    summary="Create video activity",
    description="Create a new video activity by uploading a video file. The video is stored and attached to the given chapter.",
    responses={
        200: {"description": "Video activity created and returned.", "model": ActivityRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to create activities in this chapter"},
        404: {"description": "Chapter not found"},
    },
)
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


@router.post(
    "/external_video",
    response_model=ActivityRead,
    summary="Create external video activity",
    description="Create a new activity that embeds an externally hosted video (e.g. YouTube, Vimeo) instead of uploading a file.",
    responses={
        200: {"description": "External video activity created and returned.", "model": ActivityRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to create activities in this chapter"},
        404: {"description": "Chapter not found"},
    },
)
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


@router.post(
    "/documentpdf",
    response_model=ActivityRead,
    summary="Create PDF document activity",
    description="Create a new activity by uploading a PDF document. The file is stored and attached to the given chapter.",
    responses={
        200: {"description": "PDF activity created and returned.", "model": ActivityRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to create activities in this chapter"},
        404: {"description": "Chapter not found"},
    },
)
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
