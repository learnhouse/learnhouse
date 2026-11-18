"""Design tokens for every email LearnHouse sends.

Plain product mail, the way Linear, Vercel, Stripe or GitHub write it: a white
page, a narrow left-aligned column, the system font, near-black and grey text
from the V2 tokens (``apps/web/design/tokens.ts``), and a single dark button.
Nothing is coloured for decoration; the only colour an email can carry is an
organization's own accent on its button.

Categories (account, learning, billing, team, messages, AI) stay on every
template for routing, previews and analytics; they no longer change the look.

Values land in inline ``style`` attributes: plain hex, never user input.
"""

from __future__ import annotations

from dataclasses import dataclass

FONT_STACK = (
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, "
    "'Apple Color Emoji', 'Segoe UI Emoji'"
)
MONO_STACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

# tokens.color roles (hex column).
INK = {
    "page": "#ffffff",        # surface
    "text": "#171717",        # fg: headings, values
    "body": "#404040",        # fg-secondary: paragraphs
    "muted": "#737373",       # fg-muted: secondary lines, labels
    "faint": "#a3a3a3",       # fg-subtle: footer
    "rule": "#e5e5e5",        # border-strong: quote rule
    "hairline": "#f0f0f0",    # between list rows
    "ink": "#171717",         # the button
}


@dataclass(frozen=True)
class Category:
    name: str
    label: str


CATEGORIES: dict[str, Category] = {
    "security": Category("security", "Account"),
    "learning": Category("learning", "Learning"),
    "billing": Category("billing", "Billing"),
    "community": Category("community", "Messages"),
    "team": Category("team", "Team"),
    "ai": Category("ai", "Atlas"),
}

DEFAULT_CATEGORY = "team"


def category(name: str | None) -> Category:
    """The category ``name``; unknown names fall back to team."""
    return CATEGORIES.get(name or "", CATEGORIES[DEFAULT_CATEGORY])


RTL_LANGUAGES = frozenset({"ar", "fa", "he", "ur"})
