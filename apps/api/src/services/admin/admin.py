"""
Admin API service layer.

Provides headless API operations using API token authentication.
All functions require an APITokenUser and operate within the token's org scope.
"""

from datetime import datetime
from typing import List
from uuid import uuid4
from fastapi import HTTPException, Request, status
from sqlmodel import Session, select, func
from src.db.courses.activities import Activity
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.courses import (
    Course,
    CourseRead,
    FullCourseRead,
    AuthorWithRole,
)
from src.db.collections import Collection
from src.db.collections_courses import CollectionCourse
from src.db.courses.certifications import (
    CertificateUser,
    CertificateUserRead,
    CertificationRead,
    Certifications,
)
from src.db.organizations import Organization
from src.db.resource_authors import ResourceAuthor
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.trails import Trail, TrailRead
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, PublicUser, User, UserRead
from src.services.trail.trail import _build_trail_read
from src.services.courses.certifications import check_course_completion_and_create_certificate
from src.services.analytics.analytics import track
from src.services.analytics import events as analytics_events
from src.security.auth import create_access_token
from src.security.features_utils.plan_check import get_org_plan
from src.security.features_utils.plans import plan_meets_requirement


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


# -- User endpoints -----------------------------------------------------------


async def get_user(
    token_user: APITokenUser,
    user_id: int,
    db_session: Session,
) -> UserRead:
    """Get a user's profile within the token's org."""

    user = _get_user_in_org(user_id, token_user.org_id, db_session)
    return UserRead.model_validate(user)


async def list_users(
    token_user: APITokenUser,
    db_session: Session,
    page: int = 1,
    limit: int = 25,
) -> List[UserRead]:
    """List users in the token's organization with pagination."""

    offset = (page - 1) * limit

    statement = (
        select(User)
        .join(UserOrganization, UserOrganization.user_id == User.id)  # type: ignore
        .where(UserOrganization.org_id == token_user.org_id)
        .order_by(User.id.asc())  # type: ignore
        .offset(offset)
        .limit(limit)
    )
    users = db_session.exec(statement).all()
    return [UserRead.model_validate(u) for u in users]


async def get_user_courses(
    token_user: APITokenUser,
    user_id: int,
    db_session: Session,
) -> List[CourseRead]:
    """List courses a user is enrolled in (has a TrailRun for) within the org."""

    _get_user_in_org(user_id, token_user.org_id, db_session)

    statement = (
        select(Course)
        .join(TrailRun, TrailRun.course_id == Course.id)  # type: ignore
        .where(
            TrailRun.user_id == user_id,
            TrailRun.org_id == token_user.org_id,
        )
    )
    courses = db_session.exec(statement).all()

    if not courses:
        return []

    course_uuids = [c.course_uuid for c in courses]
    authors_query = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)  # type: ignore
        .where(ResourceAuthor.resource_uuid.in_(course_uuids))  # type: ignore
        .order_by(ResourceAuthor.id.asc())  # type: ignore
    )
    author_results = db_session.exec(authors_query).all()

    course_authors: dict[str, list[AuthorWithRole]] = {}
    for ra, u in author_results:
        course_authors.setdefault(ra.resource_uuid, []).append(
            AuthorWithRole(
                user=UserRead.model_validate(u),
                authorship=ra.authorship,
                authorship_status=ra.authorship_status,
                creation_date=ra.creation_date,
                update_date=ra.update_date,
            )
        )

    return [
        CourseRead(
            **c.model_dump(),
            authors=course_authors.get(c.course_uuid, []),
        )
        for c in courses
    ]


# -- Course endpoints (read-only) ---------------------------------------------


