"""Tests for the nudge copy bundles.

Two classes of bug are worth catching mechanically here: a locale that drifts
out of sync with the English source, and a translator writing a plan name or a
limit into a string where a placeholder belongs.
"""

import re
import string

import pytest

from src.security.features_utils.plans import PLAN_HIERARCHY
from src.services.email.nudge_translations import NUDGE_TRANSLATIONS
from src.services.email.translations import EMAIL_TRANSLATIONS, SUPPORTED_LANGUAGES, t
from src.services.nudges.catalog import NUDGE_CATALOG

ENGLISH = NUDGE_TRANSLATIONS["en"]


def _placeholders(template: str) -> set[str]:
    return {
        field
        for _text, field, _spec, _conv in string.Formatter().parse(template)
        if field
    }


class TestCoverage:
    def test_every_supported_locale_has_a_bundle(self):
        assert set(NUDGE_TRANSLATIONS) == set(SUPPORTED_LANGUAGES)

    def test_every_nudge_has_the_keys_it_needs(self):
        for spec in NUDGE_CATALOG:
            for part in ("subject", "heading", "body"):
                assert f"nudge.{spec.id}.{part}" in ENGLISH, spec.id
            if spec.has_cta:
                assert f"nudge.{spec.id}.cta" in ENGLISH, spec.id

    def test_no_orphaned_copy(self):
        """Copy for a nudge that no longer exists is dead weight and a
        misleading signal that the nudge still ships."""
        known = {spec.id for spec in NUDGE_CATALOG}
        for key in ENGLISH:
            # `common` and `stat` are shared across the catalog rather than
            # belonging to any one nudge.
            if key.startswith(("nudge.common.", "nudge.stat.")):
                continue
            nudge_id = ".".join(key.split(".")[1:3])
            assert nudge_id in known, f"orphaned copy: {key}"

    @pytest.mark.parametrize("locale", sorted(NUDGE_TRANSLATIONS))
    def test_locale_matches_the_english_key_set(self, locale):
        assert set(NUDGE_TRANSLATIONS[locale]) == set(ENGLISH)

    def test_bundles_are_merged_into_the_shared_translations(self):
        for locale, strings in NUDGE_TRANSLATIONS.items():
            for key in strings:
                assert key in EMAIL_TRANSLATIONS[locale]


class TestPlaceholders:
    @pytest.mark.parametrize("locale", sorted(NUDGE_TRANSLATIONS))
    def test_placeholders_match_english(self, locale):
        """A dropped placeholder silently loses the reader's course name; an
        invented one raises at render time."""
        for key, english in ENGLISH.items():
            translated = NUDGE_TRANSLATIONS[locale][key]
            assert _placeholders(translated) == _placeholders(english), (
                f"{locale}:{key}"
            )

    def test_only_known_placeholders_are_used(self):
        allowed = {"org_name", "course_name", "plan_name", "next_plan"}
        for key, template in ENGLISH.items():
            assert _placeholders(template) <= allowed, key

    @pytest.mark.parametrize("locale", sorted(NUDGE_TRANSLATIONS))
    def test_every_string_renders(self, locale):
        values = dict(
            org_name="Acme",
            course_name="Intro to Welding",
            plan_name="free",
            next_plan="personal",
        )
        for key in ENGLISH:
            rendered = t(locale, key, **values)
            assert "{" not in rendered, f"{locale}:{key}"
            assert rendered != key


class TestPlanDataIsNeverHardcoded:
    """Plan names and limits move. The emails are the last place anyone
    remembers to update, so they must not contain either."""

    def test_english_source_has_no_literal_plan_names(self):
        """Checked on English only, deliberately.

        English is the source every locale translates from, so a hardcoded
        tier name can only enter here. Running the same check across all
        twenty locales produces false positives instead of findings — "pro"
        is the ordinary German word for "per" ("eines pro Thema"), and
        "standard" is a normal word in most of these languages.

        Translations are protected by a stronger invariant anyway: placeholder
        parity (above) means a locale cannot drop `{plan_name}` or
        `{next_plan}` without failing.
        """
        tiers = [p for p in PLAN_HIERARCHY if p != "free"]
        for key, value in ENGLISH.items():
            lowered = value.lower()
            for tier in tiers:
                assert not re.search(rf"\b{re.escape(tier)}\b", lowered), (
                    f"{key} hardcodes the plan name {tier!r}"
                )

    def test_plan_aware_prose_uses_placeholders(self):
        """Prose that talks about a plan must name it dynamically.

        Scoped to subject/heading/body: a button reading "See plans" mentions
        plans without naming one, which is exactly right for a CTA.
        """
        for key, value in ENGLISH.items():
            if key.endswith(".cta"):
                continue
            if "plan" in value.lower():
                assert _placeholders(value) & {"plan_name", "next_plan"}, key

    def test_no_bare_limit_digits(self):
        """A number like "10 members" goes wrong the moment the config
        changes, and is wrong for five of the six plans on the day it ships."""
        for key, value in ENGLISH.items():
            assert not re.search(r"\d+\s*(members?|courses?|credits?)", value), key


class TestTone:
    def test_no_emoji_in_copy(self):
        """These go to teachers and trainers; an emoji subject line reads as
        marketing and lands in the promotions tab."""
        emoji = re.compile("[\U0001f300-\U0001faff☀-➿]")
        for locale, strings in NUDGE_TRANSLATIONS.items():
            for key, value in strings.items():
                assert not emoji.search(value), f"{locale}:{key}"

    def test_subjects_are_not_shouted(self):
        for locale, strings in NUDGE_TRANSLATIONS.items():
            for key, value in strings.items():
                if key.endswith(".subject"):
                    assert "!" not in value, f"{locale}:{key}"

    def test_final_emails_say_so(self):
        """Announcing the last message in a sequence earns more goodwill than
        any subject-line trick — and it is a promise the catalog keeps."""
        assert "last" in ENGLISH["nudge.activation.last_call_d30.heading"].lower()
        assert "last" in ENGLISH["nudge.dormancy.no_login_60d.subject"].lower()
