"""Tests for src/services/orgs/member_panel.py (the Users page member panel)."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.assignment_ai_grades import AssignmentAIGrade
from src.db.courses.assignments import AssignmentUserSubmission, AssignmentUserSubmissionStatus
from src.db.courses.certifications import CertificateUser, Certifications
from src.db.courses.courses import Course
from src.db.roles import Role, RoleTypeEnum
from src.db.trail_runs import StatusEnum, TrailRun
from src.db.trail_steps import TrailStep
from src.db.trails import Trail
from src.db.user_activity import UserActivityDay
from src.db.user_audit_events import UserAuditEvent
from src.db.user_mfa import UserMFA
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import AnonymousUser, PublicUser, User
from src.services.orgs import member_panel
from src.services.orgs.member_panel import (
    _day,
    _event_row,
    _overdue_assignments,
    assess_risk,
    get_member_activity,
    get_member_assignments,
    get_member_summary,
)

NOW = str(datetime.now())


def _public(user) -> PublicUser:
    return PublicUser(
        id=user.id,
        user_uuid=user.user_uuid,
        username=user.username,
        first_name=user.first_name,
        last_name=user.last_name,
        email=user.email,
    )


async def _add_user(db, user_id, *, org_id=None, role_id=4, signup_method=None, superadmin=False):
    user = User(
        id=user_id,
        username=f"u{user_id}",
        first_name="U",
        last_name=str(user_id),
        email=f"u{user_id}@test.com",
        password="x",
        user_uuid=f"user_u{user_id}",
        signup_method=signup_method,
        is_superadmin=superadmin,
        creation_date=NOW,
        update_date=NOW,
    )
    db.add(user)
    await db.commit()
    if org_id is not None:
        db.add(UserOrganization(user_id=user_id, org_id=org_id, role_id=role_id, creation_date=NOW, update_date=NOW))
        await db.commit()
    return user


async def _event(db, user_id, org_id, event_type, *, when=None, metadata=None):
    db.add(UserAuditEvent(
        user_id=user_id,
        org_id=org_id,
        event_type=event_type,
        ip="10.0.0.1",
        user_agent="secret-agent",
        audit_metadata=metadata or {},
        created_at=when or datetime.now(timezone.utc),
    ))
    await db.commit()


# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------


async def test_anonymous_is_rejected(db, org, regular_user):
    with pytest.raises(HTTPException) as exc:
        await get_member_summary(org.id, regular_user.id, AnonymousUser(), db)
    assert exc.value.status_code == 401


async def test_plain_member_cannot_open_the_panel(db, org, admin_user, regular_user):
    with pytest.raises(HTTPException) as exc:
        await get_member_summary(org.id, admin_user.id, regular_user, db)
    assert exc.value.status_code == 403


async def test_admin_of_another_org_cannot_read_here(db, org, other_org, admin_user, regular_user):
    with pytest.raises(HTTPException) as exc:
        await get_member_assignments(other_org.id, regular_user.id, admin_user, db)
    assert exc.value.status_code == 403


async def test_target_outside_the_org_is_not_found(db, org, other_org, admin_user):
    await _add_user(db, 30, org_id=other_org.id)
    with pytest.raises(HTTPException) as exc:
        await get_member_activity(org.id, 30, admin_user, db)
    assert exc.value.status_code == 404


async def test_demo_org_hides_other_visitors(db, org, admin_user):
    org.is_demo = True
    db.add(org)
    await db.commit()
    await _add_user(db, 31, org_id=org.id, signup_method="email")
    await _add_user(db, 32, org_id=org.id, signup_method="demo")

    with pytest.raises(HTTPException) as exc:
        await get_member_activity(org.id, 31, admin_user, db)
    assert exc.value.status_code == 404
    page = await get_member_activity(org.id, 32, admin_user, db)
    assert page["total"] == 0

    # Seeded students are readable, but two-factor is never resettable there.
    db.add(UserMFA(user_id=32, confirmed_at=NOW, creation_date=NOW, update_date=NOW))
    await db.commit()
    summary = await get_member_summary(org.id, 32, admin_user, db)
    assert summary["security"]["mfa_enabled"] is True
    assert summary["security"]["can_reset_mfa"] is False


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------


async def test_summary_of_a_new_member_is_empty_and_quiet(db, org, admin_user, regular_user):
    summary = await get_member_summary(org.id, regular_user.id, admin_user, db)

    assert summary["user"]["username"] == "regular"
    assert "is_superadmin" not in summary["user"]
    assert summary["role"]["name"] == "User"
    assert summary["usergroups"] == []
    assert summary["courses"] == [] and summary["certificates"] == [] and summary["recent"] == []
    assert summary["stats"]["courses_enrolled"] == 0 and summary["stats"]["avg_progress"] == 0
    assert summary["stats"]["last_active_at"] is None
    assert len(summary["activity"]) == member_panel.ACTIVITY_WINDOW_DAYS
    assert summary["at_risk"] is False and summary["idle_days"] is None
    assert summary["security"] == {
        "email_verified": False,
        "signup_method": None,
        "mfa_enabled": False,
        "mfa_enabled_at": None,
        "can_reset_mfa": False,
        "is_self": False,
        "org_requires_mfa": False,
    }
    assert summary["risk_reasons"] == []


async def test_summary_brings_learning_together(
    db, org, other_org, admin_user, regular_user, course, activity, assignment, assignment_task
):
    uid = regular_user.id
    group = UserGroup(id=5, name="Cohort A", description="", org_id=org.id, usergroup_uuid="ug_a", creation_date=NOW, update_date=NOW)
    db.add(group)
    await db.commit()
    db.add(UserGroupUser(usergroup_id=5, user_id=uid, org_id=org.id, creation_date=NOW, update_date=NOW))

    # Two courses: course_test (1 activity, completed) and an empty one in progress.
    empty = Course(id=2, name="Empty", description="", public=True, published=False, open_to_contributors=False,
                   org_id=org.id, course_uuid="course_empty", creation_date=NOW, update_date=NOW)
    foreign = Course(id=3, name="Foreign", description="", public=True, published=True, open_to_contributors=False,
                     org_id=other_org.id, course_uuid="course_foreign", creation_date=NOW, update_date=NOW)
    db.add_all([empty, foreign])
    trail = Trail(id=1, org_id=org.id, user_id=uid, trail_uuid="trail_1", creation_date=NOW, update_date=NOW)
    db.add(trail)
    await db.commit()
    db.add_all([
        TrailRun(id=1, trail_id=1, course_id=course.id, org_id=org.id, user_id=uid,
                 status=StatusEnum.STATUS_IN_PROGRESS, creation_date=NOW, update_date=NOW),
        TrailRun(id=2, trail_id=1, course_id=2, org_id=org.id, user_id=uid, creation_date=NOW, update_date="2026-01-02"),
        TrailRun(id=3, trail_id=1, course_id=3, org_id=org.id, user_id=uid, creation_date=NOW, update_date=NOW),
        TrailStep(complete=True, teacher_verified=False, grade="", data={}, trailrun_id=1, trail_id=1,
                  activity_id=activity.id, course_id=course.id, org_id=org.id, user_id=uid,
                  creation_date=NOW, update_date="2026-05-05 10:00:00"),
    ])

    # Assignments: one graded, an AI draft waiting.
    db.add(AssignmentUserSubmission(user_id=uid, assignment_id=assignment.id, grade=80,
                                    submission_status=AssignmentUserSubmissionStatus.GRADED, attempt_number=1,
                                    assignmentusersubmission_uuid="aus_1", creation_date=NOW, update_date=NOW))
    db.add(AssignmentAIGrade(assignment_ai_grade_uuid="aig_1", assignment_id=assignment.id, user_id=uid,
                             org_id=org.id, status="DRAFT", creation_date=NOW, update_date=NOW))
    # A certificate for course_test, and one from another org that must not show.
    db.add_all([
        Certifications(id=1, certification_uuid="cert_a", course_id=course.id, config={}),
        Certifications(id=2, certification_uuid="cert_b", course_id=3, config={}),
    ])
    await db.commit()
    db.add_all([
        CertificateUser(user_id=uid, certification_id=1, user_certification_uuid="uc_1", created_at=NOW),
        CertificateUser(user_id=uid, certification_id=2, user_certification_uuid="uc_2", created_at=NOW),
    ])
    # Two-factor on.
    db.add(UserMFA(user_id=uid, confirmed_at="2026-01-01", creation_date=NOW, update_date=NOW))
    # Activity: today here, an older day here, and a day in another org.
    today = datetime.now(timezone.utc).date()
    db.add_all([
        UserActivityDay(org_id=org.id, user_id=uid, activity_date=today),
        UserActivityDay(org_id=org.id, user_id=uid, activity_date=today - timedelta(days=60)),
        UserActivityDay(org_id=other_org.id, user_id=uid, activity_date=today - timedelta(days=1)),
    ])
    await db.commit()
    await _event(db, uid, org.id, "course_completed", metadata={"course_name": "Test Course"})
    await _event(db, uid, other_org.id, "login")

    summary = await get_member_summary(org.id, uid, admin_user, db)

    assert [g["name"] for g in summary["usergroups"]] == ["Cohort A"]
    by_uuid = {c["course_uuid"]: c for c in summary["courses"]}
    assert set(by_uuid) == {"course_test", "course_empty"}
    assert by_uuid["course_test"]["completed"] is True and by_uuid["course_test"]["progress"] == 100
    assert by_uuid["course_test"]["last_activity_at"] == "2026-05-05 10:00:00"
    assert by_uuid["course_empty"]["progress"] == 0 and by_uuid["course_empty"]["completed"] is False
    assert by_uuid["course_empty"]["last_activity_at"] == "2026-01-02"

    stats = summary["stats"]
    assert stats["courses_enrolled"] == 2 and stats["courses_completed"] == 1 and stats["avg_progress"] == 50
    assert stats["assignments_submitted"] == 1 and stats["assignments_graded"] == 1 and stats["assignments_to_grade"] == 0
    assert stats["ai_drafts"] == 1
    assert stats["certificates"] == 1 and summary["certificates"][0]["course_uuid"] == "course_test"
    assert stats["last_active_at"] == today.isoformat() and summary["idle_days"] == 0
    assert stats["active_days_30"] == 1
    assert summary["activity"][-1] == {"date": today.isoformat(), "events": 1, "active": True}
    assert summary["at_risk"] is False

    assert [e["event_type"] for e in summary["recent"]] == ["course_completed"]
    assert summary["recent"][0]["metadata"] == {"course_name": "Test Course"}
    assert "ip" not in summary["recent"][0]

    assert summary["security"]["mfa_enabled"] is True
    assert summary["security"]["mfa_enabled_at"] == "2026-01-01"
    assert summary["security"]["can_reset_mfa"] is True


async def _backdate_membership(db, org_id, user_id, days):
    membership = (await db.execute(
        select(UserOrganization).where(UserOrganization.org_id == org_id, UserOrganization.user_id == user_id)
    )).scalars().first()
    membership.creation_date = str(datetime.now() - timedelta(days=days))
    db.add(membership)
    await db.commit()


async def test_idle_member_with_unfinished_courses_is_at_risk(db, org, admin_user, regular_user, course):
    await _backdate_membership(db, org.id, regular_user.id, 40)
    long_ago = str(datetime.now() - timedelta(days=30))
    db.add(Trail(id=1, org_id=org.id, user_id=regular_user.id, trail_uuid="t", creation_date=NOW, update_date=NOW))
    await db.commit()
    db.add(TrailRun(trail_id=1, course_id=course.id, org_id=org.id, user_id=regular_user.id,
                    status=StatusEnum.STATUS_COMPLETED, creation_date=NOW, update_date=NOW))
    db.add(Course(id=4, name="Other", description="", public=True, published=True, open_to_contributors=False,
                  org_id=org.id, course_uuid="course_other", creation_date=NOW, update_date=NOW))
    await db.commit()
    db.add(TrailRun(trail_id=1, course_id=4, org_id=org.id, user_id=regular_user.id, creation_date=long_ago, update_date=NOW))
    db.add(UserActivityDay(org_id=org.id, user_id=regular_user.id,
                           activity_date=datetime.now(timezone.utc).date() - timedelta(days=20)))
    await db.commit()

    summary = await get_member_summary(org.id, regular_user.id, admin_user, db)

    assert summary["at_risk"] is True and summary["idle_days"] == 20
    assert summary["risk_reasons"] == [
        {"code": "inactive", "params": {"days": 20}},
        {"code": "unfinished_courses", "params": {"count": 1}},
    ]
    # A run marked complete counts as complete even with no activities in it.
    completed = {c["course_uuid"]: (c["completed"], c["progress"]) for c in summary["courses"]}
    assert completed == {"course_test": (True, 100), "course_other": (False, 0)}


async def test_who_may_reset_two_factor(db, org, admin_user, regular_user):
    maintainer_role = Role(id=2, name="Maintainer", org_id=org.id, role_type=RoleTypeEnum.TYPE_ORGANIZATION,
                           role_uuid="role_maintainer", rights={}, creation_date=NOW, update_date=NOW)
    db.add(maintainer_role)
    await db.commit()
    maintainer = await _add_user(db, 40, org_id=org.id, role_id=2)
    other_admin = await _add_user(db, 41, org_id=org.id, role_id=1)
    superadmin = await _add_user(db, 42, superadmin=True)
    for uid in (regular_user.id, other_admin.id, admin_user.id):
        db.add(UserMFA(user_id=uid, confirmed_at=NOW, creation_date=NOW, update_date=NOW))
    await db.commit()

    async def can(caller, target_id):
        return (await get_member_summary(org.id, target_id, caller, db))["security"]["can_reset_mfa"]

    assert await can(admin_user, regular_user.id) is True
    assert await can(_public(maintainer), regular_user.id) is False  # Maintainers never
    assert await can(admin_user, other_admin.id) is False  # not another Admin
    assert await can(_public(superadmin), other_admin.id) is True  # unless platform superadmin
    own = await get_member_summary(org.id, admin_user.id, admin_user, db)
    assert own["security"]["can_reset_mfa"] is False and own["security"]["is_self"] is True


# ---------------------------------------------------------------------------
# Assignments
# ---------------------------------------------------------------------------


async def test_assignments_list_grades_and_ai_drafts(db, org, admin_user, regular_user, assignment, assignment_task):
    assert await get_member_assignments(org.id, regular_user.id, admin_user, db) == {"items": [], "total": 0}

    sub = AssignmentUserSubmission(user_id=regular_user.id, assignment_id=assignment.id, grade=80,
                                   submission_status=AssignmentUserSubmissionStatus.GRADED, attempt_number=2,
                                   assignmentusersubmission_uuid="aus_g", creation_date=NOW, update_date="2026-02-02")
    db.add(sub)
    await db.commit()
    out = await get_member_assignments(org.id, regular_user.id, admin_user, db)
    item = out["items"][0]
    assert item["assignment_uuid"] == "assignment_test" and item["course_uuid"] == "course_test"
    assert item["status"] == "GRADED" and item["attempt_number"] == 2 and item["submitted_at"] == "2026-02-02"
    assert item["grade"] == {"display": "80/100", "percentage": 80.0, "passed": True}
    assert item["ai_grade"] is None

    sub.submission_status = AssignmentUserSubmissionStatus.SUBMITTED
    db.add(sub)
    db.add(AssignmentAIGrade(assignment_ai_grade_uuid="aig", assignment_id=assignment.id, user_id=regular_user.id,
                             org_id=org.id, status="DRAFT", confidence="high", creation_date=NOW, update_date=NOW))
    await db.commit()
    item = (await get_member_assignments(org.id, regular_user.id, admin_user, db))["items"][0]
    assert item["grade"] is None
    assert item["ai_grade"] == {"status": "DRAFT", "confidence": "high"}


# ---------------------------------------------------------------------------
# Activity
# ---------------------------------------------------------------------------


async def test_activity_is_org_scoped_paged_and_without_request_context(db, org, other_org, admin_user, regular_user):
    base = datetime(2026, 3, 1, tzinfo=timezone.utc)
    for i in range(3):
        await _event(db, regular_user.id, org.id, "activity_completed", when=base + timedelta(hours=i),
                     metadata={"activity_name": f"A{i}", "ip_hint": "nope"})
    await _event(db, regular_user.id, other_org.id, "login")

    page = await get_member_activity(org.id, regular_user.id, admin_user, db, offset=1, limit=1)
    assert page["total"] == 3 and page["offset"] == 1 and page["limit"] == 1
    assert [e["metadata"] for e in page["items"]] == [{"activity_name": "A1"}]

    clamped = await get_member_activity(org.id, regular_user.id, admin_user, db, offset=-5, limit=500)
    assert clamped["offset"] == 0 and clamped["limit"] == member_panel.ACTIVITY_PAGE_MAX
    assert [e["metadata"]["activity_name"] for e in clamped["items"]] == ["A2", "A1", "A0"]


def test_event_row_keeps_aware_timestamps():
    when = datetime(2026, 3, 1, 12, tzinfo=timezone(timedelta(hours=2)))
    row = _event_row(UserAuditEvent(id=1, user_id=1, org_id=1, event_type="login", created_at=when, audit_metadata=None))
    assert row["at"] == when.isoformat() and row["metadata"] == {}


async def test_superadmin_reads_any_org(db, org, regular_user):
    root = await _add_user(db, 50, superadmin=True)
    summary = await get_member_summary(org.id, regular_user.id, _public(root), db)
    assert summary["user"]["id"] == regular_user.id
    rows = (await db.execute(select(UserOrganization).where(UserOrganization.user_id == 50))).scalars().all()
    assert rows == []


# ---------------------------------------------------------------------------
# At-risk rule
# ---------------------------------------------------------------------------

TODAY = datetime(2026, 11, 10).date()


def _course(completed=False, enrolled_days_ago=30):
    return {"completed": completed, "enrolled_at": str(datetime(2026, 11, 10) - timedelta(days=enrolled_days_ago))}


def _risk(**kw):
    base = dict(today=TODAY, joined=TODAY - timedelta(days=60), last_active=None, courses=[], overdue=[])
    base.update(kw)
    return assess_risk(**base)


def test_new_members_get_a_grace_period():
    # Joined minutes ago, never active, enrolled, even with an overdue item: not at risk.
    assert _risk(joined=TODAY, courses=[_course(enrolled_days_ago=0)], overdue=[{"title": "Quiz"}]) == []
    assert _risk(joined=TODAY - timedelta(days=6), courses=[_course()]) == []


def test_never_active_counts_only_after_the_threshold():
    assert _risk(joined=TODAY - timedelta(days=10), courses=[_course(enrolled_days_ago=10)]) == []
    assert _risk(joined=TODAY - timedelta(days=20), courses=[_course(enrolled_days_ago=20)]) == [
        {"code": "never_active", "params": {"days": 20}},
        {"code": "unfinished_courses", "params": {"count": 1}},
    ]
    # Unknown join date: still reported, without a day count.
    assert _risk(joined=None, courses=[_course()])[0] == {"code": "never_active", "params": {"days": None}}


def test_inactivity_needs_an_unfinished_course_held_past_the_grace_period():
    idle = dict(last_active=TODAY - timedelta(days=18))
    assert _risk(**idle, courses=[]) == []
    assert _risk(**idle, courses=[_course(completed=True)]) == []
    assert _risk(**idle, courses=[_course(enrolled_days_ago=3)]) == []
    assert _risk(**idle, courses=[_course(), _course(), _course(completed=True)]) == [
        {"code": "inactive", "params": {"days": 18}},
        {"code": "unfinished_courses", "params": {"count": 2}},
    ]
    assert _risk(last_active=TODAY - timedelta(days=5), courses=[_course()]) == []
    # An unreadable enrollment date does not hide the course.
    assert _risk(**idle, courses=[{"completed": False, "enrolled_at": "garbage"}])[0]["code"] == "inactive"


def test_overdue_assignments_and_extra_reasons():
    reasons = _risk(last_active=TODAY, overdue=[{"title": "Exam"}, {"title": "Quiz"}])
    assert reasons == [{"code": "assignment_overdue", "params": {"count": 2, "title": "Exam"}}]
    training = {"code": "training_overdue", "params": {"count": 1, "title": "Safety"}}
    assert _risk(last_active=TODAY, courses=[_course(enrolled_days_ago=1)], extra=[training]) == [
        training,
        {"code": "unfinished_courses", "params": {"count": 1}},
    ]


def test_day_parsing():
    assert _day("2026-10-31 11:19:19.098760") == datetime(2026, 10, 31).date()
    assert _day(None) is None and _day("soon") is None


async def test_overdue_assignments_query(db, org, regular_user, course, assignment):
    uid = regular_user.id
    today = datetime.now(timezone.utc).date()
    db.add(Trail(id=1, org_id=org.id, user_id=uid, trail_uuid="t", creation_date=NOW, update_date=NOW))
    await db.commit()
    db.add(TrailRun(trail_id=1, course_id=course.id, org_id=org.id, user_id=uid,
                    creation_date=str(datetime.now() - timedelta(days=30)), update_date=NOW))
    assignment.due_date = (today - timedelta(days=2)).isoformat()
    db.add(assignment)
    await db.commit()

    overdue = await _overdue_assignments(db, uid, org.id, today)
    assert overdue == [{"assignment_uuid": "assignment_test", "title": "Test Assignment",
                        "due_date": (today - timedelta(days=2)).isoformat()}]

    # Due before they enrolled: not theirs to have missed.
    assignment.due_date = (today - timedelta(days=40)).isoformat()
    db.add(assignment)
    await db.commit()
    assert await _overdue_assignments(db, uid, org.id, today) == []

    # Unreadable or future due dates are skipped, and so is work handed in.
    for due in ("someday", (today + timedelta(days=3)).isoformat()):
        assignment.due_date = due
        db.add(assignment)
        await db.commit()
        assert await _overdue_assignments(db, uid, org.id, today) == []
    assignment.due_date = (today - timedelta(days=2)).isoformat()
    db.add(assignment)
    db.add(AssignmentUserSubmission(user_id=uid, assignment_id=assignment.id, grade=0,
                                    submission_status=AssignmentUserSubmissionStatus.SUBMITTED, attempt_number=1,
                                    assignmentusersubmission_uuid="aus_late", creation_date=NOW, update_date=NOW))
    await db.commit()
    assert await _overdue_assignments(db, uid, org.id, today) == []


async def test_summary_reports_overdue_and_org_policy(db, org, admin_user, regular_user, course, assignment):
    from src.db.organization_config import OrganizationConfig

    await _backdate_membership(db, org.id, regular_user.id, 30)
    db.add(Trail(id=1, org_id=org.id, user_id=regular_user.id, trail_uuid="t", creation_date=NOW, update_date=NOW))
    db.add(OrganizationConfig(org_id=org.id, config={"admin_toggles": {"security": {"require_2fa": True}}},
                              creation_date=NOW, update_date=NOW))
    # The policy applies to the admin reading the panel too.
    db.add(UserMFA(user_id=admin_user.id, confirmed_at=NOW, creation_date=NOW, update_date=NOW))
    await db.commit()
    db.add(TrailRun(trail_id=1, course_id=course.id, org_id=org.id, user_id=regular_user.id,
                    creation_date=str(datetime.now() - timedelta(days=20)), update_date=NOW))
    db.add(UserActivityDay(org_id=org.id, user_id=regular_user.id, activity_date=datetime.now(timezone.utc).date()))
    assignment.due_date = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    db.add(assignment)
    await db.commit()

    summary = await get_member_summary(org.id, regular_user.id, admin_user, db)
    assert summary["security"]["org_requires_mfa"] is True
    assert [r["code"] for r in summary["risk_reasons"]] == ["assignment_overdue", "unfinished_courses"]
    assert summary["at_risk"] is True


async def test_ee_risk_reasons_hook():
    from unittest.mock import AsyncMock, patch
    from types import SimpleNamespace

    from src.core.ee_hooks import get_ee_member_risk_reasons

    reason = {"code": "training_overdue", "params": {"count": 1, "title": "Safety"}}
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
        assert await get_ee_member_risk_reasons(1, 2, None) == []
    hooks = SimpleNamespace(member_risk_reasons=AsyncMock(return_value=(reason,)))
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks):
        assert await get_ee_member_risk_reasons(1, 2, None) == [reason]
    broken = SimpleNamespace(member_risk_reasons=AsyncMock(side_effect=RuntimeError("boom")))
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=broken):
        assert await get_ee_member_risk_reasons(1, 2, None) == []
