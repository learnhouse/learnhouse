"""Learning paths: an org-curated, ordered sequence of courses that awards its
own certificate once every required course (and enough electives) is done.

Authoring rides on the role's ``courses`` rights, since a path is a way of
arranging courses. Reading follows the same public/published rules as
courses: drafts are for authors only, private paths for org members only.
"""
import logging
import secrets
from datetime import datetime
from typing import List, Optional
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.courses import Course
from src.db.paths import (
    Path,
    PathCertificate,
    PathCourse,
    PathCourseRead,
    PathCoursesUpdate,
    PathCreate,
    PathEnrollment,
    PathLearnerRead,
    PathProgress,
    PathRead,
    PathUpdate,
)
from src.db.trail_steps import TrailStep
from src.db.users import AnonymousUser, APITokenUser, PublicUser, User
from src.security.api_token_utils import require_token_right
from src.security.auth import resolve_acting_user_id
from src.security.org_auth import is_org_member, require_org_role_permission
from src.services.webhooks.dispatch import dispatch_webhooks
from src.services.analytics import events as analytics_events
from src.services.analytics.analytics import track

logger = logging.getLogger(__name__)

VALID_LEVELS = ("", "beginner", "intermediate", "advanced")
MAX_PATH_COURSES = 100
# Keys the certificate renderer understands. Anything else is dropped so the
# column can't be used as free-form storage.
CERTIFICATE_CONFIG_KEYS = (
    "certification_name",
    "certification_description",
    "certification_type",
    "certificate_pattern",
    "certificate_instructor",
)


# ----------------------------------------------------------------------------
# Access
# ----------------------------------------------------------------------------

def _is_anonymous(current_user) -> bool:
    return isinstance(current_user, AnonymousUser) or not resolve_acting_user_id(current_user)


async def _require_manage(current_user, org_id: int, db_session: AsyncSession, action: str) -> None:
    """403 unless the caller may author paths in ``org_id``.

    ``action`` is a role right on the ``courses`` bucket (``action_create``,
    ``action_update``, ``action_delete``)."""
    if isinstance(current_user, APITokenUser):
        if current_user.org_id != org_id:
            raise HTTPException(
                status_code=403,
                detail="API token cannot access resources outside its organization",
            )
        require_token_right(current_user, "courses", action)
        return
    if _is_anonymous(current_user):
        raise HTTPException(status_code=401, detail="You must be logged in to perform this action")
    await require_org_role_permission(current_user.id, org_id, db_session, "courses", action)


async def _can_manage(current_user, org_id: int, db_session: AsyncSession) -> bool:
    try:
        await _require_manage(current_user, org_id, db_session, "action_update")
    except HTTPException:
        return False
    return True


async def _is_member(current_user, org_id: int, db_session: AsyncSession) -> bool:
    """Whether the caller may see ``org_id``'s members-only paths. An API
    token counts only for its own org: its creator being a member of another
    org must not open that org's private paths to the token."""
    if isinstance(current_user, APITokenUser):
        return current_user.org_id == org_id
    if _is_anonymous(current_user):
        return False
    return await is_org_member(current_user.id, org_id, db_session)


async def _require_view(path: Path, current_user, db_session: AsyncSession) -> bool:
    """Raise 404 unless the caller may read ``path``. Returns whether the
    caller can manage it, which the readers use to decide what to show."""
    can_manage = await _can_manage(current_user, path.org_id, db_session)
    if can_manage:
        return True
    if not path.published:
        raise HTTPException(status_code=404, detail="Path not found")
    if not path.public and not await _is_member(current_user, path.org_id, db_session):
        raise HTTPException(status_code=404, detail="Path not found")
    return False


async def _get_path(db_session: AsyncSession, path_uuid: str) -> Path:
    path = (
        await db_session.execute(select(Path).where(Path.path_uuid == path_uuid))
    ).scalars().first()
    if not path:
        raise HTTPException(status_code=404, detail="Path not found")
    return path


# ----------------------------------------------------------------------------
# Progress
# ----------------------------------------------------------------------------

def _course_card(course: Course) -> dict:
    return {
        "id": course.id,
        "course_uuid": course.course_uuid,
        "slug": course.slug,
        "org_id": course.org_id,
        "name": course.name,
        "description": course.description,
        "thumbnail_image": course.thumbnail_image,
        "thumbnail_type": course.thumbnail_type,
        "thumbnail_video": course.thumbnail_video,
        "public": course.public,
        "published": course.published,
        "creation_date": course.creation_date,
        "update_date": course.update_date,
    }


