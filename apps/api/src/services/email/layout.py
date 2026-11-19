"""The one email layout, built from the V2 kit.

Every message LearnHouse sends is an :class:`Email` (subject, blocks, footer
facts) rendered here into the same frame, the email form of a dashboard
SectionCard:

* the ``#f8f8f8`` canvas and a centred 560px white card, radius 16, with the
  kit's ``nice-shadow`` relief and a 1px border for clients that drop
  box-shadow (Gmail);
* inside the card, the sender's mark (the LearnHouse wordmark PNG, the org's
  logo, or the org's name) over a hairline;
* the hero: the email's first heading and paragraph become a SectionCard
  header with a 40px icon tile in the email's tone;
* the body blocks (Panel rows, StatCards, chips, info panels, the button);
* a footer outside the card on the canvas: why the reader got it, manage /
  unsubscribe links, then the grey LearnHouse wordmark, or "Sent by {org}
  via LearnHouse" on org mail.

Tables and inline styles throughout, VML for Outlook's rounded button, and an
explicit light scheme.
"""

from __future__ import annotations

import html
import os
from dataclasses import dataclass, field
from typing import Optional, Sequence

from src.services.email.blocks import (
    Block,
    Ctx,
    Heading,
    Hero,
    Paragraph,
    asset_url,
    esc,
    font,
    to_text,
)
from src.services.email.theme import CARD_SHADOW, FONT_CSS_URL, INK, RTL_LANGUAGES, category

LEARNHOUSE_NAME = "LearnHouse"
LOGO_FILE = "learnhouse-wordmark@2x.png"
FOOTER_LOGO_FILE = "learnhouse-wordmark-grey@2x.png"

# Media directory of the square logo variant (see ``upload_org_square_logo``).
SQUARE_LOGO_DIR = "/square_logos/"


@dataclass(frozen=True)
class Brand:
    """Who the email is from, visually.

    ``org_scoped`` mail is the organization's own: its logo or name in the
    card header, its colour on the button, its name as the From display name,
    and "Sent by {org} via LearnHouse" under the card. Platform mail carries
    the LearnHouse wordmark. ``powered_by`` is kept for callers; the footer
    line no longer depends on it.
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
    # The hero's icon (a name from ``theme.ICONS``) and tone; default: the category's.
    icon: str = ""
    tone: str = ""
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


# ── marks ────────────────────────────────────────────────────────────────


def learnhouse_logo_url() -> str:
    return (os.environ.get("LEARNHOUSE_EMAIL_LOGO_URL") or asset_url(LOGO_FILE)).strip()


ALT_STYLE = f"{font(16, INK['text'], 600, '1.3')}"


def learnhouse_mark() -> str:
    """The LearnHouse wordmark, 22px tall; its ``alt`` reads "LearnHouse" when images are off."""
    return (
        f'<img src="{esc(learnhouse_logo_url())}" alt="LearnHouse" width="150" height="22" '
        f'style="display: block; width: 150px; height: 22px; border: 0; {ALT_STYLE}">'
    )


def org_logo_img(logo_url: str, alt: str) -> str:
    """<img> for an org's uploaded logo: a square mark at 36px, a wide one at most 32px tall.

    ``width``/``height`` attributes are for desktop Outlook, which ignores
    ``max-width``. When images are blocked the ``alt`` (the org name) shows.
    """
    if SQUARE_LOGO_DIR in logo_url:
        return (
            f'<img src="{esc(logo_url)}" alt="{esc(alt)}" width="36" height="36" '
            f'style="display: block; width: 36px; height: 36px; border: 0; border-radius: 10px; {ALT_STYLE}">'
        )
    return (
        f'<img src="{esc(logo_url)}" alt="{esc(alt)}" height="32" '
        f'style="display: block; max-height: 32px; max-width: 180px; height: auto; width: auto; border: 0; {ALT_STYLE}">'
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
        f"line-height: 1px; color: {INK['canvas']}; opacity: 0;"
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
        if isinstance(block, Hero) and block.description:
            return first_sentence(to_text(block.description))
    return ""


def with_hero(email: Email, cat: str) -> tuple[list[Block], str]:
    """The blocks with the opening heading (and its paragraph) as the hero, and the tone."""
    c = category(cat)
    tone_name = email.tone or c.tone
    blocks = list(email.blocks)
    if blocks and isinstance(blocks[0], Heading):
        description = None
        if len(blocks) > 1 and isinstance(blocks[1], Paragraph) and not blocks[1].small:
            description = blocks.pop(1).content
        blocks[0] = Hero(blocks[0].content, description, email.icon or c.icon, tone_name)
    return blocks, tone_name


# ── the frame ────────────────────────────────────────────────────────────


HEAD_CSS = f"""<link href="{FONT_CSS_URL}" rel="stylesheet">
<style>
  :root {{ color-scheme: light; supported-color-schemes: light; }}
  @media only screen and (max-width: 480px) {{
    .lh-pad {{ padding: 20px !important; }}
    .lh-outer {{ padding: 16px 8px !important; }}
  }}
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


