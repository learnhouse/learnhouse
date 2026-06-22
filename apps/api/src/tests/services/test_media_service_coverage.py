"""Coverage tests for src/services/media/media.py."""

from contextlib import contextmanager
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException, UploadFile

from src.db.media.media import Media, MediaCreate, MediaTypeEnum, MediaUpdate
from src.services.media.media import (
    create_media,
    delete_media,
    get_media,
    get_media_list,
    update_media,
)


@contextmanager
def _bypass(upload_return="media_file.pdf"):
    """Bypass RBAC for media + the folders side effects create_media triggers."""
    with patch(
        "src.services.media.media.check_resource_access", new_callable=AsyncMock
    ), patch(
        "src.services.folders.folders.check_resource_access", new_callable=AsyncMock
    ), patch(
        "src.services.folders.folders.dispatch_webhooks", new_callable=AsyncMock
    ), patch(
        "src.services.media.media.upload_file",
        new_callable=AsyncMock,
        return_value=upload_return,
    ) as upload_mock:
        yield upload_mock


async def _make_media(db, org, public=True):
    m = Media(
        name="m",
        description="",
        media_type=MediaTypeEnum.EMBED,
        url="https://example.com",
        thumbnail_image="",
        public=public,
        org_id=org.id,
        media_uuid=f"media_{'pub' if public else 'priv'}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


class _BadFile:
    """A file-like whose read raises, to force the file_size fallback to None."""

    content_type = "application/pdf"

    def seek(self, *_):
        return 0

    async def read(self, *_):
        raise RuntimeError("boom")


class TestMediaServiceCoverage:
    @pytest.mark.asyncio
    async def test_create_media_upload_bad_org_404(self, db, org, admin_user, mock_request):
        # Line 47: _get_org_uuid raises 404 for a non-existent org. upload_file is
        # patched so it is not the failure point.
        upload = UploadFile(filename="f.pdf", file=_BadFile())
        with _bypass():
            with pytest.raises(HTTPException) as exc:
                await create_media(
                    mock_request,
                    MediaCreate(
                        name="x",
                        media_type=MediaTypeEnum.UPLOAD,
                        org_id=99999,
                    ),
                    admin_user,
                    db,
                    file=upload,
                )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Organization not found"

    @pytest.mark.asyncio
    async def test_create_media_upload_file_size_fallback_none(
        self, db, org, admin_user, mock_request
    ):
        # Lines 94-95: file.read() raises -> except branch sets file_size = None.
        upload = UploadFile(filename="f.pdf", file=_BadFile())
        with _bypass():
            result = await create_media(
                mock_request,
                MediaCreate(
                    name="upload-media",
                    media_type=MediaTypeEnum.UPLOAD,
                    org_id=org.id,
                ),
                admin_user,
                db,
                file=upload,
            )
        assert result.file_size is None
        assert result.media_uuid.startswith("media_")

    @pytest.mark.asyncio
    async def test_get_media_missing_404(self, db, admin_user, mock_request):
        # Line 167 lives in get_media at line 148 — missing media -> 404.
        with _bypass():
            with pytest.raises(HTTPException) as exc:
                await get_media(mock_request, "media_does_not_exist", admin_user, db)
        assert exc.value.status_code == 404
        assert exc.value.detail == "Media not found"

    @pytest.mark.asyncio
    async def test_update_media_missing_404(self, db, admin_user, mock_request):
        # Line 167/194: update_media on missing media -> 404.
        with _bypass():
            with pytest.raises(HTTPException) as exc:
                await update_media(
                    mock_request,
                    MediaUpdate(name="new"),
                    "media_does_not_exist",
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Media not found"

    @pytest.mark.asyncio
    async def test_delete_media_missing_404(self, db, admin_user, mock_request):
        # Line 194: delete_media on missing media -> 404 "Media not found".
        with _bypass():
            with pytest.raises(HTTPException) as exc:
                await delete_media(
                    mock_request, "media_does_not_exist", admin_user, db
                )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Media not found"

    @pytest.mark.asyncio
    async def test_get_media_list_anonymous_filters_public_only(
        self, db, org, anonymous_user, mock_request
    ):
        # Line 226: anonymous user only sees public media.
        public_media = await _make_media(db, org, public=True)
        private_media = await _make_media(db, org, public=False)

        with _bypass():
            items = await get_media_list(
                mock_request, str(org.id), anonymous_user, db
            )

        uuids = {m.media_uuid for m in items}
        assert public_media.media_uuid in uuids
        assert private_media.media_uuid not in uuids
