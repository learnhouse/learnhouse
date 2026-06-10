"""
Admin API service layer.

Provides headless API operations using API token authentication.
All functions require an APITokenUser and operate within the token's org scope.
"""

from datetime import datetime, timedelta
from typing import List, Optional
from uuid import uuid4
from fastapi import HTTPException, Request, status
from sqlmodel import select, func
from sqlmodel.ext.asyncio.session import AsyncSession
from src.db.courses.activities import Activity
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
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
from src.security.rbac.constants import ADMIN_ROLE_ID, MAINTAINER_ROLE_ID
from src.services.security.password_validation import validate_password_complexity


def _require_api_token(current_user) -> APITokenUser:
    """Ensure the current user is an API token."""
    if not isinstance(current_user, APITokenUser):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint requires API token authentication",
        )
    return current_user


async def _resolve_org_slug(org_slug: str, token_user: APITokenUser, db_session: AsyncSession) -> Organization:
    """Resolve an org_slug, verify it matches the API token's org, and check plan."""
    org = (await db_session.execute(
        select(Organization).where(Organization.slug == org_slug)
    )).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    if org.id != token_user.org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API token does not have access to this organization",
        )
    # Enforce pro plan requirement for admin API
    current_plan = await get_org_plan(org.id, db_session)
    if not plan_meets_requirement(current_plan, "pro"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin API requires a Pro plan or higher.",
        )
    return org


async def _get_user_in_org(user_id: int, org_id: int, db_session: AsyncSession) -> User:
    """Get a user and verify they belong to the token's organization (single JOIN)."""
    result = (await db_session.execute(
        select(User)
        .join(
            UserOrganization,
            (UserOrganization.user_id == User.id) & (UserOrganization.org_id == org_id),
        )
        .where(User.id == user_id)
    )).scalar_one_or_none()

    if result is None:
        # Distinguish "user not found" from "not a member" for a better error
        exists = (await db_session.execute(select(User.id).where(User.id == user_id))).scalar_one_or_none()
        if not exists:
            raise HTTPException(status_code=404, detail="User not found")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not belong to this organization",
        )
    return result


_ROLE_PRIORITY = {
    ADMIN_ROLE_ID: 0,
    MAINTAINER_ROLE_ID: 1,
    3: 2,
    4: 3,
}
_DEFAULT_ROLE_PRIORITY = 2


def _role_priority(role_id: int) -> int:
    return _ROLE_PRIORITY.get(role_id, _DEFAULT_ROLE_PRIORITY)


async def _check_token_can_assign_role(
    token_user: APITokenUser,
    role: Role,
    db_session: AsyncSession,
) -> None:
    """Defense-in-depth guard for role assignment via API tokens.

    Layer 3 — API tokens never grant Admin or Maintainer. Elevated roles must
    be assigned through interactive admin flows so a leaked token cannot mint
    org admins.

    Layer 2 — The token's creator must still be a member of the org and must
    hold privilege at least as high as the role being granted. Stops a
    demoted/removed user's still-valid token from being used to escalate.
    """
    if role.id in {ADMIN_ROLE_ID, MAINTAINER_ROLE_ID}:
        raise HTTPException(
            status_code=403,
            detail="API tokens cannot grant Admin or Maintainer roles",
        )

    membership_q = select(UserOrganization).where(
        UserOrganization.user_id == token_user.created_by_user_id,
        UserOrganization.org_id == token_user.org_id,
    )
    creator_membership = (await db_session.execute(membership_q)).scalars().first()
    if creator_membership is None:
        raise HTTPException(
            status_code=403,
            detail="Token creator is no longer a member of this organization",
        )

    if _role_priority(role.id) < _role_priority(creator_membership.role_id):
        raise HTTPException(
            status_code=403,
            detail="Token cannot grant a role with higher privilege than its creator",
        )


# -- Auth Token endpoints -----------------------------------------------------


