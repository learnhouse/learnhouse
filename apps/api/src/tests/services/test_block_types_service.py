"""Tests for block-type create functions.

Covers create_audio_block, create_image_block, create_pdf_block, create_video_block.
upload_file_and_return_file_object is mocked so no real file I/O occurs.
current_user=None skips the RBAC check in each function.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import UploadFile

from src.db.courses.blocks import BlockRead
from src.services.blocks.schemas.files import BlockFile


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
        self, mock_request, db, org, course, activity
    ):
        block_file = _fake_block_file("audio", "mp3", activity.activity_uuid)
        with patch(
            "src.services.blocks.block_types.audioBlock.audioBlock.upload_file_and_return_file_object",
            new=AsyncMock(return_value=block_file),
        ):
            result = await _import_and_call_create_audio(
                mock_request, _mock_upload_file(), activity.activity_uuid, db
            )

        assert isinstance(result, BlockRead)
        assert result.org_id == org.id

    @pytest.mark.asyncio
    async def test_audio_block_activity_not_found(self, mock_request, db, org, course):
        with patch(
            "src.services.blocks.block_types.audioBlock.audioBlock.upload_file_and_return_file_object",
            new=AsyncMock(),
        ):
            from fastapi import HTTPException
            with pytest.raises(HTTPException) as exc:
                await _import_and_call_create_audio(
                    mock_request, _mock_upload_file(), "nonexistent-uuid", db
                )
        assert exc.value.status_code == 404


class TestCreateImageBlock:
    @pytest.mark.asyncio
    async def test_creates_image_block_and_persists(
        self, mock_request, db, org, course, activity
    ):
        block_file = _fake_block_file("image", "png", activity.activity_uuid)
        with patch(
            "src.services.blocks.block_types.imageBlock.imageBlock.upload_file_and_return_file_object",
            new=AsyncMock(return_value=block_file),
        ):
            result = await _import_and_call_create_image(
                mock_request, _mock_upload_file(), activity.activity_uuid, db
            )

        assert isinstance(result, BlockRead)
        assert result.org_id == org.id


class TestCreatePdfBlock:
    @pytest.mark.asyncio
    async def test_creates_pdf_block_and_persists(
        self, mock_request, db, org, course, activity
    ):
        block_file = _fake_block_file("document", "pdf", activity.activity_uuid)
        with patch(
            "src.services.blocks.block_types.pdfBlock.pdfBlock.upload_file_and_return_file_object",
            new=AsyncMock(return_value=block_file),
        ):
            result = await _import_and_call_create_pdf(
                mock_request, _mock_upload_file(), activity.activity_uuid, db
            )

        assert isinstance(result, BlockRead)
        assert result.org_id == org.id


class TestCreateVideoBlock:
    @pytest.mark.asyncio
    async def test_creates_video_block_and_persists(
        self, mock_request, db, org, course, activity
    ):
        block_file = _fake_block_file("video", "mp4", activity.activity_uuid)
        with patch(
            "src.services.blocks.block_types.videoBlock.videoBlock.upload_file_and_return_file_object",
            new=AsyncMock(return_value=block_file),
        ):
            result = await _import_and_call_create_video(
                mock_request, _mock_upload_file(), activity.activity_uuid, db
            )

        assert isinstance(result, BlockRead)
        assert result.org_id == org.id


# ---------------------------------------------------------------------------
# Thin import helpers so module-level imports don't pollute coverage counts
# ---------------------------------------------------------------------------

async def _import_and_call_create_audio(request, file, activity_uuid, db):
    from src.services.blocks.block_types.audioBlock.audioBlock import create_audio_block
    return await create_audio_block(request, file, activity_uuid, db, current_user=None)


async def _import_and_call_create_image(request, file, activity_uuid, db):
    from src.services.blocks.block_types.imageBlock.imageBlock import create_image_block
    return await create_image_block(request, file, activity_uuid, db, current_user=None)


async def _import_and_call_create_pdf(request, file, activity_uuid, db):
    from src.services.blocks.block_types.pdfBlock.pdfBlock import create_pdf_block
    return await create_pdf_block(request, file, activity_uuid, db, current_user=None)


async def _import_and_call_create_video(request, file, activity_uuid, db):
    from src.services.blocks.block_types.videoBlock.videoBlock import create_video_block
    return await create_video_block(request, file, activity_uuid, db, current_user=None)
