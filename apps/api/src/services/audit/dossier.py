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
import re
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
    AssignmentTask,
    AssignmentUserSubmission,
    AssignmentTaskSubmission,
)
from src.db.code_submissions import CodeSubmission
from src.db.courses.certifications import CertificateUser, Certifications
from src.db.communities.communities import Community
from src.db.communities.discussions import Discussion
from src.db.communities.discussion_comments import DiscussionComment
from src.services.analytics.enrichment import enrich_with_metadata
from src.services.audit.answers import (
    answer_digest,
    humanize_task_answer,
    judge0_language_name,
    task_type_label,
)
from src.services.courses.activities.assignments import compute_assignment_grade

logger = logging.getLogger(__name__)

# Type of the Tinybird executor injected by the router: (user_id, org_id, days) ->
# a dict of behavioral sections. Kept as a callable so this service has no HTTP
# dependency and stays unit-testable.
BehaviorFetcher = Callable[[int, int, int], Awaitable[dict]]

# Raw event enum values are what the log stores; these are what a human reads.
# Emitted server-side (rather than translated in the UI) because the same string has
# to appear identically in the dossier, the CSV and the PDF.
_EVENT_LABELS = {
    UserAuditEventType.LOGIN: "Signed in",
    UserAuditEventType.LOGOUT: "Signed out",
    UserAuditEventType.COURSE_ENROLLED: "Enrolled in a course",
    UserAuditEventType.ACTIVITY_COMPLETED: "Completed an activity",
    UserAuditEventType.COURSE_COMPLETED: "Completed a course",
    UserAuditEventType.ASSIGNMENT_SUBMITTED: "Submitted an assignment",
    UserAuditEventType.ASSIGNMENT_GRADED: "Assignment graded",
    UserAuditEventType.CERTIFICATE_CLAIMED: "Claimed a certificate",
}

_VIEW_LABELS = {
    "page_view": "Page views",
    "course_view": "Course views",
    "activity_view": "Activity views",
}

# Order matters: Edge and Opera both advertise themselves as Chrome, and every
# browser claims to be Safari. Same ladder the account-security session list uses.
_BROWSER_PATTERNS = (
    ("Edg/", "Edge"),
    ("OPR/", "Opera"),
    ("Opera", "Opera"),
    ("Chrome/", "Chrome"),
    ("Firefox/", "Firefox"),
    ("Safari/", "Safari"),
)
_OS_PATTERNS = (
    (r"Windows NT", "Windows"),
    (r"Mac OS X|Macintosh", "macOS"),
    (r"Android", "Android"),
    (r"iPhone|iPad|iPod", "iOS"),
    (r"Linux", "Linux"),
)


