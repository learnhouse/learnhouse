"""The one email layout.

Every message LearnHouse sends is an :class:`Email` (subject, blocks, footer
facts) rendered here into the same plain frame, the way product mail from
Linear, Vercel, Stripe or GitHub looks:

* a white page and a ~520px left-aligned column with normal margins;
* a small mark at the top: the LearnHouse wordmark (a hosted PNG; Gmail
  drops SVG images), or for org-scoped mail the organization's uploaded logo,
  else its name in text;
* the body blocks: a heading, short paragraphs, one button, a grey
  fallback link;
* one or two short grey footer lines: why the reader got it, manage /
  unsubscribe where they apply, and the company line on LearnHouse mail.

Inline styles only; tables where Outlook needs them. Light scheme only.
"""

from __future__ import annotations

import html
import os
from dataclasses import dataclass, field
from typing import Optional, Sequence

from src.services.email.blocks import Block, Ctx, Heading, Paragraph, esc, font, to_text
from src.services.email.theme import FONT_STACK, INK, RTL_LANGUAGES

LEARNHOUSE_NAME = "LearnHouse"
# The LearnHouse wordmark as a 2x PNG (apps/web/public/emails), served by the
# web app. PNG because Gmail drops SVG images. Override with
# LEARNHOUSE_EMAIL_LOGO_URL (self-hosted installs can point at their own copy).
DEFAULT_LOGO_URL = "https://www.learnhouse.io/emails/learnhouse-wordmark@2x.png"

# Media directory of the square logo variant (see ``upload_org_square_logo``).
SQUARE_LOGO_DIR = "/square_logos/"


@dataclass(frozen=True)
class Brand:
    """Who the email is from, visually.

    ``org_scoped`` mail is the organization's own: its logo or name at the
    top, its colour on the button, its name as the From display name.
    Platform mail keeps the LearnHouse wordmark and the company line.
    ``powered_by`` is carried for callers but no longer rendered.
    """

    name: str = LEARNHOUSE_NAME
    org_scoped: bool = False
    logo_url: Optional[str] = None
    color: Optional[str] = None
    powered_by: bool = False
    sender_name: Optional[str] = None
    lang: Optional[str] = None


PLATFORM_BRAND = Brand()


@dataclass
class Email:
    """A rendered-to-be message: what a template returns."""

    subject: str
    blocks: Sequence[Block]
    preheader: str = ""
    # Why the reader got this (plain or :class:`Safe`), shown first in the footer.
    reason: object = ""
    footer: object = ""
    unsubscribe_url: str = ""
    unsubscribe_label: str = "Unsubscribe"
    manage_url: str = ""
    manage_label: str = "Email preferences"
    # Add RFC 8058 one-click List-Unsubscribe headers (bulk lifecycle mail).
    one_click_unsubscribe: bool = False
    reply_to: str = ""
    headers: dict = field(default_factory=dict)


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    html: str
    text: str
    headers: dict
    sender_name: Optional[str] = None
    category: str = ""
    template: str = ""


# ── header marks ─────────────────────────────────────────────────────────


def learnhouse_logo_url() -> str:
    return (os.environ.get("LEARNHOUSE_EMAIL_LOGO_URL") or DEFAULT_LOGO_URL).strip()


ALT_STYLE = f"font-family: {FONT_STACK}; font-size: 16px; font-weight: 600; color: {INK['text']};"


def learnhouse_mark() -> str:
    """The LearnHouse wordmark, 20px tall; its ``alt`` reads "LearnHouse" when images are off."""
    return (
        f'<img src="{esc(learnhouse_logo_url())}" alt="LearnHouse" width="135" height="20" '
        f'style="display: block; width: 135px; height: 20px; border: 0; {ALT_STYLE}">'
    )


def org_logo_img(logo_url: str, alt: str) -> str:
    """<img> for an org's uploaded logo: a square mark at 32px, a wide one at most 28px tall.

    ``width``/``height`` attributes are for desktop Outlook, which ignores
    ``max-width``. When images are blocked the ``alt`` (the org name) shows.
    """
    if SQUARE_LOGO_DIR in logo_url:
        return (
            f'<img src="{esc(logo_url)}" alt="{esc(alt)}" width="32" height="32" '
            f'style="display: block; width: 32px; height: 32px; border: 0; border-radius: 6px; {ALT_STYLE}">'
        )
    return (
        f'<img src="{esc(logo_url)}" alt="{esc(alt)}" height="28" '
        f'style="display: block; max-height: 28px; max-width: 160px; height: auto; width: auto; border: 0; {ALT_STYLE}">'
    )


def org_name_mark(name: str) -> str:
    """An org without a logo: its name in text. Never the LearnHouse mark."""
    return f'<span style="{ALT_STYLE}">{esc(name)}</span>'


def sender_mark(brand: Brand) -> str:
    if not brand.org_scoped:
        return learnhouse_mark()
    if brand.logo_url:
        return org_logo_img(brand.logo_url, brand.name)
    return org_name_mark(brand.name)


# ── preheader ────────────────────────────────────────────────────────────


