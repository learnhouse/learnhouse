"""Design tokens for every email LearnHouse sends.

Taken from the V2 design system (``apps/web/design/tokens.ts``, DESIGN.md) so
mail reads as part of the product: a ``#f8f8f8`` canvas, white 16px cards,
neutral greys for text, near-black primary buttons with 12px radius, and
colour only where it means something.

Each category gets one accent from the token palette, used sparingly: the
thin rule on top of the card and the small label above the title. Status
colours (info, success, warning, danger) are the token pairs and are only used
for callouts that carry that status. Violet is the AI colour and is reserved
for AI (Atlas) mail, as in the product.

Values land in inline ``style`` attributes: plain hex, never user input.
"""

from __future__ import annotations

from dataclasses import dataclass

# tokens.font.family; body tracking -0.02em (globals.css).
FONT_STACK = (
    "'Wix Madefor Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, "
    "'Helvetica Neue', Arial, sans-serif"
)
MONO_STACK = "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace"

# tokens.color roles (hex column).
INK = {
    "canvas": "#f8f8f8",        # canvas
    "card": "#ffffff",          # surface
    "muted_bg": "#fafafa",      # surface-muted
    "sunken": "#f5f5f5",        # surface-sunken
    "border": "#f5f5f5",        # border: rules inside cards
    "border_strong": "#e5e5e5",  # border-strong: rings, outlined cards
    "text": "#171717",          # fg
    "secondary": "#404040",     # fg-secondary
    "body": "#525252",          # body copy (neutral-600, as the V2 email templates)
    "muted": "#737373",         # fg-muted
    "faint": "#a3a3a3",         # fg-subtle
    "ink": "#171717",           # primary button fill
}


@dataclass(frozen=True)
class Palette:
    name: str
    label: str
    rule: str   # the thin rule on top of the card
    ink: str    # the small label above the title (contrast checked on white)


CATEGORIES: dict[str, Palette] = {
    # info / info-ink
    "security": Palette("security", "Account", rule="#0284c7", ink="#075985"),
    # success / success-ink
    "learning": Palette("learning", "Learning", rule="#059669", ink="#065f46"),
    # warning / warning-ink
    "billing": Palette("billing", "Billing", rule="#f59e0b", ink="#92400e"),
    # chart-1, the default series blue
    "community": Palette("community", "Messages", rule="#2a78d6", ink="#1f5fae"),
    # the dashboard stays neutral: ink rule, muted label
    "team": Palette("team", "Team", rule="#171717", ink="#737373"),
    # ai / ai-ink: AI features only (Atlas)
    "ai": Palette("ai", "Atlas", rule="#7c3aed", ink="#5b21b6"),
}

DEFAULT_CATEGORY = "team"

# Status pairs for callouts: (soft fill, ink).
TONES: dict[str, tuple[str, str]] = {
    "info": ("#f0f9ff", "#075985"),
    "success": ("#ecfdf5", "#065f46"),
    "warning": ("#fffbeb", "#92400e"),
    "danger": ("#fff1f2", "#be123c"),
    "neutral": ("#fafafa", "#404040"),
}


def palette(category: str | None) -> Palette:
    """The palette of ``category``; unknown names fall back to the neutral team one."""
    return CATEGORIES.get(category or "", CATEGORIES[DEFAULT_CATEGORY])


RTL_LANGUAGES = frozenset({"ar", "fa", "he", "ur"})
