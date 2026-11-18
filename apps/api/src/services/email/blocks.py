"""Building blocks of an email body.

A template is a list of these. Each block renders twice: to email-safe HTML
(tables and inline styles, nothing a mail client might drop) and to plain
text for the ``text/plain`` alternative, so the two can never drift apart.

The looks follow the V2 design system (``theme.py``): quiet neutral text, a
near-black primary button (the org's accent on org mail), status colours only
on callouts that carry a status, hairline tables for secondary facts.

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

from src.services.email.theme import FONT_STACK, INK, MONO_STACK, TONES, Palette


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
    """What a block needs from the layout: colours and text direction."""

    palette: Palette
    button_bg: str
    button_fg: str
    align: str = "left"

    @property
    def start(self) -> str:
        return self.align

    @property
    def end(self) -> str:
        return "left" if self.align == "right" else "right"


def _font(size: int, color: str, weight: int = 400, line: str = "1.6") -> str:
    return (
        f"font-family: {FONT_STACK}; font-size: {size}px; line-height: {line}; color: {color}; "
        f"font-weight: {weight}; letter-spacing: -0.01em;"
    )


def _box(inner: str, *, bg: str, border: str = "", radius: int = 12, padding: str = "14px 16px",
         margin: str = "0 0 20px 0") -> str:
    """A full-width rounded box (one-cell table: Outlook-safe)."""
    edge = f" border: 1px solid {border};" if border else ""
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="margin: {margin}; border-collapse: separate;"><tr>'
        f'<td style="padding: {padding}; border-radius: {radius}px; background-color: {bg};{edge}">{inner}</td>'
        "</tr></table>"
    )


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
        return (
            f'<h1 style="margin: 0 0 10px 0; {_font(22, INK["text"], 700, "1.3")} letter-spacing: -0.025em;">'
            f"{esc(self.content)}</h1>"
        )

    def text(self) -> str:
        title = to_text(self.content)
        return f"{title}\n{'=' * min(len(title), 60)}"


@dataclass
class Subheading(Block):
    content: Content

    def html(self, ctx: Ctx) -> str:
        return f'<h2 style="margin: 4px 0 6px 0; {_font(14, INK["text"], 600, "1.4")}">{esc(self.content)}</h2>'

    def text(self) -> str:
        return to_text(self.content).upper()


@dataclass
class Paragraph(Block):
    content: Content
    muted: bool = False
    small: bool = False

    def html(self, ctx: Ctx) -> str:
        if self.small:
            style = _font(12, INK["faint"], 400, "1.6")
        else:
            style = _font(15, INK["muted"] if self.muted else INK["body"], 400, "1.6")
        return f'<p style="margin: 0 0 16px 0; {style}">{esc(self.content)}</p>'

    def text(self) -> str:
        return to_text(self.content)


@dataclass
class Button(Block):
    """The V2 Button: primary (ink, or the org accent) or secondary (white, hairline)."""

    label: Content
    url: str
    secondary: bool = False

    def anchor(self, ctx: Ctx) -> str:
        if self.secondary:
            style = (
                f"display: inline-block; padding: 10px 16px; border-radius: 12px; background-color: {INK['card']}; "
                f"color: {INK['secondary']}; border: 1px solid {INK['border_strong']}; text-decoration: none; "
                f"{_font(14, INK['secondary'], 600, '1')}"
            )
        else:
            style = (
                f"display: inline-block; padding: 11px 18px; border-radius: 12px; background-color: {ctx.button_bg}; "
                f"color: {ctx.button_fg}; border: 1px solid {ctx.button_bg}; text-decoration: none; "
                f"{_font(14, ctx.button_fg, 600, '1')} "
                "box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 1px 1px rgba(0,0,0,0.08);"
            )
        return f'<a href="{esc(self.url)}" style="{style}">{esc(self.label)}</a>'

    def html(self, ctx: Ctx) -> str:
        return (
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 8px 0 20px 0;">'
            f"<tr><td>{self.anchor(ctx)}</td></tr></table>"
        )

    def text(self) -> str:
        return f"{to_text(self.label)}: {self.url}"


@dataclass
class Buttons(Block):
    """One primary button, then secondary ones on the same line."""

    items: Sequence[Button]

    def html(self, ctx: Ctx) -> str:
        pad = "padding: 0 0 8px 8px;" if ctx.align == "right" else "padding: 0 8px 8px 0;"
        cells = "".join(f'<td style="{pad}">{b.anchor(ctx)}</td>' for b in self.items)
        return (
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 8px 0 12px 0;">'
            f"<tr>{cells}</tr></table>"
        )

    def text(self) -> str:
        return "\n".join(b.text() for b in self.items)


@dataclass
class LinkFallback(Block):
    """The "button not working?" line with the raw URL."""

    url: str
    label: Content = "Or paste this link into your browser:"

    def html(self, ctx: Ctx) -> str:
        return (
            f'<p style="margin: -4px 0 18px 0; {_font(12, INK["faint"])} word-break: break-all;">{esc(self.label)}<br>'
            f'<a href="{esc(self.url)}" style="color: {INK["muted"]}; text-decoration: underline;">{esc(self.url)}</a></p>'
        )

    def text(self) -> str:
        return ""  # the button line already carries the URL


@dataclass
class Code(Block):
    """A one-time code, large and monospaced, easy to copy."""

    code: str

    def html(self, ctx: Ctx) -> str:
        return (
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 4px 0 20px 0;">'
            f'<tr><td style="padding: 12px 20px; border-radius: 12px; background-color: {INK["sunken"]}; '
            f'font-family: {MONO_STACK}; font-size: 24px; font-weight: 700; letter-spacing: 0.16em; '
            f'color: {INK["text"]};">{esc(self.code)}</td></tr></table>'
        )

    def text(self) -> str:
        return f"    {self.code}"


@dataclass
class Callout(Block):
    """A soft status box (info, success, warning, danger, neutral)."""

    content: Content
    tone: str = "info"
    title: Optional[Content] = None

    def html(self, ctx: Ctx) -> str:
        fill, ink = TONES.get(self.tone, TONES["info"])
        title = f'<p style="margin: 0 0 2px 0; {_font(13, ink, 600, "1.5")}">{esc(self.title)}</p>' if self.title else ""
        return _box(f'{title}<p style="margin: 0; {_font(14, ink, 400, "1.55")}">{esc(self.content)}</p>', bg=fill)

    def text(self) -> str:
        head = f"{to_text(self.title)}: " if self.title else ""
        return f"> {head}{to_text(self.content)}"


@dataclass
class Quote(Block):
    """Someone's own words: an inviter's note, a comment, a message."""

    content: str
    attribution: Optional[Content] = None

    def html(self, ctx: Ctx) -> str:
        who = (
            f'<p style="margin: 0 0 4px 0; {_font(12, INK["muted"], 600, "1.5")}">{esc(self.attribution)}</p>'
            if self.attribution else ""
        )
        body = esc(self.content).replace("\n", "<br>")
        return _box(f'{who}<p style="margin: 0; {_font(14, INK["secondary"], 400, "1.6")}">{body}</p>',
                    bg=INK["muted_bg"], border=INK["border"])

    def text(self) -> str:
        who = f"{to_text(self.attribution)}\n" if self.attribution else ""
        return who + "\n".join(f"> {line}" for line in self.content.splitlines() or [""])


@dataclass
class Details(Block):
    """Label / value rows: a session's time, a plan, a due date."""

    rows: Sequence[tuple[Content, Content]]

    def html(self, ctx: Ctx) -> str:
        rows = [(label, value) for label, value in self.rows if value not in (None, "")]
        if not rows:
            return ""
        line = f"border-top: 1px solid {INK['border']};"
        trs = "".join(
            f'<tr><td style="padding: 10px 0; {line if i else ""} {_font(13, INK["muted"])} vertical-align: top;">{esc(label)}</td>'
            f'<td style="padding: 10px 0; {line if i else ""} {_font(14, INK["text"], 600)} text-align: {ctx.end};">'
            f"{esc(value)}</td></tr>"
            for i, (label, value) in enumerate(rows)
        )
        return _box(
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + trs + "</table>",
            bg=INK["card"], border=INK["border_strong"], padding="4px 16px",
        )

    def text(self) -> str:
        return "\n".join(f"{to_text(label)}: {to_text(value)}" for label, value in self.rows if value not in (None, ""))


