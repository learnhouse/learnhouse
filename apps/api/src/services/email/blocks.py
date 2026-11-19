"""Building blocks of an email body, each the email form of a V2 kit part.

* :class:`Hero`: SectionCard header (icon tile, title, description)
* :class:`Details`: Panel divided, label / value rows
* :class:`Stats`: StatCard tiles, two per row
* :class:`Items`: Panel divided list rows with a small avatar tile
* :class:`Quote` / :class:`Callout`: the surface-muted info panel (a status
  tone tints a callout, as a banner would)
* :class:`Code`: the surface-sunken code chip
* :func:`chip`: Chip / StatusPill, usable as a Details value
* :class:`Button`: the primary button with its relief (VML for Outlook)

Each block renders twice: to email-safe HTML (tables, inline styles) and to
plain text for the ``text/plain`` alternative.

Escaping is the blocks' job, not the caller's. Text is passed RAW and escaped
on the way out; the only way to hand a block markup is to wrap it in
:class:`Safe`, which says "this was built from escaped parts" (translated copy
with escaped values, see ``translations.th``, or :func:`chip`).
"""

from __future__ import annotations

import html
import os
import re
from dataclasses import dataclass
from typing import Iterable, Optional, Sequence, Union

from src.services.email.theme import BUTTON_SHADOW, FONT_STACK, INK, MONO_STACK, tone as get_tone

DEFAULT_ASSET_BASE = "https://www.learnhouse.io/emails"


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


def asset_url(path: str) -> str:
    """Absolute URL of a hosted email asset (``apps/web/public/emails``).

    ``LEARNHOUSE_EMAIL_ASSETS_URL`` points self-hosted installs (or a preview)
    at their own copy.
    """
    base = (os.environ.get("LEARNHOUSE_EMAIL_ASSETS_URL") or DEFAULT_ASSET_BASE).strip().rstrip("/")
    return f"{base}/{path.lstrip('/')}"


def icon_url(icon: str, tone_name: str) -> str:
    return asset_url(f"icons/{icon}-{tone_name}.png")


@dataclass(frozen=True)
class Ctx:
    """What a block needs from the layout: button colours, text direction, the email's tone."""

    button_bg: str = INK["ink"]
    button_fg: str = "#ffffff"
    align: str = "left"
    tone: str = "neutral"
    org_button: bool = False

    @property
    def end(self) -> str:
        return "left" if self.align == "right" else "right"

    @property
    def start(self) -> str:
        return self.align


def font(size: int = 14, color: str = INK["body"], weight: int = 400, line: str = "1.55") -> str:
    return f"font-family: {FONT_STACK}; font-size: {size}px; line-height: {line}; color: {color}; font-weight: {weight};"


def _p(content: str, style: str, margin: str = "0 0 16px 0") -> str:
    return f'<p style="margin: {margin}; {style}">{content}</p>'


def _table(inner: str, style: str = "", width: str = "100%") -> str:
    w = f' width="{width}"' if width else ""
    return (
        f'<table role="presentation"{w} cellpadding="0" cellspacing="0" border="0" '
        f'style="border-collapse: separate; {style}">{inner}</table>'
    )


def _panel(rows_html: str, margin: str = "0 0 20px 0") -> str:
    """Panel: white, 1px border, radius 12, rows split by hairlines."""
    return _table(rows_html, f"margin: {margin}; border: 1px solid {INK['card_border']}; border-radius: 12px;")


def icon_tile(icon: str, tone_name: str, size: int = 40, glyph: int = 20, radius: int = 12) -> str:
    """The kit's icon tile: a tinted rounded square with a centred icon."""
    t = get_tone(tone_name)
    pad = (size - glyph) // 2
    return _table(
        f'<tr><td width="{size}" height="{size}" align="center" valign="middle" '
        f'style="width: {size}px; height: {size}px; padding: 0; border-radius: {radius}px; background-color: {t.tile};">'
        f'<img src="{esc(icon_url(icon, t.name))}" width="{glyph}" height="{glyph}" alt="" '
        f'style="display: block; width: {glyph}px; height: {glyph}px; margin: {pad}px auto; border: 0;"></td></tr>',
        width="",
    )


