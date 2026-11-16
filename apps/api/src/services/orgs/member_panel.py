"""The member side panel on the dashboard Users page.

One call for what the panel shows first (the member, their role and groups,
two-factor state, learning numbers, courses, a 30-day activity strip and the
latest learning events), and two lazy ones for the Assignments and Activity
tabs. Everything is scoped to one organization: an org admin sees what the
member did *here*, never their activity in another org they belong to.

Access follows the members list: org admins and maintainers (or superadmins),
the org's session policies applied, and the target must be a member of the org
(in the shared demo, only the seeded students or the caller).
"""

from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy import case
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.assignment_ai_grades import AIGradeStatusEnum, AssignmentAIGrade
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
)
from src.db.courses.certifications import CertificateUser, Certifications
from src.db.courses.courses import Course
from src.db.roles import Role, RoleRead
from src.db.trail_runs import StatusEnum, TrailRun
from src.db.trail_steps import TrailStep
from src.db.user_activity import UserActivityDay
from src.db.user_audit_events import UserAuditEvent
from src.db.user_mfa import UserMFA
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup, UserGroupRead
from src.db.users import AnonymousUser, OrgMemberUserRead, User
from src.security.auth import resolve_acting_user_id
from src.security.org_auth import enforce_org_mfa, is_org_admin
from src.security.rbac.constants import ADMIN_ROLE_ID

# At-risk rule (see assess_risk): a member is at risk when they have not been
# seen for AT_RISK_DAYS while holding an unfinished course, when an assignment
# in their courses is overdue, or (EE) when required training is overdue.
# Nobody is at risk in their first GRACE_DAYS, and a course only counts once
# the member has had it for GRACE_DAYS.
AT_RISK_DAYS = 14
GRACE_DAYS = 7
ACTIVITY_WINDOW_DAYS = 30
RECENT_EVENTS = 8
ASSIGNMENTS_LIMIT = 100
ACTIVITY_PAGE_MAX = 50

# Metadata keys the panel may show. Audit rows also carry request context
# (IP, user agent) which stays out of this view.
_EVENT_META_KEYS = (
    "course_uuid",
    "course_name",
    "activity_uuid",
    "activity_name",
    "assignment_title",
    "display_grade",
    "percentage",
    "attempt_number",
    "method",
)


async def _require_panel_access(
    org_id: int, user_id: int, current_user, db_session: AsyncSession
) -> tuple[int, UserOrganization]:
    """Gate every panel read; returns (acting user id, target membership)."""
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    acting_id = resolve_acting_user_id(current_user)
    if not await is_org_admin(acting_id, org_id, db_session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators and maintainers can view organization members",
        )
    await enforce_org_mfa(acting_id, org_id, db_session)

    from src.services.demo.guards import hide_other_visitors, is_demo_org

    statement = (
        select(UserOrganization)
        .join(User, User.id == UserOrganization.user_id)
        .where(UserOrganization.org_id == org_id, UserOrganization.user_id == user_id)
    )
    if await is_demo_org(org_id, db_session):
        statement = hide_other_visitors(statement, acting_id)
    membership = (await db_session.execute(statement)).scalars().first()
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User is not a member of this organization")
    return acting_id, membership


def _event_row(event: UserAuditEvent) -> dict:
    meta = event.audit_metadata or {}
    created = event.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return {
        "id": event.id,
        "event_type": event.event_type,
        "at": created.isoformat(),
        "target_uuid": event.target_uuid,
        "metadata": {k: meta[k] for k in _EVENT_META_KEYS if k in meta},
    }


