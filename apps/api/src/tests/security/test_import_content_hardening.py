"""Stored-XSS and path-traversal hardening for course import + content serving.

Two linked defects:

* the S3 content router used to answer with a renderable Content-Type (and no
  Content-Disposition) for caller-named ``.html``/``.svg``/``.js`` keys, on the
  shared API origin, anonymously;
* course import wrote package files into ``content/`` with the package's own
  extensions, and joined the client-supplied ``temp_id`` straight into the
  paths handed to ``os.rename``/``open``/``rmtree``.
"""

import json
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from sqlmodel import select

from src.db.courses.blocks import Block
from src.db.users import AnonymousUser
from src.routers import content_files
from src.routers.content_files import router as content_files_router
from src.security.auth import get_current_user
from src.services.courses.transfer import import_service
from src.services.courses.transfer.import_service import (
    _import_activity,
    _import_block,
    _import_single_course,
    _require_temp_id,
    _resolve_within,
    import_courses,
    safe_stored_extension,
)
from src.services.courses.transfer.models import ImportOptions


class _Body:
    def __init__(self, data: bytes):
        self._data = data

    def read(self):
        return self._data

    def close(self):
        pass


class _S3Client:
    """Minimal stand-in for the boto3 client used by the content router."""

    payload = b"<script>alert(1)</script>"

    def head_object(self, Bucket, Key):
        return {"ContentLength": len(self.payload)}

    def get_object(self, Bucket, Key, Range):
        start, end = Range.replace("bytes=", "").split("-")
        return {"Body": _Body(self.payload[int(start): int(end) + 1])}


