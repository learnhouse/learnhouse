"""Build the RenderContext for dynamic content and apply it to a read.

Kept apart from ``dynamic_content`` so the rule engine stays pure. Every query
here only runs when the document actually holds dynamic nodes.
"""

from __future__ import annotations

import hashlib
from collections import defaultdict
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import Request
from pydantic import BaseModel, Field
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.communities.communities import Community
from src.db.communities.discussion_comments import DiscussionComment
from src.db.communities.discussions import Discussion
from src.db.courses.activities import Activity
from src.db.courses.assignments import Assignment, AssignmentUserSubmission, AssignmentUserSubmissionStatus
from src.db.courses.certifications import CertificateUser, Certifications
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.editor_variables import EditorVariable
from src.db.organizations import Organization
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import PublicUser, User
from src.security.rbac.constants import ADMIN_ROLE_ID, MAINTAINER_ROLE_ID
from src.services.courses.activities.dynamic_content import (
    RenderContext,
    referenced_custom_variables,
    has_dynamic_content,
    render_document,
)

def _today() -> date:
    return datetime.now(timezone.utc).date()


def request_locale(request: Optional[Request]) -> str:
    """The reader's UI language: the web app's ``i18next`` cookie, then
    Accept-Language. Users have no stored locale."""
    if request is None:
        return "en"
    cookie = (request.cookies.get("i18next") or "").strip()
    if cookie and len(cookie) <= 16:
        return cookie
    header = request.headers.get("accept-language") or ""
    first = header.split(",")[0].split(";")[0].strip()
    return first[:16] if first else "en"


def _role_name(role_id: Optional[int]) -> str:
    if role_id == ADMIN_ROLE_ID:
        return "admin"
    if role_id == MAINTAINER_ROLE_ID:
        return "maintainer"
    return "member" if role_id is not None else "anonymous"


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None


async def _course_progress_totals(course_id: int, db_session: AsyncSession) -> int:
    return (await db_session.execute(
        select(func.count(ChapterActivity.id))  # type: ignore[arg-type]
        .join(Activity, Activity.id == ChapterActivity.activity_id)  # type: ignore[arg-type]
        .where(ChapterActivity.course_id == course_id, Activity.published == True)  # noqa: E712
    )).scalar_one()


async def load_custom_variables(org_id: int, content: Any, db_session: AsyncSession) -> dict[str, Any]:
    """The org's custom variables ``content`` uses, by key."""
    keys = referenced_custom_variables(content)
    if not keys:
        return {}
    rows = (await db_session.execute(
        select(EditorVariable.key, EditorVariable.default_value, EditorVariable.variants).where(
            EditorVariable.org_id == org_id,
            EditorVariable.key.in_(keys),  # type: ignore[attr-defined]
        )
    )).all()
    return {key: {"default": default, "variants": variants or []} for key, default, variants in rows}


async def with_references(ctx: RenderContext, org_id: int, content: Any, db_session: AsyncSession) -> RenderContext:
    """``ctx`` plus the custom variables ``content`` needs."""
    custom = await load_custom_variables(org_id, content, db_session)
    return replace(ctx, custom_variables=custom) if custom else ctx


async def course_navigation(course_id: int, db_session: AsyncSession) -> dict[str, tuple[str, str]]:
    """For each published activity of the course, in reading order: its
    chapter's name and the next activity's name."""
    rows = (await db_session.execute(
        select(Activity.activity_uuid, Activity.name, Chapter.name)
        .join(ChapterActivity, ChapterActivity.activity_id == Activity.id)  # type: ignore[arg-type]
        .join(Chapter, Chapter.id == ChapterActivity.chapter_id)  # type: ignore[arg-type]
        .join(CourseChapter, CourseChapter.chapter_id == Chapter.id)  # type: ignore[arg-type]
        .where(CourseChapter.course_id == course_id, Activity.published == True)  # noqa: E712
        .order_by(CourseChapter.order, ChapterActivity.order)  # type: ignore[arg-type]
    )).all()
    return {
        uuid: (chapter, rows[i + 1][1] if i + 1 < len(rows) else "")
        for i, (uuid, _, chapter) in enumerate(rows)
    }


