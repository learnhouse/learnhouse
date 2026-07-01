"""Unit + ffmpeg-integration tests for src/services/utils/hls_transcode.py."""

import asyncio
import os
import shutil

import pytest

from src.services.utils import hls_transcode as ht


# --------------------------------------------------------------------------
# Pure ladder selection
# --------------------------------------------------------------------------

def test_select_ladder_is_source_capped():
    assert [r.name for r in ht.select_ladder(1080)] == ["1080p", "720p", "480p", "360p"]
    assert [r.name for r in ht.select_ladder(720)] == ["720p", "480p", "360p"]
    assert [r.name for r in ht.select_ladder(540)] == ["480p", "360p"]
    assert [r.name for r in ht.select_ladder(360)] == ["360p"]


def test_select_ladder_never_empty_for_tiny_sources():
    assert [r.name for r in ht.select_ladder(240)] == ["360p"]
    assert [r.name for r in ht.select_ladder(0)] == ["360p"]


def test_thumbnails_grid_math():
    # interval 10s, 10 columns.
    assert ht.thumbnails_grid(0) == (10, 1)          # unknown duration → one cell
    assert ht.thumbnails_grid(100) == (10, 1)        # 10 frames → 1 row
    assert ht.thumbnails_grid(105) == (10, 2)        # 11 frames → 2 rows
    assert ht.thumbnails_grid(250) == (10, 3)        # 25 frames → 3 rows


# --------------------------------------------------------------------------
# ffmpeg argument construction
# --------------------------------------------------------------------------

def test_build_ffmpeg_args_with_audio():
    rungs = ht.select_ladder(720)  # 720p, 480p, 360p
    args = ht.build_ffmpeg_args("in.mp4", "/out", rungs, has_audio=True)
    joined = " ".join(args)
    assert "-filter_complex" in args
    assert "split=3" in joined
    assert "scale=-2:720" in joined and "scale=-2:360" in joined
    # One audio map per rung, and var_stream_map references audio groups.
    assert args.count("a:0") == 3  # -map a:0 repeated
    vsm = args[args.index("-var_stream_map") + 1]
    assert "v:0,a:0,name:720p" in vsm and "v:2,a:2,name:360p" in vsm
    # Output template + master playlist name.
    assert args[-1].endswith(os.path.join("v%v", "index.m3u8"))
    assert "master.m3u8" in args


def test_build_ffmpeg_args_without_audio_omits_audio_maps():
    rungs = ht.select_ladder(360)
    args = ht.build_ffmpeg_args("in.mp4", "/out", rungs, has_audio=False)
    assert "a:0" not in args
    assert "-c:a" not in args
    vsm = args[args.index("-var_stream_map") + 1]
    assert vsm == "v:0,name:360p"


# --------------------------------------------------------------------------
# Real ffmpeg end-to-end (skipped when ffmpeg is unavailable)
# --------------------------------------------------------------------------

_HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _make_clip(path: str, seconds: int = 4):
    import subprocess
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "lavfi", "-i", f"testsrc=duration={seconds}:size=1280x720:rate=24",
         "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path],
        check=True,
    )


@pytest.mark.skipif(not _HAS_FFMPEG, reason="ffmpeg/ffprobe not installed")
def test_transcode_source_to_hls_end_to_end(tmp_path):
    src = str(tmp_path / "src.mp4")
    out = str(tmp_path / "hls")
    _make_clip(src)

    result = asyncio.run(ht.transcode_source_to_hls(src, out))
    assert result is not None
    assert result["master"] == "master.m3u8"
    # 720p source → 720p/480p/360p rungs.
    assert result["renditions"] == ["720p", "480p", "360p"]

    assert os.path.isfile(os.path.join(out, "master.m3u8"))
    for name in result["renditions"]:
        assert os.path.isfile(os.path.join(out, f"v{name}", "index.m3u8"))
        segs = [f for f in os.listdir(os.path.join(out, f"v{name}")) if f.endswith(".ts")]
        assert segs, f"no segments produced for {name}"

    # Hover-preview sprite is generated and its config returned.
    thumbs = result["thumbnails"]
    assert thumbs is not None
    assert thumbs["url"] == "thumbnails/sprite.jpg"
    assert thumbs["columns"] == 10 and thumbs["width"] == 160 and thumbs["height"] == 90
    assert os.path.isfile(os.path.join(out, "thumbnails", "sprite.jpg"))


@pytest.mark.skipif(not _HAS_FFMPEG, reason="ffmpeg not installed")
def test_transcode_missing_source_returns_none(tmp_path):
    result = asyncio.run(
        ht.transcode_source_to_hls(str(tmp_path / "nope.mp4"), str(tmp_path / "out"))
    )
    assert result is None
