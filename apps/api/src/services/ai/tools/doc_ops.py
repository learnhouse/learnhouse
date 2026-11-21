"""Pure operations on a page document (TipTap / ProseMirror JSON).

A page is ``{"type": "doc", "content": [ ...blocks... ]}``. A block is named
by its ``path``: ``[i]`` is the i-th top-level block, ``[i, j]`` the j-th
child of block i (an item of a list, a paragraph of a callout, a row of a
table, ...). Paths are positional and stable for one version of a page.

`SCHEMA` mirrors the web editor's node definitions
(apps/web/components/Objects/Editor/Editor.tsx and its Extensions/, plus the
TipTap StarterKit, table and YouTube extensions). Two levels of checking:

* `loadable_problems`: what makes the editor throw away the whole page when it
  loads it (an unknown node or mark type, an empty or missing text). Run on
  every document that gets written.
* `strict_problems`: the full schema (content models, known attributes and
  their values). Run on everything a tool creates or changes, so new content
  is always well formed while older pages with quirks stay editable.

Nothing here touches the database; the tools in content_edit.py load a page,
apply these functions to a copy and write the result back once.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Iterator

from src.services.courses.activities import experiences as exp

MAX_DEPTH = 40
MAX_DOC_CHARS = 2_000_000
CALLOUT_TYPES = ("info", "warning", "tip", "success", "error")
# Newer callout looks, stored in `kind` with the closest legacy `type`.
CALLOUT_KINDS = {"note": "info", "question": "info", "example": "tip", "quote": "info"}
# Colour names shared with the editor's text colour palette.
PALETTE = ("gray", "red", "orange", "amber", "green", "teal", "blue", "purple", "pink")
# Tones of timeline steps, key takeaways and stats.
LAYOUT_TONES = ("neutral", "blue", "teal", "green", "amber", "rose")
LAYOUT_ICONS = ("lightbulb", "star", "check", "target", "flag", "book", "rocket", "key")
CHART_TYPES = ("bar", "column", "line", "area", "pie", "donut")
CHART_TONES = ("blue", "orange", "teal", "amber", "pink", "green", "violet", "red")
CELL_TYPES = ("text", "progress", "checkbox", "rating", "status", "number", "date")
FILE_TYPES = ("pdf", "doc", "sheet", "slides", "archive", "image", "audio", "video", "text", "code", "file")
QUESTION_TYPES = ("multiple_choice", "true_false", "short_answer", "numeric")


class PathError(ValueError):
    """A path that does not name a block of the page."""


class DocError(ValueError):
    """A document or node the editor would not accept."""


# ─── schema ──────────────────────────────────────────────────────────────────

BLOCK = "block"
INLINE = "inline"


@dataclass(frozen=True)
class Spec:
    group: str                    # "block", "inline" or "" (only inside a parent)
    content: str | None           # content expression; None for a leaf
    attrs: tuple[str, ...] = ()
    marks: bool = True            # inline children may carry marks
    authorable: bool = True       # tools may create it from raw JSON
    why_not: str = ""             # what to use instead when not authorable


TABLE_ATTRS = ("variant", "caption", "headerColumn", "stickyHeader", "sortable", "compact", "totals")
CELL_ATTRS = ("cellType", "background", "align", "valign", "tone", "numberFormat", "currency")

_MEDIA = "Add media with add_media_block (it uploads the file and inserts the block)."

SCHEMA: dict[str, Spec] = {
    "doc": Spec("", "block+"),
    "text": Spec(INLINE, None),
    "hardBreak": Spec(INLINE, None),
    # textAlign: start | center | end | justify; null (the default) is the old look.
    "paragraph": Spec(BLOCK, "inline*", ("textAlign",)),
    "heading": Spec(BLOCK, "inline*", ("level", "textAlign")),
    "blockquote": Spec(BLOCK, "block+"),
    "bulletList": Spec(BLOCK, "listItem+"),
    "orderedList": Spec(BLOCK, "listItem+", ("start", "type")),
    "listItem": Spec("", "paragraph block*"),
    "codeBlock": Spec(
        BLOCK, "text*", ("language", "filename", "showLineNumbers", "highlightLines", "wrap"), marks=False,
    ),
    "horizontalRule": Spec(BLOCK, None, ("variant",)),
    # Table options and typed cells (Editor Plus). A typed cell keeps its value
    # in its own text ("75" for a progress bar), so every attr is optional.
    "table": Spec(BLOCK, "tableRow+", TABLE_ATTRS),
    "tableRow": Spec("", "(tableCell | tableHeader)*"),
    "tableCell": Spec("", "block+", ("colspan", "rowspan", "colwidth") + CELL_ATTRS),
    "tableHeader": Spec("", "block+", ("colspan", "rowspan", "colwidth") + CELL_ATTRS),
    # `type` stays one of CALLOUT_TYPES (older renderers crash on anything
    # else); the newer looks live in `kind` (see callout_kind_attrs).
    "callout": Spec(
        BLOCK, "(paragraph | bulletList | orderedList)+",
        ("type", "dismissible", "icon", "title", "collapsible", "defaultOpen", "tone", "kind"),
    ),
    # Collapsible section from the editor's block menu.
    "toggleBlock": Spec(BLOCK, "block+", ("summary", "defaultOpen", "variant", "icon")),
    # Blocks shown only to readers matching `rules` (Extensions/Dynamic); the
    # API drops them for everyone else (dynamic_content.py).
    "conditionalBlock": Spec(BLOCK, "block+", ("rules", "hiddenMessage", "label", "openRules")),
    # Inline placeholder ({{user.first_name}}) the API fills per reader.
    "dynamicVariable": Spec(INLINE, None, ("path", "fallback", "format")),
    "calloutInfo": Spec(BLOCK, "text*", authorable=False, why_not="Use a callout with type 'info'."),
    "calloutWarning": Spec(BLOCK, "text*", authorable=False, why_not="Use a callout with type 'warning'."),
    "badge": Spec(BLOCK, "text*", ("color", "emoji")),
    "button": Spec(BLOCK, "text*", ("emoji", "link", "color", "alignment", "variant", "size")),
    # A row of buttons.
    "buttonGroup": Spec(BLOCK, "button+", ("alignment",)),
    # Inline formula (KaTeX), written $...$ in Markdown.
    "inlineMath": Spec(INLINE, None, ("latex",)),
    # Layout blocks (Editor Plus): their text is ordinary content inside them.
    "tabs": Spec(BLOCK, "tabItem{2,8}", ("blockId", "variant")),
    "tabItem": Spec("", "block+", ("title", "icon")),
    "columns": Spec(BLOCK, "column{2,4}", ("layout", "gap", "stackOnMobile", "verticalAlign")),
    "column": Spec("", "block+"),
    "accordion": Spec(BLOCK, "toggleBlock+", ("single", "variant")),
    "timeline": Spec(BLOCK, "timelineItem+", ("variant", "numbered", "orientation")),
    "timelineItem": Spec("", "block+", ("title", "label", "icon", "tone")),
    "tableOfContents": Spec(BLOCK, None, ("title", "maxLevel", "numbered")),
    "keyTakeaways": Spec(BLOCK, "block+", ("title", "tone", "icon")),
    # Checklist (TipTap's task list): learners may tick items.
    "taskList": Spec(BLOCK, "taskItem+", ("blockId", "learnerCanCheck")),
    "taskItem": Spec("", "paragraph+", ("checked",)),
    # Media and data blocks (Editor Plus). Linked pictures and files use `url`;
    # an uploaded one keeps the `blockObject` the editor stored.
    "gallery": Spec(BLOCK, None, ("blockId", "layout", "columns", "images")),
    "imageCompare": Spec(BLOCK, None, ("before", "after", "start", "orientation")),
    "chart": Spec(BLOCK, None, ("type", "title", "data", "showLegend", "showValues", "stacked")),
    "statHighlights": Spec(BLOCK, None, ("items", "columns", "animate")),
    "fileCard": Spec(BLOCK, None, ("blockObject", "url", "name", "description", "sizeBytes", "fileType")),
    "quoteBlock": Spec(BLOCK, "paragraph+", ("variant", "author", "role", "avatarUrl")),
    "flipcard": Spec(BLOCK, "text*", ("question", "answer", "color", "alignment", "size", "style")),
    # mode/title/shuffle: the Experiences flashcards (study mode); absent = the classic grid.
    "flipcardGrid": Spec(BLOCK, "flipcard+", ("columns", "mode", "title", "shuffle")),
    "youtube": Spec(
        BLOCK, None, ("src", "start", "width", "height"),
        authorable=False, why_not="Use a blockEmbed with an embed URL.",
    ),
    "blockEmbed": Spec(
        BLOCK, None,
        ("embedUrl", "embedCode", "embedType", "embedHeight", "embedAspectRatio", "embedWidth", "alignment",
         "embedSourceUrl", "embedProvider", "caption"),
    ),
    "blockWebPreview": Spec(
        BLOCK, None,
        ("url", "title", "description", "og_image", "favicon", "og_type", "og_url",
         "alignment", "buttonLabel", "showButton", "openInPopup", "layout", "customTitle", "customDescription"),
    ),
    "blockMathEquation": Spec(BLOCK, None, ("math_equation",)),
    # settings: shuffle / attempts / reveal options from the editor (null = defaults).
    "blockQuiz": Spec(BLOCK, None, ("quizId", "questions", "settings")),
    "scenarios": Spec(BLOCK, None, ("title", "scenarios", "currentScenarioId", "display")),
    # Experiences (Extensions/Experiences): interactive learning blocks whose
    # data lives in attrs; blockId keys a learner's saved progress.
    "expSort": Spec(BLOCK, None, ("blockId", "title", "instructions", "categories", "items", "shuffle")),
    "expSequence": Spec(BLOCK, None, ("blockId", "title", "instructions", "items", "variant")),
    "expMatch": Spec(BLOCK, None, ("blockId", "title", "instructions", "pairs", "mode")),
    # imageObject: the uploaded file's server object (like blockImage's
    # blockObject); imageUrl is kept in sync with it.
    "expHotspot": Spec(BLOCK, None, ("blockId", "title", "instructions", "imageUrl", "imageObject", "spots", "mode")),
    "expGaps": Spec(BLOCK, None, ("blockId", "title", "text", "mode", "caseSensitive")),
    "expMythFact": Spec(BLOCK, None, ("blockId", "title", "statements", "labels")),
    "expSpeedRound": Spec(BLOCK, None, ("blockId", "title", "questions", "secondsPerQuestion", "lives")),
    "expEstimate": Spec(
        BLOCK, None,
        ("blockId", "question", "min", "max", "step", "answer", "unit", "tolerancePct", "explanation"),
    ),
    "expSpotMistake": Spec(BLOCK, None, ("blockId", "title", "instructions", "segments", "kind")),
    "expCodeLock": Spec(BLOCK, None, ("blockId", "title", "story", "clues", "reward")),
    "expVenn": Spec(BLOCK, None, ("blockId", "title", "instructions", "sets", "items", "showNeither")),
    # imageObject / imageUrl: as on expHotspot.
    "expLabel": Spec(BLOCK, None, ("blockId", "title", "instructions", "imageUrl", "imageObject", "pins", "distractors")),
    "expWordGuess": Spec(BLOCK, None, ("blockId", "title", "words", "maxGuesses")),
    "expConfidence": Spec(BLOCK, None, ("blockId", "title", "questions")),
    # cells: the correct ticks as {"rowId:colId": true}.
    "expMatrix": Spec(BLOCK, None, ("blockId", "title", "instructions", "rows", "columns", "cells", "mode")),
    "expReflect": Spec(
        BLOCK, None, ("blockId", "title", "prompt", "guidingQuestions", "minWords", "modelAnswer", "checklist"),
    ),
    "blockCode": Spec(
        BLOCK, None,
        ("mode", "languageId", "languageName", "starterCode", "testCases", "description",
         "hints", "difficulty", "solutionCode", "maxAttemptsBeforeReveal", "timeComplexity",
         "spaceComplexity", "timeLimitMs", "sqliteDbPath", "sqliteDbName", "timedMode",
         "timedDurationMs", "additionalFiles", "blockUuid"),
    ),
    "blockMagic": Spec(BLOCK, None, ("blockUuid", "sessionUuid", "htmlContent", "title", "height")),
    "blockH5P": Spec(BLOCK, None, ("h5pUrl", "height", "title", "sizeMode")),
    "blockImage": Spec(
        BLOCK, None,
        ("blockObject", "size", "alignment", "unsplash_url", "unsplash_photographer_name",
         "unsplash_photographer_url", "unsplash_photo_url", "alt", "caption", "href", "lightbox", "frame"),
        authorable=False, why_not=_MEDIA,
    ),
    "blockVideo": Spec(BLOCK, None, ("blockObject", "caption", "startTime", "chapters"), authorable=False, why_not=_MEDIA),
    "blockAudio": Spec(BLOCK, None, ("blockObject", "caption", "transcript"), authorable=False, why_not=_MEDIA),
    "blockPDF": Spec(BLOCK, None, ("blockObject", "pdfHeight", "caption"), authorable=False, why_not=_MEDIA),
    "blockUser": Spec(
        BLOCK, None, ("user_id", "layout"), authorable=False,
        why_not="Member cards are added in the editor.",
    ),
    "blockLibrary": Spec(
        BLOCK, None, ("resourceUuid", "resourceType", "snapshot", "display"),
        authorable=False, why_not="Library references are added in the editor.",
    ),
}

MARKS: dict[str, tuple[str, ...]] = {
    "bold": (),
    "italic": (),
    "strike": (),
    "underline": (),
    "code": (),
    "link": ("href", "target", "rel", "class", "title"),
    "aiStreaming": (),
    # Editor comment anchors: kept on text the agent leaves alone, never written by it.
    "comment": ("threadId",),
    # Styling from the editor's selection menu: loaded and kept, never written by tools.
    "superscript": (),
    "subscript": (),
    "textColor": ("color",),
    "highlight": ("color", "style"),
    "textEffect": ("effect",),
    "kbd": (),
    "spoiler": (),
    "definition": ("note",),
}
_AUTHORABLE_MARKS = {"bold", "italic", "strike", "underline", "code", "link"}

BLOCK_TYPES = frozenset(n for n, s in SCHEMA.items() if s.group == BLOCK)
INLINE_TYPES = frozenset(n for n, s in SCHEMA.items() if s.group == INLINE)
TEXT_HOLDERS = frozenset(n for n, s in SCHEMA.items() if s.content in ("inline*", "text*"))
LEAVES = frozenset(n for n, s in SCHEMA.items() if s.content is None and s.group == BLOCK)
CONTAINERS = frozenset(
    n for n, s in SCHEMA.items() if s.content is not None and n not in TEXT_HOLDERS and n != "doc"
)
MEDIA_TYPES = ("blockImage", "blockVideo", "blockAudio", "blockPDF")

# (allowed first child, allowed other children, minimum count)
_MODELS: dict[str, tuple[frozenset | None, frozenset, int]] = {
    "block+": (None, BLOCK_TYPES, 1),
    "inline*": (None, INLINE_TYPES, 0),
    "text*": (None, frozenset({"text"}), 0),
    "listItem+": (None, frozenset({"listItem"}), 1),
    "paragraph block*": (frozenset({"paragraph"}), BLOCK_TYPES, 1),
    "tableRow+": (None, frozenset({"tableRow"}), 1),
    "(tableCell | tableHeader)*": (None, frozenset({"tableCell", "tableHeader"}), 0),
    "(paragraph | bulletList | orderedList)+": (
        None, frozenset({"paragraph", "bulletList", "orderedList"}), 1,
    ),
    "flipcard+": (None, frozenset({"flipcard"}), 1),
    "button+": (None, frozenset({"button"}), 1),
    "tabItem{2,8}": (None, frozenset({"tabItem"}), 2),
    "column{2,4}": (None, frozenset({"column"}), 2),
    "toggleBlock+": (None, frozenset({"toggleBlock"}), 1),
    "timelineItem+": (None, frozenset({"timelineItem"}), 1),
    "taskItem+": (None, frozenset({"taskItem"}), 1),
    "paragraph+": (None, frozenset({"paragraph"}), 1),
}
# Content models with an upper bound.
_MAX_CHILDREN: dict[str, int] = {"tabItem{2,8}": 8, "column{2,4}": 4}


def kind(node: Any) -> str:
    return node.get("type", "?") if isinstance(node, dict) else "?"


def children(node: Any) -> list:
    kids = node.get("content") if isinstance(node, dict) else None
    return kids if isinstance(kids, list) else []


def ensure_doc(content: Any) -> dict:
    """Stored content as a doc envelope (an empty page when it is not one)."""
    if isinstance(content, dict) and content.get("type") == "doc":
        if not isinstance(content.get("content"), list):
            content = {**content, "content": []}
        return content
    return {"type": "doc", "content": []}


def normalize_legacy(doc: dict) -> dict:
    """Rewrite old shapes the editor converts on load, in place.

    Callouts used to hold text directly; the editor wraps runs of inline
    nodes in paragraphs before showing them (calloutContent.ts), so a page
    saved from the editor looks the same."""
    stack = [doc]
    while stack:
        node = stack.pop()
        if not isinstance(node, dict):
            continue
        kids = node.get("content")
        if not isinstance(kids, list):
            continue
        if node.get("type") == "callout":
            fixed: list = []
            run: list = []
            for child in kids:
                if not isinstance(child, dict):
                    continue
                if child.get("type") in ("paragraph", "bulletList", "orderedList"):
                    if run:
                        fixed.append({"type": "paragraph", "content": run})
                        run = []
                    fixed.append(child)
                else:
                    run.append(child)
            if run:
                fixed.append({"type": "paragraph", "content": run})
            node["content"] = kids = fixed or [{"type": "paragraph"}]
        stack.extend(kids)
    return doc


# ─── checks ──────────────────────────────────────────────────────────────────


def _where(path: tuple) -> str:
    return "the page" if not path else f"[{', '.join(str(i) for i in path)}]"


def loadable_problems(doc: Any, limit: int = 5) -> list[str]:
    """What would make the editor discard the page on load (it replaces a
    document it cannot parse with an empty one). Iterative: safe on any depth."""
    if not isinstance(doc, dict) or doc.get("type") != "doc" or not isinstance(doc.get("content"), list):
        return ['A page must be {"type": "doc", "content": [ ...blocks... ]}.']
    problems: list[str] = []
    stack: list[tuple[Any, tuple]] = [(n, (i,)) for i, n in enumerate(doc["content"])]
    while stack and len(problems) < limit:
        node, path = stack.pop()
        if len(path) > MAX_DEPTH * 2:
            problems.append(f"Content nested deeper than {MAX_DEPTH * 2} levels at {_where(path[:3])}...")
            break
        if not isinstance(node, dict):
            problems.append(f"Block {_where(path)} is not an object.")
            continue
        t = node.get("type")
        if not isinstance(t, str) or t not in SCHEMA or t == "doc":
            problems.append(f"Unknown block type {t!r} at {_where(path)}.")
            continue
        marks = node.get("marks")
        if marks is not None:
            if not isinstance(marks, list):
                problems.append(f"marks at {_where(path)} must be a list.")
            else:
                for m in marks:
                    if not isinstance(m, dict) or m.get("type") not in MARKS:
                        problems.append(f"Unknown mark {kind(m)!r} at {_where(path)}.")
                        break
        if t == "text":
            if not isinstance(node.get("text"), str) or not node["text"]:
                problems.append(f"Empty or missing text at {_where(path)} (text nodes need non-empty text).")
            continue
        attrs = node.get("attrs")
        if attrs is not None and not isinstance(attrs, dict):
            problems.append(f"attrs at {_where(path)} must be an object.")
        kids = node.get("content")
        if kids is None:
            continue
        if not isinstance(kids, list):
            problems.append(f"content at {_where(path)} must be a list.")
            continue
        stack.extend((c, path + (j,)) for j, c in enumerate(kids))
    return problems


def check_loadable(doc: Any) -> None:
    problems = loadable_problems(doc)
    if problems:
        raise DocError(" ".join(problems))
    size = len(json.dumps(doc, separators=(",", ":"), ensure_ascii=False))
    if size > MAX_DOC_CHARS:
        raise DocError(f"The page would be {size} characters of JSON; the limit is {MAX_DOC_CHARS}.")


def content_problem(node: dict, path: tuple = ()) -> str | None:
    """Whether the node's direct children fit its content model."""
    spec = SCHEMA.get(kind(node))
    if spec is None:
        return f"Unknown block type {kind(node)!r} at {_where(path)}."
    kids = node.get("content")
    if spec.content is None:
        if kids:
            return f"A {kind(node)} at {_where(path)} holds no content; its data lives in attrs."
        return None
    first, rest, minimum = _MODELS[spec.content]
    kids = kids if isinstance(kids, list) else []
    if len(kids) < minimum:
        if first:
            need = "a paragraph first"
        elif minimum > 1:
            need = f"at least {minimum} of {_names(rest)}"
        else:
            need = f"at least one of {_names(rest)}"
        return f"A {kind(node)} at {_where(path)} needs {need}."
    most = _MAX_CHILDREN.get(spec.content)
    if most is not None and len(kids) > most:
        return f"A {kind(node)} at {_where(path)} holds at most {most} of {_names(rest)}."
    for i, child in enumerate(kids):
        allowed = first if (i == 0 and first is not None) else rest
        if kind(child) not in allowed:
            return (
                f"A {kind(node)} at {_where(path)} cannot hold a {kind(child)} "
                f"(child {i}); it holds {_names(allowed)}."
            )
    return None


