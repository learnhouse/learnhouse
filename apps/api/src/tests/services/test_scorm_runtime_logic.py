"""
SCORM runtime data-model behaviour (ee/services/scorm/scorm_runtime.py).

Drives the real initialize -> commit -> terminate flow against the in-memory
DB so the assertions encode the *desired* behaviour. These guard the P0 runtime
fixes (valid 2004 completion token, no total_time double-count, suspend overflow
must not drop completion/score, resume). Skips cleanly when EE is absent.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.courses import Course

rt = pytest.importorskip("ee.services.scorm.scorm_runtime")
from ee.db.scorm import (  # noqa: E402
    ScormRuntimeData,  # noqa: F401  (imported so its table registers on metadata)
    CompletionStatusEnum,
    SuccessStatusEnum,
)

from src.db.courses.activities import (  # noqa: E402
    Activity,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)

# Valid SCORM 2004 cmi.completion_status vocabulary (RTE book).
VALID_2004_COMPLETION = {"completed", "incomplete", "not attempted", "unknown"}


async def _make_activity(db, org, version: str, uuid: str) -> Activity:
    sub = (
        ActivitySubTypeEnum.SUBTYPE_SCORM_2004
        if version == "SCORM_2004"
        else ActivitySubTypeEnum.SUBTYPE_SCORM_12
    )
    activity = Activity(
        name="SCORM Activity",
        activity_type=ActivityTypeEnum.TYPE_SCORM,
        activity_sub_type=sub,
        activity_uuid=uuid,
        org_id=org.id,
        content={"scorm_version": version, "entry_point": "index.html",
                 "sco_identifier": "ITEM-1", "sco_title": "SCO"},
        details={},
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(activity)
    await db.commit()
    await db.refresh(activity)
    return activity


class TestResume:
    async def test_fresh_entry_ab_initio_then_resume(self, db, org, admin_user):
        act = await _make_activity(db, org, "SCORM_12", "activity_resume12")
        init = await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        assert init["cmi_data"]["cmi.core.entry"] == "ab-initio"

        await rt.commit_scorm_data(None, act.activity_uuid, {
            "cmi.core.lesson_status": "incomplete",
            "cmi.core.lesson_location": "page-2",
            "cmi.suspend_data": "resume-token",
        }, admin_user, db)

        again = await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        cmi = again["cmi_data"]
        assert cmi["cmi.core.entry"] == "resume"
        assert cmi["cmi.core.lesson_location"] == "page-2"
        assert cmi["cmi.suspend_data"] == "resume-token"


class TestScorm2004CompletionStatusToken:
    async def test_initial_completion_status_is_valid_2004_token(self, db, org, admin_user):
        act = await _make_activity(db, org, "SCORM_2004", "activity_2004status")
        init = await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        status = init["cmi_data"]["cmi.completion_status"]
        # Must be a real 2004 token — never the enum slug "not_attempted".
        assert status in VALID_2004_COMPLETION, f"invalid 2004 token: {status!r}"

    async def test_completion_and_success_are_independent(self, db, org, admin_user):
        act = await _make_activity(db, org, "SCORM_2004", "activity_2004indep")
        await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        await rt.commit_scorm_data(None, act.activity_uuid, {
            "cmi.completion_status": "completed",
            "cmi.success_status": "failed",
        }, admin_user, db)
        data = await rt.get_runtime_data(None, act.activity_uuid, admin_user, db)
        assert data.completion_status == CompletionStatusEnum.COMPLETED
        assert data.success_status == SuccessStatusEnum.FAILED


class TestTotalTimeAccumulation:
    async def test_total_time_not_double_counted_across_commits(self, db, org, admin_user):
        """A SCO reports cumulative session_time and we auto-commit repeatedly.
        Final total_time must reflect the session once, not the sum of every commit."""
        act = await _make_activity(db, org, "SCORM_12", "activity_time12")
        await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)

        for st in ("00:00:30", "00:01:00", "00:01:30"):
            await rt.commit_scorm_data(None, act.activity_uuid,
                                       {"cmi.core.session_time": st}, admin_user, db)

        data = await rt.get_runtime_data(None, act.activity_uuid, admin_user, db)
        total = rt.parse_iso8601_duration(data.total_time)
        # Correct = 90s (the last cumulative session_time). Buggy code yields 180s.
        assert total == 90, f"total_time double-counted: {total}s"

    async def test_total_time_carries_across_sessions(self, db, org, admin_user):
        """A second session accumulates on top of the first session's total."""
        act = await _make_activity(db, org, "SCORM_12", "activity_time12b")
        # Session 1: 60s
        await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        await rt.commit_scorm_data(None, act.activity_uuid,
                                   {"cmi.core.session_time": "00:01:00"}, admin_user, db)
        # Session 2: another 40s -> total 100s
        await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        await rt.commit_scorm_data(None, act.activity_uuid,
                                   {"cmi.core.session_time": "00:00:40"}, admin_user, db)
        data = await rt.get_runtime_data(None, act.activity_uuid, admin_user, db)
        assert rt.parse_iso8601_duration(data.total_time) == 100


