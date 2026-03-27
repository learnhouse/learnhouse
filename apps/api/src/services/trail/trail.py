from datetime import datetime
from typing import List, Optional
from uuid import uuid4
from sqlmodel import Session, select, func
from src.db.courses.chapter_activities import ChapterActivity
from fastapi import HTTPException, Request, status
from src.db.courses.activities import Activity
from src.db.courses.courses import Course
from src.db.trail_runs import TrailRun, TrailRunRead
from src.db.trail_steps import TrailStep
from src.db.trails import Trail, TrailCreate, TrailRead
from src.db.users import AnonymousUser, PublicUser
from src.services.courses.certifications import check_course_completion_and_create_certificate
from src.services.analytics.analytics import track
from src.services.analytics import events as analytics_events
from src.services.webhooks.dispatch import dispatch_webhooks


def _build_trail_read(
    trail: Trail,
    trail_runs_raw: List[TrailRun],
    db_session: Session,
    user_id: Optional[int] = None,
    with_course_info: bool = True,
) -> TrailRead:
    """Build a TrailRead with all nested data using batch queries instead of N+1 loops."""
    if not trail_runs_raw:
        return TrailRead(**trail.model_dump(), runs=[])

    trail_run_ids = [tr.id for tr in trail_runs_raw]
    course_ids = list({tr.course_id for tr in trail_runs_raw})

    # Batch fetch all courses needed
    course_map: dict[int, Course] = {}
    if course_ids:
        courses = db_session.exec(
            select(Course).where(Course.id.in_(course_ids))  # type: ignore
        ).all()
        course_map = {c.id: c for c in courses}

    # Batch fetch chapter activity counts per course (for total_steps)
    course_total_steps_map: dict[int, int] = {}
    if with_course_info and course_ids:
        step_counts = db_session.exec(
            select(ChapterActivity.course_id, func.count(ChapterActivity.id))  # type: ignore
            .where(ChapterActivity.course_id.in_(course_ids))  # type: ignore
            .group_by(ChapterActivity.course_id)
        ).all()
        course_total_steps_map = {row[0]: row[1] for row in step_counts}

    # Batch fetch all trail steps for these trail runs
    steps_statement = select(TrailStep).where(
        TrailStep.trailrun_id.in_(trail_run_ids)  # type: ignore
    )
    if user_id is not None:
        steps_statement = steps_statement.where(TrailStep.user_id == user_id)
    all_steps = db_session.exec(steps_statement).all()

    # Group steps by trailrun_id
    steps_by_run: dict[int, list[TrailStep]] = {}
    for step in all_steps:
        steps_by_run.setdefault(step.trailrun_id, []).append(step)

    # Also fetch courses referenced by trail steps (may overlap with trail_run courses)
    step_course_ids = list({s.course_id for s in all_steps} - set(course_map.keys()))
    if step_course_ids:
        extra_courses = db_session.exec(
            select(Course).where(Course.id.in_(step_course_ids))  # type: ignore
        ).all()
        for c in extra_courses:
            course_map[c.id] = c

    # Build trail runs
    trail_runs = []
    for tr in trail_runs_raw:
        course = course_map.get(tr.course_id)
        run = TrailRunRead(
            **tr.model_dump(),
            course=course.model_dump() if course else {},
            steps=[],
            course_total_steps=course_total_steps_map.get(tr.course_id, 0) if with_course_info else 0,
        )

        # Attach steps with course data (expunge to avoid dirty-tracking the data override)
        for step in steps_by_run.get(tr.id, []):
            db_session.expunge(step)
            step_course = course_map.get(step.course_id)
            step.data = dict(course=step_course)
            run.steps.append(step)

        trail_runs.append(run)

    return TrailRead(**trail.model_dump(), runs=trail_runs)


async def create_user_trail(
    request: Request,
    user: PublicUser,
    trail_object: TrailCreate,
    db_session: Session,
) -> Trail:
    statement = select(Trail).where(
        Trail.org_id == trail_object.org_id, Trail.user_id == user.id
    )
    trail = db_session.exec(statement).first()

    if trail:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Trail already exists",
        )

    trail = Trail.model_validate(trail_object)

    trail.creation_date = str(datetime.now())
    trail.update_date = str(datetime.now())
    trail.org_id = trail_object.org_id
    trail.trail_uuid = str(f"trail_{uuid4()}")

    # create trail
    db_session.add(trail)
    db_session.commit()
    db_session.refresh(trail)

    return trail