async def list_courses(
    request: Request,
    token_user: APITokenUser,
    db_session: Session,
    page: int = 1,
    limit: int = 25,
    published_only: bool = True,
) -> List[CourseRead]:
    """List courses in the token's organization."""

    offset = (page - 1) * limit

    query = (
        select(Course)
        .where(Course.org_id == token_user.org_id)
        .order_by(Course.creation_date.desc())  # type: ignore
        .offset(offset)
        .limit(limit)
    )
    if published_only:
        query = query.where(Course.published == True)

    courses = db_session.exec(query).all()
    if not courses:
        return []

    course_uuids = [c.course_uuid for c in courses]
    authors_query = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)  # type: ignore
        .where(ResourceAuthor.resource_uuid.in_(course_uuids))  # type: ignore
        .order_by(ResourceAuthor.id.asc())  # type: ignore
    )
    author_results = db_session.exec(authors_query).all()

    course_authors: dict[str, list[AuthorWithRole]] = {}
    for ra, u in author_results:
        course_authors.setdefault(ra.resource_uuid, []).append(
            AuthorWithRole(
                user=UserRead.model_validate(u),
                authorship=ra.authorship,
                authorship_status=ra.authorship_status,
                creation_date=ra.creation_date,
                update_date=ra.update_date,
            )
        )

    return [
        CourseRead(**c.model_dump(), authors=course_authors.get(c.course_uuid, []))
        for c in courses
    ]


async def get_course(
    request: Request,
    token_user: APITokenUser,
    course_uuid: str,
    db_session: Session,
) -> CourseRead:
    """Get a single course by UUID within the token's org."""


    course = db_session.exec(
        select(Course).where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    authors_query = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)  # type: ignore
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
        .order_by(ResourceAuthor.id.asc())  # type: ignore
    )
    author_results = db_session.exec(authors_query).all()
    authors = [
        AuthorWithRole(
            user=UserRead.model_validate(u),
            authorship=ra.authorship,
            authorship_status=ra.authorship_status,
            creation_date=ra.creation_date,
            update_date=ra.update_date,
        )
        for ra, u in author_results
    ]
    return CourseRead(**course.model_dump(), authors=authors)


async def get_course_structure(
    request: Request,
    token_user: APITokenUser,
    course_uuid: str,
    db_session: Session,
    slim: bool = False,
) -> FullCourseRead:
    """Get a course with its full chapter/activity tree."""


    from src.services.courses.chapters import get_course_chapters

    course_statement = (
        select(Course, Organization)
        .join(Organization, Organization.id == Course.org_id)  # type: ignore
        .where(
            Course.course_uuid == course_uuid,
            Course.org_id == token_user.org_id,
        )
    )
    result = db_session.exec(course_statement).first()
    if not result:
        raise HTTPException(status_code=404, detail="Course not found")

    course, org = result

    # Fetch authors
    authors_query = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)  # type: ignore
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
        .order_by(ResourceAuthor.id.asc())  # type: ignore
    )
    author_results = db_session.exec(authors_query).all()
    authors = [
        AuthorWithRole(
            user=UserRead.model_validate(u),
            authorship=ra.authorship,
            authorship_status=ra.authorship_status,
            creation_date=ra.creation_date,
            update_date=ra.update_date,
        )
        for ra, u in author_results
    ]

    # Look up the actual user who created the token to satisfy the chapters service signature
    creator = db_session.exec(select(User).where(User.id == token_user.created_by_user_id)).first()
    if not creator:
        raise HTTPException(status_code=500, detail="Token creator user not found")
    proxy_user = PublicUser.model_validate(creator)

    chapters = []
    if course.id is not None:
        chapters = await get_course_chapters(
            request, course.id, db_session, proxy_user,
            with_unpublished_activities=False, slim=slim,
        )

    return FullCourseRead(
        **course.model_dump(),
        org_uuid=org.org_uuid,
        authors=authors,
        chapters=chapters,
    )


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


# -- Collection endpoints (read-only) -----------------------------------------