async def _course_activity_progress(
    user_id: int, course_ids: List[int], db_session: AsyncSession
) -> dict[int, tuple[int, int]]:
    """{course_id: (completed, total)} over PUBLISHED activities, two grouped
    queries for the whole batch. Same counting rule as
    ``is_course_fully_completed``."""
    if not course_ids:
        return {}
    totals = dict(
        (await db_session.execute(
            select(ChapterActivity.course_id, func.count(ChapterActivity.id))
            .join(Activity, Activity.id == ChapterActivity.activity_id)
            .where(ChapterActivity.course_id.in_(course_ids), Activity.published == True)  # noqa: E712
            .group_by(ChapterActivity.course_id)
        )).all()
    )
    done: dict = {}
    if user_id:
        done = dict(
            (await db_session.execute(
                select(TrailStep.course_id, func.count(func.distinct(TrailStep.activity_id)))
                .join(
                    ChapterActivity,
                    (ChapterActivity.activity_id == TrailStep.activity_id)
                    & (ChapterActivity.course_id == TrailStep.course_id),
                )
                .join(Activity, Activity.id == ChapterActivity.activity_id)
                .where(
                    TrailStep.user_id == user_id,
                    TrailStep.course_id.in_(course_ids),
                    TrailStep.complete == True,  # noqa: E712
                    Activity.published == True,  # noqa: E712
                )
                .group_by(TrailStep.course_id)
            )).all()
        )
    return {cid: (int(done.get(cid, 0)), int(totals.get(cid, 0))) for cid in course_ids}


async def _completed_course_ids(
    user_id: int, courses: List[Course], db_session: AsyncSession
) -> set[int]:
    """Courses this user has fully completed AND passed every graded
    assignment in: the bar a course certificate uses, so a path certificate
    never certifies more than its courses would."""
    from src.services.courses.certifications import are_course_assignments_passed

    progress = await _course_activity_progress(user_id, [c.id for c in courses], db_session)
    completed = set()
    for course in courses:
        done, total = progress.get(course.id, (0, 0))
        if total and done >= total and await are_course_assignments_passed(user_id, course.id, db_session):
            completed.add(course.id)
    return completed


async def _load_path_courses(
    db_session: AsyncSession, path: Path
) -> list[tuple[PathCourse, Course]]:
    rows = (
        await db_session.execute(
            select(PathCourse, Course)
            .join(Course, Course.id == PathCourse.course_id)
            .where(PathCourse.path_id == path.id)
            .order_by(PathCourse.position.asc(), PathCourse.id.asc())
        )
    ).all()
    return [(pc, course) for pc, course in rows]


def _summarize(
    path: Path, rows: list[tuple[PathCourse, Course]], completed_ids: set[int]
) -> dict:
    """Completion arithmetic shared by the reader and the issuer. Only
    published courses count: a draft course can't be taken, so it must not be
    able to block the path."""
    live = [(pc, c) for pc, c in rows if c.published]
    required = [c for pc, c in live if pc.required]
    electives = [c for pc, c in live if not pc.required]
    required_done = sum(1 for c in required if c.id in completed_ids)
    electives_done = sum(1 for c in electives if c.id in completed_ids)
    electives_needed = min(max(path.electives_required or 0, 0), len(electives))
    goal = len(required) + electives_needed
    credited = required_done + min(electives_done, electives_needed)
    complete = goal > 0 and credited >= goal
    return {
        "required_total": len(required),
        "required_done": required_done,
        "electives_done": electives_done,
        "courses_needed": goal,
        "courses_done": credited,
        "percent": int(round(100 * credited / goal)) if goal else 0,
        "complete": complete,
    }


# ----------------------------------------------------------------------------
# Serialization
# ----------------------------------------------------------------------------

async def _counts(db_session: AsyncSession, path_ids: List[int]) -> tuple[dict, dict]:
    if not path_ids:
        return {}, {}
    course_counts = dict(
        (await db_session.execute(
            select(PathCourse.path_id, func.count(PathCourse.id))
            .join(Course, Course.id == PathCourse.course_id)
            .where(PathCourse.path_id.in_(path_ids), Course.published == True)  # noqa: E712
            .group_by(PathCourse.path_id)
        )).all()
    )
    enrollment_counts = dict(
        (await db_session.execute(
            select(PathEnrollment.path_id, func.count(PathEnrollment.id))
            .where(PathEnrollment.path_id.in_(path_ids))
            .group_by(PathEnrollment.path_id)
        )).all()
    )
    return course_counts, enrollment_counts


