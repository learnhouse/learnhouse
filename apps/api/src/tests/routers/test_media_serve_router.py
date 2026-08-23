"""
Router tests for media file serving (GET/HEAD /media/{uuid}/file, shared tokens).

Exercises the actual byte-serving in src/services/media/media_serve.py for both
filesystem (FileResponse / Range / HEAD) and s3 (boto3 stream, mocked), plus the
share-link mint + resolve endpoints.
"""

import shutil
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.media.media import Media, MediaTypeEnum
from src.security.auth import get_current_user
from src.routers.media.media import router

PDF_BYTES = b"%PDF-1.4 hello world this is a test file " * 50  # ~2KB


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/media")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture(autouse=True)
def _bypass_rbac():
    with patch("src.services.media.media.check_resource_access", new_callable=AsyncMock):
        yield


@pytest.fixture
def fs_file_unknown_ext():
    """A stored file whose extension carries no MIME of its own."""
    rel = "orgs/org_test/media/randdir/legacyfile.xyz"
    path = Path("content") / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(PDF_BYTES)
    yield rel
    shutil.rmtree(Path("content") / "orgs" / "org_test", ignore_errors=True)


@pytest.fixture
def fs_file():
    """Create a real file under content/ for filesystem serving; clean up after."""
    rel = "orgs/org_test/media/randdir/testfile.pdf"
    path = Path("content") / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(PDF_BYTES)
    yield rel
    shutil.rmtree(Path("content") / "orgs" / "org_test", ignore_errors=True)