async def list_collections(
    token_user: APITokenUser,
    db_session: Session,
    page: int = 1,
    limit: int = 25,
) -> list:
    """List collections in the token's org."""

    offset = (page - 1) * limit

    collections = db_session.exec(
        select(Collection)
        .where(Collection.org_id == token_user.org_id)
        .offset(offset)
        .limit(limit)
    ).all()

    if not collections:
        return []

    collection_ids = [c.id for c in collections]
    batch = db_session.exec(
        select(CollectionCourse, Course)
        .join(Course, CollectionCourse.course_id == Course.id)  # type: ignore
        .where(
            CollectionCourse.collection_id.in_(collection_ids),  # type: ignore
            Course.org_id == token_user.org_id,
        )
    ).all()

    courses_map: dict[int, list] = {}
    seen: set[tuple[int, int]] = set()
    for cc, course in batch:
        key = (cc.collection_id, course.id)
        if key not in seen:
            seen.add(key)
            courses_map.setdefault(cc.collection_id, []).append(course.model_dump())

    return [
        {**c.model_dump(), "courses": courses_map.get(c.id, [])}
        for c in collections
    ]


async def get_collection(
    token_user: APITokenUser,
    collection_uuid: str,
    db_session: Session,
) -> dict:
    """Get a single collection with its courses."""


    collection = db_session.exec(
        select(Collection).where(
            Collection.collection_uuid == collection_uuid,
            Collection.org_id == token_user.org_id,
        )
    ).first()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    courses = db_session.exec(
        select(Course)
        .join(CollectionCourse)
        .where(
            CollectionCourse.collection_id == collection.id,
            Course.org_id == token_user.org_id,
        )
        .distinct()
    ).all()

    return {**collection.model_dump(), "courses": [c.model_dump() for c in courses]}


# -- Content endpoints (read-only) --------------------------------------------


async def get_chapter(
    token_user: APITokenUser,
    chapter_id: int,
    db_session: Session,
) -> dict:
    """Get a chapter by ID within the token's org."""


    chapter = db_session.exec(select(Chapter).where(Chapter.id == chapter_id)).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    # Verify org boundary via the course
    course = db_session.exec(select(Course).where(Course.id == chapter.course_id)).first()
    if not course or course.org_id != token_user.org_id:
        raise HTTPException(status_code=404, detail="Chapter not found")

    # Get activities in this chapter
    activities = db_session.exec(
        select(Activity)
        .join(ChapterActivity, ChapterActivity.activity_id == Activity.id)  # type: ignore
        .where(
            ChapterActivity.chapter_id == chapter.id,
            Activity.published == True,
        )
        .order_by(ChapterActivity.order.asc())  # type: ignore
    ).all()

    return {
        **chapter.model_dump(),
        "activities": [a.model_dump() for a in activities],
    }


async def get_activity(
    token_user: APITokenUser,
    activity_uuid: str,
    db_session: Session,
) -> dict:
    """Get a single activity by UUID within the token's org."""


    activity = db_session.exec(
        select(Activity).where(Activity.activity_uuid == activity_uuid)
    ).first()
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Verify org boundary
    course = db_session.exec(select(Course).where(Course.id == activity.course_id)).first()
    if not course or course.org_id != token_user.org_id:
        raise HTTPException(status_code=404, detail="Activity not found")

    return activity.model_dump()


async def get_chapter_activities(
    token_user: APITokenUser,
    chapter_id: int,
    db_session: Session,
) -> List[dict]:
    """Get all activities for a chapter."""


    chapter = db_session.exec(select(Chapter).where(Chapter.id == chapter_id)).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    course = db_session.exec(select(Course).where(Course.id == chapter.course_id)).first()
    if not course or course.org_id != token_user.org_id:
        raise HTTPException(status_code=404, detail="Chapter not found")

    activities = db_session.exec(
        select(Activity)
        .join(ChapterActivity, ChapterActivity.activity_id == Activity.id)  # type: ignore
        .where(
            ChapterActivity.chapter_id == chapter_id,
            Activity.published == True,
        )
        .order_by(ChapterActivity.order.asc())  # type: ignore
    ).all()

    return [a.model_dump() for a in activities]


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

    # Completed activities
    completed_steps = db_session.exec(
        select(TrailStep).where(
            TrailStep.user_id == user_id,
            TrailStep.course_id == course.id,
            TrailStep.complete == True,
        )
    ).all()

    completed_activity_ids = [s.activity_id for s in completed_steps]

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
