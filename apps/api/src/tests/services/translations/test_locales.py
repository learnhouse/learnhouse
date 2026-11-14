"""Locale codes and the learner's language resolution order."""

import pytest

from src.services.courses.translations import locales as L


@pytest.mark.parametrize("raw,expected", [
    ("fr", "fr"), ("FR", "fr"), ("pt_br", "pt-BR"), ("pt-br", "pt-BR"), ("zh-hans", "zh-Hans"),
    ("es-419", "es-419"), (" de ", "de"), ("fil", "fil"), ("en-US-x-private", "en-US"),
    ("e", None), ("english", None), ("12", None), ("", None), (None, None), (5, None), ("fr-abcdefghi", "fr"),
])
def test_normalize(raw, expected):
    assert L.normalize_locale(raw) == expected


def test_helpers():
    assert L.is_valid_locale("pt-BR") and not L.is_valid_locale("pt-br") and not L.is_valid_locale(3)
    assert L.base_language("pt-BR") == "pt"
    assert L.is_rtl("ar") and L.is_rtl("fa-IR") and not L.is_rtl("fr") and not L.is_rtl(None)
    assert L.language_name("fr-CA") == "French" and L.language_name("xx") == "xx" and L.language_name(None) == ""
    assert len(L.UI_LOCALES) == 22


def test_parse_preferences_lists_and_accept_language():
    assert L.parse_preferences(None) == []
    assert L.parse_preferences("fr,en-US,en,fr") == ["fr", "en-US", "en"]
    assert L.parse_preferences("de;q=0.5, fr-CH;q=0.9, en;q=0, *;q=0.1, xx;q=bad") == ["fr-CH", "de"]
    assert len(L.parse_preferences(",".join(["fr", "de", "es", "it", "pt", "nl", "pl", "ru", "tr", "uk"]))) == L.MAX_PREFERENCES


def test_match_locale_exact_then_base_language():
    assert L.match_locale(["fr-CA"], ["en", "fr"]) == "fr"
    assert L.match_locale(["pt"], ["en", "pt-BR"]) == "pt-BR"
    assert L.match_locale(["pt-PT"], ["pt-BR"]) == "pt-BR"
    assert L.match_locale(["de"], ["en", "fr"]) is None
    assert L.match_locale(["fr"], ["", "fr"]) == "fr"


def test_resolution_order():
    # explicit choice / UI language / browser come in as the ordered list
    assert L.resolve_locale(["fr", "en"], "en", ["fr", "ar"]) == ("fr", False)
    # first preference not published: the next one is used (here the default)
    assert L.resolve_locale(["de", "en"], "en", ["fr"]) == ("en", False)
    # nothing matches: the course default, flagged as a fallback
    assert L.resolve_locale(["de"], "en", ["fr"]) == ("en", True)
    # no preferences: the default, no fallback
    assert L.resolve_locale([], None, ["fr"]) == ("en", False)
    # the default wins when it comes first
    assert L.resolve_locale(["en-GB", "fr"], "en", ["fr"]) == ("en", False)
