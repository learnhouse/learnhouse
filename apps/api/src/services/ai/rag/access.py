"""
Read-access scoping for RAG retrieval and other AI paths that read activities.

Retrieved chunks are handed verbatim to the model and their source metadata is
streamed back to the caller, so every chunk must come from content the caller
could open through the normal course/activity endpoints. Course-level access is
resolved before the vector search (so the search only ranks readable courses);
activity-level rules (drafts, chapter/activity locks and paid access) are
applied to the retrieved rows afterwards.
"""

from dataclasses import dataclass, field
from typing import Iterable, Optional, Union

from fastapi import Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.ee_hooks import check_ee_activity_paid_access
from src.db.course_embeddings import CourseEmbedding
from src.db.courses.activities import Activity
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course, CourseRead
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.security.auth import resolve_acting_user_id
from src.security.org_auth import is_org_admin
from src.security.rbac import AccessAction, AccessContext, check_resource_access
from src.services.courses.locks import batch_accessible_restricted_uuids, is_locked_for_user

Principal = Union[PublicUser, AnonymousUser, APITokenUser]


@dataclass
class CourseGrant:
    course_uuid: str
    # Admins/maintainers and course authors see drafts; admins also bypass
    # locks, the same way they do in the course editor.
    is_admin: bool = False
    is_author: bool = False


@dataclass
class RagAccessScope:
    request: Request
    current_user: Principal
    org_id: int
    courses: dict[int, CourseGrant] = field(default_factory=dict)

    @property
    def course_ids(self) -> list[int]:
        return list(self.courses)


async def _grant_for_course(
    request: Request,
    current_user: Principal,
    course_uuid: str,
    db_session: AsyncSession,
    raise_on_deny: bool,
) -> Optional[CourseGrant]:
    # Same context GET /courses/{uuid} uses.
    decision = await check_resource_access(
        request,
        db_session,
        current_user,
        course_uuid,
        AccessAction.READ,
        context=AccessContext.DASHBOARD,
        raise_on_deny=raise_on_deny,
    )
    if not decision.allowed:
        return None
    return CourseGrant(
        course_uuid=course_uuid,
        is_admin=decision.via_admin,
        is_author=decision.via_authorship,
    )


async def build_rag_access_scope(
    request: Request,
    current_user: Principal,
    org_id: int,
    db_session: AsyncSession,
    course: Optional[Course | CourseRead] = None,
) -> RagAccessScope:
    """Resolve the courses the caller may retrieve from.

    With an explicit course, a denied read raises 403 like the course endpoint.
    Org-wide, unreadable courses are silently left out of the scope.
    """
    scope = RagAccessScope(request=request, current_user=current_user, org_id=org_id)

    if course is not None:
        grant = await _grant_for_course(
            request, current_user, course.course_uuid, db_session, raise_on_deny=True
        )
        if grant is not None and course.id is not None:
            scope.courses[course.id] = grant
        return scope

    indexed_courses = (await db_session.execute(
        select(Course.id, Course.course_uuid)
        .where(Course.org_id == org_id)
        .where(Course.id.in_(  # type: ignore
            select(CourseEmbedding.course_id).where(CourseEmbedding.org_id == org_id)
        ))
    )).all()

    # Org admins read every course; skip the per-course RBAC round-trips for
    # them. API tokens are scoped by their own rights, not their creator's
    # role, so they always go through the per-course check.
    if isinstance(current_user, PublicUser) and await is_org_admin(
        current_user.id, org_id, db_session
    ):
        for course_id, course_uuid in indexed_courses:
            scope.courses[course_id] = CourseGrant(course_uuid=course_uuid, is_admin=True)
        return scope

    for course_id, course_uuid in indexed_courses:
        grant = await _grant_for_course(
            request, current_user, course_uuid, db_session, raise_on_deny=False
        )
        if grant is not None:
            scope.courses[course_id] = grant
    return scope