async def _viewer_progress(
    db_session: AsyncSession,
    path: Path,
    rows: list[tuple[PathCourse, Course]],
    user_id: int,
    completed_ids: Optional[set[int]] = None,
) -> PathProgress:
    enrollment = (
        await db_session.execute(
            select(PathEnrollment).where(
                PathEnrollment.path_id == path.id, PathEnrollment.user_id == user_id
            )
        )
    ).scalars().first()
    certificate = (
        await db_session.execute(
            select(PathCertificate).where(
                PathCertificate.path_id == path.id, PathCertificate.user_id == user_id
            )
        )
    ).scalars().first()
    if completed_ids is None:
        completed_ids = await _completed_course_ids(user_id, [c for _, c in rows], db_session)
    summary = _summarize(path, rows, completed_ids)
    return PathProgress(
        enrolled=enrollment is not None,
        enrolled_at=enrollment.enrolled_at if enrollment else None,
        completed=bool(enrollment and enrollment.completed_at) or summary["complete"],
        completed_at=enrollment.completed_at if enrollment else None,
        required_total=summary["required_total"],
        required_done=summary["required_done"],
        electives_done=summary["electives_done"],
        courses_needed=summary["courses_needed"],
        courses_done=summary["courses_done"],
        percent=summary["percent"],
        certificate_uuid=certificate.certificate_uuid if certificate and not certificate.revoked_at else None,
        certificate_revoked=bool(certificate and certificate.revoked_at),
    )


async def _path_to_read(
    db_session: AsyncSession,
    path: Path,
    current_user,
    can_manage: bool,
    with_courses: bool = True,
) -> PathRead:
    course_counts, enrollment_counts = await _counts(db_session, [path.id])
    read = PathRead(
        **path.model_dump(exclude={"certificate_config"}),
        certificate_config=path.certificate_config or {},
        course_count=course_counts.get(path.id, 0),
        enrollment_count=enrollment_counts.get(path.id, 0),
    )
    viewer_id = 0 if _is_anonymous(current_user) else resolve_acting_user_id(current_user)
    rows = await _load_path_courses(db_session, path)

    completed_ids: set[int] = set()
    progress_by_course: dict[int, tuple[int, int]] = {}
    if viewer_id and not isinstance(current_user, APITokenUser):
        courses = [c for _, c in rows]
        progress_by_course = await _course_activity_progress(viewer_id, [c.id for c in courses], db_session)
        completed_ids = await _completed_course_ids(viewer_id, courses, db_session)
        read.progress = await _viewer_progress(db_session, path, rows, viewer_id, completed_ids)

    if not with_courses:
        return read

    hidden: set[str] = set()
    if not can_manage:
        from src.services.folders.folders import _hidden_gated_uuids

        include_private = await _is_member(current_user, path.org_id, db_session)
        hidden = await _hidden_gated_uuids(
            db_session,
            [(c, c.course_uuid) for _, c in rows],
            include_private,
            viewer_id or 0,
        )

    items: List[PathCourseRead] = []
    blocked = False
    for pc, course in rows:
        if not can_manage and not course.published:
            continue
        done, total = progress_by_course.get(course.id, (0, 0))
        completed = course.id in completed_ids
        restricted = course.course_uuid in hidden
        card = _course_card(course)
        if restricted:
            # Keep the slot so the learner sees the path's real shape, but
            # don't leak a course they can't open.
            card = {"course_uuid": course.course_uuid, "restricted": True}
        items.append(
            PathCourseRead(
                course_uuid=course.course_uuid,
                position=pc.position,
                required=pc.required,
                course=card,
                completed=completed,
                started=done > 0,
                progress=int(round(100 * done / total)) if total else 0,
                locked=bool(path.sequential and blocked and not can_manage),
            )
        )
        if pc.required and course.published and not completed:
            blocked = True
    read.courses = items
    return read


# ----------------------------------------------------------------------------
# CRUD
# ----------------------------------------------------------------------------

def _clean_certificate_config(config: Optional[dict]) -> dict:
    if not isinstance(config, dict):
        return {}
    cleaned = {}
    for key in CERTIFICATE_CONFIG_KEYS:
        value = config.get(key)
        if isinstance(value, str):
            cleaned[key] = value[:500]
    return cleaned


