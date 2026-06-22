"""
Unit tests for src/security/file_validation.py

Focus on the media-upload surface: Office (OOXML + legacy OLE) and zip archives
are accepted only when their bytes match, junk/renamed files are rejected, SVG is
blocked, and the stored filename comes from the validated content type.
"""

import io
import zipfile

import pytest
from fastapi import HTTPException

from src.security.file_validation import (
    validate_upload,
    validate_ole_content,
    validate_zip_content,
    get_safe_filename,
)

# The categories the media upload endpoint allows (see src/services/media/media.py).
MEDIA_TYPES = ["image", "video", "document", "audio", "office", "office_legacy", "archive"]


class _FakeUpload:
    def __init__(self, filename, data, content_type="application/octet-stream"):
        self.filename = filename
        self.content_type = content_type
        self.file = io.BytesIO(data)


def _zip_bytes():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("hello.txt", "hi")
    return buf.getvalue()


_OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 32
_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


class TestValidateUploadMedia:
    @pytest.mark.parametrize(
        "name,data,expected_ext",
        [
            ("report.docx", _zip_bytes(), "docx"),
            ("sheet.xlsx", _zip_bytes(), "xlsx"),
            ("deck.pptx", _zip_bytes(), "pptx"),
            ("legacy.doc", _OLE, "doc"),
            ("legacy.xls", _OLE, "xls"),
            ("legacy.ppt", _OLE, "ppt"),
            ("bundle.zip", _zip_bytes(), "zip"),
            ("logo.png", _PNG, "png"),
        ],
    )
    def test_accepts_and_normalizes_extension(self, name, data, expected_ext):
        ctype, content = validate_upload(_FakeUpload(name, data), MEDIA_TYPES)
        stored = get_safe_filename(name, "uuid_media", content_type=ctype)
        assert stored == f"uuid_media.{expected_ext}"
        assert content == data

    def test_rejects_disallowed_extension(self):
        with pytest.raises(HTTPException) as exc:
            validate_upload(_FakeUpload("evil.exe", b"MZ\x90\x00" * 4), MEDIA_TYPES)
        assert exc.value.status_code == 415

    def test_rejects_zip_renamed_as_docx_when_not_zip(self):
        with pytest.raises(HTTPException) as exc:
            validate_upload(_FakeUpload("fake.docx", b"not a zip at all"), MEDIA_TYPES)
        assert exc.value.status_code == 415

    def test_rejects_ole_renamed_as_doc_when_not_ole(self):
        with pytest.raises(HTTPException) as exc:
            validate_upload(_FakeUpload("fake.doc", b"plain text, not OLE"), MEDIA_TYPES)
        assert exc.value.status_code == 415

    def test_blocks_svg(self):
        with pytest.raises(HTTPException) as exc:
            validate_upload(_FakeUpload("x.svg", b"<svg></svg>"), MEDIA_TYPES)
        assert exc.value.status_code == 415

    def test_no_file(self):
        with pytest.raises(HTTPException) as exc:
            validate_upload(_FakeUpload("", b""), MEDIA_TYPES)
        assert exc.value.status_code == 400


class TestZipAndOleValidators:
    def test_validate_zip_accepts_real_zip(self):
        assert validate_zip_content(_zip_bytes()) is True

    def test_validate_zip_rejects_non_zip(self):
        assert validate_zip_content(b"nope") is False

    def test_validate_zip_rejects_zip_bomb(self):
        # A single entry whose declared uncompressed size exceeds the 500 MB cap.
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("big.bin", b"\x00" * (1024 * 1024))  # 1 MB real
            zf.infolist()[0].file_size = 600 * 1024 * 1024  # fake 600 MB declared
        assert validate_zip_content(buf.getvalue()) is False

    def test_validate_ole(self):
        assert validate_ole_content(_OLE) is True
        assert validate_ole_content(b"PK\x03\x04stuff") is False


class TestSafeFilename:
    def test_content_type_drives_extension_not_client_name(self):
        # client claims .html but the validated type is png -> stored as .png
        stored = get_safe_filename("evil.html", "uuid", content_type="image/png")
        assert stored == "uuid.png"

    def test_unknown_content_type_falls_back_to_bin(self):
        assert get_safe_filename("x.weird", "uuid", content_type="application/x-unknown") == "uuid.bin"
