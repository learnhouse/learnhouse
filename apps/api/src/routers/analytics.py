import csv
import io
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from src.core.events.database import get_db_session
from src.db.users import PublicUser, AnonymousUser, APITokenUser, User
from src.db.user_organizations import UserOrganization
from src.db.roles import Role
from src.db.courses.courses import Course
from src.db.trail_runs import TrailRun
from src.security.auth import get_current_user, resolve_acting_user_id
from src.security.superadmin import is_user_superadmin
from src.security.org_auth import enforce_org_mfa
from src.security.features_utils.plan_check import get_org_plan
from src.security.features_utils.plans import plan_meets_requirement
from src.services.analytics import store
from src.services.analytics.cache import get_cached_result, set_cached_result
from src.services.analytics.enrichment import enrich_with_metadata
from src.services.orgs.users import _csv_safe
from src.services.analytics.queries import (
    ALL_QUERIES,
    ADVANCED_QUERIES,
    DETAIL_QUERIES,
    COURSE_QUERIES,
    COURSE_DETAIL_QUERIES,
    CORE_QUERIES,
    SUPERADMIN_QUERIES,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def _users_map(
    user_ids: list[int],
    org_id: int,
    db_session: AsyncSession,
    acting_user_id: int,
) -> dict[int, dict]:
    """Names and avatars for the users a chart row refers to.

    In the shared demo every visitor is an admin, so returning this unfiltered
    handed one visitor the real name, avatar and email address of every other
    person who had ever opened it. The seeded students are what the dashboard
    exists to show; other visitors are dropped, which leaves their rows in the
    chart without an identity attached.
    """
    from src.services.demo.guards import hide_other_visitors, is_demo_org

    statement = select(User).where(User.id.in_(user_ids))  # type: ignore[attr-defined]
    if await is_demo_org(org_id, db_session):
        statement = hide_other_visitors(statement, acting_user_id)

    users = (await db_session.execute(statement)).scalars().all()
    return {
        u.id: {
            "user_uuid": u.user_uuid,
            "first_name": u.first_name,
            "last_name": u.last_name,
            "username": u.username,
            "email": u.email,
            "avatar_image": u.avatar_image,
        }
        for u in users
    }


# -------------------------------------------------------------------
# Request / response models
# -------------------------------------------------------------------
class PlanInfoResponse(BaseModel):
    tier: str  # "core" | "advanced"
    plan: str


class AnalyticsStatusResponse(BaseModel):
    configured: bool


# -------------------------------------------------------------------
# Query execution (Postgres) with Redis caching
# -------------------------------------------------------------------
def _empty_result() -> dict:
    return {"data": [], "rows": 0, "meta": []}


async def _execute_query(
    query_name: str,
    sql: str,
    params: dict,
    org_id: int,
    days: int,
    course_id: str | None = None,
) -> dict:
    """Run a catalog query (``queries.py``) on Postgres, with Redis caching.

    1. Return the cached result when there is one.
    2. Otherwise run ``sql`` with its bind ``params`` through ``store.run_query``.
    3. Cache and return ``{"data": rows, "rows": n, "meta": []}``, the shape
       the dashboards read.

    The cache key is (query_name, org_id, days, course_id): callers must not
    pass parameters outside that key (e.g. a user id) through here.
    """
    cached = get_cached_result(query_name, org_id, days, course_id)
    if cached is not None:
        return cached

    try:
        rows = await store.run_query(sql, params)
    except Exception as exc:
        logger.warning("Analytics query '%s' failed: %s", query_name, str(exc)[:500])
        raise HTTPException(status_code=502, detail="Analytics query failed")

    response = {"data": rows, "rows": len(rows), "meta": []}
    set_cached_result(query_name, org_id, days, response, course_id)
    return response


def _resolve_legacy_query(query_name: str) -> tuple[str, int] | None:
    """The catalog query a legacy (Tinybird-era) caller means by ``query_name``."""
    if query_name in SUPERADMIN_QUERIES:
        return SUPERADMIN_QUERIES[query_name]
    for prefix in ("superadmin_", "global_"):
        if query_name.startswith(prefix) and query_name[len(prefix):] in CORE_QUERIES:
            return CORE_QUERIES[query_name[len(prefix):]]
    return None


# DEPRECATED: kept only for the Enterprise superadmin router, which still
# imports it and passes ClickHouse SQL. The SQL is ignored: the query is
# resolved by name ("superadmin_org_visits_rank", "superadmin_org_weekly_visits",
# "superadmin_<core query>" / "global_<core query>") and run on Postgres.
# Unknown names return the empty response. New code uses `_execute_query`.
async def _execute_tinybird_query(
    query_name: str,
    sql: str,
    org_id: int,
    days: int,
    course_id: str | None = None,
    empty_response: dict | None = None,
) -> dict:
    resolved = _resolve_legacy_query(query_name)
    if resolved is None:
        return empty_response if empty_response is not None else _empty_result()
    query_sql, default_days = resolved
    try:
        safe_org_id = int(org_id)
        safe_days = int(days) if days else default_days
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid parameter")
    safe_days = max(1, min(safe_days, 3650))
    params = _query_params(safe_org_id, safe_days)
    return await _execute_query(query_name, query_sql, params, safe_org_id, safe_days, course_id)


async def _verify_org_membership(user_id: int, org_id: int, db_session: AsyncSession) -> None:
    """Verify the user is a member of the specified organization.

    Prevents cross-org data access (IDOR) by ensuring the requesting user
    actually belongs to the org whose data they are querying.
    Superadmins bypass this check (they have access to all organizations).
    """
    if await is_user_superadmin(user_id, db_session):
        return

    membership = (await db_session.execute(
        select(UserOrganization).where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == org_id,
        )
    )).scalars().first()
    if not membership:
        raise HTTPException(status_code=403, detail="Not a member of this organization")
    await enforce_org_mfa(user_id, org_id, db_session)


