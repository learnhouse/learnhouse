"""Experiences: the interactive learning blocks of the editor (sort, sequence,
match pairs, hotspot, fill the gaps, myth or fact, speed round, estimate,
spot the mistake, code lock).

Pure helpers shared by the AI tools (doc_ops, markdown, block_specs), search
(rag/sources/dynamic.py) and translation (translations/content.py), so they
all read these blocks the same way. The web editor's node definitions live in
apps/web/components/Objects/Editor/Extensions/Experiences/.
"""

from __future__ import annotations

import re
from typing import Any, Iterator

# Node name -> friendly name used by typed blocks (block_specs) and prompts.
NODES: dict[str, str] = {
    "expSort": "sort",
    "expSequence": "sequence",
    "expMatch": "match_pairs",
    "expHotspot": "hotspot",
    "expGaps": "fill_gaps",
    "expMythFact": "myth_fact",
    "expSpeedRound": "speed_round",
    "expEstimate": "estimate",
    "expSpotMistake": "spot_mistake",
    "expCodeLock": "code_lock",
}
NODE_NAMES = tuple(NODES)

# Every author-written text of a block, as attr paths (dot separated, ``*``
# walks a list). Answers included: this is what find/replace may change.
TEXT_PATHS: dict[str, tuple[str, ...]] = {
    "expSort": ("title", "instructions", "categories.*.label", "items.*.text", "items.*.explanation"),
    "expSequence": ("title", "instructions", "items.*.text", "items.*.detail"),
    "expMatch": ("title", "instructions", "pairs.*.left", "pairs.*.right"),
    "expHotspot": ("title", "instructions", "spots.*.label", "spots.*.explanation"),
    "expGaps": ("title", "text"),
    "expMythFact": ("title", "statements.*.text", "statements.*.explanation", "labels.true", "labels.false"),
    "expSpeedRound": ("title", "questions.*.prompt", "questions.*.options.*"),
    "expEstimate": ("question", "unit", "explanation"),
    "expSpotMistake": (
        "title", "instructions", "segments.*.text", "segments.*.correction", "segments.*.explanation",
    ),
    "expCodeLock": ("title", "story", "clues.*.question", "clues.*.answer", "clues.*.hint", "reward"),
}


def walk(value: Any, path: str | list[str]) -> Iterator[tuple[Any, Any]]:
    """(owner, key) of every string found at an attr path; the owner is the
    dict or list holding it, so callers can read or replace it."""
    parts = path.split(".") if isinstance(path, str) else path
    if not parts:
        return
    head, rest = parts[0], parts[1:]
    if head == "*":
        items = list(enumerate(value)) if isinstance(value, list) else []
    elif isinstance(value, dict) and head in value:
        items = [(head, value[head])]
    else:
        items = []
    for key, item in items:
        if rest:
            yield from walk(item, rest)
        elif isinstance(item, str):
            yield value, key


def strings(attrs: Any, node_type: str) -> Iterator[tuple[Any, Any]]:
    """(owner, key) of every author text of an Experiences block, entry by
    entry (an item's text, then its explanation, then the next item)."""
    if not isinstance(attrs, dict):
        return
    paths = [p.split(".") for p in TEXT_PATHS.get(node_type, ())]
    done: set[str] = set()
    for parts in paths:
        if len(parts) < 3 or parts[1] != "*":
            yield from walk(attrs, parts)
            continue
        if parts[0] in done:
            continue
        done.add(parts[0])
        fields = [p[2:] for p in paths if p[:2] == parts[:2]]
        for entry in attrs.get(parts[0]) if isinstance(attrs.get(parts[0]), list) else []:
            for field in fields:
                yield from walk(entry, field)


def items(value: Any) -> list[dict]:
    """The dict entries of a list attr (anything else skipped)."""
    return [x for x in value if isinstance(x, dict)] if isinstance(value, list) else []


def text(value: Any) -> str:
    """A string attr, stripped; numbers as text (code lock answers)."""
    if isinstance(value, bool):
        return ""
    if isinstance(value, (int, float)):
        return str(value)
    return value.strip() if isinstance(value, str) else ""


# ─── fill the gaps ───────────────────────────────────────────────────────────
#
# Same reading as the editor (Gaps/gapsModel.ts): ``[[answer|alt1|alt2]]``
# marks a gap, a backslash escapes the next character, single brackets nest
# inside a gap, a gap never spans a blank line, and a gap without a non-empty
# answer stays plain text.


def _scan_gap(source: str, start: int) -> tuple[str, int] | None:
    depth = 0
    body: list[str] = []
    i = start
    while i < len(source):
        ch = source[i]
        if ch == "\\" and i + 1 < len(source):
            body.append(source[i:i + 2])
            i += 2
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            if depth == 0 and source[i + 1:i + 2] == "]":
                return "".join(body), i + 2
            depth = max(0, depth - 1)
        elif ch == "\n" and source[i + 1:i + 2] == "\n":
            return None
        body.append(ch)
        i += 1
    return None


def split_answers(body: str) -> list[str]:
    parts: list[str] = []
    current = ""
    i = 0
    while i < len(body):
        ch = body[i]
        if ch == "\\" and i + 1 < len(body):
            current += body[i:i + 2]
            i += 2
            continue
        if ch == "|":
            parts.append(current)
            current = ""
        else:
            current += ch
        i += 1
    parts.append(current)
    out: list[str] = []
    for part in parts:
        value = " ".join(re.sub(r"\\(.)", r"\1", part, flags=re.S).split())
        if value and value not in out:
            out.append(value)
    return out


def gap_tokens(source: Any) -> list[str | list[str]]:
    """The text as plain strings and gaps (each the list of accepted answers)."""
    source = source if isinstance(source, str) else ""
    tokens: list[str | list[str]] = []
    buffer = ""
    i = 0
    while i < len(source):
        ch = source[i]
        if ch == "\\" and i + 1 < len(source):
            buffer += source[i + 1]
            i += 2
            continue
        if source.startswith("[[", i):
            scanned = _scan_gap(source, i + 2)
            if scanned is None:
                buffer += "[["
                i += 2
                continue
            body, end = scanned
            answers = split_answers(body)
            if not answers:
                buffer += source[i:end]
            else:
                if buffer:
                    tokens.append(buffer)
                buffer = ""
                tokens.append(answers)
            i = end
            continue
        buffer += ch
        i += 1
    if buffer:
        tokens.append(buffer)
    return tokens


def gap_answers(source: Any) -> list[list[str]]:
    """Accepted answers of every gap, in order."""
    return [t for t in gap_tokens(source) if isinstance(t, list)]


def gaps_text(source: Any, *, answers: bool) -> str:
    """The text with each gap as ``[answer]`` (answers=True) or ``____``."""
    return "".join(
        t if isinstance(t, str) else (f"[{' / '.join(t)}]" if answers else "____")
        for t in gap_tokens(source)
    )
