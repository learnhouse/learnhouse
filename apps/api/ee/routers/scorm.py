"""
SCORM API Router
Handles SCORM package upload, analysis, import, content serving, and runtime API
"""

import mimetypes
import os
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.courses.activities import ActivityRead
from src.db.courses.courses import Course
from src.db.organization_config import OrganizationConfig
from ee.db.scorm import (
    ScormAnalysisResponse,
    ScormImportRequest,
    ScormCourseImportRequest,
    ScormCourseImportResponse,
    ScormRuntimeDataRead,
    ScormRuntimeDataUpdate,
)
from src.db.users import PublicUser
from src.security.auth import get_current_user
from ee.services.scorm.scorm import (
    analyze_scorm_package,
    analyze_scorm_for_course_import,
    import_scorm_package,
    import_scorm_as_new_course,
    get_scorm_content_path,
)
from ee.services.scorm.scorm_runtime import (
    initialize_scorm_session,
    commit_scorm_data,
    terminate_scorm_session,
    get_runtime_data,
    update_runtime_data,
)

router = APIRouter()


def check_enterprise_plan(org_id: int, db_session) -> None:
    """
    Check if the organization has an enterprise plan.
    SCORM import is only available for enterprise plan organizations.
    In EE mode all orgs are allowed regardless of DB plan.
    In OSS mode all orgs are blocked (SCORM is EE-only).
    """
    from src.core.deployment_mode import get_deployment_mode
    mode = get_deployment_mode()
    if mode == 'ee':
        return
    if mode == 'oss':
        raise HTTPException(
            status_code=403,
            detail="SCORM is not available in OSS mode. Enterprise Edition is required."
        )
    # SaaS — check plan
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    org_config = db_session.exec(statement).first()

    if org_config is None:
        raise HTTPException(
            status_code=404,
            detail="Organization configuration not found"
        )

    config = org_config.config or {}
    version = config.get("config_version", "1.0")
    plan = config.get("plan", "free") if version.startswith("2") else config.get("cloud", {}).get("plan", "free")
    if plan != "enterprise":
        raise HTTPException(
            status_code=403,
            detail="SCORM import is only available for enterprise plan organizations"
        )


def get_org_id_from_course(course_uuid: str, db_session) -> int:
    """Get organization ID from course UUID."""
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    return course.org_id


def validate_course_uuid(course_uuid: str) -> None:
    """Validate that course_uuid has the correct format."""
    if not course_uuid or not course_uuid.startswith("course_"):
        raise HTTPException(
            status_code=400,
            detail="Invalid course_uuid format. Expected format: course_<uuid>"
        )


def validate_activity_uuid(activity_uuid: str) -> None:
    """Validate that activity_uuid has the correct format."""
    if not activity_uuid or not activity_uuid.startswith("activity_"):
        raise HTTPException(
            status_code=400,
            detail="Invalid activity_uuid format. Expected format: activity_<uuid>"
        )


# ==================== Package Analysis & Import ====================

