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

MAX_DEPTH = 40
MAX_DOC_CHARS = 2_000_000
CALLOUT_TYPES = ("info", "warning", "tip", "success", "error")


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


_MEDIA = "Add media with add_media_block (it uploads the file and inserts the block)."

SCHEMA: dict[str, Spec] = {
    "doc": Spec("", "block+"),
    "text": Spec(INLINE, None),
    "hardBreak": Spec(INLINE, None),
    "paragraph": Spec(BLOCK, "inline*"),
    "heading": Spec(BLOCK, "inline*", ("level",)),
    "blockquote": Spec(BLOCK, "block+"),
    "bulletList": Spec(BLOCK, "listItem+"),
    "orderedList": Spec(BLOCK, "listItem+", ("start", "type")),
    "listItem": Spec("", "paragraph block*"),
    "codeBlock": Spec(BLOCK, "text*", ("language", "filename"), marks=False),
    "horizontalRule": Spec(BLOCK, None, ("variant",)),
    "table": Spec(BLOCK, "tableRow+"),
    "tableRow": Spec("", "(tableCell | tableHeader)*"),
    "tableCell": Spec("", "block+", ("colspan", "rowspan", "colwidth")),
    "tableHeader": Spec("", "block+", ("colspan", "rowspan", "colwidth")),
    "callout": Spec(BLOCK, "(paragraph | bulletList | orderedList)+", ("type", "dismissible", "icon")),
    # Collapsible section from the editor's block menu.
    "toggleBlock": Spec(BLOCK, "block+", ("summary", "defaultOpen")),
    # Blocks shown only to readers matching `rules` (Extensions/Dynamic); the
    # API drops them for everyone else (dynamic_content.py).
    "conditionalBlock": Spec(BLOCK, "block+", ("rules", "hiddenMessage", "label", "openRules")),
    # Inline placeholder ({{user.first_name}}) the API fills per reader.
    "dynamicVariable": Spec(INLINE, None, ("path", "fallback", "format")),
    "calloutInfo": Spec(BLOCK, "text*", authorable=False, why_not="Use a callout with type 'info'."),
    "calloutWarning": Spec(BLOCK, "text*", authorable=False, why_not="Use a callout with type 'warning'."),
    "badge": Spec(BLOCK, "text*", ("color", "emoji")),
    "button": Spec(BLOCK, "text*", ("emoji", "link", "color", "alignment")),
    "flipcard": Spec(BLOCK, "text*", ("question", "answer", "color", "alignment", "size", "style")),
    "flipcardGrid": Spec(BLOCK, "flipcard+", ("columns",)),
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
    "scenarios": Spec(BLOCK, None, ("title", "scenarios", "currentScenarioId")),
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
         "unsplash_photographer_url", "unsplash_photo_url", "alt", "caption", "href", "lightbox"),
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
}


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
        need = "a paragraph first" if first else f"at least one of {_names(rest)}"
        return f"A {kind(node)} at {_where(path)} needs {need}."
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
        answers = q.get("answers")
        if not isinstance(answers, list) or not 2 <= len(answers) <= 12:
            return f"question {i} needs 2 to 12 answers"
        if not any(isinstance(a, dict) and a.get("correct") is True for a in answers):
            return f"question {i} needs at least one correct answer"
        qid = q.get("question_id")
        if not isinstance(qid, str) or not qid or qid in ids:
            return f"question {i} needs a unique question_id"
        ids.add(qid)
        for j, a in enumerate(answers):
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
    return None


_ALIGN = _one_of("left", "center", "right")


def _image_size(v: Any) -> str | None:
    """The editor stores an image's size as {"width": pixels}."""
    if v is None:
        return None
    if not isinstance(v, dict) or set(v) - {"width"}:
        return 'must be {"width": pixels}'
    return _int(50, 5000, null=True)(v.get("width"))

