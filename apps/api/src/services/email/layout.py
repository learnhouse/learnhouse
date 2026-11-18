"""The one email layout, in the V2 design language.

Every message LearnHouse sends, whatever feature sends it, is an
:class:`Email` (subject, blocks, footer facts) rendered here into the same
frame, the one the V2 transactional templates already use:

* the ``#f8f8f8`` canvas and a white 16px card with the V2 card shadow;
* a thin rule on top of the card in the category's accent (the only
  decoration; nothing is coloured for its own sake);
* the sender's mark: the LearnHouse logo, or for org-scoped mail the
  organization's uploaded logo, else its name set in text;
* the body blocks;
* a quiet footer: why the reader got it, manage / unsubscribe links where
  they apply, and the platform line ("Powered by LearnHouse" on org mail).

Tables and inline styles only (Outlook's Word engine, Gmail's style
stripping). The light scheme is declared explicitly, as in the product, where
light is the default.
"""

from __future__ import annotations

import html
import os
from dataclasses import dataclass, field
from typing import Optional, Sequence

from src.services.email.blocks import Block, Ctx, Heading, Paragraph, esc, to_text
from src.services.email.theme import FONT_STACK, INK, RTL_LANGUAGES, palette

LEARNHOUSE_NAME = "LearnHouse"
POWERED_BY_URL = "https://www.learnhouse.io"
# The hosted LearnHouse wordmark, as in the V2 email templates. Override with
# LEARNHOUSE_EMAIL_LOGO_URL (self-hosted installs can point at their own copy).
DEFAULT_LOGO_URL = "https://www.learnhouse.app/new/learnhouse-dark.svg"

# Media directory of the square logo variant (see ``upload_org_square_logo``).
SQUARE_LOGO_DIR = "/square_logos/"


@dataclass(frozen=True)
class Brand:
    """Who the email is from, visually.

    ``org_scoped`` mail is the organization's own: its logo or name in the
    header, its colour on the buttons, its name as the From display name, and
    the "Powered by LearnHouse" line when ``powered_by`` is on. Platform mail
    keeps the LearnHouse mark.
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
    eyebrow: str = ""
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


def learnhouse_mark() -> str:
    """The LearnHouse wordmark image; its ``alt`` reads "LearnHouse" when images are off."""
    return (
        f'<img src="{esc(learnhouse_logo_url())}" alt="LearnHouse" width="132" height="20" '
        f'style="display: block; width: 132px; height: auto; max-height: 20px; border: 0; '
        f'font-family: {FONT_STACK}; font-size: 16px; font-weight: 700; color: {INK["text"]};">'
    )


def org_logo_img(logo_url: str, alt: str) -> str:
    """<img> for an org's uploaded logo: a square mark at 40px, a wide one letterboxed.

    ``width``/``height`` attributes are for desktop Outlook, which ignores
    ``max-width``; every other client lets the inline style win. When images
    are blocked the ``alt`` (the org name) shows instead.
    """
    alt_style = f"font-family: {FONT_STACK}; font-size: 16px; font-weight: 600; color: {INK['text']};"
    if SQUARE_LOGO_DIR in logo_url:
        return (
            f'<img src="{esc(logo_url)}" alt="{esc(alt)}" width="40" height="40" '
            f'style="display: block; width: 40px; height: 40px; border: 0; border-radius: 12px; {alt_style}">'
        )
    return (
        f'<img src="{esc(logo_url)}" alt="{esc(alt)}" height="32" '
        f'style="display: block; max-height: 32px; max-width: 180px; height: auto; width: auto; border: 0; {alt_style}">'
    )


def org_name_mark(name: str) -> str:
    """An org without a logo: its name in text. Never the LearnHouse mark, never a fake tile."""
    return (
        f'<span style="font-family: {FONT_STACK}; font-size: 16px; font-weight: 600; letter-spacing: -0.02em; '
        f'color: {INK["text"]};">{esc(name)}</span>'
    )


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
        "line-height: 1px; color: #f8f8f8; opacity: 0;"
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
  @media only screen and (max-width: 560px) {
    .lh-pad { padding-left: 24px !important; padding-right: 24px !important; }
    .lh-outer { padding: 16px 8px 32px 8px !important; }
  }
</style>"""


def _button_colors(brand: Brand) -> tuple[str, str]:
    """The primary fill: the org's accent on its own mail, else the V2 ink.

    A near-white org colour would vanish on the white card, so those orgs keep
    the ink button.
    """
    from src.services.email.branding import contrasting_text_color, is_near_white, normalize_brand_color

    color = normalize_brand_color(brand.color) if brand.org_scoped else None
    if not color or is_near_white(color):
        return INK["ink"], "#ffffff"
    return color, contrasting_text_color(color)