@dataclass
class BulletList(Block):
    items: Sequence[Content]

    def html(self, ctx: Ctx) -> str:
        if not self.items:
            return ""
        gap = "padding-left: 10px;" if ctx.align == "right" else "padding-right: 10px;"
        rows = "".join(
            f'<tr><td valign="top" style="{gap} {_font(15, INK["faint"], 700)}">&bull;</td>'
            f'<td style="padding: 0 0 6px 0; {_font(15, INK["body"])}">{esc(item)}</td></tr>'
            for item in self.items
        )
        return (
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
            f'style="margin: 0 0 16px 0;">{rows}</table>'
        )

    def text(self) -> str:
        return "\n".join(f"- {to_text(item)}" for item in self.items)


@dataclass
class Stats(Block):
    """StatCard-style figures, for emails whose job is the numbers."""

    items: Sequence[tuple[Content, object]]

    def html(self, ctx: Ctx) -> str:
        if not self.items:
            return ""
        gap = '<td style="width: 8px; font-size: 0;">&nbsp;</td>'
        cells = gap.join(
            f'<td style="padding: 12px 16px; border-radius: 12px; border: 1px solid {INK["border_strong"]}; '
            f'background-color: {INK["card"]}; text-align: {ctx.start};">'
            f'<div style="{_font(12, INK["muted"], 500, "1.4")}">{esc(label)}</div>'
            f'<div style="{_font(20, INK["text"], 700, "1.3")} font-variant-numeric: tabular-nums;">{esc(value)}</div></td>'
            for label, value in self.items
        )
        return (
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
            f'style="margin: 0 0 20px 0; border-collapse: separate;"><tr>{cells}</tr></table>'
        )

    def text(self) -> str:
        return "   ".join(f"{to_text(label)}: {value}" for label, value in self.items)


