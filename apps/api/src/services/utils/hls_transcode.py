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


async def _probe(src_path: str) -> tuple[int, bool]:
    """Return (height, has_audio). Falls back to (1080, True) on probe failure."""
    probe = _ffprobe()
    if not probe:
        return 1080, True
    proc = await asyncio.create_subprocess_exec(
        probe, "-v", "error", "-show_streams", "-of", "json", src_path,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, _ = await proc.communicate()
    try:
        streams = json.loads(out.decode() or "{}").get("streams", [])
    except json.JSONDecodeError:
        return 1080, True
    height = 0
    has_audio = False
    for s in streams:
        if s.get("codec_type") == "video":
            height = max(height, int(s.get("height") or 0))
        elif s.get("codec_type") == "audio":
            has_audio = True
    return (height or 1080), has_audio


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

    height, has_audio = await _probe(src_path)
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
    return {"master": MASTER_PLAYLIST_NAME, "renditions": [r.name for r in rungs]}
