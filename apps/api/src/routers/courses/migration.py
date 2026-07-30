"""API endpoints for content migration from other LMS platforms."""

from typing import Optional
from fastapi import APIRouter, Request, UploadFile, File, Depends, Query, HTTPException

from sqlmodel import select

from src.core.redis import get_redis_client
from src.db.organizations import Organization
from src.db.users import PublicUser
from src.security.auth import get_authenticated_user, resolve_acting_user_id
from src.security.org_auth import is_org_member, enforce_org_mfa
from src.security.rbac import check_resource_access, AccessAction
from src.services.security.rate_limiting import enforce_ai_rate_limit
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

# Migration packages live under a random temp_id, but the id alone must not be
# the only thing standing between two accounts — bind each package to the user
# who created it. Kept in Redis next to the on-disk temp dir, which is itself
# swept after an hour.
MIGRATION_OWNER_KEY = "migration_upload_owner:{temp_id}"
MIGRATION_OWNER_TTL = 24 * 60 * 60


async def require_migration_org_access(
    request: Request,
    org_id: int,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> int:
    """Gate a migration endpoint on the org named in the query string.

    ``org_id`` used to be accepted and then ignored, so these handlers ran with
    no tenant check at all. Every migration step exists only to end in a course,
    so require org membership (which also applies the org's session policy) plus
    the courses create right — the same gate ``create_course`` applies.

    Returns the acting user id, for callers that need it.
    """
    statement = select(Organization).where(Organization.id == org_id)
    org = (await db_session.execute(statement)).scalars().first()

    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    user_id = resolve_acting_user_id(current_user)
    if not await is_org_member(user_id, org.id, db_session):
        raise HTTPException(status_code=403, detail="User is not a member of this organization")
    await enforce_org_mfa(user_id, org.id, db_session)

    await check_resource_access(request, db_session, current_user, "course_x", AccessAction.CREATE)
    return user_id


def claim_migration_package(temp_id: str, user_id: int) -> None:
    """Claim ``temp_id`` for ``user_id``, or refuse if someone else owns it.

    The claim is best-effort: deployments without Redis keep working exactly as
    before, since the temp id is an unguessable UUID that is only ever returned
    to its uploader.
    """
    r = get_redis_client()
    if r is None:
        return

    key = MIGRATION_OWNER_KEY.format(temp_id=temp_id)
    try:
        if r.set(key, str(user_id), nx=True, ex=MIGRATION_OWNER_TTL):
            return
        owner = r.get(key)
    except Exception:
        return

    if owner is None:
        return
    if isinstance(owner, bytes):
        owner = owner.decode("utf-8", "ignore")
    if owner != str(user_id):
        raise HTTPException(status_code=404, detail=f"Migration package not found: {temp_id}")


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
        403: {"description": "Caller is not a member of the org or lacks permission to create courses"},
        404: {"description": "Organization or temporary upload id not found"},
    },
)
async def api_upload_migration_files(
    request: Request,
    org_id: int,
    files: list[UploadFile] = File(...),
    temp_id: Optional[str] = Query(None),
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Upload files for content migration. Pass temp_id to append to existing upload."""
    user_id = await require_migration_org_access(request, org_id, current_user, db_session)

    # Appending to someone else's package must be refused before any bytes land
    # on disk.
    if temp_id:
        claim_migration_package(temp_id, user_id)

    try:
        response = await upload_migration_files(files, existing_temp_id=temp_id)
    except ValueError as e:
        raise _migration_value_error_to_http(e) from e

    claim_migration_package(response.temp_id, user_id)
    return response


@router.post(
    "/migrate/suggest",
    response_model=MigrationTreeStructure,
    summary="Suggest migration structure",
    description="Use AI to suggest a course structure from previously uploaded migration files.",
    responses={
        200: {"description": "Suggested course tree structure based on the uploaded files.", "model": MigrationTreeStructure},
        403: {"description": "Caller is not a member of the org, lacks permission to create courses, or has no AI credits"},
        404: {"description": "Organization or temporary upload id not found"},
        429: {"description": "AI rate limit exceeded"},
    },
)
async def api_suggest_structure(
    request: Request,
    org_id: int,
    body: SuggestStructureRequest,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Use AI to suggest a course structure from uploaded files."""
    user_id = await require_migration_org_access(request, org_id, current_user, db_session)
    claim_migration_package(body.temp_id, user_id)

    # This endpoint spends the server's provider key on a caller-supplied
    # prompt, so it is rate limited per user and per org like the /ai routers.
    # That is what bounds the abuse the missing authorization allowed.
    #
    # It deliberately does NOT reserve an AI credit. Metering it would be
    # consistent with the /ai routers, but it would also start refusing a call
    # that is free today — for orgs out of credits, and (via a 404 from
    # reserve_ai_credit) for orgs with no config row. Billing this belongs in
    # its own change, not in an authorization fix.
    enforce_ai_rate_limit(user_id, org_id)

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
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Create a course from the finalized migration tree structure."""
    user_id = await require_migration_org_access(request, org_id, current_user, db_session)
    claim_migration_package(body.temp_id, user_id)

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
