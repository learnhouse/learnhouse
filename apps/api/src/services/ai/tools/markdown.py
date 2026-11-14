"""Markdown to page documents and back.

Models write Markdown far more reliably than editor JSON, so the content tools
accept it and convert here, and can show a page as Markdown.

Markdown in: headings (ATX and setext), paragraphs with soft and hard line
breaks, **bold**, *italic*, ~~strike~~, `code`, [links](https://...),
<https://autolinks>, backslash escapes, bullet and numbered lists (nested by
indentation), fenced code, blockquotes, GitHub alerts (> [!TIP]) as callouts,
tables, horizontal rules and $$ display math $$. Only http(s) links are kept
(the editor refuses other schemes). Images become links with their alt text,
since the editor stores pictures as uploaded files; with media=True, an image
alone on a top-level line and ```image / ```video / ```audio / ```pdf fences
are listed in Converted.media so the caller can fetch and store them (see
content_assets.attach_media), each standing in as a link until then.
Inline $math$ stays text: the editor has no inline math. Fenced blocks named
quiz, flipcards, embed, button or badge become those rich blocks (see
fences.py); a fence that cannot be read fails the call with the line number.

Everything runs in linear time and bounded depth: input is capped at
MAX_CHARS, lists nest at most MAX_LIST_DEPTH levels and quotes at most
MAX_QUOTE_DEPTH (deeper markers are kept as text).

Markdown out (`doc_to_markdown`): prose blocks render as Markdown, quizzes,
flipcards, embeds, buttons and badges as their fences; blocks Markdown cannot
express (media, scenarios, code exercises, ...) render as an HTML comment that
names the block's path and type, with a readable summary. Writing that
Markdown back with mode=replace keeps those blocks as they are.
"""

from __future__ import annotations

import re
import string
from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException

from src.services.ai.tools import doc_ops as d
from src.services.ai.tools import fences

MAX_CHARS = 200_000
MAX_LIST_DEPTH = 8
MAX_QUOTE_DEPTH = 20
MAX_TABLE_COLUMNS = 30

KEEP = "__keep__"  # placeholder node type for a block kept from the current page

MEDIA_FENCES = ("image", "video", "audio", "pdf")
_MEDIA_SETTINGS = {"caption", "width", "align", "height", "url"}
# ```video names a stored file only when it links one; any other URL (YouTube,
# Vimeo, ...) stays an embed, as before.
_VIDEO_FILE = re.compile(r"^(?:url:\s*)?<?https?://\S+\.(?:mp4|webm|mov|m4v)(?:[?#]\S*)?>?$", re.IGNORECASE)
_ALIGN = ("left", "center", "right")
_IMAGE_LINE = re.compile(r'^!\[([^\]\n]{0,500})\]\(<?(\S{1,2048}?)>?(?:\s+"([^"\n]{0,500})")?\)$')
_MEDIA_ELSEWHERE = (
    "Images and media fences are stored only at the top level of a page written with "
    "write_activity_content, create_activity, create_activities or create_course; here they "
    "became links. Add the file with add_media_block."
)

_ALERTS = {
    "note": "info", "info": "info", "important": "info", "tip": "tip",
    "success": "success", "warning": "warning", "caution": "error",
    "danger": "error", "error": "error",
}
_ALERT_OUT = {"info": "NOTE", "tip": "TIP", "success": "SUCCESS", "warning": "WARNING", "error": "CAUTION"}

_PUNCT = frozenset(string.punctuation)
_LIST = re.compile(r"^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$")
# The editor has no checklist block: "- [ ] task" becomes a bullet starting
# with a box, rather than showing the brackets as text.
_TASK = re.compile(r"^\[([ xX])\]\s+")


def _task_box(text: str) -> str:
    return _TASK.sub(lambda m: "\u2610 " if m.group(1) == " " else "\u2611 ", text, count=1)

_QUOTE = re.compile(r"^ {0,3}>[ \t]?(.*)$")
_ALERT = re.compile(r"^\[!([A-Za-z]{2,12})\][ \t]*(.*)$")
_KEEP = re.compile(r"^<!--\s*block\s+\[([\d,\s]{1,200})\]\s+([A-Za-z]{1,40})")
_TABLE_CELL = re.compile(r"^:?-+:?$")


def _fence_open(line: str) -> tuple[str, str | None] | None:
    """(marker, language) when the line opens a code fence."""
    s = line.lstrip(" ")
    c = s[:1]
    if c not in ("`", "~"):
        return None
    run = len(s) - len(s.lstrip(c))
    if run < 3:
        return None
    info = s[run:].strip()
    if c == "`" and "`" in info:
        return None
    language = info.split()[0] if info else None
    if language and not re.fullmatch(r"[\w+#.\-]{1,40}", language):
        language = None
    return c * run, language


@dataclass
class Media:
    """A file the Markdown asks for: stored by the caller, which swaps `node`
    (a link to the URL, standing in until then) for the media block."""

    kind: str
    url: str
    node: dict
    caption: str = ""
    attrs: dict = field(default_factory=dict)


@dataclass
class Converted:
    doc: dict
    notes: list[str] = field(default_factory=list)
    media: list[Media] = field(default_factory=list)


def markdown_to_doc(text: str) -> dict:
    """A full editor document from Markdown. Raises HTTPException(400) for
    input over MAX_CHARS."""
    return convert(text).doc