async def issue_user_token(
    token_user: APITokenUser,
    user_id: int,
    db_session: AsyncSession,
) -> dict:
    """Issue a JWT access token on behalf of a user in the token's org."""

    user = await _get_user_in_org(user_id, token_user.org_id, db_session)

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
    db_session: AsyncSession,
) -> dict:
    """Check if a user can access a specific course within the token's org."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)

    course = (await db_session.execute(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Check if user has a TrailRun (enrollment) for this course
    enrollment = (await db_session.execute(
        select(TrailRun).where(
            TrailRun.course_id == course.id,
            TrailRun.user_id == user_id,
            TrailRun.org_id == token_user.org_id,
        )
    )).scalars().first()

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
    db_session: AsyncSession,
) -> TrailRead:
    """Enroll a user in a course on their behalf."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)

    course = (await db_session.execute(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Ensure trail exists
    trail = (await db_session.execute(
        select(Trail).where(Trail.org_id == token_user.org_id, Trail.user_id == user_id)
    )).scalars().first()
    if not trail:
        trail = Trail(
            org_id=token_user.org_id,
            user_id=user_id,
            trail_uuid=f"trail_{uuid4()}",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(trail)
        await db_session.commit()
        await db_session.refresh(trail)

    # Check for existing enrollment
    existing = (await db_session.execute(
        select(TrailRun).where(
            TrailRun.course_id == course.id,
            TrailRun.user_id == user_id,
            TrailRun.org_id == token_user.org_id,
        )
    )).scalars().first()
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
    await db_session.commit()
    await db_session.refresh(trail_run)

    await track(
        event_name=analytics_events.COURSE_ENROLLED,
        org_id=token_user.org_id,
        user_id=user_id,
        properties={"course_uuid": course.course_uuid},
    )

    trail_runs_raw = list((await db_session.execute(
        select(TrailRun).where(TrailRun.trail_id == trail.id, TrailRun.user_id == user_id)
    )).scalars().all())
    return await _build_trail_read(trail, trail_runs_raw, db_session, user_id=user_id)


async def unenroll_user(
    token_user: APITokenUser,
    user_id: int,
    course_uuid: str,
    db_session: AsyncSession,
) -> dict:
    """Unenroll a user from a course."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)

    course = (await db_session.execute(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    trail_run = (await db_session.execute(
        select(TrailRun).where(
            TrailRun.course_id == course.id,
            TrailRun.user_id == user_id,
            TrailRun.org_id == token_user.org_id,
        )
    )).scalars().first()
    if not trail_run:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    # Delete associated trail steps scoped to this org
    steps = (await db_session.execute(
        select(TrailStep).where(
            TrailStep.course_id == course.id,
            TrailStep.user_id == user_id,
            TrailStep.org_id == token_user.org_id,
        )
    )).scalars().all()
    for step in steps:
        await db_session.delete(step)

    await db_session.delete(trail_run)
    await db_session.commit()

    return {"detail": "User unenrolled successfully"}


async def get_user_enrollments(
    token_user: APITokenUser,
    user_id: int,
    db_session: AsyncSession,
) -> TrailRead:
    """Get all enrollments for a user in the token's org."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)

    trail = (await db_session.execute(
        select(Trail).where(Trail.org_id == token_user.org_id, Trail.user_id == user_id)
    )).scalars().first()
    if not trail:
        return TrailRead(
            org_id=token_user.org_id,
            user_id=user_id,
            runs=[],
        )

    trail_runs_raw = list((await db_session.execute(
        select(TrailRun).where(TrailRun.trail_id == trail.id, TrailRun.user_id == user_id)
    )).scalars().all())

    return await _build_trail_read(trail, trail_runs_raw, db_session, user_id=user_id)


# -- Progress endpoints -------------------------------------------------------


async def get_user_progress(
    token_user: APITokenUser,
    user_id: int,
    course_uuid: str,
    db_session: AsyncSession,
) -> dict:
    """Get a user's progress in a specific course."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)

    course = (await db_session.execute(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Total activities in the course
    total = (await db_session.execute(
        select(func.count(ChapterActivity.id)).where(  # type: ignore
            ChapterActivity.course_id == course.id
        )
    )).scalar_one()

    # Completed activities - select only activity_id to avoid loading full rows
    completed_activity_ids = (await db_session.execute(
        select(TrailStep.activity_id).where(
            TrailStep.user_id == user_id,
            TrailStep.course_id == course.id,
            TrailStep.complete == True,
        )
    )).scalars().all()

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
    db_session: AsyncSession,
) -> dict:
    """Mark an activity as completed on behalf of a user."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)

    activity = (await db_session.execute(
        select(Activity).where(Activity.activity_uuid == activity_uuid)
    )).scalars().first()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    course = (await db_session.execute(select(Course).where(Course.id == activity.course_id))).scalars().first()
    if not course or course.org_id != token_user.org_id:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Ensure trail exists
    trail = (await db_session.execute(
        select(Trail).where(Trail.org_id == token_user.org_id, Trail.user_id == user_id)
    )).scalars().first()
    if not trail:
        trail = Trail(
            org_id=token_user.org_id,
            user_id=user_id,
            trail_uuid=f"trail_{uuid4()}",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(trail)
        await db_session.commit()
        await db_session.refresh(trail)

    # Ensure trail run exists
    trailrun = (await db_session.execute(
        select(TrailRun).where(
            TrailRun.trail_id == trail.id,
            TrailRun.course_id == course.id,
            TrailRun.user_id == user_id,
        )
    )).scalars().first()
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
        await db_session.commit()
        await db_session.refresh(trailrun)

    # Check for existing step
    existing_step = (await db_session.execute(
        select(TrailStep).where(
            TrailStep.trailrun_id == trailrun.id,
            TrailStep.activity_id == activity.id,
            TrailStep.user_id == user_id,
        )
    )).scalars().first()

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
        await db_session.commit()
        await db_session.refresh(step)

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
    db_session: AsyncSession,
) -> dict:
    """Remove an activity completion for a user."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)

    activity = (await db_session.execute(
        select(Activity).where(Activity.activity_uuid == activity_uuid)
    )).scalars().first()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    course = (await db_session.execute(select(Course).where(Course.id == activity.course_id))).scalars().first()
    if not course or course.org_id != token_user.org_id:
        raise HTTPException(status_code=404, detail="Activity not found")

    step = (await db_session.execute(
        select(TrailStep).where(
            TrailStep.activity_id == activity.id,
            TrailStep.user_id == user_id,
            TrailStep.org_id == token_user.org_id,
        )
    )).scalars().first()

    if step:
        await db_session.delete(step)
        await db_session.commit()

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
    db_session: AsyncSession,
) -> dict:
    """Mark all activities in a course as completed for a user."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)

    course = (await db_session.execute(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Ensure trail exists
    trail = (await db_session.execute(
        select(Trail).where(Trail.org_id == token_user.org_id, Trail.user_id == user_id)
    )).scalars().first()
    if not trail:
        trail = Trail(
            org_id=token_user.org_id,
            user_id=user_id,
            trail_uuid=f"trail_{uuid4()}",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(trail)
        await db_session.commit()
        await db_session.refresh(trail)

    # Ensure trail run exists
    trailrun = (await db_session.execute(
        select(TrailRun).where(
            TrailRun.trail_id == trail.id,
            TrailRun.course_id == course.id,
            TrailRun.user_id == user_id,
        )
    )).scalars().first()
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
        await db_session.commit()
        await db_session.refresh(trailrun)

    # Get all activities in the course
    chapter_activities = (await db_session.execute(
        select(ChapterActivity).where(ChapterActivity.course_id == course.id)
    )).scalars().all()

    activity_ids = [ca.activity_id for ca in chapter_activities]
    if not activity_ids:
        return {"detail": "No activities in course", "completed_count": 0}

    # Get already completed activities
    existing_steps = (await db_session.execute(
        select(TrailStep).where(
            TrailStep.user_id == user_id,
            TrailStep.course_id == course.id,
            TrailStep.complete == True,
        )
    )).scalars().all()
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

    await db_session.commit()

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
    db_session: AsyncSession,
) -> List[dict]:
    """Get progress summary for all courses a user is enrolled in."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)

    trail_runs = (await db_session.execute(
        select(TrailRun).where(
            TrailRun.user_id == user_id,
            TrailRun.org_id == token_user.org_id,
        )
    )).scalars().all()

    if not trail_runs:
        return []

    course_ids = [tr.course_id for tr in trail_runs]

    # Batch fetch courses
    courses = (await db_session.execute(
        select(Course).where(Course.id.in_(course_ids))  # type: ignore
    )).scalars().all()
    course_map = {c.id: c for c in courses}

    # Batch fetch total activities per course
    total_counts = (await db_session.execute(
        select(ChapterActivity.course_id, func.count(ChapterActivity.id))  # type: ignore
        .where(ChapterActivity.course_id.in_(course_ids))  # type: ignore
        .group_by(ChapterActivity.course_id)
    )).all()
    total_map = {row[0]: row[1] for row in total_counts}

    # Batch fetch completed steps
    completed_counts = (await db_session.execute(
        select(TrailStep.course_id, func.count(TrailStep.id))  # type: ignore
        .where(
            TrailStep.user_id == user_id,
            TrailStep.course_id.in_(course_ids),  # type: ignore
            TrailStep.complete == True,
        )
        .group_by(TrailStep.course_id)
    )).all()
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


def _enum_value(value) -> str:
    return value.value if hasattr(value, "value") else str(value)


async def get_user_trail_detail(
    token_user: APITokenUser,
    user_id: int,
    db_session: AsyncSession,
    course_uuid: Optional[str] = None,
) -> dict:
    """Build a full trail breakdown for a user — every chapter + every activity
    with per-activity completion status. Optionally filtered to a single course."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)

    target_course: Optional[Course] = None
    if course_uuid is not None:
        target_course = (await db_session.execute(
            select(Course).where(
                Course.course_uuid == course_uuid,
                Course.org_id == token_user.org_id,
            )
        )).scalars().first()
        if not target_course:
            raise HTTPException(status_code=404, detail="Course not found")

    trail = (await db_session.execute(
        select(Trail).where(
            Trail.org_id == token_user.org_id,
            Trail.user_id == user_id,
        )
    )).scalars().first()

    empty_shell = {
        "trail_uuid": trail.trail_uuid if trail else None,
        "user_id": user_id,
        "org_id": token_user.org_id,
        "creation_date": trail.creation_date if trail else None,
        "update_date": trail.update_date if trail else None,
        "courses": [],
    }

    tr_statement = select(TrailRun).where(
        TrailRun.user_id == user_id,
        TrailRun.org_id == token_user.org_id,
    )
    if trail:
        tr_statement = tr_statement.where(TrailRun.trail_id == trail.id)
    if target_course is not None:
        tr_statement = tr_statement.where(TrailRun.course_id == target_course.id)
    trail_runs = list((await db_session.execute(tr_statement)).scalars().all())

    course_ids: list[int] = [tr.course_id for tr in trail_runs]
    if target_course is not None and target_course.id not in course_ids:
        course_ids.append(target_course.id)

    if not course_ids:
        return empty_shell

    courses = (await db_session.execute(
        select(Course).where(Course.id.in_(course_ids))  # type: ignore
    )).scalars().all()
    course_map = {c.id: c for c in courses if c.org_id == token_user.org_id}

    trail_runs = [tr for tr in trail_runs if tr.course_id in course_map]
    run_by_course: dict[int, TrailRun] = {tr.course_id: tr for tr in trail_runs}

    course_chapters = (await db_session.execute(
        select(CourseChapter).where(CourseChapter.course_id.in_(course_map.keys()))  # type: ignore
    )).scalars().all()
    chapters_by_course: dict[int, list[tuple[int, int]]] = {}
    for cc in course_chapters:
        chapters_by_course.setdefault(cc.course_id, []).append((cc.chapter_id, cc.order))
    for cid in chapters_by_course:
        chapters_by_course[cid].sort(key=lambda t: t[1])

    chapter_ids = [cc.chapter_id for cc in course_chapters]
    chapter_map: dict[int, Chapter] = {}
    if chapter_ids:
        chapters = (await db_session.execute(
            select(Chapter).where(Chapter.id.in_(chapter_ids))  # type: ignore
        )).scalars().all()
        chapter_map = {c.id: c for c in chapters}

    chapter_activities = (await db_session.execute(
        select(ChapterActivity).where(ChapterActivity.course_id.in_(course_map.keys()))  # type: ignore
    )).scalars().all()
    chapter_activities_by_chapter: dict[int, list[ChapterActivity]] = {}
    for ca in chapter_activities:
        chapter_activities_by_chapter.setdefault(ca.chapter_id, []).append(ca)
    for cid in chapter_activities_by_chapter:
        chapter_activities_by_chapter[cid].sort(key=lambda a: a.order)

    activity_ids = list({ca.activity_id for ca in chapter_activities})
    activity_map: dict[int, Activity] = {}
    if activity_ids:
        activities = (await db_session.execute(
            select(Activity).where(Activity.id.in_(activity_ids))  # type: ignore
        )).scalars().all()
        activity_map = {a.id: a for a in activities}

    trail_steps = (await db_session.execute(
        select(TrailStep).where(
            TrailStep.user_id == user_id,
            TrailStep.course_id.in_(course_map.keys()),  # type: ignore
        )
    )).scalars().all()
    step_by_activity: dict[int, TrailStep] = {s.activity_id: s for s in trail_steps}

    course_blocks: list[dict] = []
    for course_id, course in course_map.items():
        run = run_by_course.get(course_id)

        chapter_blocks: list[dict] = []
        course_total = 0
        course_completed = 0

        for chapter_id, chapter_order in chapters_by_course.get(course_id, []):
            chapter = chapter_map.get(chapter_id)
            if not chapter:
                continue

            activity_blocks: list[dict] = []
            chap_total = 0
            chap_completed = 0

            for ca in chapter_activities_by_chapter.get(chapter_id, []):
                act = activity_map.get(ca.activity_id)
                if not act:
                    continue
                step = step_by_activity.get(act.id)
                completed = bool(step and step.complete)
                chap_total += 1
                if completed:
                    chap_completed += 1
                activity_blocks.append({
                    "activity_uuid": act.activity_uuid,
                    "activity_id": act.id,
                    "name": act.name,
                    "activity_type": _enum_value(act.activity_type),
                    "activity_sub_type": _enum_value(act.activity_sub_type),
                    "order": ca.order,
                    "published": act.published,
                    "completed": completed,
                    "teacher_verified": bool(step.teacher_verified) if step else False,
                    "grade": step.grade if step else "",
                    "completed_at": step.update_date if step and step.complete else None,
                })

            chapter_blocks.append({
                "chapter_uuid": chapter.chapter_uuid,
                "chapter_id": chapter.id,
                "name": chapter.name,
                "order": chapter_order,
                "total_activities": chap_total,
                "completed_activities": chap_completed,
                "activities": activity_blocks,
            })

            course_total += chap_total
            course_completed += chap_completed

        course_blocks.append({
            "course_uuid": course.course_uuid,
            "course_id": course.id,
            "course_name": course.name,
            "status": _enum_value(run.status) if run else None,
            "enrolled_at": run.creation_date if run else None,
            "total_activities": course_total,
            "completed_activities": course_completed,
            "completion_percentage": (
                round(course_completed / course_total * 100, 1) if course_total > 0 else 0
            ),
            "chapters": chapter_blocks,
        })

    return {
        "trail_uuid": trail.trail_uuid if trail else None,
        "user_id": user_id,
        "org_id": token_user.org_id,
        "creation_date": trail.creation_date if trail else None,
        "update_date": trail.update_date if trail else None,
        "courses": course_blocks,
    }


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
    db_session: AsyncSession,
    extra_metadata: Optional[dict] = None,
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

    role = (await db_session.execute(select(Role).where(Role.id == role_id))).scalars().first()
    if not role:
        raise HTTPException(status_code=400, detail="Role not found")
    if role.org_id is not None and role.org_id != token_user.org_id:
        raise HTTPException(
            status_code=403,
            detail="Role does not belong to this organization",
        )

    await _check_token_can_assign_role(token_user, role, db_session)

    await check_limits_with_usage("members", token_user.org_id, db_session)

    now = datetime.now()

    existing_user = (await db_session.execute(select(User).where(User.email == email))).scalars().first()
    if existing_user:
        # Email matches an existing account — treat this as "attach to org"
        # rather than "create new user". Previously this raised 400 and left
        # any user that had been created in a prior aborted call as an orphan
        # (in the users table but with no UserOrganization row).
        existing_membership = (await db_session.execute(
            select(UserOrganization).where(
                UserOrganization.user_id == existing_user.id,
                UserOrganization.org_id == token_user.org_id,
            )
        )).scalars().first()
        if existing_membership:
            raise HTTPException(
                status_code=400,
                detail="Email already exists in this organization",
            )

        membership = UserOrganization(
            user_id=existing_user.id if existing_user.id else 0,
            org_id=token_user.org_id,
            role_id=role_id,
            creation_date=str(now),
            update_date=str(now),
        )
        db_session.add(membership)
        await db_session.commit()

        await increase_feature_usage("members", token_user.org_id, db_session)

        await track(
            event_name=analytics_events.USER_SIGNED_UP,
            org_id=token_user.org_id,
            user_id=existing_user.id if existing_user.id else 0,
            properties={"signup_method": "admin_api_attach"},
        )
        await dispatch_webhooks(
            event_name=analytics_events.USER_SIGNED_UP,
            org_id=token_user.org_id,
            data={
                "user": {
                    "user_uuid": existing_user.user_uuid,
                    "email": existing_user.email,
                    "username": existing_user.username,
                    "first_name": existing_user.first_name,
                    "last_name": existing_user.last_name,
                },
                "signup_method": "admin_api_attach",
            },
        )

        return UserRead.model_validate(existing_user)

    if (await db_session.execute(select(User).where(User.username == username))).scalars().first():
        raise HTTPException(status_code=400, detail="Username already exists")

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
        extra_metadata=extra_metadata,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    membership = UserOrganization(
        user_id=user.id if user.id else 0,
        org_id=token_user.org_id,
        role_id=role_id,
        creation_date=str(now),
        update_date=str(now),
    )
    db_session.add(membership)
    await db_session.commit()

    await increase_feature_usage("members", token_user.org_id, db_session)

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
    db_session: AsyncSession,
) -> dict:
    """Remove a user's org membership (scope: membership only)."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)

    membership = (await db_session.execute(
        select(UserOrganization).where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == token_user.org_id,
        )
    )).scalars().first()
    if not membership:
        raise HTTPException(status_code=404, detail="User not in org")

    admin_memberships = (await db_session.execute(
        select(UserOrganization).where(
            UserOrganization.org_id == token_user.org_id,
            UserOrganization.role_id == ADMIN_ROLE_ID,
        )
    )).scalars().all()
    if len(admin_memberships) == 1 and admin_memberships[0].user_id == user_id:
        raise HTTPException(
            status_code=400,
            detail="Cannot remove the last admin of the organization",
        )

    await db_session.delete(membership)
    await db_session.commit()

    try:
        from src.routers.users import _invalidate_session_cache
        _invalidate_session_cache(user_id)
    except Exception:
        pass

    try:
        await decrease_feature_usage("members", token_user.org_id, db_session)
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
    db_session: AsyncSession,
) -> UserRead:
    """Find a user by email within the token's org. 404 if not a member."""

    row = (await db_session.execute(
        select(User)
        .join(UserOrganization, UserOrganization.user_id == User.id)  # type: ignore
        .where(
            User.email == email,
            UserOrganization.org_id == token_user.org_id,
        )
    )).scalars().first()
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

    from urllib.parse import urlsplit

    detail = "redirect_to must be a same-origin path starting with '/'"

    if not value.startswith("/"):
        raise HTTPException(status_code=400, detail=detail)

    if len(value) >= 2 and value[1] in ("/", "\\"):
        raise HTTPException(status_code=400, detail=detail)

    parts = urlsplit(value.replace("\\", "/"))
    if parts.scheme or parts.netloc:
        raise HTTPException(status_code=400, detail=detail)

    return value


async def issue_magic_link(
    token_user: APITokenUser,
    user_id: int,
    redirect_to: Optional[str],
    ttl_seconds: int,
    org_slug: str,
    request: Request,
    db_session: AsyncSession,
) -> dict:
    """Issue a short-lived JWT wrapped in a browser-clickable consume URL.

    The URL is built on the same frontend base URL the email system uses
    (``get_base_url_from_request``), so it respects custom domains and the
    deployment's allowed-origin config.
    """

    user = await _get_user_in_org(user_id, token_user.org_id, db_session)

    safe_redirect = _validate_magic_link_redirect(redirect_to)

    ttl = max(60, min(ttl_seconds, 900))
    expires_delta = timedelta(seconds=ttl)
    # Every link carries a random jti so the consume endpoint can enforce
    # single-use via a Redis SETNX marker.
    import secrets as _secrets
    jti = _secrets.token_urlsafe(16)
    payload = {
        "sub": user.email,
        "purpose": "magic_link",
        "org_id": token_user.org_id,
        "redirect_to": safe_redirect or "",
        "jti": jti,
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
    db_session: AsyncSession,
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
    jti = payload.get("jti")

    if not email or not org_id:
        raise HTTPException(status_code=410, detail="Magic link payload incomplete")

    # Enforce single-use: the first consume claims the jti; any replay hits
    # an existing key and is rejected. Tokens minted before jti was added
    # have none — let them through; the JWT exp (max 15 min) bounds them.
    # A Redis outage also falls through for the same reason.
    if jti:
        try:
            import redis as _redis
            from config.config import get_learnhouse_config as _get_cfg
            _lh_cfg = _get_cfg()
            _redis_url = _lh_cfg.redis_config.redis_connection_string
            if _redis_url:
                _r = _redis.Redis.from_url(
                    _redis_url, socket_connect_timeout=2, socket_timeout=2
                )
                # TTL matches the magic-link max lifetime so the marker
                # outlives any window the token could still be replayed in.
                claimed = _r.set(f"magic_link_used:{jti}", "1", nx=True, ex=900)
                if not claimed:
                    raise HTTPException(
                        status_code=410,
                        detail="Magic link has already been used",
                    )
        except HTTPException:
            raise
        except Exception:
            pass

    try:
        redirect_to = _validate_magic_link_redirect(raw_redirect)
    except HTTPException:
        redirect_to = None  # fall through to default "/" on bad redirect

    user = (await db_session.execute(select(User).where(User.email == email))).scalars().first()
    if not user:
        raise HTTPException(status_code=410, detail="User no longer exists")

    membership = (await db_session.execute(
        select(UserOrganization).where(
            UserOrganization.user_id == user.id,
            UserOrganization.org_id == org_id,
        )
    )).scalars().first()
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
    db_session: AsyncSession,
) -> dict:
    """Enroll a batch of users in a course. Returns summary of results."""

    course = (await db_session.execute(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Pre-fetch memberships, existing enrollments, and trails in 3 queries total
    member_ids = set(
        (await db_session.execute(
            select(UserOrganization.user_id).where(
                UserOrganization.user_id.in_(user_ids),
                UserOrganization.org_id == token_user.org_id,
            )
        )).scalars().all()
    )
    already_enrolled_ids = set(
        (await db_session.execute(
            select(TrailRun.user_id).where(
                TrailRun.course_id == course.id,
                TrailRun.user_id.in_(user_ids),
                TrailRun.org_id == token_user.org_id,
            )
        )).scalars().all()
    )

    enrolled: List[int] = []
    already_enrolled: List[int] = []
    skipped: List[int] = []
    to_enroll: List[int] = []

    for user_id in user_ids:
        if user_id not in member_ids:
            skipped.append(user_id)
        elif user_id in already_enrolled_ids:
            already_enrolled.append(user_id)
        else:
            to_enroll.append(user_id)

    if not to_enroll:
        return {"enrolled": enrolled, "already_enrolled": already_enrolled, "skipped": skipped}

    now = datetime.now()
    trails_by_user: dict[int, Trail] = {
        t.user_id: t
        for t in (await db_session.execute(
            select(Trail).where(
                Trail.org_id == token_user.org_id,
                Trail.user_id.in_(to_enroll),
            )
        )).scalars().all()
    }

    # Create missing trails in one flush
    new_trails = []
    for user_id in to_enroll:
        if user_id not in trails_by_user:
            t = Trail(
                org_id=token_user.org_id,
                user_id=user_id,
                trail_uuid=f"trail_{uuid4()}",
                creation_date=str(now),
                update_date=str(now),
            )
            new_trails.append(t)
            db_session.add(t)
    if new_trails:
        await db_session.flush()
        for t in new_trails:
            trails_by_user[t.user_id] = t

    # Batch-insert all trail runs
    for user_id in to_enroll:
        trail = trails_by_user[user_id]
        db_session.add(TrailRun(
            trail_id=trail.id if trail.id is not None else 0,
            course_id=course.id if course.id is not None else 0,
            org_id=token_user.org_id,
            user_id=user_id,
            creation_date=str(now),
            update_date=str(now),
        ))
        enrolled.append(user_id)

    await db_session.commit()

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
    db_session: AsyncSession,
    page: int = 1,
    limit: int = 25,
) -> List[dict]:
    """List users enrolled in a course within the token's org."""

    course = (await db_session.execute(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    offset = (page - 1) * limit
    rows = (await db_session.execute(
        select(User, TrailRun)
        .join(TrailRun, TrailRun.user_id == User.id)  # type: ignore
        .where(
            TrailRun.course_id == course.id,
            TrailRun.org_id == token_user.org_id,
        )
        .order_by(TrailRun.creation_date.desc())  # type: ignore
        .offset(offset)
        .limit(limit)
    )).all()

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
    db_session: AsyncSession,
) -> dict:
    """Delete a user's trail steps for a course. Keeps TrailRun enrollment intact."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)

    course = (await db_session.execute(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    steps = (await db_session.execute(
        select(TrailStep).where(
            TrailStep.user_id == user_id,
            TrailStep.course_id == course.id,
            TrailStep.org_id == token_user.org_id,
        )
    )).scalars().all()
    deleted = 0
    for step in steps:
        await db_session.delete(step)
        deleted += 1

    trail_run = (await db_session.execute(
        select(TrailRun).where(
            TrailRun.course_id == course.id,
            TrailRun.user_id == user_id,
            TrailRun.org_id == token_user.org_id,
        )
    )).scalars().first()
    if trail_run:
        from src.db.trail_runs import StatusEnum
        trail_run.status = StatusEnum.STATUS_IN_PROGRESS
        trail_run.update_date = str(datetime.now())
        db_session.add(trail_run)

    await db_session.commit()

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
    db_session: AsyncSession,
) -> dict:
    """Manually award a certificate, bypassing the completion gate."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)

    course = (await db_session.execute(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    certification = (await db_session.execute(
        select(Certifications).where(Certifications.course_id == course.id)
    )).scalars().first()
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
    db_session: AsyncSession,
) -> dict:
    """Delete a user's certificate. Verifies cross-org boundary."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)

    cert_user = (await db_session.execute(
        select(CertificateUser).where(
            CertificateUser.user_certification_uuid == user_certification_uuid,
            CertificateUser.user_id == user_id,
        )
    )).scalars().first()
    if not cert_user:
        raise HTTPException(status_code=404, detail="Certificate not found")

    certification = (await db_session.execute(
        select(Certifications).where(Certifications.id == cert_user.certification_id)
    )).scalars().first()
    if not certification:
        raise HTTPException(status_code=404, detail="Certificate not found")

    course = (await db_session.execute(
        select(Course).where(Course.id == certification.course_id)
    )).scalars().first()
    if not course or course.org_id != token_user.org_id:
        raise HTTPException(status_code=404, detail="Certificate not found")

    await db_session.delete(cert_user)
    await db_session.commit()

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


async def _get_usergroup_in_org(
    usergroup_uuid: str,
    org_id: int,
    db_session: AsyncSession,
) -> UserGroup:
    group = (await db_session.execute(
        select(UserGroup).where(
            UserGroup.usergroup_uuid == usergroup_uuid,
            UserGroup.org_id == org_id,
        )
    )).scalars().first()
    if not group:
        raise HTTPException(status_code=404, detail="UserGroup not found")
    return group


async def add_usergroup_member(
    token_user: APITokenUser,
    usergroup_uuid: str,
    user_id: int,
    db_session: AsyncSession,
) -> dict:
    """Add a user to a user group. User and group must both be in the token's org."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)
    group = await _get_usergroup_in_org(usergroup_uuid, token_user.org_id, db_session)

    existing = (await db_session.execute(
        select(UserGroupUser).where(
            UserGroupUser.usergroup_id == group.id,
            UserGroupUser.user_id == user_id,
        )
    )).scalars().first()
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
    await db_session.commit()

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
    db_session: AsyncSession,
) -> dict:
    """Remove a user from a user group."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)
    group = await _get_usergroup_in_org(usergroup_uuid, token_user.org_id, db_session)

    member = (await db_session.execute(
        select(UserGroupUser).where(
            UserGroupUser.usergroup_id == group.id,
            UserGroupUser.user_id == user_id,
        )
    )).scalars().first()
    if not member:
        raise HTTPException(status_code=404, detail="User is not a member of this group")

    await db_session.delete(member)
    await db_session.commit()

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
    db_session: AsyncSession,
) -> List[dict]:
    """Get all certificates for a user in the token's org."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)

    cert_users = (await db_session.execute(
        select(CertificateUser).where(CertificateUser.user_id == user_id)
    )).scalars().all()

    if not cert_users:
        return []

    cert_ids = list({cu.certification_id for cu in cert_users})
    certifications = (await db_session.execute(
        select(Certifications).where(Certifications.id.in_(cert_ids))  # type: ignore
    )).scalars().all()
    cert_map = {c.id: c for c in certifications}

    course_ids = list({c.course_id for c in certifications if c.course_id})
    courses = (await db_session.execute(
        select(Course).where(Course.id.in_(course_ids))  # type: ignore
    )).scalars().all() if course_ids else []
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
    db_session: AsyncSession,
) -> UserRead:
    """Update a user's profile fields. Org-scoped — user must be a member."""

    user = await _get_user_in_org(user_id, token_user.org_id, db_session)

    if "email" in updates and updates["email"] != user.email:
        existing = (await db_session.execute(
            select(User).where(User.email == updates["email"], User.id != user_id)
        )).scalars().first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")

    if "username" in updates and updates["username"] != user.username:
        existing = (await db_session.execute(
            select(User).where(User.username == updates["username"], User.id != user_id)
        )).scalars().first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already in use")

    for field, value in updates.items():
        if field in _USER_UPDATABLE_FIELDS and value is not None:
            setattr(user, field, value)

    user.update_date = str(datetime.now())
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

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
    db_session: AsyncSession,
) -> dict:
    """Change a user's org role. Blocks demoting the last admin."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)

    role = (await db_session.execute(select(Role).where(Role.id == new_role_id))).scalars().first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.org_id is not None and role.org_id != token_user.org_id:
        raise HTTPException(status_code=403, detail="Role does not belong to this organization")

    membership = (await db_session.execute(
        select(UserOrganization).where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == token_user.org_id,
        )
    )).scalars().first()
    if not membership:
        raise HTTPException(status_code=404, detail="User not in org")

    if membership.role_id == ADMIN_ROLE_ID and new_role_id != ADMIN_ROLE_ID:
        admin_count = len((await db_session.execute(
            select(UserOrganization).where(
                UserOrganization.org_id == token_user.org_id,
                UserOrganization.role_id == ADMIN_ROLE_ID,
            )
        )).scalars().all())
        if admin_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="Cannot demote the last admin of the organization",
            )

    membership.role_id = new_role_id
    membership.update_date = str(datetime.now())
    db_session.add(membership)
    await db_session.commit()

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
    db_session: AsyncSession,
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
    await db_session.commit()
    await db_session.refresh(group)

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
    db_session: AsyncSession,
) -> dict:
    """Delete a user group and all its memberships + resource links."""

    group = await _get_usergroup_in_org(usergroup_uuid, token_user.org_id, db_session)

    members = (await db_session.execute(
        select(UserGroupUser).where(UserGroupUser.usergroup_id == group.id)
    )).scalars().all()
    for m in members:
        await db_session.delete(m)

    resources = (await db_session.execute(
        select(UserGroupResource).where(UserGroupResource.usergroup_id == group.id)
    )).scalars().all()
    for r in resources:
        await db_session.delete(r)

    await db_session.delete(group)
    await db_session.commit()

    await dispatch_webhooks(
        event_name="usergroup_deleted",
        org_id=token_user.org_id,
        data={"usergroup_uuid": usergroup_uuid},
    )

    return {"detail": "UserGroup deleted", "usergroup_uuid": usergroup_uuid}


async def list_usergroup_members(
    token_user: APITokenUser,
    usergroup_uuid: str,
    db_session: AsyncSession,
    page: int = 1,
    limit: int = 25,
) -> List[dict]:
    """List users in a cohort, with pagination."""

    group = await _get_usergroup_in_org(usergroup_uuid, token_user.org_id, db_session)

    offset = (page - 1) * limit
    rows = (await db_session.execute(
        select(User, UserGroupUser)
        .join(UserGroupUser, UserGroupUser.user_id == User.id)  # type: ignore
        .where(UserGroupUser.usergroup_id == group.id)
        .order_by(UserGroupUser.creation_date.asc())  # type: ignore
        .offset(offset)
        .limit(limit)
    )).all()

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
    db_session: AsyncSession,
) -> List[dict]:
    """List user groups a user belongs to within the token's org."""

    await _get_user_in_org(user_id, token_user.org_id, db_session)

    rows = (await db_session.execute(
        select(UserGroup, UserGroupUser)
        .join(UserGroupUser, UserGroupUser.usergroup_id == UserGroup.id)  # type: ignore
        .where(
            UserGroupUser.user_id == user_id,
            UserGroup.org_id == token_user.org_id,
        )
        .order_by(UserGroupUser.creation_date.asc())  # type: ignore
    )).all()

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
    db_session: AsyncSession,
) -> dict:
    """Grant a cohort access to a course."""

    group = await _get_usergroup_in_org(usergroup_uuid, token_user.org_id, db_session)

    course = (await db_session.execute(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    existing = (await db_session.execute(
        select(UserGroupResource).where(
            UserGroupResource.usergroup_id == group.id,
            UserGroupResource.resource_uuid == course.course_uuid,
        )
    )).scalars().first()
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
    await db_session.commit()

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
    db_session: AsyncSession,
) -> dict:
    """Revoke a cohort's access to a course."""

    group = await _get_usergroup_in_org(usergroup_uuid, token_user.org_id, db_session)

    link = (await db_session.execute(
        select(UserGroupResource).where(
            UserGroupResource.usergroup_id == group.id,
            UserGroupResource.resource_uuid == course_uuid,
        )
    )).scalars().first()
    if not link:
        raise HTTPException(status_code=404, detail="Course not linked to this group")

    await db_session.delete(link)
    await db_session.commit()

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
    db_session: AsyncSession,
) -> dict:
    """Unenroll a batch of users from a course. Returns summary."""
    from sqlmodel import delete as sql_delete

    course = (await db_session.execute(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    enrolled_ids = set(
        (await db_session.execute(
            select(TrailRun.user_id).where(
                TrailRun.course_id == course.id,
                TrailRun.user_id.in_(user_ids),
                TrailRun.org_id == token_user.org_id,
            )
        )).scalars().all()
    )

    unenrolled = [uid for uid in user_ids if uid in enrolled_ids]
    not_enrolled = [uid for uid in user_ids if uid not in enrolled_ids]

    if unenrolled:
        await db_session.execute(
            sql_delete(TrailStep).where(
                TrailStep.course_id == course.id,
                TrailStep.user_id.in_(unenrolled),
                TrailStep.org_id == token_user.org_id,
            )
        )
        await db_session.execute(
            sql_delete(TrailRun).where(
                TrailRun.course_id == course.id,
                TrailRun.user_id.in_(unenrolled),
                TrailRun.org_id == token_user.org_id,
            )
        )
        await db_session.commit()

    return {
        "unenrolled": unenrolled,
        "not_enrolled": not_enrolled,
    }


# -- GDPR export / anonymize --------------------------------------------------


async def export_user_data(
    token_user: APITokenUser,
    user_id: int,
    db_session: AsyncSession,
) -> dict:
    """Full GDPR data export scoped to the token's org.

    Only returns data that belongs to the token's organization — other-org
    memberships and certificates are intentionally excluded so a token for
    org A cannot read a user's history in org B.
    """

    user = await _get_user_in_org(user_id, token_user.org_id, db_session)

    memberships = (await db_session.execute(
        select(UserOrganization).where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == token_user.org_id,
        )
    )).scalars().all()

    trails = (await db_session.execute(
        select(Trail).where(
            Trail.user_id == user_id,
            Trail.org_id == token_user.org_id,
        )
    )).scalars().all()
    trail_runs = (await db_session.execute(
        select(TrailRun).where(
            TrailRun.user_id == user_id,
            TrailRun.org_id == token_user.org_id,
        )
    )).scalars().all()
    trail_steps = (await db_session.execute(
        select(TrailStep).where(
            TrailStep.user_id == user_id,
            TrailStep.org_id == token_user.org_id,
        )
    )).scalars().all()

    # Certificates scoped to this org via Certifications -> Course -> org_id
    cert_rows = (await db_session.execute(
        select(CertificateUser, Certifications, Course)
        .join(Certifications, Certifications.id == CertificateUser.certification_id)  # type: ignore
        .join(Course, Course.id == Certifications.course_id)  # type: ignore
        .where(
            CertificateUser.user_id == user_id,
            Course.org_id == token_user.org_id,
        )
    )).all()
    cert_users = [cu for cu, _cert, _course in cert_rows]

    group_rows = (await db_session.execute(
        select(UserGroup, UserGroupUser)
        .join(UserGroupUser, UserGroupUser.usergroup_id == UserGroup.id)  # type: ignore
        .where(
            UserGroupUser.user_id == user_id,
            UserGroup.org_id == token_user.org_id,
        )
    )).all()

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
    db_session: AsyncSession,
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

    user = await _get_user_in_org(user_id, token_user.org_id, db_session)

    placeholder_email = f"deleted-user-{user_id}@anonymized.local"
    placeholder_username = f"deleted_user_{user_id}"

    existing_tokens = (await db_session.execute(
        select(APIToken).where(
            APIToken.created_by_user_id == user_id,
            APIToken.org_id == token_user.org_id,
        )
    )).scalars().all()
    for token in existing_tokens:
        await db_session.delete(token)

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
    await db_session.commit()

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
    db_session: AsyncSession,
) -> dict:
    """Aggregate course stats: enrollment, completion, in-progress, cert count."""

    from src.db.trail_runs import StatusEnum

    course = (await db_session.execute(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    total_activities = (await db_session.execute(
        select(func.count(ChapterActivity.id)).where(  # type: ignore
            ChapterActivity.course_id == course.id
        )
    )).scalar_one()

    trail_runs = (await db_session.execute(
        select(TrailRun).where(
            TrailRun.course_id == course.id,
            TrailRun.org_id == token_user.org_id,
        )
    )).scalars().all()

    enrollment_count = len(trail_runs)
    completed_count = sum(1 for tr in trail_runs if tr.status == StatusEnum.STATUS_COMPLETED)
    in_progress_count = sum(1 for tr in trail_runs if tr.status == StatusEnum.STATUS_IN_PROGRESS)

    average_completion_percentage = 0.0
    if trail_runs and total_activities:
        # Single GROUP BY query replaces one query per enrolled user
        completion_rows = (await db_session.execute(
            select(TrailStep.user_id, func.count(TrailStep.id))  # type: ignore
            .where(
                TrailStep.course_id == course.id,
                TrailStep.complete == True,
            )
            .group_by(TrailStep.user_id)
        )).all()
        completed_by_user = {row[0]: row[1] for row in completion_rows}
        if trail_runs:
            total_pct = sum(
                completed_by_user.get(tr.user_id, 0) / total_activities * 100
                for tr in trail_runs
            )
            average_completion_percentage = round(total_pct / len(trail_runs), 1)

    certificate_count = 0
    certification = (await db_session.execute(
        select(Certifications).where(Certifications.course_id == course.id)
    )).scalars().first()
    if certification:
        certificate_count = (await db_session.execute(
            select(func.count(CertificateUser.id)).where(  # type: ignore
                CertificateUser.certification_id == certification.id
            )
        )).scalar_one()

    return {
        "course_uuid": course_uuid,
        "enrollment_count": enrollment_count,
        "completed_count": completed_count,
        "in_progress_count": in_progress_count,
        "total_activities": total_activities,
        "average_completion_percentage": average_completion_percentage,
        "certificate_count": certificate_count,
    }
