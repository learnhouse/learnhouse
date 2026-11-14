"""Translatable text of an activity page, as segments.

A translation keeps the source page's structure exactly: every block, every
node attribute, every mark and id stays as it is, and only text changes. To
get there, a page is read as a list of *segments* (the text a translator
sees) and a translation is written back by putting translated segments into
a copy of the source document.

Two kinds of segments:

* ``text``: one block of running text (a paragraph, a heading, a button
  label, a table cell's paragraph...). Its inline content is flattened into
  a small markup so a translator can reorder words across formatting:
  ``Click <m1>here</m1> to see <x1/>``. ``<mN>…</mN>`` is a run of text with
  a set of marks (bold, link...), ``<xN/>`` an inline thing that is never
  translated (inline code, a variable, a line break, a URL, LaTeX). Tags are
  numbered per segment.
* ``attr``: a textual node attribute (image alt text and captions, quiz
  questions, options and feedback, flashcard faces, scenario texts, toggle
  titles, video chapter titles...). Plain text.

Never translated: code blocks, math blocks, inline code, ``kbd`` text,
dynamic variables, URLs, ``{{variables}}`` and LaTeX. Comment marks are
dropped (a translation starts without comments).

Segment ids are positional (``s0``, ``s1``...) and only valid for the exact
source document they were read from; ``segments_hash`` identifies that text.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any, Iterator

MAX_DEPTH = 60

# Blocks whose text is never translated.
CODE_NODES = frozenset({"codeBlock", "blockMathEquation"})
# Marks whose text is kept verbatim.
VERBATIM_MARKS = frozenset({"code", "kbd"})
# Marks a translation never carries.
DROPPED_MARKS = frozenset({"comment", "aiStreaming", "aiSelectionHighlight"})
# Inline nodes kept verbatim (atoms).
INLINE_ATOMS = frozenset({"hardBreak", "dynamicVariable", "image", "mention", "inlineMath"})

# Textual attributes per node type. A path is dot separated; ``*`` walks a
# list. Strings found there are translated, anything else is left alone.
TEXT_ATTRS: dict[str, tuple[str, ...]] = {
    "blockImage": ("alt", "caption"),
    "blockVideo": ("caption", "chapters.*.title", "chapters.*.label"),
    "blockAudio": ("caption", "transcript"),
    "blockPDF": ("caption",),
    "blockEmbed": ("caption",),
    "blockWebPreview": ("customTitle", "customDescription", "buttonLabel"),
    "blockH5P": ("title",),
    "blockMagic": ("title",),
    "blockQuiz": (
        "questions.*.question",
        "questions.*.explanation",
        "questions.*.answers.*.answer",
        "questions.*.answers.*.feedback",
    ),
    "scenarios": ("title", "scenarios.*.text", "scenarios.*.options.*.text"),
    "flipcard": ("question", "answer"),
    "toggleBlock": ("summary",),
    "blockCode": ("description", "hints.*"),
    "conditionalBlock": ("hiddenMessage", "label"),
}
# Textual attributes of marks (kept on the translated run).
MARK_TEXT_ATTRS: dict[str, tuple[str, ...]] = {"definition": ("note",)}

# Spans of running text kept verbatim.
_PROTECTED = re.compile(
    r"(https?://[^\s<>\"]+|www\.[^\s<>\"]+|\{\{[^{}]{1,120}\}\}|\$\$[^$]{1,2000}\$\$|\$[^$\n]{1,500}\$|\\\(.{1,500}?\\\)|\\\[.{1,2000}?\\\])",
    re.S,
)
_URLISH = re.compile(r"^\s*(https?://|www\.|mailto:|/|#)\S*\s*$")
# Nothing to translate: digits, punctuation, symbols, whitespace.
_NO_WORDS = re.compile(r"^[\W\d_]*$", re.U)
_TAG = re.compile(r"<(/?)([mx])(\d+)(/?)>")


@dataclass
class Segment:
    id: str
    kind: str  # "text" | "attr"
    text: str
    node_type: str
    # text segments: mark sets and verbatim nodes by tag number
    marks: dict[int, list[dict]] = field(default_factory=dict)
    atoms: dict[int, Any] = field(default_factory=dict)
    # where it lives (internal): path of the node in the doc, attr path
    node_path: tuple[int, ...] = ()
    attr_path: tuple[Any, ...] = ()

    def public(self) -> dict[str, Any]:
        out: dict[str, Any] = {"id": self.id, "kind": self.kind, "text": self.text, "node_type": self.node_type}
        if self.kind == "text" and (self.marks or self.atoms):
            out["tags"] = "Keep every <mN>…</mN> and <xN/> tag (formatting and untranslatable parts)."
        return out


def _translatable(text: Any) -> bool:
    return isinstance(text, str) and bool(text.strip()) and not _NO_WORDS.match(text) and not _URLISH.match(text)


def _children(node: dict) -> list:
    content = node.get("content")
    return content if isinstance(content, list) else []


def _is_text_holder(node: dict) -> bool:
    """A block whose children are inline (text and inline atoms)."""
    kids = _children(node)
    if not kids:
        return False
    return all(isinstance(k, dict) and (k.get("type") == "text" or k.get("type") in INLINE_ATOMS) for k in kids)


def _clean_marks(marks: Any) -> list[dict]:
    if not isinstance(marks, list):
        return []
    return [m for m in marks if isinstance(m, dict) and m.get("type") not in DROPPED_MARKS]


def _marks_key(marks: list[dict]) -> str:
    return json.dumps(marks, sort_keys=True, ensure_ascii=False)


def _flatten_inline(kids: list) -> tuple[str, dict[int, list[dict]], dict[int, Any]]:
    """Inline content -> (markup, mark sets, verbatim nodes)."""
    parts: list[str] = []
    mark_ids: dict[str, int] = {}
    marks: dict[int, list[dict]] = {}
    atoms: dict[int, Any] = {}

    def atom(node: Any) -> str:
        n = len(atoms) + 1
        atoms[n] = node
        return f"<x{n}/>"

    for kid in kids:  # all dicts: see _is_text_holder
        if kid.get("type") != "text":
            parts.append(atom(kid))
            continue
        text = kid.get("text") or ""
        km = copy.deepcopy(_clean_marks(kid.get("marks")))
        if any(m.get("type") in VERBATIM_MARKS for m in km):
            parts.append(atom({**kid, "marks": km} if km else {k: v for k, v in kid.items() if k != "marks"}))
            continue
        # Protected spans inside the text become atoms carrying the run's marks.
        pieces: list[str] = []
        last = 0
        for match in _PROTECTED.finditer(text):
            if match.start() > last:
                pieces.append(_escape(text[last:match.start()]))
            node = {"type": "text", "text": match.group(0)}
            if km:
                node["marks"] = km
            pieces.append(atom(node))
            last = match.end()
        if last < len(text):
            pieces.append(_escape(text[last:]))
        body = "".join(pieces)
        if km:
            key = _marks_key(km)
            if key not in mark_ids:
                mark_ids[key] = len(mark_ids) + 1
                marks[mark_ids[key]] = km
            n = mark_ids[key]
            # atoms inside a marked run sit inside the tag: fine, they keep their own marks
            parts.append(f"<m{n}>{body}</m{n}>")
        else:
            parts.append(body)
    return "".join(parts), marks, atoms


def _escape(text: str) -> str:
    # Only "<" could be confused with a tag; keep it readable for a model.
    return text.replace("<", "‹") if _TAG.search(text) else text


def _plain(markup: str) -> str:
    return _TAG.sub("", markup)


def _walk_attr(value: Any, path: list[str], trail: tuple) -> Iterator[tuple[tuple, str]]:
    if not path:
        if isinstance(value, str):
            yield trail, value
        return
    head, rest = path[0], path[1:]
    if head == "*":
        if isinstance(value, list):
            for i, item in enumerate(value):
                yield from _walk_attr(item, rest, trail + (i,))
    elif isinstance(value, dict) and head in value:
        yield from _walk_attr(value[head], rest, trail + (head,))


def iter_segments(doc: Any) -> list[Segment]:
    """The translatable segments of a page, in document order."""
    out: list[Segment] = []
    if not isinstance(doc, dict):
        return out

    def add(**kw: Any) -> None:
        out.append(Segment(id=f"s{len(out)}", **kw))

    def visit(node: Any, path: tuple[int, ...], depth: int) -> None:
        if not isinstance(node, dict) or depth > MAX_DEPTH:
            return
        ntype = node.get("type") or ""
        if ntype in CODE_NODES:
            return
        attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
        for spec in TEXT_ATTRS.get(ntype, ()):
            for trail, value in _walk_attr(attrs, spec.split("."), ()):
                if _translatable(value):
                    add(kind="attr", text=value, node_type=ntype, node_path=path, attr_path=trail)
        if ntype != "doc" and _is_text_holder(node):
            markup, marks, atoms = _flatten_inline(_children(node))
            if _translatable(_plain(markup)):
                add(kind="text", text=markup, node_type=ntype, marks=marks, atoms=atoms, node_path=path)
            # Mark attributes (definition notes) inside the runs.
            for kid_i, kid in enumerate(_children(node)):
                for m_i, mark in enumerate(_clean_marks(kid.get("marks")) if isinstance(kid, dict) else []):
                    for attr in MARK_TEXT_ATTRS.get(mark.get("type") or "", ()):
                        value = (mark.get("attrs") or {}).get(attr)
                        if _translatable(value):
                            add(kind="attr", text=value, node_type=f"mark:{mark.get('type')}",
                                node_path=path, attr_path=("@mark", kid_i, mark.get("type"), attr))
            return
        for i, kid in enumerate(_children(node)):
            visit(kid, path + (i,), depth + 1)

    visit(doc, (), 0)
    return out


def extract_segments(doc: Any) -> list[dict[str, Any]]:
    """Public view of the segments (for MCP clients, Atlas, the editor)."""
    return [s.public() for s in iter_segments(doc)]


def segments_hash(doc: Any, extra: str = "") -> str:
    """Fingerprint of a page's translatable text (outdated detection)."""
    h = hashlib.sha256()
    for seg in iter_segments(doc):
        h.update(seg.kind.encode())
        h.update(b"\x00")
        h.update(_plain(seg.text).encode())
        h.update(b"\x01")
    h.update(extra.encode())
    return h.hexdigest()[:32]


