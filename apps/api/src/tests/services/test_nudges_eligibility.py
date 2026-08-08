"""Tests for src/services/nudges/eligibility.py."""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import event

from src.db.courses.courses import Course
from src.db.organization_config import OrganizationConfig
from src.services.nudges.eligibility import build_snapshots, iter_snapshots


def _ts(days_ago: float = 0) -> str:
    """A stored timestamp in the naive format the schema actually uses."""
    return str(datetime.now() - timedelta(days=days_ago))


async def _snapshot(db, org, **kwargs):
    snapshots = await build_snapshots(db, [org], **kwargs)
    return snapshots[0]


async def _db_user(db, user_id: int):
    """The persisted User row.

    The ``admin_user`` fixture hands back a ``PublicUser`` projection, which
    has no ``email_verified``; anything mutating mail eligibility needs the
    real row.
    """
    from sqlmodel import select

    from src.db.users import User

    return (await db.execute(select(User).where(User.id == user_id))).scalars().first()


class TestSnapshotShape:
    async def test_bare_org_yields_zeroed_counts(self, db, org):
        snap = await _snapshot(db, org)

        assert snap.org_id == org.id
        assert snap.org_slug == org.slug
        assert snap.course_count == 0
        assert snap.member_count == 0
        assert snap.admins == ()
        assert snap.plan == "free"
        assert snap.lang == "en"

    async def test_course_counts_and_flags(self, db, org, course):
        snap = await _snapshot(db, org)

        assert snap.course_count == 1
        assert snap.published_course_count == 1
        assert snap.public_course_count == 1
        assert snap.newest_course_uuid == "course_test"
        assert snap.newest_course_name == "Test Course"
        # Published, so there is no draft to link to.
        assert snap.oldest_draft_course_uuid is None

    async def test_draft_course_is_identified_for_deep_linking(self, db, org):
        db.add(
            Course(
                id=7,
                name="Draft Course",
                description="",
                public=False,
                published=False,
                open_to_contributors=False,
                org_id=org.id,
                course_uuid="course_draft",
                creation_date=_ts(4),
                update_date=_ts(4),
            )
        )
        await db.commit()

        snap = await _snapshot(db, org)
        assert snap.published_course_count == 0
        assert snap.oldest_draft_course_uuid == "course_draft"
        assert snap.oldest_draft_course_name == "Draft Course"

    async def test_content_counts(self, db, org, course, chapter, activity):
        snap = await _snapshot(db, org)

        assert snap.chapter_count == 1
        assert snap.activity_count == 1
        assert snap.published_activity_count == 1
        assert snap.content_exists is True

    async def test_admins_are_collected(self, db, org, admin_user):
        snap = await _snapshot(db, org)

        assert len(snap.admins) == 1
        assert snap.admins[0].user_id == admin_user.id
        assert snap.admins[0].email == admin_user.email

    async def test_members_and_admins_are_counted_separately(
        self, db, org, admin_user, regular_user
    ):
        snap = await _snapshot(db, org)

        assert snap.admin_count == 1
        assert snap.member_count == 1


class TestMailableAdmins:
    async def test_unverified_admins_are_excluded(self, db, org, admin_user):
        """Mailing unconfirmed addresses is the fastest way to lose a sending
        domain — and it takes the transactional mail down with it."""
        row = await _db_user(db, admin_user.id)
        row.email_verified = False
        db.add(row)
        await db.commit()

        snap = await _snapshot(db, org)
        assert len(snap.admins) == 1
        assert snap.mailable_admins == ()

    async def test_verified_admins_are_mailable(self, db, org, admin_user):
        row = await _db_user(db, admin_user.id)
        row.email_verified = True
        db.add(row)
        await db.commit()

        snap = await _snapshot(db, org)
        assert len(snap.mailable_admins) == 1

    async def test_admin_without_a_usable_email_is_excluded(self, db, org, admin_user):
        row = await _db_user(db, admin_user.id)
        row.email_verified = True
        row.email = "not-an-email"
        db.add(row)
        await db.commit()

        snap = await _snapshot(db, org)
        assert snap.mailable_admins == ()

    async def test_display_name_falls_back_through_to_a_greeting(self, db, org, admin_user):
        row = await _db_user(db, admin_user.id)
        row.email_verified = True
        row.first_name = ""
        db.add(row)
        await db.commit()

        snap = await _snapshot(db, org)
        assert snap.admins[0].display_name == "admin"

        row.username = ""
        db.add(row)
        await db.commit()
        snap = await _snapshot(db, org)
        assert snap.admins[0].display_name == "there"