def convert(text: str, *, keep_blocks: bool = False, media: bool = False) -> Converted:
    """Markdown to a document plus notes on anything that was changed.

    With keep_blocks, the block comments doc_to_markdown writes become
    placeholder nodes (type KEEP) the caller swaps for the original blocks.
    With media, top-level images and media fences are listed in .media."""
    text = text or ""
    if len(text) > MAX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Markdown is {len(text)} characters; the limit is {MAX_CHARS}. Split the page or write it in parts (mode=append).",
        )
    parser = _Parser(keep_blocks, media)
    lines = text.replace("\r\n", "\n").replace("\r", "\n").replace("\t", "    ").split("\n")
    content = parser.blocks(lines, 0, 0)
    return Converted(
        {"type": "doc", "content": content or [{"type": "paragraph"}]}, sorted(parser.notes), parser.media
    )


def callout(callout_type: str, text: str) -> tuple[dict, list[str]]:
    """A callout block from Markdown (paragraphs and lists; other blocks are
    flattened into paragraphs)."""
    if len(text or "") > MAX_CHARS:
        raise HTTPException(status_code=400, detail=f"Callout text is limited to {MAX_CHARS} characters.")
    parser = _Parser(False)
    lines = (text or "").replace("\r\n", "\n").replace("\r", "\n").replace("\t", "    ").split("\n")
    content = parser._callout_content(parser.blocks(lines, 0, 1))
    node = {
        "type": "callout",
        "attrs": {"type": callout_type, "dismissible": False},
        "content": content or [{"type": "paragraph"}],
    }
    return node, sorted(parser.notes)


def inline(text: str) -> list[dict]:
    """Inline Markdown to text nodes with marks (and line breaks)."""
    notes: set[str] = set()
    return _Inline(text, notes).nodes()


# ─── inline ──────────────────────────────────────────────────────────────────


def _is_space(c: str) -> bool:
    return c == "" or c.isspace()


