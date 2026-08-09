"""Tests for the engagement additions: preheader, stat strip, slots, tracking.

Each of these changes what lands in an inbox, so the tests are about the
rendered output rather than the internals.
"""

from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from src.services.email.nudge_translations import NUDGE_TRANSLATIONS
from src.services.nudges.catalog import get_spec
from src.services.nudges.runner import TRACK_STATS, _stats_for
from src.services.nudges.snapshot import OrgSnapshot
from src.services.users.emails import _email_layout, _first_sentence, _stat_strip

NOW = datetime(2026, 7, 28, 12, 0, 0, tzinfo=timezone.utc)


def snap(**kw):
    base = dict(org_id=1, org_slug="acme", org_name="Acme", plan="free", lang="en", now=NOW)
    base.update(kw)
    return OrgSnapshot(**base)


class TestFirstSentence:
    def test_takes_the_opening_sentence(self):
        assert _first_sentence("One thing. Then another.") == "One thing."

    @pytest.mark.parametrize(
        "text,expected",
        [
            ("これは一つ。次は二つ。", "これは一つ。"),
            ("पहला वाक्य। दूसरा।", "पहला वाक्य।"),
            ("Really? Yes.", "Really?"),
            ("Stop! Go.", "Stop!"),
        ],
    )
    def test_handles_other_scripts_terminators(self, text, expected):
        assert _first_sentence(text) == expected

    def test_short_text_without_punctuation_passes_through(self):
        assert _first_sentence("No terminator here") == "No terminator here"

    def test_long_text_is_truncated_on_a_word_boundary(self):
        out = _first_sentence("word " * 60)
        assert len(out) <= 111
        assert out.endswith("…")

    def test_empty_is_empty(self):
        assert _first_sentence("") == ""

    def test_a_late_full_stop_does_not_produce_a_giant_preheader(self):
        """Inbox previews cut around 100 characters; a 300-character first
        sentence would just be truncated by the client anyway."""
        out = _first_sentence("x" * 300 + ". Short one.")
        assert len(out) <= 111


class TestPreheader:
    def test_absent_preheader_leaves_the_document_unchanged(self):
        """The twelve transactional emails share this layout."""
        before = _email_layout("T", "<p>b</p>", footer_note="note")
        assert "<body style=" in before
        assert "mso-hide" not in before
        assert '<body style="margin: 0; padding: 0; background-color: #f5f5f5;' in before

    def test_preheader_is_hidden_from_the_rendered_body(self):
        html = _email_layout("T", "<p>b</p>", preheader="Second line of info")
        assert "Second line of info" in html
        assert "display:none" in html
        assert "mso-hide:all" in html

    def test_preheader_is_padded(self):
        """Without padding the client keeps reading into the body copy."""
        html = _email_layout("T", "<p>b</p>", preheader="Hi")
        assert html.count("&#847;") > 20

    def test_preheader_is_escaped(self):
        html = _email_layout("T", "<p>b</p>", preheader='<script>alert(1)</script>')
        assert "<script>" not in html

    def test_preheader_appears_before_the_content(self):
        html = _email_layout("T", "<p>body-marker</p>", preheader="pre-marker")
        assert html.index("pre-marker") < html.index("body-marker")


class TestStatStrip:
    def test_no_stats_renders_nothing(self):
        assert _stat_strip([]) == ""

    def test_renders_label_and_value(self):
        html = _stat_strip([("Lessons", 8), ("Learners", 0)])
        assert ">8<" in html and ">0<" in html
        assert "Lessons" in html and "Learners" in html

    def test_uses_no_prose_so_no_plural_agreement_is_needed(self):
        """Writing "8 lessons" into copy means solving plural rules in twenty
        languages; Russian has three forms and Arabic six."""
        html = _stat_strip([("Lessons", 1)])
        assert "1 Lessons" not in html
        assert "1 lesson" not in html

    def test_labels_are_escaped(self):
        html = _stat_strip([("<b>x</b>", 1)])
        assert "<b>x</b>" not in html

    def test_is_a_table_so_outlook_lays_it_out(self):
        html = _stat_strip([("Lessons", 3)])
        assert "<table" in html and 'role="presentation"' in html


class TestStatsSelection:
    def test_content_track_shows_structure(self):
        s = snap(chapter_count=3, activity_count=9)
        assert _stats_for(get_spec("content.course_draft_d3"), s) == [
            ("chapters", 3),
            ("lessons", 9),
        ]

    def test_audience_track_shows_people(self):
        s = snap(member_count=12, learner_count=4)
        assert _stats_for(get_spec("audience.published_no_members_d7"), s) == [
            ("members", 12),
            ("learners", 4),
        ]

    def test_all_zero_stats_are_suppressed(self):
        """A row of noughts reads as an accusation, not a prompt."""
        s = snap(chapter_count=0, activity_count=0)
        assert _stats_for(get_spec("content.course_draft_d3"), s) == []

    def test_activation_never_shows_stats(self):
        """An org with nothing in it has nothing worth counting."""
        assert "activation" not in TRACK_STATS
        s = snap(course_count=0)
        assert _stats_for(get_spec("activation.first_course_d1"), s) == []

    def test_monetization_never_shows_stats(self):
        assert "monetization" not in TRACK_STATS

    def test_every_stat_key_has_a_label_in_every_locale(self):
        keys = {key for keys in TRACK_STATS.values() for key in keys}
        for locale, strings in NUDGE_TRANSLATIONS.items():
            for key in keys:
                assert f"nudge.stat.{key}" in strings, f"{locale}:{key}"


class TestAnalyticsEvent:
    async def test_a_delivered_nudge_is_recorded(self):
        from src.services.nudges.runner import _record_sent
        from src.services.nudges.snapshot import AdminRow

        admin = AdminRow(
            user_id=7,
            user_uuid="user_x",
            email="a@b.com",
            first_name="A",
            username="a",
            email_verified=True,
            last_login_at=None,
        )
        with patch("src.services.analytics.analytics.track") as tracked:
            await _record_sent(get_spec("content.course_draft_d3"), snap(), admin)

        kwargs = tracked.call_args.kwargs
        assert kwargs["event_name"] == "nudge_sent"
        assert kwargs["org_id"] == 1
        assert kwargs["user_id"] == 7
        assert kwargs["properties"]["nudge_id"] == "content.course_draft_d3"
        assert kwargs["properties"]["track"] == "content"

    async def test_analytics_failure_never_breaks_the_send_loop(self):
        from src.services.nudges.runner import _record_sent
        from src.services.nudges.snapshot import AdminRow

        admin = AdminRow(7, "user_x", "a@b.com", "A", "a", True, None)
        with patch(
            "src.services.analytics.analytics.track",
            side_effect=RuntimeError("tinybird down"),
        ):
            await _record_sent(get_spec("content.course_draft_d3"), snap(), admin)