async def _courses(db_session: AsyncSession, user_id: int, org_id: int) -> list[dict]:
    runs = (await db_session.execute(
        select(TrailRun, Course)
        .join(Course, Course.id == TrailRun.course_id)
        .where(TrailRun.user_id == user_id, TrailRun.org_id == org_id, Course.org_id == org_id)
        .order_by(TrailRun.id.desc())  # type: ignore[union-attr]
    )).all()
    if not runs:
        return []
    course_ids = [course.id for _run, course in runs]

    totals = dict((await db_session.execute(
        select(Activity.course_id, func.count(Activity.id))
        .where(Activity.course_id.in_(course_ids))  # type: ignore[attr-defined]
        .group_by(Activity.course_id)
    )).all())
    steps = {
        row[0]: (int(row[1] or 0), row[2])
        for row in (await db_session.execute(
            select(
                TrailStep.course_id,
                func.sum(case((TrailStep.complete == True, 1), else_=0)),  # noqa: E712
                func.max(TrailStep.update_date),
            )
            .where(
                TrailStep.user_id == user_id,
                TrailStep.org_id == org_id,
                TrailStep.course_id.in_(course_ids),  # type: ignore[attr-defined]
            )
            .group_by(TrailStep.course_id)
        )).all()
    }

    result = []
    for run, course in runs:
        total = int(totals.get(course.id, 0) or 0)
        done, last_step = steps.get(course.id, (0, None))
        done = min(done, total) if total else done
        status_value = str(getattr(run.status, "value", run.status))
        completed = status_value == StatusEnum.STATUS_COMPLETED.value or (total > 0 and done >= total)
        result.append({
            "course_uuid": course.course_uuid,
            "name": course.name,
            "thumbnail_image": course.thumbnail_image or "",
            "published": bool(course.published),
            "enrolled_at": run.creation_date,
            "last_activity_at": last_step or run.update_date,
            "activities_completed": done,
            "activities_total": total,
            # Same figure as the analytics dossier: activities done over activities
            # in the course. "completed" is the run's own status, kept separate.
            "progress": round(done / total * 100) if total else (100 if completed else 0),
            "completed": completed,
        })
    return result


def _days_since(value: Optional[date], today: date) -> Optional[int]:
    return (today - value).days if value else None


def _day(value: Any) -> Optional[date]:
    """The calendar day of a stored date string ('2026-10-31 11:19:…')."""
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


async def _overdue_assignments(
    db_session: AsyncSession, user_id: int, org_id: int, today: date
) -> list[dict]:
    """Published assignments in the member's courses whose due date has passed
    with nothing handed in. One due before the member enrolled is not theirs
    to have missed."""
    rows = (await db_session.execute(
        select(Assignment.assignment_uuid, Assignment.title, Assignment.due_date, TrailRun.creation_date, AssignmentUserSubmission.submission_status)
        .join(TrailRun, (TrailRun.course_id == Assignment.course_id) & (TrailRun.user_id == user_id) & (TrailRun.org_id == org_id))
        .outerjoin(
            AssignmentUserSubmission,
            (AssignmentUserSubmission.assignment_id == Assignment.id) & (AssignmentUserSubmission.user_id == user_id),
        )
        .where(Assignment.org_id == org_id, Assignment.published == True, Assignment.due_date.is_not(None))  # noqa: E712
    )).all()
    handed_in = {
        AssignmentUserSubmissionStatus.SUBMITTED,
        AssignmentUserSubmissionStatus.GRADED,
        AssignmentUserSubmissionStatus.LATE,
    }
    overdue = []
    for uuid, title, due, enrolled, submission_status in rows:
        due_day, enrolled_day = _day(due), _day(enrolled)
        if due_day is None or due_day >= today or submission_status in handed_in:
            continue
        if enrolled_day is not None and due_day < enrolled_day:
            continue
        overdue.append({"assignment_uuid": uuid, "title": title, "due_date": due_day.isoformat()})
    overdue.sort(key=lambda a: a["due_date"])
    return overdue


