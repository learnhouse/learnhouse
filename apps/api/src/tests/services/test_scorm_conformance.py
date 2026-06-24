"""
SCORM conformance edge cases: duration parsing, time formatting, resume
(entry/exit) semantics, and not echoing write-only elements to content.
Skips cleanly when EE is absent.
"""

from datetime import datetime

import pytest

rt = pytest.importorskip("ee.services.scorm.scorm_runtime")
from ee.db.scorm import CompletionStatusEnum  # noqa: E402,F401
from src.db.courses.activities import (  # noqa: E402
    Activity, ActivitySubTypeEnum, ActivityTypeEnum,
)


class TestDurationParsing:
    @pytest.mark.parametrize("text,expected", [
        ("", 0),
        ("PT1H", 3600),
        ("PT1H30M", 5400),
        ("PT1M30S", 90),
        ("PT30S", 30),
        ("00:01:30", 90),         # SCORM 1.2 CMITimespan
        ("01:00:00", 3600),
        ("P1DT2H", 86400 + 7200),  # full ISO 8601 with days
        ("P1W", 7 * 86400),        # week form
        ("PT0.75S", 0),            # fractional truncates to int seconds
        ("garbage", 0),
    ])
    def test_parse(self, text, expected):
        assert rt.parse_iso8601_duration(text) == expected


class TestTimeFormatting:
    def test_hours_clamped_to_four_digits(self):
        # 10000h would be 5 digits; CMITimespan caps at 9999.
        assert rt.format_scorm_12_time(10000 * 3600) == "9999:00:00.00"

    def test_round_trip(self):
        assert rt.format_scorm_12_time(3723) == "0001:02:03.00"


async def _activity(db, org, version, uuid):
    activity = Activity(
        name="A", activity_type=ActivityTypeEnum.TYPE_SCORM,
        activity_sub_type=(ActivitySubTypeEnum.SUBTYPE_SCORM_2004 if version == "SCORM_2004"
                           else ActivitySubTypeEnum.SUBTYPE_SCORM_12),
        activity_uuid=uuid, org_id=org.id,
        content={"scorm_version": version, "entry_point": "index.html"}, details={},
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(activity)
    await db.commit()
    await db.refresh(activity)
    return activity


class TestResumeEntryExit:
    async def test_exit_suspend_resumes(self, db, org, admin_user):
        act = await _activity(db, org, "SCORM_12", "activity_exit_suspend")
        await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        await rt.commit_scorm_data(None, act.activity_uuid, {
            "cmi.core.lesson_status": "incomplete",
            "cmi.core.exit": "suspend",
            "cmi.suspend_data": "state",
        }, admin_user, db)
        again = await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        assert again["cmi_data"]["cmi.core.entry"] == "resume"

    async def test_exit_normal_starts_fresh(self, db, org, admin_user):
        act = await _activity(db, org, "SCORM_12", "activity_exit_normal")
        await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        await rt.commit_scorm_data(None, act.activity_uuid, {
            "cmi.core.lesson_status": "completed",
            "cmi.core.exit": "normal",
            "cmi.suspend_data": "state",
        }, admin_user, db)
        again = await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        assert again["cmi_data"]["cmi.core.entry"] == "ab-initio"


class TestCmiDataPersistence:
    async def test_interactions_persist_across_commits(self, db, org, admin_user):
        act = await _activity(db, org, "SCORM_12", "activity_interactions")
        await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        await rt.commit_scorm_data(None, act.activity_uuid, {
            "cmi.interactions.0.id": "q1",
            "cmi.interactions.0.result": "correct",
            "cmi.objectives.0.id": "obj1",
        }, admin_user, db)
        again = await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        cmi = again["cmi_data"]
        assert cmi.get("cmi.interactions.0.id") == "q1"
        assert cmi.get("cmi.interactions.0.result") == "correct"
        assert cmi.get("cmi.objectives.0.id") == "obj1"

    async def test_array_counts_injected_on_resume(self, db, org, admin_user):
        act = await _activity(db, org, "SCORM_12", "activity_counts")
        await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        await rt.commit_scorm_data(None, act.activity_uuid, {
            "cmi.interactions.0.id": "q1",
            "cmi.interactions.1.id": "q2",
            "cmi.objectives.0.id": "o1",
        }, admin_user, db)
        again = await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        cmi = again["cmi_data"]
        assert cmi.get("cmi.interactions._count") == "2"
        assert cmi.get("cmi.objectives._count") == "1"


class TestMasteryScore:
    async def test_mastery_score_exposed_in_initial_cmi(self, db, org, admin_user):
        act = Activity(
            name="A", activity_type=ActivityTypeEnum.TYPE_SCORM,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_SCORM_12,
            activity_uuid="activity_mastery", org_id=org.id,
            content={"scorm_version": "SCORM_12", "entry_point": "index.html", "mastery_score": "80"},
            details={}, creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(act)
        await db.commit()
        await db.refresh(act)
        init = await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        assert init["cmi_data"]["cmi.student_data.mastery_score"] == "80"


class TestWriteOnlyNotEchoed:
    async def test_session_time_and_exit_not_returned(self, db, org, admin_user):
        act = await _activity(db, org, "SCORM_12", "activity_writeonly")
        await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        await rt.commit_scorm_data(None, act.activity_uuid, {
            "cmi.core.session_time": "00:00:30",
            "cmi.core.exit": "suspend",
        }, admin_user, db)
        again = await rt.initialize_scorm_session(None, act.activity_uuid, admin_user, db)
        cmi = again["cmi_data"]
        assert "cmi.core.session_time" not in cmi
        assert "cmi.core.exit" not in cmi or cmi.get("cmi.core.exit") == ""
