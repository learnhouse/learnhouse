"""Course contribution tools: read the review queue of a course.

Wraps the contributions service (src/services/courses/contributions), so the
rights are its own: reading the queue needs edit rights on the course. The
agent gets each open suggestion as a plain summary with the text before and
after, and each piece of open feedback, so it can summarize what learners
asked for or help an author triage. Deciding stays with a person, in the
course's Contributions tab.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from src.security.rbac import AccessAction
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.ai.tools.chapters import course_ref
from src.services.courses.contributions import blocks as B
from src.services.courses.contributions.service import (
    get_settings,
    list_course_feedback,
    list_course_suggestions,
)

TEXT_MAX = 600


class ListContributionsParams(BaseModel):
    course_uuid: str = Field(..., min_length=1, max_length=100, description="The course (course_...).")
    limit: int = Field(20, ge=1, le=50, description="At most this many suggestions and this many feedback threads.")


def _text(nodes: list[dict]) -> str:
    text = " ".join(B.text_of(n).strip() for n in nodes).strip()
    return text if len(text) <= TEXT_MAX else text[: TEXT_MAX - 1] + "…"


def _name(user) -> str:
    if user is None:
        return ""
    return f"{user.first_name} {user.last_name}".strip() or user.username


async def _list_contributions(ctx: ToolContext, p: ListContributionsParams) -> dict:
    course = await refs.load(ctx, "course", p.course_uuid)
    settings = await get_settings(ctx.request, course.course_uuid, ctx.user, ctx.db_session)
    suggestions = await list_course_suggestions(
        ctx.request, course.course_uuid, ctx.user, ctx.db_session, status="open", limit=p.limit
    )
    feedback = await list_course_feedback(
        ctx.request, course.course_uuid, ctx.user, ctx.db_session, status="open", limit=p.limit
    )
    return {
        "course": await course_ref(ctx, course),
        "enabled": settings.enabled,
        "audience": settings.audience,
        "suggestions_open": suggestions.total,
        "suggestions": [
            {
                "suggestion_uuid": s.suggestion_uuid,
                "status": s.status,
                "activity": s.activity_name,
                "author": _name(s.author),
                "summary": s.summary,
                "note": s.note,
                "before": _text(s.before),
                "after": _text(s.after),
                "fits_page": s.placement.state if s.placement else None,
                "created_at": s.created_at,
            }
            for s in suggestions.items
        ],
        "feedback_open": feedback.total,
        "feedback": [
            {
                "thread_uuid": f.thread_uuid,
                "type": f.feedback_type,
                "activity": f.activity_name,
                "author": _name(f.author),
                "quote": f.quote,
                "message": f.comments[0].body if f.comments else "",
                "replies": max(0, len(f.comments) - 1),
                "created_at": f.created_at,
            }
            for f in feedback.items
        ],
    }


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_course_contributions",
        description=(
            "Read a course's contribution queue: open suggested edits from learners (a summary, "
            "the author's note, the text before and after, and whether it still fits the page) "
            "and open feedback on passages (typo, unclear, outdated, wrong, suggestion). Use it "
            "to summarize what learners are asking for. Accepting or rejecting is done by a "
            "person in the course's Contributions tab. Needs edit rights on the course."
        ),
        params_model=ListContributionsParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_list_contributions,
        target_param="course_uuid",
        target_kind="course",
        title="Course contributions",
        idempotent=True,
    ),
]