def bucket_for(org_id: int, user_uuid: str) -> int:
    """Stable 0-99 per learner and org: the same learner always lands in the
    same half of a 50/50 split, and splits differ between orgs."""
    digest = hashlib.sha256(f"{org_id}:{user_uuid}".encode()).digest()
    return int.from_bytes(digest[:4], "big") % 100


async def _course_context(
    request: Optional[Request], course: Any, db_session: AsyncSession, activity_name: str, activity_uuid: str = ""
) -> RenderContext:
    """The reader-independent half: org, course, date, totals, navigation."""
    org_name = (await db_session.execute(
        select(Organization.name).where(Organization.id == course.org_id)
    )).scalar_one_or_none() or ""
    return RenderContext(
        org_name=org_name,
        course_name=course.name or "",
        activity_name=activity_name,
        activity_uuid=activity_uuid,
        navigation=await course_navigation(course.id, db_session),
        locale=request_locale(request),
        today=_today(),
        progress_total=await _course_progress_totals(course.id, db_session),
        assignment_total=(await db_session.execute(
            select(func.count(Assignment.id)).where(Assignment.course_id == course.id)  # type: ignore[arg-type]
        )).scalar_one(),
    )


_SUBMITTED = {
    AssignmentUserSubmissionStatus.SUBMITTED,
    AssignmentUserSubmissionStatus.GRADED,
    AssignmentUserSubmissionStatus.LATE,
}


async def _learner_contexts(
    base: RenderContext, course: Any, user_ids: list[int], db_session: AsyncSession
) -> dict[int, RenderContext]:
    """``base`` completed for each user, with one query per kind of fact
    whatever the number of users (the reach count renders a whole course)."""
    if not user_ids:
        return {}
    users = (await db_session.execute(
        select(User).where(User.id.in_(user_ids))  # type: ignore[union-attr]
    )).scalars().all()
    roles = dict((await db_session.execute(
        select(UserOrganization.user_id, UserOrganization.role_id).where(
            UserOrganization.user_id.in_(user_ids),  # type: ignore[attr-defined]
            UserOrganization.org_id == course.org_id,
        )
    )).all())
    groups: dict[int, list[tuple[str, str]]] = defaultdict(list)
    for user_id, uuid, name in (await db_session.execute(
        select(UserGroupUser.user_id, UserGroup.usergroup_uuid, UserGroup.name)
        .join(UserGroup, UserGroupUser.usergroup_id == UserGroup.id)  # type: ignore[arg-type]
        .where(UserGroupUser.user_id.in_(user_ids), UserGroupUser.org_id == course.org_id)  # type: ignore[attr-defined]
    )).all():
        groups[user_id].append((uuid, name))
    runs: dict[int, str] = {}
    for user_id, created in (await db_session.execute(
        select(TrailRun.user_id, TrailRun.creation_date)
        .where(TrailRun.user_id.in_(user_ids), TrailRun.course_id == course.id)  # type: ignore[attr-defined]
        .order_by(TrailRun.id)  # type: ignore[arg-type]
    )).all():
        runs.setdefault(user_id, created)
    completed: dict[int, set[str]] = defaultdict(set)
    for user_id, activity_uuid in (await db_session.execute(
        select(TrailStep.user_id, Activity.activity_uuid)
        .join(Activity, TrailStep.activity_id == Activity.id)  # type: ignore[arg-type]
        .where(
            TrailStep.user_id.in_(user_ids),  # type: ignore[attr-defined]
            TrailStep.course_id == course.id,
            TrailStep.complete == True,  # noqa: E712
        )
    )).all():
        completed[user_id].add(activity_uuid)

    certified: dict[int, Optional[date]] = {}
    for user_id, created in (await db_session.execute(
        select(CertificateUser.user_id, CertificateUser.created_at)
        .join(Certifications, CertificateUser.certification_id == Certifications.id)  # type: ignore[arg-type]
        .where(CertificateUser.user_id.in_(user_ids), Certifications.course_id == course.id)  # type: ignore[attr-defined]
    )).all():
        certified[user_id] = _parse_date(created)
    submitted: dict[int, set[str]] = defaultdict(set)
    grades: dict[int, list[int]] = defaultdict(list)
    for user_id, assignment_uuid, status, grade in (await db_session.execute(
        select(
            AssignmentUserSubmission.user_id, Assignment.assignment_uuid,
            AssignmentUserSubmission.submission_status, AssignmentUserSubmission.grade,
        )
        .join(Assignment, AssignmentUserSubmission.assignment_id == Assignment.id)  # type: ignore[arg-type]
        .where(AssignmentUserSubmission.user_id.in_(user_ids), Assignment.course_id == course.id)  # type: ignore[attr-defined]
    )).all():
        if status in _SUBMITTED:
            submitted[user_id].add(assignment_uuid)
        if status == AssignmentUserSubmissionStatus.GRADED and grade is not None:
            grades[user_id].append(grade)
    # Posts in the org's communities: discussions started and comments written.
    posts: dict[int, int] = defaultdict(int)
    active: dict[int, set[str]] = defaultdict(set)
    for user_id, community_uuid in (await db_session.execute(
        select(Discussion.author_id, Community.community_uuid)
        .join(Community, Discussion.community_id == Community.id)  # type: ignore[arg-type]
        .where(Discussion.author_id.in_(user_ids), Community.org_id == course.org_id)  # type: ignore[attr-defined]
    )).all():
        posts[user_id] += 1
        active[user_id].add(community_uuid)
    for user_id, community_uuid in (await db_session.execute(
        select(DiscussionComment.author_id, Community.community_uuid)
        .join(Discussion, DiscussionComment.discussion_id == Discussion.id)  # type: ignore[arg-type]
        .join(Community, Discussion.community_id == Community.id)  # type: ignore[arg-type]
        .where(DiscussionComment.author_id.in_(user_ids), Community.org_id == course.org_id)  # type: ignore[attr-defined]
    )).all():
        posts[user_id] += 1
        active[user_id].add(community_uuid)

    contexts = {}
    for user in users:
        run_created = runs.get(user.id)
        enrolled_on = _parse_date(run_created)
        created_on = _parse_date(user.creation_date)
        role_id = roles.get(user.id)
        contexts[user.id] = replace(
            base,
            signed_in=True,
            first_name=user.first_name or "",
            last_name=user.last_name or "",
            username=user.username or "",
            email=user.email or "",
            user_uuid=user.user_uuid,
            account_days=max(0, (base.today - created_on).days) if created_on else None,
            bucket=bucket_for(course.org_id, user.user_uuid),
            role=_role_name(role_id) if role_id is not None else "member",
            group_uuids=frozenset(uuid for uuid, _ in groups[user.id]),
            group_names=tuple(name for _, name in groups[user.id]),
            enrolled=run_created is not None,
            enrolled_on=enrolled_on,
            days_enrolled=max(0, (base.today - enrolled_on).days) if enrolled_on else (0 if run_created else None),
            progress_completed=len(completed[user.id]),
            completed_activity_uuids=frozenset(completed[user.id]),
            certified=user.id in certified,
            certified_on=certified.get(user.id),
            assignments_submitted=frozenset(submitted[user.id]),
            assignment_average=sum(grades[user.id]) / len(grades[user.id]) if grades[user.id] else None,
            community_posts=posts[user.id],
            communities_active=frozenset(active[user.id]),
        )
    return contexts


