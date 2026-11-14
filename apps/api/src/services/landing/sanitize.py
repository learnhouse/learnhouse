"""Sanitizers for the landing page's custom code element.

Custom HTML is rebuilt from an allowlist: known tags and attributes are kept,
everything else is dropped (with the text of dropped containers like
<script> and <style> removed entirely). Link and image addresses must be
http(s), a path, an anchor, mailto: or tel:. CSS loses anything that can load
code or reach outside the frame (@import, expression(), behavior, -moz-binding,
javascript:/vbscript: URLs, </style>).

This is the second layer: the renderer also shows custom code in a sandboxed
frame without scripts, so a gap here still cannot run code on the page.
"""

from __future__ import annotations

import html
import re
from html.parser import HTMLParser

ALLOWED_TAGS = {
    "a", "abbr", "article", "aside", "b", "blockquote", "br", "caption", "cite", "code", "col",
    "colgroup", "dd", "del", "details", "div", "dl", "dt", "em", "figcaption", "figure", "footer",
    "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "main",
    "mark", "nav", "ol", "p", "picture", "pre", "q", "s", "section", "small", "source", "span",
    "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr",
    "u", "ul", "svg", "path", "circle", "rect", "line", "polyline", "polygon", "g", "button", "label",
}
VOID_TAGS = {"br", "hr", "img", "col", "source"}
# Containers whose content is dropped with them.
DROP_CONTENT = {"script", "style", "iframe", "object", "embed", "noscript", "template", "textarea", "select", "math"}

GLOBAL_ATTRS = {"class", "id", "title", "lang", "dir", "role", "aria-label", "aria-hidden", "style"}
TAG_ATTRS = {
    "a": {"href", "target", "rel"},
    "img": {"src", "alt", "width", "height", "loading", "srcset", "sizes"},
    "source": {"srcset", "type", "media", "sizes"},
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan", "scope"},
    "col": {"span"},
    "time": {"datetime"},
    "details": {"open"},
    "button": {"type"},
    "svg": {"viewbox", "width", "height", "fill", "stroke", "xmlns", "stroke-width"},
    "path": {"d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"},
    "circle": {"cx", "cy", "r", "fill", "stroke"},
    "rect": {"x", "y", "width", "height", "rx", "fill", "stroke"},
    "line": {"x1", "y1", "x2", "y2", "stroke", "stroke-width"},
    "polyline": {"points", "fill", "stroke"},
    "polygon": {"points", "fill", "stroke"},
    "g": {"fill", "stroke"},
}
URL_ATTRS = {"href", "src"}
SRCSET_ATTRS = {"srcset"}

_SAFE_URL = re.compile(r"^(https?://|mailto:|tel:|#|/(?!/))", re.I)
# Characters browsers ignore inside a scheme ("java\tscript:").
_URL_JUNK = re.compile(r"[\x00-\x20\x7f-\x9f]+")


def safe_url(value: str) -> bool:
    v = _URL_JUNK.sub("", html.unescape(value or ""))
    if not v:
        return True
    if ":" not in v.split("/")[0].split("?")[0].split("#")[0]:
        # Relative ("about", "./x", "?q"): no scheme, harmless.
        return not v.startswith("//")
    return bool(_SAFE_URL.match(v))


