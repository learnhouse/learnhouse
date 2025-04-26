from datetime import datetime
from uuid import uuid4
from src.db.courses.chapter_activities import ChapterActivity
from fastapi import HTTPException, Request, status
from sqlmodel import Session, select
from src.db.courses.activities import Activity
from src.db.courses.courses import Course
from src.db.trail_runs import TrailRun, TrailRunRead
from src.db.trail_steps import TrailStep
from src.db.trails import Trail, TrailCreate, TrailRead
from src.db.users import AnonymousUser, PublicUser


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
    trail_runs = db_session.exec(statement).all()

    trail_runs = [
        TrailRunRead(**trail_run.__dict__, course={}, steps=[], course_total_steps=0)
        for trail_run in trail_runs
    ]

    # Add course object and total activities in a course to trail runs
    for trail_run in trail_runs:
        statement = select(Course).where(Course.id == trail_run.course_id)
        course = db_session.exec(statement).first()
        trail_run.course = course

        # Add number of activities (steps) in a course
        statement = select(ChapterActivity).where(
            ChapterActivity.course_id == trail_run.course_id
        )
        course_total_steps = db_session.exec(statement)
        # count number of activities in a this list
        trail_run.course_total_steps = len(course_total_steps.all())

    for trail_run in trail_runs:
        statement = select(TrailStep).where(TrailStep.trailrun_id == trail_run.id)
        trail_steps = db_session.exec(statement).all()

        trail_steps = [TrailStep(**trail_step.__dict__) for trail_step in trail_steps]
        trail_run.steps = trail_steps

        for trail_step in trail_steps:
            statement = select(Course).where(Course.id == trail_step.course_id)
            course = db_session.exec(statement).first()
            trail_step.data = dict(course=course)

    trail_read = TrailRead(
        **trail.model_dump(),
        runs=trail_runs,
    )

    return trail_read


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
    trail_runs = db_session.exec(statement).all()

    trail_runs = [
        TrailRunRead(**trail_run.__dict__, course={}, steps=[], course_total_steps=0)
        for trail_run in trail_runs
    ]

    # Add course object and total activities in a course to trail runs
    for trail_run in trail_runs:
        statement = select(Course).where(Course.id == trail_run.course_id)
        course = db_session.exec(statement).first()
        trail_run.course = course 

        # Add number of activities (steps) in a course
        statement = select(ChapterActivity).where(
            ChapterActivity.course_id == trail_run.course_id
        )
        course_total_steps = db_session.exec(statement)
        # count number of activities in a this list
        trail_run.course_total_steps = len(course_total_steps.all())

    for trail_run in trail_runs:
        statement = select(TrailStep).where(TrailStep.trailrun_id == trail_run.id)
        trail_steps = db_session.exec(statement).all()

        trail_steps = [TrailStep(**trail_step.__dict__) for trail_step in trail_steps]
        trail_run.steps = trail_steps

        for trail_step in trail_steps:
            statement = select(Course).where(Course.id == trail_step.course_id)
            course = db_session.exec(statement).first()
            trail_step.data = dict(course=course)

    trail_read = TrailRead(
        **trail.model_dump(),
        runs=trail_runs,
    )

    return trail_read


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

    if not trailstep:
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

    statement = select(TrailRun).where(TrailRun.trail_id == trail.id , TrailRun.user_id == user.id)
    trail_runs = db_session.exec(statement).all()

    trail_runs = [
        TrailRunRead(**trail_run.__dict__, course={}, steps=[], course_total_steps=0)
        for trail_run in trail_runs
    ]

    for trail_run in trail_runs:
        statement = select(TrailStep).where(TrailStep.trailrun_id == trail_run.id, TrailStep.user_id == user.id)
        trail_steps = db_session.exec(statement).all()

        trail_steps = [TrailStep(**trail_step.__dict__) for trail_step in trail_steps]
        trail_run.steps = trail_steps

        for trail_step in trail_steps:
            statement = select(Course).where(Course.id == trail_step.course_id)
            course = db_session.exec(statement).first()
            trail_step.data = dict(course=course)

    trail_read = TrailRead(
        **trail.model_dump(),
        runs=trail_runs,
    )

    return trail_read

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
    trail_runs = db_session.exec(statement).all()

    trail_runs = [
        TrailRunRead(**trail_run.__dict__, course={}, steps=[], course_total_steps=0)
        for trail_run in trail_runs
    ]

    for trail_run in trail_runs:
        statement = select(TrailStep).where(TrailStep.trailrun_id == trail_run.id, TrailStep.user_id == user.id)
        trail_steps = db_session.exec(statement).all()

        trail_steps = [TrailStep(**trail_step.__dict__) for trail_step in trail_steps]
        trail_run.steps = trail_steps

        for trail_step in trail_steps:
            statement = select(Course).where(Course.id == trail_step.course_id)
            course = db_session.exec(statement).first()
            trail_step.data = dict(course=course)

    trail_read = TrailRead(
        **trail.model_dump(),
        runs=trail_runs,
    )

    return trail_read


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

    statement = select(TrailRun).where(TrailRun.trail_id == trail.id, TrailRun.user_id == user.id)
    trail_runs = db_session.exec(statement).all()

    trail_runs = [
        TrailRunRead(**trail_run.__dict__, course={}, steps=[], course_total_steps=0)
        for trail_run in trail_runs
    ]

    for trail_run in trail_runs:
        statement = select(TrailStep).where(TrailStep.trailrun_id == trail_run.id , TrailStep.user_id == user.id)
        trail_steps = db_session.exec(statement).all()

        trail_steps = [TrailStep(**trail_step.__dict__) for trail_step in trail_steps]
        trail_run.steps = trail_steps

        for trail_step in trail_steps:
            statement = select(Course).where(Course.id == trail_step.course_id)
            course = db_session.exec(statement).first()
            trail_step.data = dict(course=course)

    trail_read = TrailRead(
        **trail.model_dump(),
        runs=trail_runs,
    )

    return trail_read


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
    trail_runs = db_session.exec(statement).all()

    trail_runs = [
        TrailRunRead(**trail_run.__dict__, course={}, steps=[], course_total_steps=0)
        for trail_run in trail_runs
    ]

    for trail_run in trail_runs:
        statement = select(TrailStep).where(TrailStep.trailrun_id == trail_run.id, TrailStep.user_id == user.id)
        trail_steps = db_session.exec(statement).all()

        trail_steps = [TrailStep(**trail_step.__dict__) for trail_step in trail_steps]
        trail_run.steps = trail_steps

        for trail_step in trail_steps:
            statement = select(Course).where(Course.id == trail_step.course_id)
            course = db_session.exec(statement).first()
            trail_step.data = dict(course=course)

    trail_read = TrailRead(
        **trail.model_dump(),
        runs=trail_runs,
    )

    return trail_read
