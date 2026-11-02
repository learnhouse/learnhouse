"""Service tests for learning paths (src/services/paths/paths.py).

Runs against the in-memory SQLite DB from conftest. Webhooks are stubbed;
authorization, ordering, progress and certificate issuance run for real.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.courses import Course
from src.db.paths import (
    Path,
    PathCertificate,
    PathCourse,
    PathCourseInput,
    PathCoursesUpdate,
    PathCreate,
    PathEnrollment,
    PathUpdate,
)
from src.db.trail_steps import TrailStep
from src.services.paths import paths as svc


@pytest.fixture(autouse=True)
def _no_webhooks():
    with patch("src.services.paths.paths.dispatch_webhooks", new_callable=AsyncMock) as mock:
        yield mock


async def _course(db, org, idx: int, *, published: bool = True, public: bool = True) -> Course:
    """A course with one published activity, so it can be completed."""
    now = str(datetime.now())
    course = Course(
        id=100 + idx,
        name=f"Course {idx}",
        description="",
        public=public,
        published=published,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid=f"course_p{idx}",
        creation_date=now,
        update_date=now,
    )
    db.add(course)
    await db.commit()
    activity = Activity(
        id=100 + idx,
        name=f"Activity {idx}",
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={},
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid=f"activity_p{idx}",
        creation_date=now,
        update_date=now,
    )
    db.add(activity)
    await db.commit()
    db.add(
        ChapterActivity(
            order=1,
            chapter_id=1,
            activity_id=activity.id,
            course_id=course.id,
            org_id=org.id,
            creation_date=now,
            update_date=now,
        )
    )
    await db.commit()
    await db.refresh(course)
    return course


async def _complete(db, org, course: Course, user_id: int) -> None:
    db.add(
        TrailStep(
            complete=True,
            teacher_verified=False,
            grade="",
            data={},
            trailrun_id=1,
            trail_id=1,
            activity_id=course.id,  # _course gives activity the course's id
            course_id=course.id,
            org_id=org.id,
            user_id=user_id,
            creation_date="2026-01-01",
            update_date="2026-01-01",
        )
    )
    await db.commit()


async def _path(db, org, admin_user, courses, **fields):
    defaults = {"name": "Data Path", "published": True, "public": True}
    defaults.update(fields)
    read = await svc.create_path(None, PathCreate(org_id=org.id, **defaults), admin_user, db)
    if courses:
        read = await svc.set_path_courses(
            None,
            read.path_uuid,
            PathCoursesUpdate(
                courses=[
                    PathCourseInput(course_uuid=c.course_uuid, required=req)
                    for c, req in courses
                ]
            ),
            admin_user,
            db,
        )
    return read


# ----------------------------------------------------------------------------
# Authoring
# ----------------------------------------------------------------------------

class TestAuthoring:
    async def test_admin_creates_draft_by_default(self, db, org, admin_user):
        read = await svc.create_path(None, PathCreate(org_id=org.id, name="  Path  "), admin_user, db)
        assert read.name == "Path"
        assert read.path_uuid.startswith("path_")
        assert read.published is False

    async def test_learner_cannot_create(self, db, org, regular_user):
        with pytest.raises(HTTPException) as exc:
            await svc.create_path(None, PathCreate(org_id=org.id, name="x"), regular_user, db)
        assert exc.value.status_code == 403

    async def test_anonymous_cannot_create(self, db, org, anonymous_user):
        with pytest.raises(HTTPException) as exc:
            await svc.create_path(None, PathCreate(org_id=org.id, name="x"), anonymous_user, db)
        assert exc.value.status_code == 401

    async def test_rejects_blank_name_and_bad_level(self, db, org, admin_user):
        with pytest.raises(HTTPException):
            await svc.create_path(None, PathCreate(org_id=org.id, name=" "), admin_user, db)
        with pytest.raises(HTTPException):
            await svc.create_path(None, PathCreate(org_id=org.id, name="x", level="expert"), admin_user, db)

    async def test_update_cleans_certificate_config(self, db, org, admin_user):
        read = await _path(db, org, admin_user, [])
        read = await svc.update_path(
            None,
            read.path_uuid,
            PathUpdate(
                certificate_enabled=True,
                certificate_config={"certification_name": "Data Analyst", "evil": "x", "certificate_pattern": 3},
            ),
            admin_user,
            db,
        )
        assert read.certificate_enabled is True
        assert read.certificate_config == {"certification_name": "Data Analyst"}

    async def test_courses_keep_order_and_required_flag(self, db, org, admin_user):
        a, b, c = [await _course(db, org, i) for i in (1, 2, 3)]
        read = await _path(db, org, admin_user, [(c, True), (a, False), (b, True)])
        assert [i.course_uuid for i in read.courses] == ["course_p3", "course_p1", "course_p2"]
        assert [i.required for i in read.courses] == [True, False, True]

        read = await svc.set_path_courses(
            None, read.path_uuid,
            PathCoursesUpdate(courses=[PathCourseInput(course_uuid="course_p1")]),
            admin_user, db,
        )
        assert [i.course_uuid for i in read.courses] == ["course_p1"]
        assert read.courses[0].required is True

    async def test_rejects_duplicate_and_foreign_courses(self, db, org, other_org, admin_user):
        a = await _course(db, org, 1)
        read = await _path(db, org, admin_user, [])
        with pytest.raises(HTTPException) as exc:
            await svc.set_path_courses(
                None, read.path_uuid,
                PathCoursesUpdate(courses=[PathCourseInput(course_uuid=a.course_uuid)] * 2),
                admin_user, db,
            )
        assert exc.value.status_code == 400

        foreign = await _course(db, other_org, 9)
        with pytest.raises(HTTPException) as exc:
            await svc.set_path_courses(
                None, read.path_uuid,
                PathCoursesUpdate(courses=[PathCourseInput(course_uuid=foreign.course_uuid)]),
                admin_user, db,
            )
        assert exc.value.status_code == 404

    async def test_learner_cannot_edit(self, db, org, admin_user, regular_user):
        read = await _path(db, org, admin_user, [])
        with pytest.raises(HTTPException) as exc:
            await svc.update_path(None, read.path_uuid, PathUpdate(name="x"), regular_user, db)
        assert exc.value.status_code == 403


# ----------------------------------------------------------------------------
# Visibility
# ----------------------------------------------------------------------------

class TestVisibility:
    async def test_draft_hidden_from_learners(self, db, org, admin_user, regular_user):
        read = await _path(db, org, admin_user, [], published=False)
        with pytest.raises(HTTPException) as exc:
            await svc.get_path(None, read.path_uuid, regular_user, db)
        assert exc.value.status_code == 404
        assert (await svc.get_path(None, read.path_uuid, admin_user, db)).path_uuid == read.path_uuid

    async def test_private_path_members_only(self, db, org, admin_user, regular_user, anonymous_user):
        read = await _path(db, org, admin_user, [], public=False)
        assert (await svc.get_path(None, read.path_uuid, regular_user, db)).name == "Data Path"
        with pytest.raises(HTTPException):
            await svc.get_path(None, read.path_uuid, anonymous_user, db)

    async def test_listing_filters_by_viewer(self, db, org, admin_user, regular_user, anonymous_user):
        await _path(db, org, admin_user, [], name="Draft", published=False)
        await _path(db, org, admin_user, [], name="Members", public=False)
        await _path(db, org, admin_user, [], name="Open")
        names = lambda rows: sorted(r.name for r in rows)  # noqa: E731
        assert names(await svc.list_org_paths(None, org.id, admin_user, db)) == ["Draft", "Members", "Open"]
        assert names(await svc.list_org_paths(None, org.id, regular_user, db)) == ["Members", "Open"]
        assert names(await svc.list_org_paths(None, org.id, anonymous_user, db)) == ["Open"]

    async def test_unpublished_course_hidden_and_not_required(self, db, org, admin_user, regular_user):
        live = await _course(db, org, 1)
        draft = await _course(db, org, 2, published=False)
        read = await _path(db, org, admin_user, [(live, True), (draft, True)])
        learner_view = await svc.get_path(None, read.path_uuid, regular_user, db)
        assert [i.course_uuid for i in learner_view.courses] == ["course_p1"]
        assert learner_view.progress.required_total == 1
        assert len((await svc.get_path(None, read.path_uuid, admin_user, db)).courses) == 2

    async def test_private_course_is_a_restricted_slot_for_anonymous(self, db, org, admin_user, anonymous_user):
        hidden = await _course(db, org, 1, public=False)
        read = await _path(db, org, admin_user, [(hidden, True)])
        view = await svc.get_path(None, read.path_uuid, anonymous_user, db)
        assert view.courses[0].course == {"course_uuid": "course_p1", "restricted": True}

    async def test_api_token_sees_private_paths_of_its_own_org_only(self, db, org, other_org, admin_user):
        from src.db.users import APITokenUser

        course = await _course(db, org, 1)
        read = await _path(db, org, admin_user, [(course, True)], name="Members", public=False)
        # The token's creator is a member of `org`, but the token belongs to another org.
        foreign = APITokenUser(org_id=other_org.id, created_by_user_id=admin_user.id)
        own = APITokenUser(org_id=org.id, created_by_user_id=admin_user.id)
        with pytest.raises(HTTPException) as exc:
            await svc.get_path(None, read.path_uuid, foreign, db)
        assert exc.value.status_code == 404
        assert await svc.list_org_paths(None, org.id, foreign, db) == []
        assert await svc.get_paths_for_course(None, course.course_uuid, foreign, db) == []
        assert (await svc.get_path(None, read.path_uuid, own, db)).name == "Members"
        assert [p.name for p in await svc.list_org_paths(None, org.id, own, db)] == ["Members"]

    async def test_paths_for_course(self, db, org, admin_user, anonymous_user):
        course = await _course(db, org, 1)
        await _path(db, org, admin_user, [(course, True)], name="Open")
        await _path(db, org, admin_user, [(course, True)], name="Draft", published=False)
        await _path(db, org, admin_user, [(course, True)], name="Members", public=False)
        rows = await svc.get_paths_for_course(None, course.course_uuid, anonymous_user, db)
        assert [r.name for r in rows] == ["Open"]


# ----------------------------------------------------------------------------
# Progress + completion
# ----------------------------------------------------------------------------

class TestCompletion:
    async def test_sequential_locks_after_first_unfinished_required(self, db, org, admin_user, regular_user):
        a, b, c = [await _course(db, org, i) for i in (1, 2, 3)]
        read = await _path(db, org, admin_user, [(a, True), (b, True), (c, True)], sequential=True)
        view = await svc.get_path(None, read.path_uuid, regular_user, db)
        assert [i.locked for i in view.courses] == [False, True, True]

        await _complete(db, org, a, regular_user.id)
        view = await svc.get_path(None, read.path_uuid, regular_user, db)
        assert [i.locked for i in view.courses] == [False, False, True]
        assert view.courses[0].completed and view.courses[0].progress == 100

    async def test_enroll_then_finish_issues_certificate(self, db, org, admin_user, regular_user, _no_webhooks):
        a, b = await _course(db, org, 1), await _course(db, org, 2)
        read = await _path(db, org, admin_user, [(a, True), (b, True)], certificate_enabled=True)

        view = await svc.enroll_in_path(None, read.path_uuid, regular_user, db)
        assert view.progress.enrolled and not view.progress.completed

        await _complete(db, org, a, regular_user.id)
        await svc.check_paths_for_completed_course(None, regular_user.id, a.id, db)
        assert not (await db.execute(select(PathCertificate))).scalars().all()

        await _complete(db, org, b, regular_user.id)
        await svc.check_paths_for_completed_course(None, regular_user.id, b.id, db)
        cert = (await db.execute(select(PathCertificate))).scalars().one()
        assert cert.certificate_uuid.startswith("PATH-")

        view = await svc.get_path(None, read.path_uuid, regular_user, db)
        assert view.progress.completed and view.progress.percent == 100
        assert view.progress.certificate_uuid == cert.certificate_uuid
        events = [call.kwargs["event_name"] for call in _no_webhooks.await_args_list]
        assert events == ["path_enrolled", "path_completed"]

        verified = await svc.get_path_certificate(None, cert.certificate_uuid, db)
        assert verified["path"]["name"] == "Data Path"
        assert verified["user"]["first_name"] == "Regular"
        assert "email" not in verified["user"]

    async def test_enrolling_after_the_work_certifies_at_once(self, db, org, admin_user, regular_user):
        a = await _course(db, org, 1)
        await _complete(db, org, a, regular_user.id)
        read = await _path(db, org, admin_user, [(a, True)], certificate_enabled=True)
        view = await svc.enroll_in_path(None, read.path_uuid, regular_user, db)
        assert view.progress.completed
        assert view.progress.certificate_uuid

    async def test_completion_without_certificate(self, db, org, admin_user, regular_user):
        a = await _course(db, org, 1)
        await _complete(db, org, a, regular_user.id)
        read = await _path(db, org, admin_user, [(a, True)])
        view = await svc.enroll_in_path(None, read.path_uuid, regular_user, db)
        assert view.progress.completed and view.progress.certificate_uuid is None
        assert (await db.execute(select(PathEnrollment))).scalars().one().completed_at

    async def test_not_enrolled_learner_gets_nothing(self, db, org, admin_user, regular_user):
        a = await _course(db, org, 1)
        await _path(db, org, admin_user, [(a, True)], certificate_enabled=True)
        await _complete(db, org, a, regular_user.id)
        await svc.check_paths_for_completed_course(None, regular_user.id, a.id, db)
        assert not (await db.execute(select(PathCertificate))).scalars().all()

    async def test_electives_count_up_to_the_requirement(self, db, org, admin_user, regular_user):
        core, e1, e2 = [await _course(db, org, i) for i in (1, 2, 3)]
        read = await _path(
            db, org, admin_user, [(core, True), (e1, False), (e2, False)], electives_required=1,
        )
        await svc.enroll_in_path(None, read.path_uuid, regular_user, db)
        await _complete(db, org, core, regular_user.id)
        view = await svc.get_path(None, read.path_uuid, regular_user, db)
        assert view.progress.percent == 50 and not view.progress.completed
        assert (view.progress.courses_done, view.progress.courses_needed) == (1, 2)

        await _complete(db, org, e2, regular_user.id)
        await svc.check_paths_for_completed_course(None, regular_user.id, e2.id, db)
        view = await svc.get_path(None, read.path_uuid, regular_user, db)
        assert view.progress.completed and view.progress.electives_done == 1

    async def test_electives_requirement_capped_by_available(self):
        path = Path(name="p", org_id=1, electives_required=5)
        c1 = Course(id=1, name="a", public=True, published=True, open_to_contributors=False, org_id=1)
        c2 = Course(id=2, name="b", public=True, published=True, open_to_contributors=False, org_id=1)
        rows = [(PathCourse(path_id=1, course_id=1, required=True), c1),
                (PathCourse(path_id=1, course_id=2, required=False), c2)]
        assert svc._summarize(path, rows, {1, 2})["complete"] is True
        assert svc._summarize(path, [], set())["complete"] is False

    async def test_learners_and_revoke(self, db, org, admin_user, regular_user):
        a = await _course(db, org, 1)
        await _complete(db, org, a, regular_user.id)
        read = await _path(db, org, admin_user, [(a, True)], certificate_enabled=True)
        view = await svc.enroll_in_path(None, read.path_uuid, regular_user, db)

        learners = await svc.get_path_learners(None, read.path_uuid, admin_user, db)
        assert learners[0].user["username"] == "regular"
        assert learners[0].percent == 100

        mine = await svc.get_my_path_certificates(None, regular_user, db)
        assert mine[0]["certificate"]["certificate_uuid"] == view.progress.certificate_uuid

        with pytest.raises(HTTPException) as exc:
            await svc.delete_path(None, read.path_uuid, admin_user, db)
        assert exc.value.status_code == 409

        await svc.revoke_path_certificate(
            None, read.path_uuid, view.progress.certificate_uuid, admin_user, db
        )
        # Kept and marked revoked: it stops verifying and leaves the learner's list.
        assert (await db.execute(select(PathCertificate))).scalars().one().revoked_at
        with pytest.raises(HTTPException) as exc:
            await svc.get_path_certificate(None, view.progress.certificate_uuid, db)
        assert exc.value.status_code == 404
        assert await svc.get_my_path_certificates(None, regular_user, db) == []
        learners = await svc.get_path_learners(None, read.path_uuid, admin_user, db)
        assert learners[0].certificate_revoked is True
        progress = (await svc.get_path(None, read.path_uuid, regular_user, db)).progress
        assert progress.certificate_uuid is None and progress.certificate_revoked is True
        # Revoking twice is harmless, and only active certificates block deletion.
        await svc.revoke_path_certificate(None, read.path_uuid, view.progress.certificate_uuid, admin_user, db)
        await svc.delete_path(None, read.path_uuid, admin_user, db)
        assert not (await db.execute(select(Path))).scalars().all()

    async def test_revoked_certificate_is_not_reissued(self, db, org, admin_user, regular_user):
        a = await _course(db, org, 1)
        await _complete(db, org, a, regular_user.id)
        read = await _path(db, org, admin_user, [(a, True)], certificate_enabled=True)
        cert = (await svc.enroll_in_path(None, read.path_uuid, regular_user, db)).progress.certificate_uuid
        await svc.revoke_path_certificate(None, read.path_uuid, cert, admin_user, db)

        # Leaving and starting again still completes the path, but issues nothing.
        await svc.leave_path(None, read.path_uuid, regular_user, db)
        view = await svc.enroll_in_path(None, read.path_uuid, regular_user, db)
        assert view.progress.completed and view.progress.certificate_uuid is None
        rows = (await db.execute(select(PathCertificate))).scalars().all()
        assert len(rows) == 1 and rows[0].revoked_at

        await svc.reinstate_path_certificate(None, read.path_uuid, cert, admin_user, db)
        await svc.reinstate_path_certificate(None, read.path_uuid, cert, admin_user, db)
        assert (await svc.get_path_certificate(None, cert, db))["certificate"]["certificate_uuid"] == cert
        assert (await svc.get_path(None, read.path_uuid, regular_user, db)).progress.certificate_uuid == cert

    async def test_only_admins_revoke_or_reinstate(self, db, org, admin_user, regular_user):
        a = await _course(db, org, 1)
        await _complete(db, org, a, regular_user.id)
        read = await _path(db, org, admin_user, [(a, True)], certificate_enabled=True)
        cert = (await svc.enroll_in_path(None, read.path_uuid, regular_user, db)).progress.certificate_uuid
        for action in (svc.revoke_path_certificate, svc.reinstate_path_certificate):
            with pytest.raises(HTTPException) as exc:
                await action(None, read.path_uuid, cert, regular_user, db)
            assert exc.value.status_code == 403
        with pytest.raises(HTTPException) as exc:
            await svc.revoke_path_certificate(None, read.path_uuid, "PATH-unknown", admin_user, db)
        assert exc.value.status_code == 404

    async def test_leave_keeps_certificate(self, db, org, admin_user, regular_user):
        a = await _course(db, org, 1)
        await _complete(db, org, a, regular_user.id)
        read = await _path(db, org, admin_user, [(a, True)], certificate_enabled=True)
        await svc.enroll_in_path(None, read.path_uuid, regular_user, db)
        await svc.leave_path(None, read.path_uuid, regular_user, db)
        assert not (await db.execute(select(PathEnrollment))).scalars().all()
        assert (await db.execute(select(PathCertificate))).scalars().one()
        assert await svc.get_my_paths(None, org.id, regular_user, db) == []

    async def test_cannot_enroll_anonymous(self, db, org, admin_user, anonymous_user):
        read = await _path(db, org, admin_user, [])
        with pytest.raises(HTTPException) as exc:
            await svc.enroll_in_path(None, read.path_uuid, anonymous_user, db)
        assert exc.value.status_code == 401

    async def test_course_completion_hook_reaches_paths(self, db, org, admin_user, regular_user):
        from src.services.courses.certifications import (
            check_course_completion_and_create_certificate,
        )

        a = await _course(db, org, 1)
        read = await _path(db, org, admin_user, [(a, True)], certificate_enabled=True)
        await svc.enroll_in_path(None, read.path_uuid, regular_user, db)
        await _complete(db, org, a, regular_user.id)
        await check_course_completion_and_create_certificate(None, regular_user.id, a.id, db)
        assert (await db.execute(select(PathCertificate))).scalars().one()

    async def test_plan_below_pro_skips_issuance(self, db, org, admin_user, regular_user):
        a = await _course(db, org, 1)
        read = await _path(db, org, admin_user, [(a, True)], certificate_enabled=True)
        await svc.enroll_in_path(None, read.path_uuid, regular_user, db)
        await _complete(db, org, a, regular_user.id)
        with patch(
            "src.security.features_utils.plan_check.check_org_plan",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=403, detail="pro"),
        ):
            await svc.check_paths_for_completed_course(None, regular_user.id, a.id, db)
        assert not (await db.execute(select(PathCertificate))).scalars().all()


# ----------------------------------------------------------------------------
# Edge cases: validation, API tokens, races and best-effort side effects
# ----------------------------------------------------------------------------

class TestEdgeCases:
    async def test_api_tokens_author_only_in_their_org_with_the_right(self, db, org, other_org, admin_user):
        from src.db.users import APITokenUser

        writer = APITokenUser(org_id=org.id, created_by_user_id=admin_user.id, rights={"courses": {"action_create": True}})
        assert (await svc.create_path(None, PathCreate(org_id=org.id, name="Via API"), writer, db)).name == "Via API"
        for token in (
            APITokenUser(org_id=other_org.id, rights={"courses": {"action_create": True}}),
            APITokenUser(org_id=org.id, rights={"courses": {"action_read": True}}),
        ):
            with pytest.raises(HTTPException) as exc:
                await svc.create_path(None, PathCreate(org_id=org.id, name="x"), token, db)
            assert exc.value.status_code == 403

    async def test_validation(self, db, org, admin_user):
        with pytest.raises(HTTPException) as exc:
            await svc.create_path(None, PathCreate(org_id=org.id, name="x", electives_required=-1), admin_user, db)
        assert exc.value.status_code == 400
        read = await _path(db, org, admin_user, [])
        with pytest.raises(HTTPException):
            await svc.update_path(None, read.path_uuid, PathUpdate(name="   "), admin_user, db)
        updated = await svc.update_path(
            None, read.path_uuid, PathUpdate(name="  Renamed  ", description=None, certificate_config=None), admin_user, db
        )
        assert updated.name == "Renamed" and updated.description == "" and updated.certificate_config == {}
        too_many = PathCoursesUpdate(courses=[PathCourseInput(course_uuid=f"course_{i}") for i in range(svc.MAX_PATH_COURSES + 1)])
        with pytest.raises(HTTPException) as exc:
            await svc.set_path_courses(None, read.path_uuid, too_many, admin_user, db)
        assert exc.value.status_code == 400

    async def test_upload_thumbnail(self, db, org, admin_user):
        read = await _path(db, org, admin_user, [])
        with patch("src.services.utils.upload_content.upload_file", new_callable=AsyncMock, return_value="thumbnail_1.png") as upload:
            updated = await svc.upload_path_thumbnail(None, read.path_uuid, object(), admin_user, db)
        assert updated.thumbnail_image == "thumbnail_1.png"
        assert upload.await_args.kwargs["directory"] == f"paths/{read.path_uuid}/thumbnails"

    async def test_paths_for_course_edge_cases(self, db, org, anonymous_user):
        with pytest.raises(HTTPException) as exc:
            await svc.get_paths_for_course(None, "course_missing", anonymous_user, db)
        assert exc.value.status_code == 404
        course = await _course(db, org, 1)
        assert await svc.get_paths_for_course(None, course.course_uuid, anonymous_user, db) == []

    async def test_draft_cannot_be_started(self, db, org, admin_user):
        read = await _path(db, org, admin_user, [], published=False)
        with pytest.raises(HTTPException) as exc:
            await svc.enroll_in_path(None, read.path_uuid, admin_user, db)
        assert exc.value.status_code == 400

    async def test_double_enroll_race_is_harmless(self, db, org, admin_user, regular_user):
        from sqlalchemy.exc import IntegrityError

        read = await _path(db, org, admin_user, [])
        real_commit = db.commit
        calls = {"n": 0}

        async def commit():
            calls["n"] += 1
            if calls["n"] == 1:
                raise IntegrityError("insert", {}, Exception("duplicate"))
            await real_commit()

        with patch.object(db, "commit", side_effect=commit):
            view = await svc.enroll_in_path(None, read.path_uuid, regular_user, db)
        assert view.path_uuid == read.path_uuid

    async def test_certificate_issue_race_is_harmless(self, db, org, admin_user, regular_user):
        from sqlalchemy.exc import IntegrityError

        a = await _course(db, org, 1)
        read = await _path(db, org, admin_user, [(a, True)], certificate_enabled=True)
        await svc.enroll_in_path(None, read.path_uuid, regular_user, db)
        await _complete(db, org, a, regular_user.id)
        path = (await db.execute(select(Path))).scalars().one()
        real_commit = db.commit
        calls = {"n": 0}

        async def commit():
            calls["n"] += 1
            if calls["n"] == 2:  # the certificate insert, after the enrollment is marked done
                raise IntegrityError("insert", {}, Exception("duplicate"))
            await real_commit()

        with patch.object(db, "commit", side_effect=commit):
            assert await svc.check_path_completion(None, path, regular_user.id, db) is True

    async def test_webhook_failures_never_break_learners(self, db, org, admin_user, regular_user, _no_webhooks):
        _no_webhooks.side_effect = RuntimeError("webhook down")
        a = await _course(db, org, 1)
        await _complete(db, org, a, regular_user.id)
        read = await _path(db, org, admin_user, [(a, True)], certificate_enabled=True)
        view = await svc.enroll_in_path(None, read.path_uuid, regular_user, db)
        assert view.progress.completed and view.progress.certificate_uuid

    async def test_completion_check_is_best_effort(self, db, org, admin_user, regular_user):
        a = await _course(db, org, 1)
        read = await _path(db, org, admin_user, [(a, True)])
        await svc.enroll_in_path(None, read.path_uuid, regular_user, db)
        await _complete(db, org, a, regular_user.id)
        with patch.object(svc, "check_path_completion", new_callable=AsyncMock, side_effect=RuntimeError("boom")):
            await svc.check_paths_for_completed_course(None, regular_user.id, a.id, db)
        path = (await db.execute(select(Path))).scalars().one()
        assert await svc.check_path_completion(None, path, admin_user.id, db) is False  # not enrolled

    async def test_internal_helpers_handle_empty_and_orphaned_input(self, db, org, admin_user, regular_user):
        assert await svc._counts(db, []) == ({}, {})
        read = await _path(db, org, admin_user, [])
        path = (await db.execute(select(Path))).scalars().one()
        progress = await svc._viewer_progress(db, path, [], regular_user.id)
        assert progress.enrolled is False and progress.percent == 0
        with pytest.raises(HTTPException) as exc:
            await svc._certificate_payload(db, PathCertificate(path_id=9999, user_id=regular_user.id, certificate_uuid="x"))
        assert exc.value.status_code == 404
        assert read.path_uuid
