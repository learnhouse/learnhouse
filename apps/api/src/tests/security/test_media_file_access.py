"""
Security tests for media-file access (folder-aware) + random share links.

Targets the access *decisions* (the security-critical part) via the service
authorizers — not the byte streaming.
"""

from datetime import datetime

import pytest
from fastapi import HTTPException

from src.db.folders.folders import Folder
from src.db.folders.folder_content import FolderContent
from src.db.media.media import Media, MediaTypeEnum
from src.services.media.media import (
    authorize_media_file,
    authorize_share_token,
    create_media_share_link,
)


async def _mk_media(db, org, public=True, name="m"):
    m = Media(
        name=name, media_type=MediaTypeEnum.UPLOAD, public=public, org_id=org.id,
        media_uuid=f"media_{name}", file_id="x.pdf",
        storage_key=f"orgs/{org.org_uuid}/media/rand/x.pdf", file_format="pdf",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


async def _mk_folder(db, org, public, name):
    f = Folder(
        name=name, public=public, org_id=org.id, folder_uuid=f"folder_{name}",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return f


async def _place(db, org, folder_id, media_uuid):
    db.add(FolderContent(
        folder_id=folder_id, resource_uuid=media_uuid, org_id=org.id, position=0,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    await db.commit()


class TestMediaFileAccess:
    @pytest.mark.asyncio
    async def test_public_root_media_allowed_for_anon(self, db, org, anonymous_user, mock_request):
        m = await _mk_media(db, org, public=True, name="rootpub")
        media, is_public = await authorize_media_file(mock_request, m.media_uuid, anonymous_user, db)
        assert media.media_uuid == m.media_uuid
        assert is_public is True

    @pytest.mark.asyncio
    async def test_public_media_in_private_folder_denied_for_anon(self, db, org, anonymous_user, mock_request):
        m = await _mk_media(db, org, public=True, name="inpriv")
        priv = await _mk_folder(db, org, public=False, name="priv")
        await _place(db, org, priv.id, m.media_uuid)
        with pytest.raises(HTTPException) as exc:
            await authorize_media_file(mock_request, m.media_uuid, anonymous_user, db)
        assert exc.value.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_private_folder_media_allowed_for_org_admin(self, db, org, admin_user, mock_request):
        m = await _mk_media(db, org, public=True, name="adminok")
        priv = await _mk_folder(db, org, public=False, name="priv2")
        await _place(db, org, priv.id, m.media_uuid)
        media, is_public = await authorize_media_file(mock_request, m.media_uuid, admin_user, db)
        assert media.media_uuid == m.media_uuid
        assert is_public is False  # folder-private → cache as private

    @pytest.mark.asyncio
    async def test_non_public_media_denied_for_anon(self, db, org, anonymous_user, mock_request):
        m = await _mk_media(db, org, public=False, name="secret")
        with pytest.raises(HTTPException):
            await authorize_media_file(mock_request, m.media_uuid, anonymous_user, db)

    @pytest.mark.asyncio
    async def test_missing_media_404(self, db, anonymous_user, mock_request):
        with pytest.raises(HTTPException) as exc:
            await authorize_media_file(mock_request, "media_nope", anonymous_user, db)
        assert exc.value.status_code == 404


class TestMediaShareLink:
    @pytest.mark.asyncio
    async def test_share_link_unique_every_call(self, db, org, admin_user, mock_request):
        m = await _mk_media(db, org, public=True, name="share1")
        a = await create_media_share_link(mock_request, m.media_uuid, admin_user, db)
        b = await create_media_share_link(mock_request, m.media_uuid, admin_user, db)
        assert a["token"] and b["token"]
        assert a["token"] != b["token"]

    @pytest.mark.asyncio
    async def test_share_token_resolves_for_owner(self, db, org, admin_user, mock_request):
        m = await _mk_media(db, org, public=True, name="share2")
        tok = (await create_media_share_link(mock_request, m.media_uuid, admin_user, db))["token"]
        media, _ = await authorize_share_token(mock_request, tok, admin_user, db)
        assert media.media_uuid == m.media_uuid

    @pytest.mark.asyncio
    async def test_share_token_not_a_bypass_for_private(self, db, org, admin_user, anonymous_user, mock_request):
        m = await _mk_media(db, org, public=True, name="share3")
        priv = await _mk_folder(db, org, public=False, name="priv3")
        await _place(db, org, priv.id, m.media_uuid)
        tok = (await create_media_share_link(mock_request, m.media_uuid, admin_user, db))["token"]
        # Anonymous recipient with the link is still denied.
        with pytest.raises(HTTPException) as exc:
            await authorize_share_token(mock_request, tok, anonymous_user, db)
        assert exc.value.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_invalid_token_404(self, db, anonymous_user, mock_request):
        with pytest.raises(HTTPException) as exc:
            await authorize_share_token(mock_request, "doesnotexist", anonymous_user, db)
        assert exc.value.status_code == 404
