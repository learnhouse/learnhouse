"""
HLS transcoding.

Turns a source video into an adaptive HLS ladder: a master playlist plus one
rendition (index playlist + .ts segments) per quality level, so the player can
switch quality to match live bandwidth instead of stalling.

Everything here is CPU-heavy and slow — it is meant to run in a worker/CLI, not
in a request. The ladder is *source-capped*: we never upscale, and the top rung
never exceeds the source resolution.
"""

import asyncio
import json
import logging
import os
import shutil
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Rung:
    name: str          # e.g. "720p" → rendition dir "v720p"
    height: int
    v_bitrate: str     # target video bitrate
    v_maxrate: str
    v_bufsize: str


# Standard 16:9 ladder. Widths are derived by ffmpeg (scale=-2:h) so non-16:9
# sources keep their aspect ratio.
_LADDER: tuple[Rung, ...] = (
    Rung("1080p", 1080, "5000k", "5350k", "7500k"),
    Rung("720p", 720, "2800k", "3000k", "4200k"),
    Rung("480p", 480, "1400k", "1500k", "2100k"),
    Rung("360p", 360, "800k", "856k", "1200k"),
)

HLS_SEGMENT_SECONDS = 6
MASTER_PLAYLIST_NAME = "master.m3u8"

# Hover-scrub preview sprite (a grid of small frames the player shows when the
# user scrubs the progress bar, YouTube-style).
THUMBS_DIR = "thumbnails"
THUMBS_SPRITE = "sprite.jpg"
THUMB_INTERVAL_SECONDS = 10
THUMB_WIDTH = 160
THUMB_HEIGHT = 90
THUMB_COLUMNS = 10


def _ffmpeg() -> Optional[str]:
    return shutil.which("ffmpeg")


def _ffprobe() -> Optional[str]:
    return shutil.which("ffprobe")


def select_ladder(source_height: int) -> list[Rung]:
    """Pick rungs no taller than the source; always keep at least the lowest.

    A 1080p source yields all four rungs; a 540p source yields 480p+360p; a tiny
    source yields just the smallest rung (never upscaled).
    """
    rungs = [r for r in _LADDER if r.height <= source_height]
    if not rungs:
        rungs = [_LADDER[-1]]  # smallest, for very small sources
    return rungs


def build_ffmpeg_args(
    src_path: str, out_dir: str, rungs: list[Rung], has_audio: bool
) -> list[str]:
    """Build the single-invocation ffmpeg command for the whole ladder.

    Output layout under out_dir: master.m3u8, v{name}/index.m3u8, v{name}/seg_*.ts
    (relative refs — master → rendition playlists, rendition → segments).
    """
    n = len(rungs)
    split_labels = "".join(f"[v{i}]" for i in range(n))
    filters = [f"[0:v]split={n}{split_labels}"]
    for i, r in enumerate(rungs):
        # -2 keeps width even and aspect ratio intact.
        filters.append(f"[v{i}]scale=-2:{r.height}[v{i}out]")
    filter_complex = ";".join(filters)

    args = [_ffmpeg() or "ffmpeg", "-y", "-loglevel", "error", "-i", src_path,
            "-filter_complex", filter_complex]

    for i, r in enumerate(rungs):
        args += [
            "-map", f"[v{i}out]",
            f"-c:v:{i}", "libx264", "-preset", "veryfast",
            f"-b:v:{i}", r.v_bitrate, f"-maxrate:v:{i}", r.v_maxrate,
            f"-bufsize:v:{i}", r.v_bufsize,
            f"-g:v:{i}", "48", f"-keyint_min:v:{i}", "48",
            f"-sc_threshold:v:{i}", "0",
        ]

    var_parts = []
    if has_audio:
        for i in range(n):
            args += ["-map", "a:0"]
        args += ["-c:a", "aac", "-b:a", "128k", "-ac", "2"]
        var_parts = [f"v:{i},a:{i},name:{r.name}" for i, r in enumerate(rungs)]
    else:
        var_parts = [f"v:{i},name:{r.name}" for i, r in enumerate(rungs)]

    args += [
        "-f", "hls",
        "-hls_time", str(HLS_SEGMENT_SECONDS),
        "-hls_playlist_type", "vod",
        "-hls_flags", "independent_segments",
        "-master_pl_name", MASTER_PLAYLIST_NAME,
        "-hls_segment_filename", os.path.join(out_dir, "v%v", "seg_%04d.ts"),
        "-var_stream_map", " ".join(var_parts),
        os.path.join(out_dir, "v%v", "index.m3u8"),
    ]
    return args