async def get_user_trails(
    request: Request,
    user: PublicUser,
    db_session: Session,
) -> TrailRead:
    statement = select(Trail).where(Trail.user_id == user.id)
    trail = db_session.exec(statement).first()

    if not trail:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Trail not found"
        )

    statement = select(TrailRun).where(TrailRun.trail_id == trail.id)
    trail_runs_raw = db_session.exec(statement).all()

    return _build_trail_read(trail, list(trail_runs_raw), db_session)


async def check_trail_presence(
    org_id: int,
    user_id: int,
    request: Request,
    user: PublicUser,
    db_session: Session,
):
    statement = select(Trail).where(Trail.org_id == org_id, Trail.user_id == user_id)
    trail = db_session.exec(statement).first()

    if not trail:
        trail = await create_user_trail(
            request,
            user,
            TrailCreate(
                org_id=org_id,
                user_id=user.id,
            ),
            db_session,
        )
        return trail

    return trail


async def get_user_trail_with_orgid(
    request: Request, user: PublicUser | AnonymousUser, org_id: int, db_session: Session
) -> TrailRead:

    if isinstance(user, AnonymousUser):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Anonymous users cannot access this endpoint",
        )

    trail = await check_trail_presence(
        org_id=org_id,
        user_id=user.id,
        request=request,
        user=user,
        db_session=db_session,
    )

    statement = select(TrailRun).where(TrailRun.trail_id == trail.id)
    trail_runs_raw = db_session.exec(statement).all()

    return _build_trail_read(trail, list(trail_runs_raw), db_session)


async def add_activity_to_trail(
    request: Request,
    user: PublicUser,
    activity_uuid: str,
    db_session: Session,
) -> TrailRead:
    # Look for the activity
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Activity not found"
        )

    statement = select(Course).where(Course.id == activity.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found"
        )

    trail = await check_trail_presence(
        org_id=course.org_id,
        user_id=user.id,
        request=request,
        user=user,
        db_session=db_session,
    )

    statement = select(TrailRun).where(
        TrailRun.trail_id == trail.id, TrailRun.course_id == course.id, TrailRun.user_id == user.id
    )
    trailrun = db_session.exec(statement).first()

    if not trailrun:
        trailrun = TrailRun(
            trail_id=trail.id if trail.id is not None else 0,
            course_id=course.id if course.id is not None else 0,
            org_id=course.org_id,
            user_id=user.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(trailrun)
        db_session.commit()
        db_session.refresh(trailrun)

    statement = select(TrailStep).where(
        TrailStep.trailrun_id == trailrun.id, TrailStep.activity_id == activity.id, TrailStep.user_id == user.id
    )
    trailstep = db_session.exec(statement).first()

    is_new_completion = trailstep is None
    if is_new_completion:
        trailstep = TrailStep(
            trailrun_id=trailrun.id if trailrun.id is not None else 0,
            activity_id=activity.id if activity.id is not None else 0,
            course_id=course.id if course.id is not None else 0,
            trail_id=trail.id if trail.id is not None else 0,
            org_id=course.org_id,
            complete=True,
            teacher_verified=False,
            grade="",
            user_id=user.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(trailstep)
        db_session.commit()
        db_session.refresh(trailstep)

    # Only track on first completion — avoid duplicates on re-visits
    if is_new_completion:
        await track(
            event_name=analytics_events.ACTIVITY_COMPLETED,
            org_id=course.org_id,
            user_id=user.id,
            properties={
                "activity_uuid": activity_uuid,
                "course_uuid": course.course_uuid,
                "activity_type": activity.activity_type if activity.activity_type else "",
            },
        )
        await dispatch_webhooks(
            event_name=analytics_events.ACTIVITY_COMPLETED,
            org_id=course.org_id,
            data={
                "user": {"user_uuid": user.user_uuid, "email": user.email, "username": user.username},
                "activity": {"activity_uuid": activity_uuid, "activity_type": activity.activity_type or ""},
                "course": {"course_uuid": course.course_uuid, "name": course.name},
            },
        )

    # Check if all activities in the course are completed and create certificate if so
    course_was_completed = False
    if course and course.id:
        course_was_completed = await check_course_completion_and_create_certificate(
            request, user.id, course.id, db_session
        )

    if course_was_completed:
        await track(
            event_name=analytics_events.COURSE_COMPLETED,
            org_id=course.org_id,
            user_id=user.id,
            properties={"course_uuid": course.course_uuid},
        )
        await dispatch_webhooks(
            event_name=analytics_events.COURSE_COMPLETED,
            org_id=course.org_id,
            data={
                "user": {"user_uuid": user.user_uuid, "email": user.email, "username": user.username},
                "course": {"course_uuid": course.course_uuid, "name": course.name},
            },
        )

    statement = select(TrailRun).where(TrailRun.trail_id == trail.id, TrailRun.user_id == user.id)
    trail_runs_raw = db_session.exec(statement).all()

    return _build_trail_read(trail, list(trail_runs_raw), db_session, user_id=user.id)

async def remove_activity_from_trail(
    request: Request,
    user: PublicUser,
    activity_uuid: str,
    db_session: Session,
) -> TrailRead:
    # Look for the activity
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Activity not found"
        )

    statement = select(Course).where(Course.id == activity.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found"
        )

    statement = select(Trail).where(
        Trail.org_id == course.org_id, Trail.user_id == user.id
    )
    trail = db_session.exec(statement).first()

    if not trail:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Trail not found"
        )

    # Delete the trail step for this activity
    statement = select(TrailStep).where(
        TrailStep.activity_id == activity.id, 
        TrailStep.user_id == user.id,
        TrailStep.trail_id == trail.id
    )
    trail_step = db_session.exec(statement).first()

    if trail_step:
        db_session.delete(trail_step)
        db_session.commit()

    # Get updated trail data
    statement = select(TrailRun).where(TrailRun.trail_id == trail.id, TrailRun.user_id == user.id)
    trail_runs_raw = db_session.exec(statement).all()

    return _build_trail_read(trail, list(trail_runs_raw), db_session, user_id=user.id)


