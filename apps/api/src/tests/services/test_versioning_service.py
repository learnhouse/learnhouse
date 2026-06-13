"""Tests for src/services/courses/activities/versioning.py."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.activity_versions import ActivityVersion, ActivityVersionRead
from src.services.courses.activities.versioning import (
    MAX_ACTIVITY_VERSIONS,
    cleanup_old_versions,
    create_activity_version,
    get_activity_versions,
    get_activity_version,
    get_activity_state,
    restore_activity_version,
)


class TestCreateActivityVersion:
    @pytest.mark.asyncio
    async def test_creates_version_and_returns_it(self, db, activity):
        with patch(
            "src.services.courses.activities.versioning.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            version = await create_activity_version(activity, user_id=None, db_session=db)

        assert version.activity_id == activity.id
        assert version.org_id == activity.org_id
        assert version.version_number == activity.current_version
        assert version.content == activity.content
        assert version.created_by_id is None

    @pytest.mark.asyncio
    async def test_persists_version_to_db(self, db, activity):
        with patch(
            "src.services.courses.activities.versioning.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            await create_activity_version(activity, user_id=1, db_session=db)

        row = (
            await db.execute(
                select(ActivityVersion).where(ActivityVersion.activity_id == activity.id)
            )
        ).scalars().first()
        assert row is not None
        assert row.created_by_id == 1

    @pytest.mark.asyncio
    async def test_dispatches_webhook(self, db, activity):
        with patch(
            "src.services.courses.activities.versioning.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_dispatch:
            await create_activity_version(activity, user_id=None, db_session=db)

        mock_dispatch.assert_called_once()
        call_kwargs = mock_dispatch.call_args.kwargs
        assert call_kwargs["event_name"] == "activity_version_created"
        assert call_kwargs["org_id"] == activity.org_id


class TestCleanupOldVersions:
    @pytest.mark.asyncio
    async def test_does_not_delete_when_under_limit(self, db, activity):
        for i in range(MAX_ACTIVITY_VERSIONS):
            db.add(ActivityVersion(
                activity_id=activity.id,
                org_id=activity.org_id,
                version_number=i + 1,
                content={},
                created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            ))
        await db.commit()

        await cleanup_old_versions(activity.id, db)

        count = len(
            (await db.execute(
                select(ActivityVersion).where(ActivityVersion.activity_id == activity.id)
            )).scalars().all()
        )
        assert count == MAX_ACTIVITY_VERSIONS

    @pytest.mark.asyncio
    async def test_deletes_excess_versions_beyond_limit(self, db, activity):
        total = MAX_ACTIVITY_VERSIONS + 3
        for i in range(total):
            db.add(ActivityVersion(
                activity_id=activity.id,
                org_id=activity.org_id,
                version_number=i + 1,
                content={},
                created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            ))
        await db.commit()

        await cleanup_old_versions(activity.id, db)

        remaining = (await db.execute(
            select(ActivityVersion).where(ActivityVersion.activity_id == activity.id)
        )).scalars().all()
        assert len(remaining) == MAX_ACTIVITY_VERSIONS


class TestGetActivityVersions:
    @pytest.mark.asyncio
    async def test_returns_empty_list_when_no_versions(
        self, mock_request, db, activity, admin_user
    ):
        with patch(
            "src.services.courses.activities.versioning.check_feature_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.versioning.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await get_activity_versions(
                mock_request, activity.activity_uuid, admin_user, db
            )
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_versions_list(self, mock_request, db, activity, admin_user):
        db.add(ActivityVersion(
            activity_id=activity.id,
            org_id=activity.org_id,
            version_number=1,
            content={"type": "doc"},
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        ))
        await db.commit()

        with patch(
            "src.services.courses.activities.versioning.check_feature_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.versioning.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await get_activity_versions(
                mock_request, activity.activity_uuid, admin_user, db
            )
        assert len(result) == 1
        assert isinstance(result[0], ActivityVersionRead)

    @pytest.mark.asyncio
    async def test_raises_404_for_unknown_activity(
        self, mock_request, db, admin_user
    ):
        with pytest.raises(HTTPException) as exc:
            await get_activity_versions(
                mock_request, "nonexistent-uuid", admin_user, db
            )
        assert exc.value.status_code == 404


class TestGetActivityVersion:
    @pytest.mark.asyncio
    async def test_raises_404_when_activity_not_found(
        self, mock_request, db, admin_user
    ):
        with pytest.raises(HTTPException) as exc:
            await get_activity_version(
                mock_request, "nonexistent-uuid", 1, admin_user, db
            )
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_specific_version(
        self, mock_request, db, activity, admin_user
    ):
        db.add(ActivityVersion(
            activity_id=activity.id,
            org_id=activity.org_id,
            version_number=3,
            content={"type": "doc"},
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        ))
        await db.commit()

        with patch(
            "src.services.courses.activities.versioning.check_feature_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.versioning.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await get_activity_version(
                mock_request, activity.activity_uuid, 3, admin_user, db
            )
        assert isinstance(result, ActivityVersionRead)
        assert result.version_number == 3

    @pytest.mark.asyncio
    async def test_raises_404_when_version_not_found(
        self, mock_request, db, activity, admin_user
    ):
        with patch(
            "src.services.courses.activities.versioning.check_feature_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.versioning.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await get_activity_version(
                    mock_request, activity.activity_uuid, 999, admin_user, db
                )
        assert exc.value.status_code == 404


class TestGetActivityState:
    @pytest.mark.asyncio
    async def test_returns_activity_state(
        self, mock_request, db, activity, admin_user
    ):
        with patch(
            "src.services.courses.activities.versioning.check_feature_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.versioning.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await get_activity_state(
                mock_request, activity.activity_uuid, admin_user, db
            )
        assert result.activity_uuid == activity.activity_uuid
        assert result.current_version == activity.current_version

    @pytest.mark.asyncio
    async def test_raises_404_for_unknown_activity(
        self, mock_request, db, admin_user
    ):
        with pytest.raises(HTTPException) as exc:
            await get_activity_state(
                mock_request, "nonexistent-uuid", admin_user, db
            )
        assert exc.value.status_code == 404


class TestRestoreActivityVersion:
    @pytest.mark.asyncio
    async def test_raises_404_when_activity_not_found(
        self, mock_request, db, admin_user
    ):
        with pytest.raises(HTTPException) as exc:
            await restore_activity_version(
                mock_request, "nonexistent-uuid", 1, admin_user, db
            )
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_restores_version_and_returns_activity(
        self, mock_request, db, activity, admin_user
    ):
        db.add(ActivityVersion(
            activity_id=activity.id,
            org_id=activity.org_id,
            version_number=1,
            content={"type": "doc", "restored": True},
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        ))
        await db.commit()

        with patch(
            "src.services.courses.activities.versioning.check_feature_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.versioning.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.versioning.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            result = await restore_activity_version(
                mock_request, activity.activity_uuid, 1, admin_user, db
            )

        assert result.activity_uuid == activity.activity_uuid

    @pytest.mark.asyncio
    async def test_raises_404_when_version_not_found(
        self, mock_request, db, activity, admin_user
    ):
        with patch(
            "src.services.courses.activities.versioning.check_feature_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.versioning.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await restore_activity_version(
                    mock_request, activity.activity_uuid, 999, admin_user, db
                )
        assert exc.value.status_code == 404
