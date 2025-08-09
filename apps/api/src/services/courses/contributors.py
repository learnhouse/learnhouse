from datetime import datetime
from fastapi import HTTPException, Request, status
from sqlmodel import Session, select, and_
from src.db.users import PublicUser, AnonymousUser, User, UserRead
from src.db.courses.courses import Course
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.security.rbac.rbac import authorization_verify_if_user_is_anon, authorization_verify_based_on_org_admin_status
from src.security.courses_security import courses_rbac_check
from typing import List


async def apply_course_contributor(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    """
    Apply to become a course contributor
    
    SECURITY NOTES:
    - Any authenticated user can apply to become a contributor
    - Applications are created with PENDING status
    - Only course owners (CREATOR, MAINTAINER) or admins can approve applications
    """
    # Verify user is not anonymous
    await authorization_verify_if_user_is_anon(current_user.id)

    # Check if course exists
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Check if user already has any authorship role for this course
    existing_authorship = db_session.exec(
        select(ResourceAuthor).where(
            and_(
                ResourceAuthor.resource_uuid == course_uuid,
                ResourceAuthor.user_id == current_user.id
            )
        )
    ).first()

    if existing_authorship:
        raise HTTPException(
            status_code=400,
            detail="You already have an authorship role for this course",
        )

    # Create pending contributor application
    resource_author = ResourceAuthor(
        resource_uuid=course_uuid,
        user_id=current_user.id,
        authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
        authorship_status=ResourceAuthorshipStatusEnum.PENDING,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(resource_author)
    db_session.commit()
    db_session.refresh(resource_author)

    return {
        "detail": "Contributor application submitted successfully",
        "status": "pending"
    }

async def update_course_contributor(
    request: Request,
    course_uuid: str,
    contributor_user_id: int,
    authorship: ResourceAuthorshipEnum,
    authorship_status: ResourceAuthorshipStatusEnum,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    """
    Update a course contributor's role and status
    
    SECURITY NOTES:
    - Only course owners (CREATOR, MAINTAINER) or admins can update contributors
    - Cannot modify the role of the course creator
    - Requires strict course ownership checks
    """
    # Verify user is not anonymous
    await authorization_verify_if_user_is_anon(current_user.id)

    # SECURITY: Require course ownership or admin role for updating contributors
    await courses_rbac_check(request, course_uuid, current_user, "update", db_session)

    # Check if course exists
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Check if the contributor exists for this course
    existing_authorship = db_session.exec(
        select(ResourceAuthor).where(
            and_(
                ResourceAuthor.resource_uuid == course_uuid,
                ResourceAuthor.user_id == contributor_user_id
            )
        )
    ).first()

    if not existing_authorship:
        raise HTTPException(
            status_code=404,
            detail="Contributor not found for this course",
        )

    # SECURITY: Don't allow changing the role of the creator
    if existing_authorship.authorship == ResourceAuthorshipEnum.CREATOR:
        raise HTTPException(
            status_code=400,
            detail="Cannot modify the role of the course creator",
        )

    # Update the contributor's role and status
    existing_authorship.authorship = authorship
    existing_authorship.authorship_status = authorship_status
    existing_authorship.update_date = str(datetime.now())

    db_session.add(existing_authorship)
    db_session.commit()
    db_session.refresh(existing_authorship)

    return {
        "detail": "Contributor updated successfully",
        "status": "success"
    }

async def get_course_contributors(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> List[dict]:
    """
    Get all contributors for a course with their user information
    
    SECURITY NOTES:
    - Requires read access to the course
    - Contributors are visible to anyone with course read access
    """
    # Check if course exists
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # SECURITY: Require read access to the course
    await courses_rbac_check(request, course_uuid, current_user, "read", db_session)

    # Get all contributors for this course with user information
    statement = (
        select(ResourceAuthor, User)
        .join(User)  # SQLModel will automatically join on foreign key
        .where(ResourceAuthor.resource_uuid == course_uuid)
    )
    results = db_session.exec(statement).all()

    return [
        {
            "user_id": contributor.user_id,
            "authorship": contributor.authorship,
            "authorship_status": contributor.authorship_status,
            "creation_date": contributor.creation_date,
            "update_date": contributor.update_date,
            "user": UserRead.model_validate(user).model_dump()
        }
        for contributor, user in results
    ]

async def add_bulk_course_contributors(
    request: Request,
    course_uuid: str,
    usernames: List[str],
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    """
    Add multiple contributors to a course by their usernames
    
    SECURITY NOTES:
    - Only course owners (CREATOR, MAINTAINER) or admins can add contributors
    - Requires strict course ownership checks
    - Cannot add contributors to courses the user doesn't own
    """
    # Verify user is not anonymous
    await authorization_verify_if_user_is_anon(current_user.id)

    # SECURITY: Require course ownership or admin role for adding contributors
    await courses_rbac_check(request, course_uuid, current_user, "update", db_session)

    # Check if course exists
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Process results
    results = {
        "successful": [],
        "failed": []
    }
    
    current_time = str(datetime.now())

    for username in usernames:
        try:
            # Find user by username
            user_statement = select(User).where(User.username == username)
            user = db_session.exec(user_statement).first()

            if not user or user.id is None:
                results["failed"].append({
                    "username": username,
                    "reason": "User not found or invalid"
                })
                continue

            # Check if user already has any authorship role for this course
            existing_authorship = db_session.exec(
                select(ResourceAuthor).where(
                    and_(
                        ResourceAuthor.resource_uuid == course_uuid,
                        ResourceAuthor.user_id == user.id
                    )
                )
            ).first()

            if existing_authorship:
                results["failed"].append({
                    "username": username,
                    "reason": "User already has an authorship role for this course"
                })
                continue

            # Create contributor
            resource_author = ResourceAuthor(
                resource_uuid=course_uuid,
                user_id=user.id,
                authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
                authorship_status=ResourceAuthorshipStatusEnum.PENDING,
                creation_date=current_time,
                update_date=current_time,
            )

            db_session.add(resource_author)
            db_session.commit()
            db_session.refresh(resource_author)

            results["successful"].append({
                "username": username,
                "user_id": user.id
            })

        except Exception as e:
            results["failed"].append({
                "username": username,
                "reason": str(e)
            })
            
    return results 

async def remove_bulk_course_contributors(
    request: Request,
    course_uuid: str,
    usernames: List[str],
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    """
    Remove multiple contributors from a course by their usernames
    
    SECURITY NOTES:
    - Only course owners (CREATOR, MAINTAINER) or admins can remove contributors
    - Requires strict course ownership checks
    - Cannot remove contributors from courses the user doesn't own
    - Cannot remove the course creator
    """
    # Verify user is not anonymous
    await authorization_verify_if_user_is_anon(current_user.id)

    # SECURITY: Require course ownership or admin role for removing contributors
    await courses_rbac_check(request, course_uuid, current_user, "update", db_session)

    # Check if course exists
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Process results
    results = {
        "successful": [],
        "failed": []
    }

    for username in usernames:
        try:
            # Find user by username
            user_statement = select(User).where(User.username == username)
            user = db_session.exec(user_statement).first()

            if not user or user.id is None:
                results["failed"].append({
                    "username": username,
                    "reason": "User not found or invalid"
                })
                continue

            # Check if user has any authorship role for this course
            existing_authorship = db_session.exec(
                select(ResourceAuthor).where(
                    and_(
                        ResourceAuthor.resource_uuid == course_uuid,
                        ResourceAuthor.user_id == user.id
                    )
                )
            ).first()

            if not existing_authorship:
                results["failed"].append({
                    "username": username,
                    "reason": "User is not a contributor for this course"
                })
                continue

            # SECURITY: Don't allow removing the creator
            if existing_authorship.authorship == ResourceAuthorshipEnum.CREATOR:
                results["failed"].append({
                    "username": username,
                    "reason": "Cannot remove the course creator"
                })
                continue

            # Remove the contributor
            db_session.delete(existing_authorship)
            db_session.commit()

            results["successful"].append({
                "username": username,
                "user_id": user.id
            })

        except Exception as e:
            results["failed"].append({
                "username": username,
                "reason": str(e)
            })
            
    return results 