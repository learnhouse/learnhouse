import csv
import io
import logging
import re

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select
from config.config import get_learnhouse_config
from src.core.events.database import get_db_session
from src.db.users import PublicUser, AnonymousUser, User
from src.security.auth import get_current_user
from src.security.rbac.rbac import authorization_verify_based_on_roles
from src.security.features_utils.plan_check import get_org_plan
from src.security.features_utils.plans import plan_meets_requirement
from src.services.analytics.analytics import track
from src.services.analytics.cache import get_cached_result, set_cached_result
from src.services.analytics.events import ALLOWED_FRONTEND_EVENTS
from src.services.analytics.queries import (
    ALL_QUERIES,
    ADVANCED_QUERIES,
    DETAIL_QUERIES,
    COURSE_QUERIES,
    COURSE_DETAIL_QUERIES,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# -------------------------------------------------------------------
# Request / response models
# -------------------------------------------------------------------
class FrontendEvent(BaseModel):
    event_name: str
    org_id: int
    session_id: str = ""
    properties: dict = {}


class PlanInfoResponse(BaseModel):
    tier: str  # "core" | "advanced"
    plan: str


class AnalyticsStatusResponse(BaseModel):
    configured: bool


# -------------------------------------------------------------------
# Shared Tinybird query execution with Redis caching
# -------------------------------------------------------------------
async def _execute_tinybird_query(
    query_name: str,
    sql: str,
    org_id: int,
    days: int,
    course_id: str | None = None,
    empty_response: dict | None = None,
) -> dict:
    """
    Execute a Tinybird SQL query with Redis caching.

    1. Check Redis cache for a previous result.
    2. On miss, POST to Tinybird Query API.
    3. Cache the response on success.
    4. Return the JSON result dict.
    """
    if empty_response is None:
        empty_response = {"data": [], "rows": 0, "meta": []}

    # --- cache check ---
    cached = get_cached_result(query_name, org_id, days, course_id)
    if cached is not None:
        return cached

    # --- Tinybird call ---
    config = get_learnhouse_config()
    tb = config.tinybird_config
    if tb is None:
        raise HTTPException(status_code=503, detail="Analytics not configured")

    url = f"{tb.api_url.rstrip('/')}/v0/sql"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            url,
            content=sql,
            headers={"Authorization": f"Bearer {tb.read_token}"},
        )

    if resp.status_code != 200:
        error_body = resp.text[:500]
        logger.warning(
            "Tinybird query '%s' failed (%d): %s",
            query_name, resp.status_code, error_body,
        )
        if any(s in error_body for s in ("not found", "doesn't exist", "UNKNOWN_TABLE")):
            return empty_response
        raise HTTPException(status_code=502, detail="Analytics query failed")

    result = resp.json()

    # --- cache store ---
    set_cached_result(query_name, org_id, days, result, course_id)

    return result


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
    return safe_org_id, safe_days


