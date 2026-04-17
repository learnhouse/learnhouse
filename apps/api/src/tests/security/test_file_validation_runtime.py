import zipfile
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.security.file_validation import (
    get_safe_filename,
    validate_audio_content,
    validate_image_content,
    validate_upload,
    validate_video_content,
    validate_zip_content,
)


def _upload(filename: str, content: bytes, content_type: str = "application/octet-stream"):
    return SimpleNamespace(
        filename=filename,
        content_type=content_type,
        file=BytesIO(content),
    )


def _make_zip_bytes(name: str = "test.txt", payload: bytes = b"hello") -> bytes:
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(name, payload)
    return buf.getvalue()


_VALID_ZIP_BYTES = _make_zip_bytes()
# Empty-archive EOCD-only record (zip spec, parseable by zipfile)
_EMPTY_ZIP_BYTES = b"PK\x05\x06" + b"\x00" * 18


class TestMagicByteValidators:
    def test_validate_image_content_short_and_unknown(self):
        assert validate_image_content(b"short") is False
        assert validate_image_content(b"not-an-image-at-all") is False

    @pytest.mark.parametrize(
        ("content", "expected"),
        [
            (b"\xff\xd8\xff" + b"\x00" * 9, True),
            (b"\x89PNG\r\n\x1a\n" + b"\x00" * 4, True),
            (b"GIF87a" + b"\x00" * 6, True),
            (b"GIF89a" + b"\x00" * 6, True),
            (b"RIFF1234WEBPxxxx", True),
        ],
    )
    def test_validate_image_content_accepts_known_formats(self, content, expected):
        assert validate_image_content(content) is expected

    def test_validate_video_content_short_and_unknown(self):
        assert validate_video_content(b"short") is False
        assert validate_video_content(b"abcdefghijklmno") is False

    @pytest.mark.parametrize(
        "content",
        [
            b"0000ftypmp4x",
            b"0000ftypM4Vx",
            b"0000ftypisom",
            b"\x1a\x45\xdf\xa3" + b"\x00" * 8,
        ],
    )
    def test_validate_video_content_accepts_known_formats(self, content):
        assert validate_video_content(content) is True

    def test_validate_audio_content_short_and_unknown(self):
        assert validate_audio_content(b"short") is False
        assert validate_audio_content(b"abcdefghijklmno") is False

    @pytest.mark.parametrize(
        "content",
        [
            b"ID3" + b"\x00" * 9,
            b"\xff\xfb" + b"\x00" * 10,
            b"\xff\xf3" + b"\x00" * 10,
            b"\xff\xf2" + b"\x00" * 10,
            b"RIFF1234WAVE",
            b"OggS" + b"\x00" * 8,
            b"0000ftypM4A" + b"x",
            b"0000ftypmp4x",
            b"0000ftypisom",
            b"0000ftypdash",
        ],
    )
    def test_validate_audio_content_accepts_known_formats(self, content):
        assert validate_audio_content(content) is True

    def test_validate_zip_content_short_and_unknown(self):
        assert validate_zip_content(b"abc") is False
        assert validate_zip_content(b"NOPE") is False

    @pytest.mark.parametrize("content", [_VALID_ZIP_BYTES, _EMPTY_ZIP_BYTES])
    def test_validate_zip_content_accepts_zip_headers(self, content):
        assert validate_zip_content(content) is True


class TestValidateUpload:
    def test_validate_upload_requires_file(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_upload(None, ["image"])
        assert exc_info.value.status_code == 400

    def test_validate_upload_requires_filename(self):
        upload = _upload("", b"")
        with pytest.raises(HTTPException) as exc_info:
            validate_upload(upload, ["image"])
        assert exc_info.value.status_code == 400

    def test_validate_upload_blocks_svg(self):
        upload = _upload("logo.svg", b"<svg></svg>", "image/svg+xml")
        with pytest.raises(HTTPException) as exc_info:
            validate_upload(upload, ["image"])
        assert exc_info.value.status_code == 415
        assert "SVG files are not allowed" in exc_info.value.detail

    def test_validate_upload_rejects_unallowed_extension(self):
        upload = _upload("archive.exe", b"MZ...")
        with pytest.raises(HTTPException) as exc_info:
            validate_upload(upload, ["image"])
        assert exc_info.value.status_code == 415
        assert "Allowed:" in exc_info.value.detail

    def test_validate_upload_rejects_too_large_file(self):
        upload = _upload("photo.png", b"\x89PNG\r\n\x1a\n" + b"0" * 32, "image/png")
        with pytest.raises(HTTPException) as exc_info:
            validate_upload(upload, ["image"], max_size=4)
        assert exc_info.value.status_code == 413
        assert "File too large" in exc_info.value.detail

    def test_validate_upload_rejects_invalid_content(self):
        upload = _upload("photo.png", b"not-a-valid-png", "image/png")
        with pytest.raises(HTTPException) as exc_info:
            validate_upload(upload, ["image"])
        assert exc_info.value.status_code == 415
        assert "corrupted or invalid" in exc_info.value.detail

    @pytest.mark.parametrize(
        ("filename", "content", "content_type", "allowed_types"),
        [
            ("photo.png", b"\x89PNG\r\n\x1a\n" + b"0" * 8, "image/png", ["image"]),
            ("clip.mp4", b"0000ftypmp4x", "video/mp4", ["video"]),
            ("lesson.pdf", b"%PDF-1.7\nrest", "application/pdf", ["document"]),
            ("song.mp3", b"ID3" + b"\x00" * 9, "audio/mpeg", ["audio"]),
            ("package.zip", _VALID_ZIP_BYTES, "application/zip", ["scorm"]),
            ("db.sqlite", b"SQLite format 3\x00rest", "application/vnd.sqlite3", ["database"]),
            (
                "deck.docx",
                _VALID_ZIP_BYTES,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ["office"],
            ),
        ],
    )
    def test_validate_upload_accepts_allowed_file_types(
        self, filename, content, content_type, allowed_types
    ):
        upload = _upload(filename, content, content_type)

        returned_type, returned_content = validate_upload(upload, allowed_types)

        assert returned_type == content_type
        assert returned_content == content
        assert upload.file.tell() == 0


class TestSafeFilename:
    def test_safe_filename_empty_original(self):
        assert get_safe_filename("", "prefix") == "prefix.bin"

    def test_safe_filename_keeps_safe_extension(self):
        assert get_safe_filename("Photo.PNG", "prefix") == "prefix.png"
        assert get_safe_filename("archive.tar.gz", "prefix") == "prefix.gz"

    def test_safe_filename_rejects_unsafe_extension(self):
        assert get_safe_filename("name.bad-ext", "prefix") == "prefix.bin"
