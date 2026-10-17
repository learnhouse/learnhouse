"""AI video chapters: caption track (WebVTT) → a short list of titled chapters.

The transcript is condensed to one ``[mm:ss] text`` line per cue and handed to the
cheapest model tier, which returns chapter start times and titles as structured
output. The result is then normalised (sorted, clamped, deduped, first chapter at
0:00) so the player always gets a usable chapter list.

Pure/orchestration-only like ``captions``: no DB, no storage. ``chapter_jobs``
wires it to the activity, its caption files and org credit metering.
"""
from __future__ import annotations

import re
from typing import Optional

from pydantic import BaseModel, Field

from src.services.ai.captions import _CUE_TIME_RE

# A transcript longer than this is sampled down so the prompt stays cheap; the
# fast tier handles ~100k tokens, but chapters don't need every word.
MAX_TRANSCRIPT_CHARS = 60_000
MAX_CHAPTERS = 20
MIN_CHAPTERS = 2
# Chapters closer together than this are merged; shorter ones aren't useful
# for navigation.
MIN_CHAPTER_GAP_SECONDS = 15.0
MAX_TITLE_CHARS = 80
GENERATE_TIMEOUT_S = 120.0

_TAG_RE = re.compile(r"<[^>]+>")


class GeneratedChapter(BaseModel):
    start_seconds: float = Field(description="Where the chapter starts, in seconds from the beginning.")
    title: str = Field(description="Short chapter title, 2-7 words, in the transcript's language.")


class GeneratedChapters(BaseModel):
    chapters: list[GeneratedChapter]


_SYSTEM_PROMPT = (
    "You split educational videos into chapters for a video player's timeline. "
    "You get a transcript with one '[mm:ss] text' line per caption. Return chapters "
    "that mark where the topic or scene clearly changes. Rules: the first chapter "
    "starts at 0; use between 3 and 12 chapters depending on length (fewer for short "
    "videos); each title is 2-7 words, specific to what happens in that part, written "
    "in the same language as the transcript, without numbering, quotes or a trailing "
    "period; start times must come from the transcript timestamps."
)


def _ts_to_seconds(ts: str) -> float:
    parts = ts.replace(",", ".").split(":")
    seconds = 0.0
    for p in parts:
        seconds = seconds * 60 + float(p)
    return seconds


def parse_vtt_cues(vtt: str) -> list[tuple[float, float, str]]:
    """(start, end, text) for every cue in a WebVTT document, in file order."""
    cues: list[tuple[float, float, str]] = []
    lines = (vtt or "").replace("\r\n", "\n").split("\n")
    i = 0
    while i < len(lines):
        m = _CUE_TIME_RE.search(lines[i])
        if not m:
            i += 1
            continue
        start, end = _ts_to_seconds(m.group(1)), _ts_to_seconds(m.group(2))
        text_lines = []
        i += 1
        while i < len(lines) and lines[i].strip():
            text_lines.append(_TAG_RE.sub("", lines[i]).strip())
            i += 1
        text = " ".join(t for t in text_lines if t)
        if text:
            cues.append((start, end, text))
    return cues


def _clock(seconds: float) -> str:
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def build_transcript(cues: list[tuple[float, float, str]], max_chars: int = MAX_TRANSCRIPT_CHARS) -> str:
    """One ``[mm:ss] text`` line per cue, evenly sampled down to ``max_chars``."""
    lines = [f"[{_clock(start)}] {text}" for start, _end, text in cues]
    total = sum(len(line) + 1 for line in lines)
    if total <= max_chars or not lines:
        return "\n".join(lines)
    keep_every = total / max_chars
    sampled = [line for idx, line in enumerate(lines) if int(idx % keep_every) == 0]
    return "\n".join(sampled)


def normalize_chapters(
    raw: list[GeneratedChapter] | list[dict], duration: Optional[float]
) -> list[dict]:
    """Clean model output into ``[{start, title}]``: sorted, inside the video,
    at least ``MIN_CHAPTER_GAP_SECONDS`` apart, first chapter at 0. Returns an
    empty list when fewer than ``MIN_CHAPTERS`` survive."""
    items: list[tuple[float, str]] = []
    for c in raw or []:
        start = c.get("start_seconds", c.get("start")) if isinstance(c, dict) else c.start_seconds
        title = c.get("title") if isinstance(c, dict) else c.title
        try:
            start = float(start)
        except (TypeError, ValueError):
            continue
        if not isinstance(title, str):
            continue
        title = " ".join(title.split()).strip().strip('"').rstrip(".").strip()
        if not title or start != start or start < 0:  # start != start: NaN
            continue
        if duration and start >= duration:
            continue
        items.append((start, title[:MAX_TITLE_CHARS]))
    items.sort(key=lambda x: x[0])

    out: list[dict] = []
    for start, title in items:
        if out and start - out[-1]["start"] < MIN_CHAPTER_GAP_SECONDS:
            continue
        out.append({"start": round(start, 3), "title": title})
    if out:
        out[0]["start"] = 0.0
    out = out[:MAX_CHAPTERS]
    return out if len(out) >= MIN_CHAPTERS else []


async def generate_chapters(vtt: str, model_name: str, duration: Optional[float] = None) -> list[dict]:
    """Chapters for a captioned video. Raises ValueError when the captions are
    empty or the model returns nothing usable."""
    from src.services.ai.llm import generate

    cues = parse_vtt_cues(vtt)
    if not cues:
        raise ValueError("captions have no cues")
    if duration is None:
        duration = cues[-1][1]
    transcript = build_transcript(cues)
    result: GeneratedChapters = await generate(
        model_name=model_name,
        user_prompt=(
            f"Video length: {_clock(duration)}.\n\nTranscript:\n{transcript}"
        ),
        system_prompt=_SYSTEM_PROMPT,
        output_type=GeneratedChapters,
        temperature=0.2,
        timeout=GENERATE_TIMEOUT_S,
    )
    chapters = normalize_chapters(result.chapters if result else [], duration)
    if not chapters:
        raise ValueError("model returned no usable chapters")
    return chapters
