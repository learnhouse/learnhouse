from typing import List
from fastapi import APIRouter, Depends, File, Request, UploadFile
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.paths import (
    PathCoursesUpdate,
    PathCreate,
    PathLearnerRead,
    PathRead,
    PathUpdate,
)
from src.db.users import PublicUser
from src.security.api_token_utils import get_authenticated_non_api_token_user
from src.security.auth import get_current_user
from src.services.paths.paths import (
    create_path,
    delete_path,
    enroll_in_path,
    get_my_path_certificates,
    get_my_paths,
    get_path,
    get_path_certificate,
    get_path_learners,
    get_paths_for_course,
    leave_path,
    list_org_paths,
    reinstate_path_certificate,
    revoke_path_certificate,
    set_path_courses,
    update_path,
    upload_path_thumbnail,
)

router = APIRouter()

# Verification stays reachable whatever plan the org is on today: an awarded
# certificate is the holder's credential, and the link printed on it must
# keep working.
certificates_router = APIRouter()


@router.post(
    "/",
    response_model=PathRead,
    summary="Create path",
    description="Create a learning path: an ordered set of courses that awards its own certificate.",
)
async def api_create_path(
    request: Request,
    path_object: PathCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> PathRead:
    return await create_path(request, path_object, current_user, db_session)


@router.get(
    "/org/{org_id}",
    response_model=List[PathRead],
    summary="List org paths",
    description="Paths of an organization. Authors also get drafts; others get the published paths they may see.",
)
async def api_list_org_paths(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> List[PathRead]:
    return await list_org_paths(request, org_id, current_user, db_session)


@router.get(
    "/me/org/{org_id}",
    response_model=List[PathRead],
    summary="My paths",
    description="Paths the signed-in user follows in this organization, with their progress.",
)
async def api_get_my_paths(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> List[PathRead]:
    return await get_my_paths(request, org_id, current_user, db_session)


@router.get(
    "/course/{course_uuid}",
    response_model=List[PathRead],
    summary="Paths containing a course",
)
async def api_get_paths_for_course(
    request: Request,
    course_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> List[PathRead]:
    return await get_paths_for_course(request, course_uuid, current_user, db_session)


@router.get("/{path_uuid}", response_model=PathRead, summary="Get path")
async def api_get_path(
    request: Request,
    path_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> PathRead:
    return await get_path(request, path_uuid, current_user, db_session)


@router.put("/{path_uuid}", response_model=PathRead, summary="Update path")
async def api_update_path(
    request: Request,
    path_uuid: str,
    path_object: PathUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> PathRead:
    return await update_path(request, path_uuid, path_object, current_user, db_session)


@router.put(
    "/{path_uuid}/courses",
    response_model=PathRead,
    summary="Set path courses",
    description="Replace the path's courses with this ordered list. Position follows array order.",
)
async def api_set_path_courses(
    request: Request,
    path_uuid: str,
    payload: PathCoursesUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> PathRead:
    return await set_path_courses(request, path_uuid, payload, current_user, db_session)


@router.put("/{path_uuid}/thumbnail", response_model=PathRead, summary="Upload path thumbnail")
async def api_upload_path_thumbnail(
    request: Request,
    path_uuid: str,
    thumbnail: UploadFile = File(...),
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> PathRead:
    return await upload_path_thumbnail(request, path_uuid, thumbnail, current_user, db_session)


@router.delete("/{path_uuid}", summary="Delete path")
async def api_delete_path(
    request: Request,
    path_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await delete_path(request, path_uuid, current_user, db_session)


@router.post("/{path_uuid}/enroll", response_model=PathRead, summary="Start path")
async def api_enroll_in_path(
    request: Request,
    path_uuid: str,
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> PathRead:
    return await enroll_in_path(request, path_uuid, current_user, db_session)


@router.delete("/{path_uuid}/enroll", summary="Leave path")
async def api_leave_path(
    request: Request,
    path_uuid: str,
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await leave_path(request, path_uuid, current_user, db_session)


@router.get(
    "/{path_uuid}/learners",
    response_model=List[PathLearnerRead],
    summary="Path learners",
    description="Everyone following the path, with their progress and certificate.",
)
async def api_get_path_learners(
    request: Request,
    path_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> List[PathLearnerRead]:
    return await get_path_learners(request, path_uuid, current_user, db_session)


@router.delete(
    "/{path_uuid}/certificates/{certificate_uuid}",
    summary="Revoke path certificate",
)
async def api_revoke_path_certificate(
    request: Request,
    path_uuid: str,
    certificate_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await revoke_path_certificate(request, path_uuid, certificate_uuid, current_user, db_session)


@router.post(
    "/{path_uuid}/certificates/{certificate_uuid}/reinstate",
    summary="Reinstate path certificate",
    description="Undo a revocation: the certificate verifies again with its original ID and date.",
)
async def api_reinstate_path_certificate(
    request: Request,
    path_uuid: str,
    certificate_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await reinstate_path_certificate(request, path_uuid, certificate_uuid, current_user, db_session)


@certificates_router.get("/certificates/me", summary="My path certificates")
async def api_get_my_path_certificates(
    request: Request,
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> List[dict]:
    return await get_my_path_certificates(request, current_user, db_session)


@certificates_router.get(
    "/certificates/{certificate_uuid}",
    summary="Verify path certificate",
    description="Public: returns the certificate, its path and holder name so anyone with the link can verify it.",
)
async def api_get_path_certificate(
    request: Request,
    certificate_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await get_path_certificate(request, certificate_uuid, db_session)
