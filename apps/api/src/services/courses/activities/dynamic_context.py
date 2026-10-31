"""Build the RenderContext for dynamic content and apply it to a read.

Kept apart from ``dynamic_content`` so the rule engine stays pure. Every query
here only runs when the document actually holds dynamic nodes.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timezone
from typing import Any, Optional

from fastapi import Request
from pydantic import BaseModel, Field
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.chapter_activities import ChapterActivity
from src.db.organizations import Organization
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import PublicUser
from src.security.rbac.constants import ADMIN_ROLE_ID, MAINTAINER_ROLE_ID
from src.services.courses.activities.dynamic_content import (
    RenderContext,
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


async def build_render_context(
    request: Optional[Request],
    current_user: Any,
    course: Any,
    db_session: AsyncSession,
    *,
    activity_name: str = "",
) -> RenderContext:
    """Context for ``current_user`` reading ``course``. ``course`` only needs
    ``id``, ``org_id`` and ``name`` (Course or CourseRead)."""
    org_name = (await db_session.execute(
        select(Organization.name).where(Organization.id == course.org_id)
    )).scalar_one_or_none() or ""
    ctx = RenderContext(
        org_name=org_name,
        course_name=course.name or "",
        activity_name=activity_name,
        locale=request_locale(request),
        today=_today(),
        progress_total=await _course_progress_totals(course.id, db_session),
    )

    # API tokens and anonymous readers have no person behind them.
    if not isinstance(current_user, PublicUser) or not current_user.id:
        return ctx

    user_id = current_user.id
    role_id = (await db_session.execute(
        select(UserOrganization.role_id).where(
            UserOrganization.user_id == user_id, UserOrganization.org_id == course.org_id
        )
    )).scalars().first()
    group_uuids = (await db_session.execute(
        select(UserGroup.usergroup_uuid)
        .join(UserGroupUser, UserGroupUser.usergroup_id == UserGroup.id)  # type: ignore[arg-type]
        .where(UserGroupUser.user_id == user_id, UserGroupUser.org_id == course.org_id)
    )).scalars().all()
    run_created = (await db_session.execute(
        select(TrailRun.creation_date).where(
            TrailRun.user_id == user_id, TrailRun.course_id == course.id
        ).order_by(TrailRun.id)  # type: ignore[arg-type]
    )).scalars().first()
    completed = (await db_session.execute(
        select(Activity.activity_uuid)
        .join(TrailStep, TrailStep.activity_id == Activity.id)  # type: ignore[arg-type]
        .where(
            TrailStep.user_id == user_id,
            TrailStep.course_id == course.id,
            TrailStep.complete == True,  # noqa: E712
        )
    )).scalars().all()

    enrolled_on = _parse_date(run_created)
    return replace(
        ctx,
        signed_in=True,
        first_name=current_user.first_name or "",
        last_name=current_user.last_name or "",
        username=current_user.username or "",
        role=_role_name(role_id) if role_id is not None else "member",
        group_uuids=frozenset(group_uuids),
        enrolled=run_created is not None,
        days_enrolled=max(0, (ctx.today - enrolled_on).days) if enrolled_on else (0 if run_created else None),
        progress_completed=len(set(completed)),
        completed_activity_uuids=frozenset(completed),
    )


async def render_for_reader(
    request: Optional[Request],
    content: Any,
    *,
    course: Any,
    current_user: Any,
    db_session: AsyncSession,
    activity_name: str = "",
    is_editor: Optional[bool] = None,
    context: Optional[RenderContext] = None,
) -> Any:
    """``content`` as ``current_user`` should receive it. Course editors get
    the raw document: they edit and merge it, and preview through
    ``/dynamic-preview`` instead. Pass ``is_editor`` when already known."""
    if not isinstance(content, dict) or not has_dynamic_content(content):
        return content
    if is_editor is None:
        from src.services.courses.activities.access import can_edit_course

        is_editor = request is not None and await can_edit_course(
            request, course.course_uuid, current_user, db_session
        )
    if is_editor:
        return content
    ctx = context or await build_render_context(
        request, current_user, course, db_session, activity_name=activity_name
    )
    if context is not None:
        ctx = replace(ctx, activity_name=activity_name)
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


class DynamicPreviewRequest(BaseModel):
    # The editor sends its unsaved document so authors preview what they see.
    content: Optional[dict] = None
    persona: PreviewPersona = Field(default_factory=PreviewPersona)


class DynamicPreviewResponse(BaseModel):
    content: dict
    shown_blocks: int
    hidden_blocks: int
    variables: int


def persona_context(base: RenderContext, persona: PreviewPersona, viewer: Any) -> RenderContext:
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
        locale=persona.locale or base.locale,
        enrolled=persona.enrolled and signed_in,
        days_enrolled=(persona.days_enrolled or 0) if persona.enrolled and signed_in else None,
        progress_total=total,
        progress_completed=round(persona.progress_percent * total / 100) if signed_in else 0,
        completed_activity_uuids=frozenset(persona.completed_activity_uuids) if signed_in else frozenset(),
        today=persona.today or base.today,
    )
