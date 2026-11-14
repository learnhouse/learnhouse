"""Enroll an organization member in a course from the dashboard.

The admin API already has an enrollment endpoint, but it is for API tokens
only. Org admins working in the dashboard (a user session) had no way to put
a learner in a course, so this is the session-side counterpart: same effect
(trail + trail run), gated to the org's admins and maintainers.
"""

from datetime import datetime
from uuid import uuid4

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete as sql_delete
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.ee_hooks import notify_ee_learner_progress
from src.db.courses.courses import Course
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.trails import Trail
from src.db.users import PublicUser
from src.security.org_auth import enforce_org_mfa, get_user_org, is_org_admin
from src.services.analytics import events as analytics_events
from src.services.analytics.analytics import track


class MemberEnrollmentResult(BaseModel):
    user_id: int
    course_uuid: str
    enrolled: bool


async def enroll_org_member(
    org_id: int,
    user_id: int,
    course_uuid: str,
    current_user,
    db_session: AsyncSession,
) -> MemberEnrollmentResult:
    # A signed-in person only: API tokens have their own admin endpoint.
    if not isinstance(current_user, PublicUser):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    if not await is_org_admin(current_user.id, org_id, db_session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin or Maintainer role required for this action",
        )
    await enforce_org_mfa(current_user.id, org_id, db_session)

    # The learner must belong to this org: enrolling an outsider would leak
    # the course and give them a trail in an org they never joined.
    if await get_user_org(user_id, org_id, db_session) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User is not a member of this organization")

    course = (
        await db_session.execute(
            select(Course).where(Course.course_uuid == course_uuid, Course.org_id == org_id)
        )
    ).scalars().first()
    if not course or course.id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")

    existing = (
        await db_session.execute(
            select(TrailRun).where(
                TrailRun.course_id == course.id,
                TrailRun.user_id == user_id,
                TrailRun.org_id == org_id,
            )
        )
    ).scalars().first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is already enrolled in this course")

    now = str(datetime.now())
    trail = (
        await db_session.execute(select(Trail).where(Trail.org_id == org_id, Trail.user_id == user_id))
    ).scalars().first()
    if not trail:
        trail = Trail(
            org_id=org_id,
            user_id=user_id,
            trail_uuid=f"trail_{uuid4()}",
            creation_date=now,
            update_date=now,
        )
        db_session.add(trail)
        await db_session.commit()
        await db_session.refresh(trail)

    db_session.add(
        TrailRun(
            trail_id=trail.id if trail.id is not None else 0,
            course_id=course.id,
            org_id=org_id,
            user_id=user_id,
            creation_date=now,
            update_date=now,
        )
    )
    await db_session.commit()

    await track(
        event_name=analytics_events.COURSE_ENROLLED,
        org_id=org_id,
        user_id=user_id,
        properties={"course_uuid": course.course_uuid, "source": "dashboard"},
    )

    return MemberEnrollmentResult(user_id=user_id, course_uuid=course.course_uuid, enrolled=True)


class MemberUnenrollmentResult(BaseModel):
    user_id: int
    course_uuid: str
    unenrolled: bool


async def unenroll_org_member(
    org_id: int,
    user_id: int,
    course_uuid: str,
    current_user,
    db_session: AsyncSession,
) -> MemberUnenrollmentResult:
    """Take a member out of a course: the session-side counterpart of the
    admin API's unenroll, with the same guards as `enroll_org_member`. The
    enrollment and the member's progress in the course are removed."""
    if not isinstance(current_user, PublicUser):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    if not await is_org_admin(current_user.id, org_id, db_session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin or Maintainer role required for this action",
        )
    await enforce_org_mfa(current_user.id, org_id, db_session)

    course = (
        await db_session.execute(
            select(Course).where(Course.course_uuid == course_uuid, Course.org_id == org_id)
        )
    ).scalars().first()
    if not course or course.id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")

    run = (
        await db_session.execute(
            select(TrailRun).where(
                TrailRun.course_id == course.id,
                TrailRun.user_id == user_id,
                TrailRun.org_id == org_id,
            )
        )
    ).scalars().first()
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Enrollment not found")

    # Run and steps go in one commit, so a failure cannot leave "complete"
    # steps that would bring the progress back on re-enrollment.
    await db_session.delete(run)
    await db_session.execute(
        sql_delete(TrailStep).where(
            TrailStep.course_id == course.id,
            TrailStep.user_id == user_id,
            TrailStep.org_id == org_id,
        )
    )
    await db_session.commit()
    notify_ee_learner_progress(user_id, course.id)

    await track(
        event_name=analytics_events.COURSE_LEFT,
        org_id=org_id,
        user_id=user_id,
        properties={"course_uuid": course.course_uuid, "source": "dashboard"},
    )
    return MemberUnenrollmentResult(user_id=user_id, course_uuid=course.course_uuid, unenrolled=True)
