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
    get_user_certificates_for_course,
    get_certificate_by_user_certification_uuid,
    get_all_user_certificates,
)

router = APIRouter()


@router.post(
    "/",
    response_model=CertificationRead,
    summary="Create certification",
    description="Create a new certification template for a course. Certifications are awarded when a learner completes the course.",
    responses={
        200: {"description": "Certification created.", "model": CertificationRead},
        403: {"description": "Caller lacks permission to create certifications on this course"},
        404: {"description": "Course not found"},
    },
)
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


@router.get(
    "/{certification_uuid}",
    response_model=CertificationRead,
    summary="Get certification",
    description="Get a single certification template by its UUID.",
    responses={
        200: {"description": "Certification details.", "model": CertificationRead},
        404: {"description": "Certification not found"},
    },
)
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


@router.get(
    "/course/{course_uuid}",
    response_model=List[CertificationRead],
    summary="List course certifications",
    description="Get all certification templates attached to a course.",
    responses={
        200: {"description": "List of certifications for the course."},
        404: {"description": "Course not found"},
    },
)
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


@router.put(
    "/{certification_uuid}",
    response_model=CertificationRead,
    summary="Update certification",
    description="Update a certification template by its UUID.",
    responses={
        200: {"description": "Certification updated.", "model": CertificationRead},
        403: {"description": "Caller lacks permission to update this certification"},
        404: {"description": "Certification not found"},
    },
)
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


@router.delete(
    "/{certification_uuid}",
    summary="Delete certification",
    description="Delete a certification template by its UUID. Existing awarded certificates are not removed.",
    responses={
        200: {"description": "Certification deleted."},
        403: {"description": "Caller lacks permission to delete this certification"},
        404: {"description": "Certification not found"},
    },
)
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


@router.get(
    "/user/course/{course_uuid}",
    summary="List my certificates for course",
    description="Get all certificates awarded to the current user for a specific course, including certification details.",
    responses={
        200: {"description": "List of the user's certificates for the course."},
        404: {"description": "Course not found"},
    },
)
async def api_get_user_certificates_for_course(
    request: Request,
    course_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[dict]:
    """
    Get all certificates for the current user in a specific course with certification details
    """
    return await get_user_certificates_for_course(
        request, course_uuid, current_user, db_session
    )


@router.get(
    "/certificate/{user_certification_uuid}",
    summary="Get awarded certificate",
    description="Get an awarded certificate by its user_certification UUID, with linked certification and course details.",
    responses={
        200: {"description": "Awarded certificate with linked certification and course."},
        404: {"description": "Certificate not found"},
    },
)
async def api_get_certificate_by_user_certification_uuid(
    request: Request,
    user_certification_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> dict:
    """
    Get a certificate by user_certification_uuid with certification and course details
    """
    return await get_certificate_by_user_certification_uuid(
        request, user_certification_uuid, current_user, db_session
    )


@router.get(
    "/user/all",
    summary="List my certificates",
    description="Get every certificate awarded to the current user across all courses, with complete linked information.",
    responses={
        200: {"description": "All certificates awarded to the current user."},
    },
)
async def api_get_all_user_certificates(
    request: Request,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[dict]:
    """
    Get all certificates obtained by the current user with complete linked information
    """
    return await get_all_user_certificates(
        request, current_user, db_session
    ) 