def assess_risk(
    *,
    today: date,
    joined: Optional[date],
    last_active: Optional[date],
    courses: list[dict],
    overdue: list[dict],
    extra: Optional[list[dict]] = None,
) -> list[dict]:
    """Why a member is at risk, as `{code, params}` reasons (empty: not at
    risk). Codes: inactive, never_active, assignment_overdue,
    training_overdue (EE), and unfinished_courses as context for the others."""
    if joined is not None and (today - joined).days < GRACE_DAYS:
        return []
    reasons: list[dict] = []
    unfinished = [c for c in courses if not c["completed"]]
    settled = [
        c for c in unfinished
        if (d := _day(c["enrolled_at"])) is None or (today - d).days >= GRACE_DAYS
    ]
    if settled:
        if last_active is not None:
            idle = (today - last_active).days
            if idle >= AT_RISK_DAYS:
                reasons.append({"code": "inactive", "params": {"days": idle}})
        else:
            since = (today - joined).days if joined is not None else None
            if since is None or since >= AT_RISK_DAYS:
                reasons.append({"code": "never_active", "params": {"days": since}})
    if overdue:
        reasons.append({"code": "assignment_overdue", "params": {"count": len(overdue), "title": overdue[0]["title"]}})
    reasons.extend(extra or [])
    if reasons and unfinished:
        reasons.append({"code": "unfinished_courses", "params": {"count": len(unfinished)}})
    return reasons


