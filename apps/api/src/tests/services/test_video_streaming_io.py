"""Tests for the streaming/IO paths of src/services/utils/video_streaming.py.

Range parsing, local + S3 chunked streaming, file-info lookup, and the
directory-traversal guard. S3 is faked; no network.
"""

import os

import pytest
from botocore.exceptions import ClientError

from src.services.utils import video_streaming as vs


# --------------------------------------------------------------------------
# MIME type
# --------------------------------------------------------------------------

def test_mime_type_is_case_insensitive():
    assert vs.get_video_mime_type("/x/clip.MKV") == "video/x-matroska"
    assert vs.get_video_mime_type("song.m4a") == "audio/mp4"


def test_mime_type_unknown_extension_defaults_to_mp4():
    # Browsers need *some* video type; mp4 is the safest default.
    assert vs.get_video_mime_type("blob.xyz") == "video/mp4"
    assert vs.get_video_mime_type("noext") == "video/mp4"


# --------------------------------------------------------------------------
# parse_range_header
# --------------------------------------------------------------------------

def test_parse_range_no_header_means_whole_file():
    assert vs.parse_range_header(None, 100) == (0, 99)


def test_parse_range_suffix():
    # bytes=-10 → last 10 bytes; a suffix larger than the file clamps to byte 0.
    assert vs.parse_range_header("bytes=-10", 100) == (90, 99)
    assert vs.parse_range_header("bytes=-500", 100) == (0, 99)


def test_parse_range_open_ended():
    assert vs.parse_range_header("bytes=50-", 100) == (50, 99)


def test_parse_range_explicit_and_clamped():
    assert vs.parse_range_header("bytes=10-19", 100) == (10, 19)
    # End past EOF clamps to the last byte.
    assert vs.parse_range_header("bytes=10-5000", 100) == (10, 99)
    # Start past EOF clamps to the last byte, end never precedes start.
    assert vs.parse_range_header("bytes=500-600", 100) == (99, 99)
    assert vs.parse_range_header("bytes=30-20", 100) == (30, 30)


def test_parse_range_start_only_without_dash():
    # "bytes=10" has no end part → stream to EOF.
    assert vs.parse_range_header("bytes=10", 100) == (10, 99)


# --------------------------------------------------------------------------
# Local streaming
# --------------------------------------------------------------------------

@pytest.fixture
def local_storage(monkeypatch):
    monkeypatch.setattr(vs, "is_s3_enabled", lambda: False)


@pytest.fixture
def video_file(tmp_path):
    data = bytes(range(256)) * 4  # 1024 bytes, distinct-ish content
    p = tmp_path / "v.mp4"
    p.write_bytes(data)
    return str(p), data


def test_stream_local_whole_file_in_chunks(local_storage, video_file):
    path, data = video_file
    chunks = list(vs.stream_video_file(path, chunk_size=300))
    assert [len(c) for c in chunks] == [300, 300, 300, 124]
    assert b"".join(chunks) == data


def test_stream_local_range_and_end_clamped(local_storage, video_file):
    path, data = video_file
    assert b"".join(vs.stream_video_file(path, 100, 199, chunk_size=64)) == data[100:200]
    # An end past EOF is clamped to the last byte.
    assert b"".join(vs.stream_video_file(path, 1000, 99999)) == data[1000:]


def test_stream_local_stops_when_file_is_shorter_than_reported(
    local_storage, video_file, monkeypatch
):
    """If the file shrinks between stat and read, the generator must stop at
    EOF instead of looping forever on empty reads."""
    path, data = video_file
    monkeypatch.setattr(vs.os.path, "getsize", lambda p: len(data) + 5000)
    assert b"".join(vs.stream_video_file(path, chunk_size=512)) == data


# --------------------------------------------------------------------------
# S3 streaming
# --------------------------------------------------------------------------

class _Body:
    def __init__(self, data):
        self._data = data

    def read(self):
        return self._data


class _FakeS3:
    def __init__(self, objects, head_error=None):
        self.objects = objects
        self.head_error = head_error
        self.ranges = []

    def get_object(self, Bucket, Key, Range):
        self.ranges.append(Range)
        start, end = (int(x) for x in Range.replace("bytes=", "").split("-"))
        return {"Body": _Body(self.objects[Key][start:end + 1])}

    def head_object(self, Bucket, Key):
        if self.head_error:
            raise self.head_error
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {"ContentLength": len(self.objects[Key])}


