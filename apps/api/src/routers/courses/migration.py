"""API endpoints for content migration from other LMS platforms."""

from typing import Optional
from fastapi import APIRouter, Request, UploadFile, File, Depends, Query
from sqlmodel import Session

from src.db.users import PublicUser, AnonymousUser
from src.security.auth import get_current_user
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


@router.post("/migrate/upload", response_model=MigrationUploadResponse)
async def api_upload_migration_files(
    request: Request,
    org_id: int,
    files: list[UploadFile] = File(...),
    temp_id: Optional[str] = Query(None),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    """Upload files for content migration. Pass temp_id to append to existing upload."""
    return await upload_migration_files(files, existing_temp_id=temp_id)


@router.post("/migrate/suggest", response_model=MigrationTreeStructure)
async def api_suggest_structure(
    request: Request,
    org_id: int,
    body: SuggestStructureRequest,
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    """Use AI to suggest a course structure from uploaded files."""
    return await suggest_structure(
        temp_id=body.temp_id,
        course_name=body.course_name,
        description=body.description,
    )


@router.post("/migrate/create", response_model=MigrationCreateResult)
async def api_create_from_migration(
    request: Request,
    org_id: int,
    body: CreateFromMigrationRequest,
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Create a course from the finalized migration tree structure."""
    return await create_course_from_migration(
        org_id=org_id,
        current_user=current_user,
        db_session=db_session,
        temp_id=body.temp_id,
        structure=body.structure,
    )