class _Inline:
    """One left-to-right pass: code spans, links, escapes and breaks become
    tokens; emphasis runs are matched with per-kind stacks (each delimiter is
    pushed and popped at most once), so the work is linear in the text."""

    def __init__(self, text: str, notes: set[str], links: bool = True):
        self.text = text
        self.notes = notes
        self.links = links
        self.tokens: list[list] = []

    # precomputation

    def _prepare(self) -> None:
        t = self.text
        n = len(t)
        # backtick runs: the closer of a run is the next run of the same length
        self.tick_close: dict[int, int] = {}
        last_by_len: dict[int, int] = {}
        i = 0
        while i < n:
            if t[i] == "`":
                j = i
                while j < n and t[j] == "`":
                    j += 1
                length = j - i
                if length in last_by_len:
                    self.tick_close[last_by_len[length]] = i
                last_by_len[length] = i
                i = j
            else:
                i += 1
        # bracket pairs
        self.bracket: dict[int, int] = {}
        stack: list[int] = []
        escaped = False
        for i, c in enumerate(t):
            if escaped:
                escaped = False
                continue
            if c == "\\":
                escaped = True
            elif c == "[":
                stack.append(i)
            elif c == "]" and stack:
                self.bracket[stack.pop()] = i
        # next whitespace or ')' / '>' / '"' at or after each position
        self.stop = [n] * (n + 1)
        self.gt = [n] * (n + 1)
        self.quote = [n] * (n + 1)
        for i in range(n - 1, -1, -1):
            c = t[i]
            self.stop[i] = i if (c.isspace() or c == ")") else self.stop[i + 1]
            self.gt[i] = i if c == ">" else self.gt[i + 1]
            self.quote[i] = i if c == '"' else self.quote[i + 1]

    # tokens: ["text", s] ["code", s] ["break"] ["link", href, nodes] ["delim", char, units...]

    def _text(self, s: str) -> None:
        if not s:
            return
        if self.tokens and self.tokens[-1][0] == "text":
            self.tokens[-1][1] += s
        else:
            self.tokens.append(["text", s])

    def _link_at(self, i: int) -> tuple[int, str] | None:
        """(end index, href) for a [label](url "title") starting at i."""
        t = self.text
        close = self.bracket.get(i)
        if close is None or close + 1 >= len(t) or t[close + 1] != "(":
            return None
        start = close + 2
        while start < len(t) and t[start] == " ":
            start += 1
        end = self.stop[start]
        url = t[start:end] if end - start <= 2048 else ""
        if url.count("(") > url.count(")") and end + 1 < len(t) and t[end] == ")" and t[end + 1] == ")":
            end += 1
            url = t[start:end]
        k = end
        while k < len(t) and t[k] == " ":
            k += 1
        if k < len(t) and t[k] == '"':
            q = self.quote[k + 1]
            if q >= len(t):
                return None
            k = q + 1
            while k < len(t) and t[k] == " ":
                k += 1
        if k >= len(t) or t[k] != ")":
            return None
        return k + 1, url

    def _emit_link(self, label: str, url: str) -> None:
        if url.lower().startswith(("http://", "https://")) and d.is_web_url(url):
            nodes = _Inline(label, self.notes, links=False).nodes() if label else [d.text_node(url)]
            self.tokens.append(["link", url, nodes])
            return
        self.notes.add("Links that are not http(s) were kept as plain text (the editor only links to web pages).")
        shown = label or url
        if url.lower().startswith("mailto:") and url[7:] and url[7:] not in shown:
            shown = f"{shown} ({url[7:]})"
        for node in _Inline(shown, self.notes, links=False).nodes():
            self.tokens.append(["node", node])

    def _delim(self, i: int) -> int:
        t = self.text
        c = t[i]
        j = i
        while j < len(t) and t[j] == c:
            j += 1
        count = j - i
        if c == "~" and count != 2 or count > 3:
            self._text(t[i:j])
            return j
        prev = t[i - 1] if i > 0 else ""
        nxt = t[j] if j < len(t) else ""
        left = not _is_space(nxt) and (nxt not in _PUNCT or _is_space(prev) or prev in _PUNCT)
        right = not _is_space(prev) and (prev not in _PUNCT or _is_space(nxt) or nxt in _PUNCT)
        if c == "_":
            can_open = left and (not right or prev in _PUNCT)
            can_close = right and (not left or nxt in _PUNCT)
        else:
            can_open, can_close = left, right
        if not (can_open or can_close):
            self._text(t[i:j])
            return j
        self.tokens.append(["delim", c, count, can_open, can_close])
        return j

    def _tokenize(self) -> None:
        t = self.text
        n = len(t)
        self._prepare()
        buf: list[str] = []
        i = 0

        def flush() -> None:
            if buf:
                self._text("".join(buf))
                buf.clear()

        while i < n:
            c = t[i]
            if c == "\\" and i + 1 < n:
                nxt = t[i + 1]
                if nxt == "\n":
                    flush()
                    self.tokens.append(["break"])
                    i += 2
                    continue
                if nxt in _PUNCT:
                    buf.append(nxt)
                    i += 2
                    continue
                buf.append(c)
                i += 1
                continue
            if c == "`":
                j = i
                while j < n and t[j] == "`":
                    j += 1
                close = self.tick_close.get(i)
                if close is None:
                    buf.append(t[i:j])
                    i = j
                    continue
                code = t[j:close].replace("\n", " ")
                if len(code) > 2 and code[0] == " " and code[-1] == " " and code.strip():
                    code = code[1:-1]
                flush()
                if code:
                    self.tokens.append(["code", code])
                i = close + (j - i)
                continue
            if c == "\n":
                trailing = 0
                while buf and buf[-1] == " ":
                    buf.pop()
                    trailing += 1
                flush()
                if trailing >= 2:
                    self.tokens.append(["break"])
                else:
                    self._text(" ")
                i += 1
                while i < n and t[i] == " ":
                    i += 1
                continue
            if self.links and c == "!" and i + 1 < n and t[i + 1] == "[":
                found = self._link_at(i + 1)
                if found:
                    end, url = found
                    flush()
                    alt = t[i + 2: self.bracket[i + 1]]
                    self.notes.add(
                        "Images became links: the editor stores pictures as uploaded files. "
                        "Add them with add_media_block (kind=image)."
                    )
                    self._emit_link(alt or url, url)
                    i = end
                    continue
            if self.links and c == "[":
                found = self._link_at(i)
                if found:
                    end, url = found
                    flush()
                    self._emit_link(t[i + 1: self.bracket[i]], url)
                    i = end
                    continue
            if self.links and c == "<":
                close = self.gt[i + 1]
                inner = t[i + 1: close] if close < n and close - i <= 2050 else ""
                if inner and d.is_web_url(inner):
                    flush()
                    self.tokens.append(["link", inner, [d.text_node(inner)]])
                    i = close + 1
                    continue
            if c in "*_~":
                flush()
                i = self._delim(i)
                continue
            buf.append(c)
            i += 1
        flush()

    def _match(self) -> None:
        """Pair emphasis delimiters; unmatched ones turn back into text."""
        stacks: dict[tuple[str, int], list[tuple[int, int]]] = {}
        seq = 0
        for idx, tok in enumerate(self.tokens):
            if tok[0] != "delim":
                continue
            _k, c, count, can_open, can_close = tok
            units = [2] if c == "~" else {1: [1], 2: [2], 3: [2, 1]}[count]
            closes: list[int] = []
            if can_close:
                for size in reversed(units):
                    stack = stacks.get((c, size))
                    if not stack:
                        continue
                    opener_idx, opener_seq = stack.pop()
                    self.tokens[opener_idx][5].append(size)
                    closes.append(size)
                    for other in stacks.values():
                        while other and other[-1][1] > opener_seq:
                            other.pop()
                for size in closes:
                    units.remove(size)
            tok.append([])        # [5] sizes this delimiter opens (filled by closers)
            tok.append(closes)    # [6] sizes it closes, innermost first
            tok.append([])        # [7] candidate opening sizes, outermost first
            if can_open:
                for size in units:
                    seq += 1
                    stacks.setdefault((c, size), []).append((idx, seq))
                    tok[7].append(size)

    def nodes(self) -> list[dict]:
        self._tokenize()
        self._match()
        out: list[dict] = []
        active: list[str] = []
        mark_of = {("*", 1): "italic", ("_", 1): "italic", ("*", 2): "bold", ("_", 2): "bold", ("~", 2): "strike"}
        pending: list[str] = []
        pending_marks: list[list] = [[]]

        def flush() -> None:
            if pending:
                out.append(d.text_node("".join(pending), pending_marks[0]))
                pending.clear()

        def add_text(s: str, extra: list[dict] | None = None) -> None:
            if not s:
                return
            m = [{"type": t} for t in dict.fromkeys(active)] + (extra or [])
            if m != pending_marks[0]:
                flush()
                pending_marks[0] = m
            pending.append(s)

        def add_node(node: dict) -> None:
            flush()
            out.append(node)

        for tok in self.tokens:
            kind = tok[0]
            if kind == "text":
                add_text(tok[1])
            elif kind == "code":
                add_node(d.text_node(tok[1], [{"type": "code"}]))
            elif kind == "break":
                add_node({"type": "hardBreak"})
            elif kind == "node":
                node = tok[1]
                if node.get("type") == "text":
                    add_text(node["text"], [m for m in node.get("marks", []) if m["type"] not in active])
                else:
                    add_node(node)
            elif kind == "link":
                link = {"type": "link", "attrs": {"href": tok[1]}}
                for node in tok[2]:
                    if node.get("type") != "text":
                        add_node(node)
                        continue
                    inner = [m for m in node.get("marks", []) if m["type"] not in active]
                    if any(m["type"] == "code" for m in inner):
                        add_node(d.text_node(node["text"], [{"type": "code"}]))
                    else:
                        add_text(node["text"], inner + [link])
            else:
                _k, c, count, _o, _c, opens, closes, candidates = tok
                used = 0
                for size in closes:
                    name = mark_of[(c, size)]
                    for k in range(len(active) - 1, -1, -1):
                        if active[k] == name:
                            del active[k]
                            break
                    used += size
                literal = count - used - sum(opens)
                if literal > 0:
                    add_text(c * literal)
                for size in candidates:
                    if size in opens:
                        active.append(mark_of[(c, size)])
        flush()
        return d.clean_marks([n for n in out if n.get("type") != "text" or n.get("text")])