async def _verify_org_admin(user_id: int, org_id: int, db_session: AsyncSession) -> None:
    """Verify the user has admin/maintainer role or a custom role with
    organizations.action_update permission in the specific organization.

    Unlike the old 'org_x' check, this ensures admin status is scoped
    to the actual organization being accessed, not any org the user belongs to.
    Superadmins bypass this check.
    """
    if await is_user_superadmin(user_id, db_session):
        return

    # Get the user's role in this specific org
    membership = (await db_session.execute(
        select(UserOrganization).where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == org_id,
        )
    )).scalars().first()
    if not membership:
        raise HTTPException(status_code=403, detail="Admin access required for this organization")

    # Fetch the role to check permissions
    role = (await db_session.execute(
        select(Role).where(Role.id == membership.role_id)
    )).scalars().first()
    if not role:
        raise HTTPException(status_code=403, detail="Admin access required for this organization")

    # Check if the role has organizations.action_update permission
    if role.rights:
        rights = role.rights
        org_rights = rights.get("organizations") if isinstance(rights, dict) else getattr(rights, "organizations", None)
        if org_rights:
            has_update = org_rights.get("action_update", False) if isinstance(org_rights, dict) else getattr(org_rights, "action_update", False)
            if has_update:
                await enforce_org_mfa(user_id, org_id, db_session)
                return

    raise HTTPException(status_code=403, detail="Admin access required for this organization")


def _parse_safe_params(
    org_id: int,
    request: Request,
    default_days: int,
) -> tuple[int, int]:
    """Validate and return (safe_org_id, safe_days)."""
    days_param = request.query_params.get("days", str(default_days))
    try:
        safe_org_id = int(org_id)
        safe_days = int(days_param) if days_param else default_days
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid parameter")
    # Cap the window: an unbounded interval only costs query time.
    safe_days = max(1, min(safe_days, 3650))
    return safe_org_id, safe_days


# The implementation lives in services/ so the audit dossier can reuse it without
# importing from src.routers. Re-exported under the original private name so the
# existing call sites (and the tests that patch it) keep working.
_enrich_with_metadata = enrich_with_metadata