class TestTimestampHandling:
    async def test_naive_string_dates_parse_to_utc(self, db, org):
        snap = await _snapshot(db, org)

        assert snap.created_at is not None
        assert snap.created_at.tzinfo is not None
        assert snap.org_age_days is not None and snap.org_age_days < 1

    @pytest.mark.parametrize("bad", ["", "not-a-date", "2026-13-45"])
    async def test_unparseable_dates_degrade_to_none(self, db, org, bad):
        """A malformed timestamp must skip the org, never crash the run."""
        org.creation_date = bad
        db.add(org)
        await db.commit()

        snap = await _snapshot(db, org)
        assert snap.created_at is None
        assert snap.org_age_days is None

    async def test_iso_z_dates_parse(self, db, org):
        org.creation_date = "2026-07-01T10:00:00Z"
        db.add(org)
        await db.commit()

        snap = await _snapshot(db, org)
        assert snap.created_at is not None
        assert snap.created_at.tzinfo is not None

    async def test_last_touch_prefers_the_newest_signal(self, db, org, course):
        course.update_date = _ts(0)
        org.creation_date = _ts(100)
        db.add_all([course, org])
        await db.commit()

        snap = await _snapshot(db, org)
        assert snap.days_since_touch is not None
        assert snap.days_since_touch < 1

    async def test_org_active_reflects_recent_activity(self, db, org, course):
        snap = await _snapshot(db, org)
        assert snap.org_active is True

    async def test_org_with_only_old_signals_is_not_active(self, db, org):
        org.creation_date = _ts(90)
        org.update_date = _ts(90)
        db.add(org)
        await db.commit()

        snap = await _snapshot(db, org)
        assert snap.org_active is False
        assert snap.days_since_touch > 80


class TestPlanAndConfig:
    async def test_v1_config_plan_is_read(self, db, org):
        db.add(
            OrganizationConfig(
                org_id=org.id,
                config={"config_version": "1.4", "cloud": {"plan": "pro"}},
                creation_date=_ts(),
                update_date=_ts(),
            )
        )
        await db.commit()

        snap = await _snapshot(db, org)
        assert snap.plan == "pro"

    async def test_v2_config_plan_and_active_flag_are_read(self, db, org):
        db.add(
            OrganizationConfig(
                org_id=org.id,
                config={"config_version": "2.0", "plan": "standard", "active": False},
                creation_date=_ts(),
                update_date=_ts(),
            )
        )
        await db.commit()

        snap = await _snapshot(db, org)
        assert snap.plan == "standard"
        assert snap.org_active_flag is False

    async def test_missing_config_defaults_to_free_and_active(self, db, org):
        snap = await _snapshot(db, org)
        assert snap.plan == "free"
        assert snap.org_active_flag is True


class TestTrailRunFacts:
    async def test_statuses_are_split(self, db, org, course, admin_user):
        from src.db.trail_runs import StatusEnum, TrailRun
        from src.db.trails import Trail

        db.add(
            Trail(
                id=1,
                org_id=org.id,
                user_id=admin_user.id,
                trail_uuid="trail_1",
                creation_date=_ts(5),
                update_date=_ts(5),
            )
        )
        # A run is unique per (trail, course, user), so the two statuses need
        # two courses.
        db.add(
            Course(
                id=2,
                name="Second Course",
                description="",
                public=True,
                published=True,
                open_to_contributors=False,
                org_id=org.id,
                course_uuid="course_second",
                creation_date=_ts(5),
                update_date=_ts(5),
            )
        )
        await db.commit()

        for index, (course_id, status) in enumerate(
            (
                (course.id, StatusEnum.STATUS_IN_PROGRESS),
                (2, StatusEnum.STATUS_COMPLETED),
            ),
            start=1,
        ):
            db.add(
                TrailRun(
                    id=index,
                    trail_id=1,
                    course_id=course_id,
                    org_id=org.id,
                    user_id=admin_user.id,
                    status=status,
                    data={},
                    creation_date=_ts(5),
                    update_date=_ts(2),
                )
            )
        await db.commit()

        snap = await _snapshot(db, org)
        assert snap.trailrun_count == 2
        assert snap.in_progress_trailrun_count == 1
        assert snap.completed_trailrun_count == 1
        assert snap.first_completed_trailrun_at is not None