def sent_by(lang: str, org_name: str) -> str:
    """"Sent by {org} via LearnHouse" in the email's language."""
    from src.services.email.translations import t

    return t(lang, "common.sent_by", org=org_name)


def footer_html(email: Email, brand: Brand, lang: str = "en") -> str:
    """The lines under the card: reason, links, then the sender line or wordmark."""
    small = f"margin: 0 0 6px 0; {font(12, INK['faint'], 400, '1.6')} text-align: center;"
    link = f"color: {INK['faint']}; text-decoration: underline;"
    parts = [f'<p style="{small}">{esc(line)}</p>' for line in (email.reason, email.footer) if line]
    links = []
    if email.manage_url:
        links.append(f'<a href="{esc(email.manage_url)}" style="{link}">{esc(email.manage_label)}</a>')
    if email.unsubscribe_url:
        links.append(f'<a href="{esc(email.unsubscribe_url)}" style="{link}">{esc(email.unsubscribe_label)}</a>')
    if links:
        parts.append(f'<p style="{small}">{" &nbsp;&middot;&nbsp; ".join(links)}</p>')
    if brand.org_scoped:
        parts.append(f'<p style="{small} margin-top: 12px;">{esc(sent_by(lang, brand.name))}</p>')
    else:
        parts.append(
            '<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin: 14px auto 0 auto;">'
            f'<tr><td><img src="{esc(asset_url(FOOTER_LOGO_FILE))}" alt="LearnHouse" width="109" height="16" '
            f'style="display: block; width: 109px; height: 16px; border: 0; {font(12, INK["faint"], 600)}"></td></tr></table>'
        )
    return "".join(parts)


def render_html(email: Email, brand: Brand, category_name: str, lang: str) -> str:
    from src.services.email.translations import normalize_language

    code = normalize_language(lang)
    rtl = code in RTL_LANGUAGES
    align = "right" if rtl else "left"
    button_bg, button_fg = _button_colors(brand)
    blocks, tone_name = with_hero(email, category_name)
    ctx = Ctx(button_bg=button_bg, button_fg=button_fg, align=align, tone=tone_name,
              org_button=button_bg != INK["ink"])
    body = "".join(block.html(ctx) for block in blocks)
    title = next(
        (to_text(b.title if isinstance(b, Hero) else b.content) for b in blocks if isinstance(b, (Hero, Heading))),
        email.subject,
    )

    return f"""<!DOCTYPE html>
<html lang="{code}" dir="{"rtl" if rtl else "ltr"}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{html.escape(' '.join(title.split()))}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
{HEAD_CSS}
</head>
<body style="margin: 0; padding: 0; width: 100%; background-color: {INK['canvas']}; -webkit-font-smoothing: antialiased; -webkit-text-size-adjust: 100%;">{preheader_block(_auto_preheader(email))}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{INK['canvas']}" style="background-color: {INK['canvas']};">
<tr><td align="center" class="lh-outer" style="padding: 40px 16px;">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{INK['card']}" style="width: 100%; max-width: 560px; background-color: {INK['card']}; border: 1px solid {INK['card_border']}; border-radius: 16px; border-collapse: separate; box-shadow: {CARD_SHADOW};">
<tr><td class="lh-pad" style="padding: 32px; text-align: {align};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding: 0 0 20px 0; border-bottom: 1px solid {INK['hairline']}; text-align: {align};">{sender_mark(brand)}</td></tr></table>
<div style="height: 24px; line-height: 24px; font-size: 0;">&nbsp;</div>
{body}
</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 560px;">
<tr><td align="center" style="padding: 24px 24px 0 24px;">{footer_html(email, brand, lang)}</td></tr>
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
    footer.append(sent_by(lang, brand.name) if brand.org_scoped else "LearnHouse")
    parts.append("--\n" + "\n".join(footer))
    return "\n\n".join(parts).strip() + "\n"