class _Cleaner(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.drop_depth = 0
        self.stack: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        if tag in DROP_CONTENT:
            if tag not in VOID_TAGS:
                self.drop_depth += 1
            return
        if self.drop_depth or tag not in ALLOWED_TAGS:
            return
        kept = []
        for name, value in attrs:
            name = (name or "").lower()
            value = value or ""
            allowed = name in GLOBAL_ATTRS or name in TAG_ATTRS.get(tag, set()) or name.startswith("data-")
            if not allowed or name.startswith("on"):
                continue
            if name in URL_ATTRS and not safe_url(value):
                continue
            if name in SRCSET_ATTRS and not all(safe_url(part.strip().split(" ")[0]) for part in value.split(",")):
                continue
            if name == "style":
                value = sanitize_css(value, inline=True)
                if not value:
                    continue
            if name == "target":
                value = "_blank" if value == "_blank" else ""
                if not value:
                    continue
            kept.append(f' {name}="{html.escape(value, quote=True)}"')
        if tag == "a" and any(a.startswith(' target="_blank"') for a in kept):
            kept = [a for a in kept if not a.startswith(" rel=")] + [' rel="noopener noreferrer"']
        self.out.append(f"<{tag}{''.join(kept)}>")
        if tag not in VOID_TAGS:
            self.stack.append(tag)

    def handle_startendtag(self, tag: str, attrs) -> None:
        self.handle_starttag(tag, attrs)
        tag = tag.lower()
        if tag not in VOID_TAGS and self.stack and self.stack[-1] == tag:
            self.stack.pop()
            self.out.append(f"</{tag}>")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in DROP_CONTENT:
            if self.drop_depth:
                self.drop_depth -= 1
            return
        if self.drop_depth or tag not in ALLOWED_TAGS or tag in VOID_TAGS:
            return
        if tag in self.stack:
            while self.stack:
                top = self.stack.pop()
                self.out.append(f"</{top}>")
                if top == tag:
                    break

    def handle_data(self, data: str) -> None:
        if not self.drop_depth:
            self.out.append(html.escape(data, quote=False))

    def handle_comment(self, data: str) -> None:
        return  # comments dropped (conditional comments, hidden payloads)

    def handle_decl(self, decl: str) -> None:
        return

    def handle_pi(self, data: str) -> None:
        return

    def unknown_decl(self, data: str) -> None:
        return

    def result(self) -> str:
        while self.stack:
            self.out.append(f"</{self.stack.pop()}>")
        return "".join(self.out)


def sanitize_html(value: str) -> str:
    if not value:
        return ""
    cleaner = _Cleaner()
    cleaner.feed(value)
    cleaner.close()
    return cleaner.result()


# A declaration (up to ; { or }) that tries to load or run something is
# dropped whole, not just the offending token.
_CSS_BAD_DECL = re.compile(r"[^;{}]*(expression\s*\(|behavior\s*:|-moz-binding\s*:|(java|vb)script\s*:)[^;{}]*;?", re.I)
_CSS_BAD = [
    re.compile(r"@import[^;]*;?", re.I),
    re.compile(r"@charset[^;]*;?", re.I),
    re.compile(r"@namespace[^;]*;?", re.I),
    re.compile(r"</?\s*style", re.I),
    re.compile(r"<!--|-->", re.I),
    # CSS never needs "<": dropping it keeps markup out of the stylesheet.
    re.compile(r"<"),
]
_CSS_URL = re.compile(r"""url\(\s*(?:"([^"]*)"|'([^']*)'|((?:[^()\s]|\([^()]*\))*))\s*\)""", re.I)
_CSS_ESCAPE = re.compile(r"\\([0-9a-fA-F]{1,6})\s?")


def _unescape_css(value: str) -> str:
    def rep(m: re.Match) -> str:
        try:
            return chr(int(m.group(1), 16))
        except (ValueError, OverflowError):
            return ""

    return _CSS_ESCAPE.sub(rep, value).replace("\\", "")


def sanitize_css(value: str, *, inline: bool = False) -> str:
    if not value:
        return ""
    # Escapes ("\65 xpression", "j\61vascript") are decoded first, so the
    # checks below see what the browser would.
    css = _unescape_css(value).replace("\x00", "")
    css = _CSS_BAD_DECL.sub("", css)
    for pattern in _CSS_BAD:
        css = pattern.sub("", css)

    def url(m: re.Match) -> str:
        target = (m.group(1) or m.group(2) or m.group(3) or "").strip()
        if re.match(r"^(https://|/(?!/)|#|data:image/(png|jpeg|gif|webp);base64,)", target, re.I):
            return f'url("{target.replace(chr(34), "")}")'
        return "none"

    css = _CSS_URL.sub(url, css)
    if inline:
        css = css.replace("{", "").replace("}", "")
    return css.strip()