def _validate(level: Optional[str], electives_required: Optional[int]) -> None:
    if level is not None and level not in VALID_LEVELS:
        raise HTTPException(status_code=400, detail="Invalid level")
    if electives_required is not None and electives_required < 0:
        raise HTTPException(status_code=400, detail="electives_required must be 0 or more")


async def create_path(
    request: Request,
    path_object: PathCreate,
    current_user: PublicUser | APITokenUser,
    db_session: AsyncSession,
) -> PathRead:
    await _require_manage(current_user, path_object.org_id, db_session, "action_create")
    # The router gate can't see the org: it's in the body.
    from src.security.features_utils.plan_check import check_org_plan
    await check_org_plan(path_object.org_id, "pro", "Paths", db_session)
    _validate(path_object.level, path_object.electives_required)
    name = (path_object.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="A path needs a name")

    now = str(datetime.now())
    path = Path(
        name=name[:200],
        description=path_object.description or "",
        about=path_object.about or "",
        thumbnail_image=path_object.thumbnail_image or "",
        level=path_object.level or "",
        public=path_object.public,
        published=path_object.published,
        sequential=path_object.sequential,
        electives_required=path_object.electives_required or 0,
        certificate_enabled=path_object.certificate_enabled,
        certificate_config={},
        org_id=path_object.org_id,
        path_uuid=f"path_{uuid4()}",
        creation_date=now,
        update_date=now,
    )
    db_session.add(path)
    await db_session.commit()
    await db_session.refresh(path)
    return await _path_to_read(db_session, path, current_user, can_manage=True)


async def get_path(
    request: Request,
    path_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
) -> PathRead:
    path = await _get_path(db_session, path_uuid)
    can_manage = await _require_view(path, current_user, db_session)
    return await _path_to_read(db_session, path, current_user, can_manage)


async def update_path(
    request: Request,
    path_uuid: str,
    path_object: PathUpdate,
    current_user: PublicUser | APITokenUser,
    db_session: AsyncSession,
) -> PathRead:
    path = await _get_path(db_session, path_uuid)
    await _require_manage(current_user, path.org_id, db_session, "action_update")
    _validate(path_object.level, path_object.electives_required)

    data = path_object.model_dump(exclude_unset=True)
    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="A path needs a name")
        data["name"] = name[:200]
    if "certificate_config" in data:
        data["certificate_config"] = _clean_certificate_config(data["certificate_config"])
    for key, value in data.items():
        if value is None and key != "certificate_config":
            continue
        setattr(path, key, value)
    path.update_date = str(datetime.now())
    db_session.add(path)
    await db_session.commit()
    await db_session.refresh(path)
    return await _path_to_read(db_session, path, current_user, can_manage=True)


