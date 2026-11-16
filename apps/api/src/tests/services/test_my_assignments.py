"""GET /assignments/me: the learner's own assignments across enrolled courses."""

from datetime import datetime, timezone
from itertools import count

import pytest
from fastapi import HTTPException

from src.db.courses.activities import (
    Activity,
    ActivityLockType,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.db.trail_runs import TrailRun
from src.db.trails import Trail
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroups import UserGroup
from src.db.users import AnonymousUser
from src.services.courses.activities.my_assignments import (
    get_my_assignments,
    learner_status,
    parse_due_date,
)

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=timezone.utc)
_ids = count(100)


def _now():
    return str(datetime.now())


async def _course(db, org_id, *, published=True, public=True, name="Course"):
    i = next(_ids)
    c = Course(
        id=i, name=f"{name} {i}", description="", public=public, published=published,
        open_to_contributors=False, org_id=org_id, course_uuid=f"course_{i}",
        creation_date=_now(), update_date=_now(),
    )
    db.add(c)
    ch = Chapter(
        id=i, name="Chapter", description="", org_id=org_id, course_id=i,
        chapter_uuid=f"chapter_{i}", creation_date=_now(), update_date=_now(),
    )
    db.add(ch)
    await db.commit()
    return c


async def _assignment(
    db, course, *, title="A", due=None, published=True, activity_published=True,
    lock=ActivityLockType.PUBLIC, grading=GradingTypeEnum.NUMERIC, ungraded=False,
):
    i = next(_ids)
    act = Activity(
        id=i, name=title, activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY, content={},
        published=activity_published, lock_type=lock, org_id=course.org_id,
        course_id=course.id, activity_uuid=f"activity_{i}",
        creation_date=_now(), update_date=_now(),
    )
    db.add(act)
    a = Assignment(
        id=i, title=title, description="", due_date=due, published=published,
        grading_type=grading, ungraded=ungraded, org_id=course.org_id,
        course_id=course.id, chapter_id=course.id, activity_id=i,
        assignment_uuid=f"assignment_{i}", creation_date=_now(), update_date=_now(),
    )
    db.add(a)
    db.add(
        AssignmentTask(
            id=i, title="t", description="", hint="",
            assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER, contents={},
            max_grade_value=100, assignment_id=i, org_id=course.org_id,
            course_id=course.id, chapter_id=course.id, activity_id=i,
            assignment_task_uuid=f"assignmenttask_{i}", creation_date=_now(), update_date=_now(),
        )
    )
    await db.commit()
    return a


async def _enroll(db, user_id, course):
    trail = Trail(org_id=course.org_id, user_id=user_id, trail_uuid=f"trail_{next(_ids)}", creation_date=_now(), update_date=_now())
    db.add(trail)
    await db.commit()
    await db.refresh(trail)
    db.add(TrailRun(trail_id=trail.id, course_id=course.id, org_id=course.org_id, user_id=user_id, creation_date=_now(), update_date=_now()))
    await db.commit()


async def _submission(db, user_id, assignment, status, grade=0, attempt=1, updated="2026-11-01 10:00:00"):
    db.add(
        AssignmentUserSubmission(
            user_id=user_id, assignment_id=assignment.id, grade=grade,
            submission_status=status, attempt_number=attempt,
            assignmentusersubmission_uuid=f"aus_{next(_ids)}",
            creation_date=updated, update_date=updated,
        )
    )
    await db.commit()


async def _started(db, user_id, assignment):
    db.add(
        AssignmentTaskSubmission(
            assignment_task_submission_uuid=f"ats_{next(_ids)}", task_submission={},
            grade=0, task_submission_grade_feedback="", assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
            user_id=user_id, activity_id=assignment.activity_id, course_id=assignment.course_id,
            chapter_id=assignment.chapter_id, assignment_task_id=assignment.id,
            creation_date=_now(), update_date=_now(),
        )
    )
    await db.commit()