@pytest.fixture
def anon_app(db):
    app = FastAPI()
    app.include_router(content_files_router)
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def anon_client(anon_app):
    async with AsyncClient(
        transport=ASGITransport(app=anon_app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture
def s3_stub(monkeypatch):
    monkeypatch.setattr(content_files, "get_storage_client", lambda: _S3Client())
    monkeypatch.setattr(content_files, "get_s3_bucket_name", lambda: "bucket")


def _set_temp_dir(monkeypatch, path) -> None:
    monkeypatch.setattr(
        "src.services.courses.transfer.import_service.TEMP_IMPORT_DIR", str(path)
    )


class TestContentFileMimeHardening:
    """F21/F24 — nothing served from /content may render as a document."""

    @pytest.mark.parametrize(
        "filename", ["evil.html", "evil.js", "evil.css", "evil.xml"]
    )
    def test_renderable_extensions_fall_back_to_octet_stream(self, filename):
        assert content_files._get_mime_type(filename) == "application/octet-stream"

    async def test_svg_renders_but_is_neutralized_by_csp(
        self, anon_client, s3_stub, org
    ):
        # Org logos and thumbnails are legitimately SVG, so this one keeps its
        # real type and stays inline; the CSP is what makes that safe.
        response = await anon_client.get(
            f"/content/orgs/{org.org_uuid}/branding/logo.svg"
        )

        assert response.status_code == 200
        assert response.headers["content-type"] == "image/svg+xml"
        assert response.headers["content-disposition"].startswith("inline")
        csp = response.headers["content-security-policy"]
        assert "default-src 'none'" in csp
        assert "sandbox" in csp

    @pytest.mark.parametrize(
        "filename", ["evil.html", "evil.js", "evil.css", "evil.xml"]
    )
    async def test_anonymous_get_serves_attacker_named_file_as_download(
        self, anon_client, s3_stub, org, filename
    ):
        response = await anon_client.get(
            f"/content/orgs/{org.org_uuid}/branding/{filename}"
        )

        # Anonymous access to org-level content is intentional; what must not
        # happen is the browser executing it on the API origin.
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/octet-stream"
        assert response.headers["content-disposition"].startswith("attachment")
        assert response.headers["x-content-type-options"] == "nosniff"

    @pytest.mark.parametrize(
        "filename, expected_mime",
        [
            ("thumb.png", "image/png"),
            ("clip.mp4", "video/mp4"),
            ("talk.mp3", "audio/mpeg"),
            ("slides.pdf", "application/pdf"),
        ],
    )
    async def test_legitimate_media_still_served_inline_with_real_type(
        self, anon_client, s3_stub, org, filename, expected_mime
    ):
        response = await anon_client.get(
            f"/content/orgs/{org.org_uuid}/branding/{filename}"
        )

        assert response.status_code == 200
        assert response.headers["content-type"] == expected_mime
        assert response.headers["content-disposition"].startswith("inline")

    async def test_range_request_keeps_disposition(
        self, anon_client, s3_stub, org
    ):
        response = await anon_client.get(
            f"/content/orgs/{org.org_uuid}/branding/clip.mp4",
            headers={"range": "bytes=0-3"},
        )

        assert response.status_code == 206
        assert response.headers["content-disposition"].startswith("inline")

    async def test_head_mirrors_get_disposition(self, anon_client, s3_stub, org):
        html_head = await anon_client.head(
            f"/content/orgs/{org.org_uuid}/branding/evil.html"
        )
        png_head = await anon_client.head(
            f"/content/orgs/{org.org_uuid}/branding/thumb.png"
        )

        assert html_head.headers["content-type"] == "application/octet-stream"
        assert html_head.headers["content-disposition"].startswith("attachment")
        assert png_head.headers["content-type"] == "image/png"
        assert png_head.headers["content-disposition"].startswith("inline")

    def test_disposition_encodes_non_ascii_filename(self):
        header = content_files._content_disposition(
            "application/octet-stream", "orgs/x/rapport été.html"
        )
        assert header.startswith("attachment; filename*=UTF-8''")
        assert "%C3%A9" in header
        # A key with no basename still yields a usable filename.
        assert "file" in content_files._content_disposition("text/plain", "")


class TestImportExtensionAllowlist:
    """F21/F24 — the import pipeline must not persist package-chosen types."""

    @pytest.mark.parametrize(
        "filename",
        ["evil.html", "evil.htm", "evil.svg", "evil.js", "evil.css", "evil.xml", "noext"],
    )
    def test_renderable_and_unknown_entries_are_refused(self, filename):
        assert safe_stored_extension(filename) is None

    @pytest.mark.parametrize(
        "filename, expected",
        [
            ("photo.JPEG", "jpg"),
            ("photo.png", "png"),
            ("clip.mp4", "mp4"),
            ("clip.mov", "mov"),
            ("stream.m3u8", "m3u8"),
            ("captions.vtt", "vtt"),
            ("notes.pdf", "pdf"),
        ],
    )
    def test_media_entries_are_canonicalized(self, filename, expected):
        assert safe_stored_extension(filename) == expected

    async def test_course_thumbnails_skip_non_media_entries(
        self, db, org, admin_user, tmp_path, monkeypatch
    ):
        monkeypatch.chdir(tmp_path)
        course_path = tmp_path / "course-pkg"
        thumbnails = course_path / "thumbnails"
        thumbnails.mkdir(parents=True)
        (course_path / "course.json").write_text(
            json.dumps({"name": "Course", "thumbnail_image": "thumb.png"})
        )
        (thumbnails / "thumb.png").write_bytes(b"png")
        (thumbnails / "evil.html").write_bytes(b"<script>alert(1)</script>")

        with patch(
            "src.services.courses.transfer.import_service.is_s3_enabled",
            return_value=False,
        ):
            course = await _import_single_course(
                course_path=str(course_path),
                organization=org,
                current_user=admin_user,
                options=ImportOptions(course_uuids=["course-pkg"]),
                db_session=db,
                new_course_uuid="course_pkg_new",
            )

        stored = os.listdir(
            tmp_path
            / "content"
            / "orgs"
            / org.org_uuid
            / "courses"
            / "course_pkg_new"
            / "thumbnails"
        )
        assert len(stored) == 1
        assert stored[0].endswith(".png")
        # The legitimate thumbnail is still wired up on the imported course.
        assert course.thumbnail_image == stored[0]

    async def test_activity_files_copy_drops_non_media_entries(
        self, db, org, course, chapter, tmp_path, monkeypatch
    ):
        monkeypatch.chdir(tmp_path)
        activity_path = tmp_path / "activity-pkg"
        files_dir = activity_path / "files" / "video"
        files_dir.mkdir(parents=True)
        (activity_path / "files" / "evil.html").write_bytes(b"<script>alert(1)</script>")
        (activity_path / "files" / "evil.svg").write_bytes(b"<svg onload=alert(1)>")
        (files_dir / "evil.js").write_bytes(b"alert(1)")
        (files_dir / "clip.mp4").write_bytes(b"video")

        new_course_path = f"content/orgs/{org.org_uuid}/courses/course_pkg_new"

        with patch(
            "src.services.courses.transfer.import_service.is_s3_enabled",
            return_value=False,
        ):
            activity = await _import_activity(
                activity_path=str(activity_path),
                activity_data={"name": "A", "activity_type": "TYPE_VIDEO"},
                new_course=SimpleNamespace(id=course.id),
                new_chapter=SimpleNamespace(id=chapter.id),
                new_course_path=new_course_path,
                organization=org,
                db_session=AsyncMock(),
            )

        dest = tmp_path / new_course_path / "activities" / activity.activity_uuid
        assert not (dest / "evil.html").exists()
        assert not (dest / "evil.svg").exists()
        assert not (dest / "video" / "evil.js").exists()
        # The legitimate media file still lands, under its original name.
        assert (dest / "video" / "clip.mp4").read_bytes() == b"video"

    async def test_block_file_with_unsafe_extension_is_dropped(
        self, db, org, course, chapter, tmp_path, monkeypatch
    ):
        monkeypatch.chdir(tmp_path)
        new_activity_path = tmp_path / "activity_new"
        block_dir = new_activity_path / "dynamic" / "blocks" / "videoBlock" / "block-old"
        block_dir.mkdir(parents=True)
        (block_dir / "evil.html").write_bytes(b"<script>alert(1)</script>")
        (block_dir / "clip.mp4").write_bytes(b"video")

        with patch(
            "src.services.courses.transfer.import_service.is_s3_enabled",
            return_value=False,
        ):
            new_block_uuid, _updates = await _import_block(
                block_data={"block_type": "BLOCK_VIDEO", "content": {"file_id": "old"}},
                original_block_uuid="block-old",
                new_activity=SimpleNamespace(id=1, activity_uuid="activity-new"),
                new_activity_path=str(new_activity_path),
                new_course=SimpleNamespace(id=course.id),
                new_chapter=SimpleNamespace(id=chapter.id),
                organization=org,
                db_session=db,
            )

        renamed = new_activity_path / "dynamic" / "blocks" / "videoBlock" / new_block_uuid
        stored = os.listdir(renamed)
        assert len(stored) == 1
        assert stored[0].endswith(".mp4")

    async def test_canonicalized_extension_is_reflected_in_file_format(
        self, db, org, course, chapter, tmp_path, monkeypatch
    ):
        """A .jpeg is stored as .jpg. The frontend builds its URL as
        file_id + "." + file_format, so a stale format is a broken image."""
        monkeypatch.chdir(tmp_path)
        new_activity_path = tmp_path / "activity_new"
        block_dir = new_activity_path / "dynamic" / "blocks" / "imageBlock" / "block-old"
        block_dir.mkdir(parents=True)
        (block_dir / "photo.jpeg").write_bytes(b"\xff\xd8\xff")

        with patch(
            "src.services.courses.transfer.import_service.is_s3_enabled",
            return_value=False,
        ):
            new_block_uuid, _updates = await _import_block(
                block_data={
                    "block_type": "BLOCK_IMAGE",
                    "content": {"file_id": "old", "file_format": "jpeg"},
                },
                original_block_uuid="block-old",
                new_activity=SimpleNamespace(id=1, activity_uuid="activity-new"),
                new_activity_path=str(new_activity_path),
                new_course=SimpleNamespace(id=course.id),
                new_chapter=SimpleNamespace(id=chapter.id),
                organization=org,
                db_session=db,
            )

        renamed = new_activity_path / "dynamic" / "blocks" / "imageBlock" / new_block_uuid
        stored = os.listdir(renamed)
        assert stored[0].endswith(".jpg")

        block = (
            await db.execute(select(Block).where(Block.block_uuid == new_block_uuid))
        ).scalars().first()
        assert block is not None
        # The name on disk and the name the frontend asks for must agree.
        assert block.content["file_format"] == "jpg"
        assert stored[0] == f"{block.content['file_id']}.jpg"


class TestImportTempIdTraversal:
    """F8 — temp_id reaches os.rename/open/rmtree and must be a UUID."""

    def test_require_temp_id_rejects_non_uuid_values(self):
        for value in ["../../orgs", "..", "/etc", "not-a-uuid", "", None]:
            with pytest.raises(HTTPException) as exc:
                _require_temp_id(value)  # type: ignore[arg-type]
            assert exc.value.status_code == 400
        # A well-formed UUID passes.
        _require_temp_id(str(uuid4()))

    def test_resolve_within_rejects_escaping_paths(self, tmp_path):
        base = os.path.realpath(str(tmp_path))
        assert _resolve_within(base, "child") == os.path.join(base, "child")
        with pytest.raises(HTTPException) as exc:
            _resolve_within(base, "..")
        assert exc.value.status_code == 400

    @pytest.mark.parametrize(
        "temp_id", ["../orgs", "../../orgs", "..", "/etc", "not-a-uuid"]
    )
    async def test_traversal_temp_id_rejected_before_any_rename(
        self, db, org, admin_user, mock_request, tmp_path, monkeypatch, temp_id
    ):
        imports_dir = tmp_path / "temp" / "imports"
        imports_dir.mkdir(parents=True)
        _set_temp_dir(monkeypatch, imports_dir)

        # The sibling directory the attack aims at: `content/orgs`.
        orgs_dir = tmp_path / "temp" / "orgs"
        orgs_dir.mkdir()
        (orgs_dir / "logo.png").write_bytes(b"logo")

        with patch(
            "src.services.courses.transfer.import_service.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await import_courses(
                    mock_request,
                    temp_id,
                    org.id,
                    ImportOptions(course_uuids=["course-1"]),
                    admin_user,
                    db,
                )

        assert exc.value.status_code == 400
        # Nothing moved: every org's content is still where it was.
        assert (orgs_dir / "logo.png").exists()
        assert not (tmp_path / "temp" / "orgs-importing").exists()
        assert os.listdir(imports_dir) == []

    async def test_uuid_temp_id_still_imports_end_to_end(
        self, db, org, admin_user, mock_request, tmp_path, monkeypatch
    ):
        temp_id = str(UUID(int=7))
        extracted = tmp_path / temp_id / "extracted"
        extracted.mkdir(parents=True)
        (extracted / "manifest.json").write_text(
            json.dumps(
                {
                    "format": "learnhouse-course-export",
                    "courses": [{"course_uuid": "course-1", "path": "course-1"}],
                }
            )
        )
        _set_temp_dir(monkeypatch, tmp_path)

        with patch(
            "src.services.courses.transfer.import_service.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.transfer.import_service.check_limits_with_usage"
        ), patch(
            "src.services.courses.transfer.import_service.increase_feature_usage"
        ), patch(
            "src.services.courses.transfer.import_service._import_single_course",
            return_value=SimpleNamespace(course_uuid="course-new", name="Imported"),
        ):
            result = await import_courses(
                mock_request,
                temp_id,
                org.id,
                ImportOptions(course_uuids=["course-1"]),
                admin_user,
                db,
            )

        assert result.successful == 1
        assert result.courses[0].new_uuid == "course-new"
        # Working directory cleaned up afterwards.
        assert not (tmp_path / f"{temp_id}-importing").exists()

    async def test_missing_package_with_valid_uuid_returns_404(
        self, db, org, admin_user, mock_request, tmp_path, monkeypatch
    ):
        _set_temp_dir(monkeypatch, tmp_path)

        with patch(
            "src.services.courses.transfer.import_service.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await import_courses(
                    mock_request,
                    str(UUID(int=8)),
                    org.id,
                    ImportOptions(course_uuids=["course-1"]),
                    admin_user,
                    db,
                )

        assert exc.value.status_code == 404

    def test_ignore_filter_keeps_directories(self, tmp_path):
        (tmp_path / "video").mkdir()
        (tmp_path / "clip.mp4").write_bytes(b"v")
        (tmp_path / "evil.html").write_bytes(b"x")

        ignored = import_service._ignore_unsafe_package_files(
            str(tmp_path), ["video", "clip.mp4", "evil.html"]
        )

        assert ignored == {"evil.html"}

    def test_scorm_subtree_keeps_its_web_assets(self, tmp_path):
        """A SCORM package *is* HTML/JS/CSS plus a manifest. Filtering those out
        would import a silently broken activity, so scorm/ is exempt."""
        scorm_dir = tmp_path / "activities" / "activity_x" / "scorm" / "extracted"
        scorm_dir.mkdir(parents=True)
        names = ["index.html", "imsmanifest.xml", "scormdriver.js", "style.css", "font.woff2"]
        for name in names:
            (scorm_dir / name).write_bytes(b"x")

        ignored = import_service._ignore_unsafe_package_files(str(scorm_dir), names)

        assert ignored == set()

    def test_non_scorm_activity_files_are_still_filtered(self, tmp_path):
        files_dir = tmp_path / "activities" / "activity_x" / "files"
        files_dir.mkdir(parents=True)
        (files_dir / "evil.html").write_bytes(b"x")
        (files_dir / "clip.mp4").write_bytes(b"v")

        ignored = import_service._ignore_unsafe_package_files(
            str(files_dir), ["evil.html", "clip.mp4"]
        )

        assert ignored == {"evil.html"}
