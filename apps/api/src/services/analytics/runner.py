"""Named-query analytics runner.

Extracted from `src/routers/analytics.py` so both the HTTP endpoints and
the agent's analytics tools execute the exact same catalog queries with
the exact same authorization gates. Only queries from
`src/services/analytics/queries.py` can run — never raw SQL from callers.
"""

from __future__ import annotations

import logging
import re

import httpx
from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from config.config import get_learnhouse_config
from src.db.courses.activities import Activity
from src.db.courses.courses import Course
from src.db.roles import Role
from src.db.user_organizations import UserOrganization
from src.security.features_utils.plan_check import get_org_plan
from src.security.features_utils.plans import plan_meets_requirement
from src.security.superadmin import is_user_superadmin
from src.services.analytics.cache import get_cached_result, set_cached_result
from src.services.analytics.queries import (
    ADVANCED_QUERIES,
    ALL_QUERIES,
    COURSE_QUERIES,
    DETAIL_QUERIES,
)

logger = logging.getLogger(__name__)

# Lazy singleton httpx client for Tinybird Query API
_read_client: httpx.AsyncClient | None = None


def _get_read_client() -> httpx.AsyncClient | None:
    global _read_client
    if _read_client is not None:
        return _read_client

    config = get_learnhouse_config()
    tb = config.tinybird_config
    if tb is None:
        return None

    _read_client = httpx.AsyncClient(
        base_url=tb.api_url,
        headers={"Authorization": f"Bearer {tb.read_token}"},
        timeout=30.0,
    )
    return _read_client


async def execute_tinybird_query(
    query_name: str,
    sql: str,
    org_id: int,
    days: int,
    course_id: str | None = None,
    empty_response: dict | None = None,
) -> dict:
    """
    Execute a SQL query via Tinybird Query API with Redis caching.

    1. Check Redis cache for a previous result.
    2. On miss, POST SQL to Tinybird /v0/sql.
    3. Cache the response on success.
    4. Return the JSON result dict.
    """
    if empty_response is None:
        empty_response = {"data": [], "rows": 0, "meta": []}

    # --- cache check ---
    cached = get_cached_result(query_name, org_id, days, course_id)
    if cached is not None:
        return cached

    # --- Tinybird SQL API call ---
    client = _get_read_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Analytics not configured")

    try:
        resp = await client.post("/v0/sql", content=sql + " FORMAT JSON")
        resp.raise_for_status()
        result = resp.json()
    except httpx.HTTPStatusError as exc:
        error_msg = exc.response.text[:500]
        logger.warning(
            "Tinybird query '%s' failed (%s): %s",
            query_name, exc.response.status_code, error_msg,
        )
        if any(s in error_msg for s in ("UNKNOWN_TABLE", "doesn't exist", "not found")):
            return empty_response
        raise HTTPException(status_code=502, detail="Analytics query failed")
    except Exception as exc:
        logger.warning("Tinybird query '%s' failed: %s", query_name, str(exc)[:500])
        raise HTTPException(status_code=502, detail="Analytics query failed")

    # Tinybird returns {"data": [...], "rows": N, "meta": [...]} — same shape as frontend expects.
    # Safety net: sanitize NaN/Inf values in the response
    rows = result.get("data", [])
    for row in rows:
        for key, val in row.items():
            if isinstance(val, float) and (val != val or val == float('inf') or val == float('-inf')):
                logger.debug("Query '%s' returned NaN/Inf for key '%s', converting to None", query_name, key)
                row[key] = None

    response = {
        "data": rows,
        "rows": result.get("rows", len(rows)),
        "meta": result.get("meta", []),
    }

    # --- cache store ---
    set_cached_result(query_name, org_id, days, response, course_id)

    return response


async def verify_org_membership(user_id: int, org_id: int, db_session: AsyncSession) -> None:
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