async def add_course_to_trail(
    request: Request,
    user: PublicUser,
    course_uuid: str,
    db_session: Session,
) -> TrailRead:
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found"
        )

    # check if run already exists
    statement = select(TrailRun).where(
        TrailRun.course_id == course.id, TrailRun.user_id == user.id
    )
    trailrun = db_session.exec(statement).first()

    if trailrun:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="TrailRun already exists"
        )

    statement = select(Trail).where(
        Trail.org_id == course.org_id, Trail.user_id == user.id
    )
    trail = db_session.exec(statement).first()

    if not trail:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Trail not found"
        )

    statement = select(TrailRun).where(
        TrailRun.trail_id == trail.id, TrailRun.course_id == course.id, TrailRun.user_id == user.id
    )
    trail_run = db_session.exec(statement).first()

    if not trail_run:
        trail_run = TrailRun(
            trail_id=trail.id if trail.id is not None else 0,
            course_id=course.id if course.id is not None else 0,
            org_id=course.org_id,
            user_id=user.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(trail_run)
        db_session.commit()
        db_session.refresh(trail_run)

    # Track course enrollment
    await track(
        event_name=analytics_events.COURSE_ENROLLED,
        org_id=course.org_id,
        user_id=user.id,
        properties={"course_uuid": course.course_uuid},
    )
    await dispatch_webhooks(
        event_name=analytics_events.COURSE_ENROLLED,
        org_id=course.org_id,
        data={
            "user": {"user_uuid": user.user_uuid, "email": user.email, "username": user.username},
            "course": {"course_uuid": course.course_uuid, "name": course.name},
        },
    )

    statement = select(TrailRun).where(TrailRun.trail_id == trail.id, TrailRun.user_id == user.id)
    trail_runs_raw = db_session.exec(statement).all()

    return _build_trail_read(trail, list(trail_runs_raw), db_session, user_id=user.id)


async def remove_course_from_trail(
    request: Request,
    user: PublicUser,
    course_uuid: str,
    db_session: Session,
) -> TrailRead:
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found"
        )

    statement = select(Trail).where(
        Trail.org_id == course.org_id, Trail.user_id == user.id
    )
    trail = db_session.exec(statement).first()

    if not trail:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Trail not found"
        )

    statement = select(TrailRun).where(
        TrailRun.trail_id == trail.id, TrailRun.course_id == course.id, TrailRun.user_id == user.id
    )
    trail_run = db_session.exec(statement).first()

    if trail_run:
        db_session.delete(trail_run)
        db_session.commit()

    # Delete all trail steps for this course
    statement = select(TrailStep).where(TrailStep.course_id == course.id, TrailStep.user_id == user.id)
    trail_steps = db_session.exec(statement).all()

    for trail_step in trail_steps:
        db_session.delete(trail_step)
        db_session.commit()

    statement = select(TrailRun).where(TrailRun.trail_id == trail.id, TrailRun.user_id == user.id)
    trail_runs_raw = db_session.exec(statement).all()

    return _build_trail_read(trail, list(trail_runs_raw), db_session, user_id=user.id)