def _names(types: frozenset) -> str:
    if types == BLOCK_TYPES:
        return "blocks"
    if types == INLINE_TYPES:
        return "text"
    return " or ".join(sorted(types))


def strict_problems(node: Any, path: tuple = (), *, authoring: bool = True, limit: int = 5) -> list[str]:
    """Full schema check of a node and everything inside it."""
    problems: list[str] = []
    stack: list[tuple[Any, tuple, int]] = [(node, path, 0)]
    while stack and len(problems) < limit:
        current, where, depth = stack.pop()
        if depth > MAX_DEPTH:
            problems.append(f"Content nested deeper than {MAX_DEPTH} levels at {_where(where)}.")
            break
        if not isinstance(current, dict):
            problems.append(f"Block {_where(where)} is not an object.")
            continue
        t = current.get("type")
        spec = SCHEMA.get(t) if isinstance(t, str) else None
        if spec is None or (t == "doc" and depth > 0):
            problems.append(f"Unknown block type {t!r} at {_where(where)}.")
            continue
        if authoring and not spec.authorable:
            problems.append(f"{t} blocks cannot be written here. {spec.why_not}")
            continue
        unknown = [k for k in current if k not in ("type", "attrs", "content", "marks", "text")]
        if unknown:
            problems.append(f"Unexpected keys {unknown} on the {t} at {_where(where)}.")
        if t == "text":
            text = current.get("text")
            if not isinstance(text, str) or not text:
                problems.append(f"Empty or missing text at {_where(where)}.")
            problems.extend(_marks_problems(current.get("marks"), where, authoring))
            continue
        if current.get("marks"):
            problems.append(f"Only text carries marks ({t} at {_where(where)}).")
        problems.extend(attrs_problems(t, current.get("attrs"), where))
        problem = content_problem(current, where)
        if problem:
            problems.append(problem)
            continue
        kids = children(current)
        if not spec.marks:
            for j, child in enumerate(kids):
                if isinstance(child, dict) and child.get("marks"):
                    problems.append(f"Text in a {t} cannot be formatted ({_where(where + (j,))}).")
                    break
        stack.extend((c, where + (j,), depth + 1) for j, c in enumerate(kids))
    return problems[:limit]


def _marks_problems(marks: Any, where: tuple, authoring: bool) -> list[str]:
    if marks is None:
        return []
    if not isinstance(marks, list):
        return [f"marks at {_where(where)} must be a list."]
    out = []
    seen = set()
    for m in marks:
        t = kind(m)
        if t not in MARKS or (authoring and t not in _AUTHORABLE_MARKS):
            out.append(f"Unknown mark {t!r} at {_where(where)}; use bold, italic, strike, underline, code or link.")
            continue
        if t in seen:
            out.append(f"Mark {t} repeated at {_where(where)}.")
        seen.add(t)
        attrs = m.get("attrs") or {}
        if not isinstance(attrs, dict):
            out.append(f"Mark attrs at {_where(where)} must be an object.")
            continue
        extra = [k for k in attrs if k not in MARKS[t]]
        if extra:
            out.append(f"Mark {t} has no attribute {extra[0]!r}.")
        if t == "link" and not is_web_url(attrs.get("href")):
            out.append(f"Links need an http(s) href ({_where(where)}).")
        if t == "link" and authoring:
            # The editor supplies its own rel; a tool may not style a link or
            # point it at a named window.
            if attrs.get("class") is not None or attrs.get("rel") is not None:
                out.append(f"Links cannot set class or rel ({_where(where)}).")
            if attrs.get("target") not in (None, "_blank"):
                out.append(f'A link target can only be "_blank" ({_where(where)}).')
    if "code" in seen and len(seen) > 1:
        out.append(f"Code text cannot carry other marks ({_where(where)}).")
    return out