async def get_member_summary(
    org_id: int, user_id: int, current_user, db_session: AsyncSession
) -> dict[str, Any]:
    acting_id, membership = await _require_panel_access(org_id, user_id, current_user, db_session)

    user = await db_session.get(User, user_id)
    role = await db_session.get(Role, membership.role_id)

    from src.services.orgs.signup_fields import get_org_signup_fields

    meta_keys = {f.key for f in await get_org_signup_fields(org_id, db_session)}

    groups = (await db_session.execute(
        select(UserGroup)
        .join(UserGroupUser, UserGroupUser.usergroup_id == UserGroup.id)
        .where(UserGroupUser.user_id == user_id, UserGroupUser.org_id == org_id)
        .order_by(UserGroup.name)
    )).scalars().all()

    mfa = (await db_session.execute(select(UserMFA).where(UserMFA.user_id == user_id))).scalars().first()
    mfa_enabled = bool(mfa and mfa.confirmed_at)

    courses = await _courses(db_session, user_id, org_id)
    completed = sum(1 for c in courses if c["completed"])

    submission_counts = dict((await db_session.execute(
        select(AssignmentUserSubmission.submission_status, func.count(AssignmentUserSubmission.id))
        .join(Assignment, Assignment.id == AssignmentUserSubmission.assignment_id)
        .where(AssignmentUserSubmission.user_id == user_id, Assignment.org_id == org_id)
        .group_by(AssignmentUserSubmission.submission_status)
    )).all())

    def _count(*statuses: AssignmentUserSubmissionStatus) -> int:
        return sum(int(submission_counts.get(s, 0) or 0) for s in statuses)

    ai_drafts = int((await db_session.execute(
        select(func.count(AssignmentAIGrade.id)).where(
            AssignmentAIGrade.user_id == user_id,
            AssignmentAIGrade.org_id == org_id,
            AssignmentAIGrade.status == AIGradeStatusEnum.DRAFT.value,
        )
    )).scalar_one() or 0)

    certificates = [
        {
            "user_certification_uuid": cert.user_certification_uuid,
            "course_uuid": course.course_uuid,
            "course_name": course.name,
            "created_at": cert.created_at,
        }
        for cert, course in (await db_session.execute(
            select(CertificateUser, Course)
            .join(Certifications, Certifications.id == CertificateUser.certification_id)
            .join(Course, Course.id == Certifications.course_id)
            .where(CertificateUser.user_id == user_id, Course.org_id == org_id)
            .order_by(CertificateUser.id.desc())  # type: ignore[union-attr]
        )).all()
    ]

    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=ACTIVITY_WINDOW_DAYS - 1)
    active_days = set((await db_session.execute(
        select(UserActivityDay.activity_date).where(
            UserActivityDay.org_id == org_id,
            UserActivityDay.user_id == user_id,
            UserActivityDay.activity_date >= start,
        )
    )).scalars().all())
    last_active = (await db_session.execute(
        select(func.max(UserActivityDay.activity_date)).where(
            UserActivityDay.org_id == org_id, UserActivityDay.user_id == user_id
        )
    )).scalar_one_or_none()

    window_start = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
    events_per_day: dict[date, int] = {}
    for created in (await db_session.execute(
        select(UserAuditEvent.created_at).where(
            UserAuditEvent.user_id == user_id,
            UserAuditEvent.org_id == org_id,
            UserAuditEvent.created_at >= window_start,
        )
    )).scalars().all():
        events_per_day[created.date()] = events_per_day.get(created.date(), 0) + 1

    activity = []
    for offset in range(ACTIVITY_WINDOW_DAYS):
        day = start + timedelta(days=offset)
        activity.append({
            "date": day.isoformat(),
            "events": events_per_day.get(day, 0),
            "active": day in active_days or day in events_per_day,
        })

    recent = [
        _event_row(e)
        for e in (await db_session.execute(
            select(UserAuditEvent)
            .where(UserAuditEvent.user_id == user_id, UserAuditEvent.org_id == org_id)
            .order_by(UserAuditEvent.created_at.desc())  # type: ignore[union-attr]
            .limit(RECENT_EVENTS)
        )).scalars().all()
    ]

    idle_days = _days_since(last_active, today)
    from src.core.ee_hooks import get_ee_member_risk_reasons

    risk_reasons = assess_risk(
        today=today,
        joined=_day(membership.creation_date),
        last_active=last_active,
        courses=courses,
        overdue=await _overdue_assignments(db_session, user_id, org_id, today),
        extra=await get_ee_member_risk_reasons(org_id, user_id, db_session),
    )

    from src.services.orgs.mfa_policy import get_org_mfa_policy

    org_requires_mfa = (await get_org_mfa_policy(db_session, org_id)).require_2fa

    # Who may strip this member's two-factor (mirrors /auth/mfa/org-reset):
    # an Admin (not a Maintainer), never on themselves, never on another Admin
    # unless the caller is a platform superadmin, and never in the demo.
    from src.security.superadmin import is_user_superadmin
    from src.services.demo.guards import is_demo_org
    from src.services.orgs.orgs import is_org_admin_role

    caller_is_admin = await is_org_admin_role(acting_id, org_id, db_session)
    caller_is_superadmin = await is_user_superadmin(acting_id, db_session)
    can_reset_mfa = (
        mfa_enabled
        and caller_is_admin
        and acting_id != user_id
        and (membership.role_id != ADMIN_ROLE_ID or caller_is_superadmin)
        and not await is_demo_org(org_id, db_session)
    )

    return {
        "user": OrgMemberUserRead.for_org(user, meta_keys).model_dump(),
        "role": RoleRead.model_validate(role).model_dump() if role else None,
        "joined_at": membership.creation_date,
        "usergroups": [UserGroupRead.model_validate(g).model_dump() for g in groups],
        "security": {
            "email_verified": bool(user.email_verified),
            "signup_method": user.signup_method,
            "mfa_enabled": mfa_enabled,
            "mfa_enabled_at": mfa.confirmed_at if mfa_enabled else None,
            "can_reset_mfa": bool(can_reset_mfa),
            "is_self": acting_id == user_id,
            "org_requires_mfa": bool(org_requires_mfa),
        },
        "stats": {
            "courses_enrolled": len(courses),
            "courses_completed": completed,
            "avg_progress": round(sum(c["progress"] for c in courses) / len(courses)) if courses else 0,
            "assignments_submitted": _count(
                AssignmentUserSubmissionStatus.SUBMITTED,
                AssignmentUserSubmissionStatus.GRADED,
                AssignmentUserSubmissionStatus.LATE,
            ),
            "assignments_graded": _count(AssignmentUserSubmissionStatus.GRADED),
            "assignments_to_grade": _count(
                AssignmentUserSubmissionStatus.SUBMITTED, AssignmentUserSubmissionStatus.LATE
            ),
            "ai_drafts": ai_drafts,
            "certificates": len(certificates),
            "active_days_30": len([d for d in activity if d["active"]]),
            "last_active_at": last_active.isoformat() if last_active else None,
        },
        "at_risk": bool(risk_reasons),
        "risk_reasons": risk_reasons,
        "idle_days": idle_days,
        "activity": activity,
        "recent": recent,
        "courses": courses,
        "certificates": certificates,
    }