@router.post(
    "/analyze/{course_uuid}",
    response_model=ScormAnalysisResponse,
    summary="Analyze a SCORM package",
    description=(
        "Upload and analyze a SCORM package without importing it. Returns the list "
        "of detected SCOs with their details. The package is stored temporarily for "
        "a subsequent import call. Requires Enterprise plan."
    ),
    responses={
        200: {"description": "Detected SCO listing and temporary package id.", "model": ScormAnalysisResponse},
        400: {"description": "Invalid course_uuid format"},
        401: {"description": "Authentication required"},
        403: {"description": "SCORM not available outside Enterprise plan"},
        404: {"description": "Course or organization config not found"},
    },
)
async def api_analyze_scorm_package(
    request: Request,
    course_uuid: str,
    scorm_file: UploadFile,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ScormAnalysisResponse:
    """
    Upload and analyze a SCORM package without importing.
    Returns list of detected SCOs with their details.
    The package is stored temporarily for subsequent import.

    Requires enterprise plan.
    """
    validate_course_uuid(course_uuid)
    org_id = get_org_id_from_course(course_uuid, db_session)
    check_enterprise_plan(org_id, db_session)
    return await analyze_scorm_package(
        request=request,
        scorm_file=scorm_file,
        current_user=current_user,
        db_session=db_session,
        course_uuid=course_uuid,
    )


@router.post(
    "/import/{course_uuid}",
    response_model=List[ActivityRead],
    summary="Import an analyzed SCORM package",
    description=(
        "Import a previously analyzed SCORM package with chapter assignments, "
        "creating one activity per SCO assignment. Requires Enterprise plan."
    ),
    responses={
        200: {"description": "List of activities created from the SCORM package."},
        400: {"description": "Invalid course_uuid format"},
        401: {"description": "Authentication required"},
        403: {"description": "SCORM not available outside Enterprise plan"},
        404: {"description": "Course or organization config not found"},
    },
)
async def api_import_scorm_package(
    request: Request,
    course_uuid: str,
    import_request: ScormImportRequest,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> List[ActivityRead]:
    """
    Import an analyzed SCORM package with chapter assignments.
    Creates one activity per SCO assignment.

    Requires enterprise plan.
    """
    validate_course_uuid(course_uuid)
    org_id = get_org_id_from_course(course_uuid, db_session)
    check_enterprise_plan(org_id, db_session)
    return await import_scorm_package(
        request=request,
        temp_package_id=import_request.temp_package_id,
        sco_assignments=import_request.sco_assignments,
        current_user=current_user,
        db_session=db_session,
        course_uuid=course_uuid,
    )


# ==================== Course Import ====================

@router.post(
    "/analyze-for-import/{org_id}",
    response_model=ScormAnalysisResponse,
    summary="Analyze a SCORM package for new-course import",
    description=(
        "Upload and analyze a SCORM package to prepare it for importing as a new "
        "course. Returns the detected SCOs; the package is stored temporarily for "
        "a subsequent course-import call. Requires Enterprise plan."
    ),
    responses={
        200: {"description": "Detected SCO listing and temporary package id.", "model": ScormAnalysisResponse},
        401: {"description": "Authentication required"},
        403: {"description": "SCORM not available outside Enterprise plan"},
        404: {"description": "Organization config not found"},
    },
)
async def api_analyze_scorm_for_course_import(
    request: Request,
    org_id: int,
    scorm_file: UploadFile,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ScormAnalysisResponse:
    """
    Upload and analyze a SCORM package for course import.
    Returns list of detected SCOs with their details.
    The package is stored temporarily for subsequent import.

    Requires enterprise plan.
    """
    check_enterprise_plan(org_id, db_session)
    return await analyze_scorm_for_course_import(
        request=request,
        scorm_file=scorm_file,
        current_user=current_user,
        db_session=db_session,
        org_id=org_id,
    )


@router.post(
    "/import-as-course",
    response_model=ScormCourseImportResponse,
    summary="Import a SCORM package as a new course",
    description=(
        "Create a new course, its chapters, and its activities from a previously "
        "analyzed SCORM package. Requires Enterprise plan."
    ),
    responses={
        200: {"description": "Newly created course and activity metadata.", "model": ScormCourseImportResponse},
        401: {"description": "Authentication required"},
        403: {"description": "SCORM not available outside Enterprise plan"},
        404: {"description": "Organization config not found"},
    },
)
async def api_import_scorm_as_course(
    request: Request,
    import_request: ScormCourseImportRequest,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ScormCourseImportResponse:
    """
    Import a SCORM package as a new course.
    Creates the course, chapters, and activities from the SCORM package.

    Requires enterprise plan.
    """
    check_enterprise_plan(import_request.org_id, db_session)

    result = await import_scorm_as_new_course(
        request=request,
        org_id=import_request.org_id,
        temp_package_id=import_request.temp_package_id,
        course_name=import_request.course_name,
        course_description=import_request.course_description or "",
        sco_assignments=[
            {
                "sco_identifier": a.sco_identifier,
                "activity_name": a.activity_name,
                "chapter_name": a.chapter_name,
            }
            for a in import_request.sco_assignments
        ],
        current_user=current_user,
        db_session=db_session,
    )
    return ScormCourseImportResponse(**result)


# ==================== Content Serving ====================

@router.get(
    "/{activity_uuid}/content/{file_path:path}",
    summary="Serve a SCORM content file",
    description=(
        "Serve SCORM content files. The file_path parameter captures the full "
        "path within the SCORM package. Requires authentication for non-public "
        "courses; public + published courses allow anonymous access so SCORM "
        "sub-resources (JS, CSS, images) can load without per-request tokens."
    ),
    responses={
        200: {
            "description": "Binary or text content of the requested SCORM asset.",
            "content": {"application/octet-stream": {}},
        },
        400: {"description": "Invalid activity_uuid format"},
        401: {"description": "Authentication required for non-public course"},
        403: {"description": "Resolved path escapes the activity content directory"},
        404: {"description": "Activity, organization, course, or file not found"},
    },
)
async def api_get_scorm_content(
    request: Request,
    activity_uuid: str,
    file_path: str,
    current_user=Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Serve SCORM content files.
    The file_path parameter captures the full path within the SCORM package.

    SECURITY: Requires authentication for non-public courses.
    Public+published courses allow anonymous access so SCORM sub-resources
    (JS, CSS, images) can load without per-request tokens.
    """
    from sqlmodel import select
    from src.db.courses.activities import Activity
    from src.db.organizations import Organization
    from src.db.courses.courses import Course
    from src.db.users import AnonymousUser

    validate_activity_uuid(activity_uuid)

    # Get activity
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Get organization
    statement = select(Organization).where(Organization.id == activity.org_id)
    organization = db_session.exec(statement).first()

    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Get course
    statement = select(Course).where(Course.id == activity.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # SECURITY: Check access — allow public courses, require auth otherwise
    if not course.public:
        if isinstance(current_user, AnonymousUser):
            raise HTTPException(status_code=401, detail="Authentication required")

    # Use DB-fetched activity_uuid (not the raw URL param) to avoid path taint from user input.
    db_activity_uuid = activity.activity_uuid

    # Get the content file path
    content_path = get_scorm_content_path(
        org_uuid=organization.org_uuid,
        course_uuid=course.course_uuid,
        activity_uuid=db_activity_uuid,
        file_path=file_path,
    )

    if not content_path:
        raise HTTPException(status_code=404, detail="File not found")

    # Defense-in-depth: re-verify the returned path stays within the expected
    # base directory even after get_scorm_content_path's own containment check.
    # This makes the path validation visible in this scope for static analysis.
    _base = Path(f"content/orgs/{organization.org_uuid}/courses/{course.course_uuid}/activities/{db_activity_uuid}/scorm/extracted").resolve()
    _resolved = Path(content_path).resolve()
    if not str(_resolved).startswith(str(_base) + os.sep):
        raise HTTPException(status_code=403, detail="Access denied")

    # Determine content type
    content_type, _ = mimetypes.guess_type(content_path)
    if not content_type:
        content_type = "application/octet-stream"

    # Set appropriate headers for SCORM content
    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }

    # For HTML files, set proper content type and allow scripts
    if content_type == "text/html":
        headers["X-Content-Type-Options"] = "nosniff"

    from src.services.courses.transfer.storage_utils import is_s3_enabled, read_file_content

    if is_s3_enabled():
        # Serve from S3
        file_content = read_file_content(content_path)
        if not file_content:
            raise HTTPException(status_code=404, detail="File not found")

        return StreamingResponse(
            iter([file_content]),
            media_type=content_type,
            headers=headers,
        )
    else:
        return FileResponse(
            path=content_path,
            media_type=content_type,
            headers=headers,
        )


# ==================== Runtime API ====================

@router.post(
    "/{activity_uuid}/runtime/initialize",
    summary="Initialize a SCORM session",
    description=(
        "Initialize a SCORM runtime session. Returns initial CMI data based on the "
        "SCORM version and any stored data for the current user."
    ),
    responses={
        200: {"description": "Initial CMI data for the session."},
        400: {"description": "Invalid activity_uuid format"},
        401: {"description": "Authentication required"},
    },
)
async def api_initialize_scorm_session(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> dict:
    """
    Initialize a SCORM session.
    Returns initial CMI data based on SCORM version and any stored data.
    """
    validate_activity_uuid(activity_uuid)
    return await initialize_scorm_session(
        request=request,
        activity_uuid=activity_uuid,
        current_user=current_user,
        db_session=db_session,
    )


@router.post(
    "/{activity_uuid}/runtime/commit",
    summary="Commit SCORM runtime data",
    description=(
        "Commit (save) SCORM runtime data for the current session. Called when the "
        "SCORM content invokes LMSCommit() or Commit()."
    ),
    responses={
        200: {"description": "Acknowledgement that the CMI data was stored."},
        400: {"description": "Invalid activity_uuid format"},
        401: {"description": "Authentication required"},
    },
)
async def api_commit_scorm_data(
    request: Request,
    activity_uuid: str,
    cmi_data: dict,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> dict:
    """
    Commit (save) SCORM runtime data.
    Called when the SCORM content calls LMSCommit() or Commit().
    """
    validate_activity_uuid(activity_uuid)
    return await commit_scorm_data(
        request=request,
        activity_uuid=activity_uuid,
        cmi_data=cmi_data,
        current_user=current_user,
        db_session=db_session,
    )


@router.post(
    "/{activity_uuid}/runtime/terminate",
    summary="Terminate a SCORM session",
    description=(
        "Terminate a SCORM runtime session. Called when the SCORM content invokes "
        "LMSFinish() or Terminate(). Optionally accepts final CMI data to commit."
    ),
    responses={
        200: {"description": "Session terminated and any final CMI data committed."},
        400: {"description": "Invalid activity_uuid format"},
        401: {"description": "Authentication required"},
    },
)
async def api_terminate_scorm_session(
    request: Request,
    activity_uuid: str,
    cmi_data: dict = None,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> dict:
    """
    Terminate a SCORM session.
    Called when the SCORM content calls LMSFinish() or Terminate().
    Optionally accepts final CMI data to commit.
    """
    validate_activity_uuid(activity_uuid)
    return await terminate_scorm_session(
        request=request,
        activity_uuid=activity_uuid,
        cmi_data=cmi_data or {},
        current_user=current_user,
        db_session=db_session,
    )


@router.get(
    "/{activity_uuid}/runtime/data",
    response_model=ScormRuntimeDataRead,
    summary="Get SCORM runtime data",
    description="Return SCORM runtime data for the current user and activity.",
    responses={
        200: {"description": "Stored SCORM runtime data for the user.", "model": ScormRuntimeDataRead},
        400: {"description": "Invalid activity_uuid format"},
        401: {"description": "Authentication required"},
    },
)
async def api_get_runtime_data(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ScormRuntimeDataRead:
    """
    Get SCORM runtime data for the current user and activity.
    """
    validate_activity_uuid(activity_uuid)
    return await get_runtime_data(
        request=request,
        activity_uuid=activity_uuid,
        current_user=current_user,
        db_session=db_session,
    )


@router.put(
    "/{activity_uuid}/runtime/data",
    response_model=ScormRuntimeDataRead,
    summary="Update SCORM runtime data",
    description="Update SCORM runtime data directly for the current user and activity.",
    responses={
        200: {"description": "Updated SCORM runtime data.", "model": ScormRuntimeDataRead},
        400: {"description": "Invalid activity_uuid format"},
        401: {"description": "Authentication required"},
    },
)
async def api_update_runtime_data(
    request: Request,
    activity_uuid: str,
    update_data: ScormRuntimeDataUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> ScormRuntimeDataRead:
    """
    Update SCORM runtime data directly.
    """
    validate_activity_uuid(activity_uuid)
    return await update_runtime_data(
        request=request,
        activity_uuid=activity_uuid,
        update_data=update_data,
        current_user=current_user,
        db_session=db_session,
    )