def check_new(node: Any, path: tuple = ()) -> None:
    problems = strict_problems(node, path)
    if problems:
        raise DocError(" ".join(problems))


# ─── attribute values ────────────────────────────────────────────────────────

_URL = re.compile(r"^https?://[^\s<>\"']{1,2040}$", re.I)


def is_web_url(value: Any) -> bool:
    return isinstance(value, str) and bool(_URL.match(value))


def _str(limit: int, *, null: bool = True, empty: bool = True) -> Callable[[Any], str | None]:
    def check(v: Any) -> str | None:
        if v is None:
            return None if null else "must be text"
        if not isinstance(v, str):
            return "must be text"
        if len(v) > limit:
            return f"must be at most {limit} characters"
        if not empty and not v.strip():
            return "must not be empty"
        return None

    return check


def _int(lo: int, hi: int, *, null: bool = False) -> Callable[[Any], str | None]:
    def check(v: Any) -> str | None:
        if v is None and null:
            return None
        if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
            return f"must be a whole number from {lo} to {hi}"
        return None

    return check


def _one_of(*values: Any) -> Callable[[Any], str | None]:
    return lambda v: None if v in values else f"must be one of {', '.join(map(repr, values))}"


def _bool(v: Any) -> str | None:
    return None if isinstance(v, bool) else "must be true or false"


def _url(*, null: bool = True, empty: bool = False) -> Callable[[Any], str | None]:
    def check(v: Any) -> str | None:
        if v is None and null:
            return None
        if v == "" and empty:
            return None
        return None if is_web_url(v) else "must be an http(s) URL"

    return check


def _language(v: Any) -> str | None:
    if v is None:
        return None
    if not isinstance(v, str) or not re.fullmatch(r"[\w+#.\-]{1,40}", v):
        return "must be a short language name like python or js"
    return None


def _quiz_questions(v: Any) -> str | None:
    if not isinstance(v, list) or not 1 <= len(v) <= 50:
        return "must be a list of 1 to 50 questions"
    ids: set = set()
    for i, q in enumerate(v):
        if not isinstance(q, dict):
            return f"question {i} must be an object"
        text = q.get("question")
        if not isinstance(text, str) or not text.strip() or len(text) > 2000:
            return f"question {i} needs question text (up to 2000 characters)"
        # A missing or unknown type is multiple choice, as in the editor.
        qtype = q.get("type")
        answers = q.get("answers")
        if qtype in ("short_answer", "numeric"):
            problem = _typed_question(q, i, qtype)
            if problem:
                return problem
        elif not isinstance(answers, list) or not 2 <= len(answers) <= 12:
            return f"question {i} needs 2 to 12 answers"
        elif qtype == "true_false" and len(answers) != 2:
            return f"question {i} (true_false) needs exactly 2 answers, True then False"
        elif not any(isinstance(a, dict) and a.get("correct") is True for a in answers):
            return f"question {i} needs at least one correct answer"
        qid = q.get("question_id")
        if not isinstance(qid, str) or not qid or qid in ids:
            return f"question {i} needs a unique question_id"
        ids.add(qid)
        for j, a in enumerate(answers or []):
            if not isinstance(a, dict):
                return f"question {i} answer {j} must be an object"
            if not isinstance(a.get("answer"), str) or not a["answer"].strip() or len(a["answer"]) > 1000:
                return f"question {i} answer {j} needs text (up to 1000 characters)"
            if not isinstance(a.get("correct"), bool):
                return f"question {i} answer {j} needs correct: true or false"
            aid = a.get("answer_id")
            if not isinstance(aid, str) or not aid or aid in ids:
                return f"question {i} answer {j} needs a unique answer_id"
            ids.add(aid)
        if q.get("response_type") not in (None, "single", "multiple"):
            return f"question {i} response_type must be single or multiple"
    return None


def _typed_question(q: dict, i: int, qtype: str) -> str | None:
    """A short-answer or numeric question: no options, an answer key instead."""
    if q.get("answers") not in (None, []):
        return f"question {i} ({qtype}) has no options; leave answers empty"
    if qtype == "short_answer":
        accepted = q.get("accepted_answers")
        if (
            not isinstance(accepted, list) or not 1 <= len(accepted) <= 10
            or not all(isinstance(a, str) and a.strip() and len(a) <= 500 for a in accepted)
        ):
            return f"question {i} (short_answer) needs 1 to 10 accepted_answers"
        if q.get("accent_insensitive") not in (None, True, False):
            return f"question {i} accent_insensitive must be true or false"
        return None
    if _num(-1e15, 1e15, null=False)(q.get("correct_value")):
        return f"question {i} (numeric) needs a correct_value number"
    if _num(0, 1e15)(q.get("tolerance")):
        return f"question {i} tolerance must be a number of 0 or more"
    return None


def _scenarios(v: Any) -> str | None:
    if not isinstance(v, list) or not 1 <= len(v) <= 100:
        return "must be a list of 1 to 100 scenario steps"
    ids = {s.get("id") for s in v if isinstance(s, dict)}
    for i, s in enumerate(v):
        if not isinstance(s, dict) or not isinstance(s.get("id"), str) or not isinstance(s.get("text"), str):
            return f"step {i} needs a string id and text"
        if s.get("imageUrl") not in (None, "") and not is_web_url(s.get("imageUrl")):
            return f"step {i} imageUrl must be an http(s) URL"
        options = s.get("options")
        if not isinstance(options, list):
            return f"step {i} needs an options list"
        for o in options:
            if not isinstance(o, dict) or not isinstance(o.get("text"), str):
                return f"step {i} has an option without text"
            nxt = o.get("nextScenarioId")
            if nxt is not None and nxt not in ids:
                return f"step {i} option points at unknown step {nxt!r}"
    if len(ids) != len(v):
        return "step ids must be unique"
    return _scenario_extras(v)


_OUTCOMES = (None, "success", "neutral", "fail")


def _scenario_extras(v: list) -> str | None:
    """The optional Experiences fields of scenario steps and options
    (ending, feedback, outcome); absent on older scenarios."""
    for i, s in enumerate(v):
        ending = s.get("ending")
        if ending is not None:
            if not isinstance(ending, dict) or ending.get("tone", "neutral") not in _OUTCOMES[1:]:
                return f"step {i} ending must be {{tone: success|neutral|fail, title}}"
            problem = _str(200)(ending.get("title"))
            if problem:
                return f"step {i} ending title {problem}"
        for o in s["options"]:
            problem = _str(2000)(o.get("feedback"))
            if problem:
                return f"step {i} option feedback {problem}"
            if o.get("outcome") not in _OUTCOMES:
                return f"step {i} option outcome must be success, neutral or fail"
    return None


# ─── experiences ─────────────────────────────────────────────────────────────
# Tolerant on purpose: the editor saves blocks mid-authoring (an empty item, a
# missing id), and its renderer fills defaults, so only types, sizes and
# values that would break a block are refused. Typed blocks (block_specs)
# hold new content to the editor's tighter authoring limits.


def _number(lo: float, hi: float, *, whole: bool = False) -> Callable[[Any], str | None]:
    def check(v: Any) -> str | None:
        ok = isinstance(v, int) if whole else isinstance(v, (int, float))
        if isinstance(v, bool) or not ok or v != v or not lo <= v <= hi:
            return f"must be a {'whole ' if whole else ''}number from {lo:g} to {hi:g}"
        return None

    return check


def _finite(v: Any) -> str | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float("inf"), float("-inf")):
        return "must be a number"
    return None


def _entries(what: str, hi: int, fields: dict[str, Callable[[Any], str | None]], extra: Callable[[dict], str | None] | None = None) -> Callable[[Any], str | None]:
    """A list of at most `hi` objects whose known fields pass their checks."""
    def check(v: Any) -> str | None:
        if not isinstance(v, list) or len(v) > hi:
            return f"must be a list of at most {hi} {what}s"
        for i, item in enumerate(v):
            if not isinstance(item, dict):
                return f"{what} {i} must be an object"
            for key, value in item.items():
                problem = fields[key](value) if key in fields else None
                if problem:
                    return f"{what} {i} {key} {problem}"
            problem = extra(item) if extra else None
            if problem:
                return f"{what} {i} {problem}"
        return None

    return check


def _strings(hi: int, limit: int) -> Callable[[Any], str | None]:
    def check(v: Any) -> str | None:
        if not isinstance(v, list) or len(v) > hi or not all(isinstance(x, str) and len(x) <= limit for x in v):
            return f"must be a list of at most {hi} texts of up to {limit} characters"
        return None

    return check


def _speed_answer(q: dict) -> str | None:
    options, answer = q.get("options"), q.get("answer")
    if answer is None or not isinstance(options, list):
        return None
    if isinstance(answer, bool) or not isinstance(answer, int) or not 0 <= answer < max(len(options), 1):
        return "answer must be the 0-based index of one of its options"
    return None


def _clue_answer(v: Any) -> str | None:
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return None
    return _str(100)(v)


def _labels(v: Any) -> str | None:
    if not isinstance(v, dict) or set(v) - {"true", "false"}:
        return 'must be {"true": "Fact", "false": "Myth"}'
    for key in ("true", "false"):
        if _str(100)(v.get(key)):
            return f"{key} must be text of up to 100 characters"
    return None


def _venn_sets(v: Any) -> str | None:
    if not isinstance(v, dict) or set(v) - {"a", "b"}:
        return 'must be {"a": {label, color}, "b": {label, color}}'
    for key, side in v.items():
        if not isinstance(side, dict):
            return f"{key} must be {{label, color}}"
        for field, check in (("label", _str(500)), ("color", _str(30))):
            problem = check(side.get(field))
            if problem:
                return f"{key} {field} {problem}"
    return None


def _cells(v: Any) -> str | None:
    if not isinstance(v, dict) or len(v) > 1000:
        return 'must be an object of correct ticks like {"rowId:colId": true}'
    for key, value in v.items():
        if len(key) > 201 or ":" not in key or not isinstance(value, bool):
            return f'entry {key[:40]!r} must be "rowId:colId": true'
    return None


def _image_src(v: Any) -> str | None:
    """An image: an http(s) URL, or a path on this site for uploaded files."""
    if v in (None, "") or is_web_url(v):
        return None
    if isinstance(v, str) and re.fullmatch(r"/(?!/)[^\s<>\"'\\]{0,2040}", v):
        return None
    return "must be an http(s) URL"


_ID = _str(100)
_SHORT = _str(500)
_LONG = _str(5000)