# ─── blocks ──────────────────────────────────────────────────────────────────


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _is_hr(line: str) -> bool:
    s = line.strip()
    if len(s) < 3 or s[0] not in "-*_" or _indent(line) > 3:
        return False
    chars = s.replace(" ", "")
    return len(chars) >= 3 and chars == s[0] * len(chars)


def _setext(line: str) -> int:
    s = line.strip()
    if not s or _indent(line) > 3:
        return 0
    if s == "=" * len(s):
        return 1
    if s == "-" * len(s):
        return 2
    return 0


def _heading(line: str) -> tuple[int, str] | None:
    s = line.lstrip(" ")
    if len(line) - len(s) > 3 or not s.startswith("#"):
        return None
    level = len(s) - len(s.lstrip("#"))
    if level > 6:
        return None
    rest = s[level:]
    if rest and rest[0] not in " \t":
        return None
    rest = rest.strip()
    if rest.endswith("#"):
        stripped = rest.rstrip("#")
        if not stripped or stripped.endswith((" ", "\t")):
            rest = stripped.strip()
    return level, rest


def _split_row(line: str) -> list[str]:
    s = line.strip().removeprefix("|")
    if s.endswith("|") and not s.endswith("\\|"):
        s = s[:-1]
    cells, cur, i = [], [], 0
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s) and s[i + 1] == "|":
            cur.append("\\|")
            i += 2
            continue
        if s[i] == "|":
            cells.append("".join(cur).strip())
            cur = []
        else:
            cur.append(s[i])
        i += 1
    cells.append("".join(cur).strip())
    return cells


def _is_table_sep(line: str) -> bool:
    if "-" not in line:
        return False
    cells = _split_row(line)
    return bool(cells) and all(_TABLE_CELL.match(c) for c in cells)


