"""Tests for src/services/courses/activities/activities.py."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from src.db.courses.activities import ActivityCreate, ActivityRead, ActivityTypeEnum, ActivitySubTypeEnum, ActivityUpdate
from src.db.organizations import OrganizationRead
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.services.courses.activities.access import apply_activity_lock
from src.services.courses.activities.activities import (
    create_activity,
    delete_activity,
    get_activities,
    get_activity,
    get_activityby_id,
    get_editor_bootstrap,
    update_activity,
    EditorBootstrapResponse,
)


class TestCreateActivity:
    @pytest.mark.asyncio
    async def test_raises_404_when_chapter_not_found(
        self, mock_request, db, org, admin_user
    ):
        activity_obj = ActivityCreate(
            name="Test",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            chapter_id=9999,
            course_id=1,
            org_id=org.id,
            content={},
        )
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await create_activity(mock_request, activity_obj, admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_creates_activity_successfully(
        self, mock_request, db, org, course, chapter, admin_user
    ):
        activity_obj = ActivityCreate(
            name="New Activity",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            chapter_id=chapter.id,
            course_id=course.id,
            org_id=org.id,
            content={"type": "doc", "content": []},
        )
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await create_activity(mock_request, activity_obj, admin_user, db)

        assert isinstance(result, ActivityRead)
        assert result.name == "New Activity"


class TestGetEditorBootstrap:
    @pytest.mark.asyncio
    async def test_raises_404_when_activity_not_found(
        self, mock_request, db, org, course, chapter, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.access.check_ee_activity_paid_access",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.courses.activities.access.apply_activity_lock",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await get_editor_bootstrap(mock_request, "nonexistent-uuid", admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_editor_bootstrap_response(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        fake_org_read = MagicMock(spec=OrganizationRead)

        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.access.check_ee_activity_paid_access",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.courses.activities.access.apply_activity_lock",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.orgs._build_org_read_with_resolved",
            return_value=fake_org_read,
        ), patch(
            "src.services.orgs.orgs._redact_org_email_unless_manager",
            new_callable=AsyncMock,
            return_value=fake_org_read,
        ):
            result = await get_editor_bootstrap(
                mock_request, activity.activity_uuid, admin_user, db
            )

        assert isinstance(result, EditorBootstrapResponse)
        assert result.activity.name == activity.name
        assert result.course.org_uuid == org.org_uuid

    @pytest.mark.asyncio
    async def test_scrubs_content_when_no_paid_access(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        fake_org_read = MagicMock(spec=OrganizationRead)

        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.access.check_ee_activity_paid_access",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "src.services.courses.activities.access.apply_activity_lock",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.orgs._build_org_read_with_resolved",
            return_value=fake_org_read,
        ), patch(
            "src.services.orgs.orgs._redact_org_email_unless_manager",
            new_callable=AsyncMock,
            return_value=fake_org_read,
        ):
            result = await get_editor_bootstrap(
                mock_request, activity.activity_uuid, admin_user, db
            )

        assert result.activity.content == {"paid_access": False}


class TestEditorBootstrapGates:
    @pytest.mark.asyncio
    async def test_learner_gets_403_and_org_email_is_redacted_for_non_managers(
        self, mock_request, db, org, course, chapter, activity, admin_user, regular_user
    ):
        with pytest.raises(HTTPException) as exc:
            await get_editor_bootstrap(mock_request, activity.activity_uuid, regular_user, db)
        assert exc.value.status_code == 403

        # A course contributor can edit but doesn't manage the org
        db.add(ResourceAuthor(
            resource_uuid=course.course_uuid, user_id=regular_user.id,
            authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
            creation_date="now", update_date="now",
        ))
        await db.commit()
        # Fresh requests: RBAC decisions are memoized per request
        fresh = lambda: Request({"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b""})  # noqa: E731
        contributor_view = await get_editor_bootstrap(fresh(), activity.activity_uuid, regular_user, db)
        admin_view = await get_editor_bootstrap(fresh(), activity.activity_uuid, admin_user, db)
        assert contributor_view.org.email is None
        assert admin_view.org.email == org.email


class TestGetActivity:
    @pytest.mark.asyncio
    async def test_raises_404_for_unknown_activity(
        self, mock_request, db, org, course, chapter, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.access.check_ee_activity_paid_access",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.courses.activities.access.apply_activity_lock",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await get_activity(mock_request, "nonexistent-uuid", admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_activity_read(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.access.check_ee_activity_paid_access",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.courses.activities.access.apply_activity_lock",
            new_callable=AsyncMock,
        ):
            result = await get_activity(
                mock_request, activity.activity_uuid, admin_user, db
            )

        assert isinstance(result, ActivityRead)
        assert result.name == activity.name


class TestUpdateActivity:
    @pytest.mark.asyncio
    async def test_raises_404_when_activity_not_found(
        self, mock_request, db, admin_user
    ):
        update_obj = ActivityUpdate(name="Updated")
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await update_activity(mock_request, update_obj, "nonexistent-uuid", admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_updates_activity_name(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        update_obj = ActivityUpdate(name="Renamed Activity")
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.activities.create_activity_version",
            new_callable=AsyncMock,
        ):
            result = await update_activity(
                mock_request, update_obj, activity.activity_uuid, admin_user, db
            )
        assert isinstance(result, ActivityRead)
        assert result.name == "Renamed Activity"

    @pytest.mark.asyncio
    async def test_updates_activity_content_creates_version(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        new_content = {"type": "doc", "content": [{"type": "paragraph"}]}
        update_obj = ActivityUpdate(content=new_content)
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.activities.create_activity_version",
            new_callable=AsyncMock,
        ) as mock_version, patch(
            "src.services.courses.activities.activities.index_activity",
        ) as mock_index:
            result = await update_activity(
                mock_request, update_obj, activity.activity_uuid, admin_user, db
            )
        assert isinstance(result, ActivityRead)
        mock_version.assert_called_once()
        mock_index.assert_called_once_with(activity.id)


    @pytest.mark.asyncio
    async def test_update_keeps_server_owned_caption_and_hls_state(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        server_captions = {"enabled": True, "status": "ready", "languages": [{"code": "fr", "status": "ready"}]}
        activity.extra_metadata = {"captions": server_captions, "note": "old"}
        db.add(activity)
        await db.commit()

        forged = ActivityUpdate(extra_metadata={
            "captions": {"enabled": True, "status": "processing", "languages": [{"code": "../../x"}]},
            "hls": {"status": "ready", "master": "orgs/other/x.m3u8"},
            "note": "new",
        })
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await update_activity(
                mock_request, forged, activity.activity_uuid, admin_user, db
            )
        assert result.extra_metadata == {"captions": server_captions, "note": "new"}


class TestDeleteActivity:
    @pytest.mark.asyncio
    async def test_raises_404_when_activity_not_found(
        self, mock_request, db, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await delete_activity(mock_request, "nonexistent-uuid", admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_deletes_activity(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.transfer.storage_utils.delete_storage_directory",
            return_value=None,
        ):
            result = await delete_activity(
                mock_request, activity.activity_uuid, admin_user, db
            )
        assert result == {"detail": "Activity deleted"}


class TestGetActivityById:
    @pytest.mark.asyncio
    async def test_raises_404_when_not_found(
        self, mock_request, db, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await get_activityby_id(mock_request, 99999, admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_activity_by_id(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await get_activityby_id(mock_request, activity.id, admin_user, db)
        assert isinstance(result, ActivityRead)
        assert result.id == activity.id


# ---------------------------------------------------------------------------
# _apply_activity_lock
# ---------------------------------------------------------------------------

_PATCH_IS_ORG_ADMIN = "src.services.courses.activities.access.is_org_admin"
_PATCH_BATCH_ACCESSIBLE = "src.services.courses.activities.access.batch_accessible_restricted_uuids"
_PATCH_IS_LOCKED = "src.services.courses.activities.access.is_locked_for_user"


class TestApplyActivityLock:
    @pytest.mark.asyncio
    async def test_admin_bypasses_lock(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        """Admin path: returns immediately without locking (covers lines 272-275)."""
        activity_read = ActivityRead.model_validate(activity)
        with patch(_PATCH_IS_ORG_ADMIN, new_callable=AsyncMock, return_value=True):
            await apply_activity_lock(activity_read, activity, course, admin_user, db)
        assert activity_read.is_locked is False

    @pytest.mark.asyncio
    async def test_uses_provided_parent_chapter(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        """parent_chapter provided: no extra query (covers line 281)."""
        activity_read = ActivityRead.model_validate(activity)
        with patch(_PATCH_IS_ORG_ADMIN, new_callable=AsyncMock, return_value=False), \
             patch(_PATCH_BATCH_ACCESSIBLE, new_callable=AsyncMock, return_value=set()), \
             patch(_PATCH_IS_LOCKED, new_callable=AsyncMock, return_value=False):
            await apply_activity_lock(
                activity_read, activity, course, regular_user, db, parent_chapter=chapter
            )
        assert activity_read.is_locked is False

    @pytest.mark.asyncio
    @pytest.mark.asyncio
    async def test_fetches_chapter_when_not_provided(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        """parent_chapter=None: queries DB for chapter (covers line 285)."""
        activity_read = ActivityRead.model_validate(activity)
        with patch(_PATCH_IS_ORG_ADMIN, new_callable=AsyncMock, return_value=False), \
             patch(_PATCH_BATCH_ACCESSIBLE, new_callable=AsyncMock, return_value=set()), \
             patch(_PATCH_IS_LOCKED, new_callable=AsyncMock, return_value=False):
            await apply_activity_lock(
                activity_read, activity, course, regular_user, db, parent_chapter=None
            )
        assert activity_read.is_locked is False

    @pytest.mark.asyncio
    async def test_locks_activity_when_restricted(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        """Covers lines 295, 305, 315, 326-329 (restricted lock path)."""
        activity_read = ActivityRead.model_validate(activity)
        with patch(_PATCH_IS_ORG_ADMIN, new_callable=AsyncMock, return_value=False), \
             patch(_PATCH_BATCH_ACCESSIBLE, new_callable=AsyncMock, return_value=set()), \
             patch(_PATCH_IS_LOCKED, new_callable=AsyncMock, return_value=True):
            await apply_activity_lock(
                activity_read, activity, course, regular_user, db
            )
        assert activity_read.is_locked is True


# ---------------------------------------------------------------------------
# AI search indexing
# ---------------------------------------------------------------------------


class TestIndexing:
    @pytest.mark.asyncio
    async def test_rename_schedules_reindex(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        # Names are copied onto indexed chunks, so any update re-indexes, not
        # only content changes.
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch("src.services.courses.activities.activities.index_activity") as mock_index:
            await update_activity(
                mock_request, ActivityUpdate(name="Renamed"), activity.activity_uuid, admin_user, db
            )
        mock_index.assert_called_once_with(activity.id)

    @pytest.mark.asyncio
    async def test_scheduling_failure_does_not_fail_the_save(
        self, mock_request, db, org, course, chapter, activity, admin_user, rag_dispatch
    ):
        rag_dispatch.side_effect = RuntimeError("redis down")
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await update_activity(
                mock_request, ActivityUpdate(name="Still saved"), activity.activity_uuid, admin_user, db
            )
        assert result.name == "Still saved"
        rag_dispatch.assert_called_once()


# ---------------------------------------------------------------------------
# get_activities
# ---------------------------------------------------------------------------


class TestGetActivities:
    @pytest.mark.asyncio
    async def test_raises_404_when_no_published_activities(
        self, mock_request, db, org, course, chapter, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await get_activities(mock_request, chapter.id, admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_published_activities(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        """Covers line 525 (the select statement in get_activities)."""
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await get_activities(mock_request, chapter.id, admin_user, db)
        assert isinstance(result, list)
        assert len(result) >= 1
