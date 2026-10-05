"""Authoring-only read paths must not be reachable with course READ alone.

Covers course export, activity version history, AI scenario grounding on an
activity, the by-id activity read (paid/lock gating) and cross-org usergroup
linkage on chapter/activity locks.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.activity_versions import ActivityVersion
from src.db.usergroups import UserGroup
from src.routers.ai import scenario as sc
from src.services.ai.schemas.scenario import GenerateScenarioRequest
from src.services.courses.activities.activities import get_activityby_id
from src.services.courses.activities.versioning import (
    get_activity_version,
    get_activity_versions,
)
from src.services.courses.lock_usergroups import (
    add_usergroup_to_activity,
    add_usergroup_to_chapter,
)
from src.services.courses.transfer.export_service import (
    export_course,
    export_courses_batch,
)

pytestmark = pytest.mark.asyncio

VERSIONING = "src.services.courses.activities.versioning.check_feature_access"


@pytest.fixture
async def version(db, activity):
    v = ActivityVersion(
        activity_id=activity.id,
        org_id=activity.org_id,
        version_number=1,
        content={"type": "doc", "content": [{"type": "text", "text": "old draft"}]},
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(v)
    await db.commit()
    return v


# ---------------------------------------------------------------------------
# Course export
# ---------------------------------------------------------------------------


class TestExportRequiresUpdate:
    async def _assert_denied(self, mock_request, db, course, user):
        with pytest.raises(HTTPException) as exc:
            await export_course(mock_request, course.course_uuid, user, db)
        assert exc.value.status_code in (401, 403)

        with pytest.raises(HTTPException) as exc:
            await export_courses_batch(mock_request, [course.course_uuid], user, db)
        assert exc.value.status_code in (401, 403)

    async def test_regular_user_denied(self, mock_request, db, course, regular_user):
        await self._assert_denied(mock_request, db, course, regular_user)

    async def test_anonymous_denied(self, mock_request, db, course, anonymous_user):
        await self._assert_denied(mock_request, db, course, anonymous_user)

    async def test_admin_allowed(self, mock_request, db, course, admin_user):
        with patch(
            "src.services.courses.transfer.export_service.asyncio.to_thread",
            new_callable=AsyncMock,
            return_value="/tmp/x.zip",
        ):
            result = await export_course(mock_request, course.course_uuid, admin_user, db)
        assert result == "/tmp/x.zip"


# ---------------------------------------------------------------------------
# Version history
# ---------------------------------------------------------------------------


class TestVersionHistoryRequiresUpdate:
    async def _assert_denied(self, mock_request, db, activity, user):
        with patch(VERSIONING, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await get_activity_versions(mock_request, activity.activity_uuid, user, db)
            assert exc.value.status_code in (401, 403)

            with pytest.raises(HTTPException) as exc:
                await get_activity_version(mock_request, activity.activity_uuid, 1, user, db)
            assert exc.value.status_code in (401, 403)

    async def test_regular_user_denied(self, mock_request, db, activity, version, regular_user):
        await self._assert_denied(mock_request, db, activity, regular_user)

    async def test_anonymous_denied(self, mock_request, db, activity, version, anonymous_user):
        await self._assert_denied(mock_request, db, activity, anonymous_user)

    async def test_admin_allowed(self, mock_request, db, activity, version, admin_user):
        with patch(VERSIONING, new_callable=AsyncMock):
            versions = await get_activity_versions(
                mock_request, activity.activity_uuid, admin_user, db
            )
            one = await get_activity_version(
                mock_request, activity.activity_uuid, 1, admin_user, db
            )
        assert len(versions) == 1
        assert one.version_number == 1


# ---------------------------------------------------------------------------
# AI scenario grounding
# ---------------------------------------------------------------------------


class TestScenarioGroundingRequiresUpdate:
    async def test_regular_member_denied_before_credit(
        self, mock_request, db, org, activity, regular_user
    ):
        body = GenerateScenarioRequest(
            org_id=org.id, prompt="p", activity_uuid=activity.activity_uuid
        )
        reserve = AsyncMock()
        with patch.object(sc, "enforce_org_mfa", new=AsyncMock()), \
             patch.object(sc, "reserve_ai_credit", new=reserve), \
             patch.object(sc, "enforce_ai_rate_limit"):
            with pytest.raises(HTTPException) as exc:
                await sc.api_generate_scenario(body, mock_request, regular_user, db)
        assert exc.value.status_code == 403
        reserve.assert_not_awaited()

    async def test_admin_allowed(self, mock_request, db, org, activity, admin_user):
        body = GenerateScenarioRequest(
            org_id=org.id, prompt="p", activity_uuid=activity.activity_uuid
        )
        block = {"title": "T", "currentScenarioId": "1", "scenarios": [{"id": "1"}]}
        gen = AsyncMock(return_value=(block, "s1"))
        with patch.object(sc, "enforce_org_mfa", new=AsyncMock()), \
             patch.object(sc, "reserve_ai_credit", new=AsyncMock()), \
             patch.object(sc, "enforce_ai_rate_limit"), \
             patch.object(sc, "resolve_model_for_org", new=AsyncMock(return_value="m")), \
             patch.object(sc, "generate_scenario", new=gen), \
             patch.object(
                 sc, "record_generation",
                 new=AsyncMock(return_value=SimpleNamespace(ai_generation_uuid="g")),
             ):
            resp = await sc.api_generate_scenario(body, mock_request, admin_user, db)
        assert resp.ai_generation_uuid == "g"
        assert gen.await_args.kwargs["activity_content"] == activity.content


# ---------------------------------------------------------------------------
# get_activityby_id gating
# ---------------------------------------------------------------------------


PAID = "src.services.courses.activities.activities.check_ee_activity_paid_access"


class TestGetActivityByIdGating:
    async def test_locked_activity_scrubbed_for_regular_user(
        self, mock_request, db, activity, regular_user
    ):
        activity.lock_type = "restricted"
        activity.content = {"type": "doc", "content": [{"type": "text", "text": "secret"}]}
        db.add(activity)
        await db.commit()

        with patch(PAID, new=AsyncMock(return_value=True)):
            result = await get_activityby_id(mock_request, activity.id, regular_user, db)
        assert result.is_locked is True
        assert result.content == {}

    async def test_unpaid_content_hidden(self, mock_request, db, activity, regular_user):
        with patch(PAID, new=AsyncMock(return_value=False)):
            result = await get_activityby_id(mock_request, activity.id, regular_user, db)
        assert result.content == {"paid_access": False}

    async def test_admin_sees_locked_content(self, mock_request, db, activity, admin_user):
        activity.lock_type = "restricted"
        db.add(activity)
        await db.commit()

        with patch(PAID, new=AsyncMock(return_value=True)):
            result = await get_activityby_id(mock_request, activity.id, admin_user, db)
        assert not result.is_locked
        assert result.content == activity.content


# ---------------------------------------------------------------------------
# Cross-org usergroup on locks
# ---------------------------------------------------------------------------


class TestLockUsergroupOrgScope:
    @pytest.fixture
    async def foreign_group(self, db, other_org):
        ug = UserGroup(
            id=50,
            name="Foreign",
            description="",
            org_id=other_org.id,
            usergroup_uuid="ug_foreign",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(ug)
        await db.commit()
        return ug

    async def test_chapter_attach_foreign_group_404(
        self, mock_request, db, chapter, admin_user, foreign_group
    ):
        with pytest.raises(HTTPException) as exc:
            await add_usergroup_to_chapter(
                mock_request, chapter.chapter_uuid, foreign_group.usergroup_uuid, admin_user, db
            )
        assert exc.value.status_code == 404

    async def test_activity_attach_foreign_group_404(
        self, mock_request, db, activity, admin_user, foreign_group
    ):
        with pytest.raises(HTTPException) as exc:
            await add_usergroup_to_activity(
                mock_request, activity.activity_uuid, foreign_group.usergroup_uuid, admin_user, db
            )
        assert exc.value.status_code == 404
