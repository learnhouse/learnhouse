"""
Admin API service layer.

Provides headless API operations using API token authentication.
All functions require an APITokenUser and operate within the token's org scope.
"""

from datetime import datetime, timedelta
from typing import List, Optional
from uuid import uuid4
from fastapi import HTTPException, Request, status
from sqlmodel import Session, select, func
from src.db.courses.activities import Activity
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.courses import Course
from src.db.courses.certifications import (
    CertificateUser,
    CertificateUserRead,
    CertificationRead,
    Certifications,
)
from src.db.organizations import Organization
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.trails import Trail, TrailRead
from src.db.api_tokens import APIToken
from src.db.roles import Role
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup, UserGroupRead
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, User, UserRead
from src.services.trail.trail import _build_trail_read
from src.services.courses.certifications import (
    check_course_completion_and_create_certificate,
    create_certificate_user,
)
from src.services.email.utils import get_base_url_from_request
from src.services.analytics.analytics import track
from src.services.analytics import events as analytics_events
from src.services.webhooks.dispatch import dispatch_webhooks
from src.security.auth import create_access_token, create_refresh_token
from src.security.features_utils.plan_check import get_org_plan
from src.security.features_utils.plans import plan_meets_requirement
from src.security.features_utils.usage import (
    check_limits_with_usage,
    decrease_feature_usage,
    increase_feature_usage,
)
from src.security.security import security_hash_password
from src.security.rbac.constants import ADMIN_ROLE_ID
from src.services.security.password_validation import validate_password_complexity


def _require_api_token(current_user) -> APITokenUser:
    """Ensure the current user is an API token."""
    if not isinstance(current_user, APITokenUser):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint requires API token authentication",
        )
    return current_user




def _resolve_org_slug(org_slug: str, token_user: APITokenUser, db_session: Session) -> Organization:
    """Resolve an org_slug, verify it matches the API token's org, and check plan."""
    org = db_session.exec(
        select(Organization).where(Organization.slug == org_slug)
    ).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    if org.id != token_user.org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API token does not have access to this organization",
        )
    # Enforce pro plan requirement for admin API
    current_plan = get_org_plan(org.id, db_session)
    if not plan_meets_requirement(current_plan, "pro"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin API requires a Pro plan or higher.",
        )
    return org


def _get_user_in_org(user_id: int, org_id: int, db_session: Session) -> User:
    """Get a user and verify they belong to the token's organization."""
    user = db_session.exec(select(User).where(User.id == user_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    membership = db_session.exec(
        select(UserOrganization).where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == org_id,
        )
    ).first()
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not belong to this organization",
        )
    return user


# -- Auth Token endpoints -----------------------------------------------------


async def issue_user_token(
    token_user: APITokenUser,
    user_id: int,
    db_session: Session,
) -> dict:
    """Issue a JWT access token on behalf of a user in the token's org."""

    user = _get_user_in_org(user_id, token_user.org_id, db_session)

    # Issue a short-lived token (1 hour) for headless use — shorter than the
    # default 8-hour session token to limit blast radius if leaked.
    from datetime import timedelta
    access_token = create_access_token(
        data={"sub": user.email},
        expires_delta=timedelta(hours=1),
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": user.id,
        "user_uuid": user.user_uuid,
    }


# -- Course access ------------------------------------------------------------


