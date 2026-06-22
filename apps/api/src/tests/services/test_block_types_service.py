"""Tests for block-type create functions.

Covers create_audio_block, create_image_block, create_pdf_block, create_video_block.
upload_file_and_return_file_object is mocked so no real file I/O occurs.
current_user=None skips the RBAC check in each function.
"""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException, UploadFile

from src.db.courses.activities import (
    Activity,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.blocks import BlockRead
from src.services.blocks.schemas.files import BlockFile


async def _activity_with_missing_org(db, org_id: int, course_id: int) -> Activity:
    """Persist an activity whose org_id/course_id may point at nonexistent rows.

    Used to drive the org-not-found / course-not-found 404 guards in the
    create_* block functions.
    """
    a = Activity(
        name="Orphan Activity",
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={"type": "doc", "content": []},
        published=True,
        org_id=org_id,
        course_id=course_id,
        activity_uuid="activity_orphan",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


def _fake_block_file(file_type: str, ext: str, activity_uuid: str) -> BlockFile:
    return BlockFile(
        file_id="fake-file-id",
        file_format=ext,
        file_name=f"test.{ext}",
        file_size=1024,
        file_type=file_type,
        activity_uuid=activity_uuid,
    )


def _mock_upload_file() -> MagicMock:
    """Minimal UploadFile mock — content is not read by the create_* functions."""
    uf = MagicMock(spec=UploadFile)
    uf.filename = "test.bin"
    return uf


class TestCreateAudioBlock:
    @pytest.mark.asyncio
    async def test_creates_audio_block_and_persists(
        self, mock_request, db, org, course, activity, admin_user
    ):
        block_file = _fake_block_file("audio", "mp3", activity.activity_uuid)
        with patch(
            "src.services.blocks.block_types.audioBlock.audioBlock.upload_file_and_return_file_object",
            new=AsyncMock(return_value=block_file),
        ), patch(
            "src.services.blocks.block_types.audioBlock.audioBlock.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await _import_and_call_create_audio(
                mock_request, _mock_upload_file(), activity.activity_uuid, db,
                current_user=admin_user,
            )

        assert isinstance(result, BlockRead)
        assert result.org_id == org.id

    @pytest.mark.asyncio
    async def test_audio_block_activity_not_found(self, mock_request, db, org, course):
        with patch(
            "src.services.blocks.block_types.audioBlock.audioBlock.upload_file_and_return_file_object",
            new=AsyncMock(),
        ):
            with pytest.raises(HTTPException) as exc:
                await _import_and_call_create_audio(
                    mock_request, _mock_upload_file(), "nonexistent-uuid", db
                )
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_audio_block_org_not_found(self, mock_request, db):
        # Activity exists but points at a nonexistent org -> 404 (line 35).
        activity = await _activity_with_missing_org(db, org_id=999, course_id=1)
        with pytest.raises(HTTPException) as exc:
            await _import_and_call_create_audio(
                mock_request, _mock_upload_file(), activity.activity_uuid, db,
                current_user=None,
            )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Organization not found"

    @pytest.mark.asyncio
    async def test_audio_block_requires_authentication(
        self, mock_request, db, org, course, activity
    ):
        # Valid activity/org/course but current_user is None -> 401 (line 53).
        with pytest.raises(HTTPException) as exc:
            await _import_and_call_create_audio(
                mock_request, _mock_upload_file(), activity.activity_uuid, db,
                current_user=None,
            )
        assert exc.value.status_code == 401
        assert exc.value.detail == "Authentication required"


class TestCreateImageBlock:
    @pytest.mark.asyncio
    async def test_creates_image_block_and_persists(
        self, mock_request, db, org, course, activity, admin_user
    ):
        block_file = _fake_block_file("image", "png", activity.activity_uuid)
        with patch(
            "src.services.blocks.block_types.imageBlock.imageBlock.upload_file_and_return_file_object",
            new=AsyncMock(return_value=block_file),
        ), patch(
            "src.services.blocks.block_types.imageBlock.imageBlock.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await _import_and_call_create_image(
                mock_request, _mock_upload_file(), activity.activity_uuid, db,
                current_user=admin_user,
            )

        assert isinstance(result, BlockRead)
        assert result.org_id == org.id

    @pytest.mark.asyncio
    async def test_image_block_org_not_found(self, mock_request, db):
        activity = await _activity_with_missing_org(db, org_id=999, course_id=1)
        with pytest.raises(HTTPException) as exc:
            await _import_and_call_create_image(
                mock_request, _mock_upload_file(), activity.activity_uuid, db,
                current_user=None,
            )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Organization not found"

    @pytest.mark.asyncio
    async def test_image_block_requires_authentication(
        self, mock_request, db, org, course, activity
    ):
        with pytest.raises(HTTPException) as exc:
            await _import_and_call_create_image(
                mock_request, _mock_upload_file(), activity.activity_uuid, db,
                current_user=None,
            )
        assert exc.value.status_code == 401
        assert exc.value.detail == "Authentication required"


class TestCreatePdfBlock:
    @pytest.mark.asyncio
    async def test_creates_pdf_block_and_persists(
        self, mock_request, db, org, course, activity, admin_user
    ):
        block_file = _fake_block_file("document", "pdf", activity.activity_uuid)
        with patch(
            "src.services.blocks.block_types.pdfBlock.pdfBlock.upload_file_and_return_file_object",
            new=AsyncMock(return_value=block_file),
        ), patch(
            "src.services.blocks.block_types.pdfBlock.pdfBlock.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await _import_and_call_create_pdf(
                mock_request, _mock_upload_file(), activity.activity_uuid, db,
                current_user=admin_user,
            )

        assert isinstance(result, BlockRead)
        assert result.org_id == org.id

    @pytest.mark.asyncio
    async def test_pdf_block_org_not_found(self, mock_request, db):
        activity = await _activity_with_missing_org(db, org_id=999, course_id=1)
        with pytest.raises(HTTPException) as exc:
            await _import_and_call_create_pdf(
                mock_request, _mock_upload_file(), activity.activity_uuid, db,
                current_user=None,
            )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Organization not found"

    @pytest.mark.asyncio
    async def test_pdf_block_requires_authentication(
        self, mock_request, db, org, course, activity
    ):
        with pytest.raises(HTTPException) as exc:
            await _import_and_call_create_pdf(
                mock_request, _mock_upload_file(), activity.activity_uuid, db,
                current_user=None,
            )
        assert exc.value.status_code == 401
        assert exc.value.detail == "Authentication required"


class TestCreateVideoBlock:
    @pytest.mark.asyncio
    async def test_creates_video_block_and_persists(
        self, mock_request, db, org, course, activity, admin_user
    ):
        block_file = _fake_block_file("video", "mp4", activity.activity_uuid)
        with patch(
            "src.services.blocks.block_types.videoBlock.videoBlock.upload_file_and_return_file_object",
            new=AsyncMock(return_value=block_file),
        ), patch(
            "src.services.blocks.block_types.videoBlock.videoBlock.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await _import_and_call_create_video(
                mock_request, _mock_upload_file(), activity.activity_uuid, db,
                current_user=admin_user,
            )

        assert isinstance(result, BlockRead)
        assert result.org_id == org.id

    @pytest.mark.asyncio
    async def test_video_block_org_not_found(self, mock_request, db):
        activity = await _activity_with_missing_org(db, org_id=999, course_id=1)
        with pytest.raises(HTTPException) as exc:
            await _import_and_call_create_video(
                mock_request, _mock_upload_file(), activity.activity_uuid, db,
                current_user=None,
            )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Organization not found"

    @pytest.mark.asyncio
    async def test_video_block_requires_authentication(
        self, mock_request, db, org, course, activity
    ):
        with pytest.raises(HTTPException) as exc:
            await _import_and_call_create_video(
                mock_request, _mock_upload_file(), activity.activity_uuid, db,
                current_user=None,
            )
        assert exc.value.status_code == 401
        assert exc.value.detail == "Authentication required"


class TestUploadFileAndReturnFileObject:
    """Covers the file-size branches in upload_file_and_return_file_object."""

    @pytest.mark.asyncio
    async def test_uses_known_multipart_size(self, mock_request):
        # file.size is not None -> use it directly (lines 47-48).
        uf = MagicMock(spec=UploadFile)
        uf.filename = "clip.mp3"
        uf.content_type = "audio/mpeg"
        uf.size = 4242
        uf.file = MagicMock()
        uf.read = AsyncMock()

        with patch(
            "src.services.blocks.utils.upload_files.upload_file",
            new=AsyncMock(return_value="block_abc.mp3"),
        ):
            result = await _import_and_call_upload(
                mock_request, uf, "activity_test", "block_x",
                ["mp3", "wav", "ogg", "m4a"], "audioBlock",
                "org_test", "course_test",
            )

        assert isinstance(result, BlockFile)
        assert result.file_size == 4242
        # Known size means we must NOT re-read the file body.
        uf.read.assert_not_awaited()
        uf.file.seek.assert_not_called()

    @pytest.mark.asyncio
    async def test_falls_back_to_reading_body_when_size_unknown(self, mock_request):
        # file.size is None -> seek(0) + len(await file.read()) (lines 50-51).
        uf = MagicMock(spec=UploadFile)
        uf.filename = "clip.mp4"
        uf.content_type = "video/mp4"
        uf.size = None
        uf.file = MagicMock()
        uf.read = AsyncMock(return_value=b"abcdef")

        with patch(
            "src.services.blocks.utils.upload_files.upload_file",
            new=AsyncMock(return_value="block_def.mp4"),
        ):
            result = await _import_and_call_upload(
                mock_request, uf, "activity_test", "block_y",
                ["mp4", "webm"], "videoBlock",
                "org_test", "course_test",
            )

        assert isinstance(result, BlockFile)
        assert result.file_size == 6
        uf.file.seek.assert_called_once_with(0)
        uf.read.assert_awaited_once()


# ---------------------------------------------------------------------------
# Thin import helpers so module-level imports don't pollute coverage counts
# ---------------------------------------------------------------------------

async def _import_and_call_create_audio(request, file, activity_uuid, db, current_user=None):
    from src.services.blocks.block_types.audioBlock.audioBlock import create_audio_block
    return await create_audio_block(request, file, activity_uuid, db, current_user=current_user)


async def _import_and_call_create_image(request, file, activity_uuid, db, current_user=None):
    from src.services.blocks.block_types.imageBlock.imageBlock import create_image_block
    return await create_image_block(request, file, activity_uuid, db, current_user=current_user)


async def _import_and_call_create_pdf(request, file, activity_uuid, db, current_user=None):
    from src.services.blocks.block_types.pdfBlock.pdfBlock import create_pdf_block
    return await create_pdf_block(request, file, activity_uuid, db, current_user=current_user)


async def _import_and_call_create_video(request, file, activity_uuid, db, current_user=None):
    from src.services.blocks.block_types.videoBlock.videoBlock import create_video_block
    return await create_video_block(request, file, activity_uuid, db, current_user=current_user)


async def _import_and_call_upload(
    request, file, activity_uuid, block_id, allowed_formats, type_of_block,
    org_uuid, course_uuid,
):
    from src.services.blocks.utils.upload_files import (
        upload_file_and_return_file_object,
    )
    return await upload_file_and_return_file_object(
        request, file, activity_uuid, block_id, allowed_formats, type_of_block,
        org_uuid, course_uuid,
    )
