"""Tests for src/services/courses/activities/video.py."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException, UploadFile

from src.services.courses.activities.video import (
    create_external_video_activity,
    create_video_activity,
    ExternalVideo,
)


def _mock_video_file(content_type: str = "video/mp4", filename: str = "test.mp4") -> MagicMock:
    uf = MagicMock(spec=UploadFile)
    uf.content_type = content_type
    uf.filename = filename
    return uf


class TestCreateVideoActivity:
    @pytest.mark.asyncio
    async def test_raises_404_when_chapter_not_found(
        self, mock_request, db, org, admin_user
    ):
        with pytest.raises(HTTPException) as exc:
            await create_video_activity(
                mock_request,
                name="Test Video",
                chapter_id=9999,
                current_user=admin_user,
                db_session=db,
                video_file=None,
            )
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_raises_409_when_no_video_file(
        self, mock_request, db, org, course, chapter, admin_user
    ):
        with patch(
            "src.services.courses.activities.video.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await create_video_activity(
                    mock_request,
                    name="Test Video",
                    chapter_id=chapter.id,
                    current_user=admin_user,
                    db_session=db,
                    video_file=None,
                )
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_raises_409_for_invalid_video_content_type(
        self, mock_request, db, org, course, chapter, admin_user
    ):
        with patch(
            "src.services.courses.activities.video.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await create_video_activity(
                    mock_request,
                    name="Test Video",
                    chapter_id=chapter.id,
                    current_user=admin_user,
                    db_session=db,
                    video_file=_mock_video_file(content_type="text/plain"),
                )
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_creates_video_activity_successfully(
        self, mock_request, db, org, course, chapter, admin_user
    ):
        with patch(
            "src.services.courses.activities.video.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.video.upload_video",
            new_callable=AsyncMock,
            return_value="video_test.mp4",
        ):
            result = await create_video_activity(
                mock_request,
                name="Test Video",
                chapter_id=chapter.id,
                current_user=admin_user,
                db_session=db,
                video_file=_mock_video_file(),
            )

        assert result.name == "Test Video"


class TestCreateExternalVideoActivity:
    @pytest.mark.asyncio
    async def test_raises_404_when_chapter_not_found(
        self, mock_request, db, org, admin_user
    ):
        data = ExternalVideo(
            name="YT Video", uri="https://youtube.com/watch?v=abc", type="youtube", chapter_id=9999
        )
        with pytest.raises(HTTPException) as exc:
            await create_external_video_activity(mock_request, admin_user, data, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_creates_external_video_activity(
        self, mock_request, db, org, course, chapter, admin_user
    ):
        data = ExternalVideo(
            name="YT Video",
            uri="https://youtube.com/watch?v=abc123",
            type="youtube",
            chapter_id=chapter.id,
        )
        with patch(
            "src.services.courses.activities.video.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await create_external_video_activity(
                mock_request, admin_user, data, db
            )
        assert result.name == "YT Video"