# -------------------------------------------------------------------
# GET /status: whether analytics is available
# -------------------------------------------------------------------
@router.get(
    "/status",
    summary="Check analytics configuration",
    description="Returns whether analytics is available. Analytics is stored in the main database, so it is always configured.",
    responses={
        200: {"description": "Analytics configuration status"},
        401: {"description": "Authentication required"},
    },
)
async def analytics_status(
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    return AnalyticsStatusResponse(configured=True)


# -------------------------------------------------------------------
# GET /dashboard/detail/{query_name}: detail rows + PostgreSQL enrichment
# -------------------------------------------------------------------
@router.get(
    "/dashboard/detail/{query_name}",
    summary="Run a detail dashboard query",
    description="Executes a predefined analytics detail query and enriches the result rows with course, activity, and user metadata from PostgreSQL. Requires org admin privileges.",
    responses={
        200: {"description": "Detail query results with enriched metadata"},
        400: {"description": "Invalid query parameter"},
        401: {"description": "Authentication required"},
        403: {"description": "User is not a member or admin of the organization"},
        404: {"description": "Unknown detail query name"},
        502: {"description": "Analytics query failed"},
    },
)
async def query_dashboard_detail(
    query_name: str,
    org_id: int,
    request: Request,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    await _verify_org_membership(resolve_acting_user_id(current_user), org_id, db_session)

    await _verify_org_admin(resolve_acting_user_id(current_user), org_id, db_session)

    if query_name not in DETAIL_QUERIES:
        raise HTTPException(status_code=404, detail="Unknown detail query")

    sql, default_days = DETAIL_QUERIES[query_name]
    safe_org_id, safe_days = _parse_safe_params(org_id, request, default_days)

    params = _query_params(safe_org_id, safe_days)

    result = await _execute_query(query_name, sql, params, safe_org_id, safe_days)

    ch_data = result.get("data", [])

    # Enrich with course/activity metadata from PostgreSQL
    ch_data = await _enrich_with_metadata(ch_data, db_session, org_id=safe_org_id)

    # Enrich with user info from PostgreSQL
    user_ids = list({int(row["user_id"]) for row in ch_data if row.get("user_id")})
    users_map: dict[int, dict] = {}
    if user_ids:
        users_map = await _users_map(
            user_ids, org_id, db_session, resolve_acting_user_id(current_user)
        )

    return {"data": ch_data, "users": users_map}


# -------------------------------------------------------------------
# GET /dashboard/{query_name}: run a catalog analytics query
# -------------------------------------------------------------------
@router.get(
    "/dashboard/{query_name}",
    summary="Run a dashboard analytics query",
    description="Executes a predefined analytics query and returns the aggregated results. Advanced queries require an Enterprise plan. Requires org admin privileges.",
    responses={
        200: {"description": "Query results with enriched metadata"},
        400: {"description": "Invalid query parameter"},
        401: {"description": "Authentication required"},
        403: {"description": "User is not a member/admin, or plan does not permit advanced queries"},
        404: {"description": "Unknown query name"},
        502: {"description": "Analytics query failed"},
    },
)
async def query_dashboard(
    query_name: str,
    org_id: int,
    request: Request,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    await _verify_org_membership(resolve_acting_user_id(current_user), org_id, db_session)

    # Admin check
    await _verify_org_admin(resolve_acting_user_id(current_user), org_id, db_session)

    if query_name not in ALL_QUERIES:
        raise HTTPException(status_code=404, detail="Unknown query")

    # Plan gating for advanced queries
    if query_name in ADVANCED_QUERIES:
        from src.security.features_utils.plan_check import _check_mode_bypass
        bypass = _check_mode_bypass("analytics_advanced")
        if bypass is None:  # SaaS mode: check plan
            current_plan = await get_org_plan(org_id, db_session)
            if not plan_meets_requirement(current_plan, "enterprise"):
                raise HTTPException(
                    status_code=403,
                    detail="Advanced analytics requires an Enterprise plan or higher.",
                )

    sql, default_days = ALL_QUERIES[query_name]
    safe_org_id, safe_days = _parse_safe_params(org_id, request, default_days)

    params = _query_params(safe_org_id, safe_days)

    result = await _execute_query(query_name, sql, params, safe_org_id, safe_days)
    result["data"] = await _enrich_with_metadata(result.get("data", []), db_session, org_id=safe_org_id)
    return result


# -------------------------------------------------------------------
# GET /dashboard/db/{query_name}: PostgreSQL-based queries
# -------------------------------------------------------------------
@router.get(
    "/dashboard/db/{query_name}",
    summary="Run a PostgreSQL-backed dashboard query",
    description="Executes a predefined PostgreSQL analytics query (e.g. grade distribution histogram). Requires org admin privileges and a Pro plan or higher.",
    responses={
        200: {"description": "Query results from PostgreSQL"},
        401: {"description": "Authentication required"},
        403: {"description": "User is not admin or the organization lacks a Pro plan"},
        404: {"description": "Unknown query name"},
    },
)
async def query_dashboard_db(
    query_name: str,
    org_id: int,
    request: Request,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    await _verify_org_membership(resolve_acting_user_id(current_user), org_id, db_session)

    await _verify_org_admin(resolve_acting_user_id(current_user), org_id, db_session)

    DB_QUERIES = {"grade_distribution"}

    if query_name not in DB_QUERIES:
        raise HTTPException(status_code=404, detail="Unknown query")

    # All DB queries are Pro+ gated
    current_plan = await get_org_plan(org_id, db_session)
    if not plan_meets_requirement(current_plan, "pro"):
        raise HTTPException(
            status_code=403,
            detail="Advanced analytics requires a Pro plan or higher.",
        )

    if query_name == "grade_distribution":
        return await _query_grade_distribution(org_id, db_session)

    raise HTTPException(status_code=404, detail="Unknown query")  # pragma: no cover


async def _query_grade_distribution(org_id: int, db_session: AsyncSession):
    """Grade distribution histogram from PostgreSQL."""
    from sqlalchemy import text

    result = await db_session.execute(
        text(
            """
            SELECT
                aus.grade AS grade,
                count(*) AS count
            FROM assignmentusersubmission aus
            JOIN assignment a ON aus.assignment_id = a.id
            JOIN course c ON a.course_id = c.id
            WHERE c.org_id = :org_id
            GROUP BY aus.grade
            ORDER BY aus.grade
            """
        ),
        {"org_id": org_id},
    )
    rows = result.all()
    return {"data": [{"grade": row[0], "count": row[1]} for row in rows]}


# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------
_SAFE_COURSE_UUID = re.compile(r"^[a-zA-Z0-9_-]+$")


def _validate_course_uuid(course_uuid: str) -> str:
    """Validate course_uuid (bound as a parameter, but kept to the uuid
    alphabet so bad input fails fast and never reaches the cache key)."""
    if not course_uuid or not _SAFE_COURSE_UUID.match(course_uuid):
        raise HTTPException(status_code=400, detail="Invalid course_uuid")
    if len(course_uuid) > 100:
        raise HTTPException(status_code=400, detail="Invalid course_uuid")
    return course_uuid


def _query_params(
    org_id: int,
    days: int,
    course_uuid: str | None = None,
) -> dict:
    """Bind parameters for a catalog query, with their types enforced so a
    caller can't pass unvalidated input through."""
    # org_id and days are already validated as int by _parse_safe_params
    if not isinstance(org_id, int) or not isinstance(days, int):
        raise HTTPException(status_code=400, detail="Invalid parameter types")

    params: dict = {"org_id": org_id, "days": days}

    if course_uuid is not None:
        # Re-validate even if caller already did (defense in depth)
        if not _SAFE_COURSE_UUID.match(course_uuid) or len(course_uuid) > 100:
            raise HTTPException(status_code=400, detail="Invalid course_uuid")
        params["course_uuid"] = course_uuid

    return params


# -------------------------------------------------------------------
# GET /dashboard/course/detail/{query_name}: course-level detail with enrichment
# -------------------------------------------------------------------
@router.get(
    "/dashboard/course/detail/{query_name}",
    summary="Run a course-level detail analytics query",
    description="Executes a predefined course-level detail query, with a fallback to TrailRun data for enrollments,, and enriches results with course, activity, and user metadata. Requires org admin privileges and a Pro plan or higher.",
    responses={
        200: {"description": "Course detail query results with enriched metadata"},
        400: {"description": "Invalid query parameter or course_uuid"},
        401: {"description": "Authentication required"},
        403: {"description": "User is not admin or the organization lacks a Pro plan"},
        404: {"description": "Unknown course detail query name"},
        502: {"description": "Analytics query failed"},
    },
)
async def query_course_dashboard_detail(
    query_name: str,
    org_id: int,
    course_uuid: str,
    request: Request,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    await _verify_org_membership(resolve_acting_user_id(current_user), org_id, db_session)

    await _verify_org_admin(resolve_acting_user_id(current_user), org_id, db_session)

    # Pro plan required for all course analytics
    current_plan = await get_org_plan(org_id, db_session)
    if not plan_meets_requirement(current_plan, "pro"):
        raise HTTPException(
            status_code=403,
            detail="Course analytics requires a Pro plan or higher.",
        )

    if query_name not in COURSE_DETAIL_QUERIES:
        raise HTTPException(status_code=404, detail="Unknown course detail query")

    safe_course_uuid = _validate_course_uuid(course_uuid)

    sql, default_days = COURSE_DETAIL_QUERIES[query_name]
    safe_org_id, safe_days = _parse_safe_params(org_id, request, default_days)

    params = _query_params(safe_org_id, safe_days, safe_course_uuid)

    result = await _execute_query(
        query_name, sql, params, safe_org_id, safe_days,
        course_id=safe_course_uuid,
    )

    ch_data = result.get("data", [])

    # Fallback: if no enrollment events were recorded (e.g. enrollments from
    # before analytics moved to Postgres), use the TrailRun table
    if query_name == "course_recent_enrollments" and not ch_data:
        course_obj = (await db_session.execute(
            select(Course).where(Course.course_uuid == safe_course_uuid)
        )).scalars().first()
        if course_obj:
            trail_runs = (await db_session.execute(
                select(TrailRun)
                .where(
                    TrailRun.course_id == course_obj.id,
                    TrailRun.org_id == safe_org_id,
                )
                .order_by(TrailRun.id.desc())  # type: ignore
                .limit(50)
            )).scalars().all()
            ch_data = [
                {
                    "user_id": tr.user_id,
                    "enrolled_at": tr.creation_date,
                }
                for tr in trail_runs
            ]

    # Enrich with course/activity metadata from PostgreSQL
    ch_data = await _enrich_with_metadata(ch_data, db_session, org_id=safe_org_id)

    # Enrich with user info from PostgreSQL
    user_ids = list({int(row["user_id"]) for row in ch_data if row.get("user_id")})
    users_map: dict[int, dict] = {}
    if user_ids:
        users_map = await _users_map(
            user_ids, org_id, db_session, resolve_acting_user_id(current_user)
        )

    return {"data": ch_data, "users": users_map}


# -------------------------------------------------------------------
# GET /dashboard/course/{query_name}: course-level analytics (Pro only)
# -------------------------------------------------------------------
@router.get(
    "/dashboard/course/{query_name}",
    summary="Run a course-level analytics query",
    description="Executes a predefined course-level analytics query and returns enriched aggregated results. Requires org admin privileges and a Pro plan or higher.",
    responses={
        200: {"description": "Course query results with enriched metadata"},
        400: {"description": "Invalid query parameter or course_uuid"},
        401: {"description": "Authentication required"},
        403: {"description": "User is not admin or the organization lacks a Pro plan"},
        404: {"description": "Unknown course query name"},
        502: {"description": "Analytics query failed"},
    },
)
async def query_course_dashboard(
    query_name: str,
    org_id: int,
    course_uuid: str,
    request: Request,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    await _verify_org_membership(resolve_acting_user_id(current_user), org_id, db_session)

    await _verify_org_admin(resolve_acting_user_id(current_user), org_id, db_session)

    # Pro plan required for all course analytics
    current_plan = await get_org_plan(org_id, db_session)
    if not plan_meets_requirement(current_plan, "pro"):
        raise HTTPException(
            status_code=403,
            detail="Course analytics requires a Pro plan or higher.",
        )

    if query_name not in COURSE_QUERIES:
        raise HTTPException(status_code=404, detail="Unknown course query")

    safe_course_uuid = _validate_course_uuid(course_uuid)

    sql, default_days = COURSE_QUERIES[query_name]
    safe_org_id, safe_days = _parse_safe_params(org_id, request, default_days)

    params = _query_params(safe_org_id, safe_days, safe_course_uuid)

    result = await _execute_query(
        query_name, sql, params, safe_org_id, safe_days,
        course_id=safe_course_uuid,
    )
    result["data"] = await _enrich_with_metadata(result.get("data", []), db_session, org_id=safe_org_id)
    return result


# -------------------------------------------------------------------
# GET /export: export analytics data as JSON or CSV
# -------------------------------------------------------------------
@router.get(
    "/export",
    summary="Export analytics data",
    description="Exports results for a comma-separated list of analytics queries in either JSON or CSV format. Requires org admin privileges.",
    responses={
        200: {"description": "Analytics data exported as JSON or streaming CSV"},
        400: {"description": "Invalid format, queries, or parameters"},
        401: {"description": "Authentication required"},
        403: {"description": "User is not admin of the organization"},
        502: {"description": "Analytics query failed"},
    },
)
async def export_analytics(
    org_id: int,
    request: Request,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    await _verify_org_membership(resolve_acting_user_id(current_user), org_id, db_session)

    await _verify_org_admin(resolve_acting_user_id(current_user), org_id, db_session)

    # Parse params
    fmt = request.query_params.get("format", "json")
    if fmt not in ("json", "csv"):
        raise HTTPException(status_code=400, detail="format must be 'json' or 'csv'")

    queries_param = request.query_params.get("queries", "")
    if not queries_param:
        raise HTTPException(status_code=400, detail="queries parameter required")

    query_names = [q.strip() for q in queries_param.split(",") if q.strip()]
    course_uuid = request.query_params.get("course_uuid")
    safe_course_uuid = _validate_course_uuid(course_uuid) if course_uuid else None

    # Only treat ``days`` as an explicit override when the caller actually
    # passed it. Otherwise each query must fall back to its own default
    # window (e.g. advanced queries default to 90/180 days); hard-coding a
    # 30-day default here silently truncated long-window exports.
    days_param = request.query_params.get("days")
    try:
        safe_org_id = int(org_id)
        safe_days = int(days_param) if days_param else None
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid parameter")

    # Determine which query registries to check
    if safe_course_uuid:
        allowed = {**COURSE_QUERIES, **COURSE_DETAIL_QUERIES}
    else:
        allowed = {**ALL_QUERIES}

    # Plan gating: /export must enforce the same plan limits as the
    # individual dashboard endpoints, otherwise an admin on a free/lower
    # plan could exfiltrate course-level (Pro) and advanced (Enterprise)
    # analytics simply by exporting them.
    from src.security.features_utils.plan_check import _check_mode_bypass

    requested = [q for q in query_names if q in allowed]
    if safe_course_uuid and requested:
        # All course-scoped analytics require Pro or higher.
        current_plan = await get_org_plan(org_id, db_session)
        if not plan_meets_requirement(current_plan, "pro"):
            raise HTTPException(
                status_code=403,
                detail="Course analytics requires a Pro plan or higher.",
            )
    elif any(q in ADVANCED_QUERIES for q in requested):
        # Advanced queries require an Enterprise plan in SaaS mode.
        bypass = _check_mode_bypass("analytics_advanced")
        if bypass is None:
            current_plan = await get_org_plan(org_id, db_session)
            if not plan_meets_requirement(current_plan, "enterprise"):
                raise HTTPException(
                    status_code=403,
                    detail="Advanced analytics requires an Enterprise plan or higher.",
                )

    # Execute requested queries
    results: dict[str, dict] = {}
    for qname in query_names:
        if qname not in allowed:
            continue
        sql, default_days = allowed[qname]
        d = safe_days if safe_days else default_days
        params = _query_params(safe_org_id, d, safe_course_uuid)
        result = await _execute_query(qname, sql, params, safe_org_id, d, course_id=safe_course_uuid)
        result["data"] = await _enrich_with_metadata(result.get("data", []), db_session, org_id=safe_org_id)
        results[qname] = result

    if fmt == "json":
        return results

    # CSV format: sections separated by query name headers
    output = io.StringIO()
    for qname, result in results.items():
        rows = result.get("data", [])
        output.write(f"# {qname}\n")
        if rows:
            # Rows can have heterogeneous keys after PostgreSQL enrichment
            # (e.g. only some rows get course_name/activity_name). Build the
            # header from the union of all keys and ignore extras so
            # csv.DictWriter never raises ValueError on a row with a key not
            # present in the first row.
            fieldnames: list = []
            seen: set = set()
            for row in rows:
                for k in row.keys():
                    if k not in seen:
                        seen.add(k)
                        fieldnames.append(k)
            writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(
                {k: _csv_safe(v) for k, v in row.items()} for row in rows
            )
        output.write("\n")

    filename = f"analytics_export_{safe_org_id}_{safe_days or 'default'}d.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# -------------------------------------------------------------------
# GET /plan-info: returns analytics tier for the org
# -------------------------------------------------------------------
@router.get(
    "/plan-info",
    summary="Get analytics plan tier for an organization",
    description="Returns the analytics tier (core or advanced) available to the organization based on its current plan.",
    responses={
        200: {"description": "Analytics plan tier information"},
        401: {"description": "Authentication required"},
        403: {"description": "User is not a member of the target organization"},
    },
)
async def get_plan_info(
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    await _verify_org_membership(resolve_acting_user_id(current_user), org_id, db_session)

    current_plan = await get_org_plan(org_id, db_session)
    tier = "advanced" if plan_meets_requirement(current_plan, "pro") else "core"
    return PlanInfoResponse(tier=tier, plan=current_plan)