async def verify_org_admin(user_id: int, org_id: int, db_session: AsyncSession) -> None:
    """Verify the user has admin/maintainer role or a custom role with
    organizations.action_update permission in the specific organization.

    Unlike the old 'org_x' check, this ensures admin status is scoped
    to the actual organization being accessed — not any org the user belongs to.
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
                return

    raise HTTPException(status_code=403, detail="Admin access required for this organization")


async def enrich_with_metadata(rows: list[dict], db_session: AsyncSession) -> list[dict]:
    """Enrich analytics result rows with course/activity metadata from PostgreSQL."""
    if not rows:
        return rows

    # Collect unique course_uuids
    course_uuids = set()
    for row in rows:
        if row.get("course_uuid"):
            course_uuids.add(row["course_uuid"])

    # Batch fetch courses
    course_map: dict[str, Course] = {}
    if course_uuids:
        courses = (await db_session.execute(
            select(Course).where(Course.course_uuid.in_(list(course_uuids)))  # type: ignore
        )).scalars().all()
        course_map = {c.course_uuid: c for c in courses}

    # Collect unique activity_uuids
    activity_uuids = set()
    for row in rows:
        for key in ("activity_uuid", "last_activity_uuid"):
            if row.get(key):
                activity_uuids.add(row[key])

    # Batch fetch activities
    activity_map: dict[str, Activity] = {}
    if activity_uuids:
        activities = (await db_session.execute(
            select(Activity).where(Activity.activity_uuid.in_(list(activity_uuids)))  # type: ignore
        )).scalars().all()
        activity_map = {a.activity_uuid: a for a in activities}

        # Also resolve course_uuid for activities (needed when rows don't have course_uuid)
        activity_course_ids = {a.course_id for a in activities if a.course_id}
        missing_course_ids = activity_course_ids - {c.id for c in course_map.values()}
        if missing_course_ids:
            extra_courses = (await db_session.execute(
                select(Course).where(Course.id.in_(list(missing_course_ids)))  # type: ignore
            )).scalars().all()
            for c in extra_courses:
                course_map[c.course_uuid] = c

    # Build course_id -> course_uuid lookup for activity enrichment
    course_id_to_obj = {c.id: c for c in course_map.values()}

    # Inject metadata into rows
    for row in rows:
        if row.get("course_uuid"):
            course = course_map.get(row["course_uuid"])
            if course:
                row["course_name"] = course.name
                row["thumbnail_image"] = course.thumbnail_image or ""

        for key in ("activity_uuid", "last_activity_uuid"):
            if row.get(key):
                activity = activity_map.get(row[key])
                if activity:
                    name_key = "activity_name" if key == "activity_uuid" else "last_activity_name"
                    row[name_key] = activity.name
                    # If row doesn't have course_uuid, resolve it from the activity
                    if not row.get("course_uuid") and activity.course_id:
                        parent_course = course_id_to_obj.get(activity.course_id)
                        if parent_course:
                            row["course_uuid"] = parent_course.course_uuid
                            row["course_name"] = parent_course.name

    return rows


_SAFE_COURSE_UUID = re.compile(r"^[a-zA-Z0-9_-]+$")


def validate_course_uuid(course_uuid: str) -> str:
    """Validate course_uuid is safe for string interpolation into SQL."""
    if not course_uuid or not _SAFE_COURSE_UUID.match(course_uuid):
        raise HTTPException(status_code=400, detail="Invalid course_uuid")
    if len(course_uuid) > 100:
        raise HTTPException(status_code=400, detail="Invalid course_uuid")
    return course_uuid


def build_sql(
    sql_template: str,
    org_id: int,
    days: int,
    course_uuid: str | None = None,
) -> str:
    """
    Build SQL from template with validated parameters.

    Tinybird SQL API does not support parameterized queries, so we must
    interpolate values. This function centralizes that interpolation and
    enforces type safety so callers cannot accidentally pass unvalidated input.
    """
    # org_id and days are already validated as int by the callers
    if not isinstance(org_id, int) or not isinstance(days, int):
        raise HTTPException(status_code=400, detail="Invalid parameter types")

    params: dict = {"org_id": org_id, "days": days}

    if course_uuid is not None:
        # Re-validate even if caller already did — defense in depth
        if not _SAFE_COURSE_UUID.match(course_uuid) or len(course_uuid) > 100:
            raise HTTPException(status_code=400, detail="Invalid course_uuid")
        params["course_uuid"] = course_uuid

    return sql_template.format(**params)


# -------------------------------------------------------------------
# Agent-facing composites — same gates as the HTTP endpoints
# -------------------------------------------------------------------


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
    await verify_org_membership(acting_user_id, org_id, db_session)
    await verify_org_admin(acting_user_id, org_id, db_session)

    if query_name in DETAIL_QUERIES or query_name not in ALL_QUERIES:
        raise HTTPException(status_code=404, detail="Unknown query")

    if query_name in ADVANCED_QUERIES:
        from src.security.features_utils.plan_check import _check_mode_bypass
        bypass = _check_mode_bypass("analytics_advanced")
        if bypass is None:  # SaaS mode — check plan
            current_plan = await get_org_plan(org_id, db_session)
            if not plan_meets_requirement(current_plan, "enterprise"):
                raise HTTPException(
                    status_code=403,
                    detail="Advanced analytics requires an Enterprise plan or higher.",
                )

    sql_template, default_days = ALL_QUERIES[query_name]
    safe_days = int(days) if days else default_days
    sql = build_sql(sql_template, int(org_id), safe_days)

    result = await execute_tinybird_query(query_name, sql, int(org_id), safe_days)
    result["data"] = await enrich_with_metadata(result.get("data", []), db_session)
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
    await verify_org_membership(acting_user_id, org_id, db_session)
    await verify_org_admin(acting_user_id, org_id, db_session)

    from src.security.features_utils.plan_check import _check_mode_bypass
    bypass = _check_mode_bypass("analytics_advanced")
    if bypass is None:  # SaaS mode — check plan
        current_plan = await get_org_plan(org_id, db_session)
        if not plan_meets_requirement(current_plan, "pro"):
            raise HTTPException(
                status_code=403,
                detail="Course analytics requires a Pro plan or higher.",
            )

    if query_name not in COURSE_QUERIES:
        raise HTTPException(status_code=404, detail="Unknown course query")

    safe_course_uuid = validate_course_uuid(course_uuid)
    sql_template, default_days = COURSE_QUERIES[query_name]
    safe_days = int(days) if days else default_days
    sql = build_sql(sql_template, int(org_id), safe_days, safe_course_uuid)

    result = await execute_tinybird_query(
        query_name, sql, int(org_id), safe_days, course_id=safe_course_uuid
    )
    result["data"] = await enrich_with_metadata(result.get("data", []), db_session)
    return result