async def get_member_assignments(
    org_id: int, user_id: int, current_user, db_session: AsyncSession
) -> dict[str, Any]:
    await _require_panel_access(org_id, user_id, current_user, db_session)

    from src.services.courses.activities.assignments import compute_assignment_grade

    rows = (await db_session.execute(
        select(AssignmentUserSubmission, Assignment, Course)
        .join(Assignment, Assignment.id == AssignmentUserSubmission.assignment_id)
        .join(Course, Course.id == Assignment.course_id)
        .where(AssignmentUserSubmission.user_id == user_id, Assignment.org_id == org_id)
        .order_by(AssignmentUserSubmission.id.desc())  # type: ignore[union-attr]
        .limit(ASSIGNMENTS_LIMIT)
    )).all()
    assignment_ids = [a.id for _s, a, _c in rows]

    max_grades: dict[int, int] = {}
    ai_grades: dict[int, AssignmentAIGrade] = {}
    if assignment_ids:
        max_grades = dict((await db_session.execute(
            select(AssignmentTask.assignment_id, func.sum(AssignmentTask.max_grade_value))
            .where(AssignmentTask.assignment_id.in_(assignment_ids))  # type: ignore[attr-defined]
            .group_by(AssignmentTask.assignment_id)
        )).all())
        ai_grades = {
            g.assignment_id: g
            for g in (await db_session.execute(
                select(AssignmentAIGrade).where(
                    AssignmentAIGrade.user_id == user_id,
                    AssignmentAIGrade.assignment_id.in_(assignment_ids),  # type: ignore[attr-defined]
                )
            )).scalars().all()
        }

    items = []
    for submission, assignment, course in rows:
        status_value = str(getattr(submission.submission_status, "value", submission.submission_status))
        grade = None
        if status_value == AssignmentUserSubmissionStatus.GRADED.value:
            computed = compute_assignment_grade(
                submission.grade,
                int(max_grades.get(assignment.id, 0) or 0),
                assignment.grading_type,
                pass_threshold_percentage=assignment.pass_threshold_percentage,
            )
            grade = {
                "display": computed["display_grade"],
                "percentage": computed["percentage"],
                "passed": computed["passed"],
            }
        ai = ai_grades.get(assignment.id)
        items.append({
            "assignment_uuid": assignment.assignment_uuid,
            "title": assignment.title,
            "course_uuid": course.course_uuid,
            "course_name": course.name,
            "due_date": assignment.due_date,
            "status": status_value,
            "attempt_number": submission.attempt_number,
            "submitted_at": submission.update_date or submission.creation_date,
            "grade": grade,
            "ai_grade": {"status": ai.status, "confidence": ai.confidence} if ai else None,
        })
    return {"items": items, "total": len(items)}


async def get_member_activity(
    org_id: int,
    user_id: int,
    current_user,
    db_session: AsyncSession,
    offset: int = 0,
    limit: int = 25,
) -> dict[str, Any]:
    await _require_panel_access(org_id, user_id, current_user, db_session)
    limit = max(1, min(limit, ACTIVITY_PAGE_MAX))
    offset = max(0, offset)
    where = (UserAuditEvent.user_id == user_id, UserAuditEvent.org_id == org_id)
    total = int((await db_session.execute(
        select(func.count(UserAuditEvent.id)).where(*where)
    )).scalar_one() or 0)
    events = (await db_session.execute(
        select(UserAuditEvent)
        .where(*where)
        .order_by(UserAuditEvent.created_at.desc())  # type: ignore[union-attr]
        .offset(offset)
        .limit(limit)
    )).scalars().all()
    return {"items": [_event_row(e) for e in events], "total": total, "offset": offset, "limit": limit}
