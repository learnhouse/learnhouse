from typing import List
from fastapi import APIRouter, Depends, Request
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.courses.certifications import (
    CertificationCreate,
    CertificationRead,
    CertificationUpdate,
)
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.courses.certifications import (
    create_certification,
    get_certification,
    get_certifications_by_course,
    update_certification,
    delete_certification,
)

router = APIRouter()


@router.post("/")
async def api_create_certification(
    request: Request,
    certification_object: CertificationCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CertificationRead:
    """
    Create new certification for a course
    """
    return await create_certification(
        request, certification_object, current_user, db_session
    )


@router.get("/{certification_uuid}")
async def api_get_certification(
    request: Request,
    certification_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CertificationRead:
    """
    Get single certification by certification_id
    """
    return await get_certification(
        request, certification_uuid, current_user, db_session
    )


@router.get("/course/{course_uuid}")
async def api_get_certifications_by_course(
    request: Request,
    course_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[CertificationRead]:
    """
    Get all certifications for a specific course
    """
    return await get_certifications_by_course(
        request, course_uuid, current_user, db_session
    )


@router.put("/{certification_uuid}")
async def api_update_certification(
    request: Request,
    certification_uuid: str,
    certification_object: CertificationUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> CertificationRead:
    """
    Update certification by certification_id
    """
    return await update_certification(
        request, certification_uuid, certification_object, current_user, db_session
    )


@router.delete("/{certification_uuid}")
async def api_delete_certification(
    request: Request,
    certification_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Delete certification by certification_id
    """
    return await delete_certification(
        request, certification_uuid, current_user, db_session
    ) 