async def build_render_context(
    request: Optional[Request],
    current_user: Any,
    course: Any,
    db_session: AsyncSession,
    *,
    activity_name: str = "",
    activity_uuid: str = "",
) -> RenderContext:
    """Context for ``current_user`` reading ``course``. ``course`` only needs
    ``id``, ``org_id`` and ``name`` (Course or CourseRead)."""
    base = await _course_context(request, course, db_session, activity_name, activity_uuid)
    # API tokens and anonymous readers have no person behind them.
    if not isinstance(current_user, PublicUser) or not current_user.id:
        return base
    contexts = await _learner_contexts(base, course, [current_user.id], db_session)
    return contexts.get(current_user.id, base)


async def enrolled_learner_context(
    request: Optional[Request], course: Any, user_uuid: str, db_session: AsyncSession, *,
    activity_name: str = "", activity_uuid: str = "",
) -> Optional[RenderContext]:
    """The real context of a learner enrolled in ``course``, or None when no
    such learner exists: previews only reach people the course already has."""
    user_id = (await db_session.execute(
        select(User.id)
        .join(TrailRun, TrailRun.user_id == User.id)  # type: ignore[arg-type]
        .where(User.user_uuid == user_uuid, TrailRun.course_id == course.id)
    )).scalars().first()
    if user_id is None:
        return None
    base = await _course_context(request, course, db_session, activity_name, activity_uuid)
    return (await _learner_contexts(base, course, [user_id], db_session)).get(user_id)


