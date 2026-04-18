"""Tests for src/services/trail/trail.py."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

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


def _make_course(db, org, *, id, course_uuid, name):
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
    db.commit()
    db.refresh(course)
    return course


def _make_trail(db, org, user, *, trail_uuid="trail_test"):
    trail = Trail(
        org_id=org.id,
        user_id=user.id,
        trail_uuid=trail_uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(trail)
    db.commit()
    db.refresh(trail)
    return trail


def _make_trail_run(db, trail, course, user):
    trail_run = TrailRun(
        trail_id=trail.id,
        course_id=course.id,
        org_id=trail.org_id,
        user_id=user.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(trail_run)
    db.commit()
    db.refresh(trail_run)
    return trail_run


def _make_trail_step(db, trail, trail_run, activity, course, user):
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
    db.commit()
    db.refresh(trail_step)
    return trail_step


def _make_bogus_activity(db, org, *, activity_uuid, course_id):
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
    db.commit()
    db.refresh(activity)
    return activity


class TestTrailService:
    @pytest.mark.asyncio
    async def test_build_trail_read_handles_empty_and_populated_runs(
        self, db, org, course, activity, admin_user
    ):
        trail = _make_trail(db, org, admin_user)
        extra_course = _make_course(
            db,
            org,
            id=2,
            course_uuid="course_extra",
            name="Extra Course",
        )
        trail_run = _make_trail_run(db, trail, course, admin_user)
        _make_trail_step(db, trail, trail_run, activity, extra_course, admin_user)

        trail_payload = {
            "id": trail.id,
            "trail_uuid": trail.trail_uuid,
            "org_id": trail.org_id,
            "user_id": trail.user_id,
            "creation_date": trail.creation_date,
            "update_date": trail.update_date,
        }
        trail_like = SimpleNamespace(model_dump=lambda: trail_payload)

        empty = _build_trail_read(trail_like, [], db)
        populated = _build_trail_read(
            trail_like,
            [trail_run],
            db,
            user_id=admin_user.id,
            with_course_info=False,
        )

        assert empty.runs == []
        assert populated.runs[0].course["course_uuid"] == course.course_uuid
        assert populated.runs[0].course_total_steps == 0
        assert populated.runs[0].steps[0].data["course"].course_uuid == extra_course.course_uuid

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

        trail = _make_trail(db, org, admin_user)
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
        assert db.exec(TrailRun.__table__.select()).all()
        assert db.exec(TrailStep.__table__.select()).all()

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

        _make_bogus_activity(db, org, activity_uuid="bogus-activity", course_id=999)

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

        bogus_activity = _make_bogus_activity(
            db, org, activity_uuid="bogus-remove", course_id=999
        )

        with pytest.raises(HTTPException) as missing_course_exc:
            await remove_activity_from_trail(
                mock_request,
                admin_user,
                bogus_activity.activity_uuid,
                db,
            )

        trail = _make_trail(db, org, admin_user)
        trail_run = _make_trail_run(db, trail, course, admin_user)
        _make_trail_step(db, trail, trail_run, activity, course, admin_user)

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
        assert db.exec(
            TrailStep.__table__.select().where(TrailStep.activity_id == activity.id)
        ).all() == []

    @pytest.mark.asyncio
    async def test_add_course_to_trail_creates_run_and_rejects_duplicates(
        self, db, org, admin_user, mock_request
    ):
        trail = _make_trail(db, org, admin_user)
        course_a = _make_course(
            db,
            org,
            id=2,
            course_uuid="course_a",
            name="Course A",
        )
        course_b = _make_course(
            db,
            org,
            id=3,
            course_uuid="course_b",
            name="Course B",
        )
        _make_trail_run(db, trail, course_b, admin_user)

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
    async def test_add_course_to_trail_rejects_missing_trail(
        self, db, org, admin_user, mock_request
    ):
        course = _make_course(
            db,
            org,
            id=2,
            course_uuid="course_without_trail",
            name="Course Without Trail",
        )

        with pytest.raises(HTTPException) as exc_info:
            await add_course_to_trail(
                mock_request,
                admin_user,
                course.course_uuid,
                db,
            )

        assert exc_info.value.status_code == 404

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

        trail = _make_trail(db, org, admin_user)
        trail_run = _make_trail_run(db, trail, course, admin_user)
        _make_trail_step(db, trail, trail_run, activity, course, admin_user)
        _make_trail_step(db, trail, trail_run, activity, course, admin_user)

        removed = await remove_course_from_trail(
            mock_request,
            admin_user,
            course.course_uuid,
            db,
        )

        assert missing_course_exc.value.status_code == 404
        assert missing_trail_exc.value.status_code == 404
        assert removed.runs == []
        assert db.exec(
            TrailRun.__table__.select().where(TrailRun.course_id == course.id)
        ).all() == []
        assert db.exec(
            TrailStep.__table__.select().where(TrailStep.course_id == course.id)
        ).all() == []

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
