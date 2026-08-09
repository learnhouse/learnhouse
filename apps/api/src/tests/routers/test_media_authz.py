"""
Org-scoping and served-content-type hardening tests for the media service.

Three separate holes are covered here:

* the bytes endpoint used to echo the uploader's own multipart ``Content-Type``
  back as the response header with an inline disposition, which let an uploader
  choose how the browser interpreted a file served from the API origin;
* the library listing applied its public/private filter based on whether the
  caller was anonymous rather than on whether they belonged to the org; and
* media creation trusted the ``org_id`` form field, whose ``media_x`` RBAC
  placeholder resolves to no org at all.
"""

import shutil
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.folders.folder_content import FolderContent
from src.db.folders.folders import Folder
from src.db.media.media import Media, MediaTypeEnum
from src.db.roles import Role, RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, PublicUser, User
from src.security.auth import get_current_user
from src.routers.media.media import router

FILE_BYTES = b"stored bytes that are not html " * 40  # ~1.2KB


# ---------------------------------------------------------------------------
# App / client helpers
# ---------------------------------------------------------------------------

def _build_app(db, user):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/media")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return app


def _client_for(app):
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
def app(db, admin_user):
    app = _build_app(db, admin_user)
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with _client_for(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _bypass_resource_rbac():
    """Only the resource-level RBAC is stubbed — the org gates under test run."""
    with patch(
        "src.services.media.media.check_resource_access", new_callable=AsyncMock
    ), patch(
        "src.services.folders.folders.check_resource_access", new_callable=AsyncMock
    ), patch(
        "src.services.folders.folders.dispatch_webhooks", new_callable=AsyncMock
    ):
        yield


@pytest.fixture
async def other_org_admin(db, other_org):
    """An admin of `other_org` who has no membership at all in `org`."""
    role = Role(
        id=7,
        name="Admin",
        org_id=other_org.id,
        role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_other_admin",
        rights={"media": {"action_create": True, "action_read": True}},
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(role)
    await db.commit()
    u = User(
        id=42,
        username="outsider",
        first_name="Out",
        last_name="Sider",
        email="outsider@other.com",
        password="hashed_password",
        user_uuid="user_outsider",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(u)
    await db.commit()
    db.add(
        UserOrganization(
            user_id=u.id,
            org_id=other_org.id,
            role_id=role.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()
    return PublicUser(
        id=u.id,
        username=u.username,
        first_name=u.first_name,
        last_name=u.last_name,
        email=u.email,
        user_uuid=u.user_uuid,
    )


# ---------------------------------------------------------------------------
# Stored-file helpers
# ---------------------------------------------------------------------------

@pytest.fixture
def stored_files():
    """Write real files under content/ for the filesystem serving branch."""
    created = []

    def _write(rel):
        path = Path("content") / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(FILE_BYTES)
        created.append(rel)
        return rel

    yield _write
    shutil.rmtree(Path("content") / "orgs" / "org_test", ignore_errors=True)


async def _mk_media(db, org, *, name, storage_key="", file_format="pdf",
                    file_mime="application/pdf", public=True,
                    media_type=MediaTypeEnum.UPLOAD):
    m = Media(
        name=name,
        media_type=media_type,
        public=public,
        org_id=org.id,
        media_uuid=f"media_{name}",
        file_id="stored.bin",
        storage_key=storage_key,
        file_format=file_format,
        file_mime=file_mime,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


# ---------------------------------------------------------------------------
# F1 / F23 / F34 — served Content-Type + Content-Disposition clamp
# ---------------------------------------------------------------------------

class TestServedDispositionIsClamped:
    async def test_pdf_still_renders_inline(self, client, db, org, stored_files):
        # Regression guard: the whole point of the endpoint is in-place preview
        # for the types that are safe to preview.
        key = stored_files("orgs/org_test/media/r1/doc.pdf")
        m = await _mk_media(db, org, name="okpdf", storage_key=key)
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 200, res.text
        assert res.headers["content-type"].startswith("application/pdf")
        assert res.headers["content-disposition"].startswith("inline;")

    async def test_image_renders_inline(self, client, db, org, stored_files):
        key = stored_files("orgs/org_test/media/r2/pic.png")
        m = await _mk_media(db, org, name="okpng", storage_key=key, file_format="png",
                            file_mime="image/png")
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 200, res.text
        assert res.headers["content-type"].startswith("image/png")
        assert res.headers["content-disposition"].startswith("inline;")

    @pytest.mark.parametrize(
        "ext,expected_mime",
        [
            ("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            ("zip", "application/zip"),
            ("xls", "application/vnd.ms-excel"),
        ],
    )
    async def test_non_previewable_types_are_forced_to_attachment(
        self, client, db, org, stored_files, ext, expected_mime
    ):
        key = stored_files(f"orgs/org_test/media/r3/file.{ext}")
        m = await _mk_media(db, org, name=f"att{ext}", storage_key=key,
                            file_format=ext, file_mime=expected_mime)
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 200, res.text
        assert res.headers["content-type"].startswith(expected_mime)
        assert res.headers["content-disposition"].startswith("attachment;")

    @pytest.mark.parametrize(
        "poisoned", ["text/html", "text/html; charset=utf-8", "IMAGE/SVG+XML"]
    )
    async def test_stored_mime_from_an_uploader_is_never_emitted(
        self, client, db, org, stored_files, poisoned
    ):
        # Rows written before the store-side fix carry the uploader's own
        # multipart header in `file_mime`. With no usable extension to fall back
        # on, such a row must degrade to an opaque download.
        key = stored_files("orgs/org_test/media/r4/legacy.xyz")
        m = await _mk_media(db, org, name=f"poison{abs(hash(poisoned))}",
                            storage_key=key, file_format="xyz", file_mime=poisoned)
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 200, res.text
        assert res.headers["content-type"].startswith("application/octet-stream")
        assert res.headers["content-disposition"].startswith("attachment;")
        assert "text/html" not in res.headers["content-type"].lower()

    async def test_range_branch_keeps_the_clamped_headers(
        self, client, db, org, stored_files
    ):
        key = stored_files("orgs/org_test/media/r5/sheet.xlsx")
        m = await _mk_media(
            db, org, name="rangeatt", storage_key=key, file_format="xlsx",
            file_mime="text/html",
        )
        res = await client.get(
            f"/api/v1/media/{m.media_uuid}/file", headers={"Range": "bytes=0-49"}
        )
        assert res.status_code == 206, res.text
        assert res.headers["content-disposition"].startswith("attachment;")
        assert res.headers["content-type"].startswith(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

    async def test_head_branch_keeps_the_clamped_headers(
        self, client, db, org, stored_files
    ):
        key = stored_files("orgs/org_test/media/r6/legacy2.xyz")
        m = await _mk_media(db, org, name="headatt", storage_key=key,
                            file_format="xyz", file_mime="text/html")
        res = await client.head(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 200, res.text
        assert res.headers["content-type"].startswith("application/octet-stream")
        assert res.headers["content-disposition"].startswith("attachment;")

    async def test_s3_branch_keeps_the_clamped_headers(self, client, db, org):
        s3 = MagicMock()
        s3.head_object.return_value = {"ContentLength": len(FILE_BYTES)}
        body = MagicMock()
        body.read.return_value = FILE_BYTES
        body.close.return_value = None
        s3.get_object.return_value = {"Body": body}
        m = await _mk_media(db, org, name="s3att", storage_key="orgs/x/media/r/f.xyz",
                            file_format="xyz", file_mime="text/html")
        with patch("src.services.media.media_serve.get_content_delivery_type",
                   return_value="s3api"), \
             patch("src.services.media.media_serve.get_storage_client", return_value=s3), \
             patch("src.services.media.media_serve.get_s3_bucket_name", return_value="b"):
            res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 200, res.text
        assert res.headers["content-type"].startswith("application/octet-stream")
        assert res.headers["content-disposition"].startswith("attachment;")


class TestUploadedMimeIsServerDerived:
    async def test_client_content_type_header_is_not_persisted(self, client, org):
        # The uploader claims text/html; the file is stored as a .png, so that
        # is what the row (and therefore every future response) records.
        with patch(
            "src.services.media.media.upload_file",
            new_callable=AsyncMock,
            return_value="abc_media.png",
        ):
            res = await client.post(
                "/api/v1/media/",
                data={"org_id": org.id, "name": "Poc", "media_type": "UPLOAD",
                      "public": "true"},
                files={"file": ("poc.gif", b"GIF89a<script>alert(1)</script>",
                                "text/html")},
            )
        assert res.status_code == 200, res.text
        assert res.json()["file_mime"] == "image/png"

    async def test_unmapped_stored_extension_records_no_mime(self, client, org):
        with patch(
            "src.services.media.media.upload_file",
            new_callable=AsyncMock,
            return_value="abc_media.xyz",
        ):
            res = await client.post(
                "/api/v1/media/",
                data={"org_id": org.id, "name": "Blob", "media_type": "UPLOAD",
                      "public": "true"},
                files={"file": ("blob.xyz", b"raw", "text/html")},
            )
        assert res.status_code == 200, res.text
        assert res.json()["file_mime"] == ""


# ---------------------------------------------------------------------------
# F20 / F30 — the listing is scoped by org membership, not by being logged in
# ---------------------------------------------------------------------------

async def _seed_library(db, org):
    """One public item and one private item, the private one also in a private
    folder so both halves of the restricted filter are exercised."""
    await _mk_media(db, org, name="pub", public=True, media_type=MediaTypeEnum.EMBED)
    hidden = await _mk_media(db, org, name="priv", public=False,
                             media_type=MediaTypeEnum.EMBED)
    secret = await _mk_media(db, org, name="infolder", public=True,
                             media_type=MediaTypeEnum.EMBED)
    f = Folder(
        id=90, name="Private folder", description="", public=False, org_id=org.id,
        folder_uuid="folder_private",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(f)
    await db.commit()
    db.add(
        FolderContent(
            folder_id=f.id, resource_uuid=secret.media_uuid, org_id=org.id, position=0,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
    )
    await db.commit()
    return hidden


class TestMediaListOrgScoping:
    async def test_member_sees_the_whole_library(self, client, db, org):
        await _seed_library(db, org)
        res = await client.get(f"/api/v1/media/org/{org.id}/page/1/limit/50")
        assert res.status_code == 200, res.text
        names = {m["name"] for m in res.json()}
        assert {"pub", "priv", "infolder"} <= names

    async def test_authenticated_non_member_is_restricted_to_public_items(
        self, db, org, other_org, other_org_admin
    ):
        await _seed_library(db, org)
        app = _build_app(db, other_org_admin)
        try:
            async with _client_for(app) as c:
                res = await c.get(f"/api/v1/media/org/{org.id}/page/1/limit/50")
        finally:
            app.dependency_overrides.clear()
        assert res.status_code == 200, res.text
        names = {m["name"] for m in res.json()}
        # Being signed in elsewhere buys nothing here: same view as a visitor.
        assert names == {"pub"}
        assert "priv" not in names and "infolder" not in names

    async def test_anonymous_is_restricted_to_public_items(self, db, org):
        await _seed_library(db, org)
        app = _build_app(db, AnonymousUser())
        try:
            async with _client_for(app) as c:
                res = await c.get(f"/api/v1/media/org/{org.id}/page/1/limit/50")
        finally:
            app.dependency_overrides.clear()
        assert res.status_code == 200, res.text
        assert {m["name"] for m in res.json()} == {"pub"}


# ---------------------------------------------------------------------------
# F31 — creation is pinned to the org the caller actually belongs to
# ---------------------------------------------------------------------------

class TestMediaCreateOrgScoping:
    async def test_member_can_create_in_their_own_org(self, client, org):
        res = await client.post(
            "/api/v1/media/",
            data={"org_id": org.id, "name": "Mine", "media_type": "EMBED",
                  "url": "https://example.com", "public": "true"},
        )
        assert res.status_code == 200, res.text
        assert res.json()["org_id"] == org.id

    async def test_member_cannot_plant_media_in_another_org(self, client, other_org):
        res = await client.post(
            "/api/v1/media/",
            data={"org_id": other_org.id, "name": "Planted", "media_type": "EMBED",
                  "url": "https://evil.example", "public": "true"},
        )
        assert res.status_code == 403, res.text

    async def test_cross_org_upload_never_reaches_storage(self, client, other_org):
        with patch(
            "src.services.media.media.upload_file", new_callable=AsyncMock
        ) as upload:
            res = await client.post(
                "/api/v1/media/",
                data={"org_id": other_org.id, "name": "Planted",
                      "media_type": "UPLOAD", "public": "true"},
                files={"file": ("x.png", b"\x89PNG\r\n\x1a\n", "image/png")},
            )
        assert res.status_code == 403, res.text
        upload.assert_not_called()

    async def test_member_without_the_create_right_is_denied(
        self, db, org, regular_user
    ):
        app = _build_app(db, regular_user)
        try:
            async with _client_for(app) as c:
                res = await c.post(
                    "/api/v1/media/",
                    data={"org_id": org.id, "name": "NoRight", "media_type": "EMBED",
                          "url": "https://example.com", "public": "true"},
                )
        finally:
            app.dependency_overrides.clear()
        assert res.status_code == 403, res.text

    async def test_anonymous_cannot_create(self, db, org):
        app = _build_app(db, AnonymousUser())
        try:
            async with _client_for(app) as c:
                res = await c.post(
                    "/api/v1/media/",
                    data={"org_id": org.id, "name": "Anon", "media_type": "EMBED",
                          "url": "https://example.com", "public": "true"},
                )
        finally:
            app.dependency_overrides.clear()
        assert res.status_code == 403, res.text