_EXPERIENCE_VALIDATORS: dict[str, dict[str, Callable[[Any], str | None]]] = {
    "expSort": {
        "categories": _entries("category", 8, {"id": _ID, "label": _SHORT, "color": _str(30)}),
        "items": _entries("item", 50, {"id": _ID, "text": _SHORT, "categoryId": _ID, "explanation": _str(2000)}),
        "shuffle": _bool,
    },
    "expSequence": {
        "items": _entries("item", 30, {"id": _ID, "text": _SHORT, "detail": _str(200)}),
        "variant": _one_of("list", "timeline"),
    },
    "expMatch": {
        "pairs": _entries("pair", 20, {"id": _ID, "left": _SHORT, "right": _SHORT}),
        "mode": _one_of("connect", "memory"),
    },
    "expHotspot": {
        "imageUrl": _image_src,
        "imageObject": lambda v: None if v is None or isinstance(v, dict) else "must be an uploaded file object",
        "spots": _entries("spot", 50, {
            "id": _ID, "x": _number(0, 100), "y": _number(0, 100), "r": _number(0, 100),
            "label": _SHORT, "explanation": _str(2000), "correct": _bool,
        }),
        "mode": _one_of("find", "explore"),
    },
    "expGaps": {"text": _str(20_000), "mode": _one_of("type", "bank"), "caseSensitive": _bool},
    "expMythFact": {
        "statements": _entries("statement", 50, {"id": _ID, "text": _str(1000), "isTrue": _bool, "explanation": _str(2000)}),
        "labels": _labels,
    },
    "expSpeedRound": {
        "questions": _entries(
            "question", 50, {"id": _ID, "prompt": _SHORT, "options": _strings(6, 500)}, extra=_speed_answer,
        ),
        "secondsPerQuestion": _number(1, 600, whole=True),
        "lives": _number(0, 100, whole=True),
    },
    "expEstimate": {
        "question": _str(1000), "min": _finite, "max": _finite, "step": _finite, "answer": _finite,
        "unit": _str(50), "tolerancePct": _number(0, 100), "explanation": _LONG,
    },
    "expSpotMistake": {
        "segments": _entries("segment", 200, {
            "id": _ID, "text": _LONG, "isMistake": _bool, "correction": _str(2000), "explanation": _str(2000),
        }),
        "kind": _one_of("text", "code"),
    },
    "expCodeLock": {
        "story": _LONG,
        "clues": _entries("clue", 10, {"id": _ID, "question": _str(1000), "answer": _clue_answer, "hint": _str(1000)}),
        "reward": _str(10_000),
    },
}
_IMAGE_OBJECT = _EXPERIENCE_VALIDATORS["expHotspot"]["imageObject"]
_EXPERIENCE_VALIDATORS.update({
    "expVenn": {
        "sets": _venn_sets,
        "items": _entries("item", 50, {
            "id": _ID, "text": _SHORT, "zone": _one_of("a", "b", "both", "neither"), "explanation": _str(2000),
        }),
        "showNeither": _bool,
    },
    "expLabel": {
        "imageUrl": _image_src,
        "imageObject": _IMAGE_OBJECT,
        "pins": _entries("pin", 50, {"id": _ID, "x": _number(0, 100), "y": _number(0, 100), "label": _SHORT}),
        "distractors": _strings(20, 500),
    },
    "expWordGuess": {
        "words": _entries("word", 30, {"id": _ID, "answer": _str(100), "clue": _str(2000), "explanation": _str(2000)}),
        "maxGuesses": _number(1, 20, whole=True),
    },
    "expConfidence": {
        "questions": _entries(
            "question", 50, {"id": _ID, "prompt": _str(2000), "options": _strings(10, 1000), "explanation": _str(2000)},
            extra=_speed_answer,
        ),
    },
    "expMatrix": {
        "rows": _entries("row", 30, {"id": _ID, "label": _SHORT}),
        "columns": _entries("column", 20, {"id": _ID, "label": _SHORT}),
        "cells": _cells,
        "mode": _one_of("multi", "single"),
    },
    "expReflect": {
        "prompt": _LONG, "guidingQuestions": _strings(20, 1000), "minWords": _number(0, 10_000, whole=True),
        "modelAnswer": _str(10_000), "checklist": _strings(30, 1000),
    },
})
for _name, _checks in _EXPERIENCE_VALIDATORS.items():
    _checks.setdefault("blockId", _ID)
    _checks.setdefault("title", _SHORT)
    _checks.setdefault("instructions", _str(1000))


def _experience_problems(t: str, attrs: dict) -> list[str]:
    """Checks that span two attributes of an Experiences block."""
    out: list[str] = []
    if t == "expSort" and isinstance(attrs.get("categories"), list) and isinstance(attrs.get("items"), list):
        ids = {c.get("id") for c in attrs["categories"] if isinstance(c, dict)}
        for i, item in enumerate(attrs["items"]):
            ref = item.get("categoryId") if isinstance(item, dict) else None
            if ref not in (None, "") and ref not in ids:
                out.append(f"expSort.items item {i} categoryId {ref!r} names no category.")
                break
    if t == "expEstimate":
        lo, hi, step = attrs.get("min"), attrs.get("max"), attrs.get("step")

        def number(x: Any) -> bool:
            return x is not None and _finite(x) is None

        if number(lo) and number(hi) and lo >= hi:
            out.append("expEstimate.min must be below max.")
        if number(step) and step <= 0:
            out.append("expEstimate.step must be above 0.")
    return out


_ALIGN = _one_of("left", "center", "right")


def _num(lo: float, hi: float, *, null: bool = True) -> Callable[[Any], str | None]:
    def check(v: Any) -> str | None:
        if v is None and null:
            return None
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or not lo <= v <= hi:
            return f"must be a number from {lo:g} to {hi:g}"
        return None

    return check


_HIGHLIGHT_LINES = re.compile(r"^\s*\d{1,5}(\s*-\s*\d{1,5})?(\s*,\s*\d{1,5}(\s*-\s*\d{1,5})?)*\s*$")


def _highlight_lines(v: Any) -> str | None:
    if v is None or (isinstance(v, str) and len(v) <= 200 and _HIGHLIGHT_LINES.match(v)):
        return None
    return 'must be line numbers and ranges like "2,4-6"'


def _currency(v: Any) -> str | None:
    if v is None or (isinstance(v, str) and re.fullmatch(r"[A-Za-z]{3}", v)):
        return None
    return "must be a three-letter currency code like USD"


def _block_object(v: Any) -> str | None:
    """A file the editor uploaded (BlockRead): kept as stored, never made up."""
    if v is None:
        return None
    if not isinstance(v, dict) or not isinstance(v.get("block_uuid"), str) or not isinstance(v.get("content"), dict):
        return "must be the stored upload ({block_uuid, content}) or null"
    return None


def _picture(item: Any, where: str, *, label: bool = False) -> str | None:
    """A gallery image or a comparison side: a linked or uploaded picture."""
    if not isinstance(item, dict):
        return f"{where} must be an object"
    allowed = {"id", "url", "blockObject", "caption", "alt"} if not label else {"url", "blockObject", "label", "alt"}
    extra = sorted(set(item) - allowed)
    if extra:
        return f"{where} has no field {extra[0]!r}"
    if item.get("url") not in (None, "") and not is_web_url(item.get("url")):
        return f"{where} url must be an http(s) URL"
    problem = _block_object(item.get("blockObject"))
    if problem:
        return f"{where} blockObject {problem}"
    for key, limit in (("id", 80), ("caption", 300), ("alt", 500), ("label", 80)):
        if _str(limit)(item.get(key)):
            return f"{where} {key} must be text of at most {limit} characters"
    return None


def _gallery_images(v: Any) -> str | None:
    if not isinstance(v, list) or len(v) > 40:
        return "must be a list of at most 40 images"
    for i, item in enumerate(v):
        problem = _picture(item, f"image {i}")
        if problem:
            return problem
        if not item.get("url") and not item.get("blockObject"):
            return f"image {i} needs a url"
    return None


def _compare_side(v: Any) -> str | None:
    if v is None:
        return None
    return _picture(v, "the side", label=True)


def _chart_data(v: Any) -> str | None:
    if not isinstance(v, dict) or set(v) - {"labels", "series"}:
        return 'must be {"labels": [...], "series": [{"name", "values", "tone"}]}'
    labels = v.get("labels")
    series = v.get("series")
    if not isinstance(labels, list) or len(labels) > 50 or not all(isinstance(x, str) and len(x) <= 60 for x in labels):
        return "labels must be a list of at most 50 texts of up to 60 characters"
    if not isinstance(series, list) or len(series) > 8:
        return "series must be a list of at most 8 series"
    for i, s in enumerate(series):
        if not isinstance(s, dict) or set(s) - {"name", "values", "tone"}:
            return f"series {i} must be {{name, values, tone}}"
        if _str(60)(s.get("name")):
            return f"series {i} name must be text of at most 60 characters"
        values = s.get("values")
        if not isinstance(values, list) or len(values) != len(labels):
            return f"series {i} needs one value per label ({len(labels)})"
        if any(isinstance(x, bool) or not isinstance(x, (int, float)) or x != x or abs(x) > 1e15 for x in values):
            return f"series {i} values must be numbers"
        if s.get("tone") not in (None, *CHART_TONES):
            return f"series {i} tone must be one of {', '.join(CHART_TONES)}"
    return None


def _stats(v: Any) -> str | None:
    if not isinstance(v, list) or not 1 <= len(v) <= 8:
        return "must be a list of 1 to 8 stats"
    for i, item in enumerate(v):
        if not isinstance(item, dict):
            return f"stat {i} must be an object"
        extra = sorted(set(item) - {"id", "value", "label", "description", "tone", "prefix", "suffix"})
        if extra:
            return f"stat {i} has no field {extra[0]!r}"
        value = item.get("value")
        if isinstance(value, bool) or not isinstance(value, (str, int, float)) or len(str(value)) > 24:
            return f"stat {i} value must be a number or text of up to 24 characters"
        for key, limit in (("id", 80), ("label", 120), ("description", 300), ("prefix", 8), ("suffix", 12)):
            if _str(limit)(item.get(key)):
                return f"stat {i} {key} must be text of at most {limit} characters"
        if item.get("tone") not in (None, *LAYOUT_TONES):
            return f"stat {i} tone must be one of {', '.join(LAYOUT_TONES)}"
    return None


def _quiz_settings(v: Any) -> str | None:
    if v is None:
        return None
    if not isinstance(v, dict):
        return "must be an object or null"
    if "passMark" in v and _int(0, 100)(v["passMark"]):
        return "passMark must be a whole number from 0 to 100"
    if "showExplanations" in v and not isinstance(v["showExplanations"], bool):
        return "showExplanations must be true or false"
    return None


def _image_size(v: Any) -> str | None:
    """The editor stores an image's size as {"width": pixels}."""
    if v is None:
        return None
    if not isinstance(v, dict) or set(v) - {"width"}:
        return 'must be {"width": pixels}'
    return _int(50, 5000, null=True)(v.get("width"))

_TEXT_ALIGN = _one_of(None, "start", "center", "end", "justify")
_CELL = {
    "colspan": _int(1, 100), "rowspan": _int(1, 100),
    "cellType": _one_of(None, *CELL_TYPES), "background": _one_of(None, *PALETTE),
    "align": _one_of(None, "left", "center", "right", "start", "end"),
    "valign": _one_of(None, "top", "middle", "bottom"), "tone": _one_of(None, *PALETTE),
    "numberFormat": _one_of(None, "plain", "percent", "currency", "compact"), "currency": _currency,
}


def _callout_type(v: Any) -> str | None:
    if v in CALLOUT_TYPES:
        return None
    if v in CALLOUT_KINDS:
        return f"must be one of {', '.join(map(repr, CALLOUT_TYPES))}; for {v!r} set kind: {v!r} (and type {CALLOUT_KINDS[v]!r})"
    return f"must be one of {', '.join(map(repr, CALLOUT_TYPES))}"