class TestAssignmentFacts:
    async def test_assignments_and_submissions_are_counted(
        self, db, org, course, chapter, activity, admin_user
    ):
        """Submissions carry no org_id of their own — they are counted through
        AssignmentTask, which does."""
        from src.db.courses.assignments import (
            Assignment,
            AssignmentTask,
            AssignmentTaskSubmission,
            GradingTypeEnum,
        )

        db.add(
            Assignment(
                id=1,
                title="Essay",
                description="",
                assignment_uuid="assignment_1",
                org_id=org.id,
                course_id=course.id,
                chapter_id=chapter.id,
                activity_id=activity.id,
                published=True,
                due_date=_ts(-7),
                grading_type=GradingTypeEnum.ALPHABET,
                creation_date=_ts(6),
                update_date=_ts(6),
            )
        )
        await db.commit()

        snap = await _snapshot(db, org)
        assert snap.assignment_count == 1
        assert snap.assignment_submission_count == 0
        assert snap.last_assignment_created_at is not None

        db.add(
            AssignmentTask(
                id=1,
                title="Task",
                description="",
                hint="",
                reference_file="",
                assignment_task_uuid="assignmenttask_1",
                assignment_id=1,
                org_id=org.id,
                course_id=course.id,
                chapter_id=chapter.id,
                activity_id=activity.id,
                assignment_type="FILE_SUBMISSION",
                contents={},
                max_grade_value=100,
                creation_date=_ts(6),
                update_date=_ts(6),
            )
        )
        await db.commit()
        db.add(
            AssignmentTaskSubmission(
                id=1,
                assignment_task_submission_uuid="submission_1",
                task_submission={},
                assignment_type="FILE_SUBMISSION",
                grade=0,
                task_submission_grade_feedback="",
                user_id=admin_user.id,
                assignment_task_id=1,
                course_id=course.id,
                activity_id=activity.id,
                creation_date=_ts(1),
                update_date=_ts(1),
            )
        )
        await db.commit()

        snap = await _snapshot(db, org)
        assert snap.assignment_submission_count == 1


class TestAiCreditUsage:
    async def test_absent_redis_reads_as_no_usage(self, db, org, monkeypatch):
        """A background job must not depend on a cache being up — the credit
        nudge simply never fires instead."""
        from src.services.nudges import eligibility

        monkeypatch.setattr(
            "src.core.redis.get_redis_client", lambda: None, raising=False
        )
        assert await eligibility._ai_credit_usage([org.id]) == {}

        snap = await _snapshot(db, org)
        assert snap.ai_credits_used == 0

    async def test_usage_is_read_in_one_round_trip(self, monkeypatch):
        from src.services.nudges import eligibility

        calls = []

        class FakeRedis:
            def mget(self, keys):
                calls.append(keys)
                return ["7", None, "not-a-number"]

        monkeypatch.setattr(
            "src.core.redis.get_redis_client", lambda: FakeRedis(), raising=False
        )

        usage = await eligibility._ai_credit_usage([1, 2, 3])
        assert usage == {1: 7, 2: 0, 3: 0}
        assert len(calls) == 1
        assert calls[0] == [
            "ai_credits_used:1",
            "ai_credits_used:2",
            "ai_credits_used:3",
        ]

    async def test_redis_failure_is_swallowed(self, monkeypatch):
        from src.services.nudges import eligibility

        class Exploding:
            def mget(self, keys):
                raise RuntimeError("redis is down")

        monkeypatch.setattr(
            "src.core.redis.get_redis_client", lambda: Exploding(), raising=False
        )
        assert await eligibility._ai_credit_usage([1]) == {}


class TestIteration:
    async def test_iter_yields_every_org(self, db, org, other_org):
        seen = [s.org_id async for s in iter_snapshots(db)]
        assert set(seen) == {org.id, other_org.id}

    async def test_iter_can_target_a_single_org(self, db, org, other_org):
        seen = [s.org_id async for s in iter_snapshots(db, org_id=other_org.id)]
        assert seen == [other_org.id]

    async def test_small_chunks_still_cover_everything(self, db, org, other_org):
        seen = [s.org_id async for s in iter_snapshots(db, chunk_size=1)]
        assert set(seen) == {org.id, other_org.id}

    async def test_empty_batch_returns_no_snapshots(self, db):
        assert await build_snapshots(db, []) == []


class TestQueryCount:
    async def test_query_count_does_not_grow_with_org_count(
        self, db, engine, org, other_org
    ):
        """The anti-N+1 guarantee.

        This job runs against every organization daily. If the query count
        tracks the org count, it stops being viable well before the org count
        becomes interesting.
        """

        counter = {"n": 0}

        @event.listens_for(engine.sync_engine, "before_cursor_execute")
        def _count(conn, cursor, statement, params, context, executemany):
            counter["n"] += 1

        try:
            counter["n"] = 0
            await build_snapshots(db, [org])
            one_org = counter["n"]

            counter["n"] = 0
            await build_snapshots(db, [org, other_org])
            two_orgs = counter["n"]
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", _count)

        assert one_org == two_orgs, (
            f"{one_org} queries for 1 org vs {two_orgs} for 2 — the scan is per-org"
        )
