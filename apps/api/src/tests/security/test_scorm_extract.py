"""
SCORM zip-extraction hardening (_safe_extract_zip) + manifest XXE.

Exercises the security guards directly with small inputs by monkeypatching the
size caps, so we never have to materialize gigabyte fixtures. Skips cleanly when
the EE package is absent.
"""

import os

import defusedxml.ElementTree as ET
import pytest

scorm = pytest.importorskip("ee.services.scorm.scorm")

from src.tests.fixtures import scorm_packages as pkg  # noqa: E402


def _write(tmp_path, data: bytes):
    zip_path = tmp_path / "package.zip"
    zip_path.write_bytes(data)
    extract_dir = tmp_path / "extracted"
    extract_dir.mkdir()
    return str(zip_path), str(extract_dir)


class TestPathTraversal:
    def test_traversal_entry_not_written_outside(self, tmp_path):
        zip_path, extract_dir = _write(tmp_path, pkg.adv_path_traversal())
        scorm._safe_extract_zip(zip_path, extract_dir)
        # The malicious ../../../../tmp file must NOT escape the extract dir.
        assert not os.path.exists("/tmp/lh_scorm_pwned.txt")
        # Legit content is still present.
        assert os.path.exists(os.path.join(extract_dir, "index.html"))
        assert os.path.exists(os.path.join(extract_dir, "imsmanifest.xml"))


class TestSymlink:
    def test_symlink_entry_skipped(self, tmp_path):
        zip_path, extract_dir = _write(tmp_path, pkg.zip_with_symlink("/etc/passwd"))
        scorm._safe_extract_zip(zip_path, extract_dir)
        link = os.path.join(extract_dir, "evil_link")
        # Symlink entries are skipped entirely — not created as a symlink.
        assert not os.path.islink(link)


class TestSizeGuards:
    def test_per_file_size_limit_skips_large_file(self, tmp_path, monkeypatch):
        monkeypatch.setattr(scorm, "MAX_SCORM_FILE_SIZE", 1024)
        big = pkg.make_zip({
            "imsmanifest.xml": pkg.manifest_12_single(),
            "index.html": pkg.sco_html("SCORM_12"),
            "huge.bin": b"A" * 4096,
        })
        zip_path, extract_dir = _write(tmp_path, big)
        scorm._safe_extract_zip(zip_path, extract_dir)
        assert not os.path.exists(os.path.join(extract_dir, "huge.bin"))
        assert os.path.exists(os.path.join(extract_dir, "index.html"))

    def test_zip_bomb_total_size_rejected(self, tmp_path, monkeypatch):
        # Cap total to a tiny value so a modest payload trips the bomb guard.
        monkeypatch.setattr(scorm, "MAX_SCORM_PACKAGE_SIZE", 256)
        data = pkg.make_zip({
            "imsmanifest.xml": pkg.manifest_12_single(),
            "a.bin": b"A" * 4096,
        })
        zip_path, extract_dir = _write(tmp_path, data)
        with pytest.raises(Exception):  # HTTPException 400
            scorm._safe_extract_zip(zip_path, extract_dir)


class TestXxe:
    def test_xxe_external_entity_not_expanded(self):
        # defusedxml must refuse the external entity rather than read /etc/passwd.
        with pytest.raises(Exception):
            ET.fromstring(pkg.manifest_xxe())