async def _mk_media(
    db, org, storage_key="", public=True, media_type=MediaTypeEnum.UPLOAD, name="m",
    file_format="pdf", file_mime="application/pdf",
):
    m = Media(
        name=name, media_type=media_type, public=public, org_id=org.id,
        media_uuid=f"media_{name}", file_id="testfile.pdf", storage_key=storage_key,
        file_format=file_format, file_mime=file_mime,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


class TestServeFilesystem:
    async def test_get_full_file(self, client, db, org, fs_file):
        m = await _mk_media(db, org, storage_key=fs_file, name="fsfull")
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 200, res.text
        assert res.content == PDF_BYTES
        assert res.headers["content-type"].startswith("application/pdf")
        assert res.headers["cache-control"] == "public, max-age=86400"

    async def test_head_file(self, client, db, org, fs_file):
        m = await _mk_media(db, org, storage_key=fs_file, name="fshead")
        res = await client.head(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 200, res.text
        assert int(res.headers["content-length"]) == len(PDF_BYTES)

    async def test_range_request(self, client, db, org, fs_file):
        m = await _mk_media(db, org, storage_key=fs_file, name="fsrange")
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file", headers={"Range": "bytes=0-99"})
        assert res.status_code == 206, res.text
        assert res.headers["content-range"] == f"bytes 0-99/{len(PDF_BYTES)}"
        assert res.content == PDF_BYTES[0:100]

    async def test_non_public_media_is_no_store(self, client, db, org, fs_file):
        m = await _mk_media(db, org, storage_key=fs_file, public=False, name="fspriv")
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 200, res.text
        assert res.headers["cache-control"] == "private, no-store"

    async def test_inline_disposition_by_default(self, client, db, org, fs_file):
        m = await _mk_media(db, org, storage_key=fs_file, name="fsinline")
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 200, res.text
        assert res.headers["content-disposition"].startswith("inline;")
        assert "fsinline.pdf" in res.headers["content-disposition"]

    async def test_download_forces_attachment(self, client, db, org, fs_file):
        # The `download` attribute on an anchor is ignored cross-origin, so the
        # attachment disposition has to come from the API.
        m = await _mk_media(db, org, storage_key=fs_file, name="fsdl")
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file?download=true")
        assert res.status_code == 200, res.text
        assert res.headers["content-disposition"].startswith("attachment;")
        assert "fsdl.pdf" in res.headers["content-disposition"]

    async def test_download_filename_is_rfc5987_encoded(self, client, db, org, fs_file):
        m = await _mk_media(db, org, storage_key=fs_file, name="rapport financier")
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file?download=true")
        assert res.status_code == 200, res.text
        disposition = res.headers["content-disposition"]
        assert disposition.startswith("attachment; filename*=UTF-8''")
        assert "rapport%20financier.pdf" in disposition

    async def test_filename_falls_back_to_storage_suffix_and_keeps_one_extension(
        self, client, db, org, fs_file
    ):
        # Legacy rows can have no file_format, so the extension comes from the
        # storage key; and a name that already carries it must not get it twice.
        m = await _mk_media(db, org, storage_key=fs_file, name="already.pdf", file_format="")
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file?download=true")
        assert res.status_code == 200, res.text
        assert res.headers["content-disposition"] == "attachment; filename*=UTF-8''already.pdf"

    async def test_missing_file_on_disk_404(self, client, db, org):
        m = await _mk_media(db, org, storage_key="orgs/org_test/media/none/missing.pdf", name="fsmiss")
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 404

    async def test_embed_media_has_no_file(self, client, db, org):
        m = await _mk_media(db, org, media_type=MediaTypeEnum.EMBED, name="embed")
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 404

    async def test_legacy_storage_key_reconstructed(self, client, db, org):
        # No storage_key -> reconstruct orgs/{org_uuid}/media/{media_uuid}/{file_id}
        m = await _mk_media(db, org, storage_key="", name="legacy")
        rel = f"orgs/{org.org_uuid}/media/{m.media_uuid}/{m.file_id}"
        path = Path("content") / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(PDF_BYTES)
        try:
            res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
            assert res.status_code == 200, res.text
            assert res.content == PDF_BYTES
        finally:
            shutil.rmtree(Path("content") / "orgs" / org.org_uuid, ignore_errors=True)


def _mock_s3(size):
    s3 = MagicMock()
    s3.head_object.return_value = {"ContentLength": size}

    def _get_object(Bucket, Key, Range):
        spec = Range.replace("bytes=", "")
        a, _, b = spec.partition("-")
        start, end = int(a), int(b)
        body = MagicMock()
        body.read.return_value = PDF_BYTES[start:end + 1]
        body.close.return_value = None
        return {"Body": body}

    s3.get_object.side_effect = _get_object
    return s3


class TestServeS3:
    @pytest.fixture(autouse=True)
    def _s3_mode(self):
        s3 = _mock_s3(len(PDF_BYTES))
        with patch("src.services.media.media_serve.get_content_delivery_type", return_value="s3api"), \
             patch("src.services.media.media_serve.get_storage_client", return_value=s3), \
             patch("src.services.media.media_serve.get_s3_bucket_name", return_value="bucket"):
            yield s3

    async def test_get_streams_from_s3(self, client, db, org):
        m = await _mk_media(db, org, storage_key="orgs/x/media/r/f.pdf", name="s3full")
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 200, res.text
        assert res.content == PDF_BYTES

    async def test_head_s3(self, client, db, org):
        m = await _mk_media(db, org, storage_key="orgs/x/media/r/f.pdf", name="s3head")
        res = await client.head(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 200, res.text
        assert int(res.headers["content-length"]) == len(PDF_BYTES)

    async def test_range_s3(self, client, db, org):
        m = await _mk_media(db, org, storage_key="orgs/x/media/r/f.pdf", name="s3range")
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file", headers={"Range": "bytes=10-49"})
        assert res.status_code == 206, res.text
        assert res.headers["content-range"] == f"bytes 10-49/{len(PDF_BYTES)}"
        assert res.content == PDF_BYTES[10:50]

    async def test_s3_missing_key_404(self, client, db, org, _s3_mode):
        from botocore.exceptions import ClientError
        _s3_mode.head_object.side_effect = ClientError({"Error": {"Code": "NoSuchKey"}}, "HeadObject")
        m = await _mk_media(db, org, storage_key="orgs/x/media/r/gone.pdf", name="s3miss")
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 404


class TestShareEndpoints:
    async def test_share_link_then_serve(self, client, db, org, fs_file):
        m = await _mk_media(db, org, storage_key=fs_file, name="shareserve")
        # mint a token
        mk = await client.post(f"/api/v1/media/{m.media_uuid}/share-link")
        assert mk.status_code == 200, mk.text
        token = mk.json()["token"]
        assert token
        # serve via the token
        res = await client.get(f"/api/v1/media/shared/{token}/file")
        assert res.status_code == 200, res.text
        assert res.content == PDF_BYTES
        # HEAD via token
        h = await client.head(f"/api/v1/media/shared/{token}/file")
        assert h.status_code == 200

    async def test_unknown_token_404(self, client):
        res = await client.get("/api/v1/media/shared/nope/file")
        assert res.status_code == 404


class TestServeEdges:
    async def test_range_suffix(self, client, db, org, fs_file):
        m = await _mk_media(db, org, storage_key=fs_file, name="suffix")
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file", headers={"Range": "bytes=-100"})
        assert res.status_code == 206
        assert res.content == PDF_BYTES[-100:]

    async def test_range_prefix_open_ended(self, client, db, org, fs_file):
        m = await _mk_media(db, org, storage_key=fs_file, name="prefix")
        start = len(PDF_BYTES) - 50
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file", headers={"Range": f"bytes={start}-"})
        assert res.status_code == 206
        assert res.content == PDF_BYTES[start:]

    async def test_unknown_extension_uses_octet_stream(self, client, db, org):
        rel = "orgs/org_test/media/randdir/blob.xyz"
        path = Path("content") / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"raw bytes")
        m = Media(
            name="blob", media_type=MediaTypeEnum.UPLOAD, public=True, org_id=org.id,
            media_uuid="media_blob", file_id="blob.xyz", storage_key=rel,
            file_format="xyz", file_mime="",  # empty mime -> _mime_for fallback
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(m)
        await db.commit()
        try:
            res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
            assert res.status_code == 200
            assert res.headers["content-type"].startswith("application/octet-stream")
        finally:
            shutil.rmtree(Path("content") / "orgs" / "org_test", ignore_errors=True)

    async def test_legacy_no_file_id_404(self, client, db, org):
        m = Media(
            name="nofile", media_type=MediaTypeEnum.UPLOAD, public=True, org_id=org.id,
            media_uuid="media_nofile", file_id="", storage_key="",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(m)
        await db.commit()
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 404

    async def test_legacy_org_not_found_404(self, client, db, org):
        m = Media(
            name="noorg", media_type=MediaTypeEnum.UPLOAD, public=True, org_id=999999,
            media_uuid="media_noorg", file_id="x.pdf", storage_key="",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(m)
        await db.commit()
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 404


class TestServeS3Errors:
    async def _media(self, db, org):
        m = await _mk_media(db, org, storage_key="orgs/x/media/r/f.pdf", name="s3err")
        return m

    async def test_no_storage_client_500(self, client, db, org):
        m = await self._media(db, org)
        with patch("src.services.media.media_serve.get_content_delivery_type", return_value="s3api"), \
             patch("src.services.media.media_serve.get_storage_client", return_value=None), \
             patch("src.services.media.media_serve.get_s3_bucket_name", return_value="b"):
            res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 500

    @pytest.mark.parametrize("code,expected", [("AccessDenied", 403), ("InternalError", 502)])
    async def test_s3_client_errors(self, client, db, org, code, expected):
        from botocore.exceptions import ClientError
        m = await self._media(db, org)
        s3 = MagicMock()
        s3.head_object.side_effect = ClientError({"Error": {"Code": code}}, "HeadObject")
        with patch("src.services.media.media_serve.get_content_delivery_type", return_value="s3api"), \
             patch("src.services.media.media_serve.get_storage_client", return_value=s3), \
             patch("src.services.media.media_serve.get_s3_bucket_name", return_value="b"):
            res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == expected

    async def test_s3_unexpected_exception_502(self, client, db, org):
        m = await self._media(db, org)
        s3 = MagicMock()
        s3.head_object.side_effect = RuntimeError("boom")
        with patch("src.services.media.media_serve.get_content_delivery_type", return_value="s3api"), \
             patch("src.services.media.media_serve.get_storage_client", return_value=s3), \
             patch("src.services.media.media_serve.get_s3_bucket_name", return_value="b"):
            res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 502


class TestServedContentTypeIsNotClientControlled:
    """The Content-Type decides how a browser treats a stored file, so it is
    derived from server-side state only. Rows written before that — which kept
    the client's own upload header in `file_mime` — must not influence it.
    """

    @pytest.mark.parametrize(
        "poisoned",
        ["text/html", "text/html; charset=utf-8", "TEXT/HTML", "image/svg+xml",
         "application/xhtml+xml", "text/javascript"],
    )
    async def test_stored_mime_never_overrides_known_extension(
        self, client, db, org, fs_file, poisoned
    ):
        m = await _mk_media(
            db, org, storage_key=fs_file, name=f"poison{abs(hash(poisoned))}",
            file_mime=poisoned,
        )
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 200, res.text
        assert res.headers["content-type"].startswith("application/pdf")

    async def test_unknown_extension_with_poisoned_mime_falls_back_to_octet_stream(
        self, client, db, org, fs_file_unknown_ext
    ):
        m = await _mk_media(
            db, org, storage_key=fs_file_unknown_ext, name="poisonlegacy",
            file_format="xyz", file_mime="text/html",
        )
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 200, res.text
        assert res.headers["content-type"].startswith("application/octet-stream")

    async def test_unknown_extension_keeps_a_servable_stored_mime(
        self, client, db, org, fs_file_unknown_ext
    ):
        # Legacy rows without a recognised extension still serve correctly as
        # long as the stored type is one this endpoint is allowed to emit.
        m = await _mk_media(
            db, org, storage_key=fs_file_unknown_ext, name="legacyok",
            file_format="xyz", file_mime="application/pdf",
        )
        res = await client.get(f"/api/v1/media/{m.media_uuid}/file")
        assert res.status_code == 200, res.text
        assert res.headers["content-type"].startswith("application/pdf")
