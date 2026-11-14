"""Everything a learner handed in for one assignment, made readable for a model.

For each task this collects the learner's answer as text, and for file tasks
the file itself: documents become text, images stay images, and audio/video is
probed, its audio extracted and (once credits are reserved) transcribed with
the caption engine, with a few frames sampled from videos.

Loading happens in two steps so credits are charged on what a submission
really costs: ``load_material`` does the local work (reads, extraction,
ffprobe, ffmpeg), then the caller prices it with ``credit_cost``, reserves
those credits, and only then runs ``transcribe_media``, the one model-backed
step here.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
from dataclasses import dataclass, field
from typing import Any, Optional

from src.db.courses.assignments import AssignmentTaskTypeEnum
from src.services.ai.grading.documents import Extracted, extract, sniff

logger = logging.getLogger(__name__)

# ── Pricing (AI credits) ────────────────────────────────────────────────────
# One grading call over text costs BASE_CREDITS. Heavier hand-ins cost more:
# every started 2 minutes of audio/video (it is transcribed, and video frames
# are sent along), every started 50k characters of document text after the
# first 50k, and every started group of 4 images after the first 4.
BASE_CREDITS = 2  # = pricing.FEATURES["ai_grading"].credits
MEDIA_SECONDS_PER_CREDIT = 120
DOC_CHARS_PER_CREDIT = 50_000
FREE_IMAGES = 4
IMAGES_PER_CREDIT = 4

# ── Caps ────────────────────────────────────────────────────────────────────
MAX_FILE_BYTES = 100 * 1024 * 1024
# Only the first 20 minutes of a recording are transcribed (and billed).
MAX_MEDIA_SECONDS = 20 * 60
MAX_FRAMES = 6
FRAME_WIDTH = 768
MAX_IMAGES = 12
MAX_ANSWER_CHARS = 30_000
# A PDF without a text layer (a scan) goes to the model as a PDF when the
# provider reads PDFs natively and the file is small enough.
NATIVE_PDF_MAX_BYTES = 15 * 1024 * 1024

# Task types the deterministic checker scores; the model only writes feedback.
CHECKER_SCORED_TYPES = frozenset(
    {
        AssignmentTaskTypeEnum.QUIZ,
        AssignmentTaskTypeEnum.FORM,
        AssignmentTaskTypeEnum.NUMBER_ANSWER,
    }
)

_FILE_KEYS = ("fileUUID", "file_uuid", "file_name", "fileName")
_MEDIA_KINDS = ("audio", "video")


def esc(text: Any) -> str:
    """Learner-controlled text, made inert inside the prompt's tags."""
    return str(text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _clip(text: str, limit: int = MAX_ANSWER_CHARS) -> str:
    return text if len(text) <= limit else text[:limit] + "\n[...truncated]"


def _ts(seconds: float) -> str:
    seconds = int(max(0, seconds))
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


@dataclass
class FileItem:
    name: str
    kind: str = "unknown"
    mime: str = "application/octet-stream"
    size: int = 0
    data: Optional[bytes] = None  # kept for images and scanned PDFs only
    local_path: Optional[str] = None  # media copied to the work dir
    text: str = ""
    truncated: bool = False
    pages: Optional[int] = None
    note: Optional[str] = None
    duration: float = 0.0
    audio_chunks: list[str] = field(default_factory=list)
    frames: list[tuple[float, bytes]] = field(default_factory=list)
    transcript: str = ""

    @property
    def billable_seconds(self) -> float:
        return min(self.duration, MAX_MEDIA_SECONDS) if self.kind in _MEDIA_KINDS else 0.0

    def source(self) -> dict:
        out: dict[str, Any] = {"name": self.name, "kind": self.kind, "size": self.size}
        if self.pages:
            out["pages"] = self.pages
        if self.text:
            out["chars"] = len(self.text)
        if self.kind in _MEDIA_KINDS:
            out["duration_seconds"] = round(self.duration, 1)
            out["transcript_excerpt"] = self.transcript[:600]
            if self.frames:
                out["frames"] = len(self.frames)
            if self.duration > MAX_MEDIA_SECONDS:
                out["note"] = f"Only the first {MAX_MEDIA_SECONDS // 60} minutes were graded."
        if self.truncated:
            out["truncated"] = True
        if self.note:
            out["note"] = self.note
        return out


@dataclass
class TaskMaterial:
    task: Any  # AssignmentTask
    submission: Any  # AssignmentTaskSubmission | None
    answer_text: str = ""
    checker_score: Optional[int] = None
    files: list[FileItem] = field(default_factory=list)

    @property
    def uuid(self) -> str:
        return self.task.assignment_task_uuid

    @property
    def max_score(self) -> int:
        return int(self.task.max_grade_value or 0)

    @property
    def submitted(self) -> bool:
        return self.submission is not None

    @property
    def ai_scored(self) -> bool:
        """Whether the model sets this task's score (else the checker does)."""
        if self.task.assignment_type in CHECKER_SCORED_TYPES:
            return False
        if self.task.assignment_type == AssignmentTaskTypeEnum.CODE:
            # Tests decide a code task when they exist and actually ran.
            has_tests = bool((self.task.contents or {}).get("test_cases"))
            return not (has_tests and self.checker_score is not None)
        return True


@dataclass
class Material:
    tasks: list[TaskMaterial]

    def files(self) -> list[FileItem]:
        return [f for t in self.tasks for f in t.files]

    def sources(self) -> list[dict]:
        return [
            {"assignment_task_uuid": t.uuid, **f.source()} for t in self.tasks for f in t.files
        ]


def credit_units(material: Material) -> dict[str, int]:
    """The submission's billable extras, in the units of
    ``pricing.FEATURES["ai_grading"].extra``: started 2-minute blocks of
    audio/video, started 50k-character blocks of document text after the first,
    started groups of 4 images after the first 4."""
    media = docs = images = 0
    for f in material.files():
        if f.kind in _MEDIA_KINDS:
            media += max(1, math.ceil(f.billable_seconds / MEDIA_SECONDS_PER_CREDIT))
        elif f.kind == "image":
            images += 1
        elif f.text:
            docs += (len(f.text) - 1) // DOC_CHARS_PER_CREDIT
    image_units = math.ceil((min(images, MAX_IMAGES) - FREE_IMAGES) / IMAGES_PER_CREDIT) if images > FREE_IMAGES else 0
    return {"media_minutes": media, "document_pages": docs, "images": image_units}


def credit_cost(material: Material) -> int:
    """Published credits one grading run of this submission costs (its minimum:
    the run is metered and charges more if its real usage costs more)."""
    from src.services.ai import pricing

    return pricing.estimate_credits("ai_grading", 1, extra=credit_units(material))


# ── Answers as text ─────────────────────────────────────────────────────────


def _render_answer(task, data: dict) -> str:
    """The learner's answer to a non-file task, as escaped text."""
    t = task.assignment_type
    contents = task.contents or {}
    if t in (AssignmentTaskTypeEnum.SHORT_ANSWER, AssignmentTaskTypeEnum.NUMBER_ANSWER):
        return f"Answer: {esc(data.get('answer'))}"
    if t == AssignmentTaskTypeEnum.QUIZ:
        chosen = {
            (s.get("questionUUID"), s.get("optionUUID"))
            for s in data.get("submissions") or []
            if isinstance(s, dict) and s.get("answer")
        }
        lines = []
        for i, q in enumerate(contents.get("questions") or [], start=1):
            if not isinstance(q, dict):
                continue
            picked = [
                esc(o.get("text") or o.get("optionUUID"))
                for o in q.get("options") or []
                if isinstance(o, dict) and (q.get("questionUUID"), o.get("optionUUID")) in chosen
            ]
            lines.append(f"Q{i}: selected {', '.join(picked) if picked else '(nothing)'}")
        return "\n".join(lines)
    if t == AssignmentTaskTypeEnum.FORM:
        answers = {
            (s.get("questionUUID"), s.get("blankUUID")): s.get("answer")
            for s in data.get("submissions") or []
            if isinstance(s, dict)
        }
        lines = []
        for i, q in enumerate(contents.get("questions") or [], start=1):
            if not isinstance(q, dict):
                continue
            for j, b in enumerate(q.get("blanks") or [], start=1):
                if isinstance(b, dict):
                    value = answers.get((q.get("questionUUID"), b.get("blankUUID")))
                    lines.append(f"Q{i} blank {j}: {esc(value) if value else '(empty)'}")
        return "\n".join(lines)
    if t == AssignmentTaskTypeEnum.CODE:
        results = data.get("results") or []
        passed = sum(1 for r in results if isinstance(r, dict) and r.get("passed"))
        summary = f"\nLast test run in the browser: {passed}/{len(results)} passed." if results else ""
        return f"Language id: {esc(data.get('language_id'))}\nSource code:\n{esc(data.get('source_code'))}{summary}"
    # CUSTOM / OTHER / anything new: the raw answer object.
    return esc(json.dumps(data, ensure_ascii=False, default=str, indent=1))


def render_definition(task) -> str:
    """The task as the teacher wrote it, answer keys included (instructor side)."""
    contents = task.contents or {}
    t = task.assignment_type
    parts = [f"Title: {esc(task.title)}"]
    if task.description:
        parts.append(f"Instructions: {esc(task.description)}")
    if contents.get("prompt"):
        parts.append(f"Question: {esc(contents.get('prompt'))}")
    if t == AssignmentTaskTypeEnum.SHORT_ANSWER and contents.get("correct_answers"):
        parts.append(
            "Accepted answers (reference): " + "; ".join(esc(a) for a in contents.get("correct_answers") or [])
        )
    if t == AssignmentTaskTypeEnum.NUMBER_ANSWER and contents.get("correct_value") is not None:
        parts.append(
            f"Expected value: {esc(contents.get('correct_value'))} "
            f"(tolerance {esc(contents.get('tolerance') or 0)}) {esc(contents.get('unit') or '')}".rstrip()
        )
    if t in (AssignmentTaskTypeEnum.QUIZ, AssignmentTaskTypeEnum.FORM):
        for i, q in enumerate(contents.get("questions") or [], start=1):
            if not isinstance(q, dict):
                continue
            parts.append(f"Q{i}: {esc(q.get('questionText'))}")
            for o in q.get("options") or []:
                if isinstance(o, dict):
                    mark = " (correct)" if o.get("assigned_right_answer") else ""
                    parts.append(f"  - {esc(o.get('text'))}{mark}")
            for j, b in enumerate(q.get("blanks") or [], start=1):
                if isinstance(b, dict):
                    parts.append(f"  blank {j} expects: {esc(b.get('correctAnswer'))}")
    if t == AssignmentTaskTypeEnum.CODE:
        tests = contents.get("test_cases") or []
        parts.append(f"Test cases configured: {len(tests)}")
        if contents.get("solution_code"):
            parts.append(f"Reference solution:\n{esc(_clip(str(contents.get('solution_code')), 8000))}")
    if t == AssignmentTaskTypeEnum.CUSTOM and contents:
        parts.append("Definition: " + esc(_clip(json.dumps(contents, ensure_ascii=False, default=str), 8000)))
    return "\n".join(parts)


# ── Files ───────────────────────────────────────────────────────────────────


def submission_file_key(
    org_uuid: str, course_uuid: str, activity_uuid: str, assignment_uuid: str, task_uuid: str, filename: str
) -> str:
    return (
        f"content/orgs/{org_uuid}/courses/{course_uuid}/activities/{activity_uuid}"
        f"/assignments/{assignment_uuid}/tasks/{task_uuid}/subs/{filename}"
    )


def submission_file_names(data: dict) -> list[str]:
    names = [data.get(k) for k in _FILE_KEYS]
    seen: list[str] = []
    for n in names:
        if isinstance(n, str) and n and n not in seen:
            seen.append(n)
    return seen


async def _load_file(key: str, name: str, work_dir: str, *, light: bool, native_pdf: bool) -> FileItem:
    from src.services.ai import captions as cap
    from src.services.ai.rag.formats import is_safe_file_name
    from src.services.courses.transfer.storage_utils import read_file_content

    item = FileItem(name=name)
    if not is_safe_file_name(name):
        item.note = "The file name is not valid."
        return item
    data = await asyncio.to_thread(read_file_content, key)
    if data is None:
        item.note = "The file could not be found."
        return item
    item.size = len(data)
    if item.size > MAX_FILE_BYTES:
        item.note = f"The file is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB and was not read."
        return item
    item.kind, item.mime = sniff(data, name)

    if item.kind == "image":
        # A file that only looks like an image would make the provider reject
        # the whole request; check it decodes and skip it with a note if not.
        if await asyncio.to_thread(_image_decodes, data):
            item.data = data
        else:
            item.note = "The image could not be opened."
    elif item.kind in _MEDIA_KINDS:
        item.local_path = os.path.join(work_dir, name)
        await asyncio.to_thread(_write, item.local_path, data)
        item.duration = await cap.probe_duration(item.local_path)
        if not light:
            await _extract_media(item, work_dir)
    elif item.kind == "unknown":
        item.note = "This file type cannot be read."
    else:
        extracted: Extracted = await asyncio.to_thread(extract, item.kind, data, name)
        item.text, item.truncated, item.pages, item.note = (
            extracted.text, extracted.truncated, extracted.pages, extracted.note,
        )
        if item.kind == "pdf" and not item.text and native_pdf and item.size <= NATIVE_PDF_MAX_BYTES:
            item.data = data
            item.note = "No text layer; the PDF itself was given to the model."
    return item


def _image_decodes(data: bytes) -> bool:
    import io

    from PIL import Image

    try:
        with Image.open(io.BytesIO(data)) as im:
            im.load()
        return True
    except Exception:
        return False


def _write(path: str, data: bytes) -> None:
    with open(path, "wb") as f:
        f.write(data)


async def _extract_media(item: FileItem, work_dir: str) -> None:
    """Audio chunks to transcribe, and sampled frames for a video."""
    from src.services.ai import captions as cap

    audio_dir = os.path.join(work_dir, f"{item.name}.audio")
    os.makedirs(audio_dir, exist_ok=True)
    chunks = await cap.extract_audio_chunks(item.local_path, audio_dir)
    keep = max(1, math.ceil(MAX_MEDIA_SECONDS / cap.CHUNK_SECONDS))
    item.audio_chunks = chunks[:keep]
    if not item.audio_chunks:
        item.note = "No audio track."
    if item.kind == "video":
        item.frames = await sample_frames(item.local_path, item.duration, os.path.join(work_dir, f"{item.name}.frames"))


async def sample_frames(path: str, duration: float, out_dir: str) -> list[tuple[float, bytes]]:
    """Up to MAX_FRAMES evenly spaced JPEG frames, as (timestamp, bytes)."""
    from src.services.ai import captions as cap
    from src.services.utils.video_processing import SAFE_INPUT_ARGS

    os.makedirs(out_dir, exist_ok=True)
    span = min(duration, MAX_MEDIA_SECONDS) if duration > 0 else 0.0
    count = MAX_FRAMES if span >= MAX_FRAMES else max(1, int(span) or 1)
    step = span / count if span > 0 else 0.0
    frames: list[tuple[float, bytes]] = []
    for i in range(count):
        at = step * i + step / 2
        out = os.path.join(out_dir, f"frame_{i:02d}.jpg")
        rc, _, _ = await asyncio.to_thread(
            cap._run,
            [cap._ffmpeg(), "-y", "-loglevel", "error", "-ss", f"{at:.2f}", *SAFE_INPUT_ARGS, "-i", path,
             "-frames:v", "1", "-vf", f"scale={FRAME_WIDTH}:-2", "-q:v", "4", out],
            120,
        )
        if rc == 0 and os.path.isfile(out):
            with open(out, "rb") as f:
                frames.append((at, f.read()))
    return frames


async def load_material(
    *,
    tasks: list,
    submissions_by_task_id: dict,
    org_uuid: str,
    course_uuid: str,
    activity_uuid: str,
    assignment_uuid: str,
    work_dir: str,
    light: bool = False,
    native_pdf: bool = False,
) -> Material:
    """Read one learner's submission. ``light`` skips what pricing doesn't need
    (checker runs, audio extraction, frames), for the credit estimate."""
    from src.services.courses.activities.assignments import _server_verified_task_grade

    out: list[TaskMaterial] = []
    for task in tasks:
        ts = submissions_by_task_id.get(task.id)
        tm = TaskMaterial(task=task, submission=ts)
        if ts is not None:
            data = ts.task_submission if isinstance(ts.task_submission, dict) else {}
            if task.assignment_type == AssignmentTaskTypeEnum.FILE_SUBMISSION:
                for name in submission_file_names(data):
                    key = submission_file_key(
                        org_uuid, course_uuid, activity_uuid, assignment_uuid, task.assignment_task_uuid, name
                    )
                    tm.files.append(await _load_file(key, name, work_dir, light=light, native_pdf=native_pdf))
                note = {k: v for k, v in data.items() if k not in _FILE_KEYS and k != "assignment_task_submission_uuid"}
                tm.answer_text = esc(json.dumps(note, ensure_ascii=False, default=str)) if note else ""
            else:
                tm.answer_text = _clip(_render_answer(task, data))
            if not light:
                tm.checker_score = await _server_verified_task_grade(task, ts)
        out.append(tm)
    return Material(tasks=out)


async def transcribe_media(material: Material, model_name: str) -> None:
    """Transcribe every audio/video file with the caption engine. Raises on a
    provider error (the caller refunds); "no speech" is a note, not an error."""
    from src.services.ai import captions as cap
    from src.services.ai.rag.formats import vtt_windows

    for item in material.files():
        if item.kind not in _MEDIA_KINDS or not item.audio_chunks:
            continue
        try:
            vtt = await cap.transcribe_to_vtt(item.audio_chunks, model_name)
        except ValueError:
            item.note = "No speech was detected."
            continue
        item.transcript = "\n".join(
            f"[{_ts(start)}] {text}" for start, text in vtt_windows(vtt, window=20.0)
        )