_VALIDATORS: dict[str, dict[str, Callable[[Any], str | None]]] = {
    "heading": {"level": _int(1, 6)},
    "orderedList": {"start": _int(0, 1_000_000), "type": _one_of(None, "1", "a", "A", "i", "I")},
    "codeBlock": {"language": _language},
    "tableCell": {"colspan": _int(1, 100), "rowspan": _int(1, 100)},
    "tableHeader": {"colspan": _int(1, 100), "rowspan": _int(1, 100)},
    "callout": {"type": _one_of(*CALLOUT_TYPES), "dismissible": _bool},
    "badge": {"color": _str(30), "emoji": _str(16)},
    "button": {"emoji": _str(16), "link": _url(empty=True), "color": _str(30), "alignment": _ALIGN},
    "flipcard": {
        "question": _str(2000, null=False), "answer": _str(2000, null=False),
        "color": _str(30), "alignment": _ALIGN, "size": _one_of("small", "medium", "large"),
        "style": _one_of(None, "solid", "soft", "outline"),
    },
    "flipcardGrid": {"columns": _int(1, 6)},
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
    "blockQuiz": {"quizId": _str(100), "questions": _quiz_questions},
    "scenarios": {"title": _str(500), "scenarios": _scenarios, "currentScenarioId": _str(100)},
    "blockMagic": {"htmlContent": _str(500_000), "title": _str(200), "height": _int(50, 5000)},
    "blockH5P": {"h5pUrl": _url(null=False), "title": _str(500), "height": _int(50, 5000)},
    "blockImage": {
        "alignment": _ALIGN, "size": _image_size, "unsplash_url": _url(),
        "unsplash_photographer_name": _str(200), "unsplash_photographer_url": _url(),
        "unsplash_photo_url": _url(),
    },
    "youtube": {"src": _url(null=False), "start": _int(0, 1_000_000, null=True)},
    "toggleBlock": {"summary": _str(300), "defaultOpen": _bool},
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
    "favicon", "imageUrl", "unsplash_url", "unsplash_photographer_url", "unsplash_photo_url",
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
        value = attrs[key]
        if value not in (None, "") and not is_web_url(value):
            out.append(f"{t}.{key} must be an http(s) URL.")
    if t == "blockEmbed" and not (attrs.get("embedUrl") or attrs.get("embedCode")):
        out.append("A blockEmbed needs embedUrl or embedCode.")
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


def quiz_node(questions: list[dict]) -> dict:
    """A blockQuiz from the simple shape [{text, options: [{text, correct}],
    explanation?}], with the ids the editor expects generated here."""
    out = []
    for q in questions:
        answers = [
            {"answer_id": f"answer_{uuid.uuid4()}", "answer": o["text"], "correct": bool(o["correct"])}
            for o in q["options"]
        ]
        correct = sum(1 for a in answers if a["correct"])
        question = {
            "question_id": f"question_{uuid.uuid4()}",
            "question": q["text"],
            "type": "multiple_choice",
            "response_type": "multiple" if correct >= 2 else "single",
            "answers": answers,
        }
        if q.get("explanation"):
            question["explanation"] = q["explanation"]
        out.append(question)
    return {"type": "blockQuiz", "attrs": {"quizId": f"quiz_{uuid.uuid4()}", "questions": out}}


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
        for row in children(node):
            rows.append(" | ".join(block_text(cell, depth + 2).replace("\n", " ") for cell in children(row)))
        return "\n".join(rows)
    parts = [block_text(c, depth + 1) for c in children(node)]
    return "\n".join(p for p in parts if p)


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
                lines.extend(str(o.get("text") or "") for o in s.get("options") or [] if isinstance(o, dict))
        return "\n".join(lines)
    if t == "blockMathEquation":
        return str(a.get("math_equation") or "")
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
        out["callout_type"] = a.get("type") or "info"
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
    elif t in ("blockMagic", "blockH5P"):
        out["title"] = a.get("title")
    elif t == "button":
        out["link"] = a.get("link")
    elif t == "badge":
        out["emoji"] = a.get("emoji")
    elif t == "blockLibrary":
        out["resource"] = {"uuid": a.get("resourceUuid"), "kind": a.get("resourceType")}
    elif t in ("bulletList", "orderedList", "flipcardGrid", "callout", "blockquote"):
        out["children"] = len(children(node))
    elif t == "table":
        rows = children(node)
        out["rows"] = [
            [clip(block_text(cell, 0).replace("\n", " "), 120)[0] for cell in children(row)][:20]
            for row in rows[:30]
        ]
        if len(rows) > 30:
            out["more_rows"] = len(rows) - 30
    return {k: v for k, v in out.items() if v is not None}


def entry(node: dict, path: list[int], text_limit: int = 1000) -> tuple[dict, str]:
    """(outline entry, full searchable text) of one block."""
    t = kind(node)
    if t == "listItem":
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


_ATTR_TEXT_KEYS = {"flipcard": ("question", "answer")}


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
    if t == "scenarios":
        if isinstance(a.get("title"), str):
            yield a, "title"
        for s in a.get("scenarios") or []:
            if isinstance(s, dict):
                if isinstance(s.get("text"), str):
                    yield s, "text"
                for o in s.get("options") or []:
                    if isinstance(o, dict) and isinstance(o.get("text"), str):
                        yield o, "text"


def text_targets(root: dict, root_path: tuple) -> Iterator[tuple[tuple, dict]]:
    """Blocks under root (root included) whose text replace_text can change."""
    if kind(root) in TEXT_HOLDERS or kind(root) in ("flipcard", "blockQuiz", "scenarios"):
        yield root_path, root
        if kind(root) in TEXT_HOLDERS:
            return
    for path, node, _parent in walk_blocks(root):
        if kind(node) in TEXT_HOLDERS or kind(node) in ("flipcard", "blockQuiz", "scenarios"):
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
        if t == "listItem":
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
        if t in ("callout", "blockquote"):
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
