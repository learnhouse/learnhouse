"""Tests for src/services/orgs/member_enrollments.py."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.courses import Course
from src.db.trail_runs import TrailRun
from src.db.trails import Trail
from src.db.users import AnonymousUser, PublicUser, User
from src.db.trail_steps import TrailStep
from src.services.orgs.member_enrollments import enroll_org_member, unenroll_org_member


def _public(user) -> PublicUser:
    return PublicUser(
        id=user.id,
        user_uuid=user.user_uuid,
        username=user.username,
        first_name=user.first_name,
        last_name=user.last_name,
        email=user.email,
    )


@pytest.fixture(autouse=True)
def _no_analytics():
    with patch("src.services.orgs.member_enrollments.track", new=AsyncMock()) as mocked, patch(
        "src.services.orgs.member_enrollments.notify_ee_learner_progress"
    ):
        yield mocked


async def _runs(db, user_id, org_id):
    return (
        await db.execute(select(TrailRun).where(TrailRun.user_id == user_id, TrailRun.org_id == org_id))
    ).scalars().all()


async def test_admin_enrolls_member_and_creates_trail(db, org, admin_user, regular_user, course):
    result = await enroll_org_member(org.id, regular_user.id, course.course_uuid, _public(admin_user), db)

    assert result.enrolled is True
    assert result.course_uuid == course.course_uuid
    runs = await _runs(db, regular_user.id, org.id)
    assert [r.course_id for r in runs] == [course.id]
    trail = (await db.execute(select(Trail).where(Trail.user_id == regular_user.id))).scalars().first()
    assert trail is not None and trail.org_id == org.id


async def test_enrolling_twice_is_a_conflict(db, org, admin_user, regular_user, course):
    await enroll_org_member(org.id, regular_user.id, course.course_uuid, _public(admin_user), db)
    with pytest.raises(HTTPException) as exc:
        await enroll_org_member(org.id, regular_user.id, course.course_uuid, _public(admin_user), db)
    assert exc.value.status_code == 409
    assert len(await _runs(db, regular_user.id, org.id)) == 1


async def test_regular_member_cannot_enroll_anyone(db, org, admin_user, regular_user, course):
    with pytest.raises(HTTPException) as exc:
        await enroll_org_member(org.id, admin_user.id, course.course_uuid, _public(regular_user), db)
    assert exc.value.status_code == 403
    assert await _runs(db, admin_user.id, org.id) == []


async def test_anonymous_is_rejected(db, org, regular_user, course):
    with pytest.raises(HTTPException) as exc:
        await enroll_org_member(org.id, regular_user.id, course.course_uuid, AnonymousUser(), db)
    assert exc.value.status_code == 401


async def test_non_member_target_is_not_found(db, org, admin_user, course):
    outsider = User(
        id=99,
        username="outsider",
        first_name="Out",
        last_name="Sider",
        email="out@test.com",
        password="hashed_password",
        user_uuid="user_outsider",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(outsider)
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await enroll_org_member(org.id, outsider.id, course.course_uuid, _public(admin_user), db)
    assert exc.value.status_code == 404
    assert await _runs(db, outsider.id, org.id) == []


async def test_course_from_another_org_is_not_found(db, org, other_org, admin_user, regular_user):
    foreign = Course(
        name="Foreign",
        description="",
        public=True,
        published=True,
        open_to_contributors=False,
        org_id=other_org.id,
        course_uuid="course_foreign",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(foreign)
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await enroll_org_member(org.id, regular_user.id, "course_foreign", _public(admin_user), db)
    assert exc.value.status_code == 404


async def test_admin_of_another_org_cannot_enroll_here(db, org, other_org, admin_user, regular_user, course):
    # admin_user administers `org`; acting on `other_org` they are not a member.
    with pytest.raises(HTTPException) as exc:
        await enroll_org_member(other_org.id, regular_user.id, course.course_uuid, _public(admin_user), db)
    assert exc.value.status_code == 403


async def test_admin_unenrolls_member_and_drops_progress(db, org, admin_user, regular_user, course, _no_analytics):
    await enroll_org_member(org.id, regular_user.id, course.course_uuid, _public(admin_user), db)
    trail = (await db.execute(select(Trail).where(Trail.user_id == regular_user.id))).scalars().first()
    db.add(TrailStep(complete=True, teacher_verified=False, grade="", data={}, trailrun_id=1, trail_id=trail.id,
                     activity_id=1, course_id=course.id, org_id=org.id, user_id=regular_user.id,
                     creation_date=str(datetime.now()), update_date=str(datetime.now())))
    await db.commit()

    result = await unenroll_org_member(org.id, regular_user.id, course.course_uuid, _public(admin_user), db)

    assert result.unenrolled is True and result.course_uuid == course.course_uuid
    assert await _runs(db, regular_user.id, org.id) == []
    steps = (await db.execute(select(TrailStep).where(TrailStep.user_id == regular_user.id))).scalars().all()
    assert steps == []
    assert _no_analytics.await_args.kwargs["properties"]["source"] == "dashboard"


async def test_unenroll_guards(db, org, other_org, admin_user, regular_user, course):
    with pytest.raises(HTTPException) as exc:
        await unenroll_org_member(org.id, regular_user.id, course.course_uuid, AnonymousUser(), db)
    assert exc.value.status_code == 401
    with pytest.raises(HTTPException) as exc:
        await unenroll_org_member(org.id, admin_user.id, course.course_uuid, _public(regular_user), db)
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        await unenroll_org_member(org.id, regular_user.id, "course_missing", _public(admin_user), db)
    assert exc.value.status_code == 404 and exc.value.detail == "Course not found"
    with pytest.raises(HTTPException) as exc:
        await unenroll_org_member(org.id, regular_user.id, course.course_uuid, _public(admin_user), db)
    assert exc.value.status_code == 404 and exc.value.detail == "Enrollment not found"
