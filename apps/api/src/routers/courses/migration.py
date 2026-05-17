"""API endpoints for content migration from other LMS platforms."""

from typing import Optional
from fastapi import APIRouter, Request, UploadFile, File, Depends, Query, HTTPException


from src.db.users import PublicUser, AnonymousUser
from src.security.auth import get_current_user, get_authenticated_user
from sqlmodel.ext.asyncio.session import AsyncSession
from src.core.events.database import get_db_session
from src.services.courses.migration.models import (
    MigrationUploadResponse,
    MigrationTreeStructure,
    SuggestStructureRequest,
    CreateFromMigrationRequest,
    MigrationCreateResult,
)
from src.services.courses.migration.migration_service import (
    upload_migration_files,
    suggest_structure,
    create_course_from_migration,
)

router = APIRouter()


def _migration_value_error_to_http(err: ValueError) -> HTTPException:
    """
    Translate the migration service's user-input ValueErrors into proper HTTP
    responses. The service raises bare ValueError so it stays usable outside an
    HTTP context (and for test backwards-compatibility); the router maps the
    well-known messages to 400/404 instead of letting them bubble to a 500.
    """
    msg = str(err)
    if "not found" in msg.lower():
        return HTTPException(status_code=404, detail=msg)
    if msg.startswith("Invalid"):
        return HTTPException(status_code=400, detail=msg)
    return HTTPException(status_code=400, detail=msg)


@router.post(
    "/migrate/upload",
    response_model=MigrationUploadResponse,
    summary="Upload migration files",
    description=(
        "Upload files for content migration from another LMS. "
        "Pass an existing `temp_id` to append additional files to a prior upload."
    ),
    responses={
        200: {"description": "Files uploaded; returns the temporary upload id.", "model": MigrationUploadResponse},
        400: {"description": "Uploaded files are invalid or unsupported"},
    },
)
async def api_upload_migration_files(
    request: Request,
    org_id: int,
    files: list[UploadFile] = File(...),
    temp_id: Optional[str] = Query(None),
    current_user: PublicUser = Depends(get_authenticated_user),
):
    """Upload files for content migration. Pass temp_id to append to existing upload."""
    try:
        return await upload_migration_files(files, existing_temp_id=temp_id)
    except ValueError as e:
        raise _migration_value_error_to_http(e) from e


@router.post(
    "/migrate/suggest",
    response_model=MigrationTreeStructure,
    summary="Suggest migration structure",
    description="Use AI to suggest a course structure from previously uploaded migration files.",
    responses={
        200: {"description": "Suggested course tree structure based on the uploaded files.", "model": MigrationTreeStructure},
        404: {"description": "Temporary upload id not found"},
    },
)
async def api_suggest_structure(
    request: Request,
    org_id: int,
    body: SuggestStructureRequest,
    current_user: PublicUser = Depends(get_authenticated_user),
):
    """Use AI to suggest a course structure from uploaded files."""
    try:
        return await suggest_structure(
            temp_id=body.temp_id,
            course_name=body.course_name,
            description=body.description,
        )
    except ValueError as e:
        raise _migration_value_error_to_http(e) from e


@router.post(
    "/migrate/create",
    response_model=MigrationCreateResult,
    summary="Create course from migration",
    description="Create a course from the finalized migration tree structure returned by the suggest endpoint.",
    responses={
        200: {"description": "Course created from the migration payload; returns ids of created resources.", "model": MigrationCreateResult},
        400: {"description": "Invalid structure payload"},
        403: {"description": "Caller lacks permission to create courses in this org"},
        404: {"description": "Temporary upload id or referenced resources not found"},
    },
)
async def api_create_from_migration(
    request: Request,
    org_id: int,
    body: CreateFromMigrationRequest,
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Create a course from the finalized migration tree structure."""
    try:
        return await create_course_from_migration(
            org_id=org_id,
            current_user=current_user,
            db_session=db_session,
            temp_id=body.temp_id,
            structure=body.structure,
        )
    except ValueError as e:
        raise _migration_value_error_to_http(e) from e
