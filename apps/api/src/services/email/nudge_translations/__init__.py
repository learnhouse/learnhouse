"""Lifecycle nudge email copy, one module per locale.

Split by locale rather than kept in a single dict: thirty nudges across twenty
languages is a few thousand strings, and a reviewer looking at a translation
change should see one language's diff, not a wall of unrelated scripts.

The English module is the source text — every other locale translates from it,
and ``t()`` falls back to English per key, so a locale that lags behind renders
correct English for the missing entries while keeping its own translations for
the rest.

Copy conventions, because these go to teachers and trainers rather than funnel
targets: plain subject lines, no emoji, no manufactured urgency, name the
reader's own course instead of describing it generically, and never write a
plan name, limit or price into a string — those arrive as placeholders filled
from ``plans.py`` at render time.

Placeholders available to every nudge: ``{org_name}``, ``{course_name}``,
``{plan_name}``, ``{next_plan}``.
"""

from typing import Final

from src.services.email.nudge_translations import (
    ar,
    bn,
    de,
    en,
    es,
    fr,
    hi,
    id as id_locale,
    it,
    ja,
    ko,
    nl,
    pl,
    pt,
    ru,
    th,
    tr,
    uk,
    vi,
    zh,
)

_LOCALE_MODULES = {
    "en": en,
    "fr": fr,
    "de": de,
    "es": es,
    "ar": ar,
    "ja": ja,
    "pt": pt,
    "ru": ru,
    "zh": zh,
    "hi": hi,
    "ko": ko,
    "it": it,
    "tr": tr,
    "vi": vi,
    "id": id_locale,
    "pl": pl,
    "uk": uk,
    "nl": nl,
    "th": th,
    "bn": bn,
}

NUDGE_TRANSLATIONS: Final[dict[str, dict[str, str]]] = {
    code: module.STRINGS for code, module in _LOCALE_MODULES.items()
}
