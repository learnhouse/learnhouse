"""Per-student audit & analytics router.

Org-admin-only endpoints that expose a complete, legally-defensible record of a
student's learning activity (see ``services/audit/dossier.py``). Gated behind the
same advanced-analytics plan requirement as the rest of the analytics surface.

Security: every endpoint verifies the CALLER is an admin of ``org_id`` AND that the
TARGET user is a member of that same org, so an admin can never read a user who
belongs only to another organization.
"""
import csv
import io
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.users import PublicUser, AnonymousUser, APITokenUser
from src.db.user_organizations import UserOrganization
from src.security.auth import get_current_user, resolve_acting_user_id
from src.security.superadmin import is_user_superadmin
from src.security.features_utils.plan_check import get_org_plan
from src.security.features_utils.plans import plan_meets_requirement
from src.services.orgs.users import _csv_safe
from src.services.audit.dossier import build_user_dossier, build_users_summary
from src.services.analytics.queries import USER_QUERIES

# Reuse the battle-tested RBAC + Tinybird helpers from the analytics router
# rather than duplicating them.
from src.routers.analytics import (
    _verify_org_membership,
    _verify_org_admin,
    _get_read_client,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# -------------------------------------------------------------------
# Shared guards
# -------------------------------------------------------------------
async def _require_admin(current_user, org_id: int, db_session: AsyncSession) -> int:
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")
    acting_id = resolve_acting_user_id(current_user)
    await _verify_org_membership(acting_id, org_id, db_session)
    await _verify_org_admin(acting_id, org_id, db_session)
    return acting_id


async def _enforce_plan(org_id: int, db_session: AsyncSession) -> None:
    """Gate the audit feature behind the Pro plan."""
    from src.security.features_utils.plan_check import _check_mode_bypass

    bypass = _check_mode_bypass("analytics_advanced")
    if bypass is None:  # SaaS mode — enforce plan
        current_plan = await get_org_plan(org_id, db_session)
        if not plan_meets_requirement(current_plan, "pro"):
            raise HTTPException(
                status_code=403,
                detail="Student audit & analytics requires a Pro plan or higher.",
            )


async def _org_member_ids(
    user_ids: list[int], org_id: int, db_session: AsyncSession, acting_user_id: int
) -> set[int]:
    """Which of `user_ids` this caller may pull a dossier for.

    Membership is the rule everywhere else. In the shared demo it is not
    enough: every visitor is a member and an admin, so "member of this org"
    includes every stranger who has ever opened the demo — and a dossier is the
    most revealing thing in the product, carrying an email address, login IPs,
    user agents and a cross-organization connection history. Only the seeded
    students, and the caller themselves, are answerable there.
    """
    from src.db.users import User
    from src.services.demo.guards import hide_other_visitors, is_demo_org

    statement = (
        select(UserOrganization.user_id)
        .join(User, User.id == UserOrganization.user_id)
        .where(
            UserOrganization.org_id == org_id,
            UserOrganization.user_id.in_(user_ids),  # type: ignore[attr-defined]
        )
    )
    if await is_demo_org(org_id, db_session):
        statement = hide_other_visitors(statement, acting_user_id)

    return set((await db_session.execute(statement)).scalars().all())


async def _verify_target_in_org(
    user_id: int, org_id: int, db_session: AsyncSession, acting_user_id: int
) -> None:
    """Ensure the TARGET user belongs to this org (no cross-org disclosure)."""
    if await is_user_superadmin(user_id, db_session):
        return
    if not await _org_member_ids([user_id], org_id, db_session, acting_user_id):
        raise HTTPException(status_code=404, detail="User is not a member of this organization")


def _safe_days(request: Request, default: int = 365) -> int:
    raw = request.query_params.get("days")
    if not raw:
        return default
    try:
        d = int(raw)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid days parameter")
    # Clamp to a sane window (behavioral data is retained 12 months).
    return max(1, min(d, 3650))


def _safe_bool(request: Request, key: str) -> bool:
    return request.query_params.get(key, "").strip().lower() in ("1", "true", "yes")


def _parse_user_ids(request: Request) -> list[int]:
    raw = request.query_params.get("user_ids", "")
    ids: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            ids.append(int(part))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid user_ids parameter")
    if not ids:
        raise HTTPException(status_code=400, detail="user_ids parameter required")
    if len(ids) > 500:
        raise HTTPException(status_code=400, detail="Too many users requested (max 500)")
    return ids


# -------------------------------------------------------------------
# Tinybird behavioral enrichment (per-user, uncached)
# -------------------------------------------------------------------
def _build_user_sql(template: str, org_id: int, user_id: int, days: int) -> str:
    # All three are validated ints — safe to interpolate into the Tinybird SQL.
    if not all(isinstance(v, int) for v in (org_id, user_id, days)):
        raise HTTPException(status_code=400, detail="Invalid query parameter types")
    return template.format(org_id=org_id, user_id=user_id, days=days)


async def _make_behavior_fetcher(org_id: int, user_id: int, days: int):
    """Return a coroutine that runs the per-user behavioral queries against
    Tinybird. Bypasses the shared analytics cache (its key excludes user_id, so
    caching per-user results there would leak one student's data to another)."""

    async def fetch(u_id: int, o_id: int, d: int) -> dict:
        client = _get_read_client()
        if client is None:
            return {}  # analytics not configured — dossier still renders from Postgres

        out: dict = {}
        for name, (template, default_days) in USER_QUERIES.items():
            sql = _build_user_sql(template, o_id, u_id, d or default_days)
            try:
                resp = await client.post("/v0/sql", content=sql + " FORMAT JSON")
                resp.raise_for_status()
                out[name] = resp.json().get("data", [])
            except Exception:
                logger.warning("Per-user analytics query '%s' failed for user %s", name, u_id)
                out[name] = []
        return out

    return fetch


# -------------------------------------------------------------------
# GET /audit/user/{user_id} — full dossier
# -------------------------------------------------------------------
@router.get(
    "/user/{user_id}",
    summary="Full per-student audit dossier",
    description=(
        "Returns the complete learning-activity record for one student in one org: "
        "connections, course progress, assignments and grades, code exercises, community "
        "participation, certificates, and behavioral analytics. Assignment answers are "
        "rendered as readable question/answer pairs including the teacher's answer key "
        "(admin-only surface); reference solutions and hidden test-case data are excluded. "
        "Pass include_raw=true to also receive each task's original stored submission "
        "payload — otherwise every task carries only a sha256 answer_digest of it. "
        "Org admin + Pro plan."
    ),
    responses={
        200: {"description": "The student's full audit dossier"},
        401: {"description": "Authentication required"},
        403: {"description": "Caller is not an org admin or the org lacks the plan"},
        404: {"description": "User is not a member of this organization"},
    },
)
async def get_user_dossier(
    user_id: int,
    org_id: int,
    request: Request,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    acting_user_id = await _require_admin(current_user, org_id, db_session)
    await _enforce_plan(org_id, db_session)
    await _verify_target_in_org(user_id, org_id, db_session, acting_user_id)

    days = _safe_days(request)
    fetcher = await _make_behavior_fetcher(org_id, user_id, days)
    dossier = await build_user_dossier(
        db_session, user_id, org_id, days,
        behavior_fetcher=fetcher,
        include_raw=_safe_bool(request, "include_raw"),
    )
    if not dossier:
        raise HTTPException(status_code=404, detail="User not found")
    return dossier


# -------------------------------------------------------------------
# GET /audit/users/summary — summary rows for list + comparison
# -------------------------------------------------------------------
@router.get(
    "/users/summary",
    summary="Per-student audit summary rows",
    description="Lightweight summary (last connection, courses enrolled/completed, certificates) for one or more students — powers the user list and multi-select comparison. Org admin + Pro plan.",
    responses={
        200: {"description": "Summary rows for the requested users"},
        401: {"description": "Authentication required"},
        403: {"description": "Caller is not an org admin or the org lacks the plan"},
    },
)
async def get_users_summary(
    org_id: int,
    request: Request,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    acting_user_id = await _require_admin(current_user, org_id, db_session)
    await _enforce_plan(org_id, db_session)

    user_ids = _parse_user_ids(request)
    # Only include users this caller may see (silently drop the others —
    # never disclose that a given id exists elsewhere).
    members = await _org_member_ids(user_ids, org_id, db_session, acting_user_id)
    scoped_ids = [uid for uid in user_ids if uid in members]

    rows = await build_users_summary(db_session, scoped_ids, org_id)
    return {"data": rows}


# -------------------------------------------------------------------
# GET /audit/export — CSV / JSON export for one or many students
# -------------------------------------------------------------------
_CSV_COLUMNS = [
    "user_id", "username", "email",
    "section", "course", "activity", "item", "type",
    "question", "answer", "expected", "correct",
    "status", "grade", "max_grade", "detail",
    "timestamp", "ip", "device",
]

# Guard against one pathological task blowing up an export; matches the humanizer's
# own per-task cap.
_MAX_ANSWER_ROWS_PER_TASK = 200

_CORRECT_LABELS = {True: "yes", False: "no", None: "n/a"}


def _dossier_to_csv_rows(dossier: dict):
    """Flatten a dossier into normalized CSV rows so one file can hold every
    section for one or many students.

    Assignment answers get two extra sections: one ``assignment_task`` row per task
    and one ``assignment_answer`` row per question or blank, so the spreadsheet
    carries the actual questions and what the student answered — not just a grade.
    """
    user = dossier.get("user", {})
    uid = user.get("id")
    uname = user.get("username")
    email = user.get("email")

    def row(section, **kw):
        base = {c: "" for c in _CSV_COLUMNS}
        base.update({"user_id": uid, "username": uname, "email": email, "section": section})
        base.update(kw)
        # Formula-injection guard. Applies to every field, which now includes
        # free-form learner and teacher text (question/answer/expected) — the most
        # likely injection vector in this file.
        return {k: _csv_safe(v) for k, v in base.items()}

    for c in dossier.get("connections", []):
        yield row("connection", type=c.get("event_label") or c.get("event_type"),
                  timestamp=c.get("at"), ip=c.get("ip"),
                  detail=c.get("method") or "", device=c.get("device") or "")
    for c in dossier.get("courses", []):
        yield row("course", course=c.get("course_name"), status=c.get("status"),
                  grade=c.get("progress_pct"),
                  detail=f"{c.get('activities_completed')}/{c.get('activities_total')} activities",
                  timestamp=c.get("enrolled_at"))
    for a in dossier.get("assignments", []):
        detail = f"attempt {a.get('attempt_number')}"
        if a.get("grade_percentage") is not None:
            detail += f" · {a.get('grade_percentage')}%"
        yield row("assignment", course=a.get("course_name"),
                  activity=a.get("activity_name"), item=a.get("title"),
                  status=a.get("status"), grade=a.get("grade"),
                  max_grade=a.get("max_grade_value"), detail=detail,
                  timestamp=a.get("submitted_at"))
        for task in a.get("tasks", []):
            answer = task.get("answer") or {}
            yield row("assignment_task", course=a.get("course_name"),
                      item=a.get("title"), type=task.get("type_label"),
                      question=task.get("title"), answer=answer.get("summary"),
                      status=("submitted" if task.get("submitted") else "not submitted"),
                      grade=task.get("grade"), max_grade=task.get("max_grade"),
                      detail=task.get("feedback"), timestamp=task.get("submitted_at"))
            for item in (answer.get("items") or [])[:_MAX_ANSWER_ROWS_PER_TASK]:
                yield row("assignment_answer", course=a.get("course_name"),
                          item=a.get("title"), type=task.get("type_label"),
                          question=item.get("prompt"), answer=item.get("answer_text"),
                          expected=item.get("expected_text"),
                          correct=_CORRECT_LABELS.get(item.get("correct"), "n/a"))
    for cs in dossier.get("code_submissions", []):
        yield row("code", course=cs.get("course_name"),
                  activity=cs.get("activity_name") or cs.get("activity_uuid"),
                  type=cs.get("language"),
                  status=("passed" if cs.get("passed") else "failed"),
                  detail=f"{cs.get('passed_tests')}/{cs.get('total_tests')} tests",
                  timestamp=cs.get("created_at"))
    for d in dossier.get("community", {}).get("discussions", []):
        yield row("discussion", course=d.get("community_name"), item=d.get("title"),
                  detail=d.get("excerpt"), timestamp=d.get("created_at"))
    for cm in dossier.get("community", {}).get("comments", []):
        yield row("comment", course=cm.get("community_name"),
                  item=cm.get("discussion_title"), answer=cm.get("content"),
                  timestamp=cm.get("created_at"))
    for cert in dossier.get("certificates", []):
        yield row("certificate", course=cert.get("course_name"),
                  item=cert.get("course_name"),
                  detail=f"Credential ID {cert.get('credential_id')}",
                  timestamp=cert.get("created_at"))
    behavior = dossier.get("behavior") or {}
    for b in (behavior.get("user_time_by_course") or []):
        yield row("behavior_course", course=b.get("course_name") or b.get("course_uuid"),
                  detail=f"{b.get('total_seconds')}s")
    for s in (behavior.get("user_searches") or []):
        yield row("behavior_search", question=s.get("query"), detail=s.get("count"))


@router.get(
    "/export",
    summary="Export per-student audit data",
    description=(
        "Exports the full audit dossier for one or more students as CSV or JSON. "
        "The CSV carries one row per item plus, for assignments, an assignment_task row "
        "per task and an assignment_answer row per question or blank with the question "
        "text, the student's answer, the expected answer and a correct flag. "
        "Pass include_raw=true to also embed the original stored submission payloads. "
        "Org admin + Pro plan. (PDF is rendered client-side from the JSON.)"
    ),
    responses={
        200: {"description": "Audit data as JSON or streaming CSV"},
        400: {"description": "Invalid parameters"},
        401: {"description": "Authentication required"},
        403: {"description": "Caller is not an org admin or the org lacks the plan"},
    },
)
async def export_audit(
    org_id: int,
    request: Request,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    acting_user_id = await _require_admin(current_user, org_id, db_session)
    await _enforce_plan(org_id, db_session)

    fmt = request.query_params.get("format", "json")
    if fmt not in ("json", "csv"):
        raise HTTPException(status_code=400, detail="format must be 'json' or 'csv'")

    user_ids = _parse_user_ids(request)
    members = await _org_member_ids(user_ids, org_id, db_session, acting_user_id)
    scoped_ids = [uid for uid in user_ids if uid in members]
    if not scoped_ids:
        raise HTTPException(status_code=404, detail="No requested users belong to this organization")

    days = _safe_days(request)
    include_raw = _safe_bool(request, "include_raw")

    # Build each dossier (behavioral enrichment included).
    dossiers = []
    for uid in scoped_ids:
        fetcher = await _make_behavior_fetcher(org_id, uid, days)
        d = await build_user_dossier(
            db_session, uid, org_id, days,
            behavior_fetcher=fetcher, include_raw=include_raw,
        )
        if d:
            dossiers.append(d)

    if fmt == "json":
        return {"data": dossiers}

    # CSV — stream normalized rows across all requested students.
    def generate():
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=_CSV_COLUMNS)
        writer.writeheader()
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)
        for dossier in dossiers:
            for csv_row in _dossier_to_csv_rows(dossier):
                writer.writerow(csv_row)
                yield buffer.getvalue()
                buffer.seek(0)
                buffer.truncate(0)

    filename = (
        f"audit-user-{scoped_ids[0]}.csv" if len(scoped_ids) == 1
        else f"audit-{len(scoped_ids)}-users.csv"
    )
    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
