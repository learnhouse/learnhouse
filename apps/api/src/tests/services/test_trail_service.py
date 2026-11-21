"""Tests for src/services/trail/trail.py."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.courses import Course
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.trails import Trail, TrailCreate
from src.db.users import AnonymousUser
from src.services.trail.trail import (
    _build_trail_read,
    add_activity_to_trail,
    add_course_to_trail,
    check_trail_presence,
    create_user_trail,
    get_user_trail_with_orgid,
    get_user_trails,
    remove_activity_from_trail,
    remove_course_from_trail,
)


async def _make_course(db, org, *, id, course_uuid, name):
    course = Course(
        id=id,
        name=name,
        description=f"Description for {name}",
        public=True,
        published=True,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid=course_uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(course)
    await db.commit()
    await db.refresh(course)
    return course


async def _make_trail(db, org, user, *, trail_uuid="trail_test"):
    trail = Trail(
        org_id=org.id,
        user_id=user.id,
        trail_uuid=trail_uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(trail)
    await db.commit()
    await db.refresh(trail)
    return trail


async def _make_trail_run(db, trail, course, user):
    trail_run = TrailRun(
        trail_id=trail.id,
        course_id=course.id,
        org_id=trail.org_id,
        user_id=user.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(trail_run)
    await db.commit()
    await db.refresh(trail_run)
    return trail_run


async def _make_trail_step(db, trail, trail_run, activity, course, user):
    trail_step = TrailStep(
        trailrun_id=trail_run.id,
        trail_id=trail.id,
        activity_id=activity.id,
        course_id=course.id,
        org_id=trail.org_id,
        user_id=user.id,
        complete=True,
        teacher_verified=False,
        grade="",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(trail_step)
    await db.commit()
    await db.refresh(trail_step)
    return trail_step


async def _make_bogus_activity(db, org, *, activity_uuid, course_id):
    activity = Activity(
        id=99,
        name="Bogus Activity",
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={"type": "doc", "content": []},
        published=True,
        org_id=org.id,
        course_id=course_id,
        activity_uuid=activity_uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(activity)
    await db.commit()
    await db.refresh(activity)
    return activity


class TestTrailService:
    @pytest.mark.asyncio
    async def test_build_trail_read_handles_empty_and_populated_runs(
        self, db, org, course, activity, admin_user
    ):
        trail = await _make_trail(db, org, admin_user)
        extra_course = await _make_course(
            db,
            org,
            id=2,
            course_uuid="course_extra",
            name="Extra Course",
        )
        trail_run = await _make_trail_run(db, trail, course, admin_user)
        await _make_trail_step(db, trail, trail_run, activity, extra_course, admin_user)

        trail_payload = {
            "id": trail.id,
            "trail_uuid": trail.trail_uuid,
            "org_id": trail.org_id,
            "user_id": trail.user_id,
            "creation_date": trail.creation_date,
            "update_date": trail.update_date,
        }
        trail_like = SimpleNamespace(model_dump=lambda: trail_payload)

        empty = await _build_trail_read(trail_like, [], db)
        populated = await _build_trail_read(
            trail_like,
            [trail_run],
            db,
            user_id=admin_user.id,
            with_course_info=False,
        )

        assert empty.runs == []
        assert populated.runs[0].course["course_uuid"] == course.course_uuid
        assert populated.runs[0].course_total_steps == 0
        assert populated.runs[0].steps[0].data["course"]["course_uuid"] == extra_course.course_uuid

    @pytest.mark.asyncio
    async def test_check_trail_presence_creates_trail_and_gets_existing_trail(
        self, db, org, admin_user, mock_request
    ):
        created = await check_trail_presence(
            org_id=org.id,
            user_id=admin_user.id,
            request=mock_request,
            user=admin_user,
            db_session=db,
        )
        existing = await check_trail_presence(
            org_id=org.id,
            user_id=admin_user.id,
            request=mock_request,
            user=admin_user,
            db_session=db,
        )
        trail_read = await get_user_trails(mock_request, admin_user, db)

        with pytest.raises(HTTPException) as exc_info:
            await create_user_trail(
                mock_request,
                admin_user,
                TrailCreate(org_id=org.id, user_id=admin_user.id),
                db,
            )

        assert created.id == existing.id
        assert trail_read.org_id == org.id
        assert trail_read.runs == []
        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_get_user_trails_and_anonymous_guard(
        self, db, org, admin_user, mock_request
    ):
        with pytest.raises(HTTPException) as missing_exc:
            await get_user_trails(mock_request, admin_user, db)

        trail = await _make_trail(db, org, admin_user)
        trail_read = await get_user_trail_with_orgid(
            mock_request, admin_user, org.id, db
        )

        with pytest.raises(HTTPException) as anonymous_exc:
            await get_user_trail_with_orgid(
                mock_request, AnonymousUser(), org.id, db
            )

        assert missing_exc.value.status_code == 404
        assert trail_read.id == trail.id
        assert anonymous_exc.value.status_code == 401

    @pytest.mark.asyncio
    async def test_add_activity_to_trail_creates_records_and_tracks_once(
        self, db, org, admin_user, mock_request, activity
    ):
        with patch(
            "src.services.trail.trail.track",
            new_callable=AsyncMock,
        ) as mock_track, patch(
            "src.services.trail.trail.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_webhooks, patch(
            "src.services.trail.trail.check_course_completion_and_create_certificate",
            new_callable=AsyncMock,
            side_effect=[True, False],
        ):
            first = await add_activity_to_trail(
                mock_request,
                admin_user,
                activity.activity_uuid,
                db,
            )
            second = await add_activity_to_trail(
                mock_request,
                admin_user,
                activity.activity_uuid,
                db,
            )

        assert len(first.runs) == 1
        assert len(first.runs[0].steps) == 1
        assert len(second.runs) == 1
        assert mock_track.await_count == 2
        assert mock_webhooks.await_count == 2
        assert (await db.execute(TrailRun.__table__.select())).all()
        assert (await db.execute(TrailStep.__table__.select())).all()

    @pytest.mark.asyncio
    async def test_progress_changes_notify_ee_once(
        self, db, org, admin_user, mock_request, activity, course
    ):
        with patch("src.services.trail.trail.track", new_callable=AsyncMock), patch(
            "src.services.trail.trail.dispatch_webhooks", new_callable=AsyncMock
        ), patch(
            "src.services.trail.trail.check_course_completion_and_create_certificate",
            new_callable=AsyncMock,
        ), patch("src.services.trail.trail.notify_ee_learner_progress") as notify:
            await add_activity_to_trail(mock_request, admin_user, activity.activity_uuid, db)
            # A re-visit is not a progress change.
            await add_activity_to_trail(mock_request, admin_user, activity.activity_uuid, db)
            assert notify.call_args_list == [((admin_user.id, course.id),)]
            await remove_activity_from_trail(mock_request, admin_user, activity.activity_uuid, db)
            assert notify.call_count == 2
            # Leaving the course drops its progress too.
            await remove_course_from_trail(mock_request, admin_user, course.course_uuid, db)
            assert notify.call_count == 3

    @pytest.mark.asyncio
    async def test_add_activity_to_trail_rejects_missing_activity_and_course(
        self, db, org, admin_user, mock_request
    ):
        with pytest.raises(HTTPException) as missing_activity_exc:
            await add_activity_to_trail(
                mock_request,
                admin_user,
                "missing-activity",
                db,
            )

        await _make_bogus_activity(db, org, activity_uuid="bogus-activity", course_id=999)

        with pytest.raises(HTTPException) as missing_course_exc:
            await add_activity_to_trail(
                mock_request,
                admin_user,
                "bogus-activity",
                db,
            )

        assert missing_activity_exc.value.status_code == 404
        assert missing_course_exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_add_activity_to_trail_rejects_assignments(
        self, db, org, course, regular_user, mock_request
    ):
        db.add(Activity(
            id=77, name="Essay", activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY, content={},
            published=True, org_id=org.id, course_id=course.id,
            activity_uuid="activity_essay", creation_date="now", update_date="now",
        ))
        await db.commit()

        with pytest.raises(HTTPException) as exc:
            await add_activity_to_trail(mock_request, regular_user, "activity_essay", db)
        assert exc.value.status_code == 400
        assert (await db.execute(TrailStep.__table__.select())).all() == []

    @pytest.mark.asyncio
    async def test_remove_activity_from_trail_deletes_step_and_checks_guards(
        self, db, org, admin_user, mock_request, activity, course
    ):
        with pytest.raises(HTTPException) as missing_activity_exc:
            await remove_activity_from_trail(
                mock_request,
                admin_user,
                "missing-activity",
                db,
            )

        bogus_activity = await _make_bogus_activity(
            db, org, activity_uuid="bogus-remove", course_id=999
        )

        with pytest.raises(HTTPException) as missing_course_exc:
            await remove_activity_from_trail(
                mock_request,
                admin_user,
                bogus_activity.activity_uuid,
                db,
            )

        trail = await _make_trail(db, org, admin_user)
        trail_run = await _make_trail_run(db, trail, course, admin_user)
        await _make_trail_step(db, trail, trail_run, activity, course, admin_user)

        removed = await remove_activity_from_trail(
            mock_request,
            admin_user,
            activity.activity_uuid,
            db,
        )

        assert missing_activity_exc.value.status_code == 404
        assert missing_course_exc.value.status_code == 404
        assert len(removed.runs) == 1
        assert removed.runs[0].steps == []
        assert (await db.execute(
            TrailStep.__table__.select().where(TrailStep.activity_id == activity.id)
        )).all() == []

    @pytest.mark.asyncio
    async def test_add_course_to_trail_creates_run_and_rejects_duplicates(
        self, db, org, admin_user, mock_request
    ):
        trail = await _make_trail(db, org, admin_user)
        course_a = await _make_course(
            db,
            org,
            id=2,
            course_uuid="course_a",
            name="Course A",
        )
        course_b = await _make_course(
            db,
            org,
            id=3,
            course_uuid="course_b",
            name="Course B",
        )
        await _make_trail_run(db, trail, course_b, admin_user)

        with pytest.raises(HTTPException) as missing_course_exc:
            await add_course_to_trail(
                mock_request,
                admin_user,
                "missing-course",
                db,
            )

        with pytest.raises(HTTPException) as duplicate_exc:
            await add_course_to_trail(
                mock_request,
                admin_user,
                course_b.course_uuid,
                db,
            )

        with patch(
            "src.services.trail.trail.track",
            new_callable=AsyncMock,
        ) as mock_track, patch(
            "src.services.trail.trail.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_webhooks:
            result = await add_course_to_trail(
                mock_request,
                admin_user,
                course_a.course_uuid,
                db,
            )

        assert missing_course_exc.value.status_code == 404
        assert duplicate_exc.value.status_code == 400
        assert len(result.runs) == 2
        assert mock_track.await_count == 1
        assert mock_webhooks.await_count == 1

    @pytest.mark.asyncio
    async def test_add_course_to_trail_creates_missing_trail(
        self, db, org, admin_user, mock_request
    ):
        # A learner's first enrollment (straight from the API, before anything
        # read their trail) creates the trail instead of failing with 404.
        course = await _make_course(
            db,
            org,
            id=2,
            course_uuid="course_without_trail",
            name="Course Without Trail",
        )
        trail_query = select(Trail).where(
            Trail.user_id == admin_user.id, Trail.org_id == org.id
        )
        assert (await db.execute(trail_query)).scalars().first() is None

        with patch(
            "src.services.trail.trail.track",
            new_callable=AsyncMock,
        ), patch(
            "src.services.trail.trail.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            result = await add_course_to_trail(
                mock_request,
                admin_user,
                course.course_uuid,
                db,
            )

        assert (await db.execute(trail_query)).scalars().first() is not None
        assert [run.course_id for run in result.runs] == [course.id]

    @pytest.mark.asyncio
    async def test_remove_course_from_trail_deletes_course_steps_and_checks_missing_trail(
        self, db, org, admin_user, mock_request, activity, course
    ):
        with pytest.raises(HTTPException) as missing_course_exc:
            await remove_course_from_trail(
                mock_request,
                admin_user,
                "missing-course",
                db,
            )

        with pytest.raises(HTTPException) as missing_trail_exc:
            await remove_course_from_trail(
                mock_request,
                admin_user,
                course.course_uuid,
                db,
            )

        trail = await _make_trail(db, org, admin_user)
        trail_run = await _make_trail_run(db, trail, course, admin_user)
        # One completion step per (run, activity, user), enforced by a UNIQUE
        # constraint. A single step is enough to verify removal deletes it.
        await _make_trail_step(db, trail, trail_run, activity, course, admin_user)

        with patch(
            "src.services.trail.trail.track", new_callable=AsyncMock
        ) as mock_track:
            removed = await remove_course_from_trail(
                mock_request,
                admin_user,
                course.course_uuid,
                db,
            )

        mock_track.assert_awaited_once_with(
            event_name="course_left",
            org_id=course.org_id,
            user_id=admin_user.id,
            properties={"course_uuid": course.course_uuid},
        )
        assert missing_course_exc.value.status_code == 404
        assert missing_trail_exc.value.status_code == 404
        assert removed.runs == []
        assert (await db.execute(
            TrailRun.__table__.select().where(TrailRun.course_id == course.id)
        )).all() == []
        assert (await db.execute(
            TrailStep.__table__.select().where(TrailStep.course_id == course.id)
        )).all() == []

    @pytest.mark.asyncio
    async def test_remove_activity_from_trail_raises_when_no_trail(
        self, db, org, admin_user, mock_request, activity, course
    ):
        # Line 370: user has no Trail row yet -- activity and course both exist
        with pytest.raises(HTTPException) as exc_info:
            await remove_activity_from_trail(
                mock_request,
                admin_user,
                activity.activity_uuid,
                db,
            )

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_anonymous_users_are_rejected_by_trail_endpoints(
        self, db, org, mock_request
    ):
        # Lines 108, 145, 220, 372, 430, 515: every trail mutation/read entry
        # point raises 401 for AnonymousUser before touching the DB.
        anon = AnonymousUser()

        with pytest.raises(HTTPException) as create_exc:
            await create_user_trail(
                mock_request,
                anon,
                TrailCreate(org_id=org.id, user_id=0),
                db,
            )

        with pytest.raises(HTTPException) as get_exc:
            await get_user_trails(mock_request, anon, db)

        with pytest.raises(HTTPException) as add_activity_exc:
            await add_activity_to_trail(mock_request, anon, "any-activity", db)

        with pytest.raises(HTTPException) as remove_activity_exc:
            await remove_activity_from_trail(mock_request, anon, "any-activity", db)

        with pytest.raises(HTTPException) as add_course_exc:
            await add_course_to_trail(mock_request, anon, "any-course", db)

        with pytest.raises(HTTPException) as remove_course_exc:
            await remove_course_from_trail(mock_request, anon, "any-course", db)

        assert create_exc.value.status_code == 401
        assert get_exc.value.status_code == 401
        assert add_activity_exc.value.status_code == 401
        assert remove_activity_exc.value.status_code == 401
        assert add_course_exc.value.status_code == 401
        assert remove_course_exc.value.status_code == 401

    @pytest.mark.asyncio
    async def test_add_activity_to_trail_swallows_certificate_exception(
        self, db, org, admin_user, mock_request, activity
    ):
        # Lines 316-318: exception from check_course_completion_and_create_certificate
        # must not propagate -- add_activity_to_trail should still return successfully.
        with patch(
            "src.services.trail.trail.track",
            new_callable=AsyncMock,
        ), patch(
            "src.services.trail.trail.dispatch_webhooks",
            new_callable=AsyncMock,
        ), patch(
            "src.services.trail.trail.check_course_completion_and_create_certificate",
            new_callable=AsyncMock,
            side_effect=Exception("certificate failure"),
        ), patch(
            "src.services.trail.trail.is_course_fully_completed",
            return_value=True,
        ):
            result = await add_activity_to_trail(
                mock_request,
                admin_user,
                activity.activity_uuid,
                db,
            )

        assert len(result.runs) == 1
        assert len(result.runs[0].steps) == 1


class TestTrailFirstVisit:
    """GET trail for non-members, and race-safe creation."""

    @pytest.mark.asyncio
    async def test_non_member_gets_an_empty_trail_and_nothing_is_created(
        self, db, org, admin_user, mock_request
    ):
        from sqlmodel import select

        denied = HTTPException(status_code=403, detail="You are not a member of this organization")
        with patch("src.services.trail.trail.require_org_membership", new=AsyncMock(side_effect=denied)):
            read = await get_user_trail_with_orgid(mock_request, admin_user, org.id, db)
        assert read.id is None and read.runs == []
        assert read.org_id == org.id and read.user_id == admin_user.id
        assert (await db.execute(select(Trail))).scalars().all() == []

    @pytest.mark.asyncio
    async def test_other_membership_errors_still_raise(self, db, org, admin_user, mock_request):
        boom = HTTPException(status_code=401, detail="no")
        with patch("src.services.trail.trail.require_org_membership", new=AsyncMock(side_effect=boom)):
            with pytest.raises(HTTPException) as exc:
                await get_user_trail_with_orgid(mock_request, admin_user, org.id, db)
        assert exc.value.status_code == 401

    @pytest.mark.asyncio
    async def test_member_first_visit_creates_one_trail(self, db, org, admin_user, mock_request):
        from sqlmodel import select

        first = await get_user_trail_with_orgid(mock_request, admin_user, org.id, db)
        second = await get_user_trail_with_orgid(mock_request, admin_user, org.id, db)
        assert first.id is not None and first.id == second.id
        assert len((await db.execute(select(Trail))).scalars().all()) == 1

    @pytest.mark.asyncio
    async def test_check_trail_presence_refuses_anonymous_creation(self, db, org, mock_request):
        with pytest.raises(HTTPException) as exc:
            await check_trail_presence(
                org_id=org.id, user_id=0, request=mock_request, user=AnonymousUser(), db_session=db,
            )
        assert exc.value.status_code == 401

    @pytest.mark.asyncio
    async def test_reads_pick_the_oldest_of_legacy_duplicates(self, db, org, admin_user):
        from src.services.trail.trail import get_or_create_trail

        older = await _make_trail(db, org, admin_user, trail_uuid="trail_old")
        await _make_trail(db, org, admin_user, trail_uuid="trail_new")
        assert (await get_or_create_trail(db, org.id, admin_user.id)).id == older.id

    @pytest.mark.asyncio
    async def test_creation_rechecks_after_taking_the_lock(self, db, org, admin_user, mock_request):
        """A parallel first visit that committed while we waited on the lock
        is found by the re-select instead of inserting a duplicate."""
        from sqlmodel import select

        from src.services.trail import trail as trail_mod

        async def parallel_insert(*_args, **_kwargs):
            await _make_trail(db, org, admin_user, trail_uuid="trail_parallel")

        with patch.object(trail_mod, "lock_trail_creation", new=AsyncMock(side_effect=parallel_insert)):
            got = await trail_mod.get_or_create_trail(db, org.id, admin_user.id)
        assert got.trail_uuid == "trail_parallel"
        assert len((await db.execute(select(Trail))).scalars().all()) == 1

        await db.delete(got)
        await db.commit()
        with patch.object(trail_mod, "lock_trail_creation", new=AsyncMock(side_effect=parallel_insert)):
            with pytest.raises(HTTPException) as exc:
                await create_user_trail(
                    mock_request, admin_user, TrailCreate(org_id=org.id, user_id=admin_user.id), db,
                )
        assert exc.value.status_code == 400
        assert len((await db.execute(select(Trail))).scalars().all()) == 1

    @pytest.mark.asyncio
    async def test_create_user_trail_creates_for_a_member(self, db, org, admin_user, mock_request):
        trail = await create_user_trail(
            mock_request, admin_user, TrailCreate(org_id=org.id, user_id=999), db,
        )
        assert trail.id is not None
        assert trail.user_id == admin_user.id  # the caller, not the body's user_id
        assert trail.trail_uuid.startswith("trail_")

    @pytest.mark.asyncio
    async def test_get_or_create_without_commit_flushes(self, db, org, admin_user):
        from src.services.trail.trail import get_or_create_trail

        trail = await get_or_create_trail(db, org.id, admin_user.id, commit=False)
        assert trail.id is not None
        await db.rollback()

    @pytest.mark.asyncio
    async def test_lock_is_a_postgres_advisory_xact_lock(self):
        from unittest.mock import MagicMock

        from src.services.trail.trail import lock_trail_creation

        session = MagicMock()
        session.get_bind.return_value.dialect.name = "postgresql"
        session.execute = AsyncMock()
        await lock_trail_creation(session, 3, 7)
        stmt, params = session.execute.await_args.args
        assert "pg_advisory_xact_lock(hashtext(:key))" in str(stmt)
        assert params == {"key": "trail:7:3"}

        session.get_bind.return_value.dialect.name = "sqlite"
        session.execute.reset_mock()
        await lock_trail_creation(session, 3, 7)
        session.execute.assert_not_awaited()
