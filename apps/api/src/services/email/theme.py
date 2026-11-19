"""Design tokens for every email LearnHouse sends: the V2 kit, in email form.

Mapped one to one from ``apps/web/design/tokens.ts`` and the DashKit parts
the dashboard is built from (Panel, SectionCard, StatCard, Chip, Button):

* the ``#f8f8f8`` canvas and a white 16px card with the ``nice-shadow``
  relief, plus a 1px border so it still reads as a box where box-shadow is
  dropped (Gmail);
* a SectionCard-style hero: a 40px rounded icon tile in the email's tone,
  then the title and description;
* Panel-divided label/value rows, StatCard tiles, pill chips, the
  surface-muted info panel and the near-black primary button with its relief.

Colour comes only from the tone (icon tile, chips, status): one accent per
email. Violet is the AI colour and is reserved for AI (Atlas), as in the
product.

Values land in inline ``style`` attributes: plain hex, never user input.
"""

from __future__ import annotations

from dataclasses import dataclass

# tokens.font.family (Wix Madefor Text), with the system stack behind it.
FONT_STACK = (
    "'Wix Madefor Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
)
MONO_STACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"
FONT_CSS_URL = "https://fonts.googleapis.com/css2?family=Wix+Madefor+Text:wght@400;500;600;700&display=swap"

# tokens.color roles (hex column). Borders that are alpha in the product are
# flattened onto white so Outlook, which ignores rgba(), draws the same line.
INK = {
    "canvas": "#f8f8f8",         # canvas
    "card": "#ffffff",           # surface
    "card_border": "#efefef",    # outline-neutral-200/60 on white
    "muted_bg": "#fafafa",       # surface-muted: info panels
    "muted_border": "#f0f0f0",
    "sunken": "#f5f5f5",         # surface-sunken: code, avatars, neutral tiles
    "hairline": "#f5f5f5",       # border: dividers inside cards
    "border_strong": "#e5e5e5",  # border-strong: secondary button
    "text": "#171717",           # fg
    "body": "#404040",           # fg-secondary
    "muted": "#737373",          # fg-muted
    "faint": "#a3a3a3",          # fg-subtle
    "ink": "#171717",            # primary button
}

CARD_SHADOW = "0 4px 6px -1px rgba(209,213,219,0.25), 0 2px 4px -2px rgba(209,213,219,0.25)"
BUTTON_SHADOW = "inset 0 1px 0 rgba(255,255,255,0.08), 0 1px 1px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.9)"


@dataclass(frozen=True)
class Tone:
    """A hue as the kit uses it: icon tile, chip, status."""

    name: str
    tile: str      # -50: icon tile and chip background
    icon: str      # -600: the icon
    ink: str       # -700: chip text
    border: str    # -100: chip outline


TONES: dict[str, Tone] = {
    "sky": Tone("sky", "#f0f9ff", "#0284c7", "#0369a1", "#e0f2fe"),
    "emerald": Tone("emerald", "#ecfdf5", "#059669", "#047857", "#d1fae5"),
    "amber": Tone("amber", "#fffbeb", "#d97706", "#b45309", "#fef3c7"),
    "rose": Tone("rose", "#fff1f2", "#e11d48", "#be123c", "#ffe4e6"),
    "violet": Tone("violet", "#f5f3ff", "#7c3aed", "#6d28d9", "#ede9fe"),
    "neutral": Tone("neutral", "#f5f5f5", "#525252", "#404040", "#e5e5e5"),
}


def tone(name: str | None) -> Tone:
    return TONES.get(name or "", TONES["neutral"])


@dataclass(frozen=True)
class Category:
    name: str
    label: str
    tone: str   # the default accent of the category's mail
    icon: str   # the default hero icon


CATEGORIES: dict[str, Category] = {
    "security": Category("security", "Account", "sky", "shield-check"),
    "learning": Category("learning", "Learning", "emerald", "book-open"),
    "billing": Category("billing", "Billing", "amber", "credit-card"),
    "community": Category("community", "Messages", "sky", "chat-circle-text"),
    "team": Category("team", "Team", "neutral", "buildings"),
    "ai": Category("ai", "Atlas", "violet", "sparkle"),
}

DEFAULT_CATEGORY = "team"


def category(name: str | None) -> Category:
    """The category ``name``; unknown names fall back to team."""
    return CATEGORIES.get(name or "", CATEGORIES[DEFAULT_CATEGORY])


# Hosted 2x PNGs of the Phosphor icons (regular weight) the templates use,
# in apps/web/public/emails/icons as ``{icon}-{tone}.png``. Exported by hand;
# a test checks every template's icon has its file.
ICONS: dict[str, tuple[str, ...]] = {
    "envelope-simple": ("sky",), "key": ("sky",), "sign-in": ("sky",), "user-circle": ("sky",),
    "shield-check": ("sky",), "trash": ("rose", "neutral"), "warning-circle": ("rose", "amber"),
    "credit-card": ("amber", "rose", "emerald"), "receipt": ("amber",), "user-plus": ("neutral", "sky"),
    "users": ("neutral", "emerald"), "buildings": ("neutral",), "identification-badge": ("neutral",),
    "book-open": ("emerald",), "rocket-launch": ("emerald",), "bell": ("sky", "neutral"),
    "chat-circle-text": ("sky",), "graduation-cap": ("emerald",), "calendar-blank": ("emerald",),
    "chart-bar": ("emerald", "neutral"), "sparkle": ("violet",), "plugs-connected": ("amber",),
    "paper-plane-tilt": ("amber",), "storefront": ("rose",), "handshake": ("emerald",), "lightning": ("neutral",),
    "check-circle": ("emerald",), "clock": ("amber",),
}

RTL_LANGUAGES = frozenset({"ar", "fa", "he", "ur"})
