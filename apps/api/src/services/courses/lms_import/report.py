"""Conversion report: what was created, what was skipped and why."""

from __future__ import annotations

import os
import re
from collections import Counter
from dataclasses import dataclass, field

# Warnings and skips repeat (one per broken image, per quiz, per dead link...);
# the report keeps the first occurrences and counts the rest so a huge course
# stays readable and the status file stays small.
MAX_WARNINGS = 500
MAX_SKIPPED = 2000


# Absolute paths in exception text ("/tmp/learnhouse_imports/<id>/work/...")
_ABS_PATH = re.compile(r"(?:/[^/\s'\":]+){2,}/?")


def error_text(e: BaseException) -> str:
    """Exception text safe to show to the uploader: no server paths."""
    if isinstance(e, OSError) and e.strerror:
        name = os.path.basename(str(e.filename).rstrip("/")) if e.filename else ""
        return f"{e.strerror}: {name}" if name else e.strerror
    text = str(e) or type(e).__name__
    return _ABS_PATH.sub(lambda m: os.path.basename(m.group(0).rstrip("/")), text)


@dataclass
class SkippedItem:
    title: str
    kind: str
    reason: str


@dataclass
class ConversionReport:
    source: str = ""
    course_title: str = ""
    counts: Counter = field(default_factory=Counter)
    warnings: list[str] = field(default_factory=list)
    skipped: list[SkippedItem] = field(default_factory=list)
    dropped_warnings: int = 0
    dropped_skipped: int = 0
    _seen_skipped: set[tuple[str, str, str]] = field(default_factory=set, repr=False, compare=False)

    def warn(self, message: str, context: str = "") -> None:
        text = f"{context}: {message}" if context else message
        if text in self.warnings:
            return
        if len(self.warnings) >= MAX_WARNINGS:
            self.dropped_warnings += 1
            return
        self.warnings.append(text)

    def skip(self, title: str, kind: str, reason: str) -> None:
        item = SkippedItem(title=(title or "(untitled)")[:200], kind=kind, reason=reason)
        key = (item.title, item.kind, item.reason)
        if key in self._seen_skipped:
            return
        if len(self.skipped) >= MAX_SKIPPED:
            self.dropped_skipped += 1
            return
        self._seen_skipped.add(key)
        self.skipped.append(item)

    def count(self, key: str, n: int = 1) -> None:
        self.counts[key] += n

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "course_title": self.course_title,
            "counts": dict(sorted(self.counts.items())),
            "warnings": list(self.warnings),
            "dropped_warnings": self.dropped_warnings,
            "skipped": [s.__dict__ for s in self.skipped],
            "dropped_skipped": self.dropped_skipped,
        }

    def summary_lines(self) -> list[str]:
        c = self.counts
        lines = [
            f"Source: {self.source}",
            f"Course: {self.course_title}",
            f"Chapters: {c.get('chapters', 0)}",
            "Activities: "
            + ", ".join(
                f"{label} {c[key]}"
                for key, label in (
                    ("TYPE_DYNAMIC", "pages"),
                    ("TYPE_VIDEO", "videos"),
                    ("TYPE_DOCUMENT", "documents"),
                    ("TYPE_ASSIGNMENT", "assignments"),
                    ("TYPE_SCORM", "SCORM"),
                )
                if c.get(key)
            ),
        ]
        if c.get("questions"):
            lines.append(f"Questions: {c['questions']} in {c.get('assignment_tasks', 0)} tasks")
        media = [f"{k.removeprefix('media_')} {v}" for k, v in sorted(c.items()) if k.startswith("media_")]
        if media:
            lines.append("Media: " + ", ".join(media))
        if self.skipped:
            lines.append(f"Skipped: {len(self.skipped) + self.dropped_skipped}")
        if self.warnings:
            lines.append(f"Warnings: {len(self.warnings) + self.dropped_warnings}")
        return lines