_VALIDATORS: dict[str, dict[str, Callable[[Any], str | None]]] = {
    "paragraph": {"textAlign": _TEXT_ALIGN},
    "heading": {"level": _int(1, 6), "textAlign": _TEXT_ALIGN},
    "orderedList": {"start": _int(0, 1_000_000), "type": _one_of(None, "1", "a", "A", "i", "I")},
    "codeBlock": {
        "language": _language, "showLineNumbers": _bool, "wrap": _bool,
        "highlightLines": _highlight_lines,
    },
    "table": {
        "variant": _one_of(None, "default", "striped", "bordered", "minimal", "cards"), "caption": _str(500),
        "headerColumn": _bool, "stickyHeader": _bool, "sortable": _bool, "compact": _bool,
        "totals": _one_of(None, "none", "sum", "average"),
    },
    "tableCell": _CELL,
    "tableHeader": _CELL,
    "callout": {
        "type": _callout_type, "dismissible": _bool, "title": _str(200), "collapsible": _bool,
        "defaultOpen": _bool, "tone": _one_of(None, *PALETTE), "kind": _one_of(None, *CALLOUT_KINDS),
    },
    "badge": {"color": _str(30), "emoji": _str(16)},
    "button": {
        "emoji": _str(16), "link": _url(empty=True), "color": _str(30), "alignment": _ALIGN,
        "variant": _one_of(None, "solid", "outline", "soft", "link"), "size": _one_of(None, "sm", "md", "lg"),
    },
    "buttonGroup": {"alignment": _ALIGN},
    "inlineMath": {"latex": _str(1000, null=False, empty=False)},
    "tabs": {"blockId": _str(100), "variant": _one_of("line", "pills", "boxed")},
    "tabItem": {"title": _str(200), "icon": _str(40)},
    "columns": {
        "layout": _one_of("1-1", "1-2", "2-1", "1-1-1", "1-1-1-1"), "gap": _one_of("sm", "md", "lg"),
        "stackOnMobile": _bool, "verticalAlign": _one_of("top", "center", "bottom"),
    },
    "accordion": {"single": _bool, "variant": _one_of("default", "bordered", "filled")},
    "timeline": {
        "variant": _one_of("steps", "timeline", "process"), "numbered": _bool,
        "orientation": _one_of("vertical", "horizontal"),
    },
    "timelineItem": {
        "title": _str(300), "label": _str(100), "icon": _one_of(None, *LAYOUT_ICONS),
        "tone": _one_of(None, *LAYOUT_TONES),
    },
    "tableOfContents": {"title": _str(200), "maxLevel": _one_of(2, 3, 4), "numbered": _bool},
    "keyTakeaways": {"title": _str(200), "tone": _one_of(*LAYOUT_TONES), "icon": _one_of(None, *LAYOUT_ICONS)},
    "taskList": {"blockId": _str(100), "learnerCanCheck": _bool},
    "taskItem": {"checked": _bool},
    "gallery": {
        "blockId": _str(100), "layout": _one_of("grid", "carousel", "masonry"), "columns": _one_of(2, 3, 4),
        "images": _gallery_images,
    },
    "imageCompare": {
        "before": _compare_side, "after": _compare_side, "start": _int(0, 100),
        "orientation": _one_of("horizontal", "vertical"),
    },
    "chart": {
        "type": _one_of(*CHART_TYPES), "title": _str(300), "data": _chart_data,
        "showLegend": _bool, "showValues": _bool, "stacked": _bool,
    },
    "statHighlights": {"items": _stats, "columns": _one_of(2, 3, 4), "animate": _bool},
    "fileCard": {
        "blockObject": _block_object, "name": _str(200), "description": _str(1000),
        "sizeBytes": _int(0, 10**13, null=True), "fileType": _one_of(None, *FILE_TYPES),
    },
    "quoteBlock": {
        "variant": _one_of("pull", "testimonial", "highlight"), "author": _str(200), "role": _str(200),
    },
    "flipcard": {
        "question": _str(2000, null=False), "answer": _str(2000, null=False),
        "color": _str(30), "alignment": _ALIGN, "size": _one_of("small", "medium", "large"),
        "style": _one_of(None, "solid", "soft", "outline"),
    },
    "flipcardGrid": {"columns": _int(1, 6), "mode": _one_of(None, "grid", "study"), "title": _str(200), "shuffle": _one_of(None, True, False)},
    "blockEmbed": {
        "embedUrl": _url(), "embedCode": _str(20_000), "embedType": _str(40),
        "embedWidth": _str(20), "alignment": _ALIGN,
    },
    "blockWebPreview": {
        "url": _url(null=False), "title": _str(500), "description": _str(2000),
        "og_image": _url(), "favicon": _url(), "og_type": _str(100), "og_url": _url(),
        "alignment": _ALIGN, "buttonLabel": _str(100), "showButton": _bool, "openInPopup": _bool,
        "layout": _one_of("large", "compact"), "customTitle": _str(500), "customDescription": _str(2000),
    },
    "blockUser": {"layout": _one_of("card", "compact")},
    "blockMathEquation": {"math_equation": _str(10_000, null=False)},
    "blockQuiz": {"quizId": _str(100), "questions": _quiz_questions, "settings": _quiz_settings},
    "scenarios": {
        "title": _str(500), "scenarios": _scenarios, "currentScenarioId": _str(100),
        "display": _one_of(None, "story", "chat"),
    },
    **_EXPERIENCE_VALIDATORS,
    "blockMagic": {"htmlContent": _str(500_000), "title": _str(200), "height": _int(50, 5000)},
    "blockH5P": {"h5pUrl": _url(null=False), "title": _str(500), "height": _int(50, 5000)},
    "blockImage": {
        "alignment": _ALIGN, "size": _image_size, "unsplash_url": _url(),
        "unsplash_photographer_name": _str(200), "unsplash_photographer_url": _url(),
        "unsplash_photo_url": _url(), "frame": _one_of(None, "none", "rounded", "shadow", "border", "polaroid"),
    },
    "youtube": {"src": _url(null=False), "start": _int(0, 1_000_000, null=True)},
    "toggleBlock": {
        "summary": _str(300), "defaultOpen": _bool, "variant": _one_of(None, "default", "bordered", "filled"),
        "icon": _one_of(None, "chevron", "plus"),
    },
    "conditionalBlock": {
        "rules": lambda v: _rules(v), "hiddenMessage": _str(300), "label": _str(200),
        "openRules": _one_of(None, True),
    },
    "dynamicVariable": {
        "path": lambda v: _variable_path(v), "fallback": _str(200),
        "format": _one_of(None, "upper", "lower", "capitalize", "title"),
    },
}


def _rules(v: Any, depth: int = 0) -> str | None:
    """A conditional block's rule group, checked against the fields and
    operators the server evaluates (dynamic_content.FIELDS); anything it does
    not know would hide the block from everyone."""
    from src.services.courses.activities.dynamic_content import FIELDS, MAX_RULE_DEPTH, count_conditions

    if v is None:
        return None
    if not isinstance(v, dict) or not isinstance(v.get("conditions"), list):
        return 'must be {"match": "all"|"any", "conditions": [{field, op, value}]}'
    if depth > MAX_RULE_DEPTH:
        return f"nest at most {MAX_RULE_DEPTH} groups deep"
    if v.get("match", "all") not in ("all", "any"):
        return "match must be all or any"
    if depth == 0 and count_conditions(v) >= 50:
        return "has too many conditions (at most 49)"
    for item in v["conditions"]:
        if isinstance(item, dict) and "conditions" in item:
            problem = _rules(item, depth + 1)
            if problem:
                return problem
            continue
        if not isinstance(item, dict) or item.get("field") not in FIELDS:
            known = ", ".join(sorted(FIELDS))
            got = item.get("field") if isinstance(item, dict) else item
            return f"condition field {got!r} is unknown; use one of {known}"
        if item.get("op") not in RULE_OPS:
            return f"condition op {item.get('op')!r} is unknown; use one of {', '.join(RULE_OPS)}"
    return None


RULE_OPS = (
    "contains_any", "contains_all", "contains_none", "in", "not_in", "eq", "neq", "gt", "gte", "lt",
    "lte", "between", "is_true", "is_false", "on_or_after", "on_or_before", "before", "after",
)


def _variable_path(v: Any) -> str | None:
    from src.services.courses.activities.dynamic_content import CUSTOM_PREFIX, VARIABLES

    if isinstance(v, str) and (v in VARIABLES or (v.startswith(CUSTOM_PREFIX) and re.fullmatch(r"custom\.[a-z0-9_]{1,60}", v))):
        return None
    return f"must be one of {', '.join(VARIABLES)} or custom.<key>"


# Attributes that end up in an href or src for learners: only http(s), so no
# javascript:, data: or vbscript: link can be written under any block type.
URL_ATTRS = frozenset({
    "link", "url", "href", "src", "h5pUrl", "embedUrl", "embedSourceUrl", "og_image", "og_url",
    "favicon", "imageUrl", "unsplash_url", "unsplash_photographer_url", "unsplash_photo_url", "avatarUrl",
})


def attrs_problems(t: str, attrs: Any, where: tuple = ()) -> list[str]:
    spec = SCHEMA[t]
    if attrs is None:
        attrs = {}
    if not isinstance(attrs, dict):
        return [f"attrs on the {t} at {_where(where)} must be an object."]
    out = []
    unknown = [k for k in attrs if k not in spec.attrs]
    if unknown:
        allowed = ", ".join(spec.attrs) or "none"
        out.append(f"A {t} has no attribute {unknown[0]!r} (allowed: {allowed}).")
    validators = _VALIDATORS.get(t, {})
    for key, value in attrs.items():
        if key in validators:
            problem = validators[key](value)
            if problem:
                out.append(f"{t}.{key} {problem}.")
    for key in URL_ATTRS & set(attrs):
        if t in ("expHotspot", "expLabel") and key == "imageUrl":
            continue  # _image_src: uploaded images may be site paths
        value = attrs[key]
        if value not in (None, "") and not is_web_url(value):
            out.append(f"{t}.{key} must be an http(s) URL.")
    if t == "blockEmbed" and not (attrs.get("embedUrl") or attrs.get("embedCode")):
        out.append("A blockEmbed needs embedUrl or embedCode.")
    out.extend(_experience_problems(t, attrs))
    try:
        size = len(json.dumps(attrs, ensure_ascii=False, default=str))
    except (TypeError, ValueError):
        return out + [f"attrs on the {t} at {_where(where)} must be plain JSON."]
    if size > 600_000:
        out.append(f"attrs on the {t} at {_where(where)} are too large.")
    return out


# ─── blocks that need approval ───────────────────────────────────────────────

# Blocks that run or frame outside code in the learner's browser.
RISKY_TYPES = frozenset({"blockMagic", "blockH5P", "blockWebPreview"})


def is_risky(node: Any) -> bool:
    """Whether a block runs custom HTML or frames outside content (a plain
    URL embed is fine; embed code is not)."""
    t = kind(node)
    if t in RISKY_TYPES:
        return True
    if t == "blockEmbed":
        a = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
        return a.get("embedType") != "url" or bool(a.get("embedCode"))
    return False


def _risky_signatures(doc: Any) -> dict[str, int]:
    counts: dict[str, int] = {}
    stack = [doc]
    while stack:
        node = stack.pop()
        if not isinstance(node, dict):
            continue
        if is_risky(node):
            key = json.dumps(node, sort_keys=True, ensure_ascii=False, default=str)
            counts[key] = counts.get(key, 0) + 1
        stack.extend(children(node))
    return counts


def added_risky(old_doc: Any, new_doc: Any) -> list[str]:
    """Types of the risky blocks new_doc adds or changes compared to old_doc
    (a kept or moved block, unchanged, does not count)."""
    old = _risky_signatures(old_doc)
    out = []
    for key, n in _risky_signatures(new_doc).items():
        if n > old.get(key, 0):
            out.append(json.loads(key).get("type", "?"))
    return sorted(set(out))


# ─── building blocks ─────────────────────────────────────────────────────────


def text_node(text: str, marks: list | None = None) -> dict:
    node: dict[str, Any] = {"type": "text", "text": text}
    if marks:
        node["marks"] = [dict(m) for m in marks]
    return node


def paragraph(inline: list | None = None) -> dict:
    return {"type": "paragraph", "content": inline} if inline else {"type": "paragraph"}


def callout_kind_attrs(attrs: dict) -> dict:
    """Callout attrs with a newer look asked for as `type` (note, question,
    example, quote) moved to `kind`, and `type` set to the closest original
    look, which is all older clients understand."""
    if attrs.get("type") in CALLOUT_KINDS:
        attrs = {**attrs, "kind": attrs["type"], "type": CALLOUT_KINDS[attrs["type"]]}
    return attrs


def _answer(text: str, correct: bool) -> dict:
    return {"answer_id": f"answer_{uuid.uuid4()}", "answer": text, "correct": bool(correct)}


def quiz_question(q: dict) -> dict:
    """One question in the editor's shape from the simple shape.

    {text, options: [{text, correct}], explanation?} is multiple choice (as
    before). With `type`: true_false takes `answer` (true or false) and is
    stored as two options, True then False, so older clients still show a
    pick-one question; short_answer takes `accepted_answers` (and
    `accent_insensitive`); numeric takes `correct_value` and `tolerance`."""
    qtype = q.get("type") or "multiple_choice"
    question: dict[str, Any] = {"question_id": f"question_{uuid.uuid4()}", "question": q["text"], "type": qtype}
    if qtype == "true_false":
        labels = q.get("labels") or ("True", "False")
        truth = q.get("answer") is True
        question["response_type"] = "single"
        question["answers"] = [_answer(labels[0], truth), _answer(labels[1], not truth)]
    elif qtype == "short_answer":
        question["answers"] = []
        question["accepted_answers"] = list(q.get("accepted_answers") or [])
        if q.get("accent_insensitive"):
            question["accent_insensitive"] = True
    elif qtype == "numeric":
        question["answers"] = []
        question["correct_value"] = q.get("correct_value")
        question["tolerance"] = q.get("tolerance") or 0
    else:
        answers = [_answer(o["text"], o["correct"]) for o in q["options"]]
        correct = sum(1 for a in answers if a["correct"])
        question["type"] = "multiple_choice"
        question["response_type"] = "multiple" if correct >= 2 else "single"
        question["answers"] = answers
    if q.get("explanation"):
        question["explanation"] = q["explanation"]
    return question


def quiz_node(questions: list[dict], settings: dict | None = None) -> dict:
    """A blockQuiz from the simple shape (see quiz_question), with the ids
    the editor expects generated here."""
    attrs: dict[str, Any] = {"quizId": f"quiz_{uuid.uuid4()}", "questions": [quiz_question(q) for q in questions]}
    if settings:
        attrs["settings"] = settings
    return {"type": "blockQuiz", "attrs": attrs}


_TYPED_KEYS = ("accepted_answers", "accent_insensitive", "correct_value", "tolerance", "answer")


def _simple_typed(q: dict) -> bool:
    """A question in the simple shape that has no options (true/false,
    short answer, numeric)."""
    return (
        "answers" not in q and "options" not in q and ("text" in q or "question" in q)
        and q.get("type") in ("true_false", "short_answer", "numeric")
    )