# -------------------------------------------------------------------
# GET /status — Whether analytics (Tinybird) is configured
# -------------------------------------------------------------------
@router.get("/status")
async def analytics_status(
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    config = get_learnhouse_config()
    return AnalyticsStatusResponse(configured=config.tinybird_config is not None)


# -------------------------------------------------------------------
# POST /events — Frontend event proxy
# -------------------------------------------------------------------
@router.post("/events")
async def ingest_frontend_event(
    body: FrontendEvent,
    request: Request,
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    if body.event_name not in ALLOWED_FRONTEND_EVENTS:
        raise HTTPException(status_code=400, detail="Invalid event name")

    ip = request.client.host if request.client else ""

    # Enrich page_view with server-side geo data from proxy headers
    properties = dict(body.properties)
    if body.event_name == "page_view":
        country = (
            request.headers.get("cf-ipcountry")  # Cloudflare
            or request.headers.get("x-country-code")  # Custom proxy
            or ""
        )
        if country and country not in ("XX", "T1"):
            properties.setdefault("country_code", country.upper())

    await track(
        event_name=body.event_name,
        org_id=body.org_id,
        user_id=current_user.id,
        session_id=body.session_id,
        properties=properties,
        source="frontend",
        ip=ip,
    )
    return {"ok": True}


# -------------------------------------------------------------------
# GET /dashboard/detail/{query_name} — Tinybird + PostgreSQL enrichment
# -------------------------------------------------------------------
@router.get("/dashboard/detail/{query_name}")
async def query_dashboard_detail(
    query_name: str,
    org_id: int,
    request: Request,
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    is_admin = await authorization_verify_based_on_roles(
        request, current_user.id, "update", "org_x", db_session
    )
    if not is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    if query_name not in DETAIL_QUERIES:
        raise HTTPException(status_code=404, detail="Unknown detail query")

    sql_template, default_days = DETAIL_QUERIES[query_name]
    safe_org_id, safe_days = _parse_safe_params(org_id, request, default_days)

    sql = sql_template.format(org_id=safe_org_id, days=safe_days)

    tb_result = await _execute_tinybird_query(
        query_name, sql, safe_org_id, safe_days,
        empty_response={"data": [], "users": {}},
    )

    # For detail queries the cached result is the full Tinybird response;
    # we still need to enrich with user data.
    tb_data = tb_result.get("data", [])

    # Enrich with user info from PostgreSQL
    user_ids = list({int(row["user_id"]) for row in tb_data if row.get("user_id")})
    users_map: dict[int, dict] = {}
    if user_ids:
        users = db_session.exec(select(User).where(User.id.in_(user_ids))).all()  # type: ignore
        users_map = {
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

    return {"data": tb_data, "users": users_map}


# -------------------------------------------------------------------
# GET /dashboard/{query_name} — Run analytics query via Tinybird SQL API
# -------------------------------------------------------------------
@router.get("/dashboard/{query_name}")
async def query_dashboard(
    query_name: str,
    org_id: int,
    request: Request,
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    # Admin check
    is_admin = await authorization_verify_based_on_roles(
        request, current_user.id, "update", "org_x", db_session
    )
    if not is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    if query_name not in ALL_QUERIES:
        raise HTTPException(status_code=404, detail="Unknown query")

    # Plan gating for advanced queries
    if query_name in ADVANCED_QUERIES:
        current_plan = get_org_plan(org_id, db_session)
        if not plan_meets_requirement(current_plan, "pro"):
            raise HTTPException(
                status_code=403,
                detail="Advanced analytics requires a Pro plan or higher.",
            )

    sql_template, default_days = ALL_QUERIES[query_name]
    safe_org_id, safe_days = _parse_safe_params(org_id, request, default_days)

    sql = sql_template.format(org_id=safe_org_id, days=safe_days)

    return await _execute_tinybird_query(query_name, sql, safe_org_id, safe_days)


# -------------------------------------------------------------------
# GET /dashboard/db/{query_name} — PostgreSQL-based queries
# -------------------------------------------------------------------
@router.get("/dashboard/db/{query_name}")
async def query_dashboard_db(
    query_name: str,
    org_id: int,
    request: Request,
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    is_admin = await authorization_verify_based_on_roles(
        request, current_user.id, "update", "org_x", db_session
    )
    if not is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    DB_QUERIES = {"grade_distribution"}

    if query_name not in DB_QUERIES:
        raise HTTPException(status_code=404, detail="Unknown query")

    # All DB queries are Pro+ gated
    current_plan = get_org_plan(org_id, db_session)
    if not plan_meets_requirement(current_plan, "pro"):
        raise HTTPException(
            status_code=403,
            detail="Advanced analytics requires a Pro plan or higher.",
        )

    if query_name == "grade_distribution":
        return _query_grade_distribution(org_id, db_session)

    raise HTTPException(status_code=404, detail="Unknown query")


def _query_grade_distribution(org_id: int, db_session: Session):
    """Grade distribution histogram from PostgreSQL."""
    from sqlmodel import text

    result = db_session.exec(
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
        params={"org_id": org_id},
    )
    rows = result.all()
    return {"data": [{"grade": row[0], "count": row[1]} for row in rows]}


# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------
_SAFE_COURSE_ID = re.compile(r"^[a-zA-Z0-9_]+$")


def _validate_course_id(course_id: str) -> str:
    """Validate course_id is safe for string interpolation into SQL."""
    if not course_id or not _SAFE_COURSE_ID.match(course_id):
        raise HTTPException(status_code=400, detail="Invalid course_id")
    return course_id


# -------------------------------------------------------------------
# GET /dashboard/course/detail/{query_name} — Course-level detail with enrichment
# -------------------------------------------------------------------
@router.get("/dashboard/course/detail/{query_name}")
async def query_course_dashboard_detail(
    query_name: str,
    org_id: int,
    course_id: str,
    request: Request,
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    is_admin = await authorization_verify_based_on_roles(
        request, current_user.id, "update", "org_x", db_session
    )
    if not is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    # Pro plan required for all course analytics
    current_plan = get_org_plan(org_id, db_session)
    if not plan_meets_requirement(current_plan, "pro"):
        raise HTTPException(
            status_code=403,
            detail="Course analytics requires a Pro plan or higher.",
        )

    if query_name not in COURSE_DETAIL_QUERIES:
        raise HTTPException(status_code=404, detail="Unknown course detail query")

    safe_course_id = _validate_course_id(course_id)

    sql_template, default_days = COURSE_DETAIL_QUERIES[query_name]
    safe_org_id, safe_days = _parse_safe_params(org_id, request, default_days)

    sql = sql_template.format(org_id=safe_org_id, days=safe_days, course_id=safe_course_id)

    tb_result = await _execute_tinybird_query(
        query_name, sql, safe_org_id, safe_days,
        course_id=safe_course_id,
        empty_response={"data": [], "users": {}},
    )

    tb_data = tb_result.get("data", [])

    # Enrich with user info from PostgreSQL
    user_ids = list({int(row["user_id"]) for row in tb_data if row.get("user_id")})
    users_map: dict[int, dict] = {}
    if user_ids:
        users = db_session.exec(select(User).where(User.id.in_(user_ids))).all()  # type: ignore
        users_map = {
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

    return {"data": tb_data, "users": users_map}


# -------------------------------------------------------------------
# GET /dashboard/course/{query_name} — Course-level analytics (Pro only)
# -------------------------------------------------------------------
@router.get("/dashboard/course/{query_name}")
async def query_course_dashboard(
    query_name: str,
    org_id: int,
    course_id: str,
    request: Request,
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    is_admin = await authorization_verify_based_on_roles(
        request, current_user.id, "update", "org_x", db_session
    )
    if not is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    # Pro plan required for all course analytics
    current_plan = get_org_plan(org_id, db_session)
    if not plan_meets_requirement(current_plan, "pro"):
        raise HTTPException(
            status_code=403,
            detail="Course analytics requires a Pro plan or higher.",
        )

    if query_name not in COURSE_QUERIES:
        raise HTTPException(status_code=404, detail="Unknown course query")

    safe_course_id = _validate_course_id(course_id)

    sql_template, default_days = COURSE_QUERIES[query_name]
    safe_org_id, safe_days = _parse_safe_params(org_id, request, default_days)

    sql = sql_template.format(org_id=safe_org_id, days=safe_days, course_id=safe_course_id)

    return await _execute_tinybird_query(
        query_name, sql, safe_org_id, safe_days,
        course_id=safe_course_id,
    )


# -------------------------------------------------------------------
# GET /export — Export analytics data as JSON or CSV
# -------------------------------------------------------------------
@router.get("/export")
async def export_analytics(
    org_id: int,
    request: Request,
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    is_admin = await authorization_verify_based_on_roles(
        request, current_user.id, "update", "org_x", db_session
    )
    if not is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    # Parse params
    fmt = request.query_params.get("format", "json")
    if fmt not in ("json", "csv"):
        raise HTTPException(status_code=400, detail="format must be 'json' or 'csv'")

    queries_param = request.query_params.get("queries", "")
    if not queries_param:
        raise HTTPException(status_code=400, detail="queries parameter required")

    query_names = [q.strip() for q in queries_param.split(",") if q.strip()]
    course_id = request.query_params.get("course_id")
    safe_course_id = _validate_course_id(course_id) if course_id else None

    days_param = request.query_params.get("days", "30")
    try:
        safe_org_id = int(org_id)
        safe_days = int(days_param)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid parameter")

    # Determine which query registries to check
    if safe_course_id:
        allowed = {**COURSE_QUERIES, **COURSE_DETAIL_QUERIES}
    else:
        allowed = {**ALL_QUERIES}

    # Execute requested queries
    results: dict[str, dict] = {}
    for qname in query_names:
        if qname not in allowed:
            continue
        sql_template, default_days = allowed[qname]
        d = safe_days if safe_days else default_days
        if safe_course_id:
            sql = sql_template.format(org_id=safe_org_id, days=d, course_id=safe_course_id)
        else:
            sql = sql_template.format(org_id=safe_org_id, days=d)
        result = await _execute_tinybird_query(qname, sql, safe_org_id, d, course_id=safe_course_id)
        results[qname] = result

    if fmt == "json":
        return results

    # CSV format: sections separated by query name headers
    output = io.StringIO()
    for qname, result in results.items():
        rows = result.get("data", [])
        output.write(f"# {qname}\n")
        if rows:
            writer = csv.DictWriter(output, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
        output.write("\n")

    filename = f"analytics_export_{safe_org_id}_{safe_days}d.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# -------------------------------------------------------------------
# GET /plan-info — Returns analytics tier for the org
# -------------------------------------------------------------------
@router.get("/plan-info")
async def get_plan_info(
    org_id: int,
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    current_plan = get_org_plan(org_id, db_session)
    tier = "advanced" if plan_meets_requirement(current_plan, "pro") else "core"
    return PlanInfoResponse(tier=tier, plan=current_plan)