async def search_enrolled_learners(
    course: Any, query: str, db_session: AsyncSession, *, limit: int = 20
) -> list[User]:
    # IN rather than DISTINCT: the user row has JSON columns Postgres can't compare.
    enrolled = select(TrailRun.user_id).where(TrailRun.course_id == course.id)
    statement = (
        select(User)
        .where(User.id.in_(enrolled))  # type: ignore[union-attr]
        .order_by(User.username)
        .limit(limit)
    )
    if query:
        pattern = f"%{query.strip()[:64]}%"
        statement = statement.where(
            User.username.ilike(pattern)  # type: ignore[attr-defined]
            | User.first_name.ilike(pattern)  # type: ignore[attr-defined]
            | User.last_name.ilike(pattern)  # type: ignore[attr-defined]
        )
    return list((await db_session.execute(statement)).scalars().all())


# Enough for any real cohort; the count says when it stopped short.
MAX_REACH_LEARNERS = 5000


async def course_learner_contexts(
    request: Optional[Request], course: Any, db_session: AsyncSession, *,
    activity_name: str = "", activity_uuid: str = "",
) -> tuple[list[RenderContext], bool]:
    """A context for every learner enrolled in ``course``, and whether the
    list was cut at MAX_REACH_LEARNERS. Language isn't stored per learner,
    so language rules count against the editor's own language."""
    user_ids = list((await db_session.execute(
        select(TrailRun.user_id).where(TrailRun.course_id == course.id)
        .distinct().limit(MAX_REACH_LEARNERS + 1)
    )).scalars().all())
    truncated = len(user_ids) > MAX_REACH_LEARNERS
    base = await _course_context(request, course, db_session, activity_name, activity_uuid)
    contexts = await _learner_contexts(base, course, user_ids[:MAX_REACH_LEARNERS], db_session)
    return list(contexts.values()), truncated


async def render_for_reader(
    request: Optional[Request],
    content: Any,
    *,
    course: Any,
    current_user: Any,
    db_session: AsyncSession,
    activity_name: str = "",
    activity_uuid: str = "",
    is_editor: Optional[bool] = None,
    context: Optional[RenderContext] = None,
) -> Any:
    """``content`` as ``current_user`` should receive it. Course editors get
    the raw document: they edit and merge it, and preview through
    ``/dynamic-preview`` instead. Pass ``is_editor`` when already known.
    Editor comment marks never reach anyone else (see ``comment_marks``)."""
    from src.services.courses.activities.comment_marks import (
        has_comment_marks,
        strip_comment_marks,
    )

    if not isinstance(content, dict):
        return content
    dynamic = has_dynamic_content(content)
    if not dynamic and not has_comment_marks(content):
        return content
    if is_editor is None:
        from src.services.courses.activities.access import can_edit_course

        is_editor = request is not None and await can_edit_course(
            request, course.course_uuid, current_user, db_session
        )
    if is_editor:
        return content
    content = strip_comment_marks(content)
    if not dynamic:
        return content
    ctx = context or await build_render_context(
        request, current_user, course, db_session, activity_name=activity_name, activity_uuid=activity_uuid
    )
    if context is not None:
        ctx = replace(ctx, activity_name=activity_name, activity_uuid=activity_uuid)
    ctx = await with_references(ctx, course.org_id, content, db_session)
    rendered, _ = render_document(content, ctx)
    return rendered


# ---------------------------------------------------------------------------
# "View as" preview
# ---------------------------------------------------------------------------

class PreviewPersona(BaseModel):
    """A simulated reader for the editor's "view as" preview."""

    signed_in: bool = True
    first_name: Optional[str] = Field(default=None, max_length=100)
    last_name: Optional[str] = Field(default=None, max_length=100)
    role: str = Field(default="member", pattern="^(admin|maintainer|member|anonymous)$")
    usergroup_uuids: list[str] = Field(default_factory=list, max_length=100)
    locale: str = Field(default="en", max_length=16)
    enrolled: bool = True
    days_enrolled: Optional[int] = Field(default=None, ge=0, le=36500)
    progress_percent: int = Field(default=0, ge=0, le=100)
    completed_activity_uuids: list[str] = Field(default_factory=list, max_length=1000)
    today: Optional[date] = None
    email: Optional[str] = Field(default=None, max_length=320)
    account_days: Optional[int] = Field(default=None, ge=0, le=36500)
    bucket: Optional[int] = Field(default=None, ge=0, le=99)
    certified: bool = False
    community_posts: int = Field(default=0, ge=0, le=10_000)
    assignments_submitted: list[str] = Field(default_factory=list, max_length=500)
    # Preview as this enrolled learner instead: their real groups, progress
    # and enrollment. The other persona fields are ignored, except `today`.
    user_uuid: Optional[str] = Field(default=None, max_length=100)