def fill_quiz_ids(questions: Any) -> Any:
    """Accept quiz questions in the simple shape or the editor's shape and
    return the editor's shape, keeping existing ids and adding missing ones."""
    if not isinstance(questions, list):
        return questions
    out = []
    for q in questions:
        if not isinstance(q, dict):
            out.append(q)
            continue
        if _simple_typed(q):
            simple = {"text": q.get("text") or q.get("question") or "", "type": q["type"],
                      **{k: q[k] for k in (*_TYPED_KEYS, "explanation") if k in q}}
            out.append(quiz_question(simple))
            continue
        if "options" in q and "answers" not in q:
            simple = {"text": q.get("text") or q.get("question") or "", "options": [
                {"text": o.get("text", ""), "correct": bool(o.get("correct"))}
                for o in q.get("options") or [] if isinstance(o, dict)
            ]}
            if q.get("explanation"):
                simple["explanation"] = q["explanation"]
            out.append(quiz_node([simple])["attrs"]["questions"][0])
            continue
        q = dict(q)
        q.setdefault("question_id", f"question_{uuid.uuid4()}")
        q.setdefault("type", "multiple_choice")
        answers = []
        for a in q.get("answers") or []:
            if isinstance(a, dict):
                a = dict(a)
                a.setdefault("answer_id", f"answer_{uuid.uuid4()}")
            answers.append(a)
        q["answers"] = answers
        correct = sum(1 for a in answers if isinstance(a, dict) and a.get("correct") is True)
        if correct >= 2:
            q["response_type"] = "multiple"
        out.append(q)
    return out


def strip_link_extras(node: Any) -> None:
    """Drop the class and rel a link copied from the editor carries (the
    editor adds its own rel when it renders), in place."""
    stack = [node]
    while stack:
        current = stack.pop()
        if not isinstance(current, dict):
            continue
        for m in current.get("marks") or []:
            if isinstance(m, dict) and m.get("type") == "link" and isinstance(m.get("attrs"), dict):
                m["attrs"].pop("class", None)
                m["attrs"].pop("rel", None)
        stack.extend(children(current))


def clean_marks(nodes: list) -> list:
    """Drop the marks code text cannot carry (the editor's code mark excludes
    every other mark)."""
    for node in nodes:
        marks = node.get("marks") if isinstance(node, dict) else None
        if marks and any(m.get("type") == "code" for m in marks) and len(marks) > 1:
            node["marks"] = [{"type": "code"}]
    return nodes


# ─── paths ───────────────────────────────────────────────────────────────────


def locate(doc: dict, path: list[int]) -> tuple[dict, int, dict]:
    """(parent node, index in parent, node) for a path."""
    if not path:
        raise PathError("A path needs at least one index, e.g. [0].")
    if len(path) > MAX_DEPTH:
        raise PathError(f"Path {list(path)} is deeper than any block on the page.")
    parent = doc
    node: Any = None
    for depth, idx in enumerate(path):
        kids = children(parent)
        if not 0 <= idx < len(kids):
            where = _where(tuple(path[:depth])) if depth else "the page"
            raise PathError(
                f"No block at {list(path)}: {where} has {len(kids)} "
                f"{'child' if len(kids) == 1 else 'children'}. Read the outline for current paths."
            )
        node = kids[idx]
        if depth < len(path) - 1:
            if kind(node) in TEXT_HOLDERS:
                raise PathError(
                    f"{list(path)} points inside the text of a {kind(node)}; "
                    f"address the {kind(node)} itself ({list(path[:depth + 1])})."
                )
            parent = node
    return parent, path[-1], node


def walk_blocks(doc: dict, max_depth: int = MAX_DEPTH) -> Iterator[tuple[tuple, dict, dict]]:
    """(path, node, parent) for every non-inline node, document order."""
    stack: list[tuple[tuple, dict, dict]] = [
        ((i,), n, doc) for i, n in reversed(list(enumerate(children(doc))))
    ]
    while stack:
        path, node, parent = stack.pop()
        if not isinstance(node, dict) or kind(node) in INLINE_TYPES:
            continue
        yield path, node, parent
        if len(path) < max_depth and kind(node) not in TEXT_HOLDERS:
            stack.extend(
                (path + (j,), c, node) for j, c in reversed(list(enumerate(children(node))))
            )


def find_path(doc: dict, target: dict) -> list[int] | None:
    for path, node, _parent in walk_blocks(doc, max_depth=MAX_DEPTH * 2):
        if node is target:
            return list(path)
    return None


def find_parent(doc: dict, target: dict) -> tuple[dict, int] | None:
    if any(n is target for n in children(doc)):
        return doc, next(i for i, n in enumerate(children(doc)) if n is target)
    for _path, node, _parent in walk_blocks(doc, max_depth=MAX_DEPTH * 2):
        for i, child in enumerate(children(node)):
            if child is target:
                return node, i
    return None


# ─── text ────────────────────────────────────────────────────────────────────


def inline_text(node: dict) -> str:
    parts = []
    for child in children(node):
        if kind(child) == "text":
            parts.append(child.get("text") or "")
        elif kind(child) == "hardBreak":
            parts.append("\n")
        elif kind(child) == "dynamicVariable":
            parts.append(variable_as_text(child)["text"])
        elif kind(child) == "inlineMath":
            parts.append(f"${(child.get('attrs') or {}).get('latex') or ''}$")
    return "".join(parts)


def variable_as_text(node: dict) -> dict:
    """A dynamicVariable as the {{path}} text the server also fills in, so
    reading and Markdown keep it; any other node unchanged."""
    if kind(node) != "dynamicVariable":
        return node
    path = (node.get("attrs") or {}).get("path") or "user.first_name"
    return {"type": "text", "text": "{{" + str(path) + "}}"}


def block_text(node: Any, depth: int = 0) -> str:
    """The readable text of a block, with cells, items and paragraphs kept
    apart (never glued together)."""
    if not isinstance(node, dict) or depth > MAX_DEPTH:
        return ""
    t = kind(node)
    if t in TEXT_HOLDERS:
        return inline_text(node)
    if t in LEAVES:
        return atom_text(node)
    if t == "table":
        rows = []
        caption = str((node.get("attrs") or {}).get("caption") or "").strip()
        if caption:
            rows.append(caption)
        for row in children(node):
            rows.append(" | ".join(block_text(cell, depth + 2).replace("\n", " ") for cell in children(row)))
        return "\n".join(rows)
    parts = [container_title(node)] + [block_text(c, depth + 1) for c in children(node)]
    if t == "flipcardGrid":
        parts.insert(0, str((node.get("attrs") or {}).get("title") or ""))  # the deck title
    if t == "quoteBlock":
        parts.append(quote_credit(node))
    return "\n".join(p for p in parts if p)


def container_title(node: dict) -> str:
    """The heading a container shows above its content (a tab's title, a
    timeline step's label and title, a callout's title...)."""
    t = kind(node)
    a = node.get("attrs") or {}
    if t == "timelineItem":
        return " ".join(str(a.get(k) or "").strip() for k in ("label", "title") if str(a.get(k) or "").strip())
    if t in ("tabItem", "keyTakeaways", "callout"):
        return str(a.get("title") or "").strip()
    return ""


def quote_credit(node: dict) -> str:
    a = node.get("attrs") or {}
    who = ", ".join(str(a.get(k) or "").strip() for k in ("author", "role") if str(a.get(k) or "").strip())
    return f"— {who}" if who else ""


def atom_text(node: dict) -> str:
    """Searchable text of a block whose data lives in attrs."""
    t = kind(node)
    a = node.get("attrs") or {}
    if t == "blockQuiz":
        lines = []
        for q in a.get("questions") or []:
            if isinstance(q, dict):
                lines.append(str(q.get("question") or ""))
                lines.extend(str(x.get("answer") or "") for x in q.get("answers") or [] if isinstance(x, dict))
        return "\n".join(lines)
    if t == "flipcard":
        return f"{a.get('question') or ''}\n{a.get('answer') or ''}"
    if t == "scenarios":
        lines = [str(a.get("title") or "")]
        for s in a.get("scenarios") or []:
            if isinstance(s, dict):
                lines.append(str(s.get("text") or ""))
                for o in s.get("options") or []:
                    if isinstance(o, dict):
                        lines.extend(str(o.get(key) or "") for key in ("text", "feedback"))
                ending = s.get("ending")
                if isinstance(ending, dict):
                    lines.append(str(ending.get("title") or ""))
        return "\n".join(line for line in lines if line)
    if t in exp.TEXT_PATHS:
        return "\n".join(
            exp.gaps_text(owner[key], answers=True) if t == "expGaps" and key == "text" else owner[key]
            for owner, key in exp.strings(a, t) if str(owner[key]).strip()
        )
    if t == "blockMathEquation":
        return str(a.get("math_equation") or "")
    if t in PLUS_ATOMS:
        return "\n".join(plus_atom_lines(node))
    if t == "blockCode":
        return f"{a.get('description') or ''}\n{a.get('starterCode') or ''}"
    if t in ("blockEmbed",):
        return str(a.get("embedUrl") or "")
    if t == "blockWebPreview":
        # The author's own title/description (when set) is what learners read.
        keys = ("customTitle" if a.get("customTitle") else "title", "url",
                "customDescription" if a.get("customDescription") else "description")
        return " ".join(str(a.get(k) or "") for k in keys).strip()
    if t in ("blockMagic", "blockH5P"):
        return str(a.get("title") or "")
    if t in MEDIA_TYPES:
        obj = a.get("blockObject") or {}
        content = obj.get("content") if isinstance(obj, dict) else None
        return str((content or {}).get("file_name") or a.get("unsplash_url") or "")
    return ""


PLUS_ATOMS = ("tableOfContents", "gallery", "imageCompare", "chart", "statHighlights", "fileCard")