async def check_course_access(
    token_user: APITokenUser,
    course_uuid: str,
    user_id: int,
    db_session: Session,
) -> dict:
    """Check if a user can access a specific course within the token's org."""

    _get_user_in_org(user_id, token_user.org_id, db_session)

    course = db_session.exec(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Check if user has a TrailRun (enrollment) for this course
    enrollment = db_session.exec(
        select(TrailRun).where(
            TrailRun.course_id == course.id,
            TrailRun.user_id == user_id,
            TrailRun.org_id == token_user.org_id,
        )
    ).first()

    return {
        "has_access": course.public or enrollment is not None,
        "is_enrolled": enrollment is not None,
        "is_public": course.public,
        "is_published": course.published,
    }


# -- Enrollment endpoints -----------------------------------------------------


async def enroll_user(
    request: Request,
    token_user: APITokenUser,
    user_id: int,
    course_uuid: str,
    db_session: Session,
) -> TrailRead:
    """Enroll a user in a course on their behalf."""

    _get_user_in_org(user_id, token_user.org_id, db_session)

    course = db_session.exec(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Ensure trail exists
    trail = db_session.exec(
        select(Trail).where(Trail.org_id == token_user.org_id, Trail.user_id == user_id)
    ).first()
    if not trail:
        trail = Trail(
            org_id=token_user.org_id,
            user_id=user_id,
            trail_uuid=f"trail_{uuid4()}",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(trail)
        db_session.commit()
        db_session.refresh(trail)

    # Check for existing enrollment
    existing = db_session.exec(
        select(TrailRun).where(
            TrailRun.course_id == course.id,
            TrailRun.user_id == user_id,
            TrailRun.org_id == token_user.org_id,
        )
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="User is already enrolled in this course")

    trail_run = TrailRun(
        trail_id=trail.id if trail.id is not None else 0,
        course_id=course.id if course.id is not None else 0,
        org_id=token_user.org_id,
        user_id=user_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db_session.add(trail_run)
    db_session.commit()
    db_session.refresh(trail_run)

    await track(
        event_name=analytics_events.COURSE_ENROLLED,
        org_id=token_user.org_id,
        user_id=user_id,
        properties={"course_uuid": course.course_uuid},
    )

    trail_runs_raw = list(db_session.exec(
        select(TrailRun).where(TrailRun.trail_id == trail.id, TrailRun.user_id == user_id)
    ).all())
    return _build_trail_read(trail, trail_runs_raw, db_session, user_id=user_id)


async def unenroll_user(
    token_user: APITokenUser,
    user_id: int,
    course_uuid: str,
    db_session: Session,
) -> dict:
    """Unenroll a user from a course."""

    _get_user_in_org(user_id, token_user.org_id, db_session)

    course = db_session.exec(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    trail_run = db_session.exec(
        select(TrailRun).where(
            TrailRun.course_id == course.id,
            TrailRun.user_id == user_id,
            TrailRun.org_id == token_user.org_id,
        )
    ).first()
    if not trail_run:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    # Delete associated trail steps scoped to this org
    steps = db_session.exec(
        select(TrailStep).where(
            TrailStep.course_id == course.id,
            TrailStep.user_id == user_id,
            TrailStep.org_id == token_user.org_id,
        )
    ).all()
    for step in steps:
        db_session.delete(step)

    db_session.delete(trail_run)
    db_session.commit()

    return {"detail": "User unenrolled successfully"}


async def get_user_enrollments(
    token_user: APITokenUser,
    user_id: int,
    db_session: Session,
) -> TrailRead:
    """Get all enrollments for a user in the token's org."""

    _get_user_in_org(user_id, token_user.org_id, db_session)

    trail = db_session.exec(
        select(Trail).where(Trail.org_id == token_user.org_id, Trail.user_id == user_id)
    ).first()
    if not trail:
        return TrailRead(
            org_id=token_user.org_id,
            user_id=user_id,
            runs=[],
        )

    trail_runs_raw = list(db_session.exec(
        select(TrailRun).where(TrailRun.trail_id == trail.id, TrailRun.user_id == user_id)
    ).all())

    return _build_trail_read(trail, trail_runs_raw, db_session, user_id=user_id)


# -- Progress endpoints -------------------------------------------------------


async def get_user_progress(
    token_user: APITokenUser,
    user_id: int,
    course_uuid: str,
    db_session: Session,
) -> dict:
    """Get a user's progress in a specific course."""

    _get_user_in_org(user_id, token_user.org_id, db_session)

    course = db_session.exec(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Total activities in the course
    total = db_session.exec(
        select(func.count(ChapterActivity.id)).where(  # type: ignore
            ChapterActivity.course_id == course.id
        )
    ).one()

    # Completed activities - select only activity_id to avoid loading full rows
    completed_activity_ids = db_session.exec(
        select(TrailStep.activity_id).where(
            TrailStep.user_id == user_id,
            TrailStep.course_id == course.id,
            TrailStep.complete == True,
        )
    ).all()

    return {
        "course_uuid": course.course_uuid,
        "user_id": user_id,
        "total_activities": total,
        "completed_activities": len(completed_activity_ids),
        "completion_percentage": round(len(completed_activity_ids) / total * 100, 1) if total > 0 else 0,
        "completed_activity_ids": completed_activity_ids,
    }


async def complete_activity(
    request: Request,
    token_user: APITokenUser,
    user_id: int,
    activity_uuid: str,
    db_session: Session,
) -> dict:
    """Mark an activity as completed on behalf of a user."""

    _get_user_in_org(user_id, token_user.org_id, db_session)

    activity = db_session.exec(
        select(Activity).where(Activity.activity_uuid == activity_uuid)
    ).first()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    course = db_session.exec(select(Course).where(Course.id == activity.course_id)).first()
    if not course or course.org_id != token_user.org_id:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Ensure trail exists
    trail = db_session.exec(
        select(Trail).where(Trail.org_id == token_user.org_id, Trail.user_id == user_id)
    ).first()
    if not trail:
        trail = Trail(
            org_id=token_user.org_id,
            user_id=user_id,
            trail_uuid=f"trail_{uuid4()}",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(trail)
        db_session.commit()
        db_session.refresh(trail)

    # Ensure trail run exists
    trailrun = db_session.exec(
        select(TrailRun).where(
            TrailRun.trail_id == trail.id,
            TrailRun.course_id == course.id,
            TrailRun.user_id == user_id,
        )
    ).first()
    if not trailrun:
        trailrun = TrailRun(
            trail_id=trail.id if trail.id is not None else 0,
            course_id=course.id if course.id is not None else 0,
            org_id=course.org_id,
            user_id=user_id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(trailrun)
        db_session.commit()
        db_session.refresh(trailrun)

    # Check for existing step
    existing_step = db_session.exec(
        select(TrailStep).where(
            TrailStep.trailrun_id == trailrun.id,
            TrailStep.activity_id == activity.id,
            TrailStep.user_id == user_id,
        )
    ).first()

    is_new = existing_step is None
    if is_new:
        step = TrailStep(
            trailrun_id=trailrun.id if trailrun.id is not None else 0,
            activity_id=activity.id if activity.id is not None else 0,
            course_id=course.id if course.id is not None else 0,
            trail_id=trail.id if trail.id is not None else 0,
            org_id=course.org_id,
            complete=True,
            teacher_verified=False,
            grade="",
            user_id=user_id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(step)
        db_session.commit()
        db_session.refresh(step)

        await track(
            event_name=analytics_events.ACTIVITY_COMPLETED,
            org_id=course.org_id,
            user_id=user_id,
            properties={
                "activity_uuid": activity_uuid,
                "course_uuid": course.course_uuid,
                "activity_type": activity.activity_type if activity.activity_type else "",
            },
        )

    # Check course completion
    course_completed = False
    if course.id:
        course_completed = await check_course_completion_and_create_certificate(
            request, user_id, course.id, db_session
        )

    if course_completed:
        await track(
            event_name=analytics_events.COURSE_COMPLETED,
            org_id=course.org_id,
            user_id=user_id,
            properties={"course_uuid": course.course_uuid},
        )

    return {
        "activity_uuid": activity_uuid,
        "user_id": user_id,
        "completed": True,
        "is_new_completion": is_new,
        "course_completed": course_completed,
    }


async def uncomplete_activity(
    token_user: APITokenUser,
    user_id: int,
    activity_uuid: str,
    db_session: Session,
) -> dict:
    """Remove an activity completion for a user."""

    _get_user_in_org(user_id, token_user.org_id, db_session)

    activity = db_session.exec(
        select(Activity).where(Activity.activity_uuid == activity_uuid)
    ).first()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    course = db_session.exec(select(Course).where(Course.id == activity.course_id)).first()
    if not course or course.org_id != token_user.org_id:
        raise HTTPException(status_code=404, detail="Activity not found")

    step = db_session.exec(
        select(TrailStep).where(
            TrailStep.activity_id == activity.id,
            TrailStep.user_id == user_id,
            TrailStep.org_id == token_user.org_id,
        )
    ).first()

    if step:
        db_session.delete(step)
        db_session.commit()

    return {
        "activity_uuid": activity_uuid,
        "user_id": user_id,
        "completed": False,
    }


async def complete_course(
    request: Request,
    token_user: APITokenUser,
    user_id: int,
    course_uuid: str,
    db_session: Session,
) -> dict:
    """Mark all activities in a course as completed for a user."""

    _get_user_in_org(user_id, token_user.org_id, db_session)

    course = db_session.exec(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Ensure trail exists
    trail = db_session.exec(
        select(Trail).where(Trail.org_id == token_user.org_id, Trail.user_id == user_id)
    ).first()
    if not trail:
        trail = Trail(
            org_id=token_user.org_id,
            user_id=user_id,
            trail_uuid=f"trail_{uuid4()}",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(trail)
        db_session.commit()
        db_session.refresh(trail)

    # Ensure trail run exists
    trailrun = db_session.exec(
        select(TrailRun).where(
            TrailRun.trail_id == trail.id,
            TrailRun.course_id == course.id,
            TrailRun.user_id == user_id,
        )
    ).first()
    if not trailrun:
        trailrun = TrailRun(
            trail_id=trail.id if trail.id is not None else 0,
            course_id=course.id if course.id is not None else 0,
            org_id=course.org_id,
            user_id=user_id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(trailrun)
        db_session.commit()
        db_session.refresh(trailrun)

    # Get all activities in the course
    chapter_activities = db_session.exec(
        select(ChapterActivity).where(ChapterActivity.course_id == course.id)
    ).all()

    activity_ids = [ca.activity_id for ca in chapter_activities]
    if not activity_ids:
        return {"detail": "No activities in course", "completed_count": 0}

    # Get already completed activities
    existing_steps = db_session.exec(
        select(TrailStep).where(
            TrailStep.user_id == user_id,
            TrailStep.course_id == course.id,
            TrailStep.complete == True,
        )
    ).all()
    already_completed = {s.activity_id for s in existing_steps}

    new_count = 0
    for activity_id in activity_ids:
        if activity_id not in already_completed:
            step = TrailStep(
                trailrun_id=trailrun.id if trailrun.id is not None else 0,
                activity_id=activity_id,
                course_id=course.id if course.id is not None else 0,
                trail_id=trail.id if trail.id is not None else 0,
                org_id=course.org_id,
                complete=True,
                teacher_verified=False,
                grade="",
                user_id=user_id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
            db_session.add(step)
            new_count += 1

    db_session.commit()

    # Check course completion and create certificate
    course_completed = await check_course_completion_and_create_certificate(
        request, user_id, course.id, db_session
    )

    if course_completed:
        await track(
            event_name=analytics_events.COURSE_COMPLETED,
            org_id=course.org_id,
            user_id=user_id,
            properties={"course_uuid": course.course_uuid},
        )

    return {
        "course_uuid": course_uuid,
        "user_id": user_id,
        "completed_count": new_count,
        "already_completed_count": len(already_completed),
        "total_activities": len(activity_ids),
        "course_completed": True,
        "certificate_awarded": course_completed,
    }


async def get_all_user_progress(
    token_user: APITokenUser,
    user_id: int,
    db_session: Session,
) -> List[dict]:
    """Get progress summary for all courses a user is enrolled in."""

    _get_user_in_org(user_id, token_user.org_id, db_session)

    trail_runs = db_session.exec(
        select(TrailRun).where(
            TrailRun.user_id == user_id,
            TrailRun.org_id == token_user.org_id,
        )
    ).all()

    if not trail_runs:
        return []

    course_ids = [tr.course_id for tr in trail_runs]

    # Batch fetch courses
    courses = db_session.exec(
        select(Course).where(Course.id.in_(course_ids))  # type: ignore
    ).all()
    course_map = {c.id: c for c in courses}

    # Batch fetch total activities per course
    total_counts = db_session.exec(
        select(ChapterActivity.course_id, func.count(ChapterActivity.id))  # type: ignore
        .where(ChapterActivity.course_id.in_(course_ids))  # type: ignore
        .group_by(ChapterActivity.course_id)
    ).all()
    total_map = {row[0]: row[1] for row in total_counts}

    # Batch fetch completed steps
    completed_counts = db_session.exec(
        select(TrailStep.course_id, func.count(TrailStep.id))  # type: ignore
        .where(
            TrailStep.user_id == user_id,
            TrailStep.course_id.in_(course_ids),  # type: ignore
            TrailStep.complete == True,
        )
        .group_by(TrailStep.course_id)
    ).all()
    completed_map = {row[0]: row[1] for row in completed_counts}

    result = []
    for tr in trail_runs:
        course = course_map.get(tr.course_id)
        if not course:
            continue
        total = total_map.get(tr.course_id, 0)
        completed = completed_map.get(tr.course_id, 0)
        result.append({
            "course_uuid": course.course_uuid,
            "course_name": course.name,
            "status": tr.status.value,
            "total_activities": total,
            "completed_activities": completed,
            "completion_percentage": round(completed / total * 100, 1) if total > 0 else 0,
            "enrolled_at": tr.creation_date,
        })

    return result


# -- User provisioning --------------------------------------------------------


async def provision_user(
    token_user: APITokenUser,
    email: str,
    username: str,
    first_name: str,
    last_name: str,
    password: Optional[str],
    role_id: int,
    request: Request,
    db_session: Session,
) -> UserRead:
    """Create a user and attach them to the token's org in one call.

    Designed for SSO/JIT provisioning — email is auto-verified and the user
    bypasses the normal email-verification flow.
    """

    if password:
        validation = validate_password_complexity(password)
        if not validation.is_valid:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "WEAK_PASSWORD",
                    "message": "Password does not meet security requirements",
                    "errors": validation.errors,
                },
            )

    check_limits_with_usage("members", token_user.org_id, db_session)

    if db_session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(status_code=400, detail="Email already exists")
    if db_session.exec(select(User).where(User.username == username)).first():
        raise HTTPException(status_code=400, detail="Username already exists")

    now = datetime.now()
    user = User(
        username=username,
        email=email,
        first_name=first_name,
        last_name=last_name,
        password=security_hash_password(password) if password else "",
        user_uuid=f"user_{uuid4()}",
        email_verified=True,
        email_verified_at=now.isoformat(),
        signup_method="admin_api",
        creation_date=str(now),
        update_date=str(now),
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    membership = UserOrganization(
        user_id=user.id if user.id else 0,
        org_id=token_user.org_id,
        role_id=role_id,
        creation_date=str(now),
        update_date=str(now),
    )
    db_session.add(membership)
    db_session.commit()

    increase_feature_usage("members", token_user.org_id, db_session)

    await track(
        event_name=analytics_events.USER_SIGNED_UP,
        org_id=token_user.org_id,
        user_id=user.id if user.id else 0,
        properties={"signup_method": "admin_api"},
    )
    await dispatch_webhooks(
        event_name=analytics_events.USER_SIGNED_UP,
        org_id=token_user.org_id,
        data={
            "user": {
                "user_uuid": user.user_uuid,
                "email": user.email,
                "username": user.username,
                "first_name": user.first_name,
                "last_name": user.last_name,
            },
            "signup_method": "admin_api",
        },
    )

    return UserRead.model_validate(user)


async def remove_user_from_org_admin(
    token_user: APITokenUser,
    user_id: int,
    db_session: Session,
) -> dict:
    """Remove a user's org membership (scope: membership only)."""

    _get_user_in_org(user_id, token_user.org_id, db_session)

    membership = db_session.exec(
        select(UserOrganization).where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == token_user.org_id,
        )
    ).first()
    if not membership:
        raise HTTPException(status_code=404, detail="User not in org")

    admin_memberships = db_session.exec(
        select(UserOrganization).where(
            UserOrganization.org_id == token_user.org_id,
            UserOrganization.role_id == ADMIN_ROLE_ID,
        )
    ).all()
    if len(admin_memberships) == 1 and admin_memberships[0].user_id == user_id:
        raise HTTPException(
            status_code=400,
            detail="Cannot remove the last admin of the organization",
        )

    db_session.delete(membership)
    db_session.commit()

    try:
        from src.routers.users import _invalidate_session_cache
        _invalidate_session_cache(user_id)
    except Exception:
        pass

    try:
        decrease_feature_usage("members", token_user.org_id, db_session)
    except Exception:
        pass

    await dispatch_webhooks(
        event_name=analytics_events.USER_REMOVED_FROM_ORG,
        org_id=token_user.org_id,
        data={"user_id": user_id, "org_id": token_user.org_id},
    )

    return {"detail": "User removed from org"}


async def get_user_by_email(
    token_user: APITokenUser,
    email: str,
    db_session: Session,
) -> UserRead:
    """Find a user by email within the token's org. 404 if not a member."""

    row = db_session.exec(
        select(User)
        .join(UserOrganization, UserOrganization.user_id == User.id)  # type: ignore
        .where(
            User.email == email,
            UserOrganization.org_id == token_user.org_id,
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="User not found in this organization")
    return UserRead.model_validate(row)


# -- Magic link ---------------------------------------------------------------


def _validate_magic_link_redirect(redirect_to: Optional[str]) -> Optional[str]:
    """Validate that a magic-link redirect_to is a same-origin path.

    Rejects anything that contains a scheme or looks like a protocol-relative
    URL — only allows paths like "/course/foo" that resolve on the same host
    the consume endpoint was hit on. Prevents open-redirect phishing.
    """
    if redirect_to is None or redirect_to == "":
        return None

    value = redirect_to.strip()
    if not value:
        return None

    lowered = value.lower()
    if "://" in lowered or lowered.startswith("//") or lowered.startswith("\\\\"):
        raise HTTPException(
            status_code=400,
            detail="redirect_to must be a same-origin path starting with '/'",
        )

    if not value.startswith("/"):
        raise HTTPException(
            status_code=400,
            detail="redirect_to must be a same-origin path starting with '/'",
        )

    return value


async def issue_magic_link(
    token_user: APITokenUser,
    user_id: int,
    redirect_to: Optional[str],
    ttl_seconds: int,
    org_slug: str,
    request: Request,
    db_session: Session,
) -> dict:
    """Issue a short-lived JWT wrapped in a browser-clickable consume URL.

    The URL is built on the same frontend base URL the email system uses
    (``get_base_url_from_request``), so it respects custom domains and the
    deployment's allowed-origin config.
    """

    user = _get_user_in_org(user_id, token_user.org_id, db_session)

    safe_redirect = _validate_magic_link_redirect(redirect_to)

    ttl = max(60, min(ttl_seconds, 900))
    expires_delta = timedelta(seconds=ttl)
    payload = {
        "sub": user.email,
        "purpose": "magic_link",
        "org_id": token_user.org_id,
        "redirect_to": safe_redirect or "",
    }
    token = create_access_token(data=payload, expires_delta=expires_delta)

    base = get_base_url_from_request(request).rstrip("/")
    url = f"{base}/api/v1/admin/{org_slug}/auth/magic-consume?token={token}"

    expires_at = (datetime.now() + expires_delta).isoformat()

    return {
        "url": url,
        "token": token,
        "expires_at": expires_at,
    }


async def consume_magic_link_token(
    token: str,
    db_session: Session,
) -> tuple[User, str, str, Optional[str]]:
    """Validate a magic-link JWT. Returns (user, access_token, refresh_token, redirect_to).

    Raises HTTPException on expired/invalid token or if the user is no longer
    a member of the org encoded in the token. Re-validates ``redirect_to``
    defense-in-depth even though it was validated at issue time, so an older
    unvalidated token can't slip through.
    """

    from src.security.auth import decode_jwt

    try:
        payload = decode_jwt(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired magic link")

    if not payload or payload.get("purpose") != "magic_link":
        raise HTTPException(status_code=410, detail="Token is not a magic link")

    email = payload.get("sub")
    org_id = payload.get("org_id")
    raw_redirect = payload.get("redirect_to") or None

    if not email or not org_id:
        raise HTTPException(status_code=410, detail="Magic link payload incomplete")

    try:
        redirect_to = _validate_magic_link_redirect(raw_redirect)
    except HTTPException:
        redirect_to = None  # fall through to default "/" on bad redirect

    user = db_session.exec(select(User).where(User.email == email)).first()
    if not user:
        raise HTTPException(status_code=410, detail="User no longer exists")

    membership = db_session.exec(
        select(UserOrganization).where(
            UserOrganization.user_id == user.id,
            UserOrganization.org_id == org_id,
        )
    ).first()
    if not membership:
        raise HTTPException(status_code=410, detail="User is no longer a member of this organization")

    # Explicitly mark session tokens so get_current_user can reject purpose-bearing
    # tokens that should only be valid at the consume endpoint.
    access_token = create_access_token(data={"sub": email, "purpose": "session"})
    refresh_token = create_refresh_token(data={"sub": email, "purpose": "session"})

    return user, access_token, refresh_token, redirect_to


# -- Bulk enrollment ----------------------------------------------------------


async def bulk_enroll_users(
    token_user: APITokenUser,
    course_uuid: str,
    user_ids: List[int],
    request: Request,
    db_session: Session,
) -> dict:
    """Enroll a batch of users in a course. Returns summary of results."""

    course = db_session.exec(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    enrolled: List[int] = []
    already_enrolled: List[int] = []
    skipped: List[int] = []

    now = datetime.now()

    for user_id in user_ids:
        membership = db_session.exec(
            select(UserOrganization).where(
                UserOrganization.user_id == user_id,
                UserOrganization.org_id == token_user.org_id,
            )
        ).first()
        if not membership:
            skipped.append(user_id)
            continue

        existing = db_session.exec(
            select(TrailRun).where(
                TrailRun.course_id == course.id,
                TrailRun.user_id == user_id,
                TrailRun.org_id == token_user.org_id,
            )
        ).first()
        if existing:
            already_enrolled.append(user_id)
            continue

        trail = db_session.exec(
            select(Trail).where(
                Trail.org_id == token_user.org_id,
                Trail.user_id == user_id,
            )
        ).first()
        if not trail:
            trail = Trail(
                org_id=token_user.org_id,
                user_id=user_id,
                trail_uuid=f"trail_{uuid4()}",
                creation_date=str(now),
                update_date=str(now),
            )
            db_session.add(trail)
            db_session.commit()
            db_session.refresh(trail)

        trail_run = TrailRun(
            trail_id=trail.id if trail.id is not None else 0,
            course_id=course.id if course.id is not None else 0,
            org_id=token_user.org_id,
            user_id=user_id,
            creation_date=str(now),
            update_date=str(now),
        )
        db_session.add(trail_run)
        enrolled.append(user_id)

    db_session.commit()

    for user_id in enrolled:
        await track(
            event_name=analytics_events.COURSE_ENROLLED,
            org_id=token_user.org_id,
            user_id=user_id,
            properties={"course_uuid": course.course_uuid},
        )

    return {
        "enrolled": enrolled,
        "already_enrolled": already_enrolled,
        "skipped": skipped,
    }


async def list_course_enrollments(
    token_user: APITokenUser,
    course_uuid: str,
    db_session: Session,
    page: int = 1,
    limit: int = 25,
) -> List[dict]:
    """List users enrolled in a course within the token's org."""

    course = db_session.exec(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    offset = (page - 1) * limit
    rows = db_session.exec(
        select(User, TrailRun)
        .join(TrailRun, TrailRun.user_id == User.id)  # type: ignore
        .where(
            TrailRun.course_id == course.id,
            TrailRun.org_id == token_user.org_id,
        )
        .order_by(TrailRun.creation_date.desc())  # type: ignore
        .offset(offset)
        .limit(limit)
    ).all()

    return [
        {
            "user": UserRead.model_validate(user).model_dump(),
            "enrolled_at": trail_run.creation_date,
            "status": trail_run.status.value if hasattr(trail_run.status, "value") else str(trail_run.status),
        }
        for user, trail_run in rows
    ]


# -- Progress reset -----------------------------------------------------------


async def reset_user_progress(
    token_user: APITokenUser,
    user_id: int,
    course_uuid: str,
    db_session: Session,
) -> dict:
    """Delete a user's trail steps for a course. Keeps TrailRun enrollment intact."""

    _get_user_in_org(user_id, token_user.org_id, db_session)

    course = db_session.exec(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    steps = db_session.exec(
        select(TrailStep).where(
            TrailStep.user_id == user_id,
            TrailStep.course_id == course.id,
            TrailStep.org_id == token_user.org_id,
        )
    ).all()
    deleted = 0
    for step in steps:
        db_session.delete(step)
        deleted += 1

    trail_run = db_session.exec(
        select(TrailRun).where(
            TrailRun.course_id == course.id,
            TrailRun.user_id == user_id,
            TrailRun.org_id == token_user.org_id,
        )
    ).first()
    if trail_run:
        from src.db.trail_runs import StatusEnum
        trail_run.status = StatusEnum.STATUS_IN_PROGRESS
        trail_run.update_date = str(datetime.now())
        db_session.add(trail_run)

    db_session.commit()

    return {
        "course_uuid": course_uuid,
        "user_id": user_id,
        "steps_deleted": deleted,
    }


# -- Certificate award / revoke -----------------------------------------------


async def award_certificate(
    token_user: APITokenUser,
    user_id: int,
    course_uuid: str,
    request: Request,
    db_session: Session,
) -> dict:
    """Manually award a certificate, bypassing the completion gate."""

    _get_user_in_org(user_id, token_user.org_id, db_session)

    course = db_session.exec(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    certification = db_session.exec(
        select(Certifications).where(Certifications.course_id == course.id)
    ).first()
    if not certification:
        raise HTTPException(
            status_code=404,
            detail="Course has no certification configured",
        )

    cert_user = await create_certificate_user(
        request=request,
        user_id=user_id,
        certification_id=certification.id,  # type: ignore
        db_session=db_session,
        current_user=None,
    )

    return {
        "user_certification_uuid": cert_user.user_certification_uuid,
        "user_id": user_id,
        "course_uuid": course_uuid,
    }


async def revoke_certificate(
    token_user: APITokenUser,
    user_id: int,
    user_certification_uuid: str,
    db_session: Session,
) -> dict:
    """Delete a user's certificate. Verifies cross-org boundary."""

    _get_user_in_org(user_id, token_user.org_id, db_session)

    cert_user = db_session.exec(
        select(CertificateUser).where(
            CertificateUser.user_certification_uuid == user_certification_uuid,
            CertificateUser.user_id == user_id,
        )
    ).first()
    if not cert_user:
        raise HTTPException(status_code=404, detail="Certificate not found")

    certification = db_session.exec(
        select(Certifications).where(Certifications.id == cert_user.certification_id)
    ).first()
    if not certification:
        raise HTTPException(status_code=404, detail="Certificate not found")

    course = db_session.exec(
        select(Course).where(Course.id == certification.course_id)
    ).first()
    if not course or course.org_id != token_user.org_id:
        raise HTTPException(status_code=404, detail="Certificate not found")

    db_session.delete(cert_user)
    db_session.commit()

    await dispatch_webhooks(
        event_name=analytics_events.CERTIFICATE_REVOKED,
        org_id=token_user.org_id,
        data={
            "user_id": user_id,
            "user_certification_uuid": user_certification_uuid,
            "course_uuid": course.course_uuid,
        },
    )

    return {
        "detail": "Certificate revoked",
        "user_certification_uuid": user_certification_uuid,
    }


# -- User group membership ----------------------------------------------------


def _get_usergroup_in_org(
    usergroup_uuid: str,
    org_id: int,
    db_session: Session,
) -> UserGroup:
    group = db_session.exec(
        select(UserGroup).where(
            UserGroup.usergroup_uuid == usergroup_uuid,
            UserGroup.org_id == org_id,
        )
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="UserGroup not found")
    return group


async def add_usergroup_member(
    token_user: APITokenUser,
    usergroup_uuid: str,
    user_id: int,
    db_session: Session,
) -> dict:
    """Add a user to a user group. User and group must both be in the token's org."""

    _get_user_in_org(user_id, token_user.org_id, db_session)
    group = _get_usergroup_in_org(usergroup_uuid, token_user.org_id, db_session)

    existing = db_session.exec(
        select(UserGroupUser).where(
            UserGroupUser.usergroup_id == group.id,
            UserGroupUser.user_id == user_id,
        )
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="User is already in this group")

    now = datetime.now()
    member = UserGroupUser(
        usergroup_id=group.id if group.id is not None else 0,
        user_id=user_id,
        org_id=token_user.org_id,
        creation_date=str(now),
        update_date=str(now),
    )
    db_session.add(member)
    db_session.commit()

    await dispatch_webhooks(
        event_name="usergroup_users_added",
        org_id=token_user.org_id,
        data={
            "usergroup_id": group.id,
            "usergroup_uuid": group.usergroup_uuid,
            "user_ids": [user_id],
        },
    )

    return {
        "detail": "User added to group",
        "usergroup_uuid": usergroup_uuid,
        "user_id": user_id,
    }


async def remove_usergroup_member(
    token_user: APITokenUser,
    usergroup_uuid: str,
    user_id: int,
    db_session: Session,
) -> dict:
    """Remove a user from a user group."""

    _get_user_in_org(user_id, token_user.org_id, db_session)
    group = _get_usergroup_in_org(usergroup_uuid, token_user.org_id, db_session)

    member = db_session.exec(
        select(UserGroupUser).where(
            UserGroupUser.usergroup_id == group.id,
            UserGroupUser.user_id == user_id,
        )
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="User is not a member of this group")

    db_session.delete(member)
    db_session.commit()

    await dispatch_webhooks(
        event_name="usergroup_users_removed",
        org_id=token_user.org_id,
        data={
            "usergroup_id": group.id,
            "usergroup_uuid": group.usergroup_uuid,
            "user_ids": [user_id],
        },
    )

    return {
        "detail": "User removed from group",
        "usergroup_uuid": usergroup_uuid,
        "user_id": user_id,
    }

# -- Certification endpoints (read-only) --------------------------------------


async def get_user_certificates(
    token_user: APITokenUser,
    user_id: int,
    db_session: Session,
) -> List[dict]:
    """Get all certificates for a user in the token's org."""

    _get_user_in_org(user_id, token_user.org_id, db_session)

    cert_users = db_session.exec(
        select(CertificateUser).where(CertificateUser.user_id == user_id)
    ).all()

    if not cert_users:
        return []

    cert_ids = list({cu.certification_id for cu in cert_users})
    certifications = db_session.exec(
        select(Certifications).where(Certifications.id.in_(cert_ids))  # type: ignore
    ).all()
    cert_map = {c.id: c for c in certifications}

    course_ids = list({c.course_id for c in certifications if c.course_id})
    courses = db_session.exec(
        select(Course).where(Course.id.in_(course_ids))  # type: ignore
    ).all() if course_ids else []
    course_map = {c.id: c for c in courses}

    # Filter to only certs in this org
    result = []
    for cu in cert_users:
        cert = cert_map.get(cu.certification_id)
        if not cert:
            continue
        course = course_map.get(cert.course_id)
        if not course or course.org_id != token_user.org_id:
            continue
        result.append({
            "certificate_user": CertificateUserRead(**cu.model_dump()).model_dump(),
            "certification": CertificationRead(**cert.model_dump()).model_dump(),
            "course": {
                "id": course.id,
                "course_uuid": course.course_uuid,
                "name": course.name,
                "description": course.description,
                "thumbnail_image": course.thumbnail_image,
            },
        })

    return result


# -- User profile & role updates ----------------------------------------------


_USER_UPDATABLE_FIELDS = {
    "username", "first_name", "last_name", "email",
    "avatar_image", "bio", "details", "profile",
}


async def update_user_profile(
    token_user: APITokenUser,
    user_id: int,
    updates: dict,
    db_session: Session,
) -> UserRead:
    """Update a user's profile fields. Org-scoped — user must be a member."""

    user = _get_user_in_org(user_id, token_user.org_id, db_session)

    if "email" in updates and updates["email"] != user.email:
        existing = db_session.exec(
            select(User).where(User.email == updates["email"], User.id != user_id)
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")

    if "username" in updates and updates["username"] != user.username:
        existing = db_session.exec(
            select(User).where(User.username == updates["username"], User.id != user_id)
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already in use")

    for field, value in updates.items():
        if field in _USER_UPDATABLE_FIELDS and value is not None:
            setattr(user, field, value)

    user.update_date = str(datetime.now())
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    try:
        from src.routers.users import _invalidate_session_cache
        _invalidate_session_cache(user_id)
    except Exception:
        pass

    return UserRead.model_validate(user)


async def change_user_role(
    token_user: APITokenUser,
    user_id: int,
    new_role_id: int,
    db_session: Session,
) -> dict:
    """Change a user's org role. Blocks demoting the last admin."""

    _get_user_in_org(user_id, token_user.org_id, db_session)

    role = db_session.exec(select(Role).where(Role.id == new_role_id)).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.org_id is not None and role.org_id != token_user.org_id:
        raise HTTPException(status_code=403, detail="Role does not belong to this organization")

    membership = db_session.exec(
        select(UserOrganization).where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == token_user.org_id,
        )
    ).first()
    if not membership:
        raise HTTPException(status_code=404, detail="User not in org")

    if membership.role_id == ADMIN_ROLE_ID and new_role_id != ADMIN_ROLE_ID:
        admin_count = len(db_session.exec(
            select(UserOrganization).where(
                UserOrganization.org_id == token_user.org_id,
                UserOrganization.role_id == ADMIN_ROLE_ID,
            )
        ).all())
        if admin_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="Cannot demote the last admin of the organization",
            )

    membership.role_id = new_role_id
    membership.update_date = str(datetime.now())
    db_session.add(membership)
    db_session.commit()

    try:
        from src.routers.users import _invalidate_session_cache
        _invalidate_session_cache(user_id)
    except Exception:
        pass

    return {
        "user_id": user_id,
        "role_id": new_role_id,
    }


# -- User group CRUD ---------------------------------------------------------


async def create_usergroup(
    token_user: APITokenUser,
    name: str,
    description: str,
    db_session: Session,
) -> UserGroupRead:
    """Create a user group / cohort in the token's org."""

    now = datetime.now()
    group = UserGroup(
        name=name,
        description=description,
        org_id=token_user.org_id,
        usergroup_uuid=f"usergroup_{uuid4()}",
        creation_date=str(now),
        update_date=str(now),
    )
    db_session.add(group)
    db_session.commit()
    db_session.refresh(group)

    await dispatch_webhooks(
        event_name="usergroup_created",
        org_id=token_user.org_id,
        data={
            "usergroup_uuid": group.usergroup_uuid,
            "name": group.name,
        },
    )

    return UserGroupRead.model_validate(group)


async def delete_usergroup(
    token_user: APITokenUser,
    usergroup_uuid: str,
    db_session: Session,
) -> dict:
    """Delete a user group and all its memberships + resource links."""

    group = _get_usergroup_in_org(usergroup_uuid, token_user.org_id, db_session)

    members = db_session.exec(
        select(UserGroupUser).where(UserGroupUser.usergroup_id == group.id)
    ).all()
    for m in members:
        db_session.delete(m)

    resources = db_session.exec(
        select(UserGroupResource).where(UserGroupResource.usergroup_id == group.id)
    ).all()
    for r in resources:
        db_session.delete(r)

    db_session.delete(group)
    db_session.commit()

    await dispatch_webhooks(
        event_name="usergroup_deleted",
        org_id=token_user.org_id,
        data={"usergroup_uuid": usergroup_uuid},
    )

    return {"detail": "UserGroup deleted", "usergroup_uuid": usergroup_uuid}


async def list_usergroup_members(
    token_user: APITokenUser,
    usergroup_uuid: str,
    db_session: Session,
    page: int = 1,
    limit: int = 25,
) -> List[dict]:
    """List users in a cohort, with pagination."""

    group = _get_usergroup_in_org(usergroup_uuid, token_user.org_id, db_session)

    offset = (page - 1) * limit
    rows = db_session.exec(
        select(User, UserGroupUser)
        .join(UserGroupUser, UserGroupUser.user_id == User.id)  # type: ignore
        .where(UserGroupUser.usergroup_id == group.id)
        .order_by(UserGroupUser.creation_date.asc())  # type: ignore
        .offset(offset)
        .limit(limit)
    ).all()

    return [
        {
            "user": UserRead.model_validate(user).model_dump(),
            "added_at": membership.creation_date,
        }
        for user, membership in rows
    ]


async def get_user_groups(
    token_user: APITokenUser,
    user_id: int,
    db_session: Session,
) -> List[dict]:
    """List user groups a user belongs to within the token's org."""

    _get_user_in_org(user_id, token_user.org_id, db_session)

    rows = db_session.exec(
        select(UserGroup, UserGroupUser)
        .join(UserGroupUser, UserGroupUser.usergroup_id == UserGroup.id)  # type: ignore
        .where(
            UserGroupUser.user_id == user_id,
            UserGroup.org_id == token_user.org_id,
        )
        .order_by(UserGroupUser.creation_date.asc())  # type: ignore
    ).all()

    return [
        {
            "usergroup": UserGroupRead.model_validate(group).model_dump(),
            "added_at": membership.creation_date,
        }
        for group, membership in rows
    ]


# -- Cohort → course access ---------------------------------------------------


async def add_course_to_usergroup(
    token_user: APITokenUser,
    usergroup_uuid: str,
    course_uuid: str,
    db_session: Session,
) -> dict:
    """Grant a cohort access to a course."""

    group = _get_usergroup_in_org(usergroup_uuid, token_user.org_id, db_session)

    course = db_session.exec(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    existing = db_session.exec(
        select(UserGroupResource).where(
            UserGroupResource.usergroup_id == group.id,
            UserGroupResource.resource_uuid == course.course_uuid,
        )
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Course is already linked to this group")

    now = datetime.now()
    link = UserGroupResource(
        usergroup_id=group.id if group.id is not None else 0,
        resource_uuid=course.course_uuid,
        org_id=token_user.org_id,
        creation_date=str(now),
        update_date=str(now),
    )
    db_session.add(link)
    db_session.commit()

    await dispatch_webhooks(
        event_name="usergroup_resources_added",
        org_id=token_user.org_id,
        data={
            "usergroup_uuid": group.usergroup_uuid,
            "resource_uuids": [course.course_uuid],
        },
    )

    return {
        "detail": "Course linked to group",
        "usergroup_uuid": usergroup_uuid,
        "course_uuid": course_uuid,
    }


async def remove_course_from_usergroup(
    token_user: APITokenUser,
    usergroup_uuid: str,
    course_uuid: str,
    db_session: Session,
) -> dict:
    """Revoke a cohort's access to a course."""

    group = _get_usergroup_in_org(usergroup_uuid, token_user.org_id, db_session)

    link = db_session.exec(
        select(UserGroupResource).where(
            UserGroupResource.usergroup_id == group.id,
            UserGroupResource.resource_uuid == course_uuid,
        )
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Course not linked to this group")

    db_session.delete(link)
    db_session.commit()

    await dispatch_webhooks(
        event_name="usergroup_resources_removed",
        org_id=token_user.org_id,
        data={
            "usergroup_uuid": group.usergroup_uuid,
            "resource_uuids": [course_uuid],
        },
    )

    return {
        "detail": "Course unlinked from group",
        "usergroup_uuid": usergroup_uuid,
        "course_uuid": course_uuid,
    }


# -- Bulk unenroll ------------------------------------------------------------


async def bulk_unenroll_users(
    token_user: APITokenUser,
    course_uuid: str,
    user_ids: List[int],
    db_session: Session,
) -> dict:
    """Unenroll a batch of users from a course. Returns summary."""

    course = db_session.exec(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    unenrolled: List[int] = []
    not_enrolled: List[int] = []

    for user_id in user_ids:
        trail_run = db_session.exec(
            select(TrailRun).where(
                TrailRun.course_id == course.id,
                TrailRun.user_id == user_id,
                TrailRun.org_id == token_user.org_id,
            )
        ).first()
        if not trail_run:
            not_enrolled.append(user_id)
            continue

        steps = db_session.exec(
            select(TrailStep).where(
                TrailStep.course_id == course.id,
                TrailStep.user_id == user_id,
                TrailStep.org_id == token_user.org_id,
            )
        ).all()
        for step in steps:
            db_session.delete(step)

        db_session.delete(trail_run)
        unenrolled.append(user_id)

    db_session.commit()

    return {
        "unenrolled": unenrolled,
        "not_enrolled": not_enrolled,
    }


# -- GDPR export / anonymize --------------------------------------------------


async def export_user_data(
    token_user: APITokenUser,
    user_id: int,
    db_session: Session,
) -> dict:
    """Full GDPR data export scoped to the token's org.

    Only returns data that belongs to the token's organization — other-org
    memberships and certificates are intentionally excluded so a token for
    org A cannot read a user's history in org B.
    """

    user = _get_user_in_org(user_id, token_user.org_id, db_session)

    memberships = db_session.exec(
        select(UserOrganization).where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == token_user.org_id,
        )
    ).all()

    trails = db_session.exec(
        select(Trail).where(
            Trail.user_id == user_id,
            Trail.org_id == token_user.org_id,
        )
    ).all()
    trail_runs = db_session.exec(
        select(TrailRun).where(
            TrailRun.user_id == user_id,
            TrailRun.org_id == token_user.org_id,
        )
    ).all()
    trail_steps = db_session.exec(
        select(TrailStep).where(
            TrailStep.user_id == user_id,
            TrailStep.org_id == token_user.org_id,
        )
    ).all()

    # Certificates scoped to this org via Certifications -> Course -> org_id
    cert_rows = db_session.exec(
        select(CertificateUser, Certifications, Course)
        .join(Certifications, Certifications.id == CertificateUser.certification_id)  # type: ignore
        .join(Course, Course.id == Certifications.course_id)  # type: ignore
        .where(
            CertificateUser.user_id == user_id,
            Course.org_id == token_user.org_id,
        )
    ).all()
    cert_users = [cu for cu, _cert, _course in cert_rows]

    group_rows = db_session.exec(
        select(UserGroup, UserGroupUser)
        .join(UserGroupUser, UserGroupUser.usergroup_id == UserGroup.id)  # type: ignore
        .where(
            UserGroupUser.user_id == user_id,
            UserGroup.org_id == token_user.org_id,
        )
    ).all()

    return {
        "profile": UserRead.model_validate(user).model_dump(),
        "memberships": [m.model_dump() for m in memberships],
        "trails": [t.model_dump() for t in trails],
        "trail_runs": [tr.model_dump() for tr in trail_runs],
        "trail_steps": [ts.model_dump() for ts in trail_steps],
        "certificates": [
            CertificateUserRead(**cu.model_dump()).model_dump() for cu in cert_users
        ],
        "user_groups": [
            UserGroupRead.model_validate(g).model_dump() for g, _ in group_rows
        ],
        "exported_at": datetime.now().isoformat(),
    }


async def anonymize_user(
    token_user: APITokenUser,
    user_id: int,
    db_session: Session,
) -> dict:
    """GDPR right-to-be-forgotten. Scrub PII, delete API tokens, invalidate session.

    Cross-org note: the ``User`` row is global (shared across all orgs the
    user belongs to), so scrubbing PII fields (email, name, avatar, bio,
    details, profile) affects every org. API token cleanup is scoped to the
    *caller's* org — tokens the user created in other orgs are NOT touched.
    If the user also belongs to other orgs, the caller should coordinate a
    purge in each org, or use a dedicated "global anonymize" flow (not
    exposed here) that has platform-wide authority.
    """

    user = _get_user_in_org(user_id, token_user.org_id, db_session)

    placeholder_email = f"deleted-user-{user_id}@anonymized.local"
    placeholder_username = f"deleted_user_{user_id}"

    existing_tokens = db_session.exec(
        select(APIToken).where(
            APIToken.created_by_user_id == user_id,
            APIToken.org_id == token_user.org_id,
        )
    ).all()
    for token in existing_tokens:
        db_session.delete(token)

    user.email = placeholder_email
    user.username = placeholder_username
    user.first_name = "Deleted"
    user.last_name = "User"
    user.avatar_image = ""
    user.bio = ""
    user.details = {}
    user.profile = {}
    user.password = ""
    user.email_verified = False
    user.email_verified_at = None
    user.last_login_ip = None
    user.signup_method = "anonymized"
    user.update_date = str(datetime.now())
    db_session.add(user)
    db_session.commit()

    try:
        from src.routers.users import _invalidate_session_cache
        _invalidate_session_cache(user_id)
    except Exception:
        pass

    await dispatch_webhooks(
        event_name="user_anonymized",
        org_id=token_user.org_id,
        data={
            "user_id": user_id,
            "anonymized_email": placeholder_email,
            "api_tokens_revoked": len(existing_tokens),
        },
    )

    return {
        "detail": "User anonymized",
        "user_id": user_id,
        "anonymized_email": placeholder_email,
        "api_tokens_revoked": len(existing_tokens),
    }


# -- Course analytics ---------------------------------------------------------


async def get_course_analytics(
    token_user: APITokenUser,
    course_uuid: str,
    db_session: Session,
) -> dict:
    """Aggregate course stats: enrollment, completion, in-progress, cert count."""

    from src.db.trail_runs import StatusEnum

    course = db_session.exec(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    total_activities = db_session.exec(
        select(func.count(ChapterActivity.id)).where(  # type: ignore
            ChapterActivity.course_id == course.id
        )
    ).one()

    trail_runs = db_session.exec(
        select(TrailRun).where(
            TrailRun.course_id == course.id,
            TrailRun.org_id == token_user.org_id,
        )
    ).all()

    enrollment_count = len(trail_runs)
    completed_count = sum(1 for tr in trail_runs if tr.status == StatusEnum.STATUS_COMPLETED)
    in_progress_count = sum(1 for tr in trail_runs if tr.status == StatusEnum.STATUS_IN_PROGRESS)

    average_completion_percentage = 0.0
    if trail_runs and total_activities:
        percentages = []
        for tr in trail_runs:
            completed_steps = db_session.exec(
                select(func.count(TrailStep.id)).where(  # type: ignore
                    TrailStep.user_id == tr.user_id,
                    TrailStep.course_id == course.id,
                    TrailStep.complete == True,
                )
            ).one()
            percentages.append(completed_steps / total_activities * 100)
        if percentages:
            average_completion_percentage = round(sum(percentages) / len(percentages), 1)

    certificate_count = 0
    certification = db_session.exec(
        select(Certifications).where(Certifications.course_id == course.id)
    ).first()
    if certification:
        certificate_count = db_session.exec(
            select(func.count(CertificateUser.id)).where(  # type: ignore
                CertificateUser.certification_id == certification.id
            )
        ).one()

    return {
        "course_uuid": course_uuid,
        "enrollment_count": enrollment_count,
        "completed_count": completed_count,
        "in_progress_count": in_progress_count,
        "total_activities": total_activities,
        "average_completion_percentage": average_completion_percentage,
        "certificate_count": certificate_count,
    }