class DynamicPreviewRequest(BaseModel):
    # The editor sends its unsaved document so authors preview what they see.
    content: Optional[dict] = None
    persona: PreviewPersona = Field(default_factory=PreviewPersona)


class DynamicPreviewResponse(BaseModel):
    content: dict
    shown_blocks: int
    hidden_blocks: int
    variables: int


def persona_context(
    base: RenderContext,
    persona: PreviewPersona,
    viewer: Any,
    *,
    group_names: tuple[str, ...] = (),
    org_id: int = 0,
) -> RenderContext:
    """Swap the reader-specific half of ``base`` for the persona."""
    total = base.progress_total
    if persona.progress_percent and total <= 0:
        total = 100
    signed_in = persona.signed_in and persona.role != "anonymous"
    viewer_first = getattr(viewer, "first_name", "") or ""
    viewer_last = getattr(viewer, "last_name", "") or ""
    return replace(
        base,
        signed_in=signed_in,
        first_name=(persona.first_name if persona.first_name is not None else viewer_first) if signed_in else "",
        last_name=(persona.last_name if persona.last_name is not None else viewer_last) if signed_in else "",
        username=(getattr(viewer, "username", "") or "") if signed_in else "",
        role=persona.role if signed_in else "anonymous",
        group_uuids=frozenset(persona.usergroup_uuids) if signed_in else frozenset(),
        group_names=group_names if signed_in else (),
        email=(persona.email if persona.email is not None else getattr(viewer, "email", "") or "") if signed_in else "",
        user_uuid=getattr(viewer, "user_uuid", "") if signed_in else "",
        account_days=(persona.account_days if persona.account_days is not None else 365) if signed_in else None,
        bucket=(
            persona.bucket if persona.bucket is not None
            else bucket_for(org_id, getattr(viewer, "user_uuid", ""))
        ) if signed_in else None,
        locale=persona.locale or base.locale,
        enrolled=persona.enrolled and signed_in,
        days_enrolled=(persona.days_enrolled or 0) if persona.enrolled and signed_in else None,
        enrolled_on=(
            (persona.today or base.today) - timedelta(days=persona.days_enrolled or 0)
        ) if persona.enrolled and signed_in else None,
        progress_total=total,
        progress_completed=round(persona.progress_percent * total / 100) if signed_in else 0,
        completed_activity_uuids=frozenset(persona.completed_activity_uuids) if signed_in else frozenset(),
        today=persona.today or base.today,
        certified=persona.certified and signed_in,
        certified_on=(persona.today or base.today) if persona.certified and signed_in else None,
        community_posts=persona.community_posts if signed_in else 0,
        assignments_submitted=frozenset(persona.assignments_submitted) if signed_in else frozenset(),
    )


class DynamicReachResponse(BaseModel):
    learners: int
    # Learners who see each conditional block, in document order.
    blocks: list[int]
    truncated: bool = False


class DynamicLearner(BaseModel):
    user_uuid: str
    username: str
    first_name: str
    last_name: str


class DynamicAssignment(BaseModel):
    assignment_uuid: str
    title: str


class DynamicOptions(BaseModel):
    """What the rule builder offers to pick from, beyond the org's groups."""

    assignments: list[DynamicAssignment]


async def course_dynamic_options(course: Any, db_session: AsyncSession) -> DynamicOptions:
    rows = (await db_session.execute(
        select(Assignment.assignment_uuid, Assignment.title)
        .where(Assignment.course_id == course.id)
        .order_by(Assignment.id)  # type: ignore[arg-type]
    )).all()
    return DynamicOptions(assignments=[DynamicAssignment(assignment_uuid=u, title=t) for u, t in rows])