class _Parser:
    def __init__(self, keep_blocks: bool, media: bool = False):
        self.keep_blocks = keep_blocks
        self.want_media = media
        self.media: list[Media] = []
        self.notes: set[str] = set()

    def inline(self, text: str) -> list[dict]:
        return _Inline(text, self.notes).nodes()

    def paragraph(self, lines: list[str]) -> dict:
        text = "\n".join(line.lstrip() for line in lines).rstrip()
        return d.paragraph(self.inline(text))

    def _starts_block(self, line: str) -> bool:
        return bool(
            _heading(line) or _fence_open(line) or _QUOTE.match(line) or _is_hr(line)
            or _LIST.match(line) or line.strip() == "$$" or line.lstrip().startswith("<!--")
        )

    def blocks(self, lines: list[str], list_depth: int, quote_depth: int) -> list[dict]:
        out: list[dict] = []
        para: list[str] = []

        def flush() -> None:
            if para:
                image = _IMAGE_LINE.match(para[0].strip()) if len(para) == 1 else None
                if image and d.is_web_url(image.group(2)):
                    out.append(self._media("image", image.group(2), image.group(3) or image.group(1), {},
                                           top=list_depth == 0 and quote_depth == 0))
                else:
                    out.append(self.paragraph(para))
                para.clear()

        n = len(lines)
        # closes[i]: first line at or after i that ends an HTML comment
        closes = [n] * (n + 1)
        for k in range(n - 1, -1, -1):
            closes[k] = k if "-->" in lines[k] else closes[k + 1]
        i = 0
        while i < n:
            line = lines[i]
            stripped = line.strip()
            if not stripped:
                flush()
                i += 1
                continue
            if para:
                level = _setext(line)
                if level:
                    content = self.inline("\n".join(p.strip() for p in para))
                    para.clear()
                    out.append(_heading_node(level, content))
                    i += 1
                    continue
                if not self._starts_block(line) and not ("|" in line and i + 1 < n and _is_table_sep(lines[i + 1])):
                    para.append(line)
                    i += 1
                    continue
            flush()
            if stripped.startswith("<!--") and closes[i] < n:
                i = self._comment(lines, i, out, top=(list_depth == 0 and quote_depth == 0))
                continue
            fence = _fence_open(line)
            if fence:
                i = self._fence(lines, i, fence, out, top=list_depth == 0 and quote_depth == 0)
                continue
            if stripped.startswith("$$"):
                done = self._math(lines, i, out)
                if done is not None:
                    i = done
                    continue
            heading = _heading(line)
            if heading:
                out.append(_heading_node(heading[0], self.inline(heading[1])))
                i += 1
                continue
            if _is_hr(line):
                out.append({"type": "horizontalRule"})
                i += 1
                continue
            if _LIST.match(line):
                node, i = self._list(lines, i, list_depth, quote_depth)
                out.append(node)
                continue
            if _QUOTE.match(line):
                i = self._quote(lines, i, out, list_depth, quote_depth)
                continue
            if "|" in line and i + 1 < n and _is_table_sep(lines[i + 1]):
                i = self._table(lines, i, out)
                continue
            para.append(line)
            i += 1
        flush()
        return out

    def _comment(self, lines: list[str], i: int, out: list, top: bool) -> int:
        start = i
        while i < len(lines) and "-->" not in lines[i]:
            i += 1
        header = lines[start].strip()
        keep = _KEEP.match(header)
        if keep and self.keep_blocks:
            if top:
                try:
                    path = [int(x) for x in keep.group(1).replace(" ", "").split(",") if x != ""]
                except ValueError:
                    path = []
                if path:
                    out.append({"type": KEEP, "path": path, "node_type": keep.group(2)})
            else:
                self.notes.add("Block comments inside lists or quotes were ignored; keep them at the top level.")
        return i + 1

    def _media(self, kind: str, url: str, caption: str, attrs: dict, *, top: bool) -> dict:
        """A link to the file, listed in .media when the caller stores files."""
        caption = caption.strip()
        node = d.paragraph([d.text_node(caption or url, [{"type": "link", "attrs": {"href": url}}])])
        if self.want_media and top:
            self.media.append(Media(kind, url, node, caption, attrs))
        else:
            self.notes.add(_MEDIA_ELSEWHERE)
        return node

    def _media_fence(self, kind: str, body: str, top: bool) -> dict:
        url = ""
        settings: dict[str, str] = {}
        for raw in body.split("\n"):
            line = raw.strip()
            if not line:
                continue
            key, sep, value = line.partition(":")
            if sep and key.strip().lower() in _MEDIA_SETTINGS and not value.startswith("//"):
                if key.strip().lower() != "url":
                    settings[key.strip().lower()] = value.strip()
                    continue
                line = value.strip()
            if url:
                raise fences.FenceError(f"one file per ```{kind} block; '{line[:60]}' is a second line")
            image = _IMAGE_LINE.match(line)
            if image:
                url = image.group(2)
                settings.setdefault("caption", image.group(3) or image.group(1))
            else:
                url = line.strip("<>")
        if not url:
            raise fences.FenceError("put the file's http(s) URL on the first line")
        if not d.is_web_url(url):
            raise fences.FenceError(f"'{url[:80]}' is not an http(s) URL")
        attrs: dict[str, Any] = {}
        if "width" in settings and kind == "image":
            width = settings["width"].removesuffix("px")
            if not width.isdigit() or not 50 <= int(width) <= 2000:
                raise fences.FenceError("width is in pixels, 50 to 2000")
            attrs["size"] = {"width": int(width)}
        if "align" in settings and kind == "image":
            if settings["align"].lower() not in _ALIGN:
                raise fences.FenceError("align is left, center or right")
            attrs["alignment"] = settings["align"].lower()
        if "height" in settings and kind == "pdf":
            height = settings["height"].removesuffix("px")
            if not height.isdigit() or not 200 <= int(height) <= 3000:
                raise fences.FenceError("height is in pixels, 200 to 3000")
            attrs["pdfHeight"] = int(height)
        return self._media(kind, url, settings.get("caption", ""), attrs, top=top)

    def _fence(self, lines: list[str], i: int, fence: tuple[str, str | None], out: list, top: bool = False) -> int:
        marker, language = fence
        base = _indent(lines[i])
        code: list[str] = []
        start = i
        i += 1
        while i < len(lines):
            s = lines[i].strip()
            if s and s[0] == marker[0] and s == marker[0] * len(s) and len(s) >= len(marker):
                i += 1
                break
            line = lines[i]
            code.append(line[min(base, _indent(line)):])
            i += 1
        body = "\n".join(code)
        if (language or "").lower() in MEDIA_FENCES and (
            language.lower() != "video" or any(_VIDEO_FILE.match(x.strip()) for x in code)
        ):
            try:
                out.append(self._media_fence(language.lower(), body, top))
            except fences.FenceError as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"In the ```{language} block starting at line {start + 1}: {e}.",
                )
            return i
        rich = fences.KINDS.get((language or "").lower())
        if rich:
            try:
                out.append(fences.parse(rich, body, self.inline))
            except fences.FenceError as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"In the ```{language} block starting at line {start + 1}: {e}.",
                )
            return i
        node: dict[str, Any] = {"type": "codeBlock", "attrs": {"language": language}}
        if body:
            node["content"] = [d.text_node(body)]
        out.append(node)
        return i

    def _math(self, lines: list[str], i: int, out: list) -> int | None:
        s = lines[i].strip()
        if s != "$$":
            if len(s) > 4 and s.endswith("$$"):
                out.append({"type": "blockMathEquation", "attrs": {"math_equation": s[2:-2].strip()}})
                return i + 1
            return None
        j = i + 1
        body: list[str] = []
        while j < len(lines) and lines[j].strip() != "$$":
            body.append(lines[j])
            j += 1
        if j >= len(lines):
            return None
        out.append({"type": "blockMathEquation", "attrs": {"math_equation": "\n".join(body).strip()}})
        return j + 1

    def _table(self, lines: list[str], i: int, out: list) -> int:
        header = _split_row(lines[i])[:MAX_TABLE_COLUMNS]
        width = len(header)
        if len(_split_row(lines[i])) > MAX_TABLE_COLUMNS:
            self.notes.add(f"Tables keep at most {MAX_TABLE_COLUMNS} columns.")
        i += 2
        rows = [[self._cell("tableHeader", h) for h in header]]
        while i < len(lines) and "|" in lines[i] and lines[i].strip():
            cells = (_split_row(lines[i]) + [""] * width)[:width]
            rows.append([self._cell("tableCell", c) for c in cells])
            i += 1
        out.append({"type": "table", "content": [{"type": "tableRow", "content": r} for r in rows]})
        return i

    def _cell(self, kind: str, text: str) -> dict:
        return {"type": kind, "content": [d.paragraph(self.inline(text))]}

    def _quote(self, lines: list[str], i: int, out: list, list_depth: int, quote_depth: int) -> int:
        inner: list[str] = []
        while i < len(lines):
            m = _QUOTE.match(lines[i])
            if not m:
                break
            inner.append(m.group(1))
            i += 1
        if quote_depth + 1 > MAX_QUOTE_DEPTH:
            self.notes.add(f"Quotes nest at most {MAX_QUOTE_DEPTH} levels; deeper '>' markers were kept as text.")
            out.append(self.paragraph(["> " + line for line in inner]))
            return i
        alert = _ALERT.match(inner[0].strip()) if inner else None
        callout_type = _ALERTS.get(alert.group(1).lower()) if alert else None
        if callout_type:
            body = ([alert.group(2)] if alert.group(2) else []) + inner[1:]
            blocks = self.blocks(body, list_depth, quote_depth + 1)
            out.append({
                "type": "callout",
                "attrs": {"type": callout_type, "dismissible": False},
                "content": self._callout_content(blocks) or [{"type": "paragraph"}],
            })
            return i
        blocks = self.blocks(inner, list_depth, quote_depth + 1)
        out.append({"type": "blockquote", "content": blocks or [{"type": "paragraph"}]})
        return i

    def _callout_content(self, blocks: list[dict]) -> list[dict]:
        """Callouts hold paragraphs and lists; other blocks are flattened."""
        out: list[dict] = []
        for block in blocks:
            t = block["type"]
            if t in ("paragraph", "bulletList", "orderedList"):
                out.append(block)
            elif t == "heading":
                content = [
                    {**n, "marks": n.get("marks", []) + [{"type": "bold"}]}
                    if n.get("type") == "text" and not any(m["type"] in ("code", "bold") for m in n.get("marks", []))
                    else n
                    for n in block.get("content", [])
                ]
                out.append(d.paragraph(content))
            elif t == "codeBlock":
                text = d.inline_text(block)
                runs: list[dict] = []
                for k, line in enumerate(text.split("\n")):
                    if k:
                        runs.append({"type": "hardBreak"})
                    if line:
                        runs.append(d.text_node(line, [{"type": "code"}]))
                out.append(d.paragraph(runs))
            elif t in ("blockquote", "callout"):
                out.extend(self._callout_content(block.get("content", [])))
            else:
                self.notes.add("Callouts hold only paragraphs and lists; tables, rules and math inside them were dropped.")
        return out

    def _list(self, lines: list[str], i: int, list_depth: int, quote_depth: int) -> tuple[dict, int]:
        first = _LIST.match(lines[i])
        indent = _indent(first.group(1))
        ordered = first.group(2)[0].isdigit()
        items: list[list] = []  # each item: list of parts ["text", [lines]] | ["node", node]
        n = len(lines)
        while i < n:
            line = lines[i]
            if not line.strip():
                j = i + 1
                while j < n and not lines[j].strip():
                    j += 1
                if j < n and items and (_indent(lines[j]) > indent or self._same_list(lines[j], indent, ordered)):
                    if _indent(lines[j]) > indent and not _LIST.match(lines[j]):
                        items[-1].append(["text", []])
                    i = j
                    continue
                break
            m = _LIST.match(line)
            if m and not _is_hr(line):
                level = _indent(m.group(1))
                if level < indent:
                    break
                if level == indent or (items and list_depth + 1 >= MAX_LIST_DEPTH):
                    if level == indent and m.group(2)[0].isdigit() != ordered:
                        break
                    if level != indent:
                        self.notes.add(f"Lists nest at most {MAX_LIST_DEPTH} levels; deeper items were kept at the last level.")
                    items.append([["text", [_task_box(m.group(3) or "")]]])
                    i += 1
                    continue
                if not items:
                    break
                nested, i = self._list(lines, i, list_depth + 1, quote_depth)
                items[-1].append(["node", nested])
                continue
            if items and _indent(line) > indent:
                fence = _fence_open(line)
                if fence:
                    holder: list[dict] = []
                    i = self._fence(lines, i, fence, holder)
                    items[-1].extend(["node", node] for node in holder)
                    continue
                part = items[-1][-1]
                if part[0] != "text":
                    items[-1].append(part := ["text", []])
                part[1].append(line)
                i += 1
                continue
            break
        node: dict[str, Any] = {
            "type": "orderedList" if ordered else "bulletList",
            "content": [self._item(parts) for parts in items],
        }
        if ordered:
            number = int(first.group(2)[:-1])
            if number != 1:
                node["attrs"] = {"start": number}
        return node, i

    @staticmethod
    def _same_list(line: str, indent: int, ordered: bool) -> bool:
        m = _LIST.match(line)
        return bool(m) and _indent(m.group(1)) == indent and m.group(2)[0].isdigit() == ordered

    def _item(self, parts: list[list]) -> dict:
        content: list[dict] = []
        for kind, value in parts:
            if kind == "text":
                if value or not content:
                    content.append(self.paragraph(value))
            else:
                content.append(value)
        if not content or content[0]["type"] != "paragraph":
            content.insert(0, {"type": "paragraph"})
        return {"type": "listItem", "content": content}