class TestSuspendDataOverflow:
    async def test_overflow_does_not_drop_completion_and_score(self, db, org, admin_user):
        act = await _make_activity(db, org, "SCORM_12", "activity_suspend12")
        await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)

        big = "S" * 5000  # over the 4096 SCORM 1.2 soft limit
        # Must not raise and must persist completion + score regardless of suspend size.
        await rt.commit_scorm_data(None, act.activity_uuid, {
            "cmi.core.lesson_status": "completed",
            "cmi.core.score.raw": "88",
            "cmi.suspend_data": big,
        }, admin_user, db)

        data = await rt.get_runtime_data(None, act.activity_uuid, admin_user, db)
        assert data.completion_status == CompletionStatusEnum.COMPLETED
        assert data.score_raw == 88
        assert data.suspend_data == big


class TestScorm12PassedFailed:
    async def test_passed_sets_success_status(self, db, org, admin_user):
        act = await _make_activity(db, org, "SCORM_12", "activity_passed12")
        await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        await rt.commit_scorm_data(None, act.activity_uuid,
                                   {"cmi.core.lesson_status": "passed",
                                    "cmi.core.score.raw": "95"}, admin_user, db)
        data = await rt.get_runtime_data(None, act.activity_uuid, admin_user, db)
        assert data.success_status == SuccessStatusEnum.PASSED


class TestInternalKeysNotLeaked:
    async def test_session_base_key_not_exposed_to_content(self, db, org, admin_user):
        act = await _make_activity(db, org, "SCORM_12", "activity_nointernal")
        await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        await rt.commit_scorm_data(None, act.activity_uuid,
                                   {"cmi.core.session_time": "00:00:30"}, admin_user, db)
        again = await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        leaked = [k for k in again["cmi_data"] if k.startswith("_lh_")]
        assert leaked == [], f"internal keys leaked to content: {leaked}"


