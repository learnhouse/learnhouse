from typing import List, Literal
from uuid import uuid4
from datetime import datetime
from sqlmodel import Session, select
from fastapi import HTTPException, Request
from src.db.courses.certifications import (
    Certifications,
    CertificationCreate,
    CertificationRead,
    CertificationUpdate,
    CertificateUser,
    CertificateUserRead,
)
from src.db.courses.courses import Course
from src.db.courses.chapter_activities import ChapterActivity
from src.db.trail_steps import TrailStep
from src.db.users import PublicUser, AnonymousUser
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles_and_authorship,
    authorization_verify_if_element_is_public,
    authorization_verify_if_user_is_anon,
)


####################################################
# CRUD
####################################################


async def create_certification(
    request: Request,
    certification_object: CertificationCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> CertificationRead:
    """Create a new certification for a course"""
    
    # Check if course exists
    statement = select(Course).where(Course.id == certification_object.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "create", db_session)

    # Create certification
    certification = Certifications(
        course_id=certification_object.course_id,
        config=certification_object.config or {},
        certification_uuid=str(f"certification_{uuid4()}"),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    # Insert certification in DB
    db_session.add(certification)
    db_session.commit()
    db_session.refresh(certification)

    return CertificationRead(**certification.model_dump())


async def get_certification(
    request: Request,
    certification_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> CertificationRead:
    """Get a single certification by certification_id"""
    
    statement = select(Certifications).where(Certifications.certification_uuid == certification_uuid)
    certification = db_session.exec(statement).first()

    if not certification:
        raise HTTPException(
            status_code=404,
            detail="Certification not found",
        )

    # Get course for RBAC check
    statement = select(Course).where(Course.id == certification.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    return CertificationRead(**certification.model_dump())


async def get_certifications_by_course(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> List[CertificationRead]:
    """Get all certifications for a course"""
    
    # Get course for RBAC check
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await rbac_check(request, course_uuid, current_user, "read", db_session)

    # Get certifications for this course
    statement = select(Certifications).where(Certifications.course_id == course.id)
    certifications = db_session.exec(statement).all()

    return [CertificationRead(**certification.model_dump()) for certification in certifications]


async def update_certification(
    request: Request,
    certification_uuid: str,
    certification_object: CertificationUpdate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> CertificationRead:
    """Update a certification"""
    
    statement = select(Certifications).where(Certifications.certification_uuid == certification_uuid)
    certification = db_session.exec(statement).first()

    if not certification:
        raise HTTPException(
            status_code=404,
            detail="Certification not found",
        )

    # Get course for RBAC check
    statement = select(Course).where(Course.id == certification.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "update", db_session)

    # Update only the fields that were passed in
    for var, value in vars(certification_object).items():
        if value is not None:
            setattr(certification, var, value)

    # Update the update_date
    certification.update_date = str(datetime.now())

    db_session.add(certification)
    db_session.commit()
    db_session.refresh(certification)

    return CertificationRead(**certification.model_dump())


async def delete_certification(
    request: Request,
    certification_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> dict:
    """Delete a certification"""
    
    statement = select(Certifications).where(Certifications.certification_uuid == certification_uuid)
    certification = db_session.exec(statement).first()

    if not certification:
        raise HTTPException(
            status_code=404,
            detail="Certification not found",
        )

    # Get course for RBAC check
    statement = select(Course).where(Course.id == certification.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "delete", db_session)

    db_session.delete(certification)
    db_session.commit()

    return {"detail": "Certification deleted successfully"}


####################################################
# Certificate User Functions
####################################################


async def create_certificate_user(
    request: Request,
    user_id: int,
    certification_id: int,
    db_session: Session,
) -> CertificateUserRead:
    """Create a certificate user link"""
    
    # Check if certification exists
    statement = select(Certifications).where(Certifications.id == certification_id)
    certification = db_session.exec(statement).first()

    if not certification:
        raise HTTPException(
            status_code=404,
            detail="Certification not found",
        )

    # Check if certificate user already exists
    statement = select(CertificateUser).where(
        CertificateUser.user_id == user_id,
        CertificateUser.certification_id == certification_id
    )
    existing_certificate_user = db_session.exec(statement).first()

    if existing_certificate_user:
        raise HTTPException(
            status_code=400,
            detail="User already has a certificate for this course",
        )

    # Generate readable certificate user UUID
    current_year = datetime.now().year
    current_month = datetime.now().month
    current_day = datetime.now().day
    
    # Get user to extract user_uuid
    from src.db.users import User
    statement = select(User).where(User.id == user_id)
    user = db_session.exec(statement).first()
    
    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )
    
    # Extract last 4 characters from user_uuid for uniqueness (since all start with "user_")
    user_uuid_short = user.user_uuid[-4:] if user.user_uuid else "USER"
    
    # Generate random 2-letter prefix
    import random
    import string
    random_prefix = ''.join(random.choices(string.ascii_uppercase, k=2))
    
    # Get the count of existing certificate users for this user today
    today_user_prefix = f"{random_prefix}-{current_year}{current_month:02d}{current_day:02d}-{user_uuid_short}-"
    statement = select(CertificateUser).where(
        CertificateUser.user_certification_uuid.startswith(today_user_prefix)
    )
    existing_certificates = db_session.exec(statement).all()
    
    # Generate next sequential number for this user today
    next_number = len(existing_certificates) + 1
    certificate_number = f"{next_number:03d}"  # Format as 3-digit number with leading zeros
    
    user_certification_uuid = f"{today_user_prefix}{certificate_number}"

    # Create certificate user
    certificate_user = CertificateUser(
        user_id=user_id,
        certification_id=certification_id,
        user_certification_uuid=user_certification_uuid,
        created_at=str(datetime.now()),
        updated_at=str(datetime.now()),
    )

    db_session.add(certificate_user)
    db_session.commit()
    db_session.refresh(certificate_user)

    return CertificateUserRead(**certificate_user.model_dump())


async def get_user_certificates_for_course(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> List[dict]:
    """Get all certificates for a user in a specific course with certification details"""
    
    # Check if course exists
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await rbac_check(request, course_uuid, current_user, "read", db_session)

    # Get all certifications for this course
    statement = select(Certifications).where(Certifications.course_id == course.id)
    certifications = db_session.exec(statement).all()

    if not certifications:
        return []

    # Get all certificate users for this user and these certifications
    certification_ids = [cert.id for cert in certifications if cert.id]
    if not certification_ids:
        return []

    # Query certificate users for this user and these certifications
    result = []
    for cert_id in certification_ids:
        statement = select(CertificateUser).where(
            CertificateUser.user_id == current_user.id,
            CertificateUser.certification_id == cert_id
        )
        cert_user = db_session.exec(statement).first()
        if cert_user:
            # Get the associated certification
            statement = select(Certifications).where(Certifications.id == cert_id)
            certification = db_session.exec(statement).first()
            
            result.append({
                "certificate_user": CertificateUserRead(**cert_user.model_dump()),
                "certification": CertificationRead(**certification.model_dump()) if certification else None
            })

    return result


async def check_course_completion_and_create_certificate(
    request: Request,
    user_id: int,
    course_id: int,
    db_session: Session,
) -> bool:
    """Check if all activities in a course are completed and create certificate if so"""
    
    # Get all activities in the course
    statement = select(ChapterActivity).where(ChapterActivity.course_id == course_id)
    course_activities = db_session.exec(statement).all()
    
    if not course_activities:
        return False  # No activities in course
    
    # Get all completed activities for this user in this course
    statement = select(TrailStep).where(
        TrailStep.user_id == user_id,
        TrailStep.course_id == course_id,
        TrailStep.complete == True
    )
    completed_activities = db_session.exec(statement).all()
    
    # Check if all activities are completed
    if len(completed_activities) >= len(course_activities):
        # All activities completed, check if certification exists for this course
        statement = select(Certifications).where(Certifications.course_id == course_id)
        certification = db_session.exec(statement).first()
        
        if certification and certification.id:
            # Create certificate user link
            try:
                await create_certificate_user(request, user_id, certification.id, db_session)
                return True
            except HTTPException as e:
                if e.status_code == 400 and "already has a certificate" in e.detail:
                    # Certificate already exists, which is fine
                    return True
                else:
                    raise e
        
    return False


async def get_certificate_by_user_certification_uuid(
    request: Request,
    user_certification_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> dict:
    """Get a certificate by user_certification_uuid with certification details"""
    
    # Get certificate user by user_certification_uuid
    statement = select(CertificateUser).where(
        CertificateUser.user_certification_uuid == user_certification_uuid
    )
    certificate_user = db_session.exec(statement).first()

    if not certificate_user:
        raise HTTPException(
            status_code=404,
            detail="Certificate not found",
        )

    # Get the associated certification
    statement = select(Certifications).where(Certifications.id == certificate_user.certification_id)
    certification = db_session.exec(statement).first()

    if not certification:
        raise HTTPException(
            status_code=404,
            detail="Certification not found",
        )

    # Get course information
    statement = select(Course).where(Course.id == certification.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # No RBAC check - allow anyone to access certificates by UUID

    return {
        "certificate_user": CertificateUserRead(**certificate_user.model_dump()),
        "certification": CertificationRead(**certification.model_dump()),
        "course": {
            "id": course.id,
            "course_uuid": course.course_uuid,
            "name": course.name,
            "description": course.description,
            "thumbnail_image": course.thumbnail_image,
        }
    }


async def get_all_user_certificates(
    request: Request,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> List[dict]:
    """Get all certificates for the current user with complete linked information"""
    
    # Get all certificate users for this user
    statement = select(CertificateUser).where(CertificateUser.user_id == current_user.id)
    certificate_users = db_session.exec(statement).all()

    if not certificate_users:
        return []

    result = []
    for cert_user in certificate_users:
        # Get the associated certification
        statement = select(Certifications).where(Certifications.id == cert_user.certification_id)
        certification = db_session.exec(statement).first()

        if not certification:
            continue

        # Get course information
        statement = select(Course).where(Course.id == certification.course_id)
        course = db_session.exec(statement).first()

        if not course:
            continue

        # Get user information
        from src.db.users import User
        statement = select(User).where(User.id == cert_user.user_id)
        user = db_session.exec(statement).first()

        result.append({
            "certificate_user": CertificateUserRead(**cert_user.model_dump()),
            "certification": CertificationRead(**certification.model_dump()),
            "course": {
                "id": course.id,
                "course_uuid": course.course_uuid,
                "name": course.name,
                "description": course.description,
                "thumbnail_image": course.thumbnail_image,
            },
            "user": {
                "id": user.id if user else None,
                "user_uuid": user.user_uuid if user else None,
                "username": user.username if user else None,
                "email": user.email if user else None,
                "first_name": user.first_name if user else None,
                "last_name": user.last_name if user else None,
            } if user else None
        })

    return result


####################################################
# RBAC Utils
####################################################


async def rbac_check(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
):
    if action == "read":
        if current_user.id == 0:  # Anonymous user
            await authorization_verify_if_element_is_public(
                request, course_uuid, action, db_session
            )
        else:
            await authorization_verify_based_on_roles_and_authorship(
                request, current_user.id, action, course_uuid, db_session
            )
    else:
        await authorization_verify_if_user_is_anon(current_user.id)

        await authorization_verify_based_on_roles_and_authorship(
            request,
            current_user.id,
            action,
            course_uuid,
            db_session,
        ) 