def _uuids(items):
    return [i.assignment_uuid for i in items]


class TestHelpers:
    def test_parse_due_date(self):
        assert parse_due_date(None) is None
        assert parse_due_date("nonsense") is None
        end_of_day = parse_due_date("2026-11-04")
        assert end_of_day.date().isoformat() == "2026-11-04" and end_of_day.hour == 23
        assert parse_due_date("2026-11-04T09:00:00Z").hour == 9

    def test_status_mapping(self):
        sub = lambda s, attempt=1: AssignmentUserSubmission(  # noqa: E731
            user_id=1, assignment_id=1, grade=0, submission_status=s, attempt_number=attempt,
            assignmentusersubmission_uuid="x", creation_date="", update_date="",
        )
        S = AssignmentUserSubmissionStatus
        assert learner_status(None, False) == "not_started"
        assert learner_status(None, True) == "in_progress"
        assert learner_status(sub(S.GRADED), False) == "graded"
        assert learner_status(sub(S.SUBMITTED), False) == "submitted"
        assert learner_status(sub(S.LATE), False) == "late"
        assert learner_status(sub(S.PENDING), False) == "not_started"
        assert learner_status(sub(S.PENDING, attempt=2), False) == "in_progress"


class TestMyAssignments:
    async def test_only_own_data_and_enrolled_courses(self, db, org, regular_user, admin_user):
        mine = await _course(db, org.id)
        not_enrolled = await _course(db, org.id)
        a = await _assignment(db, mine, title="Mine")
        await _assignment(db, not_enrolled, title="Not enrolled")
        await _enroll(db, regular_user.id, mine)
        # Another learner graded on the same assignment: must not leak.
        await _submission(db, admin_user.id, a, AssignmentUserSubmissionStatus.GRADED, grade=90)

        items = await get_my_assignments(regular_user, org.id, db, now=NOW)
        assert _uuids(items) == [a.assignment_uuid]
        assert items[0].status == "not_started"
        assert items[0].grade is None
        assert items[0].activity_uuid.startswith("activity_")

    async def test_cross_org_isolation(self, db, org, other_org, regular_user):
        here = await _course(db, org.id)
        there = await _course(db, other_org.id)
        await _assignment(db, here, title="Here")
        b = await _assignment(db, there, title="There")
        await _enroll(db, regular_user.id, here)
        await _enroll(db, regular_user.id, there)

        items = await get_my_assignments(regular_user, org.id, db, now=NOW)
        assert b.assignment_uuid not in _uuids(items)
        assert all(i.course.course_uuid == here.course_uuid for i in items)

    async def test_unpublished_and_inaccessible_excluded(self, db, org, regular_user):
        course = await _course(db, org.id)
        ok = await _assignment(db, course, title="Ok")
        await _assignment(db, course, title="Draft", published=False)
        await _assignment(db, course, title="Draft activity", activity_published=False)
        await _assignment(db, course, title="Restricted", lock=ActivityLockType.RESTRICTED)
        draft_course = await _course(db, org.id, published=False)
        await _assignment(db, draft_course, title="Draft course")
        # Private course attached to a group the learner is not in.
        grouped = await _course(db, org.id, public=False)
        await _assignment(db, grouped, title="Group only")
        group = UserGroup(id=next(_ids), name="g", description="", org_id=org.id, usergroup_uuid="ug_x", creation_date=_now(), update_date=_now())
        db.add(group)
        db.add(UserGroupResource(usergroup_id=group.id, resource_uuid=grouped.course_uuid, org_id=org.id, creation_date=_now(), update_date=_now()))
        await db.commit()
        for c in (course, draft_course, grouped):
            await _enroll(db, regular_user.id, c)

        items = await get_my_assignments(regular_user, org.id, db, now=NOW)
        assert _uuids(items) == [ok.assignment_uuid]

    async def test_status_grade_and_ordering(self, db, org, regular_user):
        course = await _course(db, org.id)
        await _enroll(db, regular_user.id, course)
        undated = await _assignment(db, course, title="Undated")
        later = await _assignment(db, course, title="Later", due="2026-12-01")
        soon = await _assignment(db, course, title="Soon", due="2026-11-07")
        overdue = await _assignment(db, course, title="Overdue", due="2026-11-01")
        started = await _assignment(db, course, title="Started", due="2026-11-02")
        submitted = await _assignment(db, course, title="Submitted", due="2026-11-01")
        graded_old = await _assignment(db, course, title="Graded old", grading=GradingTypeEnum.ALPHABET)
        graded_new = await _assignment(db, course, title="Graded new", grading=GradingTypeEnum.PASS_FAIL)
        formative = await _assignment(db, course, title="Formative", ungraded=True)

        await _started(db, regular_user.id, started)
        await _submission(db, regular_user.id, submitted, AssignmentUserSubmissionStatus.SUBMITTED)
        await _submission(db, regular_user.id, graded_old, AssignmentUserSubmissionStatus.GRADED, grade=85, updated="2026-10-01 09:00:00")
        await _submission(db, regular_user.id, graded_new, AssignmentUserSubmissionStatus.GRADED, grade=30, updated="2026-11-03 09:00:00")
        await _submission(db, regular_user.id, formative, AssignmentUserSubmissionStatus.GRADED, grade=0, updated="2026-11-04 09:00:00")

        items = await get_my_assignments(regular_user, org.id, db, now=NOW)
        by_uuid = {i.assignment_uuid: i for i in items}

        # Overdue (oldest due first), due soonest, undated, handed in, then graded newest first.
        assert _uuids(items) == [
            overdue.assignment_uuid,
            started.assignment_uuid,
            soon.assignment_uuid,
            later.assignment_uuid,
            undated.assignment_uuid,
            submitted.assignment_uuid,
            formative.assignment_uuid,
            graded_new.assignment_uuid,
            graded_old.assignment_uuid,
        ]
        assert by_uuid[overdue.assignment_uuid].overdue is True
        assert by_uuid[started.assignment_uuid].status == "in_progress"
        assert by_uuid[started.assignment_uuid].overdue is True
        assert by_uuid[soon.assignment_uuid].overdue is False
        # Handed in work is never overdue.
        assert by_uuid[submitted.assignment_uuid].overdue is False
        assert by_uuid[graded_old.assignment_uuid].grade.display_grade == "B"
        assert by_uuid[graded_old.assignment_uuid].grade.passed is True
        assert by_uuid[graded_new.assignment_uuid].grade.display_grade == "Fail"
        assert by_uuid[graded_new.assignment_uuid].grade.passed is False
        # Formative work is graded without a grade.
        assert by_uuid[formative.assignment_uuid].grade is None
        assert by_uuid[formative.assignment_uuid].ungraded is True

    async def test_graded_limit(self, db, org, regular_user):
        course = await _course(db, org.id)
        await _enroll(db, regular_user.id, course)
        for n in range(3):
            a = await _assignment(db, course, title=f"G{n}")
            await _submission(db, regular_user.id, a, AssignmentUserSubmissionStatus.GRADED, grade=50, updated=f"2026-11-0{n + 1} 09:00:00")
        items = await get_my_assignments(regular_user, org.id, db, graded_limit=2, now=NOW)
        assert [i.title for i in items] == ["G2", "G1"]

    async def test_no_enrollments_is_empty(self, db, org, regular_user):
        course = await _course(db, org.id)
        await _assignment(db, course, title="Not enrolled")
        assert await get_my_assignments(regular_user, org.id, db, now=NOW) == []

    async def test_anonymous_rejected(self, db, org):
        with pytest.raises(HTTPException) as exc:
            await get_my_assignments(AnonymousUser(), org.id, db)
        assert exc.value.status_code == 403