def text_hash(*values: Any) -> str:
    """Fingerprint of plain fields (course name, description...)."""
    return hashlib.sha256(json.dumps(values, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()[:32]


# ─── writing back ────────────────────────────────────────────────────────────


def _unescape(text: str) -> str:
    return text.replace("‹", "<")


def parse_markup(markup: str, seg: Segment) -> tuple[list[dict], list[str]]:
    """Translated markup -> inline nodes. Returns (nodes, warnings).

    Tolerant: unknown or unbalanced tags are dropped (their text kept),
    verbatim nodes the translation lost are appended at the end so nothing
    untranslatable (a variable, a link target) disappears."""
    warnings: list[str] = []
    nodes: list[dict] = []
    stack: list[int] = []
    used_atoms: set[int] = set()
    pos = 0

    def push_text(text: str) -> None:
        if not text:
            return
        text = _unescape(text)
        node: dict[str, Any] = {"type": "text", "text": text}
        if stack:
            marks = seg.marks.get(stack[-1])
            if marks:
                node["marks"] = copy.deepcopy(marks)
        if nodes and nodes[-1].get("type") == "text" and nodes[-1].get("marks") == node.get("marks"):
            nodes[-1]["text"] += text
        else:
            nodes.append(node)

    for match in _TAG.finditer(markup):
        push_text(markup[pos:match.start()])
        pos = match.end()
        closing, kind, num_s, selfclose = match.groups()
        num = int(num_s)
        if kind == "x":
            atom = seg.atoms.get(num)
            if atom is None or num in used_atoms:
                warnings.append(f"unknown_or_repeated_tag:x{num}")
                continue
            used_atoms.add(num)
            nodes.append(copy.deepcopy(atom))
            continue
        if num not in seg.marks:
            warnings.append(f"unknown_tag:m{num}")
            continue
        if closing:
            if stack and stack[-1] == num:
                stack.pop()
            else:
                warnings.append(f"unbalanced_tag:m{num}")
        elif not selfclose:
            stack.append(num)
    push_text(markup[pos:])
    if stack:
        warnings.append("unclosed_tags")
    for num, atom in seg.atoms.items():
        if num not in used_atoms:
            warnings.append(f"missing_tag:x{num}")
            nodes.append(copy.deepcopy(atom))
    return [n for n in nodes if n.get("type") != "text" or n.get("text")], warnings


def _node_at(doc: dict, path: tuple[int, ...]) -> dict:
    node = doc
    for i in path:
        node = node["content"][i]
    return node


def _set_attr(attrs: dict, trail: tuple, value: str) -> None:
    target: Any = attrs
    for key in trail[:-1]:
        target = target[key]
    target[trail[-1]] = value


def strip_dropped_marks(doc: Any, depth: int = 0) -> Any:
    """A copy-safe pass removing comment and AI marks everywhere."""
    if depth > MAX_DEPTH or not isinstance(doc, dict):
        return doc
    if isinstance(doc.get("marks"), list):
        kept = _clean_marks(doc["marks"])
        if kept:
            doc["marks"] = kept
        else:
            doc.pop("marks", None)
    for kid in _children(doc):
        strip_dropped_marks(kid, depth + 1)
    return doc


def apply_segments(source: Any, translations: dict[str, str]) -> tuple[dict, dict[str, Any]]:
    """A translated copy of ``source``: segments found in ``translations``
    replace the source text, the rest stays in the source language.

    Returns (document, report) where report has applied/missing counts and
    per-segment warnings."""
    doc = strip_dropped_marks(copy.deepcopy(source if isinstance(source, dict) else {"type": "doc", "content": []}))
    segments = iter_segments(source)
    applied = 0
    missing: list[str] = []
    warnings: dict[str, list[str]] = {}
    # Text segments replace a node's children; do them after attributes of the
    # same node (mark attrs address children by index, so apply those first).
    ordered = sorted(segments, key=lambda s: (s.kind == "text",))
    for seg in ordered:
        value = translations.get(seg.id)
        if not isinstance(value, str) or not value.strip():
            missing.append(seg.id)
            continue
        node = _node_at(doc, seg.node_path)
        if seg.kind == "attr":
            if seg.attr_path and seg.attr_path[0] == "@mark":
                _, kid_i, mark_type, attr = seg.attr_path
                kid = _children(node)[kid_i]
                for mark in kid.get("marks") or []:
                    if mark.get("type") == mark_type:
                        mark.setdefault("attrs", {})[attr] = value
                # keep the note on the copy of the mark sets used by text segments
                for marks in seg_marks_for(segments, seg.node_path):
                    for mark in marks:
                        if mark.get("type") == mark_type and (mark.get("attrs") or {}).get(attr) == seg.text:
                            mark.setdefault("attrs", {})[attr] = value
            else:
                _set_attr(node.setdefault("attrs", {}), seg.attr_path, value)
            applied += 1
            continue
        nodes, warns = parse_markup(value, seg)
        if not nodes:
            missing.append(seg.id)
            continue
        node["content"] = nodes
        if warns:
            warnings[seg.id] = warns
        applied += 1
    return doc, {"segments": len(segments), "applied": applied, "missing": missing, "warnings": warnings}


def seg_marks_for(segments: list[Segment], path: tuple[int, ...]) -> list[list[dict]]:
    for seg in segments:
        if seg.kind == "text" and seg.node_path == path:
            return list(seg.marks.values())
    return []


def current_translations(source: Any, translated: Any) -> dict[str, str]:
    """Segment texts of an existing translation, aligned on the source's
    segments by position when both documents still share their structure.
    Used to keep good translations when only some segments changed."""
    src = iter_segments(source)
    dst = iter_segments(translated)
    out: dict[str, str] = {}
    if len(src) != len(dst):
        return out
    for a, b in zip(src, dst):
        if a.kind != b.kind or a.node_type != b.node_type or a.node_path != b.node_path or a.attr_path != b.attr_path:
            continue
        if a.kind == "attr":
            out[a.id] = b.text
            continue
        # Renumber the translation's tags to the source's (same marks, same
        # verbatim nodes); a tag with no counterpart is dropped.
        mark_of = {_marks_key(m): n for n, m in a.marks.items()}
        atom_of = {json.dumps(v, sort_keys=True, ensure_ascii=False): n for n, v in a.atoms.items()}
        mmap = {n: mark_of.get(_marks_key(m)) for n, m in b.marks.items()}
        xmap = {n: atom_of.get(json.dumps(v, sort_keys=True, ensure_ascii=False)) for n, v in b.atoms.items()}

        def renumber(match: re.Match) -> str:
            closing, kind, num_s, selfclose = match.groups()
            new = (mmap if kind == "m" else xmap).get(int(num_s))
            return f"<{closing}{kind}{new}{selfclose}>" if new else ""

        out[a.id] = _TAG.sub(renumber, b.text)
    return out


def translation_report_ok(report: dict[str, Any]) -> bool:
    return not report.get("missing") and not report.get("warnings")