def _use_s3(monkeypatch, client):
    monkeypatch.setattr(vs, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(vs, "get_storage_client", lambda: client)
    monkeypatch.setattr(vs, "get_s3_bucket_name", lambda: "bucket")


def test_stream_s3_whole_object_uses_ranged_gets(monkeypatch):
    data = b"x" * 250
    s3 = _FakeS3({"k/v.mp4": data})
    _use_s3(monkeypatch, s3)

    out = b"".join(vs.stream_video_file("k/v.mp4", chunk_size=100))

    assert out == data
    assert s3.ranges == ["bytes=0-99", "bytes=100-199", "bytes=200-249"]


def test_stream_s3_explicit_range(monkeypatch):
    data = bytes(range(200))
    s3 = _FakeS3({"k": data})
    _use_s3(monkeypatch, s3)
    assert b"".join(vs.stream_video_file("k", 10, 29, chunk_size=8)) == data[10:30]


def test_stream_s3_missing_object_yields_nothing(monkeypatch):
    s3 = _FakeS3({})
    _use_s3(monkeypatch, s3)
    assert list(vs.stream_video_file("missing.mp4")) == []
    assert s3.ranges == []  # never issued a GET


def test_stream_s3_stops_on_empty_body(monkeypatch):
    # A caller-supplied end past the object's size: S3 returns an empty body
    # for the out-of-range chunk and the generator must stop.
    data = b"y" * 50
    s3 = _FakeS3({"k": data})
    _use_s3(monkeypatch, s3)
    assert b"".join(vs.stream_video_file("k", 0, 999, chunk_size=50)) == data


# --------------------------------------------------------------------------
# get_file_info
# --------------------------------------------------------------------------

def test_file_info_local(local_storage, video_file, tmp_path):
    path, data = video_file
    assert vs.get_file_info(path) == (len(data), "video/mp4", True)
    assert vs.get_file_info(str(tmp_path / "nope.mp4")) == (0, "", False)
    # A directory is not a streamable file.
    assert vs.get_file_info(str(tmp_path)) == (0, "", False)


def test_file_info_s3(monkeypatch):
    _use_s3(monkeypatch, _FakeS3({"a.webm": b"abc"}))
    assert vs.get_file_info("a.webm") == (3, "video/webm", True)
    assert vs.get_file_info("missing.webm") == (0, "", False)  # ClientError


def test_file_info_s3_no_client(monkeypatch):
    _use_s3(monkeypatch, None)
    assert vs.get_file_info("a.mp4") == (0, "", False)


def test_file_info_s3_unexpected_error(monkeypatch):
    _use_s3(monkeypatch, _FakeS3({"a.mp4": b"a"}, head_error=RuntimeError("conn reset")))
    assert vs.get_file_info("a.mp4") == (0, "", False)


# --------------------------------------------------------------------------
# validate_video_path
# --------------------------------------------------------------------------

def test_validate_rejects_traversal_and_absolute_parts(local_storage, tmp_path):
    assert vs.validate_video_path(str(tmp_path), "..", "etc") is None
    assert vs.validate_video_path(str(tmp_path), "a/../../b") is None
    assert vs.validate_video_path(str(tmp_path), "/etc/passwd") is None


def test_validate_s3_returns_joined_key(monkeypatch):
    monkeypatch.setattr(vs, "is_s3_enabled", lambda: True)
    assert vs.validate_video_path("content", "orgs", "o1", "v.mp4") == "content/orgs/o1/v.mp4"


def test_validate_local_inside_base(local_storage, tmp_path):
    (tmp_path / "orgs").mkdir()
    expected = os.path.realpath(str(tmp_path / "orgs" / "v.mp4"))
    assert vs.validate_video_path(str(tmp_path), "orgs", "v.mp4") == expected


def test_validate_local_symlink_escape_is_rejected(local_storage, tmp_path):
    """A symlink inside the content dir pointing at a sibling dir must not be
    followed out of the base (realpath + commonpath check)."""
    base = tmp_path / "content"
    base.mkdir()
    outside = tmp_path / "content-secret"
    outside.mkdir()
    (base / "link").symlink_to(outside)
    assert vs.validate_video_path(str(base), "link", "x.mp4") is None


def test_validate_local_path_error_returns_none(local_storage, tmp_path, monkeypatch):
    def _boom(paths):
        raise ValueError("mixed drives")

    monkeypatch.setattr(vs.os.path, "commonpath", _boom)
    assert vs.validate_video_path(str(tmp_path), "v.mp4") is None
