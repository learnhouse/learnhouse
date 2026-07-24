"""Per-student audit dossier builder.

Assembles a complete, legally-defensible record of ONE student's learning activity
inside ONE organization, by unioning three sources:

  1. Durable Postgres records (the authoritative source of truth): enrollment /
     progress (Trail), assignment submissions and grades, code exercises, community
     participation, certificates.
  2. The append-only ``user_audit_event`` log (connections + a permanent event
     timeline that survives live-table overwrites such as assignment retries).
  3. Tinybird behavioral enrichment (time-on-activity, views, searches) — best-effort;
     degrades gracefully to empty when analytics is not configured.

Everything is org-scoped so an org admin can never see another org's data through a
shared user. Read-only: this module never writes.
"""
import logging
from typing import Awaitable, Callable, Optional

from sqlmodel import select, func
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.users import User
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.roles import Role
from src.db.user_audit_events import UserAuditEvent, UserAuditEventType
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.courses.courses import Course
from src.db.courses.activities import Activity
from src.db.courses.assignments import (
    Assignment,
    AssignmentUserSubmission,
    AssignmentTaskSubmission,
)
from src.db.code_submissions import CodeSubmission
from src.db.courses.certifications import CertificateUser, Certifications
from src.db.communities.discussions import Discussion
from src.db.communities.discussion_comments import DiscussionComment

logger = logging.getLogger(__name__)

# Type of the Tinybird executor injected by the router: (user_id, org_id, days) ->
# a dict of behavioral sections. Kept as a callable so this service has no HTTP
# dependency and stays unit-testable.
BehaviorFetcher = Callable[[int, int, int], Awaitable[dict]]


async def _identity(db_session: AsyncSession, user_id: int, org_id: int) -> dict:
    user = (await db_session.execute(select(User).where(User.id == user_id))).scalars().first()
    if not user:
        return {}

    membership = (await db_session.execute(
        select(UserOrganization).where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == org_id,
        )
    )).scalars().first()

    role_name = None
    joined_at = None
    if membership:
        joined_at = membership.creation_date
        role = (await db_session.execute(
            select(Role).where(Role.id == membership.role_id)
        )).scalars().first()
        role_name = role.name if role else None

    groups = (await db_session.execute(
        select(UserGroup.name)
        .join(UserGroupUser, UserGroupUser.usergroup_id == UserGroup.id)
        .where(UserGroupUser.user_id == user_id, UserGroupUser.org_id == org_id)
    )).scalars().all()

    return {
        "user": {
            "id": user.id,
            "user_uuid": user.user_uuid,
            "username": user.username,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "email": user.email,
            "avatar_image": user.avatar_image,
            "bio": user.bio,
        },
        "membership": {
            "role": role_name,
            "groups": list(groups),
            "joined_at": joined_at,
        },
        "security": {
            "email_verified": user.email_verified,
            "email_verified_at": user.email_verified_at,
            "signup_method": user.signup_method,
            "last_login_at": user.last_login_at,
            "last_login_ip": user.last_login_ip,
            "failed_login_attempts": user.failed_login_attempts,
            "locked_until": user.locked_until,
            "password_changed_at": (
                user.password_changed_at.isoformat()
                if user.password_changed_at else None
            ),
        },
    }


async def _connections_and_timeline(
    db_session: AsyncSession, user_id: int, org_id: int
) -> tuple[list[dict], list[dict]]:
    """Return (connections, full_event_timeline) from the durable audit log.

    Connections (login/logout) are org-agnostic, so they are matched on user_id
    regardless of org. Activity events are filtered to this org (or org-agnostic).
    """
    rows = (await db_session.execute(
        select(UserAuditEvent)
        .where(
            UserAuditEvent.user_id == user_id,
            (UserAuditEvent.org_id == org_id) | (UserAuditEvent.org_id.is_(None)),  # type: ignore[union-attr]
        )
        .order_by(UserAuditEvent.created_at.desc())  # type: ignore[union-attr]
    )).scalars().all()

    connection_types = {UserAuditEventType.LOGIN, UserAuditEventType.LOGOUT}
    connections = []
    timeline = []
    for r in rows:
        entry = {
            "event_type": r.event_type,
            "at": r.created_at.isoformat() if r.created_at else None,
            "ip": r.ip,
            "user_agent": r.user_agent,
            "target_uuid": r.target_uuid,
            "metadata": r.audit_metadata or {},
        }
        timeline.append(entry)
        if r.event_type in connection_types:
            connections.append(entry)
    return connections, timeline