async def upload_path_thumbnail(
    request: Request,
    path_uuid: str,
    thumbnail_file,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> PathRead:
    from src.db.organizations import Organization
    from src.services.utils.upload_content import upload_file

    path = await _get_path(db_session, path_uuid)
    await _require_manage(current_user, path.org_id, db_session, "action_update")
    org = (
        await db_session.execute(select(Organization).where(Organization.id == path.org_id))
    ).scalars().first()

    filename = await upload_file(
        file=thumbnail_file,
        directory=f"paths/{path.path_uuid}/thumbnails",
        type_of_dir="orgs",
        uuid=org.org_uuid,
        allowed_types=["image"],
        filename_prefix="thumbnail",
    )
    path.thumbnail_image = filename
    path.update_date = str(datetime.now())
    db_session.add(path)
    await db_session.commit()
    await db_session.refresh(path)
    return await _path_to_read(db_session, path, current_user, can_manage=True)


async def delete_path(
    request: Request,
    path_uuid: str,
    current_user: PublicUser | APITokenUser,
    db_session: AsyncSession,
) -> dict:
    path = await _get_path(db_session, path_uuid)
    await _require_manage(current_user, path.org_id, db_session, "action_delete")

    # Deleting would cascade every awarded path certificate away and break the
    # verification links their holders shared. Same rule as course
    # certifications: unpublish instead, or revoke them one by one first.
    awarded = (
        await db_session.execute(
            select(func.count(PathCertificate.id)).where(
                PathCertificate.path_id == path.id, PathCertificate.revoked_at.is_(None)
            )
        )
    ).scalar_one()
    if awarded:
        raise HTTPException(
            status_code=409,
            detail=(
                f"This path has {awarded} awarded certificate{'s' if awarded != 1 else ''}. "
                "Deleting it would break the verification links their holders have shared. "
                "Unpublish the path instead, or revoke the certificates first."
            ),
        )
    await db_session.delete(path)
    await db_session.commit()
    return {"detail": "Path deleted"}


async def list_org_paths(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
) -> List[PathRead]:
    can_manage = await _can_manage(current_user, org_id, db_session)
    statement = select(Path).where(Path.org_id == org_id)
    if not can_manage:
        statement = statement.where(Path.published == True)  # noqa: E712
        if not await _is_member(current_user, org_id, db_session):
            statement = statement.where(Path.public == True)  # noqa: E712
    paths = (
        await db_session.execute(statement.order_by(Path.creation_date.desc()))
    ).scalars().all()
    return [
        await _path_to_read(db_session, path, current_user, can_manage, with_courses=False)
        for path in paths
    ]


async def set_path_courses(
    request: Request,
    path_uuid: str,
    payload: PathCoursesUpdate,
    current_user: PublicUser | APITokenUser,
    db_session: AsyncSession,
) -> PathRead:
    path = await _get_path(db_session, path_uuid)
    await _require_manage(current_user, path.org_id, db_session, "action_update")

    if len(payload.courses) > MAX_PATH_COURSES:
        raise HTTPException(status_code=400, detail=f"A path holds at most {MAX_PATH_COURSES} courses")
    uuids = [item.course_uuid for item in payload.courses]
    if len(set(uuids)) != len(uuids):
        raise HTTPException(status_code=400, detail="A course can only appear once in a path")

    courses = {}
    if uuids:
        courses = {
            c.course_uuid: c
            for c in (
                await db_session.execute(select(Course).where(Course.course_uuid.in_(uuids)))
            ).scalars().all()
        }
    for course_uuid in uuids:
        course = courses.get(course_uuid)
        # A course from another org reads as missing: no cross-tenant probing.
        if not course or course.org_id != path.org_id:
            raise HTTPException(status_code=404, detail=f"Course not found: {course_uuid}")

    existing = (
        await db_session.execute(select(PathCourse).where(PathCourse.path_id == path.id))
    ).scalars().all()
    by_course = {pc.course_id: pc for pc in existing}
    keep = set()
    now = str(datetime.now())
    for position, item in enumerate(payload.courses):
        course = courses[item.course_uuid]
        keep.add(course.id)
        row = by_course.get(course.id)
        if row is None:
            row = PathCourse(path_id=path.id, course_id=course.id, creation_date=now)
        row.position = position
        row.required = item.required
        db_session.add(row)
    for pc in existing:
        if pc.course_id not in keep:
            await db_session.delete(pc)
    path.update_date = now
    db_session.add(path)
    await db_session.commit()
    await db_session.refresh(path)
    return await _path_to_read(db_session, path, current_user, can_manage=True)


async def get_paths_for_course(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> List[PathRead]:
    """Published paths the viewer can see that include this course, so the
    course page can point learners at the bigger journey."""
    course = (
        await db_session.execute(select(Course).where(Course.course_uuid == course_uuid))
    ).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    paths = (
        await db_session.execute(
            select(Path)
            .join(PathCourse, PathCourse.path_id == Path.id)
            .where(PathCourse.course_id == course.id, Path.published == True)  # noqa: E712
            .order_by(Path.name.asc())
        )
    ).scalars().all()
    if not paths:
        return []
    member = await _is_member(current_user, course.org_id, db_session)
    return [
        await _path_to_read(db_session, path, current_user, can_manage=False, with_courses=False)
        for path in paths
        if path.public or member
    ]


# ----------------------------------------------------------------------------
# Learners
# ----------------------------------------------------------------------------

def _require_learner(current_user) -> int:
    if isinstance(current_user, APITokenUser) or _is_anonymous(current_user):
        raise HTTPException(status_code=401, detail="Sign in to follow a path")
    return current_user.id


def _user_ref(user: Optional[User]) -> dict:
    return {
        "user_uuid": getattr(user, "user_uuid", None),
        "email": getattr(user, "email", None),
        "username": getattr(user, "username", None),
    }


async def enroll_in_path(
    request: Request,
    path_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> PathRead:
    user_id = _require_learner(current_user)
    path = await _get_path(db_session, path_uuid)
    can_manage = await _require_view(path, current_user, db_session)
    if not path.published:
        raise HTTPException(status_code=400, detail="This path isn't published yet")

    existing = (
        await db_session.execute(
            select(PathEnrollment).where(
                PathEnrollment.path_id == path.id, PathEnrollment.user_id == user_id
            )
        )
    ).scalars().first()
    if not existing:
        db_session.add(
            PathEnrollment(path_id=path.id, user_id=user_id, enrolled_at=str(datetime.now()))
        )
        try:
            await db_session.commit()
        except IntegrityError:
            # A double click raced us to it; the learner is enrolled either way.
            # The rollback expires every loaded row, so reload the path.
            await db_session.rollback()
            await db_session.refresh(path)
        else:
            await track(
                event_name=analytics_events.PATH_ENROLLED,
                org_id=path.org_id,
                user_id=user_id,
                properties={"path_uuid": path.path_uuid},
            )
            try:
                await dispatch_webhooks(
                    event_name="path_enrolled",
                    org_id=path.org_id,
                    data={
                        "user": _user_ref(current_user),
                        "path": {"path_uuid": path.path_uuid, "name": path.name},
                    },
                )
            except Exception as e:
                logger.warning("path_enrolled webhook failed (non-critical): %s", e)

    # Credit work done before enrolling: a learner who already finished every
    # course gets the certificate on the spot.
    await check_path_completion(request, path, user_id, db_session)
    return await _path_to_read(db_session, path, current_user, can_manage)


async def leave_path(
    request: Request,
    path_uuid: str,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> dict:
    user_id = _require_learner(current_user)
    path = await _get_path(db_session, path_uuid)
    enrollment = (
        await db_session.execute(
            select(PathEnrollment).where(
                PathEnrollment.path_id == path.id, PathEnrollment.user_id == user_id
            )
        )
    ).scalars().first()
    if enrollment:
        # Leaving keeps any certificate already earned: it is a credential,
        # not a membership.
        await db_session.delete(enrollment)
        await db_session.commit()
    return {"detail": "Left path"}


async def get_my_paths(
    request: Request,
    org_id: int,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> List[PathRead]:
    user_id = _require_learner(current_user)
    paths = (
        await db_session.execute(
            select(Path)
            .join(PathEnrollment, PathEnrollment.path_id == Path.id)
            .where(PathEnrollment.user_id == user_id, Path.org_id == org_id)
            .order_by(PathEnrollment.enrolled_at.desc())
        )
    ).scalars().all()
    return [
        await _path_to_read(db_session, path, current_user, can_manage=False, with_courses=False)
        for path in paths
    ]


async def get_path_learners(
    request: Request,
    path_uuid: str,
    current_user: PublicUser | APITokenUser,
    db_session: AsyncSession,
) -> List[PathLearnerRead]:
    path = await _get_path(db_session, path_uuid)
    await _require_manage(current_user, path.org_id, db_session, "action_update")

    rows = (
        await db_session.execute(
            select(PathEnrollment, User)
            .join(User, User.id == PathEnrollment.user_id)
            .where(PathEnrollment.path_id == path.id)
            .order_by(PathEnrollment.enrolled_at.desc())
        )
    ).all()
    certificates = {
        cert.user_id: cert
        for cert in (
            await db_session.execute(
                select(PathCertificate).where(PathCertificate.path_id == path.id)
            )
        ).scalars().all()
    }
    path_courses = await _load_path_courses(db_session, path)
    courses = [c for _, c in path_courses]

    result = []
    for enrollment, user in rows:
        completed_ids = await _completed_course_ids(user.id, courses, db_session)
        summary = _summarize(path, path_courses, completed_ids)
        result.append(
            PathLearnerRead(
                user={
                    "id": user.id,
                    "user_uuid": user.user_uuid,
                    "username": user.username,
                    "first_name": user.first_name,
                    "last_name": user.last_name,
                    "email": user.email,
                    "avatar_image": user.avatar_image,
                },
                enrolled_at=enrollment.enrolled_at,
                completed_at=enrollment.completed_at,
                required_done=summary["required_done"],
                required_total=summary["required_total"],
                courses_needed=summary["courses_needed"],
                courses_done=summary["courses_done"],
                percent=summary["percent"],
                certificate_uuid=getattr(certificates.get(user.id), "certificate_uuid", None),
                certificate_revoked=bool(getattr(certificates.get(user.id), "revoked_at", None)),
            )
        )
    return result


# ----------------------------------------------------------------------------
# Completion + certificates
# ----------------------------------------------------------------------------

def _certificate_uuid(user: User) -> str:
    today = datetime.now().strftime("%Y%m%d")
    user_short = user.user_uuid[-4:] if user.user_uuid else "USER"
    return f"PATH-{today}-{user_short}-{secrets.token_hex(4)}"


async def check_path_completion(
    request: Optional[Request],
    path: Path,
    user_id: int,
    db_session: AsyncSession,
) -> bool:
    """Mark an enrolled learner's path complete (and certify them when the
    path awards a certificate) once the requirements are met. Returns True
    only when this call completed the path. Idempotent."""
    enrollment = (
        await db_session.execute(
            select(PathEnrollment).where(
                PathEnrollment.path_id == path.id, PathEnrollment.user_id == user_id
            )
        )
    ).scalars().first()
    if not enrollment or enrollment.completed_at or not path.published:
        return False

    rows = await _load_path_courses(db_session, path)
    completed_ids = await _completed_course_ids(user_id, [c for _, c in rows], db_session)
    if not _summarize(path, rows, completed_ids)["complete"]:
        return False

    enrollment.completed_at = str(datetime.now())
    db_session.add(enrollment)
    await db_session.commit()

    user = (await db_session.execute(select(User).where(User.id == user_id))).scalars().first()
    certificate_uuid = ""
    existing = (
        await db_session.execute(
            select(PathCertificate).where(
                PathCertificate.path_id == path.id, PathCertificate.user_id == user_id
            )
        )
    ).scalars().first()
    if existing:
        # Earned before (and kept when they left the path), or revoked by an
        # admin. A revoked certificate stays revoked until an admin reinstates it.
        certificate_uuid = "" if existing.revoked_at else existing.certificate_uuid
    elif path.certificate_enabled and user:
        certificate = PathCertificate(
            path_id=path.id,
            user_id=user_id,
            certificate_uuid=_certificate_uuid(user),
            created_at=str(datetime.now()),
        )
        db_session.add(certificate)
        try:
            await db_session.commit()
            certificate_uuid = certificate.certificate_uuid
        except IntegrityError:
            # A concurrent completion check issued it first. The rollback
            # expires every loaded row, so reload the ones used below.
            await db_session.rollback()
            await db_session.refresh(path)
            await db_session.refresh(user)
            raced = (
                await db_session.execute(
                    select(PathCertificate).where(
                        PathCertificate.path_id == path.id, PathCertificate.user_id == user_id
                    )
                )
            ).scalars().first()
            certificate_uuid = raced.certificate_uuid if raced and not raced.revoked_at else ""

    await track(
        event_name=analytics_events.PATH_COMPLETED,
        org_id=path.org_id,
        user_id=user_id,
        properties={"path_uuid": path.path_uuid},
    )
    try:
        await dispatch_webhooks(
            event_name="path_completed",
            org_id=path.org_id,
            data={
                "user": _user_ref(user),
                "path": {"path_uuid": path.path_uuid, "name": path.name},
                "certificate": {"certificate_uuid": certificate_uuid},
            },
        )
    except Exception as e:
        logger.warning("path_completed webhook failed (non-critical): %s", e)
    from src.services.feature_notifications import notify_path_completed

    await notify_path_completed(db_session, path, user_id)
    return True


async def check_paths_for_completed_course(
    request: Optional[Request],
    user_id: int,
    course_id: int,
    db_session: AsyncSession,
) -> None:
    """Called whenever a course is completed: re-checks every path the
    learner follows that contains it. Best-effort, never raises."""
    try:
        paths = (
            await db_session.execute(
                select(Path)
                .join(PathCourse, PathCourse.path_id == Path.id)
                .join(PathEnrollment, PathEnrollment.path_id == Path.id)
                .where(
                    PathCourse.course_id == course_id,
                    PathEnrollment.user_id == user_id,
                    PathEnrollment.completed_at.is_(None),
                    Path.published == True,  # noqa: E712
                )
            )
        ).scalars().all()
        if not paths:
            return
        from src.security.features_utils.plan_check import check_org_plan

        try:
            await check_org_plan(paths[0].org_id, "pro", "Paths", db_session)
        except HTTPException:
            return
        for path in paths:
            await check_path_completion(request, path, user_id, db_session)
    except Exception as e:
        logger.warning("Path completion check failed (non-critical): %s", e)


async def _certificate_payload(db_session: AsyncSession, certificate: PathCertificate) -> dict:
    from src.db.organizations import Organization

    path = (
        await db_session.execute(select(Path).where(Path.id == certificate.path_id))
    ).scalars().first()
    if not path:
        raise HTTPException(status_code=404, detail="Certificate not found")
    user = (
        await db_session.execute(select(User).where(User.id == certificate.user_id))
    ).scalars().first()
    org = (
        await db_session.execute(select(Organization).where(Organization.id == path.org_id))
    ).scalars().first()
    rows = await _load_path_courses(db_session, path)
    return {
        "certificate": {
            "certificate_uuid": certificate.certificate_uuid,
            "created_at": certificate.created_at,
        },
        "path": {
            "path_uuid": path.path_uuid,
            "name": path.name,
            "description": path.description,
            "thumbnail_image": path.thumbnail_image,
            "level": path.level,
            "certificate_config": path.certificate_config or {},
            "courses": [
                {"course_uuid": c.course_uuid, "name": c.name, "required": pc.required}
                for pc, c in rows
                if c.published
            ],
        },
        # Only what a certificate prints: the holder's name.
        "user": {
            "user_uuid": getattr(user, "user_uuid", None),
            "username": getattr(user, "username", None),
            "first_name": getattr(user, "first_name", None),
            "last_name": getattr(user, "last_name", None),
        },
        "org": {
            "org_uuid": getattr(org, "org_uuid", None),
            "name": getattr(org, "name", None),
            "slug": getattr(org, "slug", None),
        },
    }


async def get_path_certificate(
    request: Request,
    certificate_uuid: str,
    db_session: AsyncSession,
) -> dict:
    """Public verification: anyone holding the link can check it, like course
    certificates."""
    certificate = (
        await db_session.execute(
            select(PathCertificate).where(
                PathCertificate.certificate_uuid == certificate_uuid,
                PathCertificate.revoked_at.is_(None),
            )
        )
    ).scalars().first()
    if not certificate:
        raise HTTPException(status_code=404, detail="Certificate not found")
    return await _certificate_payload(db_session, certificate)


async def get_my_path_certificates(
    request: Request,
    current_user: PublicUser,
    db_session: AsyncSession,
) -> List[dict]:
    user_id = _require_learner(current_user)
    certificates = (
        await db_session.execute(
            select(PathCertificate)
            .where(PathCertificate.user_id == user_id, PathCertificate.revoked_at.is_(None))
            .order_by(PathCertificate.created_at.desc())
        )
    ).scalars().all()
    return [await _certificate_payload(db_session, c) for c in certificates]


async def _get_path_certificate_row(db_session: AsyncSession, path: Path, certificate_uuid: str) -> PathCertificate:
    certificate = (
        await db_session.execute(
            select(PathCertificate).where(
                PathCertificate.certificate_uuid == certificate_uuid,
                PathCertificate.path_id == path.id,
            )
        )
    ).scalars().first()
    if not certificate:
        raise HTTPException(status_code=404, detail="Certificate not found")
    return certificate


async def revoke_path_certificate(
    request: Request,
    path_uuid: str,
    certificate_uuid: str,
    current_user: PublicUser | APITokenUser,
    db_session: AsyncSession,
) -> dict:
    """Revoke a path certificate. The row is kept (marked revoked) so the
    learner can't be re-certified automatically by completing the path again
    or by leaving and re-joining it; it stops verifying right away."""
    path = await _get_path(db_session, path_uuid)
    await _require_manage(current_user, path.org_id, db_session, "action_update")
    certificate = await _get_path_certificate_row(db_session, path, certificate_uuid)
    if not certificate.revoked_at:
        certificate.revoked_at = str(datetime.now())
        db_session.add(certificate)
        await db_session.commit()
    return {"detail": "Certificate revoked"}


async def reinstate_path_certificate(
    request: Request,
    path_uuid: str,
    certificate_uuid: str,
    current_user: PublicUser | APITokenUser,
    db_session: AsyncSession,
) -> dict:
    """Undo a revocation: the same certificate, with its original ID and date,
    verifies again."""
    path = await _get_path(db_session, path_uuid)
    await _require_manage(current_user, path.org_id, db_session, "action_update")
    certificate = await _get_path_certificate_row(db_session, path, certificate_uuid)
    if certificate.revoked_at:
        certificate.revoked_at = None
        db_session.add(certificate)
        await db_session.commit()
    return {"detail": "Certificate reinstated"}
