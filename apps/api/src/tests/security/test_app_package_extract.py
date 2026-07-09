"""
App-package (third-party app zip) extraction hardening.

Mirrors test_scorm_extract.py: exercises the guards with small in-memory zips,
monkeypatching the size caps so no large fixtures are needed.
"""

import io
import json
import os

import pytest
from fastapi import HTTPException, UploadFile

from src.services.apps import install
from src.tests.fixtures import scorm_packages as pkg


def _manifest(**overrides) -> str:
    manifest = {
        "manifest_version": 1,
        "id": "hello-world",
        "name": "Hello World",
        "version": "1.0.0",
        "entry": "index.html",
        "scopes": ["courses:read"],
    }
    manifest.update(overrides)
    return json.dumps(manifest)


def _valid_files(**manifest_overrides) -> dict:
    return {
        "learnhouse.json": _manifest(**manifest_overrides),
        "index.html": "<!doctype html><h1>hi</h1>",
        "app.js": "console.log('hi')",
    }


def _upload(data: bytes) -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename="app.zip")


def _extract(data: bytes):
    return install.extract_app_package(_upload(data))


@pytest.fixture(autouse=True)
def temp_apps_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(install, "TEMP_APPS_DIR", str(tmp_path / "apps_tmp"))


class TestValidPackage:
    def test_valid_package_extracts_and_parses_manifest(self):
        manifest, extract_dir = _extract(pkg.make_zip(_valid_files()))
        try:
            assert manifest.id == "hello-world"
            assert manifest.scopes == ["courses:read"]
            assert os.path.isfile(os.path.join(extract_dir, "index.html"))
            assert os.path.isfile(os.path.join(extract_dir, "app.js"))
        finally:
            install.cleanup_extract_dir(extract_dir)

    def test_nested_paths_allowed(self):
        files = _valid_files()
        files["assets/deep/logo.png"] = b"\x89PNG\r\n\x1a\nfake"
        manifest, extract_dir = _extract(pkg.make_zip(files))
        try:
            assert os.path.isfile(os.path.join(extract_dir, "assets/deep/logo.png"))
        finally:
            install.cleanup_extract_dir(extract_dir)


class TestPathTraversal:
    def test_traversal_entry_not_written_outside(self, tmp_path):
        files = _valid_files()
        files["../../../../tmp/lh_app_pwned.txt"] = "owned"
        manifest, extract_dir = _extract(pkg.make_zip(files))
        try:
            assert not os.path.exists("/tmp/lh_app_pwned.txt")
            assert not os.path.exists(
                os.path.join(os.path.dirname(extract_dir), "..", "tmp", "lh_app_pwned.txt")
            )
            assert os.path.isfile(os.path.join(extract_dir, "index.html"))
        finally:
            install.cleanup_extract_dir(extract_dir)


class TestSymlink:
    def test_symlink_entry_rejected(self):
        # zip_with_symlink includes non-allowlisted names; build our own.
        import zipfile

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, content in _valid_files().items():
                zf.writestr(name, content)
            info = zipfile.ZipInfo("evil.css")
            info.external_attr = (0xA1FF & 0xFFFF) << 16
            info.create_system = 3
            zf.writestr(info, "/etc/passwd")
        with pytest.raises(HTTPException) as exc:
            _extract(buf.getvalue())
        assert exc.value.status_code == 400
        assert "symlink" in exc.value.detail


class TestExtensionAllowlist:
    @pytest.mark.parametrize("bad_name", ["backdoor.php", "run.sh", "evil.exe", "noext"])
    def test_disallowed_file_type_rejects_package(self, bad_name):
        files = _valid_files()
        files[bad_name] = "nope"
        with pytest.raises(HTTPException) as exc:
            _extract(pkg.make_zip(files))
        assert exc.value.status_code == 400
        assert "not" in exc.value.detail.lower()


class TestManifest:
    def test_missing_manifest_rejected(self):
        files = _valid_files()
        del files["learnhouse.json"]
        with pytest.raises(HTTPException) as exc:
            _extract(pkg.make_zip(files))
        assert exc.value.status_code == 400
        assert "learnhouse.json" in exc.value.detail

    def test_invalid_json_rejected(self):
        files = _valid_files()
        files["learnhouse.json"] = "{not json"
        with pytest.raises(HTTPException) as exc:
            _extract(pkg.make_zip(files))
        assert exc.value.status_code == 400

    def test_unknown_scope_rejected(self):
        with pytest.raises(HTTPException) as exc:
            _extract(pkg.make_zip(_valid_files(scopes=["superadmin:write"])))
        assert exc.value.status_code == 400
        assert "scope" in exc.value.detail

    def test_reserved_id_rejected(self):
        with pytest.raises(HTTPException) as exc:
            _extract(pkg.make_zip(_valid_files(id="manage")))
        assert exc.value.status_code == 400
        assert "reserved" in exc.value.detail

    def test_missing_entry_file_rejected(self):
        files = _valid_files(entry="missing.html")
        with pytest.raises(HTTPException) as exc:
            _extract(pkg.make_zip(files))
        assert exc.value.status_code == 400
        assert "entry" in exc.value.detail

    def test_traversal_entry_path_rejected(self):
        with pytest.raises(HTTPException) as exc:
            _extract(pkg.make_zip(_valid_files(entry="../outside.html")))
        assert exc.value.status_code == 400


class TestSizeGuards:
    def test_too_many_entries_rejected(self, monkeypatch):
        monkeypatch.setattr(install, "MAX_ENTRY_COUNT", 3)
        files = _valid_files()
        for i in range(5):
            files[f"file{i}.txt"] = "x"
        with pytest.raises(HTTPException) as exc:
            _extract(pkg.make_zip(files))
        assert exc.value.status_code == 400
        assert "too many entries" in exc.value.detail

    def test_per_entry_size_cap_rejected(self, monkeypatch):
        monkeypatch.setattr(install, "MAX_ENTRY_SIZE", 128)
        files = _valid_files()
        files["big.txt"] = "A" * 1024
        with pytest.raises(HTTPException) as exc:
            _extract(pkg.make_zip(files))
        assert exc.value.status_code == 400

    def test_suspicious_compression_ratio_rejected(self):
        files = _valid_files()
        # 1MB of zeros compresses to ~1KB — far past the 20x ratio ceiling.
        files["zeros.txt"] = b"\x00" * (1024 * 1024)
        with pytest.raises(HTTPException) as exc:
            _extract(pkg.make_zip(files))
        assert exc.value.status_code == 400
        assert "compression" in exc.value.detail.lower()

    def test_not_a_zip_rejected(self):
        with pytest.raises(HTTPException) as exc:
            _extract(b"definitely not a zip" + b"\x00" * 32)
        assert exc.value.status_code in (400, 415)
