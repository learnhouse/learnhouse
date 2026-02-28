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
    """
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    org_config = db_session.exec(statement).first()

    if org_config is None:
        raise HTTPException(
            status_code=404,
            detail="Organization configuration not found"
        )

    plan = org_config.config.get("cloud", {}).get("plan", "free")
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

@router.post("/analyze/{course_uuid}", response_model=ScormAnalysisResponse)
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


@router.post("/import/{course_uuid}", response_model=List[ActivityRead])
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

@router.post("/analyze-for-import/{org_id}", response_model=ScormAnalysisResponse)
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


@router.post("/import-as-course", response_model=ScormCourseImportResponse)
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

@router.get("/{activity_uuid}/content/{file_path:path}")
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

    # Get the content file path
    content_path = get_scorm_content_path(
        org_uuid=organization.org_uuid,
        course_uuid=course.course_uuid,
        activity_uuid=activity_uuid,
        file_path=file_path,
    )

    if not content_path:
        raise HTTPException(status_code=404, detail="File not found")

    # Defense-in-depth: re-verify the returned path stays within the expected
    # base directory even after get_scorm_content_path's own containment check.
    # This makes the path validation visible in this scope for static analysis.
    _base = Path(f"content/orgs/{organization.org_uuid}/courses/{course.course_uuid}/activities/{activity_uuid}/scorm/extracted").resolve()
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

@router.post("/{activity_uuid}/runtime/initialize")
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


@router.post("/{activity_uuid}/runtime/commit")
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


@router.post("/{activity_uuid}/runtime/terminate")
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


@router.get("/{activity_uuid}/runtime/data", response_model=ScormRuntimeDataRead)
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


@router.put("/{activity_uuid}/runtime/data", response_model=ScormRuntimeDataRead)
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