async def _course_progress(db_session: AsyncSession, user_id: int, org_id: int) -> list[dict]:
    runs = (await db_session.execute(
        select(TrailRun).where(
            TrailRun.user_id == user_id, TrailRun.org_id == org_id
        )
    )).scalars().all()
    if not runs:
        return []

    course_ids = [r.course_id for r in runs]
    courses = {
        c.id: c for c in (await db_session.execute(
            select(Course).where(Course.id.in_(course_ids))  # type: ignore[attr-defined]
        )).scalars().all()
    }

    # Total activities per course (one grouped query).
    total_by_course = dict((await db_session.execute(
        select(Activity.course_id, func.count(Activity.id))
        .where(Activity.course_id.in_(course_ids))  # type: ignore[attr-defined]
        .group_by(Activity.course_id)
    )).all())

    # Completed steps per course for this user (one grouped query).
    completed_by_course = dict((await db_session.execute(
        select(TrailStep.course_id, func.count(TrailStep.id))
        .where(
            TrailStep.user_id == user_id,
            TrailStep.course_id.in_(course_ids),  # type: ignore[attr-defined]
            TrailStep.complete == True,  # noqa: E712
        )
        .group_by(TrailStep.course_id)
    )).all())

    result = []
    for r in runs:
        course = courses.get(r.course_id)
        total = int(total_by_course.get(r.course_id, 0) or 0)
        done = int(completed_by_course.get(r.course_id, 0) or 0)
        pct = round(done / total * 100, 1) if total else 0.0
        result.append({
            "course_uuid": course.course_uuid if course else None,
            "course_name": course.name if course else None,
            "status": r.status.value if hasattr(r.status, "value") else str(r.status),
            "enrolled_at": r.creation_date,
            "updated_at": r.update_date,
            "activities_completed": done,
            "activities_total": total,
            "progress_pct": pct,
        })
    return result


async def _assignments(db_session: AsyncSession, user_id: int, org_id: int) -> list[dict]:
    subs = (await db_session.execute(
        select(AssignmentUserSubmission, Assignment)
        .join(Assignment, Assignment.id == AssignmentUserSubmission.assignment_id)
        .where(
            AssignmentUserSubmission.user_id == user_id,
            Assignment.org_id == org_id,
        )
    )).all()
    if not subs:
        return []

    # Per-task answers for this user, grouped by assignment (task -> assignment).
    task_rows = (await db_session.execute(
        select(AssignmentTaskSubmission)
        .where(AssignmentTaskSubmission.user_id == user_id)
    )).scalars().all()
    tasks_by_assignment: dict[tuple[int, int], list] = {}
    # AssignmentTaskSubmission has no assignment_id column, but each assignment
    # maps to exactly one activity, so (course_id, activity_id) uniquely keys a
    # submission's parent assignment.
    for t in task_rows:
        tasks_by_assignment.setdefault((t.course_id, t.activity_id), []).append({
            "task_submission_uuid": t.assignment_task_submission_uuid,
            "assignment_type": t.assignment_type.value if hasattr(t.assignment_type, "value") else str(t.assignment_type),
            "grade": t.grade,
            "feedback": t.task_submission_grade_feedback,
            "manually_graded": t.manually_graded,
            "answer": t.task_submission,
            "submitted_at": t.creation_date,
        })

    result = []
    for sub, assignment in subs:
        result.append({
            "assignment_uuid": assignment.assignment_uuid,
            "title": assignment.title,
            "course_id": assignment.course_id,
            "status": sub.submission_status.value if hasattr(sub.submission_status, "value") else str(sub.submission_status),
            "grade": sub.grade,
            # No single max lives on Assignment (it is the sum of per-task
            # max_grade_value); the UI falls back to 100 when absent.
            "overall_feedback": sub.overall_feedback,
            "attempt_number": sub.attempt_number,
            "submitted_at": sub.creation_date,
            "graded_at": sub.update_date,
            "tasks": tasks_by_assignment.get((assignment.course_id, assignment.activity_id), []),
        })
    return result