def first_sentence(text: str, limit: int = 110) -> str:
    """Opening sentence of ``text`` for the inbox preview line.

    Handles the full stops of every locale we ship (CJK, Arabic, Devanagari),
    then falls back to a word boundary.
    """
    text = " ".join((text or "").split())
    if not text:
        return ""
    for terminator in ("。", "۔", "।", ". ", "! ", "? ", "؟ "):
        head, sep, _tail = text.partition(terminator)
        if sep and len(head) <= limit:
            return (head + sep).strip()
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].strip() + "…"


def preheader_block(text: str) -> str:
    """Hidden inbox-preview text, padded so the client stops after it."""
    if not text:
        return ""
    hide = (
        "display: none; max-height: 0; overflow: hidden; mso-hide: all; font-size: 1px; "
        "line-height: 1px; color: #ffffff; opacity: 0;"
    )
    return (
        f'<div style="{hide}">{html.escape(text)}</div>'
        f'<div style="{hide}">{"&#847;&zwnj;&nbsp;" * 60}</div>'
    )


def _auto_preheader(email: Email) -> str:
    if email.preheader:
        return email.preheader
    for block in email.blocks:
        if isinstance(block, Paragraph):
            return first_sentence(block.text())
    return ""


# ── the frame ────────────────────────────────────────────────────────────


HEAD_CSS = """<style>
  :root { color-scheme: light; supported-color-schemes: light; }
  @media only screen and (max-width: 560px) { .lh-outer { padding: 24px 20px !important; } }
</style>"""

COMPANY_LINE = "LearnHouse, the open-source learning platform."


def _button_colors(brand: Brand) -> tuple[str, str]:
    """The button fill: the org's colour on its own mail, else near-black.

    A near-white org colour would vanish on the white page, so those orgs
    keep the dark button.
    """
    from src.services.email.branding import contrasting_text_color, is_near_white, normalize_brand_color

    color = normalize_brand_color(brand.color) if brand.org_scoped else None
    if not color or is_near_white(color):
        return INK["ink"], "#ffffff"
    return color, contrasting_text_color(color)


def footer_html(email: Email, brand: Brand) -> str:
    small = f"margin: 0 0 4px 0; {font(12, INK['faint'])}"
    link = f"color: {INK['faint']}; text-decoration: underline;"
    reason = " ".join(str(esc(line)) for line in (email.reason, email.footer) if line)
    links = []
    if email.manage_url:
        links.append(f'<a href="{esc(email.manage_url)}" style="{link}">{esc(email.manage_label)}</a>')
    if email.unsubscribe_url:
        links.append(f'<a href="{esc(email.unsubscribe_url)}" style="{link}">{esc(email.unsubscribe_label)}</a>')
    first = " &middot; ".join(p for p in (reason, " &middot; ".join(links)) if p)
    lines = [first] if first else []
    if not brand.org_scoped:
        lines.append(COMPANY_LINE)
    if not lines:
        return ""
    paragraphs = "".join(f'<p style="{small}">{line}</p>' for line in lines)
    return (
        '<tr><td style="padding: 16px 0 0 0;">'
        f'<hr style="margin: 0 0 16px 0; border: none; border-top: 1px solid {INK["hairline"]};">'
        f"{paragraphs}</td></tr>"
    )


def render_html(email: Email, brand: Brand, category: str, lang: str) -> str:
    from src.services.email.translations import normalize_language

    code = normalize_language(lang)
    rtl = code in RTL_LANGUAGES
    align = "right" if rtl else "left"
    button_bg, button_fg = _button_colors(brand)
    ctx = Ctx(button_bg=button_bg, button_fg=button_fg, align=align)
    body = "".join(block.html(ctx) for block in email.blocks)
    title = next((to_text(b.content) for b in email.blocks if isinstance(b, Heading)), email.subject)

    return f"""<!DOCTYPE html>
<html lang="{code}" dir="{"rtl" if rtl else "ltr"}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{html.escape(' '.join(title.split()))}</title>
{HEAD_CSS}
</head>
<body style="margin: 0; padding: 0; width: 100%; background-color: {INK['page']}; -webkit-text-size-adjust: 100%;">{preheader_block(_auto_preheader(email))}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: {INK['page']};">
<tr><td align="{align}" class="lh-outer" style="padding: 40px 24px;">
<!--[if mso]><table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 520px;">
<tr><td style="padding: 0 0 32px 0; text-align: {align};">{sender_mark(brand)}</td></tr>
<tr><td style="text-align: {align};">{body}</td></tr>
{footer_html(email, brand)}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>"""


def render_text(email: Email, brand: Brand, lang: str = "en") -> str:
    """The ``text/plain`` alternative, block by block."""
    parts = [brand.name]
    parts += [chunk for chunk in (block.text() for block in email.blocks) if chunk]
    footer = [to_text(line) for line in (email.reason, email.footer) if line]
    if email.manage_url:
        footer.append(f"{email.manage_label}: {email.manage_url}")
    if email.unsubscribe_url:
        footer.append(f"{email.unsubscribe_label}: {email.unsubscribe_url}")
    if not brand.org_scoped:
        footer.append(COMPANY_LINE)
    parts.append("--\n" + "\n".join(footer))
    return "\n\n".join(parts).strip() + "\n"