def _heading_node(level: int, content: list[dict]) -> dict:
    node: dict[str, Any] = {"type": "heading", "attrs": {"level": level}}
    if content:
        node["content"] = content
    return node


# ─── document to Markdown ────────────────────────────────────────────────────

_LINE_START = re.compile(r"^(#{1,6}(\s|$)|>|[-+*](\s|$)|\d{1,9}[.)](\s|$)|=+\s*$|\$\$|<!--|`{3,}|~{3,}|\|)")


def _escape(text: str) -> str:
    out = []
    n = len(text)
    for i, c in enumerate(text):
        if c in "\\`*[]":
            out.append("\\" + c)
        elif c == "_":
            prev = text[i - 1] if i else " "
            nxt = text[i + 1] if i + 1 < n else " "
            out.append("\\_" if not (prev.isalnum() and nxt.isalnum()) else "_")
        elif c == "~" and ((i + 1 < n and text[i + 1] == "~") or (i and text[i - 1] == "~")):
            out.append("\\~")
        elif c == "<" and text.startswith(("<http", "<!--"), i):
            out.append("\\<")
        else:
            out.append(c)
    return "".join(out)


def _code_span(text: str) -> str:
    longest = run = 0
    for c in text:
        run = run + 1 if c == "`" else 0
        longest = max(longest, run)
    fence = "`" * (longest + 1)
    pad = " " if text.startswith("`") or text.endswith("`") or (text.startswith(" ") and text.endswith(" ") and text.strip()) else ""
    return f"{fence}{pad}{text}{pad}{fence}"