async def _make_scorm_activity_in_course(db, org, course, version, uuid) -> Activity:
    """A SCORM activity wired to a real course so trail completion can resolve it."""
    activity = Activity(
        name="SCORM Activity",
        activity_type=ActivityTypeEnum.TYPE_SCORM,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_SCORM_12,
        activity_uuid=uuid,
        org_id=org.id,
        course_id=course.id,
        content={"scorm_version": version, "entry_point": "index.html"},
        details={},
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(activity)
    await db.commit()
    await db.refresh(activity)
    return activity


class TestRuntimeAuthorization:
    """P1: runtime endpoints must enforce course/org access, not just auth."""

    async def _foreign_scorm_activity(self, db, other_org):
        foreign_course = Course(
            name="Foreign", description="", course_uuid="course_foreign",
            org_id=other_org.id, public=False, learnings="", tags="",
            thumbnail_image="", open_to_contributors=False,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(foreign_course)
        await db.commit()
        await db.refresh(foreign_course)
        act = Activity(
            name="Foreign SCORM", activity_type=ActivityTypeEnum.TYPE_SCORM,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_SCORM_12,
            activity_uuid="activity_foreign", org_id=other_org.id,
            course_id=foreign_course.id,
            content={"scorm_version": "SCORM_12", "entry_point": "index.html"},
            details={}, creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(act)
        await db.commit()
        await db.refresh(act)
        return act

    async def test_cross_org_initialize_denied(self, db, org, other_org, admin_user, mock_request):
        act = await self._foreign_scorm_activity(db, other_org)
        with pytest.raises(HTTPException) as exc:
            await rt.initialize_scorm_session(mock_request, act.activity_uuid, admin_user, db)
        assert exc.value.status_code in (401, 403, 404)

    async def test_cross_org_commit_denied(self, db, org, other_org, admin_user, mock_request):
        act = await self._foreign_scorm_activity(db, other_org)
        with pytest.raises(HTTPException) as exc:
            await rt.commit_scorm_data(mock_request, act.activity_uuid,
                                       {"cmi.core.lesson_status": "completed"}, admin_user, db)
        assert exc.value.status_code in (401, 403, 404)


class TestCompletionSyncsToTrail:
    """P1: finishing a SCORM activity must credit LearnHouse course progress."""

    def _patch_trail_side_effects(self):
        return (
            patch("src.services.trail.trail.track", new_callable=AsyncMock),
            patch("src.services.trail.trail.dispatch_webhooks", new_callable=AsyncMock),
            patch("src.services.trail.trail.check_course_completion_and_create_certificate",
                  new_callable=AsyncMock),
        )

    async def test_completion_creates_trailstep(self, db, org, course, admin_user, mock_request):
        from src.db.trail_steps import TrailStep
        act = await _make_scorm_activity_in_course(db, org, course, "SCORM_12", "activity_trail_done")
        p1, p2, p3 = self._patch_trail_side_effects()
        with p1, p2, p3:
            await rt.initialize_scorm_session(mock_request, act.activity_uuid, admin_user, db)
            await rt.commit_scorm_data(mock_request, act.activity_uuid,
                                       {"cmi.core.lesson_status": "completed"}, admin_user, db)
        steps = (await db.execute(
            select(TrailStep).where(TrailStep.activity_id == act.id))).scalars().all()
        assert len(steps) == 1
        assert steps[0].complete is True

    async def test_incomplete_does_not_create_trailstep(self, db, org, course, admin_user, mock_request):
        from src.db.trail_steps import TrailStep
        act = await _make_scorm_activity_in_course(db, org, course, "SCORM_12", "activity_trail_inc")
        p1, p2, p3 = self._patch_trail_side_effects()
        with p1, p2, p3:
            await rt.initialize_scorm_session(mock_request, act.activity_uuid, admin_user, db)
            await rt.commit_scorm_data(mock_request, act.activity_uuid,
                                       {"cmi.core.lesson_status": "incomplete"}, admin_user, db)
        steps = (await db.execute(
            select(TrailStep).where(TrailStep.activity_id == act.id))).scalars().all()
        assert steps == []


class TestInstructorResults:
    """P1: instructors must be able to view learner SCORM results."""

    def _patch_trail(self):
        return (
            patch("src.services.trail.trail.track", new_callable=AsyncMock),
            patch("src.services.trail.trail.dispatch_webhooks", new_callable=AsyncMock),
            patch("src.services.trail.trail.check_course_completion_and_create_certificate",
                  new_callable=AsyncMock),
        )

    async def test_instructor_sees_results(self, db, org, course, admin_user, mock_request):
        act = await _make_scorm_activity_in_course(db, org, course, "SCORM_12", "activity_results1")
        p1, p2, p3 = self._patch_trail()
        with p1, p2, p3:
            await rt.initialize_scorm_session(mock_request, act.activity_uuid, admin_user, db)
            await rt.commit_scorm_data(mock_request, act.activity_uuid,
                                       {"cmi.core.lesson_status": "passed",
                                        "cmi.core.score.raw": "77"}, admin_user, db)
        results = await rt.get_activity_results(mock_request, act.activity_uuid, admin_user, db)
        assert len(results) == 1
        assert results[0].score_raw == 77
        assert results[0].completion_status == CompletionStatusEnum.PASSED
        assert results[0].email == admin_user.email

    async def test_learner_denied_results(self, db, org, course, regular_user, mock_request):
        act = await _make_scorm_activity_in_course(db, org, course, "SCORM_12", "activity_results2")
        with pytest.raises(HTTPException) as exc:
            await rt.get_activity_results(mock_request, act.activity_uuid, regular_user, db)
        assert exc.value.status_code in (401, 403)
