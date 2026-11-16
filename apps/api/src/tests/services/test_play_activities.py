"""Play activities (TYPE_PLAY) in core: the stored link, its checks on create
and update, the trail refusing a self-marked play, the AI tools' type name,
and course copies keeping the link. The play side (EE) is mocked here; the
EE tests cover it (ee/tests/test_play_course_activity.py)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.activities import (
    Activity,
    ActivityCreate,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
    ActivityUpdate,
)
from src.db.trail_steps import TrailStep
from src.services.ai.tools.chapters import activity_type
from src.services.courses.activities import play_link
from src.services.courses.activities.activities import create_activity, get_activity, update_activity
from src.services.courses.activities.play_link import is_play_type, play_activity_content, play_is_available
from src.services.trail.trail import add_activity_to_trail

LINK = {"playground_uuid": "pg-1"}


def _ee(resolve=None):
    """A stand-in for ee.services.playgrounds.course_activity."""
    resolve = resolve or AsyncMock(return_value=SimpleNamespace(playground_uuid="pg-1"))
    return SimpleNamespace(resolve_play_for_course=resolve)


@pytest.fixture
def rbac():
    with patch("src.services.courses.activities.activities.check_resource_access", new_callable=AsyncMock) as mock:
        yield mock


@pytest.fixture
def ee_module():
    module = _ee()
    with patch.object(play_link, "get_ee_module", return_value=module) as getter:
        yield module, getter


async def _play_activity(db, org, course, *, uuid="activity_play", content=None, published=True):
    a = Activity(
        name="Play", activity_type=ActivityTypeEnum.TYPE_PLAY, activity_sub_type=ActivitySubTypeEnum.SUBTYPE_PLAY,
        content=dict(LINK if content is None else content), published=published, org_id=org.id,
        course_id=course.id, activity_uuid=uuid, creation_date="now", update_date="now",
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


class TestPlayLink:
    def test_is_play_type(self):
        assert is_play_type(ActivityTypeEnum.TYPE_PLAY)
        assert is_play_type("TYPE_PLAY")
        assert not is_play_type(ActivityTypeEnum.TYPE_DYNAMIC)
        assert not is_play_type(None)

    @pytest.mark.asyncio
    async def test_needs_enterprise(self, mock_request, db, admin_user):
        with patch.object(play_link, "get_ee_module", return_value=None):
            with pytest.raises(HTTPException) as exc:
                await play_activity_content(mock_request, LINK, 1, admin_user, db)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    @pytest.mark.parametrize("content", [None, {}, {"playground_uuid": ""}, {"playground_uuid": "  "}, {"playground_uuid": 5}])
    async def test_needs_a_play_uuid(self, mock_request, db, admin_user, ee_module, content):
        with pytest.raises(HTTPException) as exc:
            await play_activity_content(mock_request, content, 1, admin_user, db)
        assert exc.value.status_code == 400
        ee_module[0].resolve_play_for_course.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_stores_only_the_checked_link(self, mock_request, db, admin_user, ee_module):
        module, getter = ee_module
        out = await play_activity_content(
            mock_request, {"playground_uuid": " pg-1 ", "extra": "dropped"}, 7, admin_user, db
        )
        assert out == {"playground_uuid": "pg-1"}
        getter.assert_called_once_with("ee.services.playgrounds.course_activity")
        module.resolve_play_for_course.assert_awaited_once_with(mock_request, 7, "pg-1", admin_user, db)

    @pytest.mark.asyncio
    async def test_ee_refusals_pass_through(self, mock_request, db, admin_user):
        module = _ee(AsyncMock(side_effect=HTTPException(status_code=404, detail="Play not found")))
        with patch.object(play_link, "get_ee_module", return_value=module):
            with pytest.raises(HTTPException) as exc:
                await play_activity_content(mock_request, LINK, 1, admin_user, db)
        assert exc.value.status_code == 404


class TestCreateAndUpdate:
    @pytest.mark.asyncio
    async def test_create_play_activity(self, mock_request, db, org, course, chapter, admin_user, ee_module, rbac):
        obj = ActivityCreate(
            name="Practice", chapter_id=chapter.id, activity_type=ActivityTypeEnum.TYPE_PLAY,
            # A wrong subtype is corrected: a play activity is always SUBTYPE_PLAY.
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_CUSTOM, content={"playground_uuid": "pg-1", "x": 1},
        )
        with patch("src.services.courses.activities.utils.track", new_callable=AsyncMock):
            created = await create_activity(mock_request, obj, admin_user, db)
        assert created.activity_type == ActivityTypeEnum.TYPE_PLAY
        assert created.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_PLAY
        assert created.content == {"playground_uuid": "pg-1"}
        ee_module[0].resolve_play_for_course.assert_awaited_once()
        assert ee_module[0].resolve_play_for_course.await_args.args[1] == org.id

    @pytest.mark.asyncio
    async def test_create_refused_without_enterprise(self, mock_request, db, chapter, admin_user, rbac):
        obj = ActivityCreate(name="P", chapter_id=chapter.id, activity_type=ActivityTypeEnum.TYPE_PLAY, content=LINK)
        with patch.object(play_link, "get_ee_module", return_value=None):
            with pytest.raises(HTTPException) as exc:
                await create_activity(mock_request, obj, admin_user, db)
        assert exc.value.status_code == 403
        assert (await db.execute(Activity.__table__.select())).all() == []

    @pytest.mark.asyncio
    async def test_other_types_skip_the_check(self, mock_request, db, chapter, admin_user, rbac):
        obj = ActivityCreate(
            name="Page", chapter_id=chapter.id, activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE, content={"type": "doc"},
        )
        with patch.object(play_link, "get_ee_module") as getter, patch(
            "src.services.courses.activities.utils.track", new_callable=AsyncMock
        ):
            await create_activity(mock_request, obj, admin_user, db)
        getter.assert_not_called()

    @pytest.mark.asyncio
    async def test_relink_checks_the_new_play(self, mock_request, db, org, course, admin_user, rbac):
        act = await _play_activity(db, org, course)
        module = _ee(AsyncMock(return_value=SimpleNamespace(playground_uuid="pg-2")))
        with patch.object(play_link, "get_ee_module", return_value=module):
            updated = await update_activity(
                mock_request, ActivityUpdate(content={"playground_uuid": "pg-2"}), act.activity_uuid, admin_user, db
            )
        assert updated.content == {"playground_uuid": "pg-2"}
        assert updated.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_PLAY
        assert updated.current_version == 2

    @pytest.mark.asyncio
    async def test_rename_does_not_recheck(self, mock_request, db, org, course, admin_user, rbac):
        act = await _play_activity(db, org, course)
        with patch.object(play_link, "get_ee_module") as getter:
            updated = await update_activity(mock_request, ActivityUpdate(name="Renamed"), act.activity_uuid, admin_user, db)
        getter.assert_not_called()
        assert updated.name == "Renamed" and updated.content == LINK

    @pytest.mark.asyncio
    async def test_turning_into_a_play_checks_the_link(self, mock_request, db, org, course, activity, admin_user, ee_module, rbac):
        with pytest.raises(HTTPException) as exc:
            # The page's own content has no play uuid.
            await update_activity(
                mock_request, ActivityUpdate(activity_type=ActivityTypeEnum.TYPE_PLAY), activity.activity_uuid, admin_user, db
            )
        assert exc.value.status_code == 400
        updated = await update_activity(
            mock_request, ActivityUpdate(activity_type=ActivityTypeEnum.TYPE_PLAY, content=LINK),
            activity.activity_uuid, admin_user, db,
        )
        assert updated.activity_type == ActivityTypeEnum.TYPE_PLAY
        assert updated.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_PLAY


@pytest.fixture
def quiet_trail():
    with patch("src.services.trail.trail.track", new_callable=AsyncMock), patch(
        "src.services.trail.trail.dispatch_webhooks", new_callable=AsyncMock
    ), patch(
        "src.services.trail.trail.verify_activity_reader_access", new_callable=AsyncMock
    ), patch(
        "src.services.trail.trail.check_course_completion_and_create_certificate", new_callable=AsyncMock
    ):
        yield


class TestPlayAvailable:
    @pytest.mark.asyncio
    async def test_without_enterprise_never(self, db):
        with patch.object(play_link, "get_ee_module", return_value=None):
            assert await play_is_available(SimpleNamespace(), db) is False

    @pytest.mark.asyncio
    async def test_asks_ee(self, db):
        act = SimpleNamespace()
        module = SimpleNamespace(play_activity_playable=AsyncMock(return_value=True))
        with patch.object(play_link, "get_ee_module", return_value=module):
            assert await play_is_available(act, db) is True
        module.play_activity_playable.assert_awaited_once_with(act, db)

    @pytest.mark.asyncio
    @pytest.mark.parametrize("available", [True, False])
    async def test_the_activity_read_says_so(self, mock_request, db, org, course, chapter, admin_user, rbac, available):
        act = await _play_activity(db, org, course)
        with patch("src.services.courses.activities.activities.play_is_available", AsyncMock(return_value=available)):
            read = await get_activity(mock_request, act.activity_uuid, admin_user, db)
        assert read.play_available is available

    @pytest.mark.asyncio
    async def test_other_activities_leave_it_unset(self, mock_request, db, activity, admin_user, rbac):
        with patch("src.services.courses.activities.activities.play_is_available") as check:
            read = await get_activity(mock_request, activity.activity_uuid, admin_user, db)
        assert read.play_available is None
        check.assert_not_called()


class TestTrail:
    @pytest.mark.asyncio
    async def test_a_play_is_not_self_marked(self, mock_request, db, org, course, chapter, regular_user):
        act = await _play_activity(db, org, course)
        with patch("src.services.trail.trail.play_is_available", AsyncMock(return_value=True)):
            with pytest.raises(HTTPException) as exc:
                await add_activity_to_trail(mock_request, regular_user, act.activity_uuid, db)
        assert exc.value.status_code == 400
        assert (await db.execute(TrailStep.__table__.select())).all() == []

    @pytest.mark.asyncio
    async def test_an_unplayable_play_is_self_marked(self, mock_request, db, org, course, chapter, regular_user, quiet_trail):
        """No Enterprise here: the play can't run, so it can't block the course."""
        act = await _play_activity(db, org, course)
        with patch.object(play_link, "get_ee_module", return_value=None):
            trail = await add_activity_to_trail(mock_request, regular_user, act.activity_uuid, db)
        assert [s.activity_id for s in trail.runs[0].steps] == [act.id]

    @pytest.mark.asyncio
    async def test_passing_the_play_completes_it(self, mock_request, db, org, course, chapter, regular_user):
        act = await _play_activity(db, org, course)
        with patch("src.services.trail.trail.track", new_callable=AsyncMock), patch(
            "src.services.trail.trail.dispatch_webhooks", new_callable=AsyncMock
        ), patch(
            "src.services.trail.trail.verify_activity_reader_access", new_callable=AsyncMock
        ), patch(
            "src.services.trail.trail.check_course_completion_and_create_certificate", new_callable=AsyncMock
        ):
            trail = await add_activity_to_trail(mock_request, regular_user, act.activity_uuid, db, completed_by_play=True)
        assert [s.activity_id for s in trail.runs[0].steps] == [act.id]


class TestAgentTools:
    def test_type_name(self):
        assert activity_type(ActivityTypeEnum.TYPE_PLAY, ActivitySubTypeEnum.SUBTYPE_PLAY) == "play"


class TestCopiesKeepTheLink:
    @pytest.mark.asyncio
    async def test_clone_activity(self, db, org, course, chapter):
        from src.services.courses.courses import clone_activity

        act = await _play_activity(db, org, course)
        with patch("src.services.courses.courses._copy_storage_directory"):
            copy = await clone_activity(
                db, act, [], org_uuid=org.org_uuid, org_id=org.id, source_course_path="x",
                new_course_uuid=course.course_uuid, new_course_path="y", new_course_id=course.id,
                new_chapter_id=chapter.id, order=2,
            )
        assert copy.activity_type == ActivityTypeEnum.TYPE_PLAY
        assert copy.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_PLAY
        assert copy.content == LINK
        assert copy.activity_uuid != act.activity_uuid