def _parse_user_agent(user_agent: Optional[str]) -> dict:
    """Reduce a user-agent string to ``{browser, os, device}``.

    The raw string stays on the record for forensics; this is what gets shown, so an
    admin scanning a login history reads "Chrome on macOS" instead of 140 characters
    of version tokens.
    """
    if not user_agent:
        return {"browser": None, "os": None, "device": None}

    browser = next(
        (name for token, name in _BROWSER_PATTERNS if token in user_agent), None
    )
    os_name = next(
        (name for pattern, name in _OS_PATTERNS if re.search(pattern, user_agent)), None
    )

    if browser and os_name:
        device = f"{browser} on {os_name}"
    else:
        device = browser or os_name
    return {"browser": browser, "os": os_name, "device": device}


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
        metadata = r.audit_metadata or {}
        agent = _parse_user_agent(r.user_agent)
        entry = {
            "event_type": r.event_type,
            "event_label": _EVENT_LABELS.get(
                r.event_type, str(r.event_type or "").replace("_", " ").capitalize()
            ),
            "at": r.created_at.isoformat() if r.created_at else None,
            "ip": r.ip,
            "user_agent": r.user_agent,
            "browser": agent["browser"],
            "os": agent["os"],
            "device": agent["device"],
            # Hoisted so exports don't have to reach into a nested dict.
            "method": metadata.get("method"),
            "target_uuid": r.target_uuid,
            "metadata": metadata,
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
            "course_id": r.course_id,
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


def _task_row(index: int, task, ts, include_raw: bool) -> dict:
    """One task of an assignment, with the learner's answer rendered readably.

    Field names mirror ``_build_tasks_breakdown`` in the assignments service so the
    dossier and the teacher's evaluate modal describe the same task the same way.
    """
    max_grade = int(task.max_grade_value or 0) if task is not None else None
    grade = int(ts.grade or 0) if ts else None
    assignment_type = (
        task.assignment_type if task is not None else (ts.assignment_type if ts else None)
    )
    title = task.title if task is not None else None

    row = {
        "index": index,
        "assignment_task_uuid": (
            task.assignment_task_uuid if task is not None else None
        ),
        "title": title,
        "description": task.description if task is not None else None,
        "type": (
            assignment_type.value
            if hasattr(assignment_type, "value")
            else str(assignment_type or "OTHER")
        ),
        "type_label": task_type_label(assignment_type),
        "submitted": ts is not None,
        "grade": grade,
        "max_grade": max_grade,
        "points_summary": (
            f"{grade}/{max_grade}" if ts is not None and max_grade else None
        ),
        "percentage": (
            round(grade / max_grade * 100, 2)
            if ts is not None and max_grade
            else None
        ),
        "feedback": ts.task_submission_grade_feedback if ts else None,
        "manually_graded": bool(ts.manually_graded) if ts else False,
        "submitted_at": ts.creation_date if ts else None,
        "task_submission_uuid": (
            ts.assignment_task_submission_uuid if ts else None
        ),
        "answer": (
            humanize_task_answer(
                assignment_type,
                task.contents if task is not None else None,
                ts.task_submission,
                fallback_prompt=title or "",
            )
            if ts
            else None
        ),
        "answer_digest": answer_digest(ts.task_submission) if ts else None,
    }
    if include_raw and ts is not None:
        row["raw_answer"] = ts.task_submission
    return row


async def _assignments(
    db_session: AsyncSession,
    user_id: int,
    org_id: int,
    include_raw: bool = False,
) -> list[dict]:
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

    assignment_ids = [a.id for _sub, a in subs]

    # The task definitions carry the question bank (contents), the per-task max and
    # the title — none of which live on the submission — so the readable answer is a
    # join against these rows.
    tasks = (await db_session.execute(
        select(AssignmentTask)
        .where(
            AssignmentTask.assignment_id.in_(assignment_ids),  # type: ignore[attr-defined]
            AssignmentTask.org_id == org_id,
        )
        .order_by(AssignmentTask.id)  # type: ignore[arg-type]
    )).scalars().all()
    tasks_by_assignment: dict[int, list] = {}
    for t in tasks:
        tasks_by_assignment.setdefault(t.assignment_id, []).append(t)

    # Keyed on assignment_task_id — the actual foreign key. The previous version
    # grouped by (course_id, activity_id) because AssignmentTaskSubmission has no
    # assignment_id, but nothing constrains assignment.activity_id to be unique, so
    # two assignments on one activity swapped each other's tasks. That query was also
    # scoped only by user_id, pulling every org's submissions into memory.
    task_ids = [t.id for t in tasks]
    sub_by_task_id: dict[int, AssignmentTaskSubmission] = {}
    if task_ids:
        for ts in (await db_session.execute(
            select(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.user_id == user_id,
                AssignmentTaskSubmission.assignment_task_id.in_(task_ids),  # type: ignore[attr-defined]
            )
        )).scalars().all():
            sub_by_task_id[ts.assignment_task_id] = ts

    # A deleted task leaves its submissions behind. Keep them visible — an audit
    # record shouldn't silently lose answers — but only when the task row is *really*
    # gone. Matching on activity_id alone would readmit the cross-org collision this
    # rewrite exists to close, since activity ids are global and an activity can carry
    # more than one assignment.
    activity_ids = {a.activity_id for _sub, a in subs if a.activity_id}
    course_ids = {a.course_id for _sub, a in subs if a.course_id}
    orphans_by_activity: dict[int, list] = {}
    if activity_ids and course_ids:
        candidates = (await db_session.execute(
            select(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.user_id == user_id,
                AssignmentTaskSubmission.activity_id.in_(activity_ids),  # type: ignore[attr-defined]
                AssignmentTaskSubmission.course_id.in_(course_ids),  # type: ignore[attr-defined]
            )
        )).scalars().all()
        candidates = [c for c in candidates if c.assignment_task_id not in sub_by_task_id]
        if candidates:
            surviving = set((await db_session.execute(
                select(AssignmentTask.id).where(
                    AssignmentTask.id.in_([c.assignment_task_id for c in candidates])  # type: ignore[attr-defined]
                )
            )).scalars().all())
            for ts in candidates:
                if ts.assignment_task_id not in surviving:
                    orphans_by_activity.setdefault(ts.activity_id, []).append(ts)

    # Resolve the course + activity a submission belongs to, so no tab has to show a
    # bare uuid.
    courses = {
        c.id: c for c in (await db_session.execute(
            select(Course).where(Course.id.in_(course_ids))  # type: ignore[attr-defined]
        )).scalars().all()
    } if course_ids else {}
    activities = {
        a.id: a for a in (await db_session.execute(
            select(Activity).where(Activity.id.in_(activity_ids))  # type: ignore[attr-defined]
        )).scalars().all()
    } if activity_ids else {}

    result = []
    for sub, assignment in subs:
        assignment_tasks = tasks_by_assignment.get(assignment.id, [])
        task_rows = [
            _task_row(i + 1, task, sub_by_task_id.get(task.id), include_raw)
            for i, task in enumerate(assignment_tasks)
        ]
        for orphan in orphans_by_activity.get(assignment.activity_id, []):
            task_rows.append(
                _task_row(len(task_rows) + 1, None, orphan, include_raw)
            )

        # The assignment max is the sum of its tasks' maxima — it is not stored
        # anywhere, which is why the UI used to hardcode "/100".
        max_grade = sum(int(t.max_grade_value or 0) for t in assignment_tasks)
        # Reuse the canonical formatter so an ALPHABET-graded assignment reads "B"
        # here exactly as it does in the learner's own view.
        computed = compute_assignment_grade(
            sub.grade or 0,
            max_grade,
            assignment.grading_type,
            sub.overall_feedback,
            assignment.pass_threshold_percentage,
        )
        course = courses.get(assignment.course_id)
        activity = activities.get(assignment.activity_id)

        result.append({
            "assignment_uuid": assignment.assignment_uuid,
            "title": assignment.title,
            "description": assignment.description,
            "due_date": assignment.due_date,
            "course_id": assignment.course_id,
            "course_uuid": course.course_uuid if course else None,
            "course_name": course.name if course else None,
            "activity_uuid": activity.activity_uuid if activity else None,
            "activity_name": activity.name if activity else None,
            "status": sub.submission_status.value if hasattr(sub.submission_status, "value") else str(sub.submission_status),
            "grade": sub.grade,
            "max_grade_value": max_grade or None,
            "grading_type": (
                assignment.grading_type.value
                if hasattr(assignment.grading_type, "value")
                else str(assignment.grading_type or "NUMERIC")
            ),
            "grade_display": computed["display_grade"] if max_grade else None,
            "grade_percentage": computed["percentage"] if max_grade else None,
            "points_summary": computed["points_summary"] if max_grade else None,
            "passed": computed["passed"] if max_grade else None,
            "overall_feedback": sub.overall_feedback,
            "attempt_number": sub.attempt_number,
            "submitted_at": sub.creation_date,
            "graded_at": sub.update_date,
            "tasks_total": len(task_rows),
            "tasks_submitted": sum(1 for t in task_rows if t["submitted"]),
            "tasks": task_rows,
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

    result = [{
        "submission_uuid": r.submission_uuid,
        "activity_uuid": r.activity_uuid,
        "language_id": r.language_id,
        "language": judge0_language_name(r.language_id),
        "passed": r.passed,
        "result_label": "Passed" if r.passed else "Failed",
        "passed_tests": r.passed_tests,
        "total_tests": r.total_tests,
        "tests_summary": f"{r.passed_tests}/{r.total_tests}",
        "execution_time_ms": r.execution_time_ms,
        "created_at": r.created_at,
    } for r in rows if r.activity_uuid in org_activity_uuids]

    # Adds activity_name + course_uuid/course_name in batch, so the Code tab shows
    # "Recursion exercise" rather than the activity uuid it used to print.
    return await enrich_with_metadata(result, db_session)


async def _community(db_session: AsyncSession, user_id: int, org_id: int) -> dict:
    discussions = (await db_session.execute(
        select(Discussion).where(
            Discussion.author_id == user_id, Discussion.org_id == org_id
        ).order_by(Discussion.creation_date.desc())  # type: ignore[union-attr]
    )).scalars().all()

    # Comments have no org column — scope via the parent discussion's org.
    org_discussions = {
        d.id: d for d in (await db_session.execute(
            select(Discussion).where(Discussion.org_id == org_id)
        )).scalars().all()
    }
    comment_rows = (await db_session.execute(
        select(DiscussionComment).where(DiscussionComment.author_id == user_id)
    )).scalars().all()

    community_names = {
        c.id: c.name for c in (await db_session.execute(
            select(Community).where(Community.org_id == org_id)
        )).scalars().all()
    }

    def _excerpt(text: Optional[str], limit: int = 240) -> Optional[str]:
        if not text:
            return None
        flat = " ".join(str(text).split())
        return flat if len(flat) <= limit else flat[:limit] + "…"

    # A comment on its own is context-free ("Yes, exactly!"). Carrying the parent
    # discussion's title is what makes it readable in an export.
    comments = []
    for c in comment_rows:
        parent = org_discussions.get(c.discussion_id)
        if parent is None:
            continue
        comments.append({
            "comment_uuid": c.comment_uuid,
            "discussion_id": c.discussion_id,
            "discussion_uuid": parent.discussion_uuid,
            "discussion_title": parent.title,
            "community_name": community_names.get(parent.community_id),
            "content": c.content,
            "excerpt": _excerpt(c.content),
            "upvote_count": c.upvote_count,
            "created_at": c.creation_date,
        })

    return {
        "discussions": [{
            "discussion_uuid": d.discussion_uuid,
            "title": d.title,
            "label": d.label,
            "community_name": community_names.get(d.community_id),
            "excerpt": _excerpt(d.content),
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
        # Same value under a name that says what it is, so the UI and the exports can
        # label it instead of printing a bare uuid next to the course name.
        "credential_id": cu.user_certification_uuid,
        "course_uuid": course.course_uuid,
        "course_name": course.name,
        "created_at": cu.created_at,
        "issued_at": cu.created_at,
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
        "Assignment answers include the teacher's answer key, so this report is for "
        "internal use only. Reference solutions and hidden test-case data are excluded.",
        "Answers are shown as rendered text; each carries a sha256 digest of the "
        "stored submission. Add include_raw=true to retrieve the original payloads.",
    ]


async def _enrich_behavior(behavior: dict, db_session: AsyncSession) -> dict:
    """Resolve identifiers in the Tinybird sections and label the event names.

    Best-effort, like the fetch itself: analytics enrichment failing should degrade
    to unenriched rows, never break the durable Postgres dossier around it.
    """
    if not behavior:
        return behavior
    try:
        by_course = behavior.get("user_time_by_course")
        if isinstance(by_course, list):
            behavior["user_time_by_course"] = await enrich_with_metadata(
                [r for r in by_course if isinstance(r, dict)], db_session
            )
        views = behavior.get("user_views")
        if isinstance(views, list):
            for row in views:
                if isinstance(row, dict):
                    name = row.get("event_name")
                    row["label"] = _VIEW_LABELS.get(
                        name, str(name or "").replace("_", " ").capitalize()
                    )
    except Exception:
        logger.warning("Behavioral enrichment failed", exc_info=True)
    return behavior


async def build_user_dossier(
    db_session: AsyncSession,
    user_id: int,
    org_id: int,
    days: int = 365,
    behavior_fetcher: Optional[BehaviorFetcher] = None,
    include_raw: bool = False,
) -> dict:
    """Assemble the full per-student dossier. ``behavior_fetcher`` is optional so
    the durable Postgres dossier still renders when analytics is unconfigured.

    ``include_raw`` adds each task's original stored submission payload alongside the
    rendered answer. Off by default: the rendering is what a reader wants, and the raw
    blobs roughly double an export. Every task always carries an ``answer_digest`` so
    a rendering can be tied back to a specific stored row without shipping it.
    """
    identity = await _identity(db_session, user_id, org_id)
    if not identity:
        return {}

    connections, timeline = await _connections_and_timeline(db_session, user_id, org_id)
    courses = await _course_progress(db_session, user_id, org_id)
    assignments = await _assignments(db_session, user_id, org_id, include_raw=include_raw)
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
    behavior = await _enrich_behavior(behavior, db_session)

    # Averaging raw grades across assignments with different maxima compares
    # incomparable numbers (40/50 and 40/100 are not the same result), so the average
    # is taken over percentages.
    graded = [
        a for a in assignments
        if a.get("status") == "GRADED" and a.get("grade_percentage") is not None
    ]
    avg_grade_pct = (
        round(sum(a["grade_percentage"] for a in graded) / len(graded), 1)
        if graded else None
    )

    return {
        **identity,
        "schema_version": 2,
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
            "assignments_graded": len(graded),
            "tasks_answered": sum(a["tasks_submitted"] for a in assignments),
            "avg_grade_pct": avg_grade_pct,
            # Kept as an alias for one release so existing export consumers don't
            # break on the rename.
            "avg_grade": avg_grade_pct,
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