async def _probe(src_path: str) -> tuple[int, bool, float]:
    """Return (height, has_audio, duration_s). Falls back to (1080, True, 0.0)."""
    probe = _ffprobe()
    if not probe:
        return 1080, True, 0.0
    proc = await asyncio.create_subprocess_exec(
        probe, "-v", "error", "-show_streams", "-show_format", "-of", "json", src_path,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, _ = await proc.communicate()
    try:
        data = json.loads(out.decode() or "{}")
    except json.JSONDecodeError:
        return 1080, True, 0.0
    streams = data.get("streams", [])
    height = 0
    has_audio = False
    for s in streams:
        if s.get("codec_type") == "video":
            height = max(height, int(s.get("height") or 0))
        elif s.get("codec_type") == "audio":
            has_audio = True
    try:
        duration = float(data.get("format", {}).get("duration") or 0.0)
    except (TypeError, ValueError):
        duration = 0.0
    return (height or 1080), has_audio, duration


def thumbnails_grid(duration_s: float, interval: int = THUMB_INTERVAL_SECONDS,
                    columns: int = THUMB_COLUMNS) -> tuple[int, int]:
    """Return (columns, rows) for a sprite covering the whole duration."""
    import math
    frames = max(1, math.ceil(max(duration_s, 0.0) / interval)) if duration_s else 1
    rows = max(1, math.ceil(frames / columns))
    return columns, rows


async def generate_sprite_thumbnails(
    src_path: str, out_dir: str, duration_s: float,
    interval: int = THUMB_INTERVAL_SECONDS,
    width: int = THUMB_WIDTH, height: int = THUMB_HEIGHT,
    columns: int = THUMB_COLUMNS,
) -> Optional[dict]:
    """
    Build a single sprite sheet of evenly-spaced frames for progress-bar hover
    previews. Returns the videojs-sprite-thumbnails config (relative url,
    interval, width, height, columns, rows) or None on failure. Never raises.
    """
    if not _ffmpeg():
        return None
    # For clips shorter than one interval, `fps=1/interval` yields zero frames.
    # Shrink the interval so short videos still get a couple of preview cells.
    if duration_s and duration_s < interval:
        interval = max(1, int(duration_s // 2))
    cols, rows = thumbnails_grid(duration_s, interval, columns)
    dest_dir = os.path.join(out_dir, THUMBS_DIR)
    os.makedirs(dest_dir, exist_ok=True)
    sprite_path = os.path.join(dest_dir, THUMBS_SPRITE)
    # One frame per `interval`s, letterboxed into uniform WxH cells, tiled to a
    # grid. `format=yuvj420p` gives the mjpeg encoder the full-range YUV it needs
    # (avoids "Non full-range YUV is non-standard" failures on some sources).
    vf = (
        f"fps=1/{interval},"
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,"
        f"tile={cols}x{rows},"
        f"format=yuvj420p"
    )
    try:
        proc = await asyncio.create_subprocess_exec(
            _ffmpeg(), "-y", "-loglevel", "error", "-i", src_path,
            "-vf", vf, "-frames:v", "1", "-an", sprite_path,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0 or not os.path.isfile(sprite_path):
            logger.warning("Sprite thumbnail generation failed: %s",
                           (stderr or b"").decode()[:500])
            return None
    except Exception as e:
        logger.warning("Sprite thumbnail error for %s: %s", src_path, e)
        return None
    return {
        "url": f"{THUMBS_DIR}/{THUMBS_SPRITE}",
        "interval": interval, "width": width, "height": height,
        "columns": cols, "rows": rows,
    }


async def transcode_source_to_hls(src_path: str, out_dir: str) -> Optional[dict]:
    """
    Transcode src_path into an HLS ladder under out_dir.

    Returns {"master": "master.m3u8", "renditions": ["720p", ...]} on success,
    or None on failure (caller keeps the MP4 fallback). Never raises.
    """
    if not _ffmpeg():
        logger.error("ffmpeg not available; cannot transcode %s", src_path)
        return None
    if not os.path.isfile(src_path):
        logger.error("HLS source missing: %s", src_path)
        return None

    height, has_audio, duration = await _probe(src_path)
    rungs = select_ladder(height)
    os.makedirs(out_dir, exist_ok=True)
    for r in rungs:
        os.makedirs(os.path.join(out_dir, f"v{r.name}"), exist_ok=True)

    args = build_ffmpeg_args(src_path, out_dir, rungs, has_audio)
    logger.info("Transcoding %s → HLS %s (%s)", src_path, out_dir,
                ",".join(r.name for r in rungs))
    try:
        proc = await asyncio.create_subprocess_exec(
            *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            logger.error("ffmpeg HLS transcode failed (rc=%s): %s",
                         proc.returncode, (stderr or b"").decode()[:1000])
            return None
    except Exception as e:
        logger.error("HLS transcode error for %s: %s", src_path, e)
        return None

    master = os.path.join(out_dir, MASTER_PLAYLIST_NAME)
    if not os.path.isfile(master):
        logger.error("HLS transcode produced no master playlist for %s", src_path)
        return None

    # Best-effort hover-preview sprite; playback works fine without it.
    thumbnails = await generate_sprite_thumbnails(src_path, out_dir, duration)

    return {
        "master": MASTER_PLAYLIST_NAME,
        "renditions": [r.name for r in rungs],
        "thumbnails": thumbnails,
    }
