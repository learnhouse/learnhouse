"""AI closed-caption engine: audio → WebVTT (transcription) and VTT → VTT (translation).

Uses the provider-agnostic LLM layer (`src.services.ai.llm.generate`), so it follows
the org's configured provider (Gemini by default) and its multimodal support. Long audio
is segmented, transcribed per chunk, and stitched back with time offsets so a two-hour
lecture works the same as a two-minute clip.

This module is pure/orchestration-only: no DB, no Redis, no storage. `caption_jobs`
wires it to the video pipeline, R2, and org credit metering.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import subprocess
from typing import Optional

logger = logging.getLogger(__name__)

# Segment length for transcription. Kept well under provider audio limits and short
# enough that one slow chunk can't stall the whole job for too long.
CHUNK_SECONDS = 600  # 10 min
AUDIO_EXTRACT_TIMEOUT_S = 30 * 60
TRANSCRIBE_TIMEOUT_S = 8 * 60
TRANSLATE_TIMEOUT_S = 5 * 60
# Guard rails so a single job can't consume unbounded provider quota/time.
MAX_CHUNKS = 60  # up to 10h of audio

# WebVTT timestamps: the hours field is OPTIONAL. Models (Gemini) commonly emit
# MM:SS.mmm (e.g. "00:01.800"); the spec also allows HH:MM:SS.mmm. Accept both —
# requiring hours made every real transcript match zero cues.
_TS = r"(?:\d+:)?\d{1,2}:\d{2}[.,]\d{3}"
_CUE_TIME_RE = re.compile(rf"({_TS})\s*-->\s*({_TS})")


# --------------------------------------------------------------------------
# ffmpeg audio extraction
# --------------------------------------------------------------------------

def _run(args: list[str], timeout: int) -> tuple[int, bytes, bytes]:
    """Blocking subprocess.run (call via asyncio.to_thread). Same rationale as
    hls_transcode._run_subprocess: never spawn subprocesses on the server loop."""
    try:
        p = subprocess.run(args, capture_output=True, timeout=timeout)
        return p.returncode, p.stdout or b"", p.stderr or b""
    except subprocess.TimeoutExpired as e:
        return -1, (e.stdout or b""), (e.stderr or b"")


def _ffmpeg() -> str:
    return os.environ.get("LEARNHOUSE_FFMPEG_PATH", "ffmpeg")


def _ffprobe() -> str:
    return os.environ.get("LEARNHOUSE_FFPROBE_PATH", "ffprobe")


async def probe_duration(src_path: str) -> float:
    """Media duration in seconds (0.0 if it can't be determined)."""
    rc, out, _ = await asyncio.to_thread(
        _run,
        [_ffprobe(), "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", src_path],
        60,
    )
    if rc != 0:
        return 0.0
    try:
        return max(0.0, float(out.decode().strip() or 0))
    except (TypeError, ValueError):
        return 0.0


async def extract_audio_chunks(src_path: str, out_dir: str) -> list[str]:
    """Extract mono 16 kHz MP3 audio and split it into CHUNK_SECONDS segments.

    Returns the ordered list of chunk file paths (chunk N covers
    [N*CHUNK_SECONDS, (N+1)*CHUNK_SECONDS)). Empty list on failure.
    """
    pattern = os.path.join(out_dir, "chunk_%04d.mp3")
    rc, _, stderr = await asyncio.to_thread(
        _run,
        [_ffmpeg(), "-y", "-loglevel", "error", "-i", src_path,
         "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k",
         "-f", "segment", "-segment_time", str(CHUNK_SECONDS), pattern],
        AUDIO_EXTRACT_TIMEOUT_S,
    )
    if rc != 0:
        logger.error("Caption audio extraction failed (rc=%s): %s", rc, (stderr or b"").decode()[:400])
        return []
    chunks = sorted(
        os.path.join(out_dir, f) for f in os.listdir(out_dir)
        if f.startswith("chunk_") and f.endswith(".mp3")
    )
    return chunks[:MAX_CHUNKS]


# --------------------------------------------------------------------------
# WebVTT helpers
# --------------------------------------------------------------------------

def _parse_ts(ts: str) -> float:
    """Parse a WebVTT/SRT timestamp (MM:SS.mmm or HH:MM:SS.mmm) to seconds."""
    parts = ts.strip().replace(",", ".").split(":")
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        return 0.0
    if len(nums) == 3:
        h, m, s = nums
    elif len(nums) == 2:
        h, m, s = 0.0, nums[0], nums[1]
    else:
        return 0.0
    return h * 3600 + m * 60 + s


def _seconds_to_ts(total: float) -> str:
    if total < 0:
        total = 0.0
    ms = int(round((total - int(total)) * 1000))
    total = int(total)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def sanitize_vtt(text: str) -> str:
    """Coerce model output into a valid WebVTT body.

    Models sometimes wrap output in ```markdown fences``` or omit the required
    `WEBVTT` header, or use ',' millisecond separators (SRT style). Normalize all
    of that so players accept it.
    """
    if not text:
        return "WEBVTT\n"
    t = text.strip()
    # Strip code fences.
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n?", "", t)
        t = re.sub(r"\n?```$", "", t).strip()
    # SRT-style comma milliseconds -> dot (MM:SS,mmm or HH:MM:SS,mmm).
    t = re.sub(r"(\d{1,2}:\d{2}(?::\d{2})?),(\d{3})", r"\1.\2", t)
    if not t.upper().startswith("WEBVTT"):
        t = "WEBVTT\n\n" + t
    if not t.endswith("\n"):
        t += "\n"
    return t


def shift_vtt(text: str, offset_seconds: float) -> str:
    """Add offset_seconds to every cue timestamp (for stitching chunk transcripts)."""
    if not offset_seconds:
        return text

    def _shift(m: re.Match) -> str:
        start = _parse_ts(m.group(1)) + offset_seconds
        end = _parse_ts(m.group(2)) + offset_seconds
        return f"{_seconds_to_ts(start)} --> {_seconds_to_ts(end)}"

    return _CUE_TIME_RE.sub(_shift, text)


def _cue_body(text: str) -> str:
    """Everything after the WEBVTT header (the cues), for merging."""
    t = text.strip()
    if t.upper().startswith("WEBVTT"):
        t = t.split("\n", 1)[1] if "\n" in t else ""
    return t.strip()


def merge_vtt_chunks(chunk_vtts: list[str]) -> str:
    """Merge already-offset chunk VTTs into one document with a single header."""
    bodies = [_cue_body(sanitize_vtt(c)) for c in chunk_vtts if c and c.strip()]
    bodies = [b for b in bodies if b]
    return "WEBVTT\n\n" + "\n\n".join(bodies) + "\n"


def has_cues(text: str) -> bool:
    return bool(_CUE_TIME_RE.search(text or ""))


# --------------------------------------------------------------------------
# Transcription + translation (LLM)
# --------------------------------------------------------------------------

_TRANSCRIBE_SYSTEM = (
    "You are a precise speech-to-text captioning engine. You transcribe audio into "
    "WebVTT subtitles. Rules: output ONLY valid WebVTT (start with 'WEBVTT'); use "
    "cue timestamps in HH:MM:SS.mmm format; keep each cue short (max ~7 seconds and "
    "~2 lines); transcribe in the ORIGINAL spoken language; do not translate; do not "
    "add commentary, speaker labels, or code fences."
)


async def _transcribe_chunk(audio_path: str, model_name: str, source_language: Optional[str]) -> str:
    from pydantic_ai import BinaryContent  # local import: heavy dep, keeps module import cheap

    from src.services.ai.llm import generate

    with open(audio_path, "rb") as f:
        audio = f.read()
    lang_hint = (
        f"The spoken language is '{source_language}'. " if source_language and source_language != "auto" else ""
    )
    prompt = [
        f"{lang_hint}Transcribe this audio into WebVTT subtitles following the rules.",
        BinaryContent(data=audio, media_type="audio/mpeg"),
    ]
    out = await generate(
        model_name=model_name,
        user_prompt=prompt,
        system_prompt=_TRANSCRIBE_SYSTEM,
        output_type=str,
        temperature=0.0,
        timeout=float(TRANSCRIBE_TIMEOUT_S),
    )
    return sanitize_vtt(out or "")


async def transcribe_to_vtt(
    audio_chunks: list[str], model_name: str, source_language: Optional[str] = None
) -> str:
    """Transcribe ordered audio chunks and stitch into one WebVTT document.

    Chunk N's timestamps are offset by N*CHUNK_SECONDS. Raises ValueError if the
    result has no cues (nothing usable transcribed).
    """
    if not audio_chunks:
        raise ValueError("no audio to transcribe")
    pieces: list[str] = []
    for i, path in enumerate(audio_chunks):
        vtt = await _transcribe_chunk(path, model_name, source_language)
        pieces.append(shift_vtt(vtt, i * CHUNK_SECONDS))
    merged = merge_vtt_chunks(pieces)
    if not has_cues(merged):
        raise ValueError("transcription produced no cues")
    return merged


_TRANSLATE_SYSTEM = (
    "You are a subtitle translation engine. You translate WebVTT captions. Rules: "
    "output ONLY valid WebVTT (start with 'WEBVTT'); keep EVERY cue and its exact "
    "timestamps unchanged; translate ONLY the spoken text of each cue into the target "
    "language; preserve line breaks and cue order; do not add commentary or code fences."
)


async def translate_vtt(vtt_text: str, target_language_label: str, model_name: str) -> str:
    """Translate a WebVTT document's cue text into `target_language_label`
    (a human-readable language name, e.g. 'French'). Timestamps are preserved."""
    from src.services.ai.llm import generate

    out = await generate(
        model_name=model_name,
        user_prompt=(
            f"Translate the caption text of the following WebVTT into {target_language_label}. "
            f"Keep all timestamps and cue structure identical.\n\n{vtt_text}"
        ),
        system_prompt=_TRANSLATE_SYSTEM,
        output_type=str,
        temperature=0.2,
        timeout=float(TRANSLATE_TIMEOUT_S),
    )
    result = sanitize_vtt(out or "")
    if not has_cues(result):
        raise ValueError(f"translation to {target_language_label} produced no cues")
    return result


def estimate_credits(duration_seconds: float, num_translations: int) -> int:
    """AI credits for a caption job: 1 per (started) 10-min transcription chunk plus
    1 per translation language. Minimum 1."""
    chunks = max(1, -(-int(duration_seconds) // CHUNK_SECONDS))  # ceil
    return max(1, chunks + max(0, num_translations))
