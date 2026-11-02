"""Drip content: chapter release rules and every read path that enforces them.

Covers the pure schedule maths (``compute_drip_states``), the reader-aware
wrapper (enrollment date, progress), the course tree, the single-activity
gate, the AI assistant's access filter, and the schedule edit endpoints.
"""

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
        assert _parse_timestamp("2026-11-01 10:00:00.123") == datetime(
            2026, 11, 1, 10, 0, 0, 123000, tzinfo=timezone.utc
        )
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
        creation_date=str(when.replace(tzinfo=None)), update_date="",
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
        assert await drip_service._ordered_chapters(course.id, db) == [(1, None)]

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