@dataclass
class Row:
    """One entry of an :class:`Items` list."""

    title: Content
    body: Content = ""
    url: str = ""
    meta: Content = ""  # end-aligned count or short status
    avatar: str = ""  # initial, emoji or image URL
    avatar_color: Optional[str] = None


@dataclass
class Items(Block):
    """A divided panel of rows: notifications, conversations."""

    rows: Sequence[Row]
    more: Content = ""

    def _avatar(self, row: Row) -> str:
        from src.services.email.branding import contrasting_text_color, normalize_brand_color

        if row.avatar.startswith(("https://", "http://")):
            inner = (
                f'<img src="{esc(row.avatar)}" width="32" height="32" alt="{esc(to_text(row.title))}" '
                'style="display: block; width: 32px; height: 32px; border: 0; border-radius: 16px;">'
            )
        else:
            bg = normalize_brand_color(row.avatar_color) or INK["sunken"]
            fg = contrasting_text_color(bg) if row.avatar_color else INK["secondary"]
            inner = (
                '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
                f'<td width="32" height="32" align="center" valign="middle" style="width: 32px; height: 32px; '
                f'border-radius: 16px; background-color: {bg}; {_font(13, fg, 600, "32px")} text-align: center;">'
                f"{esc(row.avatar)}</td></tr></table>"
            )
        return f'<td width="44" valign="top" style="width: 44px;">{inner}</td>'

    def html(self, ctx: Ctx) -> str:
        if not self.rows:
            return ""
        out = []
        for i, row in enumerate(self.rows):
            line = f"border-top: 1px solid {INK['border']};" if i else ""
            title = esc(row.title)
            if row.url:
                title = Safe(f'<a href="{esc(row.url)}" style="color: {INK["text"]}; text-decoration: none;">{title}</a>')
            body = f'<div style="margin-top: 2px; {_font(13, INK["muted"], 400, "1.5")}">{esc(row.body)}</div>' if row.body else ""
            meta = (
                f'<td width="48" valign="middle" style="width: 48px; text-align: {ctx.end};">'
                f'<span style="display: inline-block; min-width: 8px; padding: 2px 8px; border-radius: 9999px; '
                f'background-color: {INK["ink"]}; {_font(11, "#ffffff", 600, "16px")} text-align: center;">'
                f"{esc(row.meta)}</span></td>"
                if row.meta not in ("", None) else ""
            )
            out.append(
                f'<tr><td style="padding: 14px 20px; {line}">'
                '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
                f'{self._avatar(row) if row.avatar else ""}'
                f'<td valign="top" style="text-align: {ctx.start};"><div style="{_font(14, INK["text"], 600, "1.45")}">'
                f"{title}</div>{body}</td>{meta}</tr></table></td></tr>"
            )
        more = f'<p style="margin: -8px 0 18px 0; {_font(12, INK["faint"])}">{esc(self.more)}</p>' if self.more else ""
        return (
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
            f'style="margin: 0 0 20px 0; border: 1px solid {INK["border_strong"]}; border-radius: 16px; '
            f'border-collapse: separate;">{"".join(out)}</table>{more}'
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
    """A titled table of short rows (digests): first column semibold, last end-aligned."""

    title: Content
    rows: Sequence[Sequence[Content]]
    limit: int = 10
    more: Content = ""

    def html(self, ctx: Ctx) -> str:
        if not self.rows:
            return ""
        trs = []
        for i, row in enumerate(list(self.rows)[: self.limit]):
            line = f"border-top: 1px solid {INK['border']};" if i else ""
            tds = []
            for j, value in enumerate(row):
                if j == 0:
                    style = _font(14, INK["text"], 600)
                elif j == len(row) - 1:
                    style = f"{_font(13, INK['muted'])} text-align: {ctx.end}; white-space: nowrap;"
                else:
                    style = f"{_font(13, INK['body'])} padding-left: 8px; padding-right: 8px;"
                tds.append(f'<td style="padding: 10px 0; {line} {style}">{esc(value)}</td>')
            trs.append(f"<tr>{''.join(tds)}</tr>")
        more = (
            f'<p style="margin: -10px 0 18px 0; {_font(12, INK["faint"])}">{esc(self.more)}</p>'
            if self.more and len(self.rows) > self.limit else ""
        )
        table = _box(
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + "".join(trs) + "</table>",
            bg=INK["card"], border=INK["border_strong"], padding="4px 16px",
        )
        return Subheading(self.title).html(ctx) + table + more

    def text(self) -> str:
        lines = [to_text(self.title).upper()]
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
        joined = " &middot; ".join(
            f'<a href="{esc(url)}" style="color: {INK["secondary"]}; font-weight: 600; text-decoration: underline;">'
            f"{esc(label)}</a>"
            for label, url in self.links
        )
        lead = f"{esc(self.lead)} " if self.lead else ""
        return f'<p style="margin: 0 0 16px 0; {_font(13, INK["muted"])}">{lead}{joined}</p>'

    def text(self) -> str:
        lead = f"{to_text(self.lead)}\n" if self.lead else ""
        return lead + "\n".join(f"{to_text(label)}: {url}" for label, url in self.links)


@dataclass
class Divider(Block):
    def html(self, ctx: Ctx) -> str:
        return f'<hr style="margin: 4px 0 20px 0; border: none; border-top: 1px solid {INK["border"]};">'

    def text(self) -> str:
        return "---"


_PROSE_STYLES = {
    "p": "margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: {body};",
    "ul": "margin: 0 0 16px 0; padding-{start}: 20px; color: {body};",
    "ol": "margin: 0 0 16px 0; padding-{start}: 20px; color: {body};",
    "li": "margin: 0 0 6px 0; font-size: 15px; line-height: 1.6;",
    "a": "color: {text}; font-weight: 600; text-decoration: underline;",
    "strong": "color: {text}; font-weight: 600;",
    "h2": "margin: 8px 0 8px 0; font-size: 16px; color: {text};",
    "h3": "margin: 8px 0 6px 0; font-size: 14px; color: {text};",
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
        values = {"body": INK["body"], "text": INK["text"], "start": ctx.start}

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
    "Heading", "Items", "LinkFallback", "Links", "Paragraph", "Prose", "Quote", "Row", "Safe", "Stats",
    "Subheading", "Table", "compact", "esc", "to_text",
]
