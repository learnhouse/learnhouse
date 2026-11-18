"""Building blocks of an email body.

A template is a list of these. Each block renders twice: to email-safe HTML
(inline styles, tables only where layout needs them) and to plain text for
the ``text/plain`` alternative, so the two never drift apart.

The look is deliberately plain (see ``theme.py``): paragraphs, one dark
button, a grey fallback link, quiet label/value lines. No boxes, tiles or
coloured accents.

Escaping is the blocks' job, not the caller's. Text is passed RAW and escaped
on the way out; the only way to hand a block markup is to wrap it in
:class:`Safe`, which says "this was built from escaped parts" (translated copy
with escaped values, see ``translations.th``). Anything else, a user name, an
org name, a comment, is escaped exactly once, here.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Iterable, Optional, Sequence, Union

from src.services.email.theme import FONT_STACK, INK, MONO_STACK


class Safe(str):
    """A string that is already HTML (escaped values inside trusted markup)."""

    __slots__ = ()


Content = Union[str, Safe]


def esc(value: object) -> Safe:
    """HTML for ``value``: escaped unless it is already :class:`Safe`."""
    if isinstance(value, Safe):
        return value
    return Safe(html.escape("" if value is None else str(value), quote=True))


_TAG = re.compile(r"<[^>]+>")
_BR = re.compile(r"<br\s*/?>", re.I)
_BLOCK_END = re.compile(r"</(p|li|h[1-6]|div|tr)>", re.I)


def to_text(value: object) -> str:
    """Plain text of ``value``: tags stripped from :class:`Safe`, raw otherwise."""
    if value is None:
        return ""
    if not isinstance(value, Safe):
        return str(value)
    text = _BLOCK_END.sub("\n", _BR.sub("\n", value))
    text = html.unescape(_TAG.sub("", text))
    return "\n".join(line.strip() for line in text.splitlines()).strip()


@dataclass(frozen=True)
class Ctx:
    """What a block needs from the layout: the button colours and text direction."""

    button_bg: str = INK["ink"]
    button_fg: str = "#ffffff"
    align: str = "left"

    @property
    def end(self) -> str:
        return "left" if self.align == "right" else "right"


def font(size: int = 15, color: str = INK["body"], weight: int = 400, line: str = "1.5") -> str:
    return f"font-family: {FONT_STACK}; font-size: {size}px; line-height: {line}; color: {color}; font-weight: {weight};"


def _p(content: str, style: str, margin: str = "0 0 16px 0") -> str:
    return f'<p style="margin: {margin}; {style}">{content}</p>'


LINK = f"color: {INK['text']}; text-decoration: underline;"
MUTED_LINK = f"color: {INK['muted']}; text-decoration: underline;"


class Block:
    """Base class: ``html(ctx)`` and ``text()``."""

    def html(self, ctx: Ctx) -> str:  # pragma: no cover - abstract
        raise NotImplementedError

    def text(self) -> str:  # pragma: no cover - abstract
        raise NotImplementedError


@dataclass
class Heading(Block):
    content: Content

    def html(self, ctx: Ctx) -> str:
        return f'<h1 style="margin: 0 0 16px 0; {font(22, INK["text"], 600, "1.3")}">{esc(self.content)}</h1>'

    def text(self) -> str:
        return to_text(self.content)


@dataclass
class Subheading(Block):
    content: Content

    def html(self, ctx: Ctx) -> str:
        return f'<h2 style="margin: 24px 0 8px 0; {font(15, INK["text"], 600)}">{esc(self.content)}</h2>'

    def text(self) -> str:
        return to_text(self.content)


@dataclass
class Paragraph(Block):
    content: Content
    muted: bool = False
    small: bool = False

    def html(self, ctx: Ctx) -> str:
        if self.small:
            return _p(esc(self.content), font(13, INK["muted"]))
        return _p(esc(self.content), font(15, INK["muted"] if self.muted else INK["body"]))

    def text(self) -> str:
        return to_text(self.content)


@dataclass
class Button(Block):
    """The one call to action: dark (or the org's colour), 6px radius."""

    label: Content
    url: str
    secondary: bool = False  # rendered as a plain link

    def anchor(self, ctx: Ctx) -> str:
        if self.secondary:
            return f'<a href="{esc(self.url)}" style="{font(14, INK["text"], 500)} {LINK}">{esc(self.label)}</a>'
        style = (
            f"display: inline-block; padding: 10px 18px; border-radius: 6px; background-color: {ctx.button_bg}; "
            f"color: {ctx.button_fg}; font-family: {FONT_STACK}; font-size: 14px; line-height: 20px; "
            "font-weight: 600; text-decoration: none;"
        )
        return f'<a href="{esc(self.url)}" style="{style}">{esc(self.label)}</a>'

    def html(self, ctx: Ctx) -> str:
        return (
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 8px 0 24px 0;">'
            f"<tr><td>{self.anchor(ctx)}</td></tr></table>"
        )

    def text(self) -> str:
        return f"{to_text(self.label)}: {self.url}"


@dataclass
class Buttons(Block):
    """A button followed by plain links on the same line."""

    items: Sequence[Button]

    def html(self, ctx: Ctx) -> str:
        pad = "padding: 0 0 8px 20px;" if ctx.align == "right" else "padding: 0 20px 8px 0;"
        cells = "".join(
            f'<td valign="middle" style="{pad}">{Button(b.label, b.url, secondary=i > 0).anchor(ctx)}</td>'
            for i, b in enumerate(self.items)
        )
        return (
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 8px 0 16px 0;">'
            f"<tr>{cells}</tr></table>"
        )

    def text(self) -> str:
        return "\n".join(b.text() for b in self.items)


@dataclass
class LinkFallback(Block):
    """The "button not working?" line with the raw URL, small and grey."""

    url: str
    label: Content = "Or paste this link into your browser:"

    def html(self, ctx: Ctx) -> str:
        return _p(
            f'{esc(self.label)}<br><a href="{esc(self.url)}" style="{MUTED_LINK}">{esc(self.url)}</a>',
            f"{font(13, INK['muted'])} word-break: break-all;", "-8px 0 24px 0",
        )

    def text(self) -> str:
        return ""  # the button line already carries the URL


@dataclass
class Code(Block):
    """A one-time or invite code, inline in bold monospace."""

    code: str

    def html(self, ctx: Ctx) -> str:
        return _p(
            f'<span style="font-family: {MONO_STACK}; font-size: 20px; font-weight: 700; letter-spacing: 0.08em; '
            f'color: {INK["text"]};">{esc(self.code)}</span>',
            font(15, INK["text"]),
        )

    def text(self) -> str:
        return self.code


@dataclass
class Callout(Block):
    """An important line. Plain text with an optional bold lead-in, no box.

    ``tone`` is kept for the text part and for callers; it does not colour
    anything.
    """

    content: Content
    tone: str = "info"
    title: Optional[Content] = None

    def html(self, ctx: Ctx) -> str:
        lead = f'<strong style="color: {INK["text"]}; font-weight: 600;">{esc(self.title)}:</strong> ' if self.title else ""
        return _p(f"{lead}{esc(self.content)}", font(15, INK["text"]))

    def text(self) -> str:
        head = f"{to_text(self.title)}: " if self.title else ""
        return f"{head}{to_text(self.content)}"


@dataclass
class Quote(Block):
    """Someone's own words (an inviter's note, a comment): a thin left rule."""

    content: str
    attribution: Optional[Content] = None

    def html(self, ctx: Ctx) -> str:
        side = "right" if ctx.align == "right" else "left"
        who = _p(esc(self.attribution), font(13, INK["muted"]), "0 0 6px 0") if self.attribution else ""
        body = esc(self.content).replace("\n", "<br>")
        return (
            f"{who}<p style=\"margin: 0 0 20px 0; padding-{side}: 12px; border-{side}: 2px solid {INK['rule']}; "
            f'{font(15, INK["body"])}">{body}</p>'
        )

    def text(self) -> str:
        who = f"{to_text(self.attribution)}\n" if self.attribution else ""
        return who + "\n".join(f"> {line}" for line in self.content.splitlines() or [""])


@dataclass
class Details(Block):
    """Label / value lines: a session's time, a plan, a due date."""

    rows: Sequence[tuple[Content, Content]]

    def html(self, ctx: Ctx) -> str:
        rows = [(label, value) for label, value in self.rows if value not in (None, "")]
        if not rows:
            return ""
        trs = "".join(
            f'<tr><td valign="top" style="padding: 3px 16px 3px 0; {font(14, INK["muted"])} white-space: nowrap;">'
            f'{esc(label)}</td><td valign="top" style="padding: 3px 0; {font(14, INK["text"])}">{esc(value)}</td></tr>'
            for label, value in rows
        )
        return (
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
            f'style="margin: 0 0 20px 0;">{trs}</table>'
        )

    def text(self) -> str:
        return "\n".join(f"{to_text(label)}: {to_text(value)}" for label, value in self.rows if value not in (None, ""))


@dataclass
class BulletList(Block):
    items: Sequence[Content]

    def html(self, ctx: Ctx) -> str:
        if not self.items:
            return ""
        side = "right" if ctx.align == "right" else "left"
        items = "".join(f'<li style="margin: 0 0 6px 0; {font(15, INK["body"])}">{esc(item)}</li>' for item in self.items)
        return f'<ul style="margin: 0 0 16px 0; padding-{side}: 20px;">{items}</ul>'

    def text(self) -> str:
        return "\n".join(f"- {to_text(item)}" for item in self.items)


@dataclass
class Row:
    """One entry of an :class:`Items` list."""

    title: Content
    body: Content = ""
    url: str = ""
    meta: Content = ""  # end-aligned count or short status, grey


@dataclass
class Items(Block):
    """A list of short entries (notifications, conversations) split by hairlines."""

    rows: Sequence[Row]
    more: Content = ""

    def html(self, ctx: Ctx) -> str:
        if not self.rows:
            return ""
        out = []
        for i, row in enumerate(self.rows):
            line = f"border-top: 1px solid {INK['hairline']};" if i else ""
            title = esc(row.title)
            if row.url:
                title = Safe(f'<a href="{esc(row.url)}" style="color: {INK["text"]}; text-decoration: none;">{title}</a>')
            body = f'<div style="{font(14, INK["muted"])}">{esc(row.body)}</div>' if row.body else ""
            meta = (
                f'<td valign="top" style="padding: 12px 0 12px 12px; {line} {font(13, INK["muted"])} '
                f'text-align: {ctx.end}; white-space: nowrap;">{esc(row.meta)}</td>'
                if row.meta not in ("", None) else ""
            )
            out.append(
                f'<tr><td valign="top" style="padding: 12px 0; {line}">'
                f'<div style="{font(15, INK["text"], 500)}">{title}</div>{body}</td>{meta}</tr>'
            )
        more = _p(esc(self.more), font(13, INK["muted"]), "-8px 0 20px 0") if self.more else ""
        return (
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
            f'style="margin: 0 0 20px 0;">{"".join(out)}</table>{more}'
        )

    def text(self) -> str:
        lines = []
        for row in self.rows:
            meta = f" ({to_text(row.meta)})" if row.meta not in ("", None) else ""
            lines.append(f"- {to_text(row.title)}{meta}")
            if row.body:
                lines.append(f"  {to_text(row.body)}")
            if row.url:
                lines.append(f"  {row.url}")
        if self.more:
            lines.append(to_text(self.more))
        return "\n".join(lines)


@dataclass
class Table(Block):
    """A titled list of short rows (digests): first column the name, last end-aligned."""

    title: Content
    rows: Sequence[Sequence[Content]]
    limit: int = 10
    more: Content = ""

    def html(self, ctx: Ctx) -> str:
        if not self.rows:
            return ""
        trs = []
        for i, row in enumerate(list(self.rows)[: self.limit]):
            line = f"border-top: 1px solid {INK['hairline']};" if i else ""
            tds = []
            for j, value in enumerate(row):
                if j == 0:
                    style = font(14, INK["text"], 500)
                elif j == len(row) - 1:
                    style = f"{font(14, INK['muted'])} text-align: {ctx.end}; white-space: nowrap;"
                else:
                    style = f"{font(14, INK['body'])} padding-left: 8px; padding-right: 8px;"
                tds.append(f'<td style="padding: 8px 0; {line} {style}">{esc(value)}</td>')
            trs.append(f"<tr>{''.join(tds)}</tr>")
        more = (
            _p(esc(self.more), font(13, INK["muted"]), "-8px 0 20px 0")
            if self.more and len(self.rows) > self.limit else ""
        )
        return (
            Subheading(self.title).html(ctx)
            + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
            f'style="margin: 0 0 20px 0;">{"".join(trs)}</table>{more}'
        )

    def text(self) -> str:
        lines = [to_text(self.title)]
        lines += [" | ".join(to_text(v) for v in row) for row in list(self.rows)[: self.limit]]
        if self.more and len(self.rows) > self.limit:
            lines.append(to_text(self.more))
        return "\n".join(lines)


@dataclass
class Links(Block):
    """A quiet line of inline links, e.g. "Add to Google Calendar · Outlook"."""

    links: Sequence[tuple[Content, str]]
    lead: Content = ""

    def html(self, ctx: Ctx) -> str:
        if not self.links:
            return ""
        joined = " &middot; ".join(f'<a href="{esc(url)}" style="{MUTED_LINK}">{esc(label)}</a>' for label, url in self.links)
        lead = f"{esc(self.lead)} " if self.lead else ""
        return _p(f"{lead}{joined}", font(13, INK["muted"]))

    def text(self) -> str:
        lead = f"{to_text(self.lead)}\n" if self.lead else ""
        return lead + "\n".join(f"{to_text(label)}: {url}" for label, url in self.links)


@dataclass
class Divider(Block):
    def html(self, ctx: Ctx) -> str:
        return f'<hr style="margin: 8px 0 24px 0; border: none; border-top: 1px solid {INK["hairline"]};">'

    def text(self) -> str:
        return "---"


_PROSE_STYLES = {
    "p": "margin: 0 0 16px 0; font-size: 15px; line-height: 1.5; color: {body};",
    "ul": "margin: 0 0 16px 0; padding-{start}: 20px; color: {body};",
    "ol": "margin: 0 0 16px 0; padding-{start}: 20px; color: {body};",
    "li": "margin: 0 0 6px 0; font-size: 15px; line-height: 1.5;",
    "a": "color: {text}; text-decoration: underline;",
    "strong": "color: {text}; font-weight: 600;",
    "h2": "margin: 24px 0 8px 0; font-size: 17px; font-weight: 600; color: {text};",
    "h3": "margin: 20px 0 8px 0; font-size: 15px; font-weight: 600; color: {text};",
}
_OPEN_TAG = re.compile(r"<(p|ul|ol|li|a|strong|h2|h3)(\s[^>]*)?>")


@dataclass
class Prose(Block):
    """Pre-rendered rich text (escaped markdown) with styles added inline.

    ``content`` must be :class:`Safe`: HTML produced from escaped input by a
    renderer that only emits the tags styled here. ``plain`` is the text part.
    """

    content: Safe
    plain: str = ""

    def html(self, ctx: Ctx) -> str:
        values = {"body": INK["body"], "text": INK["text"], "start": "right" if ctx.align == "right" else "left"}

        def style(match: re.Match) -> str:
            tag, attrs = match.group(1), match.group(2) or ""
            return f'<{tag}{attrs} style="font-family: {FONT_STACK}; {_PROSE_STYLES[tag].format(**values)}">'

        return f"<div>{_OPEN_TAG.sub(style, esc(self.content))}</div>"

    def text(self) -> str:
        return self.plain or to_text(self.content)


def compact(blocks: Iterable[Optional[Block]]) -> list[Block]:
    """Drop ``None`` entries so templates can write ``x if cond else None``."""
    return [b for b in blocks if b is not None]


__all__ = [
    "Block", "BulletList", "Button", "Buttons", "Callout", "Code", "Content", "Ctx", "Details", "Divider",
    "Heading", "Items", "LinkFallback", "Links", "Paragraph", "Prose", "Quote", "Row", "Safe", "Subheading",
    "Table", "compact", "esc", "to_text",
]