async def _code_submissions(db_session: AsyncSession, user_id: int, org_id: int) -> list[dict]:
    # CodeSubmission carries activity_uuid (not org_id); scope to this org by
    # keeping only submissions whose activity belongs to the org.
    org_activity_uuids = set((await db_session.execute(
        select(Activity.activity_uuid).where(Activity.org_id == org_id)
    )).scalars().all())
    if not org_activity_uuids:
        return []

    rows = (await db_session.execute(
        select(CodeSubmission)
        .where(CodeSubmission.user_id == user_id)
        .order_by(CodeSubmission.created_at.desc())  # type: ignore[union-attr]
    )).scalars().all()

    return [{
        "submission_uuid": r.submission_uuid,
        "activity_uuid": r.activity_uuid,
        "language_id": r.language_id,
        "passed": r.passed,
        "passed_tests": r.passed_tests,
        "total_tests": r.total_tests,
        "execution_time_ms": r.execution_time_ms,
        "created_at": r.created_at,
    } for r in rows if r.activity_uuid in org_activity_uuids]


async def _community(db_session: AsyncSession, user_id: int, org_id: int) -> dict:
    discussions = (await db_session.execute(
        select(Discussion).where(
            Discussion.author_id == user_id, Discussion.org_id == org_id
        ).order_by(Discussion.creation_date.desc())  # type: ignore[union-attr]
    )).scalars().all()

    # Comments have no org column — scope via the parent discussion's org.
    org_discussion_ids = set((await db_session.execute(
        select(Discussion.id).where(Discussion.org_id == org_id)
    )).scalars().all())
    comment_rows = (await db_session.execute(
        select(DiscussionComment).where(DiscussionComment.author_id == user_id)
    )).scalars().all()
    comments = [{
        "comment_uuid": c.comment_uuid,
        "discussion_id": c.discussion_id,
        "content": c.content,
        "upvote_count": c.upvote_count,
        "created_at": c.creation_date,
    } for c in comment_rows if c.discussion_id in org_discussion_ids]

    return {
        "discussions": [{
            "discussion_uuid": d.discussion_uuid,
            "title": d.title,
            "label": d.label,
            "upvote_count": d.upvote_count,
            "created_at": d.creation_date,
        } for d in discussions],
        "comments": comments,
        "discussions_count": len(discussions),
        "comments_count": len(comments),
    }


async def _certificates(db_session: AsyncSession, user_id: int, org_id: int) -> list[dict]:
    rows = (await db_session.execute(
        select(CertificateUser, Certifications, Course)
        .join(Certifications, Certifications.id == CertificateUser.certification_id)
        .join(Course, Course.id == Certifications.course_id)
        .where(CertificateUser.user_id == user_id, Course.org_id == org_id)
    )).all()
    return [{
        "user_certification_uuid": cu.user_certification_uuid,
        "course_uuid": course.course_uuid,
        "course_name": course.name,
        "created_at": cu.created_at,
    } for cu, _cert, course in rows]


def _coverage_notes() -> list[str]:
    return [
        "Connection history begins when the audit log was enabled; logins before "
        "that are reflected only by the account's last-login fields.",
        "Assignment retries reset the live submission in place — earlier attempts "
        "are preserved in the durable event timeline, not the current submission row.",
        "AI editor chat is ephemeral and is not recorded.",
        "Behavioral metrics (time spent, views, searches) come from the analytics "
        "pipeline and cover the last 12 months.",
    ]


