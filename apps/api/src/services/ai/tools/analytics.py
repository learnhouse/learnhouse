"""Analytics tools — named catalog queries + learner progress.

Wraps the analytics runner (`src/services/analytics/runner.py`) so the
agent runs the exact same parameterized catalog queries with the exact
same authorization gates as the dashboard endpoints. Raw SQL from the
model is impossible by construction — only catalog names are accepted.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from src.security.auth import resolve_acting_user_id
from src.security.rbac import AccessAction
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
from src.services.analytics.queries import (
    ADVANCED_QUERIES,
    CORE_QUERIES,
    COURSE_QUERIES,
)
from src.services.analytics.runner import execute_course_query, execute_org_query
from src.services.trail.trail import get_user_trail_with_orgid


class ListAnalyticsQueriesParams(BaseModel):
    pass


class OrgAnalyticsParams(BaseModel):
    query_name: str = Field(
        ..., description="A name from list_analytics_queries (org-level catalog)"
    )
    days: int | None = Field(
        None, ge=1, le=365, description="Time window in days (query default if unset)"
    )


class CourseAnalyticsParams(BaseModel):
    query_name: str = Field(
        ..., description="A name from list_analytics_queries (course-level catalog)"
    )
    course_uuid: str
    days: int | None = Field(None, ge=1, le=365)


class UserProgressParams(BaseModel):
    pass


async def _list_analytics_queries(ctx: ToolContext, p: ListAnalyticsQueriesParams):
    return {
        "org_queries": {
            "core": sorted(CORE_QUERIES),
            "advanced_requires_enterprise_plan": sorted(ADVANCED_QUERIES),
        },
        "course_queries": sorted(COURSE_QUERIES),
        "notes": (
            "Run org queries with query_org_analytics and course queries with "
            "query_course_analytics. Names describe the metric (e.g. "
            "course_overview_stats, enrollment_funnel, daily_active_users)."
        ),
    }


async def _query_org_analytics(ctx: ToolContext, p: OrgAnalyticsParams):
    return await execute_org_query(
        p.query_name,
        ctx.org.id,
        p.days,
        ctx.db_session,
        resolve_acting_user_id(ctx.user),
    )


async def _query_course_analytics(ctx: ToolContext, p: CourseAnalyticsParams):
    return await execute_course_query(
        p.query_name,
        p.course_uuid,
        ctx.org.id,
        p.days,
        ctx.db_session,
        resolve_acting_user_id(ctx.user),
    )


async def _get_user_progress(ctx: ToolContext, p: UserProgressParams):
    trail = await get_user_trail_with_orgid(
        ctx.request, ctx.user, ctx.org.id, ctx.db_session
    )
    return jsonable(trail)


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_analytics_queries",
        description=(
            "List the available analytics query names (org-level and "
            "course-level). Call before querying analytics."
        ),
        params_model=ListAnalyticsQueriesParams,
        tier=ActionTier.READ,
        rights_bucket="dashboard",
        access_action=AccessAction.READ,
        execute=_list_analytics_queries,
    ),
    ToolSpec(
        name="query_org_analytics",
        description=(
            "Run a named org-level analytics query (active users, top "
            "courses, funnels, retention, ...). Use to answer 'how is the "
            "org doing' questions with real numbers. Requires org admin."
        ),
        params_model=OrgAnalyticsParams,
        tier=ActionTier.READ,
        rights_bucket="dashboard",
        access_action=AccessAction.READ,
        execute=_query_org_analytics,
    ),
    ToolSpec(
        name="query_course_analytics",
        description=(
            "Run a named course-level analytics query (overview stats, "
            "enrollment trend, activity funnel/dropoff, top learners, ...). "
            "Use to answer 'how is course X doing'. Requires org admin."
        ),
        params_model=CourseAnalyticsParams,
        tier=ActionTier.READ,
        rights_bucket="dashboard",
        access_action=AccessAction.READ,
        execute=_query_course_analytics,
        target_param="course_uuid",
        target_kind="course",
    ),
    ToolSpec(
        name="get_user_progress",
        description=(
            "Get the acting user's own learning trail (course enrollment "
            "and activity completion) in this org."
        ),
        params_model=UserProgressParams,
        tier=ActionTier.READ,
        rights_bucket=None,
        access_action=AccessAction.READ,
        execute=_get_user_progress,
    ),
]