def _s(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _list_of(value: Any) -> list[dict]:
    return [x for x in value if isinstance(x, dict)] if isinstance(value, list) else []


def stat_text(item: dict) -> str:
    """A stat as read: "92% Completion rate: of learners finish"."""
    value = item.get("value")
    shown = f"{_s(item.get('prefix'))}{value if isinstance(value, (int, float)) and not isinstance(value, bool) else _s(value)}{_s(item.get('suffix'))}"
    label = " ".join(x for x in (shown, _s(item.get("label"))) if x)
    return f"{label}: {_s(item.get('description'))}" if _s(item.get("description")) else label


def plus_atom_lines(node: dict) -> list[str]:
    """Readable lines of an Editor Plus block whose data lives in attrs: the
    words a learner sees (titles, captions, labels, numbers)."""
    t = kind(node)
    a = node.get("attrs") or {}
    lines: list[str] = []
    if t == "tableOfContents":
        lines.append(_s(a.get("title")) or "Table of contents")
    elif t == "gallery":
        for img in _list_of(a.get("images")):
            lines.append(_s(img.get("caption")) or _s(img.get("alt")))
    elif t == "imageCompare":
        for key in ("before", "after"):
            side = a.get(key) if isinstance(a.get(key), dict) else {}
            lines.append(" - ".join(x for x in (_s(side.get("label")), _s(side.get("alt"))) if x))
    elif t == "chart":
        data = a.get("data") if isinstance(a.get("data"), dict) else {}
        labels = [_s(x) for x in data.get("labels") or [] if isinstance(x, str)]
        lines.append(_s(a.get("title")))
        if labels:
            lines.append(", ".join(x for x in labels if x))
        for series in _list_of(data.get("series")):
            values = series.get("values") if isinstance(series.get("values"), list) else []
            pairs = [f"{label} {value:g}" for label, value in zip(labels, values)
                     if isinstance(value, (int, float)) and not isinstance(value, bool)]
            lines.append(f"{_s(series.get('name'))}: {', '.join(pairs)}".strip(": "))
    elif t == "statHighlights":
        lines.extend(stat_text(item) for item in _list_of(a.get("items")))
    elif t == "fileCard":
        lines.append(_s(a.get("name")))
        lines.append(_s(a.get("description")))
    return [line for line in lines if line]


def clip(text: str, limit: int) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    return text[: limit - 1].rstrip() + "…", True


def summary(node: dict, text_limit: int = 200) -> dict:
    """Key settings of a block, for outlines."""
    t = kind(node)
    a = node.get("attrs") or {}
    out: dict[str, Any] = {}
    if t == "heading":
        out["level"] = a.get("level")
    elif t == "callout":
        out["callout_type"] = a.get("kind") or a.get("type") or "info"
        if a.get("title"):
            out["title"] = a.get("title")
        if a.get("collapsible"):
            out["collapsible"] = True
    elif t in ("calloutInfo", "calloutWarning"):
        out["callout_type"] = "info" if t == "calloutInfo" else "warning"
    elif t == "codeBlock":
        out["language"] = a.get("language")
    elif t == "orderedList" and a.get("start") not in (None, 1):
        out["start"] = a.get("start")
    elif t == "blockQuiz":
        qs = [q for q in a.get("questions") or [] if isinstance(q, dict)]
        out["questions"] = [
            {
                "text": clip(str(q.get("question") or ""), text_limit)[0],
                "options": [
                    {"text": clip(str(x.get("answer") or ""), 120)[0], "correct": bool(x.get("correct"))}
                    for x in q.get("answers") or [] if isinstance(x, dict)
                ],
                **(
                    {"explanation": clip(str(q["explanation"]), text_limit)[0]}
                    if str(q.get("explanation") or "").strip()
                    else {}
                ),
                **_typed_summary(q),
            }
            for q in qs[:20]
        ]
        if len(qs) > 20:
            out["more_questions"] = len(qs) - 20
    elif t == "flipcard":
        out["question"] = clip(str(a.get("question") or ""), text_limit)[0]
        out["answer"] = clip(str(a.get("answer") or ""), text_limit)[0]
    elif t == "blockMathEquation":
        out["latex"] = clip(str(a.get("math_equation") or ""), 500)[0]
    elif t == "blockEmbed":
        out["url"] = a.get("embedUrl")
        out["embed_type"] = a.get("embedType")
    elif t == "blockWebPreview":
        out["url"] = a.get("url")
        out["title"] = a.get("title")
    elif t == "youtube":
        out["url"] = a.get("src")
    elif t in MEDIA_TYPES:
        obj = a.get("blockObject") if isinstance(a.get("blockObject"), dict) else {}
        content = obj.get("content") if isinstance(obj.get("content"), dict) else {}
        out["media"] = {
            "block_uuid": obj.get("block_uuid"),
            "file": content.get("file_name"),
            "src": a.get("unsplash_url") or None,
        }
        if t == "blockImage":
            out["alignment"] = a.get("alignment")
    elif t == "blockCode":
        out["language"] = a.get("languageName")
        out["description"] = clip(str(a.get("description") or ""), text_limit)[0]
    elif t == "scenarios":
        out["title"] = a.get("title")
        out["steps"] = len(a.get("scenarios") or [])
        if a.get("display") == "chat":
            out["display"] = "chat"
    elif t in exp.TEXT_PATHS:
        out.update(experience_summary(t, a, text_limit))
    elif t in ("blockMagic", "blockH5P"):
        out["title"] = a.get("title")
    elif t == "button":
        out["link"] = a.get("link")
    elif t == "badge":
        out["emoji"] = a.get("emoji")
    elif t == "blockLibrary":
        out["resource"] = {"uuid": a.get("resourceUuid"), "kind": a.get("resourceType")}
    elif t in ("bulletList", "orderedList", "flipcardGrid", "blockquote"):
        out["children"] = len(children(node))
        if t == "flipcardGrid":
            out["title"] = a.get("title") or None
            out["mode"] = a.get("mode") if a.get("mode") == "study" else None
    elif t in ("tabs", "accordion", "timeline", "columns", "taskList", "buttonGroup"):
        items = children(node)
        out["children"] = len(items)
        if t == "tabs":
            out["tabs"] = [clip(_s((i.get("attrs") or {}).get("title")), 120)[0] for i in items]
        elif t == "accordion":
            out["sections"] = [clip(_s((i.get("attrs") or {}).get("summary")), 120)[0] for i in items]
        elif t == "timeline":
            out["steps"] = [clip(container_title(i), 120)[0] for i in items]
        elif t == "columns":
            out["layout"] = a.get("layout")
        elif t == "taskList":
            out["items"] = [clip(block_text(i), 120)[0] for i in items[:30]]
    elif t in ("tabItem", "timelineItem", "keyTakeaways"):
        out["title"] = container_title(node) or None
    elif t == "quoteBlock":
        out["author"] = a.get("author")
    elif t in PLUS_ATOMS:
        if t == "chart":
            out["chart_type"] = a.get("type")
        elif t == "gallery":
            out["images"] = len(_list_of(a.get("images")))
        elif t == "fileCard":
            out["url"] = a.get("url")
        out["details"] = [clip(line, 200)[0] for line in plus_atom_lines(node)[:20]]
    elif t == "inlineMath":
        out["latex"] = a.get("latex")
    elif t == "table":
        rows = children(node)
        out["rows"] = [
            [clip(block_text(cell, 0).replace("\n", " "), 120)[0] for cell in children(row)][:20]
            for row in rows[:30]
        ]
        if len(rows) > 30:
            out["more_rows"] = len(rows) - 30
        options = {k: a[k] for k in TABLE_ATTRS if a.get(k) not in (None, False, "default", "none", "")}
        if options:
            out["options"] = options
        types = _column_types(node)
        if types:
            out["column_types"] = types
    return {k: v for k, v in out.items() if v is not None}


# Experiences block -> (list attr, what it holds) counted in outlines.
_EXPERIENCE_COUNTS = {
    "expSort": ("items", "items"), "expSequence": ("items", "items"), "expMatch": ("pairs", "pairs"),
    "expHotspot": ("spots", "spots"), "expMythFact": ("statements", "statements"),
    "expSpeedRound": ("questions", "questions"), "expSpotMistake": ("segments", "segments"),
    "expCodeLock": ("clues", "clues"), "expVenn": ("items", "items"), "expLabel": ("pins", "pins"),
    "expWordGuess": ("words", "words"), "expConfidence": ("questions", "questions"), "expMatrix": ("rows", "rows"),
}


def experience_summary(t: str, a: dict, text_limit: int = 200) -> dict:
    """Key settings of an Experiences block, for outlines."""
    out: dict[str, Any] = {"title": clip(str(a.get("title") or a.get("question") or ""), text_limit)[0] or None}
    if t in _EXPERIENCE_COUNTS:
        key, label = _EXPERIENCE_COUNTS[t]
        out[label] = len(exp.items(a.get(key)))
    if t == "expSort":
        out["categories"] = [clip(exp.text(c.get("label")), 80)[0] for c in exp.items(a.get("categories"))]
    elif t == "expGaps":
        out["gaps"] = len(exp.gap_answers(a.get("text")))
    elif t == "expEstimate":
        out["answer"] = a.get("answer")
        out["unit"] = a.get("unit") or None
    elif t == "expVenn":
        sets = a.get("sets") if isinstance(a.get("sets"), dict) else {}
        out["sets"] = [clip(exp.text(s.get("label")), 80)[0] for s in (sets.get("a"), sets.get("b")) if isinstance(s, dict)]
    elif t == "expMatrix":
        out["columns"] = [clip(exp.text(c.get("label")), 80)[0] for c in exp.items(a.get("columns"))]
    elif t == "expReflect":
        out["title"] = out["title"] or clip(exp.text(a.get("prompt")), text_limit)[0] or None
        checklist = a.get("checklist")
        out["key_points"] = len(checklist) if isinstance(checklist, list) else None
    for key in ("mode", "variant", "kind"):
        if isinstance(a.get(key), str):
            out[key] = a[key]
    return {k: v for k, v in out.items() if v is not None}
def _column_types(table: dict) -> list[str] | None:
    """Each column's cell type, read from the first body row (None when all
    columns are plain text)."""
    rows = children(table)
    body = next((r for r in rows if any(kind(c) == "tableCell" for c in children(r))), None)
    if body is None:
        return None
    types = [str((c.get("attrs") or {}).get("cellType") or "text") for c in children(body)]
    return types if any(x != "text" for x in types) else None


def _typed_summary(q: dict) -> dict:
    """The answer key of a question that is not multiple choice (outline only)."""
    qtype = q.get("type")
    if qtype == "short_answer":
        return {"type": qtype, "accepted_answers": [clip(str(x), 120)[0] for x in q.get("accepted_answers") or []]}
    if qtype == "numeric":
        return {"type": qtype, "correct_value": q.get("correct_value"), "tolerance": q.get("tolerance") or 0}
    if qtype == "true_false":
        return {"type": qtype}
    return {}


def entry(node: dict, path: list[int], text_limit: int = 1000) -> tuple[dict, str]:
    """(outline entry, full searchable text) of one block."""
    t = kind(node)
    if t in ("listItem", "taskItem"):
        kids = children(node)
        first = kids[0] if kids and kind(kids[0]) == "paragraph" else None
        full = inline_text(first) if first is not None else ""
    else:
        full = block_text(node)
    out: dict[str, Any] = {"path": list(path), "type": t}
    # Lists and tables show their parts; blocks with settings show those.
    if t not in ("bulletList", "orderedList", "table") and t not in LEAVES:
        text, cut = clip(full, text_limit)
        if text:
            out["text"] = text
        if cut:
            out["truncated"] = True
    out.update(summary(node))
    return out, full


# Layout blocks whose parts the outline lists (each tab, column, step...).
OUTLINED_CONTAINERS = frozenset({
    "tabs", "tabItem", "columns", "column", "accordion", "timeline", "timelineItem", "taskList", "keyTakeaways",
})


def outline_entries(doc: dict, text_limit: int = 1000) -> Iterator[tuple[dict, str]]:
    """(entry, full searchable text) for every block a person would point at.

    Lists show each item ([i, j]); tables show their cells in `rows` (cell
    [i, row, col]); callouts and quotes show their children only when they
    hold more than one."""
    stack: list[tuple[tuple, dict]] = [((i,), n) for i, n in reversed(list(enumerate(children(doc))))]
    while stack:
        path, node = stack.pop()
        if not isinstance(node, dict):
            continue
        t = kind(node)
        yield entry(node, list(path), text_limit)
        if len(path) >= MAX_DEPTH:
            continue
        kids = children(node)
        if t == "listItem":
            first_is_text = bool(kids) and kind(kids[0]) == "paragraph"
            rest = [(path + (j,), c) for j, c in enumerate(kids) if j > 0 or not first_is_text]
            stack.extend(reversed(rest))
        elif t in ("bulletList", "orderedList"):
            stack.extend(reversed([(path + (j,), c) for j, c in enumerate(kids)]))
        elif t in ("callout", "blockquote", "flipcardGrid") and len(kids) > 1:
            stack.extend(reversed([(path + (j,), c) for j, c in enumerate(kids)]))
        elif t in OUTLINED_CONTAINERS:
            stack.extend(reversed([(path + (j,), c) for j, c in enumerate(kids)]))
        elif t == "taskItem":
            stack.extend(reversed([(path + (j,), c) for j, c in enumerate(kids) if j > 0]))


# ─── editing ─────────────────────────────────────────────────────────────────

_OBJ = "￼"  # stands in for a non-text inline node (a line break) while matching


def _segments(block: dict) -> list[list]:
    """[text, marks, node-or-None] runs of a text-holding block."""
    segs = []
    for child in children(block):
        if kind(child) == "text":
            segs.append([child.get("text") or "", child.get("marks"), None])
        else:
            segs.append([_OBJ, None, child])
    return segs


def _rebuild(segs: list[list]) -> list:
    out: list = []
    for text, marks, node in segs:
        if node is not None:
            out.append(node)
            continue
        if not text:
            continue
        if out and kind(out[-1]) == "text" and out[-1].get("marks") == marks:
            out[-1] = {**out[-1], "text": out[-1]["text"] + text}
            continue
        out.append(text_node(text, marks) if marks else {"type": "text", "text": text})
    return out


def _replace_in_segments(segs: list[list], find: str, repl: str, limit: int | None) -> int:
    """Replace matches of `find` across runs; the new text takes the marks of
    the run where the match starts. Returns the number replaced."""
    full = "".join(s[0] for s in segs)
    starts: list[int] = []
    pos = full.find(find)
    while pos != -1 and (limit is None or len(starts) < limit):
        starts.append(pos)
        pos = full.find(find, pos + len(find))
    for start in reversed(starts):
        end = start + len(find)
        offsets = []
        acc = 0
        for s in segs:
            offsets.append(acc)
            acc += len(s[0])
        first = next(i for i in range(len(segs)) if offsets[i] <= start < offsets[i] + len(segs[i][0]))
        last = next(i for i in range(len(segs)) if offsets[i] < end <= offsets[i] + len(segs[i][0]))
        head = segs[first][0][: start - offsets[first]]
        tail = segs[last][0][end - offsets[last]:]
        marks = segs[first][1]
        new = [[head, marks, None], [repl, marks, None], [tail, segs[last][1], None]]
        segs[first:last + 1] = new
    return len(starts)


_ATTR_TEXT_KEYS = {
    "flipcard": ("question", "answer"),
    "tabItem": ("title",),
    "timelineItem": ("title", "label"),
    "keyTakeaways": ("title",),
    "tableOfContents": ("title",),
    "callout": ("title",),
    "table": ("caption",),
    "chart": ("title",),
    "fileCard": ("name", "description"),
    "quoteBlock": ("author", "role"),
}
# Blocks replace_text reaches through their attrs (besides text holders).
ATTR_TEXT_TYPES = frozenset({
    "flipcardGrid", "blockQuiz", "scenarios", "gallery", "imageCompare", "chart", "statHighlights",
    *_ATTR_TEXT_KEYS, *exp.NODE_NAMES,
})


def _attr_strings(node: dict) -> Iterator[tuple[dict, str]]:
    """(owner dict, key) of the attr strings replace_text may change."""
    t = kind(node)
    a = node.get("attrs")
    if not isinstance(a, dict):
        return
    for key in _ATTR_TEXT_KEYS.get(t, ()):
        if isinstance(a.get(key), str):
            yield a, key
    if t == "blockQuiz":
        for q in a.get("questions") or []:
            if isinstance(q, dict):
                if isinstance(q.get("question"), str):
                    yield q, "question"
                for ans in q.get("answers") or []:
                    if isinstance(ans, dict) and isinstance(ans.get("answer"), str):
                        yield ans, "answer"
    if t == "gallery":
        for img in _list_of(a.get("images")):
            if isinstance(img.get("caption"), str):
                yield img, "caption"
    if t == "imageCompare":
        for key in ("before", "after"):
            if isinstance(a.get(key), dict) and isinstance(a[key].get("label"), str):
                yield a[key], "label"
    if t == "chart" and isinstance(a.get("data"), dict):
        labels = a["data"].get("labels")
        if isinstance(labels, list):
            for i, label in enumerate(labels):
                if isinstance(label, str):
                    yield _ListSlot(labels, i), "value"
        for series in _list_of(a["data"].get("series")):
            if isinstance(series.get("name"), str):
                yield series, "name"
    if t == "statHighlights":
        for item in _list_of(a.get("items")):
            for key in ("label", "description"):
                if isinstance(item.get(key), str):
                    yield item, key
    if t == "scenarios":
        if isinstance(a.get("title"), str):
            yield a, "title"
        for s in a.get("scenarios") or []:
            if isinstance(s, dict):
                if isinstance(s.get("text"), str):
                    yield s, "text"
                for o in s.get("options") or []:
                    if isinstance(o, dict):
                        for key in ("text", "feedback"):
                            if isinstance(o.get(key), str):
                                yield o, key
                ending = s.get("ending")
                if isinstance(ending, dict) and isinstance(ending.get("title"), str):
                    yield ending, "title"
    if t == "flipcardGrid" and isinstance(a.get("title"), str):
        yield a, "title"
    yield from exp.strings(a, t)


class _ListSlot(dict):
    """A list item seen as owner[key], so replace_in can change it in place."""

    def __init__(self, items: list, index: int):
        super().__init__(value=items[index])
        self._items = items
        self._index = index

    def __setitem__(self, key: str, value: Any) -> None:
        super().__setitem__(key, value)
        self._items[self._index] = value


def text_targets(root: dict, root_path: tuple) -> Iterator[tuple[tuple, dict]]:
    """Blocks under root (root included) whose text replace_text can change."""
    if kind(root) in TEXT_HOLDERS or kind(root) in ATTR_TEXT_TYPES:
        yield root_path, root
        if kind(root) in TEXT_HOLDERS:
            return
    for path, node, _parent in walk_blocks(root):
        if kind(node) in TEXT_HOLDERS or kind(node) in ATTR_TEXT_TYPES:
            yield root_path + path, node


def count_in(node: dict, find: str) -> int:
    n = 0
    if kind(node) in TEXT_HOLDERS:
        n += "".join(s[0] for s in _segments(node)).count(find)
    for owner, key in _attr_strings(node):
        n += owner[key].count(find)
    return n


def replace_in(node: dict, find: str, repl: str, limit: int | None) -> int:
    done = 0
    if kind(node) in TEXT_HOLDERS:
        segs = _segments(node)
        done = _replace_in_segments(segs, find, repl, limit)
        if done:
            node["content"] = _rebuild(segs)
            if not node["content"]:
                node.pop("content")
    for owner, key in _attr_strings(node):
        if limit is not None and done >= limit:
            break
        value = owner[key]
        n = value.count(find)
        if not n:
            continue
        if limit is not None:
            n = min(n, limit - done)
        owner[key] = value.replace(find, repl, n)
        done += n
    return done


class Editor:
    """Applies a batch of edits to one document.

    Every path given to an operation refers to the page as it was read, so an
    earlier operation in the batch never shifts the target of a later one.
    The document is changed in place; callers work on a copy."""

    def __init__(self, doc: dict):
        self.doc = doc
        self._original: dict[tuple, dict] = {path: node for path, node, _p in walk_blocks(doc)}
        self._replaced: dict[int, dict] = {}
        self._deleted: set[int] = set()
        self.touched: list[dict] = []       # new or changed nodes to check strictly
        self.parents: list[dict] = []       # nodes whose children changed

    # navigation

    def node(self, path: list[int]) -> dict:
        key = tuple(path)
        node = self._original.get(key)
        if node is None:
            if key and key[:-1] in self._original and kind(self._original[key[:-1]]) in TEXT_HOLDERS:
                raise PathError(f"{list(path)} points inside the text of a block; address the block itself.")
            raise PathError(
                f"No block at {list(path)} in the version you read. Read the outline for current paths."
            )
        while id(node) in self._replaced:
            node = self._replaced[id(node)]
        if id(node) in self._deleted:
            raise PathError(f"The block at {list(path)} was removed by an earlier operation in this batch.")
        return node

    def place(self, node: dict, path: list[int]) -> tuple[dict, int]:
        found = find_parent(self.doc, node)
        if found is None:
            raise PathError(f"The block at {list(path)} was removed by an earlier operation in this batch.")
        return found

    def _changed_parent(self, parent: dict) -> None:
        if parent is not self.doc:
            self.parents.append(parent)

    # operations

    def insert(self, at: str, path: list[int] | None, nodes: list[dict], checked: list[dict] | None = None) -> None:
        """Insert nodes. All of them get the strict check unless `checked`
        names the ones that should (a stored media block is trusted)."""
        if at in ("start", "end"):
            kids = self.doc.setdefault("content", [])
            if kids == [{"type": "paragraph"}]:
                kids.clear()  # an empty page holds one empty paragraph
            if at == "start":
                kids[0:0] = nodes
            else:
                kids.extend(nodes)
        elif at in ("before", "after"):
            ref = self.node(path or [])
            parent, idx = self.place(ref, path or [])
            parent["content"][idx + (at == "after"): idx + (at == "after")] = nodes
            self._changed_parent(parent)
        else:
            ref = self.node(path or [])
            spec = SCHEMA.get(kind(ref))
            if spec is None or spec.content is None or kind(ref) in TEXT_HOLDERS:
                raise DocError(
                    f"Cannot insert blocks inside a {kind(ref)}; use before or after, "
                    "or set_text / set_attrs to change it."
                )
            kids = ref.setdefault("content", [])
            if at == "inside_start":
                kids[0:0] = nodes
            else:
                kids.extend(nodes)
            self._changed_parent(ref)
        self.touched.extend(nodes if checked is None else checked)

    def replace(self, path: list[int], nodes: list[dict]) -> str:
        old = self.node(path)
        parent, idx = self.place(old, path)
        parent["content"][idx: idx + 1] = nodes
        if nodes:
            self._replaced[id(old)] = nodes[0]
        else:
            self._deleted.add(id(old))
        self._changed_parent(parent)
        self.touched.extend(nodes)
        return kind(old)

    def delete(self, path: list[int]) -> dict:
        node = self.node(path)
        parent, idx = self.place(node, path)
        removed = parent["content"].pop(idx)
        self._deleted.add(id(removed))
        if parent is not self.doc and not children(parent):
            spec = SCHEMA.get(kind(parent))
            if spec and spec.content and _MODELS[spec.content][2] > 0:
                parent["content"].insert(idx, removed)
                self._deleted.discard(id(removed))
                raise DocError(
                    f"Deleting {list(path)} would leave its {kind(parent)} empty; "
                    f"delete the {kind(parent)} ({list(path[:-1])}) instead."
                )
        self._changed_parent(parent)
        return removed

    def move(self, from_path: list[int], to: str, path: list[int]) -> str:
        node = self.node(from_path)
        target = self.node(path)
        if target is node or find_path(node, target) is not None:
            raise DocError(f"Cannot move {list(from_path)} next to itself or into itself.")
        self.delete(from_path)
        self._deleted.discard(id(node))
        parent, idx = self.place(target, path)
        parent["content"].insert(idx + (to == "after"), node)
        self._changed_parent(parent)
        return kind(node)

    def set_attrs(self, path: list[int], attrs: dict) -> tuple[str, dict]:
        node = self.node(path)
        t = kind(node)
        spec = SCHEMA.get(t)
        if spec is None:
            raise DocError(f"Unknown block type {t!r} at {list(path)}.")
        if not spec.attrs:
            raise DocError(f"A {t} has no settings to change.")
        if t in MEDIA_TYPES and "blockObject" in attrs:
            raise DocError("The uploaded file of a media block cannot be changed; add a new one with add_media_block.")
        # What these blocks point at is picked in the editor, which checks the
        # member or resource is one the author may show; only display may change.
        locked = {"blockUser": ("user_id",), "blockLibrary": ("resourceUuid", "resourceType", "snapshot")}.get(t, ())
        if any(k in attrs for k in locked):
            raise DocError(f"What a {t} points at cannot be changed here; {spec.why_not.lower()}")
        if t == "blockQuiz" and "questions" in attrs:
            attrs = {**attrs, "questions": fill_quiz_ids(attrs["questions"])}
        if t == "fileCard" and "blockObject" in attrs:
            raise DocError("The uploaded file of a file card cannot be changed here; link one with url, or upload it in the editor.")
        if t == "callout":
            attrs = callout_kind_attrs(attrs)
        current = dict(node.get("attrs") or {})
        before = {k: current.get(k) for k in attrs}
        for key, value in attrs.items():
            if value is None:
                current.pop(key, None)
            else:
                current[key] = value
        problems = attrs_problems(t, {k: v for k, v in current.items() if k in attrs}, tuple(path))
        if problems:
            raise DocError(" ".join(problems))
        node["attrs"] = current
        return t, before

    def set_text(self, path: list[int], inline: list, literal: str) -> str:
        """Replace the text of a block. `inline` is the parsed inline content
        (for prose blocks), `literal` the plain text (for code and text-only
        blocks)."""
        node = self.node(path)
        t = kind(node)
        if t in ("listItem", "taskItem"):
            kids = node.setdefault("content", [])
            if kids and kind(kids[0]) == "paragraph":
                target = kids[0]
            else:
                target = {"type": "paragraph"}
                kids.insert(0, target)
            _set_inline(target, inline)
            return t
        if t in ("paragraph", "heading"):
            _set_inline(node, inline)
            return t
        if t in TEXT_HOLDERS:
            if literal:
                node["content"] = [{"type": "text", "text": literal}]
            else:
                node.pop("content", None)
            return t
        if t in ("callout", "blockquote", "quoteBlock"):
            paragraphs = []
            current: list = []
            for item in inline:
                if kind(item) == "hardBreak":
                    paragraphs.append(paragraph(current))
                    current = []
                else:
                    current.append(item)
            paragraphs.append(paragraph(current))
            node["content"] = paragraphs
            return t
        raise DocError(
            f"A {t} has no text of its own to set. "
            + ("Change its settings with set_attrs." if t in LEAVES else "Address one of its children, or use replace_block.")
        )

    def check(self) -> None:
        """Strict checks on everything this batch created or changed, then
        the load check on the whole page."""
        if not children(self.doc):
            self.doc["content"] = [{"type": "paragraph"}]
        for node in self.touched:
            path = find_path(self.doc, node)
            if path is None:
                continue
            strip_link_extras(node)
            check_new(node, tuple(path))
        for parent in self.parents:
            path = find_path(self.doc, parent)
            if path is None:
                continue
            problem = content_problem(parent, tuple(path))
            if problem:
                raise DocError(problem)
        for i, child in enumerate(children(self.doc)):
            if kind(child) not in BLOCK_TYPES:
                raise DocError(f"A {kind(child)} cannot sit at the top of the page ([{i}]); put it inside its container.")
        check_loadable(self.doc)


def _set_inline(node: dict, inline: list) -> None:
    if inline:
        node["content"] = inline
    else:
        node.pop("content", None)