async def build_user_dossier(
    db_session: AsyncSession,
    user_id: int,
    org_id: int,
    days: int = 365,
    behavior_fetcher: Optional[BehaviorFetcher] = None,
) -> dict:
    """Assemble the full per-student dossier. ``behavior_fetcher`` is optional so
    the durable Postgres dossier still renders when analytics is unconfigured."""
    identity = await _identity(db_session, user_id, org_id)
    if not identity:
        return {}

    connections, timeline = await _connections_and_timeline(db_session, user_id, org_id)
    courses = await _course_progress(db_session, user_id, org_id)
    assignments = await _assignments(db_session, user_id, org_id)
    code_submissions = await _code_submissions(db_session, user_id, org_id)
    community = await _community(db_session, user_id, org_id)
    certificates = await _certificates(db_session, user_id, org_id)

    behavior: dict = {}
    if behavior_fetcher is not None:
        try:
            behavior = await behavior_fetcher(user_id, org_id, days)
        except Exception:
            logger.warning("Behavioral enrichment failed for user %s", user_id, exc_info=True)
            behavior = {}

    graded = [a for a in assignments if a.get("grade") is not None and a.get("status") == "GRADED"]
    avg_grade = round(sum(a["grade"] for a in graded) / len(graded), 1) if graded else None

    return {
        **identity,
        "connections": connections,
        "timeline": timeline,
        "courses": courses,
        "assignments": assignments,
        "code_submissions": code_submissions,
        "community": community,
        "certificates": certificates,
        "behavior": behavior,
        "summary": {
            "courses_enrolled": len(courses),
            "courses_completed": sum(1 for c in courses if c["status"] == "STATUS_COMPLETED"),
            "avg_progress_pct": round(sum(c["progress_pct"] for c in courses) / len(courses), 1) if courses else 0.0,
            "assignments_submitted": len(assignments),
            "avg_grade": avg_grade,
            "certificates_earned": len(certificates),
            "code_submissions": len(code_submissions),
            "discussions": community["discussions_count"],
            "comments": community["comments_count"],
            "connections": len(connections),
            "last_connection": connections[0]["at"] if connections else identity["security"]["last_login_at"],
        },
        "coverage_notes": _coverage_notes(),
    }


async def build_users_summary(
    db_session: AsyncSession,
    user_ids: list[int],
    org_id: int,
) -> list[dict]:
    """Lightweight per-user summary rows for the list + multi-select comparison.

    Avoids building the full dossier for each user — computes just the headline
    numbers with a few grouped queries.
    """
    if not user_ids:
        return []

    users = {
        u.id: u for u in (await db_session.execute(
            select(User).where(User.id.in_(user_ids))  # type: ignore[attr-defined]
        )).scalars().all()
    }

    # Enrollments + completions per user (grouped).
    enroll_rows = (await db_session.execute(
        select(TrailRun.user_id, TrailRun.status, func.count(TrailRun.id))
        .where(TrailRun.user_id.in_(user_ids), TrailRun.org_id == org_id)  # type: ignore[attr-defined]
        .group_by(TrailRun.user_id, TrailRun.status)
    )).all()
    enrolled: dict[int, int] = {}
    completed: dict[int, int] = {}
    for uid, status_val, cnt in enroll_rows:
        enrolled[uid] = enrolled.get(uid, 0) + int(cnt)
        sv = status_val.value if hasattr(status_val, "value") else str(status_val)
        if sv == "STATUS_COMPLETED":
            completed[uid] = completed.get(uid, 0) + int(cnt)

    # Certificates per user (grouped, org-scoped through the course).
    cert_rows = (await db_session.execute(
        select(CertificateUser.user_id, func.count(CertificateUser.id))
        .join(Certifications, Certifications.id == CertificateUser.certification_id)
        .join(Course, Course.id == Certifications.course_id)
        .where(CertificateUser.user_id.in_(user_ids), Course.org_id == org_id)  # type: ignore[attr-defined]
        .group_by(CertificateUser.user_id)
    )).all()
    certs = {uid: int(cnt) for uid, cnt in cert_rows}

    # Last connection per user (from the durable audit log).
    conn_rows = (await db_session.execute(
        select(UserAuditEvent.user_id, func.max(UserAuditEvent.created_at))
        .where(
            UserAuditEvent.user_id.in_(user_ids),  # type: ignore[attr-defined]
            UserAuditEvent.event_type == UserAuditEventType.LOGIN,
        )
        .group_by(UserAuditEvent.user_id)
    )).all()
    last_conn = {uid: (ts.isoformat() if ts else None) for uid, ts in conn_rows}

    result = []
    for uid in user_ids:
        u = users.get(uid)
        if not u:
            continue
        result.append({
            "user": {
                "id": u.id,
                "user_uuid": u.user_uuid,
                "username": u.username,
                "first_name": u.first_name,
                "last_name": u.last_name,
                "email": u.email,
                "avatar_image": u.avatar_image,
            },
            "courses_enrolled": enrolled.get(uid, 0),
            "courses_completed": completed.get(uid, 0),
            "certificates_earned": certs.get(uid, 0),
            "last_connection": last_conn.get(uid) or u.last_login_at,
        })
    return result
