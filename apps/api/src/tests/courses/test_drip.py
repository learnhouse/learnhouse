"""Drip content: chapter release rules and every read path that enforces them.

Covers the pure schedule maths (``compute_drip_states``), the reader-aware
wrapper (enrollment date, progress), the course tree, the single-activity
gate, the AI assistant's access filter, and the schedule edit endpoints.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from src.core.events.database import get_db_session
from src.db.courses.activities import Activity, ActivityRead, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.drip import (
    MAX_DELAY_DAYS,
    ChapterDripRule,
    CourseDripSettings,
    DripAnchor,
    DripLockReason,
    DripScheduleUpdate,
)
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.trails import Trail
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.routers.courses.courses import router as courses_router
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_courses_feature
from src.services.courses import drip as drip_service
from src.services.courses.activities.access import _reader_state, apply_activity_lock
from src.services.courses.chapters import get_course_chapters
from src.services.courses.drip import (
    DripState,
    _parse_timestamp,
    chapter_drip_rule,
    chapter_drip_state,
    compute_drip_states,
    course_drip_settings,
    drip_states_for_reader,
    enrollment_date,
    get_drip_schedule,
    update_drip_schedule,
)


NOW = datetime(2026, 11, 2, 12, 0, tzinfo=timezone.utc)
ENROLL = {"enabled": True, "anchor": "enrollment"}


def _settings(**overrides) -> CourseDripSettings:
    return CourseDripSettings.model_validate({**ENROLL, **overrides})


def _delay(days: int, **extra) -> dict:
    return {"mode": "delay", "delay_days": days, **extra}


# ── Models ──────────────────────────────────────────────────────────────────


class TestModels:
    def test_fixed_anchor_needs_start_date(self):
        with pytest.raises(ValidationError):
            CourseDripSettings(enabled=True, anchor=DripAnchor.FIXED_DATE)

    def test_disabled_fixed_anchor_without_date_is_fine(self):
        assert CourseDripSettings(enabled=False, anchor=DripAnchor.FIXED_DATE).start_date is None

    def test_naive_dates_are_read_as_utc(self):
        s = CourseDripSettings(enabled=True, anchor="fixed_date", start_date="2026-11-10T09:00:00")
        assert s.start_date == datetime(2026, 11, 10, 9, tzinfo=timezone.utc)
        r = ChapterDripRule(mode="date", release_at="2026-11-10T09:00:00+02:00")
        assert r.release_at == datetime(2026, 11, 10, 7, tzinfo=timezone.utc)

    def test_date_mode_needs_release_at(self):
        with pytest.raises(ValidationError):
            ChapterDripRule(mode="date")

    def test_delay_is_bounded(self):
        with pytest.raises(ValidationError):
            ChapterDripRule(mode="delay", delay_days=MAX_DELAY_DAYS + 1)
        with pytest.raises(ValidationError):
            ChapterDripRule(mode="delay", delay_days=-1)


# ── Parsing stored values ───────────────────────────────────────────────────


class TestStoredValues:
    def test_course_settings_off_when_missing_disabled_or_invalid(self):
        class C:
            drip_settings = None

        c = C()
        assert course_drip_settings(c) is None
        c.drip_settings = {"enabled": False}
        assert course_drip_settings(c) is None
        c.drip_settings = {"enabled": True, "anchor": "fixed_date"}  # no start date
        assert course_drip_settings(c) is None
        c.drip_settings = ENROLL
        assert course_drip_settings(c).anchor == DripAnchor.ENROLLMENT

    def test_invalid_rule_falls_back_to_immediate(self):
        assert chapter_drip_rule(None).mode.value == "immediate"
        assert chapter_drip_rule({"mode": "date"}).mode.value == "immediate"
        assert chapter_drip_rule(_delay(3)).delay_days == 3

    def test_parse_timestamp(self):
        assert _parse_timestamp(None) is None
        assert _parse_timestamp("not a date") is None
        # Naive values are the server's local time, like str(datetime.now()).
        assert _parse_timestamp("2026-11-01 10:00:00.123") == datetime(2026, 11, 1, 10, 0, 0, 123000).astimezone(timezone.utc)
        local = datetime.now().replace(microsecond=0)
        assert abs(_parse_timestamp(str(local)) - datetime.now(timezone.utc)) < timedelta(seconds=5)
        aware = _parse_timestamp("2026-11-01T10:00:00+01:00")
        assert aware.utcoffset() == timedelta(hours=1)

    def test_state_iso(self):
        assert DripState().unlock_at_iso is None
        assert DripState(unlock_at=NOW).unlock_at_iso == NOW.isoformat()


# ── Schedule maths ──────────────────────────────────────────────────────────


class TestComputeDripStates:
    def test_enrollment_delays(self):
        anchor = NOW - timedelta(days=8)
        states = compute_drip_states(
            _settings(),
            [(1, None), (2, _delay(7)), (3, _delay(14))],
            {},
            anchor,
            set(),
            NOW,
        )
        assert not states[1].locked
        assert not states[2].locked
        assert states[3].locked
        assert states[3].reason == DripLockReason.SCHEDULE
        assert states[3].unlock_at == anchor + timedelta(days=14)

    def test_not_enrolled_keeps_day_zero_open(self):
        states = compute_drip_states(
            _settings(), [(1, None), (2, _delay(0)), (3, _delay(7))], {}, None, set(), NOW
        )
        assert not states[1].locked
        assert not states[2].locked
        assert states[3].locked
        assert states[3].reason == DripLockReason.ENROLLMENT
        assert states[3].unlock_at is None

    def test_fixed_start_date_holds_everything_until_start(self):
        start = NOW + timedelta(days=2)
        settings = _settings(anchor="fixed_date", start_date=start.isoformat())
        states = compute_drip_states(settings, [(1, None), (2, _delay(7))], {}, start, set(), NOW)
        assert states[1].unlock_at == start
        assert states[2].unlock_at == start + timedelta(days=7)

        later = compute_drip_states(settings, [(1, None), (2, _delay(7))], {}, start, set(), start + timedelta(days=1))
        assert not later[1].locked
        assert later[2].locked

    def test_fixed_date_release(self):
        rule = {"mode": "date", "release_at": (NOW + timedelta(hours=3)).isoformat()}
        states = compute_drip_states(_settings(), [(1, rule)], {}, None, set(), NOW)
        assert states[1].locked and states[1].unlock_at == NOW + timedelta(hours=3)
        states = compute_drip_states(_settings(), [(1, rule)], {}, None, set(), NOW + timedelta(hours=4))
        assert not states[1].locked

    def test_require_previous(self):
        chapters = [(1, {"mode": "immediate", "require_previous": True}), (2, {"require_previous": True}), (3, {"require_previous": True})]
        activities = {1: [10, 11], 2: [], 3: [30]}

        states = compute_drip_states(_settings(), chapters, activities, NOW, {10}, NOW)
        assert not states[1].locked  # first chapter has no previous one
        assert states[2].locked and states[2].reason == DripLockReason.PREVIOUS
        assert states[3].locked  # chain: chapter 2 is not done while locked

        states = compute_drip_states(_settings(), chapters, activities, NOW, {10, 11}, NOW)
        assert not states[2].locked
        assert not states[3].locked  # chapter 2 has no activities: done once open

    def test_schedule_reason_wins_over_previous(self):
        chapters = [(1, None), (2, _delay(3, require_previous=True))]
        states = compute_drip_states(_settings(), chapters, {1: [10]}, NOW, set(), NOW)
        assert states[2].reason == DripLockReason.SCHEDULE


# ── DB helpers ──────────────────────────────────────────────────────────────


async def _add_chapter(db, org, course, chapter_id, order, rule=None):
    ch = Chapter(
        id=chapter_id,
        name=f"Chapter {chapter_id}",
        description="",
        org_id=org.id,
        course_id=course.id,
        chapter_uuid=f"chapter_{chapter_id}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        drip_rule=rule,
    )
    db.add(ch)
    db.add(CourseChapter(
        chapter_id=chapter_id, course_id=course.id, org_id=org.id, order=order,
        creation_date="", update_date="",
    ))
    await db.commit()
    return ch


async def _add_activity(db, org, course, chapter_id, activity_id, published=True):
    a = Activity(
        id=activity_id,
        name=f"Activity {activity_id}",
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={"type": "doc", "content": [{"type": "paragraph"}]},
        published=published,
        org_id=org.id,
        course_id=course.id,
        activity_uuid=f"activity_{activity_id}",
        creation_date="",
        update_date="",
    )
    db.add(a)
    db.add(ChapterActivity(
        order=activity_id, chapter_id=chapter_id, activity_id=activity_id,
        course_id=course.id, org_id=org.id, creation_date="", update_date="",
    ))
    await db.commit()
    return a


async def _enroll(db, org, course, user_id, when: datetime, run_id=1):
    db.add(Trail(id=run_id, org_id=org.id, user_id=user_id, trail_uuid=f"trail_{run_id}"))
    db.add(TrailRun(
        id=run_id, trail_id=run_id, course_id=course.id, org_id=org.id, user_id=user_id,
        creation_date=str(when.astimezone().replace(tzinfo=None)), update_date="",  # local, like trail.py
    ))
    await db.commit()


async def _complete(db, org, course, user_id, activity_id, run_id=1):
    db.add(TrailStep(
        complete=True, teacher_verified=False, grade="", trailrun_id=run_id, trail_id=run_id,
        activity_id=activity_id, course_id=course.id, org_id=org.id, user_id=user_id,
        creation_date="", update_date="",
    ))
    await db.commit()


@pytest.fixture
async def drip_course(db, org, course):
    """Three chapters: open, day 7, day 14 with 'previous chapter done'."""
    course.drip_settings = ENROLL
    db.add(course)
    await db.commit()
    await _add_chapter(db, org, course, 1, 1)
    await _add_chapter(db, org, course, 2, 2, _delay(7))
    await _add_chapter(db, org, course, 3, 3, _delay(14, require_previous=True))
    await _add_activity(db, org, course, 1, 1)
    await _add_activity(db, org, course, 2, 2)
    await _add_activity(db, org, course, 2, 4, published=False)
    await _add_activity(db, org, course, 3, 3)
    return course


@pytest.fixture
def tree_patches():
    with patch("src.services.courses.chapters.check_resource_access", new_callable=AsyncMock), \
         patch("src.services.courses.chapters.check_ee_activity_paid_access", new=AsyncMock(return_value=True)), \
         patch("src.services.courses.activities.access.can_edit_course", new=AsyncMock(return_value=False)):
        yield


# ── Reader-aware states ─────────────────────────────────────────────────────


class TestReaderStates:
    async def test_no_schedule_returns_nothing(self, db, course, regular_user):
        assert await drip_states_for_reader(course, [(1, None)], {}, regular_user, db) == {}

    async def test_enrollment_date_uses_first_run(self, db, org, course, regular_user):
        assert await enrollment_date(regular_user.id, course.id, db) is None
        await _enroll(db, org, course, regular_user.id, NOW - timedelta(days=3))
        db.add(Trail(id=2, org_id=org.id, user_id=regular_user.id, trail_uuid="trail_2"))
        db.add(TrailRun(
            id=2, trail_id=2, course_id=course.id, org_id=org.id, user_id=regular_user.id,
            creation_date="garbage", update_date="",
        ))
        await db.commit()
        assert await enrollment_date(regular_user.id, course.id, db) == NOW - timedelta(days=3)

    async def test_fixed_anchor_and_anonymous(self, db, drip_course, anonymous_user):
        drip_course.drip_settings = {"enabled": True, "anchor": "fixed_date", "start_date": (NOW - timedelta(days=10)).isoformat()}
        states = await drip_states_for_reader(
            drip_course, [(1, None), (2, _delay(7)), (3, _delay(14))], {}, anonymous_user, db, NOW,
        )
        assert [states[i].locked for i in (1, 2, 3)] == [False, False, True]

    async def test_anonymous_enrollment_course(self, db, drip_course, anonymous_user):
        states = await drip_states_for_reader(drip_course, [(1, None), (2, _delay(7))], {}, anonymous_user, db, NOW)
        assert states[2].reason == DripLockReason.ENROLLMENT

    async def test_chapter_state_with_and_without_previous(self, db, org, drip_course, regular_user):
        chapter2 = await db.get(Chapter, 2)
        chapter3 = await db.get(Chapter, 3)
        await _enroll(db, org, drip_course, regular_user.id, NOW - timedelta(days=20))

        assert not (await chapter_drip_state(drip_course, chapter2, regular_user, db, NOW)).locked
        state = await chapter_drip_state(drip_course, chapter3, regular_user, db, NOW)
        assert state.reason == DripLockReason.PREVIOUS

        # Only published activities of chapter 2 count.
        await _complete(db, org, drip_course, regular_user.id, 2)
        assert not (await chapter_drip_state(drip_course, chapter3, regular_user, db, NOW)).locked

    async def test_chapter_state_without_schedule(self, db, course, chapter, regular_user):
        assert await chapter_drip_state(course, chapter, regular_user, db) is None

    async def test_published_activity_ids_empty(self, db):
        assert await drip_service._published_activity_ids([], db) == {}


# ── Course tree ─────────────────────────────────────────────────────────────


class TestCourseTree:
    async def test_learner_sees_schedule(self, db, org, drip_course, regular_user, mock_request, tree_patches):
        chapters = await get_course_chapters(
            mock_request, drip_course.id, db, regular_user, with_unpublished_activities=False, course=drip_course,
        )
        ch1, ch2, ch3 = chapters
        assert not ch1.is_locked and ch1.activities[0].content
        assert ch2.is_locked and ch2.drip_locked
        assert ch2.drip_reason == "enrollment"
        assert ch2.activities[0].is_locked and ch2.activities[0].content == {}
        assert ch2.activities[0].drip_reason == "enrollment"

    async def test_enrolled_learner_after_a_week(self, db, org, drip_course, regular_user, mock_request, tree_patches):
        enrolled = datetime.now(timezone.utc) - timedelta(days=8)
        await _enroll(db, org, drip_course, regular_user.id, enrolled)
        ch1, ch2, ch3 = await get_course_chapters(
            mock_request, drip_course.id, db, regular_user, with_unpublished_activities=False, course=drip_course,
        )
        assert not ch2.is_locked and ch2.activities[0].content
        assert ch3.drip_locked and ch3.drip_reason == "schedule"
        assert datetime.fromisoformat(ch3.drip_unlock_at) == enrolled.replace(microsecond=enrolled.microsecond) + timedelta(days=14)

    async def test_admin_sees_everything(self, db, drip_course, admin_user, mock_request, tree_patches):
        chapters = await get_course_chapters(
            mock_request, drip_course.id, db, admin_user, with_unpublished_activities=False, course=drip_course,
        )
        assert not any(c.drip_locked for c in chapters)

    async def test_editor_sees_everything(self, db, drip_course, regular_user, mock_request):
        with patch("src.services.courses.chapters.check_resource_access", new_callable=AsyncMock), \
             patch("src.services.courses.chapters.check_ee_activity_paid_access", new=AsyncMock(return_value=True)), \
             patch("src.services.courses.activities.access.can_edit_course", new=AsyncMock(return_value=True)):
            chapters = await get_course_chapters(
                mock_request, drip_course.id, db, regular_user, with_unpublished_activities=False, course=drip_course,
            )
        assert not any(c.drip_locked for c in chapters)

    async def test_course_without_schedule_is_untouched(self, db, course, chapter, regular_user, mock_request):
        from src.db.courses.chapters import ChapterRead

        reads = [ChapterRead(**chapter.model_dump(), activities=[])]
        with patch("src.services.courses.activities.access.can_edit_course", new=AsyncMock()) as can_edit:
            await drip_service.apply_drip_to_chapters(reads, course, regular_user, db, mock_request)
        can_edit.assert_not_awaited()
        assert not reads[0].drip_locked

    async def test_without_request_editors_are_not_checked(self, db, drip_course, regular_user):
        from src.db.courses.chapters import ChapterRead

        reads = [ChapterRead(**(await db.get(Chapter, i)).model_dump(), activities=[]) for i in (1, 2)]
        await drip_service.apply_drip_to_chapters(reads, drip_course, regular_user, db, None)
        assert not reads[0].drip_locked and reads[1].drip_locked


# ── Single activity gate ────────────────────────────────────────────────────


class TestActivityGate:
    async def test_unreleased_activity_is_scrubbed(self, db, drip_course, regular_user):
        activity = await db.get(Activity, 2)
        read = ActivityRead.model_validate(activity)
        await apply_activity_lock(read, activity, drip_course, regular_user, db)
        assert read.is_locked and read.content == {}
        assert read.drip_reason == "enrollment"

    async def test_released_activity_passes(self, db, org, drip_course, regular_user):
        await _enroll(db, org, drip_course, regular_user.id, datetime.now(timezone.utc) - timedelta(days=8))
        activity = await db.get(Activity, 2)
        read = ActivityRead.model_validate(activity)
        await apply_activity_lock(read, activity, drip_course, regular_user, db, parent_chapter=await db.get(Chapter, 2))
        assert not read.is_locked and read.content

    async def test_course_usergroup_does_not_skip_the_schedule(self, db, org, drip_course, regular_user):
        db.add(UserGroup(id=1, name="g", description="", org_id=org.id, usergroup_uuid="ug_1", creation_date="", update_date=""))
        db.add(UserGroupUser(usergroup_id=1, user_id=regular_user.id, org_id=org.id, creation_date="", update_date=""))
        db.add(UserGroupResource(usergroup_id=1, resource_uuid=drip_course.course_uuid, org_id=org.id, creation_date="", update_date=""))
        await db.commit()
        activity = await db.get(Activity, 2)
        read = ActivityRead.model_validate(activity)
        await apply_activity_lock(read, activity, drip_course, regular_user, db)
        assert read.is_locked

    async def test_editor_gets_content_back(self, db, drip_course, regular_user, mock_request):
        activity = await db.get(Activity, 2)
        read = ActivityRead.model_validate(activity)
        with patch("src.services.courses.activities.access.check_ee_activity_paid_access", new=AsyncMock(return_value=True)), \
             patch("src.services.courses.activities.access.can_edit_course", new=AsyncMock(return_value=True)):
            state = await _reader_state(mock_request, read, activity, drip_course, regular_user, db)
        assert state == "ok"
        assert not read.is_locked and read.drip_reason is None and read.drip_unlock_at is None
        assert read.content

    async def test_learner_is_locked(self, db, drip_course, regular_user, mock_request):
        activity = await db.get(Activity, 2)
        read = ActivityRead.model_validate(activity)
        with patch("src.services.courses.activities.access.check_ee_activity_paid_access", new=AsyncMock(return_value=True)), \
             patch("src.services.courses.activities.access.can_edit_course", new=AsyncMock(return_value=False)):
            assert await _reader_state(mock_request, read, activity, drip_course, regular_user, db) == "locked"


# ── AI assistant access ─────────────────────────────────────────────────────


class TestRagAccess:
    async def test_unreleased_chapter_is_not_readable(self, db, drip_course, regular_user, mock_request):
        from src.services.ai.rag.access import CourseGrant, RagAccessScope, _activity_readable

        scope = RagAccessScope(request=mock_request, current_user=regular_user, org_id=drip_course.org_id)
        grant = CourseGrant(course_uuid=drip_course.course_uuid)
        with patch("src.services.ai.rag.access.check_ee_activity_paid_access", new=AsyncMock(return_value=True)):
            assert not await _activity_readable(await db.get(Activity, 2), await db.get(Chapter, 2), grant, scope, set(), db)
            assert await _activity_readable(await db.get(Activity, 1), await db.get(Chapter, 1), grant, scope, set(), db)
            author = CourseGrant(course_uuid=drip_course.course_uuid, is_author=True)
            assert await _activity_readable(await db.get(Activity, 2), await db.get(Chapter, 2), author, scope, set(), db)


# ── Schedule editing ────────────────────────────────────────────────────────


@pytest.fixture
def allow_update():
    with patch("src.services.courses.drip.check_resource_access", new_callable=AsyncMock):
        yield


class TestScheduleService:
    async def test_read_defaults(self, db, org, course, admin_user, mock_request, allow_update):
        await _add_chapter(db, org, course, 1, 1)
        await _add_chapter(db, org, course, 2, 2, _delay(7))
        schedule = await get_drip_schedule(mock_request, course.course_uuid, admin_user, db)
        assert not schedule.settings.enabled
        assert [c.chapter_uuid for c in schedule.chapters] == ["chapter_1", "chapter_2"]
        assert schedule.chapters[1].rule.delay_days == 7

    async def test_read_invalid_stored_settings(self, db, course, admin_user, mock_request, allow_update):
        course.drip_settings = {"enabled": True, "anchor": "fixed_date"}
        db.add(course)
        await db.commit()
        schedule = await get_drip_schedule(mock_request, course.course_uuid, admin_user, db)
        assert schedule.settings == CourseDripSettings()

    async def test_duplicate_chapter_links_are_listed_once(self, db, org, course, admin_user, mock_request, allow_update):
        await _add_chapter(db, org, course, 1, 1)
        db.add(CourseChapter(chapter_id=1, course_id=course.id, org_id=org.id, order=2, creation_date="", update_date=""))
        await db.commit()
        schedule = await get_drip_schedule(mock_request, course.course_uuid, admin_user, db)
        assert [c.chapter_uuid for c in schedule.chapters] == ["chapter_1"]
        assert await drip_service._ordered_chapters(course.id, db) == [(1, None, "chapter_1")]

    async def test_unknown_course(self, db, admin_user, mock_request, allow_update):
        with pytest.raises(HTTPException) as exc:
            await get_drip_schedule(mock_request, "course_missing", admin_user, db)
        assert exc.value.status_code == 404

    async def test_update_saves_settings_and_rules(self, db, org, course, admin_user, mock_request, allow_update):
        await _add_chapter(db, org, course, 1, 1)
        await _add_chapter(db, org, course, 2, 2)
        payload = DripScheduleUpdate.model_validate({
            "settings": ENROLL,
            "chapters": [{"chapter_uuid": "chapter_2", "rule": _delay(7, require_previous=True)}],
        })
        schedule = await update_drip_schedule(mock_request, course.course_uuid, payload, admin_user, db)
        assert schedule.settings.enabled
        assert schedule.chapters[1].rule.require_previous
        stored = await db.get(Chapter, 2)
        assert stored.drip_rule["delay_days"] == 7
        assert (await db.get(Chapter, 1)).drip_rule is None

    async def test_update_rejects_foreign_chapter(self, db, org, course, admin_user, mock_request, allow_update):
        payload = DripScheduleUpdate.model_validate({
            "settings": ENROLL, "chapters": [{"chapter_uuid": "chapter_elsewhere", "rule": {}}],
        })
        with pytest.raises(HTTPException) as exc:
            await update_drip_schedule(mock_request, course.course_uuid, payload, admin_user, db)
        assert exc.value.status_code == 400

    async def test_plan_checked_only_when_enabling(self, db, course, admin_user, mock_request, allow_update):
        denied = AsyncMock(side_effect=HTTPException(status_code=403, detail="plan"))
        with patch("src.services.courses.drip.check_org_plan", denied):
            with pytest.raises(HTTPException) as exc:
                await update_drip_schedule(
                    mock_request, course.course_uuid, DripScheduleUpdate(settings=_settings()), admin_user, db,
                )
            assert exc.value.status_code == 403
            denied.assert_awaited_once_with(course.org_id, "standard", "Drip content", db)

            off = await update_drip_schedule(
                mock_request, course.course_uuid, DripScheduleUpdate(settings=CourseDripSettings()), admin_user, db,
            )
            assert not off.settings.enabled
            assert denied.await_count == 1


# ── Router ──────────────────────────────────────────────────────────────────


@pytest.fixture
async def client(db, admin_user):
    app = FastAPI()
    app.include_router(courses_router, prefix="/api/v1/courses")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    app.dependency_overrides[require_courses_feature] = lambda: True
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


class TestRouter:
    async def test_get_and_put(self, client, db, org, course, allow_update):
        await _add_chapter(db, org, course, 1, 1)
        res = await client.get(f"/api/v1/courses/{course.course_uuid}/drip")
        assert res.status_code == 200
        assert res.json()["settings"]["enabled"] is False

        res = await client.put(
            f"/api/v1/courses/{course.course_uuid}/drip",
            json={"settings": ENROLL, "chapters": [{"chapter_uuid": "chapter_1", "rule": _delay(3)}]},
        )
        assert res.status_code == 200
        assert res.json()["chapters"][0]["rule"]["delay_days"] == 3

    async def test_put_validates(self, client, course, allow_update):
        res = await client.put(
            f"/api/v1/courses/{course.course_uuid}/drip",
            json={"settings": {"enabled": True, "anchor": "fixed_date"}},
        )
        assert res.status_code == 422


# ── More conditions: prerequisites, closing window, early access ────────────


class TestMoreConditions:
    def test_required_chapters(self):
        chapters = [
            (1, None, "c1"),
            (2, None, "c2"),
            (3, {"require_chapters": ["c1", "c2"]}, "c3"),
            (4, {"require_chapters": ["c5"]}, "c4"),  # later chapter: ignored
            (5, None, "c5"),
        ]
        activities = {1: [10], 2: [20], 3: [], 4: [], 5: [50]}
        states = compute_drip_states(_settings(), chapters, activities, NOW, {10}, NOW)
        assert states[3].locked and states[3].reason == DripLockReason.PREREQUISITES
        assert not states[4].locked
        states = compute_drip_states(_settings(), chapters, activities, NOW, {10, 20}, NOW)
        assert not states[3].locked

    def test_closing_window(self):
        anchor = NOW - timedelta(days=10)
        chapters = [(1, {"available_days": 7}), (2, _delay(7, available_days=7)), (3, {"available_days": 3})]
        states = compute_drip_states(_settings(), chapters, {1: [10]}, anchor, {10}, NOW)
        assert states[1].locked and states[1].reason == DripLockReason.CLOSED
        assert states[1].closes_at == anchor + timedelta(days=7)
        assert not states[2].locked and states[2].closes_at == anchor + timedelta(days=14)
        assert states[2].opened_at == anchor + timedelta(days=7)
        # Finished before it closed: still counts for "require previous".
        follow = compute_drip_states(_settings(), [(1, {"available_days": 7}), (2, {"require_previous": True})], {1: [10]}, anchor, {10}, NOW)
        assert not follow[2].locked

    def test_closing_needs_a_release_time(self):
        # Not enrolled: day-0 chapters are open as a preview with no clock, so no window either.
        states = compute_drip_states(_settings(), [(1, {"available_days": 1})], {}, None, set(), NOW)
        assert not states[1].locked and states[1].closes_at is None
        assert DripState(closes_at=NOW).closes_at_iso == NOW.isoformat()

    async def test_early_access_group_sees_everything(self, db, org, drip_course, regular_user):
        db.add(UserGroup(id=7, name="VIP", description="", org_id=org.id, usergroup_uuid="ug_vip", creation_date="", update_date=""))
        db.add(UserGroupUser(usergroup_id=7, user_id=regular_user.id, org_id=org.id, creation_date="", update_date=""))
        await db.commit()
        rules = [(1, None), (2, _delay(7))]
        assert (await drip_states_for_reader(drip_course, rules, {}, regular_user, db, NOW))[2].locked
        drip_course.drip_settings = {**ENROLL, "early_access_usergroups": ["ug_vip"]}
        assert await drip_states_for_reader(drip_course, rules, {}, regular_user, db, NOW) == {}

    async def test_chapter_state_loads_order_for_prerequisites(self, db, org, course, regular_user):
        course.drip_settings = ENROLL
        await _add_chapter(db, org, course, 1, 1)
        ch2 = await _add_chapter(db, org, course, 2, 2, {"require_chapters": ["chapter_1"]})
        await _add_activity(db, org, course, 1, 1)
        await _enroll(db, org, course, regular_user.id, NOW - timedelta(days=1))
        assert (await chapter_drip_state(course, ch2, regular_user, db, NOW)).reason == DripLockReason.PREREQUISITES
        await _complete(db, org, course, regular_user.id, 1)
        assert not (await chapter_drip_state(course, ch2, regular_user, db, NOW)).locked

    async def test_tree_leaves_early_access_untouched(self, db, org, course, regular_user):
        from src.db.courses.chapters import ChapterRead

        db.add(UserGroup(id=6, name="Staff", description="", org_id=org.id, usergroup_uuid="ug_staff", creation_date="", update_date=""))
        db.add(UserGroupUser(usergroup_id=6, user_id=regular_user.id, org_id=org.id, creation_date="", update_date=""))
        course.drip_settings = {**ENROLL, "early_access_usergroups": ["ug_staff"]}
        await db.commit()
        ch = await _add_chapter(db, org, course, 1, 1, _delay(30))
        reads = [ChapterRead(**ch.model_dump(), activities=[])]
        await drip_service.apply_drip_to_chapters(reads, course, regular_user, db, None)
        assert not reads[0].drip_locked

    async def test_tree_reports_closing_date(self, db, org, course, regular_user):
        from src.db.courses.chapters import ChapterRead

        course.drip_settings = {"enabled": True, "anchor": "fixed_date", "start_date": (NOW - timedelta(days=1)).isoformat()}
        ch = await _add_chapter(db, org, course, 1, 1, {"available_days": 30})
        reads = [ChapterRead(**ch.model_dump(), activities=[])]
        await drip_service.apply_drip_to_chapters(reads, course, regular_user, db, None)
        assert reads[0].drip_closes_at is not None and not reads[0].drip_locked


class TestScheduleValidation:
    async def test_required_chapter_must_be_in_course(self, db, org, course, admin_user, mock_request, allow_update):
        await _add_chapter(db, org, course, 1, 1)
        for rule in ({"require_chapters": ["chapter_elsewhere"]}, {"require_chapters": ["chapter_1"]}):
            payload = DripScheduleUpdate.model_validate({"settings": ENROLL, "chapters": [{"chapter_uuid": "chapter_1", "rule": rule}]})
            with pytest.raises(HTTPException) as exc:
                await update_drip_schedule(mock_request, course.course_uuid, payload, admin_user, db)
            assert exc.value.status_code == 400

    async def test_required_chapter_saved(self, db, org, course, admin_user, mock_request, allow_update):
        await _add_chapter(db, org, course, 1, 1)
        await _add_chapter(db, org, course, 2, 2)
        payload = DripScheduleUpdate.model_validate({
            "settings": ENROLL,
            "chapters": [{"chapter_uuid": "chapter_2", "rule": {"require_chapters": ["chapter_1"], "available_days": 5}}],
        })
        schedule = await update_drip_schedule(mock_request, course.course_uuid, payload, admin_user, db)
        assert schedule.chapters[1].rule.require_chapters == ["chapter_1"]
        assert schedule.chapters[1].rule.available_days == 5

    async def test_early_access_group_must_be_in_org(self, db, org, other_org, course, admin_user, mock_request, allow_update):
        db.add(UserGroup(id=8, name="Mine", description="", org_id=org.id, usergroup_uuid="ug_mine", creation_date="", update_date=""))
        db.add(UserGroup(id=9, name="Theirs", description="", org_id=other_org.id, usergroup_uuid="ug_theirs", creation_date="", update_date=""))
        await db.commit()
        bad = DripScheduleUpdate.model_validate({"settings": {**ENROLL, "early_access_usergroups": ["ug_theirs"]}})
        with pytest.raises(HTTPException) as exc:
            await update_drip_schedule(mock_request, course.course_uuid, bad, admin_user, db)
        assert exc.value.status_code == 400
        ok = DripScheduleUpdate.model_validate({"settings": {**ENROLL, "early_access_usergroups": ["ug_mine"], "notify_email": True}})
        saved = await update_drip_schedule(mock_request, course.course_uuid, ok, admin_user, db)
        assert saved.settings.early_access_usergroups == ["ug_mine"] and saved.settings.notify_email


# ── Unlock emails ───────────────────────────────────────────────────────────


@pytest.fixture
async def notify_course(db, org, course, regular_user):
    course.drip_settings = {**ENROLL, "notify_email": True}
    db.add(course)
    await db.commit()
    await _add_chapter(db, org, course, 1, 1)
    await _add_chapter(db, org, course, 2, 2, _delay(7))
    await _add_chapter(db, org, course, 3, 3, _delay(14))
    await _add_chapter(db, org, course, 4, 4, {"mode": "date", "release_at": (NOW - timedelta(hours=3)).isoformat()})
    await _enroll(db, org, course, regular_user.id, NOW - timedelta(days=7, hours=2))
    return course


class TestUnlockEmails:
    async def test_emails_newly_opened_chapters_once(self, db, notify_course, regular_user):
        from src.services.courses.drip_notify import run_drip_notifications

        with patch("src.services.users.emails.send_drip_unlocked_email") as send, \
             patch("src.services.nudges.links.org_base_url", new=AsyncMock(return_value="https://academy.test")):
            stats = await run_drip_notifications(db, NOW)
            assert stats.emails == 1 and stats.chapters == 2
            kwargs = send.call_args.kwargs
            assert kwargs["chapter_names"] == ["Chapter 2", "Chapter 4"]
            assert kwargs["cta_url"] == "https://academy.test/course/test"
            assert kwargs["email"] == "regular@test.com"

            again = await run_drip_notifications(db, NOW)
            assert again.emails == 0 and send.call_count == 1

    async def test_old_releases_are_not_announced(self, db, notify_course):
        from src.services.courses.drip_notify import run_drip_notifications

        with patch("src.services.users.emails.send_drip_unlocked_email") as send, \
             patch("src.services.nudges.links.org_base_url", new=AsyncMock(return_value="https://academy.test")):
            stats = await run_drip_notifications(db, NOW + timedelta(days=3))
        assert stats.emails == 0 and not send.called

    async def test_failures_are_counted(self, db, notify_course):
        from src.services.courses.drip_notify import run_drip_notifications

        with patch("src.services.users.emails.send_drip_unlocked_email", side_effect=RuntimeError("smtp down")), \
             patch("src.services.nudges.links.org_base_url", new=AsyncMock(return_value="https://academy.test")):
            stats = await run_drip_notifications(db, NOW)
        assert stats.failed == 1 and stats.emails == 0

    async def test_courses_without_notifications_or_timed_chapters_are_skipped(self, db, org, course, regular_user):
        from src.services.courses.drip_notify import run_drip_notifications

        course.drip_settings = ENROLL  # notifications off
        db.add(course)
        await db.commit()
        assert (await run_drip_notifications(db, NOW)).courses == 0
        course.drip_settings = {**ENROLL, "notify_email": True}
        await _add_chapter(db, org, course, 1, 1)  # nothing on a time rule
        db.add(course)
        await db.commit()
        assert (await run_drip_notifications(db, NOW)).courses == 0
        await _add_chapter(db, org, course, 2, 2, _delay(3))  # timed, but nobody enrolled
        stats = await run_drip_notifications(db, NOW)
        assert stats.courses == 1 and stats.emails == 0

    async def test_inbox_row_without_email_opt_in(self, db, notify_course, regular_user):
        from sqlmodel import select

        from src.db.notifications import Notification
        from src.services.courses.drip_notify import run_drip_notifications

        notify_course.drip_settings = ENROLL  # email off: the inbox still hears about it
        db.add(notify_course)
        await db.commit()
        with patch("src.services.users.emails.send_drip_unlocked_email") as send, \
             patch("src.services.notifications.push.schedule_push"):
            stats = await run_drip_notifications(db, NOW)
        assert not send.called
        assert stats.notified == 1 and stats.chapters == 2 and stats.emails == 0
        row = (await db.execute(select(Notification).where(Notification.user_id == regular_user.id))).scalars().one()
        assert row.type == "chapter_unlocked" and row.body == "2 new chapters are open: Chapter 2, Chapter 4"

    async def test_claim_conflict_skips(self, db, notify_course, regular_user):
        from src.services.courses.drip_notify import _claim

        assert await _claim(db, notify_course, regular_user.id, [2], NOW)
        assert not await _claim(db, notify_course, regular_user.id, [2], NOW)

    def test_email_template(self):
        from src.services.users.emails import send_drip_unlocked_email

        with patch("src.services.users.emails.send_email") as send:
            send_drip_unlocked_email(
                email="l@test.com", username="lena", org_name="Kitebase", course_name="Bootcamp",
                chapter_names=["Week 2", "Bonus <live>"], cta_url="https://a.test/course/x", lang="fr",
            )
        kwargs = send.call_args.kwargs
        assert kwargs["subject"] == "Nouveau dans Bootcamp : Week 2"
        assert "Bonus &lt;live&gt;" in kwargs["body"] and "https://a.test/course/x" in kwargs["body"]

    def test_email_template_single_chapter(self):
        from src.services.users.emails import send_drip_unlocked_email

        with patch("src.services.users.emails.send_email") as send:
            send_drip_unlocked_email(
                email="l@test.com", username="lena", org_name="Kitebase", course_name="Bootcamp",
                chapter_names=["Week 2"], cta_url="https://a.test/course/x",
            )
        assert "Also open now" not in send.call_args.kwargs["body"]


class TestDripScheduler:
    async def test_tick_runs_job_with_lock(self):
        from src.services.courses import drip_scheduler
        from src.services.courses.drip_notify import DripNotifyStats

        class Session:
            async def __aenter__(self):
                return "db"

            async def __aexit__(self, *a):
                return False

        with patch.object(drip_scheduler, "_claim_hour", new=AsyncMock(return_value=True)), \
             patch("src.core.events.database._async_session_factory", new=lambda: Session(), create=True), \
             patch("src.services.courses.drip_notify.run_drip_notifications", new=AsyncMock(return_value=DripNotifyStats(emails=2))) as run:
            await drip_scheduler._tick()
        run.assert_awaited_once()

    async def test_tick_skips_when_hour_taken_and_survives_errors(self):
        from src.services.courses import drip_scheduler

        with patch.object(drip_scheduler, "_claim_hour", new=AsyncMock(return_value=False)), \
             patch("src.services.courses.drip_notify.run_drip_notifications", new=AsyncMock()) as run:
            await drip_scheduler._tick()
        run.assert_not_awaited()
        with patch.object(drip_scheduler, "_claim_hour", new=AsyncMock(side_effect=RuntimeError("boom"))):
            await drip_scheduler._tick()  # logged, not raised

    async def test_loop_ticks_then_waits_and_cancellation_propagates(self):
        from src.services.courses import drip_scheduler

        sleeps = []

        async def fake_sleep(seconds):
            sleeps.append(seconds)
            if len(sleeps) > 1:
                raise asyncio.CancelledError

        with patch.object(drip_scheduler.asyncio, "sleep", new=fake_sleep), \
             patch.object(drip_scheduler, "_tick", new=AsyncMock()) as tick:
            with pytest.raises(asyncio.CancelledError):
                await drip_scheduler._loop()
        tick.assert_awaited_once()
        assert sleeps == [drip_scheduler.STARTUP_DELAY_SECONDS, drip_scheduler.INTERVAL_SECONDS]

        with patch.object(drip_scheduler, "_claim_hour", new=AsyncMock(side_effect=asyncio.CancelledError)):
            with pytest.raises(asyncio.CancelledError):
                await drip_scheduler._tick()

    async def test_claim_hour_without_redis(self):
        from src.services.courses import drip_scheduler

        with patch("src.core.redis.get_redis_client", return_value=None):
            assert await drip_scheduler._claim_hour(NOW)
        assert drip_scheduler._lock_key(NOW) == "learnhouse:drip:notify:2026-11-02T12"

    async def test_claim_hour_with_redis(self):
        from src.services.courses import drip_scheduler

        class R:
            def set(self, *a, **k):
                return True

        with patch("src.core.redis.get_redis_client", return_value=R()):
            assert await drip_scheduler._claim_hour(NOW)

    async def test_start_and_stop(self, monkeypatch):
        from src.services.courses import drip_scheduler

        drip_scheduler.start_scheduler()  # TESTING: idle
        assert drip_scheduler._task is None
        await drip_scheduler.stop_scheduler()

        monkeypatch.setenv("TESTING", "false")
        with patch.object(drip_scheduler, "_loop", new=AsyncMock()):
            drip_scheduler.start_scheduler()
            assert drip_scheduler._task is not None
            await drip_scheduler.stop_scheduler()
        assert drip_scheduler._task is None

        with patch("asyncio.create_task", side_effect=RuntimeError("no loop")):
            drip_scheduler.start_scheduler()  # never raises


async def test_disabled_drip_settings_are_skipped_by_notifications(db, org, course):
    """A course row that still holds settings with drip switched off is not a
    drip course: the notifier moves on without reading its chapters."""
    from src.services.courses.drip_notify import run_drip_notifications

    course.drip_settings = {**ENROLL, "enabled": False, "notify_email": True}
    db.add(course)
    await db.commit()
    assert (await run_drip_notifications(db, NOW)).courses == 0
