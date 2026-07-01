"""Unit + ffmpeg-integration tests for src/services/utils/video_processing.py."""

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


def test_ensure_faststart_recognizes_uppercase_extensions(tmp_path, monkeypatch):
    # Already-faststart .MP4 (uppercase) → True without invoking ffmpeg.
    p = tmp_path / "CLIP.MP4"
    p.write_bytes(b"\x00\x00ftyp....moov....mdat....")
    monkeypatch.setattr(vp, "_ffmpeg_available", lambda: (_ for _ in ()).throw(AssertionError("no ffmpeg")))
    assert vp.ensure_faststart(str(p)) is True


def _fake_completed(returncode):
    class _R:
        pass
    r = _R()
    r.returncode = returncode
    r.stderr = "boom"
    return r


def test_ensure_faststart_remux_failure_keeps_original_and_cleans_temp(tmp_path, monkeypatch):
    p = tmp_path / "v.mp4"
    original = b"\x00\x00ftyp....mdat....moov...."  # non-faststart
    p.write_bytes(original)
    monkeypatch.setattr(vp.shutil, "which", lambda name: "/usr/bin/ffmpeg")
    # ffmpeg "runs" but fails (rc=1); it must not touch the original.
    monkeypatch.setattr(vp.subprocess, "run", lambda *a, **k: _fake_completed(1))
    assert vp.ensure_faststart(str(p)) is False
    assert p.read_bytes() == original                      # original intact
    assert not (tmp_path / "v.mp4.faststart.mp4").exists()  # temp cleaned up


def test_ensure_faststart_zero_byte_output_is_failure(tmp_path, monkeypatch):
    p = tmp_path / "v.mp4"
    original = b"\x00\x00ftyp....mdat....moov...."
    p.write_bytes(original)
    monkeypatch.setattr(vp.shutil, "which", lambda name: "/usr/bin/ffmpeg")

    def _fake_run(args, **kwargs):
        # ffmpeg "succeeds" (rc=0) but produces an empty output file.
        open(args[-1], "wb").close()
        return _fake_completed(0)

    monkeypatch.setattr(vp.subprocess, "run", _fake_run)
    assert vp.ensure_faststart(str(p)) is False
    assert p.read_bytes() == original
    assert not (tmp_path / "v.mp4.faststart.mp4").exists()


def test_ensure_faststart_timeout_keeps_original(tmp_path, monkeypatch):
    p = tmp_path / "v.mp4"
    original = b"\x00\x00ftyp....mdat....moov...."
    p.write_bytes(original)
    monkeypatch.setattr(vp.shutil, "which", lambda name: "/usr/bin/ffmpeg")

    def _raise_timeout(*a, **k):
        raise subprocess.TimeoutExpired(cmd="ffmpeg", timeout=1)

    monkeypatch.setattr(vp.subprocess, "run", _raise_timeout)
    assert vp.ensure_faststart(str(p)) is False
    assert p.read_bytes() == original


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


def test_is_faststart_unreadable_file_returns_false(tmp_path):
    # Opening a nonexistent path raises OSError → treated as not-faststart.
    assert vp.is_faststart(str(tmp_path / "missing.mp4")) is False


def test_ensure_faststart_generic_subprocess_error_keeps_original(tmp_path, monkeypatch):
    p = tmp_path / "v.mp4"
    original = b"\x00\x00ftyp....mdat....moov...."
    p.write_bytes(original)
    monkeypatch.setattr(vp.shutil, "which", lambda name: "/usr/bin/ffmpeg")

    def _raise(*a, **k):
        raise OSError("exec format error")

    monkeypatch.setattr(vp.subprocess, "run", _raise)
    assert vp.ensure_faststart(str(p)) is False
    assert p.read_bytes() == original
