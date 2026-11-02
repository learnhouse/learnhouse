"""User calendar: assignment due dates, range filtering, all-day handling,
access rules and the source registry."""

from datetime import date, datetime, timezone
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.assignments import (
    Assignment,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.courses import Course
from src.db.trail_runs import TrailRun
from src.db.users import AnonymousUser
from src.services.calendar import sources as calendar_sources
from src.services.calendar.calendar import get_calendar_events
from src.services.calendar.sources.assignments import parse_due_date
from src.services.calendar.types import CalendarEvent

NOV_START = datetime(2026, 11, 1, tzinfo=timezone.utc)
NOV_END = datetime(2026, 12, 1, tzinfo=timezone.utc)


def _now():
    return str(datetime.now())


async def _assignment_activity(db, org, course, activity_id, uuid, published=True):
    a = Activity(
        id=activity_id, name=uuid, activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY, content={},
        published=published, org_id=org.id, course_id=course.id, activity_uuid=f"activity_{uuid}",
        creation_date=_now(), update_date=_now(),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


async def _assignment(db, org, course, chapter, activity, uuid, due_date, **kw):
    row = Assignment(
        title=kw.pop("title", uuid), description="", published=kw.pop("published", True),
        grading_type=GradingTypeEnum.NUMERIC, due_date=due_date,
        org_id=org.id, course_id=course.id, chapter_id=chapter.id, activity_id=activity.id,
        assignment_uuid=f"assignment_{uuid}", creation_date=_now(), update_date=_now(), **kw,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def _enroll(db, org_id, course_id, user_id):
    db.add(TrailRun(trail_id=1, course_id=course_id, org_id=org_id, user_id=user_id, creation_date="", update_date=""))
    await db.commit()


async def _events(mock_request, org, user, db, start=NOV_START, end=NOV_END):
    return await get_calendar_events(mock_request, org.id, start, end, user, db)


@pytest.fixture
def only_assignments():
    """Run with the built-in sources only, whatever else got registered."""
    original = dict(calendar_sources._SOURCES)
    calendar_sources._SOURCES.clear()
    calendar_sources._SOURCES["assignments"] = original["assignments"]
    yield
    calendar_sources._SOURCES.clear()
    calendar_sources._SOURCES.update(original)


# ---------------------------------------------------------------------------
# Due date parsing
# ---------------------------------------------------------------------------


def test_date_only_due_date_is_all_day():
    assert parse_due_date("2026-11-10") == (date(2026, 11, 10), True)


def test_datetime_due_dates_are_instants_in_utc():
    assert parse_due_date("2026-11-10T09:30:00") == (datetime(2026, 11, 10, 9, 30, tzinfo=timezone.utc), False)
    assert parse_due_date("2026-11-10T09:30:00+02:00") == (datetime(2026, 11, 10, 7, 30, tzinfo=timezone.utc), False)
    assert parse_due_date("2026-11-10T09:30:00Z")[0] == datetime(2026, 11, 10, 9, 30, tzinfo=timezone.utc)


@pytest.mark.parametrize("raw", [None, "", "   ", "next friday", "2026-13-45", "2026-11-10T25:99"])
def test_missing_or_garbage_due_date_means_no_deadline(raw):
    assert parse_due_date(raw) == (None, False)


# ---------------------------------------------------------------------------
# Assignment source
# ---------------------------------------------------------------------------


async def test_enrolled_learner_sees_due_dates(db, org, course, chapter, regular_user, mock_request, only_assignments):
    act = await _assignment_activity(db, org, course, 11, "essay")
    await _assignment(db, org, course, chapter, act, "essay", "2026-11-10", title="Essay")
    await _enroll(db, org.id, course.id, regular_user.id)

    events = await _events(mock_request, org, regular_user, db)

    assert len(events) == 1
    ev = events[0]
    assert ev.id == "assignment:assignment_essay"
    assert ev.type == "assignment"
    assert ev.title == "Essay"
    assert ev.all_day is True
    assert ev.starts_at == "2026-11-10"
    assert ev.ends_at is None
    assert ev.url == "/course/test/activity/essay"
    assert ev.course.course_uuid == course.course_uuid
    assert ev.course.name == course.name
    assert ev.status in {"open", "overdue"}
    assert ev.meta["instructor"] is False


async def test_not_enrolled_user_sees_nothing(db, org, course, chapter, regular_user, mock_request, only_assignments):
    act = await _assignment_activity(db, org, course, 11, "essay")
    await _assignment(db, org, course, chapter, act, "essay", "2026-11-10")

    assert await _events(mock_request, org, regular_user, db) == []


async def test_course_the_user_can_no_longer_read_is_hidden(db, org, chapter, regular_user, mock_request, only_assignments):
    # Enrolled once, but the course has since been unpublished.
    hidden = Course(
        id=5, name="Hidden", description="", public=False, published=False, open_to_contributors=False,
        org_id=org.id, course_uuid="course_hidden", creation_date=_now(), update_date=_now(),
    )
    db.add(hidden)
    await db.commit()
    act = await _assignment_activity(db, org, hidden, 11, "secret")
    await _assignment(db, org, hidden, chapter, act, "secret", "2026-11-10")
    await _enroll(db, org.id, hidden.id, regular_user.id)

    assert await _events(mock_request, org, regular_user, db) == []


async def test_drafts_hidden_from_learners_shown_to_authors(
    db, org, course, chapter, admin_user, regular_user, mock_request, only_assignments
):
    from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum

    live_act = await _assignment_activity(db, org, course, 11, "live")
    draft_act = await _assignment_activity(db, org, course, 12, "draft_activity", published=False)
    await _assignment(db, org, course, chapter, live_act, "live", "2026-11-10")
    await _assignment(db, org, course, chapter, live_act, "unpublished", "2026-11-11", published=False)
    await _assignment(db, org, course, chapter, draft_act, "in_draft_activity", "2026-11-12")
    await _enroll(db, org.id, course.id, regular_user.id)
    db.add(ResourceAuthor(
        resource_uuid=course.course_uuid, user_id=admin_user.id,
        authorship=ResourceAuthorshipEnum.CREATOR, authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
    ))
    await db.commit()

    learner = await _events(mock_request, org, regular_user, db)
    author = await _events(mock_request, org, admin_user, db)

    assert [e.id for e in learner] == ["assignment:assignment_live"]
    assert [e.id for e in author] == [
        "assignment:assignment_live",
        "assignment:assignment_unpublished",
        "assignment:assignment_in_draft_activity",
    ]
    by_id = {e.id: e for e in author}
    assert by_id["assignment:assignment_unpublished"].status == "draft"
    assert all(e.meta["instructor"] for e in author)


async def test_other_org_assignments_never_leak(
    db, org, other_org, chapter, regular_user, mock_request, only_assignments
):
    foreign = Course(
        id=6, name="Foreign", description="", public=True, published=True, open_to_contributors=False,
        org_id=other_org.id, course_uuid="course_foreign", creation_date=_now(), update_date=_now(),
    )
    db.add(foreign)
    await db.commit()
    act = await _assignment_activity(db, other_org, foreign, 11, "foreign")
    await _assignment(db, other_org, foreign, chapter, act, "foreign", "2026-11-10")
    await _enroll(db, other_org.id, foreign.id, regular_user.id)

    assert await _events(mock_request, org, regular_user, db) == []


async def test_range_filtering(db, org, course, chapter, regular_user, mock_request, only_assignments):
    act = await _assignment_activity(db, org, course, 11, "a")
    await _assignment(db, org, course, chapter, act, "in_month", "2026-11-20T15:00:00Z")
    await _assignment(db, org, course, chapter, act, "first_day", "2026-11-01")
    await _assignment(db, org, course, chapter, act, "next_month", "2026-12-01T00:00:00Z")
    await _assignment(db, org, course, chapter, act, "last_month", "2026-10-31")
    await _assignment(db, org, course, chapter, act, "no_deadline", None)
    await _assignment(db, org, course, chapter, act, "blank", "")
    await _enroll(db, org.id, course.id, regular_user.id)

    events = await _events(mock_request, org, regular_user, db)
    assert [e.id for e in events] == ["assignment:assignment_first_day", "assignment:assignment_in_month"]
    timed = events[1]
    assert timed.all_day is False
    assert timed.starts_at == "2026-11-20T15:00:00Z"

    week = await _events(
        mock_request, org, regular_user, db,
        start=datetime(2026, 11, 16, tzinfo=timezone.utc), end=datetime(2026, 11, 23, tzinfo=timezone.utc),
    )
    assert [e.id for e in week] == ["assignment:assignment_in_month"]


async def test_nothing_due_in_the_window(db, org, course, chapter, regular_user, mock_request, only_assignments):
    act = await _assignment_activity(db, org, course, 12, "b")
    await _assignment(db, org, course, chapter, act, "last_year", "2025-11-10")
    await _enroll(db, org.id, course.id, regular_user.id)
    assert await _events(mock_request, org, regular_user, db) == []


async def test_submission_status_is_reported(db, org, course, chapter, regular_user, mock_request, only_assignments):
    act = await _assignment_activity(db, org, course, 11, "a")
    graded = await _assignment(db, org, course, chapter, act, "graded", "2026-11-10")
    submitted = await _assignment(db, org, course, chapter, act, "submitted", "2026-11-11")
    await _assignment(db, org, course, chapter, act, "missed", "2020-01-01T00:00:00Z")
    await _enroll(db, org.id, course.id, regular_user.id)
    late = await _assignment(db, org, course, chapter, act, "late", "2026-11-12")
    # No usable deadline: never on the calendar.
    await _assignment(db, org, course, chapter, act, "undated", "when it's ready")
    for row, status in (
        (graded, AssignmentUserSubmissionStatus.GRADED),
        (submitted, AssignmentUserSubmissionStatus.SUBMITTED),
        (late, AssignmentUserSubmissionStatus.LATE),
    ):
        db.add(AssignmentUserSubmission(
            user_id=regular_user.id, assignment_id=row.id, grade=80, submission_status=status,
            assignmentusersubmission_uuid=f"aus_{row.id}", creation_date=_now(), update_date=_now(),
        ))
    await db.commit()

    events = await _events(mock_request, org, regular_user, db)
    status = {e.id: e.status for e in events}
    assert status["assignment:assignment_graded"] == "graded"
    assert status["assignment:assignment_submitted"] == "submitted"
    assert status["assignment:assignment_late"] == "late"
    assert "assignment:assignment_undated" not in status

    past = await _events(
        mock_request, org, regular_user, db,
        start=datetime(2019, 12, 1, tzinfo=timezone.utc), end=datetime(2020, 2, 1, tzinfo=timezone.utc),
    )
    assert [(e.id, e.status) for e in past] == [("assignment:assignment_missed", "overdue")]


# ---------------------------------------------------------------------------
# Request validation
# ---------------------------------------------------------------------------


async def test_anonymous_callers_are_refused(db, org, mock_request):
    with pytest.raises(HTTPException) as exc:
        await _events(mock_request, org, AnonymousUser(), db)
    assert exc.value.status_code == 401


@pytest.mark.parametrize(
    "start,end",
    [
        (NOV_END, NOV_START),
        (NOV_START, NOV_START),
        (datetime(2025, 1, 1, tzinfo=timezone.utc), datetime(2027, 1, 1, tzinfo=timezone.utc)),
    ],
)
async def test_bad_ranges_are_rejected(db, org, regular_user, mock_request, start, end):
    with pytest.raises(HTTPException) as exc:
        await _events(mock_request, org, regular_user, db, start=start, end=end)
    assert exc.value.status_code == 400


async def test_unknown_org_is_404(db, org, regular_user, mock_request):
    with pytest.raises(HTTPException) as exc:
        await get_calendar_events(mock_request, 999, NOV_START, NOV_END, regular_user, db)
    assert exc.value.status_code == 404


async def test_naive_range_is_read_as_utc(db, org, course, chapter, regular_user, mock_request, only_assignments):
    act = await _assignment_activity(db, org, course, 11, "a")
    await _assignment(db, org, course, chapter, act, "x", "2026-11-20T15:00:00Z")
    await _enroll(db, org.id, course.id, regular_user.id)
    events = await _events(mock_request, org, regular_user, db, start=datetime(2026, 11, 1), end=datetime(2026, 12, 1))
    assert len(events) == 1


# ---------------------------------------------------------------------------
# Source registry
# ---------------------------------------------------------------------------


async def test_registered_source_contributes_and_events_are_sorted(db, org, regular_user, mock_request, only_assignments):
    seen = {}

    async def fake(ctx):
        seen["org"] = ctx.org.id
        seen["user"] = ctx.user_id
        return [
            CalendarEvent(id="fake:2", type="fake", title="Later", starts_at="2026-11-05T10:00:00Z"),
            CalendarEvent(id="fake:1", type="fake", title="All day", starts_at="2026-11-05", all_day=True),
            CalendarEvent(id="fake:1", type="fake", title="Duplicate", starts_at="2026-11-06", all_day=True),
        ]

    calendar_sources.register_source(fake, key="test.fake")
    try:
        events = await _events(mock_request, org, regular_user, db)
    finally:
        calendar_sources.unregister_source("test.fake")

    assert seen == {"org": org.id, "user": regular_user.id}
    assert [e.title for e in events] == ["All day", "Later"]
    assert "test.fake" not in calendar_sources.registered_sources()


async def test_a_failing_source_does_not_break_the_calendar(db, org, regular_user, mock_request, only_assignments):
    async def boom(ctx):
        raise RuntimeError("source down")

    async def ok(ctx):
        return [CalendarEvent(id="ok:1", type="ok", title="Still here", starts_at="2026-11-02", all_day=True)]

    calendar_sources.register_source(boom, key="test.boom")
    calendar_sources.register_source(ok, key="test.ok")
    try:
        events = await _events(mock_request, org, regular_user, db)
    finally:
        calendar_sources.unregister_source("test.boom")
        calendar_sources.unregister_source("test.ok")
    assert [e.id for e in events] == ["ok:1"]


async def test_access_errors_from_a_source_are_not_swallowed(db, org, regular_user, mock_request, only_assignments):
    async def denied(ctx):
        raise HTTPException(status_code=403, detail="no")

    calendar_sources.register_source(denied, key="test.denied")
    try:
        with pytest.raises(HTTPException) as e:
            await _events(mock_request, org, regular_user, db)
    finally:
        calendar_sources.unregister_source("test.denied")
    assert e.value.status_code == 403


async def test_router_returns_the_service_result(db, org, regular_user, mock_request, only_assignments):
    from src.routers.calendar import api_get_calendar_events

    assert await api_get_calendar_events(mock_request, org.id, NOV_START, NOV_END, regular_user, db) == []


async def test_context_helpers(db, org, regular_user, mock_request):
    from src.services.calendar.sources.common import parse_stored_timestamp
    from src.services.calendar.types import CalendarContext, course_ref

    ctx = CalendarContext(
        request=mock_request, db_session=db, current_user=regular_user, user_id=regular_user.id,
        org=org, start=NOV_START, end=NOV_END,
    )
    # Ranges count when any part of them falls in the window.
    assert ctx.overlaps(datetime(2026, 10, 31, 22, tzinfo=timezone.utc), datetime(2026, 11, 1, 2, tzinfo=timezone.utc))
    assert not ctx.overlaps(datetime(2026, 10, 1, tzinfo=timezone.utc), datetime(2026, 10, 2, tzinfo=timezone.utc))
    elsewhere = Course(name="X", org_id=org.id + 100, course_uuid="course_x", public=True, published=True,
                       open_to_contributors=False, creation_date="", update_date="")
    assert await ctx.can_read_course(elsewhere) is False
    assert await ctx.can_edit_course(elsewhere) is False
    assert course_ref(None) is None
    for raw in (None, "", "not a date"):
        assert parse_stored_timestamp(raw) is None


def test_register_source_defaults_to_qualified_name_and_dedupes():
    async def mine(ctx):
        return []

    calendar_sources.register_source(mine)
    calendar_sources.register_source(mine)
    key = f"{mine.__module__}.{mine.__qualname__}"
    try:
        assert list(calendar_sources.registered_sources()).count(key) == 1
    finally:
        calendar_sources.unregister_source(key)


def test_built_in_assignment_source_is_registered():
    assert "assignments" in calendar_sources.registered_sources()


class TestEERegistration:
    def test_ee_hook_is_called_when_present(self):
        from src.core import ee_hooks

        calls: list[int] = []
        hooks = type("Hooks", (), {"register_calendar_sources": staticmethod(lambda: calls.append(1))})
        with patch.object(ee_hooks, "get_ee_hooks", return_value=hooks):
            ee_hooks.register_ee_calendar_sources()
        assert calls == [1]

    def test_ee_failure_never_breaks_core(self):
        from src.core import ee_hooks

        def boom():
            raise RuntimeError("bad ee")

        hooks = type("Hooks", (), {"register_calendar_sources": staticmethod(boom)})
        with patch.object(ee_hooks, "get_ee_hooks", return_value=hooks):
            ee_hooks.register_ee_calendar_sources()  # logged, not raised
        with patch.object(ee_hooks, "get_ee_hooks", return_value=None):
            ee_hooks.register_ee_calendar_sources()