def _href(url: str) -> str:
    return url.replace(" ", "%20").replace("(", "%28").replace(")", "%29")


_DELIM = {"bold": "**", "italic": "*", "strike": "~~"}


def inline_markdown(nodes: list, *, breaks: str = "\\\n") -> str:
    """Inline nodes as Markdown: marks open and close across runs and any
    whitespace at a run's edge stays outside the delimiters."""
    out: list[str] = []
    active: list[str] = []
    pending = ""
    i = 0
    nodes = [d.variable_as_text(n) for n in nodes if isinstance(n, dict)]
    while i < len(nodes):
        node = nodes[i]
        t = node.get("type")
        if t == "hardBreak":
            while active:
                out.append(_DELIM[active.pop()])
            out.append(pending + breaks)
            pending = ""
            i += 1
            continue
        if t != "text":
            i += 1
            continue
        marks = [m.get("type") for m in node.get("marks") or [] if isinstance(m, dict)]
        link = next((m.get("attrs", {}).get("href") for m in node.get("marks") or [] if isinstance(m, dict) and m.get("type") == "link"), None)
        if link and "code" not in marks:
            j = i
            group = []
            while j < len(nodes) and nodes[j].get("type") == "text" and any(
                isinstance(m, dict) and m.get("type") == "link" and (m.get("attrs") or {}).get("href") == link
                for m in nodes[j].get("marks") or []
            ):
                stripped = {**nodes[j], "marks": [m for m in nodes[j].get("marks") or [] if m.get("type") != "link"]}
                group.append(stripped)
                j += 1
            while active:
                out.append(_DELIM[active.pop()])
            out.append(pending)
            pending = ""
            label = inline_markdown(group, breaks=" ")
            out.append(f"[{label}]({_href(link)})" if d.is_web_url(link) else label)
            i = j
            continue
        text = node.get("text") or ""
        if "code" in marks:
            while active:
                out.append(_DELIM[active.pop()])
            out.append(pending + _code_span(text))
            pending = ""
            i += 1
            continue
        wanted = [m for m in ("bold", "italic", "strike") if m in marks]
        core = text.strip()
        if not core:
            pending += text
            i += 1
            continue
        lead = text[: len(text) - len(text.lstrip())]
        trail = text[len(text.rstrip()):]
        keep = 0
        while keep < len(active) and active[keep] in wanted:
            keep += 1
        while len(active) > keep:
            out.append(_DELIM[active.pop()])
        out.append(pending + lead)
        for m in wanted:
            if m not in active:
                active.append(m)
                out.append(_DELIM[m])
        out.append(_escape(core))
        pending = trail
        i += 1
    while active:
        out.append(_DELIM[active.pop()])
    out.append(pending)
    return "".join(out)


def _line_safe(text: str) -> str:
    return "\\" + text if _LINE_START.match(text) else text


def _comment_safe(text: str) -> str:
    return text.replace("-->", "-- >").replace("<!--", "< !--")


def block_comment(node: dict, path: list[int]) -> list[str]:
    """The comment that stands for a block Markdown cannot express."""
    t = d.kind(node)
    a = node.get("attrs") or {}
    head = f"<!-- block [{', '.join(map(str, path))}] {t}"
    body: list[str] = []
    if t == "blockQuiz":
        qs = [q for q in a.get("questions") or [] if isinstance(q, dict)]
        body.append(f"Quiz, {len(qs)} question{'s' if len(qs) != 1 else ''}:")
        for k, q in enumerate(qs[:30], 1):
            body.append(f"{k}. {d.clip(str(q.get('question') or ''), 300)[0]}")
            for ans in q.get("answers") or []:
                if isinstance(ans, dict):
                    mark = "x" if ans.get("correct") else " "
                    body.append(f"   [{mark}] {d.clip(str(ans.get('answer') or ''), 200)[0]}")
    elif t == "flipcard":
        body += [f"Flipcard. Q: {a.get('question') or ''}", f"A: {a.get('answer') or ''}"]
    elif t == "flipcardGrid":
        body.append(f"Flipcard grid, {len(d.children(node))} cards:")
        for card in d.children(node)[:30]:
            ca = card.get("attrs") or {}
            body.append(f"- Q: {ca.get('question') or ''} / A: {ca.get('answer') or ''}")
    elif t == "scenarios":
        steps = a.get("scenarios") or []
        body.append(f"Scenario \"{a.get('title') or ''}\", {len(steps)} steps.")
    elif t in d.MEDIA_TYPES:
        info = d.summary(node).get("media") or {}
        body.append(f"{t[5:]} file: {info.get('file') or info.get('src') or 'uploaded file'}")
    elif t == "blockEmbed":
        body.append(f"Embed: {a.get('embedUrl') or 'custom embed code'}")
    elif t == "youtube":
        body.append(f"YouTube video: {a.get('src') or ''}")
    elif t == "blockWebPreview":
        body.append(f"Link preview: {a.get('title') or ''} {a.get('url') or ''}".strip())
    elif t == "blockCode":
        body.append(f"Code exercise ({a.get('languageName') or 'code'}): {d.clip(str(a.get('description') or ''), 300)[0]}")
    elif t in ("blockMagic", "blockH5P"):
        body.append(f"Interactive element: {a.get('title') or ''}")
    elif t in ("badge", "button"):
        body.append(f"{t.capitalize()}: {d.inline_text(node)}" + (f" -> {a.get('link')}" if a.get("link") else ""))
    elif t == "blockUser":
        body.append("Member profile card.")
    elif t == "blockLibrary":
        body.append(f"Library item: {a.get('resourceType') or ''} {a.get('resourceUuid') or ''}".strip())
    else:
        text = d.block_text(node)
        if text:
            body.append(d.clip(text, 500)[0])
    lines = [head] + [_comment_safe(line) for line in body] + ["-->"]
    return lines