async def readable_activity_ids(
    activity_ids: Iterable[int],
    scope: RagAccessScope,
    db_session: AsyncSession,
) -> set[int]:
    """Subset of activity_ids the caller may read, within the scope's courses.

    Mirrors the single-activity read: drafts need author/admin, chapter and
    activity locks apply unless the caller is an admin or holds course-level
    usergroup access, and paid access is checked last.
    """
    ids = set(activity_ids)
    if not ids or not scope.courses:
        return set()

    activity_rows = (await db_session.execute(
        select(Activity, Chapter)
        .outerjoin(ChapterActivity, ChapterActivity.activity_id == Activity.id)  # type: ignore
        .outerjoin(Chapter, Chapter.id == ChapterActivity.chapter_id)  # type: ignore
        .where(Activity.id.in_(ids))  # type: ignore
        .where(Activity.course_id.in_(scope.course_ids))  # type: ignore
    )).all()
    activities: dict[int, tuple[Activity, Optional[Chapter]]] = {}
    for activity, chapter in activity_rows:
        activities.setdefault(activity.id, (activity, chapter))

    accessible: set[str] = set()
    if not isinstance(scope.current_user, AnonymousUser):
        candidate_uuids: set[str] = {g.course_uuid for g in scope.courses.values()}
        for activity, chapter in activities.values():
            candidate_uuids.add(activity.activity_uuid)
            if chapter is not None:
                candidate_uuids.add(chapter.chapter_uuid)
        accessible = await batch_accessible_restricted_uuids(
            resolve_acting_user_id(scope.current_user), candidate_uuids, db_session
        )

    readable: set[int] = set()
    for activity_id, (activity, chapter) in activities.items():
        grant = scope.courses[activity.course_id]
        if await _activity_readable(activity, chapter, grant, scope, accessible, db_session):
            readable.add(activity_id)
    return readable


async def filter_readable_chunks(
    rows: Iterable,
    scope: RagAccessScope,
    db_session: AsyncSession,
) -> list:
    """Drop retrieved rows the caller could not open.

    Activity rows follow the activity's read rules. Course-level rows (course
    and chapter text, no activity) are what the course page shows, so reading
    the course is enough.
    """
    rows = list(rows)
    readable = await readable_activity_ids(
        {row.activity_id for row in rows if row.activity_id is not None}, scope, db_session
    )
    return [
        row for row in rows
        if (row.activity_id in readable if row.activity_id is not None else row.course_id in scope.courses)
    ]


async def can_read_activity(
    request: Request,
    current_user: Principal,
    course: Course | CourseRead,
    activity_id: int,
    db_session: AsyncSession,
) -> bool:
    """Whether the caller may read one activity's content.

    Raises 403 when the course itself is unreadable, like the course endpoint.
    """
    scope = await build_rag_access_scope(
        request, current_user, course.org_id, db_session, course=course
    )
    return activity_id in await readable_activity_ids([activity_id], scope, db_session)


async def _activity_readable(
    activity: Activity,
    chapter: Optional[Chapter],
    grant: CourseGrant,
    scope: RagAccessScope,
    accessible: set[str],
    db_session: AsyncSession,
) -> bool:
    if not activity.published and not (grant.is_admin or grant.is_author):
        return False

    # Same lock rules as a single-activity read: admins bypass, and course-level
    # usergroup membership unlocks every chapter and activity in the course.
    if not grant.is_admin and grant.course_uuid not in accessible:
        for lock_type, resource_uuid in (
            (chapter.lock_type, chapter.chapter_uuid) if chapter is not None else (None, None),
            (activity.lock_type, activity.activity_uuid),
        ):
            if resource_uuid and await is_locked_for_user(
                lock_type,
                resource_uuid,
                activity.org_id,
                scope.current_user,
                db_session,
                accessible_restricted_uuids=accessible,
                is_admin=False,
            ):
                return False

    return await check_ee_activity_paid_access(
        request=scope.request,
        activity_id=activity.id,
        user=scope.current_user,
        db_session=db_session,
    )