def footer_html(email: Email, brand: Brand, lang: str) -> str:
    from src.services.email.translations import t

    small = f"margin: 0 0 6px 0; font-family: {FONT_STACK}; font-size: 12px; line-height: 1.6; color: {INK['faint']};"
    link = f"color: {INK['muted']}; text-decoration: underline;"
    parts = [f'<p style="{small}">{esc(line)}</p>' for line in (email.reason, email.footer) if line]
    links = []
    if email.manage_url:
        links.append(f'<a href="{esc(email.manage_url)}" style="{link}">{esc(email.manage_label)}</a>')
    if email.unsubscribe_url:
        links.append(f'<a href="{esc(email.unsubscribe_url)}" style="{link}">{esc(email.unsubscribe_label)}</a>')
    if links:
        parts.append(f'<p style="{small}">{" &nbsp;&middot;&nbsp; ".join(links)}</p>')
    if brand.org_scoped:
        if brand.powered_by:
            parts.append(
                f'<p style="{small} margin-top: 12px;"><a href="{POWERED_BY_URL}" style="color: {INK["faint"]}; '
                f'text-decoration: none;">{esc(t(lang, "common.powered_by"))}</a></p>'
            )
    else:
        parts.append(f'<p style="{small} margin-top: 12px;">LearnHouse, the open-source learning platform.</p>')
    return (
        f'<tr><td class="lh-pad" style="padding: 0 40px 32px 40px;">'
        f'<hr style="margin: 0 0 18px 0; border: none; border-top: 1px solid {INK["border"]};">'
        f'{"".join(parts)}</td></tr>'
    )


def render_html(email: Email, brand: Brand, category: str, lang: str) -> str:
    from src.services.email.translations import normalize_language

    pal = palette(category)
    code = normalize_language(lang)
    rtl = code in RTL_LANGUAGES
    align = "right" if rtl else "left"
    button_bg, button_fg = _button_colors(brand)
    ctx = Ctx(palette=pal, button_bg=button_bg, button_fg=button_fg, align=align)
    body = "".join(block.html(ctx) for block in email.blocks)
    eyebrow = (
        f'<p style="margin: 0 0 8px 0; font-family: {FONT_STACK}; font-size: 11px; font-weight: 600; '
        f'letter-spacing: 0.05em; text-transform: uppercase; color: {pal.ink};">{esc(email.eyebrow)}</p>'
        if email.eyebrow
        else ""
    )
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
<body style="margin: 0; padding: 0; width: 100%; background-color: {INK['canvas']}; -webkit-font-smoothing: antialiased; -webkit-text-size-adjust: 100%;">{preheader_block(_auto_preheader(email))}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: {INK['canvas']};">
<tr><td align="center" class="lh-outer" style="padding: 40px 16px 56px 16px;">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 560px; background-color: {INK['card']}; border: 1px solid #ececec; border-radius: 16px; border-collapse: separate; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(209,213,219,0.25), 0 2px 4px -2px rgba(209,213,219,0.25);">
<tr><td style="height: 3px; padding: 0; background-color: {pal.rule}; font-size: 0; line-height: 0; border-radius: 16px 16px 0 0;">&nbsp;</td></tr>
<tr><td class="lh-pad" style="padding: 32px 40px 0 40px; text-align: {align};">{sender_mark(brand)}</td></tr>
<tr><td class="lh-pad" style="padding: 28px 40px 12px 40px; text-align: {align}; font-family: {FONT_STACK};">
{eyebrow}{body}
</td></tr>
{footer_html(email, brand, code)}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>"""


def render_text(email: Email, brand: Brand, lang: str = "en") -> str:
    """The ``text/plain`` alternative, block by block."""
    from src.services.email.translations import t

    parts = [brand.name]
    if email.eyebrow:
        parts.append(email.eyebrow.upper())
    parts += [chunk for chunk in (block.text() for block in email.blocks) if chunk]
    footer = [to_text(line) for line in (email.reason, email.footer) if line]
    if email.manage_url:
        footer.append(f"{email.manage_label}: {email.manage_url}")
    if email.unsubscribe_url:
        footer.append(f"{email.unsubscribe_label}: {email.unsubscribe_url}")
    if brand.org_scoped and brand.powered_by:
        footer.append(f"{to_text(t(lang, 'common.powered_by'))}: {POWERED_BY_URL}")
    if footer:
        parts.append("--\n" + "\n".join(footer))
    return "\n\n".join(parts).strip() + "\n"