def _prefix(lines: list[str], first: str, rest: str) -> list[str]:
    return [(first if k == 0 else rest) + line if line else (first if k == 0 else rest).rstrip() for k, line in enumerate(lines)]


def render_block(node: Any, path: list[int], depth: int = 0) -> list[str]:
    """One block as Markdown lines."""
    if not isinstance(node, dict):
        return []
    if depth > d.MAX_DEPTH:
        return ["<!-- content nested too deeply to show -->"]
    t = d.kind(node)
    a = node.get("attrs") or {}
    kids = d.children(node)
    if t == "paragraph":
        text = inline_markdown(kids)
        return [_line_safe(line) for line in text.split("\n")] if text else [""]
    if t == "heading":
        level = a.get("level") if isinstance(a.get("level"), int) and 1 <= a.get("level") <= 6 else 2
        return ["#" * level + " " + inline_markdown(kids, breaks=" ")]
    if t in ("bulletList", "orderedList"):
        lines: list[str] = []
        start = a.get("start") if isinstance(a.get("start"), int) else 1
        for k, item in enumerate(kids):
            marker = f"{start + k}. " if t == "orderedList" else "- "
            item_lines: list[str] = []
            for j, child in enumerate(d.children(item)):
                block = render_block(child, path + [k, j], depth + 2)
                if j and d.kind(child) not in ("bulletList", "orderedList"):
                    item_lines.append("")
                item_lines.extend(block)
            lines.extend(_prefix(item_lines or [""], marker, " " * len(marker)))
        return lines
    if t == "blockquote":
        return _prefix(_join_blocks(kids, path, depth), "> ", "> ")
    if t in ("callout", "calloutInfo", "calloutWarning"):
        kind = a.get("type") if t == "callout" else ("info" if t == "calloutInfo" else "warning")
        if t == "callout":
            inner = _join_blocks(kids, path, depth)
        else:
            inner = [_line_safe(line) for line in inline_markdown(kids).split("\n")]
        return [f"> [!{_ALERT_OUT.get(kind, 'NOTE')}]"] + _prefix(inner, "> ", "> ")
    if t == "codeBlock":
        text = d.inline_text(node)
        fence = "```"
        while fence in text:
            fence += "`"
        return [fence + (a.get("language") or "")] + text.split("\n") + [fence]
    if t == "horizontalRule":
        return ["---"]
    if t == "blockMathEquation":
        return ["$$", str(a.get("math_equation") or ""), "$$"]
    if t == "table":
        rows = []
        for row in kids:
            cells = []
            for cell in d.children(row):
                parts = [inline_markdown(d.children(b), breaks=" ") if d.kind(b) in d.TEXT_HOLDERS else d.block_text(b, depth + 3) for b in d.children(cell)]
                cells.append(" ".join(p for p in parts if p).replace("\n", " ").replace("|", "\\|"))
            rows.append(cells)
        if not rows:
            return []
        width = max(len(r) for r in rows) or 1
        rows = [r + [""] * (width - len(r)) for r in rows]
        lines = ["| " + " | ".join(rows[0]) + " |", "|" + "|".join(["---"] * width) + "|"]
        lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
        return lines
    if fences.renders(node):
        return fences.render(node, inline_markdown)
    return block_comment(node, path)


def _join_blocks(nodes: list, path: list[int], depth: int) -> list[str]:
    lines: list[str] = []
    for j, child in enumerate(nodes):
        if j:
            lines.append("")
        lines.extend(render_block(child, path + [j], depth + 1))
    return lines


def doc_to_markdown(doc: dict) -> str:
    """The whole page as Markdown."""
    return "\n\n".join("\n".join(render_block(n, [i])) for i, n in enumerate(d.children(doc))) + "\n"


def is_prose(node: Any, depth: int = 0) -> bool:
    """Whether Markdown carries this block without loss (nothing inside
    renders as a block comment)."""
    if not isinstance(node, dict) or depth > d.MAX_DEPTH:
        return False
    t = d.kind(node)
    if t in ("text", "hardBreak", "horizontalRule", "blockMathEquation", "codeBlock"):
        return True
    if t in ("paragraph", "heading", "calloutInfo", "calloutWarning"):
        return True
    if fences.renders(node):
        return True
    if t in ("bulletList", "orderedList", "listItem", "blockquote", "callout", "table", "tableRow", "tableCell", "tableHeader"):
        return all(is_prose(c, depth + 1) for c in d.children(node))
    return False