def chip(label: Content, tone_name: str = "neutral", dot: bool = False) -> Safe:
    """Chip / StatusPill: a 12px pill in a soft tint with the tone's ink."""
    t = get_tone(tone_name)
    mark = (
        f'<span style="display: inline-block; width: 6px; height: 6px; border-radius: 3px; '
        f'background-color: {t.icon}; margin-right: 5px; vertical-align: 1px;"></span>'
        if dot else ""
    )
    return Safe(
        f'<span style="display: inline-block; padding: 2px 9px; border-radius: 9999px; background-color: {t.tile}; '
        f'border: 1px solid {t.border}; {font(12, t.ink, 600, "18px")} white-space: nowrap;">{mark}{esc(label)}</span>'
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
        return f'<h1 style="margin: 0 0 12px 0; {font(22, INK["text"], 600, "1.3")} letter-spacing: -0.01em;">{esc(self.content)}</h1>'

    def text(self) -> str:
        return to_text(self.content)


@dataclass
class Hero(Block):
    """SectionCard header: the icon tile beside the title and description."""

    title: Content
    description: Optional[Content] = None
    icon: str = "buildings"
    tone: str = "neutral"

    def html(self, ctx: Ctx) -> str:
        gap = "padding-left: 14px;" if ctx.align == "right" else "padding-right: 14px;"
        desc = _p(esc(self.description), font(14, INK["body"]), "6px 0 0 0") if self.description else ""
        return _table(
            f'<tr><td width="40" valign="top" style="width: 40px; {gap}">{icon_tile(self.icon, self.tone)}</td>'
            f'<td valign="top" style="text-align: {ctx.start};">'
            f'<h1 style="margin: 0; padding-top: 6px; {font(22, INK["text"], 600, "1.3")} letter-spacing: -0.01em;">'
            f"{esc(self.title)}</h1>{desc}</td></tr>",
            "margin: 0 0 24px 0;",
        )

    def text(self) -> str:
        return "\n\n".join(p for p in (to_text(self.title), to_text(self.description)) if p)


@dataclass
class Subheading(Block):
    content: Content

    def html(self, ctx: Ctx) -> str:
        return f'<h2 style="margin: 4px 0 10px 0; {font(14, INK["text"], 600)}">{esc(self.content)}</h2>'

    def text(self) -> str:
        return to_text(self.content)


@dataclass
class Paragraph(Block):
    content: Content
    muted: bool = False
    small: bool = False

    def html(self, ctx: Ctx) -> str:
        if self.small:
            return _p(esc(self.content), font(12, INK["muted"]))
        return _p(esc(self.content), font(14, INK["muted"] if self.muted else INK["body"]))

    def text(self) -> str:
        return to_text(self.content)


@dataclass
class Button(Block):
    """The primary button: 44px, radius 12, ink (or the org accent), with relief.

    ``secondary`` draws the white button with a hairline border. Outlook gets
    a VML roundrect of the same shape.
    """

    label: Content
    url: str
    secondary: bool = False

    def anchor(self, ctx: Ctx) -> str:
        if self.secondary:
            bg, fg, border, shadow = INK["card"], INK["body"], INK["border_strong"], "0 1px 1px rgba(0,0,0,0.03)"
        else:
            bg, fg = ctx.button_bg, ctx.button_fg
            border = ctx.button_bg
            shadow = BUTTON_SHADOW if not ctx.org_button else "inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 1px rgba(0,0,0,0.08)"
        label = esc(self.label)
        width = max(120, int(len(to_text(label)) * 8.2) + 44)
        vml = (
            f'<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" '
            f'href="{esc(self.url)}" style="height:44px;v-text-anchor:middle;width:{width}px;" arcsize="27%" '
            f'strokecolor="{border}" fillcolor="{bg}"><w:anchorlock/><center style="color:{fg};font-family:Arial,sans-serif;'
            f'font-size:14px;font-weight:600;">{label}</center></v:roundrect><![endif]-->'
        )
        link = (
            f'<!--[if !mso]><!-- --><a href="{esc(self.url)}" style="display: inline-block; padding: 12px 20px; '
            f"border-radius: 12px; background-color: {bg}; color: {fg}; border: 1px solid {border}; box-shadow: {shadow}; "
            f'font-family: {FONT_STACK}; font-size: 14px; line-height: 18px; font-weight: 600; text-decoration: none; '
            f'mso-hide: all;">{label}</a><!--<![endif]-->'
        )
        return vml + link

    def html(self, ctx: Ctx) -> str:
        return _table(f"<tr><td>{self.anchor(ctx)}</td></tr>", "margin: 4px 0 16px 0;", width="")

    def text(self) -> str:
        return f"{to_text(self.label)}: {self.url}"


@dataclass
class Buttons(Block):
    """One primary button followed by secondary ones on the same line."""

    items: Sequence[Button]

    def html(self, ctx: Ctx) -> str:
        pad = "padding: 0 0 8px 8px;" if ctx.align == "right" else "padding: 0 8px 8px 0;"
        cells = "".join(
            f'<td valign="middle" style="{pad}">{Button(b.label, b.url, secondary=i > 0).anchor(ctx)}</td>'
            for i, b in enumerate(self.items)
        )
        return _table(f"<tr>{cells}</tr>", "margin: 4px 0 12px 0;", width="")

    def text(self) -> str:
        return "\n".join(b.text() for b in self.items)


@dataclass
class LinkFallback(Block):
    """The "button not working?" line with the raw URL, small and grey."""

    url: str
    # Templates pass the translated "common.copy_paste"; this is its English.
    label: Content = "Button not working? Paste this link into your browser:"

    def html(self, ctx: Ctx) -> str:
        return _p(
            f'{esc(self.label)}<br><a href="{esc(self.url)}" style="color: {INK["muted"]}; text-decoration: underline;">'
            f"{esc(self.url)}</a>",
            f"{font(12, INK['muted'])} word-break: break-all;", "0 0 20px 0",
        )

    def text(self) -> str:
        return ""  # the button line already carries the URL


@dataclass
class Code(Block):
    """A one-time or invite code on the surface-sunken chip."""

    code: str

    def html(self, ctx: Ctx) -> str:
        return _table(
            f'<tr><td style="padding: 14px 20px; border-radius: 12px; background-color: {INK["sunken"]}; '
            f'font-family: {MONO_STACK}; font-size: 20px; line-height: 24px; font-weight: 600; letter-spacing: 2px; '
            f'color: {INK["text"]};">{esc(self.code)}</td></tr>',
            "margin: 0 0 20px 0;", width="",
        )

    def text(self) -> str:
        return self.code


TONE_OF = {"danger": "rose", "warning": "amber", "success": "emerald", "info": "sky", "ai": "violet"}


@dataclass
class Callout(Block):
    """An info panel. Neutral by default; a status tone tints it like a banner."""

    content: Content
    tone: str = "neutral"
    title: Optional[Content] = None

    def html(self, ctx: Ctx) -> str:
        name = TONE_OF.get(self.tone, self.tone)
        if name in ("neutral", "", None):
            bg, border, ink = INK["muted_bg"], INK["muted_border"], INK["body"]
        else:
            t = get_tone(name)
            bg, border, ink = t.tile, t.border, t.ink
        lead = f'<p style="margin: 0 0 4px 0; {font(13, ink, 600)}">{esc(self.title)}</p>' if self.title else ""
        return _table(
            f'<tr><td style="padding: 16px; border-radius: 12px; background-color: {bg}; border: 1px solid {border};">'
            f'{lead}<p style="margin: 0; {font(14, ink)}">{esc(self.content)}</p></td></tr>',
            "margin: 0 0 20px 0;",
        )

    def text(self) -> str:
        head = f"{to_text(self.title)}: " if self.title else ""
        return f"{head}{to_text(self.content)}"


@dataclass
class Quote(Block):
    """Someone's own words (an inviter's note, a comment) in the info panel."""

    content: str
    attribution: Optional[Content] = None

    def html(self, ctx: Ctx) -> str:
        who = f'<p style="margin: 0 0 6px 0; {font(12, INK["muted"], 600)}">{esc(self.attribution)}</p>' if self.attribution else ""
        body = esc(self.content).replace("\n", "<br>")
        return _table(
            f'<tr><td style="padding: 16px; border-radius: 12px; background-color: {INK["muted_bg"]}; '
            f'border: 1px solid {INK["muted_border"]};">{who}<p style="margin: 0; {font(14, INK["body"])}">{body}</p></td></tr>',
            "margin: 0 0 20px 0;",
        )

    def text(self) -> str:
        who = f"{to_text(self.attribution)}\n" if self.attribution else ""
        return who + "\n".join(f"> {line}" for line in self.content.splitlines() or [""])


@dataclass
class Details(Block):
    """Panel divided: label (13px muted) / value (14px medium) rows."""

    rows: Sequence[tuple[Content, Content]]

    def html(self, ctx: Ctx) -> str:
        rows = [(label, value) for label, value in self.rows if value not in (None, "")]
        if not rows:
            return ""
        trs = "".join(
            f'<tr><td valign="middle" style="padding: 12px 16px; {"border-top: 1px solid " + INK["hairline"] + ";" if i else ""} '
            f'{font(13, INK["muted"])}">{esc(label)}</td>'
            f'<td valign="middle" style="padding: 12px 16px; {"border-top: 1px solid " + INK["hairline"] + ";" if i else ""} '
            f'{font(14, INK["text"], 500)} text-align: {ctx.end};">{esc(value)}</td></tr>'
            for i, (label, value) in enumerate(rows)
        )
        return _panel(trs)

    def text(self) -> str:
        return "\n".join(f"{to_text(label)}: {to_text(value)}" for label, value in self.rows if value not in (None, ""))


@dataclass
class BulletList(Block):
    items: Sequence[Content]

    def html(self, ctx: Ctx) -> str:
        if not self.items:
            return ""
        side = "right" if ctx.align == "right" else "left"
        items = "".join(f'<li style="margin: 0 0 6px 0; {font(14, INK["body"])}">{esc(item)}</li>' for item in self.items)
        return f'<ul style="margin: 0 0 16px 0; padding-{side}: 20px;">{items}</ul>'

    def text(self) -> str:
        return "\n".join(f"- {to_text(item)}" for item in self.items)


@dataclass
class Stat:
    label: Content
    value: object
    icon: str = ""
    tone: str = ""


@dataclass
class Stats(Block):
    """StatCard tiles, two per row: icon tile, label, 20px value."""

    items: Sequence[Union[Stat, tuple]]

    def _stat(self, item) -> Stat:
        return item if isinstance(item, Stat) else Stat(*item)

    def html(self, ctx: Ctx) -> str:
        stats = [self._stat(i) for i in self.items]
        if not stats:
            return ""
        cells = []
        for s in stats:
            tile = (
                f'<td width="32" valign="middle" style="width: 32px; padding-right: 12px;">'
                f'{icon_tile(s.icon, s.tone or ctx.tone, size=32, glyph=16, radius=8)}</td>'
                if s.icon else ""
            )
            cells.append(
                '<td width="50%" valign="top" style="width: 50%; padding: 0 4px 8px 4px;">'
                + _table(
                    f'<tr><td style="padding: 14px 16px; border-radius: 16px; background-color: {INK["card"]}; '
                    f'border: 1px solid {INK["card_border"]};">'
                    + _table(
                        f'<tr>{tile}<td valign="middle"><div style="{font(12, INK["muted"], 500, "1.4")}">{esc(s.label)}</div>'
                        f'<div style="{font(20, INK["text"], 700, "1.3")} font-variant-numeric: tabular-nums;">'
                        f"{esc(s.value)}</div></td></tr>"
                    )
                    + "</td></tr>"
                )
                + "</td>"
            )
        rows = "".join(f"<tr>{''.join(cells[i:i + 2])}</tr>" for i in range(0, len(cells), 2))
        return _table(rows, "margin: 0 -4px 12px -4px;")

    def text(self) -> str:
        return "   ".join(f"{to_text(s.label)}: {s.value}" for s in (self._stat(i) for i in self.items))


@dataclass
class Row:
    """One entry of an :class:`Items` list."""

    title: Content
    body: Content = ""
    url: str = ""
    meta: Content = ""  # end-aligned count or short status (may be a chip)
    avatar: str = ""  # initial(s) or an image URL


@dataclass
class Items(Block):
    """Panel divided list: avatar tile, title, a muted line, a meta on the end."""

    rows: Sequence[Row]
    more: Content = ""

    def _avatar(self, row: Row) -> str:
        if row.avatar.startswith(("https://", "http://")):
            inner = (
                f'<img src="{esc(row.avatar)}" width="32" height="32" alt="" '
                'style="display: block; width: 32px; height: 32px; border: 0; border-radius: 16px;">'
            )
        else:
            inner = _table(
                f'<tr><td width="32" height="32" align="center" valign="middle" style="width: 32px; height: 32px; '
                f'border-radius: 16px; background-color: {INK["sunken"]}; {font(12, INK["body"], 600, "32px")} '
                f'text-align: center;">{esc(row.avatar)}</td></tr>',
                width="",
            )
        return f'<td width="44" valign="top" style="width: 44px;">{inner}</td>'

    def html(self, ctx: Ctx) -> str:
        if not self.rows:
            return ""
        out = []
        for i, row in enumerate(self.rows):
            line = f"border-top: 1px solid {INK['hairline']};" if i else ""
            title = esc(row.title)
            if row.url:
                title = Safe(f'<a href="{esc(row.url)}" style="color: {INK["text"]}; text-decoration: none;">{title}</a>')
            body = f'<div style="margin-top: 2px; {font(13, INK["muted"], 400, "1.45")}">{esc(row.body)}</div>' if row.body else ""
            meta = (
                f'<td valign="middle" style="padding-left: 12px; {font(12, INK["muted"])} text-align: {ctx.end}; '
                f'white-space: nowrap;">{esc(row.meta)}</td>'
                if row.meta not in ("", None) else ""
            )
            out.append(
                f'<tr><td style="padding: 12px 16px; {line}">'
                + _table(
                    f'<tr>{self._avatar(row) if row.avatar else ""}<td valign="middle" style="text-align: {ctx.start};">'
                    f'<div style="{font(14, INK["text"], 500, "1.4")}">{title}</div>{body}</td>{meta}</tr>'
                )
                + "</td></tr>"
            )
        more = _p(esc(self.more), font(12, INK["muted"]), "-8px 0 20px 0") if self.more else ""
        return _panel("".join(out)) + more

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
    """A titled Panel divided list of short rows (digests)."""

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
                    style = f"{font(13, INK['muted'])} text-align: {ctx.end}; white-space: nowrap;"
                else:
                    style = font(13, INK["body"])
                tds.append(f'<td style="padding: 12px 16px; {line} {style}">{esc(value)}</td>')
            trs.append(f"<tr>{''.join(tds)}</tr>")
        more = (
            _p(esc(self.more), font(12, INK["muted"]), "-8px 0 20px 0")
            if self.more and len(self.rows) > self.limit else ""
        )
        return Subheading(self.title).html(ctx) + _panel("".join(trs)) + more

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
        joined = " &middot; ".join(
            f'<a href="{esc(url)}" style="color: {INK["text"]}; font-weight: 500; text-decoration: underline;">{esc(label)}</a>'
            for label, url in self.links
        )
        lead = f"{esc(self.lead)} " if self.lead else ""
        return _p(f"{lead}{joined}", font(13, INK["muted"]))

    def text(self) -> str:
        lead = f"{to_text(self.lead)}\n" if self.lead else ""
        return lead + "\n".join(f"{to_text(label)}: {url}" for label, url in self.links)


@dataclass
class Divider(Block):
    def html(self, ctx: Ctx) -> str:
        return f'<hr style="margin: 4px 0 20px 0; border: none; border-top: 1px solid {INK["hairline"]};">'

    def text(self) -> str:
        return "---"


_PROSE_STYLES = {
    "p": "margin: 0 0 14px 0; font-size: 14px; line-height: 1.55; color: {body};",
    "ul": "margin: 0 0 14px 0; padding-{start}: 20px; color: {body};",
    "ol": "margin: 0 0 14px 0; padding-{start}: 20px; color: {body};",
    "li": "margin: 0 0 6px 0; font-size: 14px; line-height: 1.55;",
    "a": "color: {text}; font-weight: 500; text-decoration: underline;",
    "strong": "color: {text}; font-weight: 600;",
    "h2": "margin: 20px 0 8px 0; font-size: 16px; font-weight: 600; color: {text};",
    "h3": "margin: 16px 0 8px 0; font-size: 14px; font-weight: 600; color: {text};",
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
    "Heading", "Hero", "Items", "LinkFallback", "Links", "Paragraph", "Prose", "Quote", "Row", "Safe", "Stat",
    "Stats", "Subheading", "Table", "asset_url", "chip", "compact", "esc", "icon_tile", "icon_url", "to_text",
]
