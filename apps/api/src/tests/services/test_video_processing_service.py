"""Unit + ffmpeg-integration tests for src/services/utils/video_processing.py."""

import os
import shutil
import subprocess

import pytest

from src.services.utils import video_processing as vp


# --------------------------------------------------------------------------
# is_faststart (byte-level moov/mdat ordering)
# --------------------------------------------------------------------------

def test_is_faststart_true_when_moov_before_mdat(tmp_path):
    p = tmp_path / "a.mp4"
    p.write_bytes(b"\x00\x00ftyp....moov....mdat....")
    assert vp.is_faststart(str(p)) is True


def test_is_faststart_false_when_mdat_before_moov(tmp_path):
    p = tmp_path / "b.mp4"
    p.write_bytes(b"\x00\x00ftyp....mdat....moov....")
    assert vp.is_faststart(str(p)) is False


def test_is_faststart_false_when_no_moov(tmp_path):
    p = tmp_path / "c.mp4"
    p.write_bytes(b"\x00\x00ftyp....mdat....data")
    assert vp.is_faststart(str(p)) is False


# --------------------------------------------------------------------------
# ensure_faststart guard rails
# --------------------------------------------------------------------------

def test_ensure_faststart_skips_non_mp4(tmp_path):
    p = tmp_path / "clip.webm"
    p.write_bytes(b"whatever")
    assert vp.ensure_faststart(str(p)) is False


def test_ensure_faststart_missing_file_returns_false(tmp_path):
    assert vp.ensure_faststart(str(tmp_path / "missing.mp4")) is False


def test_ensure_faststart_already_faststart_is_noop(tmp_path, monkeypatch):
    p = tmp_path / "d.mp4"
    p.write_bytes(b"\x00\x00ftyp....moov....mdat....")
    # If ffmpeg were called this would explode — assert it is NOT called.
    monkeypatch.setattr(vp, "_ffmpeg_available", lambda: (_ for _ in ()).throw(AssertionError("ffmpeg should not run")))
    assert vp.ensure_faststart(str(p)) is True


def test_ensure_faststart_without_ffmpeg_returns_false(tmp_path, monkeypatch):
    p = tmp_path / "e.mp4"
    p.write_bytes(b"\x00\x00ftyp....mdat....moov....")  # non-faststart
    monkeypatch.setattr(vp.shutil, "which", lambda name: None)
    assert vp.ensure_faststart(str(p)) is False


# --------------------------------------------------------------------------
# Real ffmpeg remux (skipped when ffmpeg unavailable)
# --------------------------------------------------------------------------

_HAS_FFMPEG = shutil.which("ffmpeg") is not None


@pytest.mark.skipif(not _HAS_FFMPEG, reason="ffmpeg not installed")
def test_ensure_faststart_moves_moov_to_front(tmp_path):
    src = str(tmp_path / "vid.mp4")
    # Default mp4 muxing puts moov at the END (non-faststart).
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=24",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", src],
        check=True,
    )
    assert vp.is_faststart(src) is False  # sanity: starts non-faststart

    assert vp.ensure_faststart(src) is True
    assert vp.is_faststart(src) is True   # moov now at the front
