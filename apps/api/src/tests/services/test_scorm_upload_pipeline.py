"""
SCORM upload pipeline: streaming save, hardened extraction, cross-replica
temp-package restore, and shared-package materialization.

Skips cleanly when EE is absent.
"""

import io
import os
import zipfile

import pytest
from fastapi import HTTPException

scorm = pytest.importorskip("ee.services.scorm.scorm")

import src.services.courses.transfer.storage_utils as storage_utils  # noqa: E402

MANIFEST_XML = (
    '<?xml version="1.0"?>'
    '<manifest xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2">'
    '<organizations><organization><item identifierref="res1">'
    '<title>SCO 1</title></item></organization></organizations>'
    '<resources><resource identifier="res1" href="index.html"/></resources>'
    '</manifest>'
)


def _zip_bytes(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


class _FakeUpload:
    """Minimal stand-in for starlette UploadFile (async chunked read + size)."""

    def __init__(self, data: bytes, size: int | None = None):
        self._stream = io.BytesIO(data)
        self.size = size if size is not None else len(data)

    async def read(self, n: int = -1) -> bytes:
        return self._stream.read(n)


class TestSafeExtractZip:
    def test_rejects_oversized_file_listing_names(self, tmp_path, monkeypatch):
        monkeypatch.setattr(scorm, "MAX_SCORM_FILE_SIZE", 10)
        zip_path = tmp_path / "package.zip"
        zip_path.write_bytes(_zip_bytes({
            "small.txt": b"ok",
            "assets/big-video.mp4": b"x" * 50,
        }))

        with pytest.raises(HTTPException) as exc:
            scorm._safe_extract_zip(str(zip_path), str(tmp_path / "out"))

        assert exc.value.status_code == 413
        assert "assets/big-video.mp4" in exc.value.detail

    def test_rejects_total_uncompressed_over_cap(self, tmp_path, monkeypatch):
        monkeypatch.setattr(scorm, "MAX_SCORM_UNCOMPRESSED_SIZE", 10)
        zip_path = tmp_path / "package.zip"
        zip_path.write_bytes(_zip_bytes({"a.txt": b"x" * 20}))

        with pytest.raises(HTTPException) as exc:
            scorm._safe_extract_zip(str(zip_path), str(tmp_path / "out"))

        assert exc.value.status_code == 413

    def test_extracts_and_returns_stats(self, tmp_path):
        zip_path = tmp_path / "package.zip"
        zip_path.write_bytes(_zip_bytes({
            "imsmanifest.xml": MANIFEST_XML.encode(),
            "index.html": b"<html>",
            "assets/video.mp4": b"v" * 1000,
        }))
        out = tmp_path / "out"
        out.mkdir()

        stats = scorm._safe_extract_zip(str(zip_path), str(out))

        assert (out / "imsmanifest.xml").is_file()
        assert (out / "assets/video.mp4").is_file()
        assert stats["file_count"] == 3
        assert stats["total_size_bytes"] == len(MANIFEST_XML) + len(b"<html>") + 1000
        assert stats["largest_files"][0] == {"path": "assets/video.mp4", "size_bytes": 1000}


class TestStreamUploadToDisk:
    async def test_rejects_declared_size_before_reading(self, tmp_path, monkeypatch):
        monkeypatch.setattr(scorm, "MAX_SCORM_PACKAGE_SIZE", 100)
        upload = _FakeUpload(b"PK\x03\x04" + b"x" * 200, size=201)

        with pytest.raises(HTTPException) as exc:
            await scorm._stream_scorm_upload_to_disk(upload, str(tmp_path / "out.zip"))
        assert exc.value.status_code == 413

    async def test_rejects_mid_stream_when_cap_crossed(self, tmp_path, monkeypatch):
        monkeypatch.setattr(scorm, "MAX_SCORM_PACKAGE_SIZE", 100)
        # Undeclared size (None) forces the incremental check to catch it
        upload = _FakeUpload(b"PK\x03\x04" + b"x" * 200, size=None)
        upload.size = None

        with pytest.raises(HTTPException) as exc:
            await scorm._stream_scorm_upload_to_disk(upload, str(tmp_path / "out.zip"))
        assert exc.value.status_code == 413

    async def test_rejects_non_zip_magic(self, tmp_path):
        upload = _FakeUpload(b"not a zip at all")
        with pytest.raises(HTTPException) as exc:
            await scorm._stream_scorm_upload_to_disk(upload, str(tmp_path / "out.zip"))
        assert exc.value.status_code == 415

    async def test_rejects_empty_upload(self, tmp_path):
        upload = _FakeUpload(b"")
        with pytest.raises(HTTPException) as exc:
            await scorm._stream_scorm_upload_to_disk(upload, str(tmp_path / "out.zip"))
        assert exc.value.status_code == 415

    async def test_writes_valid_zip_to_disk(self, tmp_path):
        data = _zip_bytes({"imsmanifest.xml": MANIFEST_XML.encode()})
        dest = tmp_path / "out.zip"

        written = await scorm._stream_scorm_upload_to_disk(_FakeUpload(data), str(dest))

        assert written == len(data)
        assert dest.read_bytes() == data


class TestEnsureTempPackageLocal:
    async def test_local_hit_returns_without_s3(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        temp_id = "11111111-1111-1111-1111-111111111111"
        extracted = tmp_path / scorm.TEMP_SCORM_DIR / temp_id / "extracted"
        extracted.mkdir(parents=True)
        (extracted / "imsmanifest.xml").write_text(MANIFEST_XML)

        temp_dir = await scorm._ensure_temp_package_local(temp_id)
        assert temp_dir == os.path.join(scorm.TEMP_SCORM_DIR, temp_id)

    async def test_missing_locally_restores_from_s3(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        temp_id = "22222222-2222-2222-2222-222222222222"
        zip_data = _zip_bytes({"imsmanifest.xml": MANIFEST_XML.encode()})

        def fake_download(s3_key, local_path):
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            with open(local_path, 'wb') as f:
                f.write(zip_data)
            return True

        monkeypatch.setattr(storage_utils, "is_s3_enabled", lambda: True)
        monkeypatch.setattr(storage_utils, "download_file_from_s3", fake_download)

        temp_dir = await scorm._ensure_temp_package_local(temp_id)

        manifest = os.path.join(temp_dir, "extracted", "imsmanifest.xml")
        assert os.path.isfile(manifest)

    async def test_missing_everywhere_raises_404(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        monkeypatch.setattr(storage_utils, "is_s3_enabled", lambda: True)
        monkeypatch.setattr(storage_utils, "download_file_from_s3", lambda *a: False)

        with pytest.raises(HTTPException) as exc:
            await scorm._ensure_temp_package_local("33333333-3333-3333-3333-333333333333")
        assert exc.value.status_code == 404

    async def test_filesystem_mode_missing_raises_404(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        monkeypatch.setattr(storage_utils, "is_s3_enabled", lambda: False)

        with pytest.raises(HTTPException) as exc:
            await scorm._ensure_temp_package_local("44444444-4444-4444-4444-444444444444")
        assert exc.value.status_code == 404


class TestMaterializeSharedPackage:
    def test_moves_content_instead_of_copying(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        monkeypatch.setattr(storage_utils, "is_s3_enabled", lambda: False)

        temp_dir = tmp_path / "temp-pkg"
        extract_dir = temp_dir / "extracted"
        extract_dir.mkdir(parents=True)
        (temp_dir / "package.zip").write_bytes(b"zipbytes")
        (extract_dir / "index.html").write_text("<html>")

        shared_extract = scorm._materialize_shared_package(
            str(temp_dir), str(extract_dir), "org_x", "course_x", "scorm_package_x",
        )

        assert os.path.isfile(os.path.join(shared_extract, "index.html"))
        shared_dir = os.path.dirname(shared_extract)
        assert os.path.isfile(os.path.join(shared_dir, "package.zip"))
        # Moved, not copied: temp content is gone
        assert not extract_dir.exists()
        assert not (temp_dir / "package.zip").exists()

    def test_raises_500_when_s3_upload_fails(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        monkeypatch.setattr(storage_utils, "is_s3_enabled", lambda: True)
        monkeypatch.setattr(storage_utils, "upload_file_to_s3", lambda *a: False)
        monkeypatch.setattr(storage_utils, "upload_directory_to_s3_parallel", lambda *a, **k: True)

        temp_dir = tmp_path / "temp-pkg"
        extract_dir = temp_dir / "extracted"
        extract_dir.mkdir(parents=True)
        (temp_dir / "package.zip").write_bytes(b"zipbytes")
        (extract_dir / "index.html").write_text("<html>")

        with pytest.raises(HTTPException) as exc:
            scorm._materialize_shared_package(
                str(temp_dir), str(extract_dir), "org_x", "course_x", "scorm_package_y",
            )
        assert exc.value.status_code == 500
