"""Tests for src/services/email/translations.py."""

from src.services.email.translations import (
    DEFAULT_LANGUAGE,
    EMAIL_TRANSLATIONS,
    SUPPORTED_LANGUAGES,
    SUPPORTED_UI_LANGUAGES,
    normalize_language,
    t,
)


class TestNormalizeLanguage:
    def test_known_code_passes_through(self):
        assert normalize_language("fr") == "fr"

    def test_hyphenated_locale_strips_region(self):
        assert normalize_language("en-US") == "en"
        assert normalize_language("pt-BR") == "pt"

    def test_uppercase_is_normalized(self):
        assert normalize_language("FR") == "fr"

    def test_unknown_code_falls_back_to_english(self):
        assert normalize_language("klingon") == DEFAULT_LANGUAGE

    def test_none_falls_back_to_english(self):
        assert normalize_language(None) == DEFAULT_LANGUAGE

    def test_empty_string_falls_back_to_english(self):
        assert normalize_language("") == DEFAULT_LANGUAGE


class TestT:
    def test_translates_to_target_language(self):
        # Sanity check: at least one well-known phrase resolves correctly.
        assert t("fr", "invitation.heading") == "Vous êtes invité !"

    def test_falls_back_to_english_for_unknown_lang(self):
        assert t("klingon", "invitation.heading") == EMAIL_TRANSLATIONS["en"]["invitation.heading"]

    def test_falls_back_to_english_when_key_missing_in_locale(self):
        # Insert a locale that's missing a specific key, then look it up;
        # we expect the English bundle's value back.
        assert t("fr", "academy_link_text") == EMAIL_TRANSLATIONS["fr"]["academy_link_text"]

    def test_returns_key_itself_when_key_unknown_everywhere(self):
        # No locale has this key — t() must not raise.
        assert t("fr", "totally.made.up.key") == "totally.made.up.key"

    def test_format_kwargs_are_interpolated(self):
        rendered = t("fr", "invitation.subject", org_name="Acme")
        assert "Acme" in rendered

    def test_missing_format_kwargs_return_template_safely(self):
        # invitation.subject expects {org_name}; without it Python's
        # str.format would raise KeyError. The helper must swallow that and
        # return the raw template instead of crashing the email send.
        rendered = t("fr", "invitation.subject")
        assert "{org_name}" in rendered

    def test_supported_languages_list_matches_translation_bundles(self):
        # Anyone editing translations.py has to keep these in sync; if not,
        # callers that validate via SUPPORTED_LANGUAGES would silently get
        # the English fallback for a "supported" locale.
        for code in SUPPORTED_LANGUAGES:
            assert code in EMAIL_TRANSLATIONS, f"missing translation bundle: {code}"


class TestSupportedUILanguages:
    def test_email_languages_are_a_subset_of_ui_languages(self):
        # Every locale with email bundles must also be a valid UI language.
        assert set(SUPPORTED_LANGUAGES).issubset(set(SUPPORTED_UI_LANGUAGES))

    def test_ui_languages_include_slovak(self):
        # Regression: sk must be selectable as an org UI language.
        assert "sk" in SUPPORTED_UI_LANGUAGES

    def test_ui_only_languages_fall_back_to_english_email(self):
        # A UI language without an email bundle must not break email sending.
        for code in SUPPORTED_UI_LANGUAGES:
            if code not in EMAIL_TRANSLATIONS:
                assert t(code, "invitation.heading") == EMAIL_TRANSLATIONS["en"]["invitation.heading"]
