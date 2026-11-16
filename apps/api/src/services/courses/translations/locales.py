"""Locale codes and the learner's language resolution."""

from __future__ import annotations

import re
from typing import Iterable, Optional

# The web app's UI languages; editors pick from these first.
UI_LOCALES = (
    "ar", "bn", "de", "en", "es", "fa", "fr", "hi", "id", "it", "ja",
    "ko", "nl", "pl", "pt", "ru", "sk", "th", "tr", "uk", "vi", "zh",
)
RTL_LANGUAGES = frozenset({"ar", "fa", "he", "ur"})
FALLBACK_LOCALE = "en"
MAX_PREFERENCES = 8

_LOCALE = re.compile(r"^[a-z]{2,3}(-(?:[A-Z]{2}|[A-Z][a-z]{3}|\d{3}))?$")

LANGUAGE_NAMES = {
    "ar": "Arabic", "bn": "Bengali", "de": "German", "en": "English", "es": "Spanish", "fa": "Persian",
    "fr": "French", "hi": "Hindi", "id": "Indonesian", "it": "Italian", "ja": "Japanese", "ko": "Korean",
    "nl": "Dutch", "pl": "Polish", "pt": "Portuguese", "ru": "Russian", "sk": "Slovak", "th": "Thai",
    "tr": "Turkish", "uk": "Ukrainian", "vi": "Vietnamese", "zh": "Chinese", "he": "Hebrew", "ur": "Urdu",
    "sv": "Swedish", "da": "Danish", "no": "Norwegian", "nb": "Norwegian", "fi": "Finnish", "cs": "Czech",
    "el": "Greek", "hu": "Hungarian", "ro": "Romanian", "bg": "Bulgarian", "hr": "Croatian", "sr": "Serbian",
    "ms": "Malay", "sw": "Swahili", "ta": "Tamil", "te": "Telugu", "ca": "Catalan", "et": "Estonian",
    "lt": "Lithuanian", "lv": "Latvian", "sl": "Slovenian", "fil": "Filipino", "tl": "Tagalog",
}


def normalize_locale(raw: object) -> Optional[str]:
    """``pt_br`` -> ``pt-BR``, ``ZH-hans`` -> ``zh-Hans``; None when not a code."""
    if not isinstance(raw, str):
        return None
    parts = [p for p in raw.strip().replace("_", "-").split("-") if p]
    if not parts or not re.fullmatch(r"[A-Za-z]{2,3}", parts[0]):
        return None
    out = [parts[0].lower()]
    if len(parts) > 1:
        sub = parts[1]
        if re.fullmatch(r"[A-Za-z]{2}", sub):
            out.append(sub.upper())
        elif re.fullmatch(r"[A-Za-z]{4}", sub):
            out.append(sub[0].upper() + sub[1:].lower())
        elif re.fullmatch(r"\d{3}", sub):
            out.append(sub)
    code = "-".join(out)
    return code if _LOCALE.match(code) else None


def is_valid_locale(code: object) -> bool:
    return isinstance(code, str) and bool(_LOCALE.match(code))


def base_language(code: str) -> str:
    return code.split("-", 1)[0]


def is_rtl(code: Optional[str]) -> bool:
    return bool(code) and base_language(code) in RTL_LANGUAGES


def language_name(code: Optional[str]) -> str:
    if not code:
        return ""
    return LANGUAGE_NAMES.get(base_language(code), code)


def parse_preferences(raw: Optional[str]) -> list[str]:
    """``lang`` query value (comma list, or an Accept-Language header) ->
    normalized codes, most preferred first, without duplicates."""
    if not raw:
        return []
    weighted: list[tuple[float, int, str]] = []
    for i, item in enumerate(raw.split(",")[: MAX_PREFERENCES * 3]):
        token, _, params = item.strip().partition(";")
        q = 1.0
        if params.strip().startswith("q="):
            try:
                q = float(params.strip()[2:])
            except ValueError:
                q = 0.0
        code = normalize_locale(token)
        if code and q > 0:
            weighted.append((-q, i, code))
    out: list[str] = []
    for _, _, code in sorted(weighted):
        if code not in out:
            out.append(code)
    return out[:MAX_PREFERENCES]


def match_locale(preferences: Iterable[str], available: Iterable[str]) -> Optional[str]:
    """The first available locale for the preference list: exact code, then
    same base language (``fr-CA`` -> ``fr``; ``pt`` -> ``pt-BR``)."""
    avail = [a for a in available if a]
    for pref in preferences:
        if pref in avail:
            return pref
        base = base_language(pref)
        if base in avail:
            return base
        for a in avail:
            if base_language(a) == base:
                return a
    return None


def resolve_locale(
    preferences: Iterable[str],
    default_locale: Optional[str],
    published: Iterable[str],
) -> tuple[str, bool]:
    """(locale to serve, fallback) for a course.

    ``published`` are the course's published translation locales. The
    default locale wins when it matches a preference first; a preference
    nothing matches is skipped. ``fallback`` is True when there were
    preferences and none could be served (the default is served then)."""
    default = default_locale or FALLBACK_LOCALE
    prefs = list(preferences)
    if not prefs:
        return default, False
    chosen = match_locale(prefs, [default, *published])
    if chosen is None:
        return default, True
    return chosen, False
