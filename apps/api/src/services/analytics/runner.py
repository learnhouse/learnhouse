"""Named-query analytics runner for the agent tools.

Runs the same catalog queries as the `/analytics/dashboard` endpoints, with
the same gates. The Tinybird client, membership/admin checks, window cap and
SQL interpolation stay in `src/routers/analytics.py` (its tests patch them
there), so this module reaches into it lazily instead of keeping a second
copy that would drift. Only queries from `src/services/analytics/queries.py`
can run, never raw SQL from callers.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession

from src.security.features_utils.plan_check import get_org_plan
from src.security.features_utils.plans import plan_meets_requirement
from src.services.analytics.enrichment import enrich_with_metadata
from src.services.analytics.queries import (
    ADVANCED_QUERIES,
    ALL_QUERIES,
    COURSE_QUERIES,
    DETAIL_QUERIES,
)

# Same bounds as the HTTP endpoints' `_parse_safe_params`.
MIN_DAYS = 1
MAX_DAYS = 3650


def _safe_days(days: int | None, default_days: int) -> int:
    try:
        value = int(days) if days else default_days
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid parameter")
    return max(MIN_DAYS, min(value, MAX_DAYS))


async def _verify_admin(acting_user_id: int, org_id: int, db_session: AsyncSession) -> None:
    from src.routers import analytics as router  # noqa: PLC0415 (avoids an import cycle)

    await router._verify_org_membership(acting_user_id, org_id, db_session)
    await router._verify_org_admin(acting_user_id, org_id, db_session)


async def execute_org_query(
    query_name: str,
    org_id: int,
    days: int | None,
    db_session: AsyncSession,
    acting_user_id: int,
) -> dict:
    """Run a named org-level dashboard query with the endpoint's gates:
    org membership + org admin, catalog-only names, and the Enterprise
    plan requirement for ADVANCED queries. Per-user DETAIL queries are
    excluded from this surface."""
    from src.routers import analytics as router  # noqa: PLC0415

    await _verify_admin(acting_user_id, org_id, db_session)

    if query_name in DETAIL_QUERIES or query_name not in ALL_QUERIES:
        raise HTTPException(status_code=404, detail="Unknown query")

    if query_name in ADVANCED_QUERIES:
        from src.security.features_utils.plan_check import _check_mode_bypass  # noqa: PLC0415

        if _check_mode_bypass("analytics_advanced") is None:  # SaaS mode: check plan
            current_plan = await get_org_plan(org_id, db_session)
            if not plan_meets_requirement(current_plan, "enterprise"):
                raise HTTPException(
                    status_code=403,
                    detail="Advanced analytics requires an Enterprise plan or higher.",
                )

    sql_template, default_days = ALL_QUERIES[query_name]
    safe_org_id = int(org_id)
    safe_days = _safe_days(days, default_days)
    sql = router._build_sql(sql_template, safe_org_id, safe_days)

    result = await router._execute_tinybird_query(query_name, sql, safe_org_id, safe_days)
    result["data"] = await enrich_with_metadata(
        result.get("data", []), db_session, org_id=safe_org_id
    )
    return result


async def execute_course_query(
    query_name: str,
    course_uuid: str,
    org_id: int,
    days: int | None,
    db_session: AsyncSession,
    acting_user_id: int,
) -> dict:
    """Run a named course-level query with the endpoint's gates: org
    membership + org admin and the Pro plan requirement."""
    from src.routers import analytics as router  # noqa: PLC0415

    await _verify_admin(acting_user_id, org_id, db_session)

    current_plan = await get_org_plan(org_id, db_session)
    if not plan_meets_requirement(current_plan, "pro"):
        raise HTTPException(
            status_code=403,
            detail="Course analytics requires a Pro plan or higher.",
        )

    if query_name not in COURSE_QUERIES:
        raise HTTPException(status_code=404, detail="Unknown course query")

    safe_course_uuid = router._validate_course_uuid(course_uuid)
    sql_template, default_days = COURSE_QUERIES[query_name]
    safe_org_id = int(org_id)
    safe_days = _safe_days(days, default_days)
    sql = router._build_sql(sql_template, safe_org_id, safe_days, safe_course_uuid)

    result = await router._execute_tinybird_query(
        query_name, sql, safe_org_id, safe_days, course_id=safe_course_uuid
    )
    result["data"] = await enrich_with_metadata(
        result.get("data", []), db_session, org_id=safe_org_id
    )
    return result
