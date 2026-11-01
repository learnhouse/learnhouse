"""Analytics tool: one named catalog query per call.

Wraps the analytics runner (`src/services/analytics/runner.py`), so the
agent runs the dashboard's own parameterized queries behind the dashboard's
own gates (org admin, Enterprise plan for advanced queries, Pro plan for
course queries). The per-member drill-downs the dashboard opens from its stat
cards (who signed up, enrolled, completed, is online, the most engaged and
top learners) run behind the detail endpoints' gates: org admin, plus Pro for
course ones. Raw SQL is impossible by construction: only catalog names are
accepted. Like the HTTP analytics routes, API tokens are refused.

Rows come back with numeric user ids swapped for member references and the
course and activity names the runner already resolves.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator

from src.security.auth import resolve_acting_user_id
from src.security.rbac import AccessAction
from src.services.ai.tools import refs, results
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.ai.tools.learners import member_refs
from src.services.analytics.queries import (
    ADVANCED_QUERIES,
    CORE_QUERIES,
    COURSE_DETAIL_QUERIES,
    COURSE_QUERIES,
    DETAIL_QUERIES,
)
from src.services.analytics.runner import (
    execute_course_query,
    execute_detail_query,
    execute_org_query,
)

MAX_ROWS = 100

# What each catalog query answers, in a few words (shown to the model).
ORG_QUERY_HELP: dict[str, str] = {
    "live_users": "members active in the last 5 minutes",
    "daily_active_users": "active users per day",
    "top_courses": "courses by views, enrollments, completions",
    "enrollment_funnel": "view to enroll to complete funnel",
    "event_counts": "event totals by name",
    "activity_engagement": "views, completions and time per activity",
    "visitors_by_country": "visits by country",
    "visitors_by_device": "visits by device type",
    "visitors_by_referrer": "visits by referring site",
    "daily_visitor_breakdown": "daily visitors with device and country mix",
    "course_dropoff": "where learners stop in each course",
    "cohort_retention": "weekly signup cohorts still active",
    "time_to_completion": "time from enrollment to course completion",
    "peak_usage_hours": "activity by weekday and hour",
    "content_type_effectiveness": "engagement by activity type",
    "new_vs_returning": "new versus returning users per day",
    "completion_velocity": "time between activity completions",
    "community_correlation": "community participation versus completion",
    "user_progress_snapshot": "learners per course progress bucket",
    "search_effectiveness": "top searches and zero result rate",
    "certification_rate": "certificates per course completion",
    "org_growth_trend": "weekly signups, enrollments, completions",
    "course_rating_by_completion": "completion rate per course",
}
COURSE_QUERY_HELP: dict[str, str] = {
    "course_overview_stats": "views, enrollments, completions, completion rate",
    "course_enrollment_trend": "enrollments per day",
    "course_activity_funnel": "views and completions per activity",
    "course_learner_progress": "completed activities per learner",
    "course_time_per_activity": "average time spent per activity",
    "course_completion_velocity": "time between a learner's completions",
    "course_active_learners": "active learners per day",
    "course_time_to_completion": "time from enrollment to completion",
    "course_certification_rate": "certificates issued versus completions",
    "course_view_to_enrollment": "daily views to enrollment conversion",
    "course_activity_type_breakdown": "views and completions by activity type",
    "course_peak_hours": "activity by weekday and hour",
    "course_learner_retention": "learners still active after their first day",
    "course_activity_dropoff": "the activity where learners stop",
    "course_engagement_by_type": "engagement and time by activity type",
    "course_daily_completions": "activity completions per day",
    "course_avg_session_duration": "average time per learner per day",
    "course_unique_viewers": "unique viewers per day",
}

# Per-member drill-downs: one row per member, swapped for member references.
DETAIL_QUERY_HELP: dict[str, str] = {
    "detail_live_users": "who is online now, with page, device and country",
    "detail_signups": "recent signups with method",
    "detail_enrollments": "recent enrollments per member and course",
    "detail_completions": "recent course completions per member",
    "learner_engagement_score": "top 100 members by engagement score (views, completions, time spent)",
}
COURSE_DETAIL_QUERY_HELP: dict[str, str] = {
    "course_recent_enrollments": "the latest 50 members to enroll",
    "course_top_learners": "top 20 members by completions, views and time spent",
}

# Every catalog query must be documented; a new one fails at import.
assert set(ORG_QUERY_HELP) == set(CORE_QUERIES) | set(ADVANCED_QUERIES)
assert set(COURSE_QUERY_HELP) == set(COURSE_QUERIES)
assert set(DETAIL_QUERY_HELP) == set(DETAIL_QUERIES)
assert set(COURSE_DETAIL_QUERY_HELP) == set(COURSE_DETAIL_QUERIES)

_COURSE_SCOPED = set(COURSE_QUERY_HELP) | set(COURSE_DETAIL_QUERY_HELP)
_DETAIL = set(DETAIL_QUERY_HELP) | set(COURSE_DETAIL_QUERY_HELP)

QueryName = Literal[  # type: ignore[valid-type]
    tuple(
        sorted(ORG_QUERY_HELP)
        + sorted(DETAIL_QUERY_HELP)
        + sorted(COURSE_QUERY_HELP)
        + sorted(COURSE_DETAIL_QUERY_HELP)
    )
]


def _query_doc() -> str:
    org = "; ".join(
        f"{k}: {v}{' (Enterprise)' if k in ADVANCED_QUERIES else ''}"
        for k, v in ORG_QUERY_HELP.items()
    )
    detail = "; ".join(f"{k}: {v}" for k, v in DETAIL_QUERY_HELP.items())
    course = "; ".join(f"{k}: {v}" for k, v in COURSE_QUERY_HELP.items())
    course_detail = "; ".join(f"{k}: {v}" for k, v in COURSE_DETAIL_QUERY_HELP.items())
    return (
        f"Organization queries: {org}. "
        f"Per-member organization queries: {detail}. "
        f"Course queries (need course_uuid, Pro plan): {course}. "
        f"Per-member course queries (need course_uuid, Pro plan): {course_detail}. "
        "Times are in seconds."
    )


class RunAnalyticsParams(BaseModel):
    query: QueryName = Field(..., description=_query_doc())
    course_uuid: str | None = Field(
        None, max_length=100, description="The course, for course_* queries only."
    )
    days: int | None = Field(
        None,
        ge=1,
        le=365,
        description="Time window in days; omit for the query's own default (30, 90 or 180).",
    )

    @model_validator(mode="after")
    def _course_scope(self):
        is_course = self.query in _COURSE_SCOPED
        if is_course and not self.course_uuid:
            raise ValueError(f"{self.query} is a course query: pass course_uuid.")
        if not is_course and self.course_uuid:
            raise ValueError(
                f"{self.query} covers the whole organization: drop course_uuid, or use a course_* query."
            )
        return self


_NOT_CONFIGURED = (
    "Analytics is not set up on this LearnHouse server (no analytics backend is configured). "
    "Retrying will not help: tell the user an administrator has to set it up first."
)


async def _run_analytics(ctx: ToolContext, p: RunAnalyticsParams):
    acting = resolve_acting_user_id(ctx.user)
    course = None
    try:
        if p.course_uuid:
            course = await refs.load(ctx, "course", p.course_uuid)
        if p.query in _DETAIL:
            raw = await execute_detail_query(
                p.query,
                ctx.org.id,
                p.days,
                ctx.db_session,
                acting,
                course_uuid=course.course_uuid if course is not None else None,
            )
        elif course is not None:
            raw = await execute_course_query(
                p.query, course.course_uuid, ctx.org.id, p.days, ctx.db_session, acting
            )
        else:
            raw = await execute_org_query(p.query, ctx.org.id, p.days, ctx.db_session, acting)
    except HTTPException as e:
        # The runner authorizes first, so this only reaches people allowed
        # to run the query; the hint must not suggest retrying.
        if e.status_code == 503:
            raise HTTPException(status_code=400, detail=_NOT_CONFIGURED)
        raise

    rows = list(raw.get("data") or [])
    shown = rows[:MAX_ROWS]
    user_ids = set()
    for row in shown:
        try:
            if row.get("user_id"):
                user_ids.add(int(row["user_id"]))
        except (TypeError, ValueError):
            pass
    people = await member_refs(ctx, user_ids)
    items = [_clean_row(row, people) for row in shown]

    out: dict[str, Any] = {
        "query": p.query,
        "scope": "course" if course is not None else "organization",
        "days": p.days,
        "rows": items,
        "row_count": len(rows),
    }
    if course is not None:
        out["course"] = refs.ref(
            "course",
            course.course_uuid,
            course.name,
            await refs.web_url(ctx, "course", course=course.course_uuid),
        )
    if len(rows) > MAX_ROWS:
        out["truncated"] = True
    if not rows:
        out["note"] = "No data for this window yet."
    elif people or p.query == "search_effectiveness":
        # Member names and search terms are written by members.
        results.untrusted(out, "rows")
    return out


def _clean_row(row: dict, people: dict[int, dict]) -> dict:
    out: dict[str, Any] = {}
    for key, value in row.items():
        if key in ("org_id", "thumbnail_image"):
            continue
        if key == "user_id":
            try:
                out["member"] = people.get(int(value))
            except (TypeError, ValueError):
                out["member"] = None
            continue
        out[key] = results.clip(value) if isinstance(value, str) else value
    return out


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="run_analytics",
        description=(
            "Run one named analytics query from the dashboard catalog and get its rows, e.g. "
            "daily_active_users, top_courses, course_overview_stats, or per-member drill-downs "
            "like learner_engagement_score and course_top_learners. Org admins only; advanced "
            "queries need Enterprise, course queries need Pro and course_uuid. Use for real "
            "numbers about usage, time spent, engagement and completion."
        ),
        params_model=RunAnalyticsParams,
        tier=ActionTier.READ,
        rights_bucket=None,
        access_action=AccessAction.READ,
        execute=_run_analytics,
        target_kind="analytics",
        api_tokens=False,
        title="Run analytics",
    ),
]
