"""Tests for src/services/nudges/illustrations.py.

The whole point of drawing these as table cells is that they survive clients
which strip or block real images, so the tests guard the properties that keep
that true.
"""

import re

import pytest

from src.services.nudges.catalog import NUDGE_CATALOG
from src.services.nudges.illustrations import (
    CELL_PX,
    MOTIFS,
    TRACK_COLORS,
    _tint,
    render_illustration,
)


class TestMotifs:
    def test_every_track_in_the_catalog_has_one(self):
        for spec in NUDGE_CATALOG:
            assert spec.track in MOTIFS, spec.track

    @pytest.mark.parametrize("track", sorted(MOTIFS))
    def test_motifs_are_eight_by_eight(self, track):
        motif = MOTIFS[track]
        assert len(motif) == 8, track
        for row in motif:
            assert len(row) == 8, track

    @pytest.mark.parametrize("track", sorted(MOTIFS))
    def test_motifs_use_only_known_tones(self, track):
        for row in MOTIFS[track]:
            assert set(row) <= {"0", "1", "2"}, track

    @pytest.mark.parametrize("track", sorted(MOTIFS))
    def test_motifs_are_not_blank(self, track):
        assert any("1" in row for row in MOTIFS[track]), track

    def test_every_track_has_a_colour(self):
        assert set(TRACK_COLORS) == set(MOTIFS)

    def test_tracks_are_visually_distinct(self):
        """Six motifs that render the same defeat the purpose."""
        rendered = {track: MOTIFS[track] for track in MOTIFS}
        assert len(set(map(tuple, rendered.values()))) == len(rendered)

    def test_colours_are_distinct(self):
        assert len(set(TRACK_COLORS.values())) == len(TRACK_COLORS)


class TestTint:
    def test_tint_moves_toward_white(self):
        assert _tint("#000000", 0.5) == "#808080"
        assert _tint("#000000", 1.0) == "#ffffff"

    def test_tint_of_white_stays_white(self):
        assert _tint("#ffffff") == "#ffffff"

    def test_tint_accepts_a_bare_hex(self):
        assert _tint("b45309") == _tint("#b45309")


class TestRendering:
    @pytest.mark.parametrize("track", sorted(MOTIFS))
    def test_renders_a_full_grid(self, track):
        html = render_illustration(track)
        assert html.count("<tr>") == 8
        assert html.count("<td") == 64

    def test_unknown_track_renders_nothing(self):
        """A new track should ship without an illustration, not without an
        email."""
        assert render_illustration("does_not_exist") == ""
        assert render_illustration("") == ""

    @pytest.mark.parametrize("track", sorted(MOTIFS))
    def test_uses_no_images_at_all(self, track):
        """Gmail strips inline SVG; Gmail and Outlook block data: URIs. Any of
        those would render as a blank gap for a large share of readers."""
        html = render_illustration(track)
        assert "<img" not in html
        assert "<svg" not in html
        assert "data:" not in html
        assert "background-image" not in html

    @pytest.mark.parametrize("track", sorted(MOTIFS))
    def test_carries_the_bgcolor_attribute_not_just_css(self, track):
        """Outlook ignores background-color on a td often enough that the
        attribute is the one actually doing the work."""
        html = render_illustration(track)
        assert 'bgcolor="' in html
        for match in re.findall(r'bgcolor="([^"]+)"', html):
            assert re.fullmatch(r"#[0-9a-f]{6}", match), match

    @pytest.mark.parametrize("track", sorted(MOTIFS))
    def test_is_hidden_from_screen_readers(self, track):
        """Decorative: the copy already says everything it says."""
        html = render_illustration(track)
        assert 'role="presentation"' in html
        assert 'aria-hidden="true"' in html

    @pytest.mark.parametrize("track", sorted(MOTIFS))
    def test_cells_are_sized_in_both_attribute_and_style(self, track):
        html = render_illustration(track)
        assert f'width="{CELL_PX}"' in html
        assert f"width:{CELL_PX}px" in html
        # Zeroed font metrics stop clients adding phantom line-height between
        # rows, which is what turns a mosaic into a striped mess.
        assert "font-size:0" in html
        assert "line-height:0" in html

    def test_empty_cells_carry_no_colour(self):
        html = render_illustration("activation")
        assert "&nbsp;" in html
        # The corner of the activation plus is transparent.
        assert html.count("<td") > html.count("bgcolor=")


class TestInEmail:
    def _render(self, track):
        from unittest.mock import patch

        from src.services.users.emails import send_nudge_email

        captured = {}
        with patch(
            "src.services.users.emails.send_email",
            side_effect=lambda **k: captured.update(k),
        ):
            send_nudge_email(
                nudge_id="content.course_draft_d3",
                email="a@b.com",
                org_name="Acme",
                cta_url="https://acme.test/dash",
                unsubscribe_url="https://api.test/u?token=t.s",
                track=track,
                course_name="Course",
                plan_name="free",
                next_plan="personal",
            )
        return captured["body"]

    def test_illustration_reaches_the_email(self):
        body = self._render("content")
        assert TRACK_COLORS["content"] in body
        assert 'role="presentation"' in body

    def test_illustration_sits_above_the_heading(self):
        body = self._render("content")
        assert body.index('role="presentation"') < body.index("<h1")

    def test_no_track_still_produces_a_valid_email(self):
        """Illustrations are decoration — their absence must not break the
        message."""
        body = self._render("")
        assert "<h1" in body
        assert 'role="presentation"' not in body
