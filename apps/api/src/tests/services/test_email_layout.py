"""The shared email layout and the unread-messages digest."""

from unittest.mock import patch

from src.services.users.emails import (
    COLORS,
    _email_layout,
    send_unread_messages_email,
)


class TestLayout:
    def test_layout_is_table_based_for_outlook(self):
        html = _email_layout("Title", "<p>body</p>")
        assert 'class="lh-card"' in html
        assert "<!--[if mso]>" in html
        assert "<div style=" not in html.split("<body", 1)[1].split("<p>body</p>")[0]

    def test_dark_mode_is_progressive_enhancement(self):
        html = _email_layout("Title", "<p>body</p>")
        assert 'name="color-scheme" content="light dark"' in html
        assert "@media (prefers-color-scheme: dark)" in html
        # Light colors stay inline, so clients that drop <style> still render.
        assert f"background-color: {COLORS['page']}" in html

    def test_title_is_plain_text(self):
        html = _email_layout("Hi <strong>Acme &amp; Co</strong>", "<p>b</p>")
        assert "<title>Hi Acme &amp; Co</title>" in html

    def test_rtl_languages_flip_direction(self):
        html = _email_layout("T", "<p>b</p>", lang="ar")
        assert 'dir="rtl"' in html
        assert "text-align: right" in html

    def test_unknown_language_is_normalized(self):
        html = _email_layout("T", "<p>b</p>", lang='xx"><script>')
        assert "<script>" not in html
        assert 'lang="en"' in html


def _render_unread(conversations, **kwargs):
    captured = {}
    with patch(
        "src.services.users.emails.send_email",
        side_effect=lambda **k: captured.update(k) or True,
    ):
        send_unread_messages_email(
            email="ada@test.com",
            username="ada",
            org_name="Acme & Co",
            conversations=conversations,
            cta_url="https://acme.test/messages",
            settings_url="https://acme.test/messages?settings=notifications",
            **kwargs,
        )
    return captured


class TestUnreadMessagesEmail:
    def test_rows_show_avatar_title_snippet_and_count(self):
        captured = _render_unread([
            {"title": "Grace Hopper", "count": 3, "snippet": "See you at the lab"},
        ])
        body = captured["body"]
        assert ">G</td>" in body
        assert "Grace Hopper" in body
        assert "See you at the lab" in body
        assert 'class="lh-pill"' in body and ">3</span>" in body
        assert captured["subject"] == "3 unread messages in Acme & Co"

    def test_dm_rows_have_no_author_placeholder(self):
        body = _render_unread([{"title": "Grace", "count": 1, "snippet": "hi"}])["body"]
        assert "LearnHouse user" not in body
        assert "Powered by LearnHouse" in body

    def test_group_rows_name_the_author(self):
        body = _render_unread([
            {"title": "Study group", "count": 2, "author": "Linus", "snippet": "Review?"},
        ])["body"]
        assert "Linus:</span>" in body

    def test_agent_rows_use_emoji_and_color(self):
        body = _render_unread([
            {"title": "Tutor", "count": 1, "emoji": "🦉", "color": "#7c3aed", "snippet": "Think again"},
        ])["body"]
        assert "🦉" in body
        assert "background-color: #7c3aed" in body

    def test_copilot_row_uses_its_logo(self):
        body = _render_unread([
            {"title": "Copilot", "count": 1, "emoji": "✨", "image": "https://x.test/learnhouse_ai_simple_colored.png", "snippet": "Reminder"},
        ])["body"]
        assert '<img src="https://x.test/learnhouse_ai_simple_colored.png"' in body
        assert "✨" not in body

    def test_long_snippets_are_shortened(self):
        body = _render_unread([{"title": "Grace", "count": 1, "snippet": "word " * 60}])["body"]
        assert "word word…" in body

    def test_values_are_escaped(self):
        body = _render_unread([
            {"title": "<b>x</b>", "count": 1, "author": "<i>y</i>", "snippet": "<script>alert(1)</script>"},
        ])["body"]
        assert "<script>" not in body
        assert "<b>x</b>" not in body
        assert "&lt;script&gt;" in body

    def test_long_lists_are_summarized(self):
        convs = [{"title": f"Person {i}", "count": 1, "snippet": "hey"} for i in range(9)]
        body = _render_unread(convs)["body"]
        assert "Person 5" in body
        assert "Person 6" not in body
        assert "And 3 more conversations." in body

    def test_brand_color_and_settings_link(self):
        body = _render_unread(
            [{"title": "Grace", "count": 1, "snippet": "hi"}], brand_color="#ff5500", powered_by=False
        )["body"]
        assert "background-color: #ff5500;" in body
        assert "https://acme.test/messages?settings=notifications" in body
        assert "LearnHouse" not in body


class TestButtonStyle:
    """The CTA button tinted with the org's brand color."""

    def test_dark_brand_gets_white_text(self):
        from src.services.users.emails import _button_style

        style = _button_style("#1d4ed8")
        assert "background-color: #1d4ed8;" in style
        assert " color: #ffffff;" in style

    def test_light_brand_gets_black_text(self):
        from src.services.users.emails import _button_style

        style = _button_style("#fbbf24")
        assert "background-color: #fbbf24;" in style
        assert " color: #000000;" in style

    def test_white_brand_keeps_a_visible_default_button(self):
        # A white brand used to come out black-on-black: replacing
        # "color: #ffffff;" also hit "background-color: #ffffff;".
        from src.services.users.emails import STYLES, _button_style

        assert _button_style("#ffffff") == STYLES["button"]
        assert _button_style("#fafafa") == STYLES["button"]

    def test_no_or_invalid_brand_keeps_default(self):
        from src.services.users.emails import STYLES, _button_style

        assert _button_style(None) == STYLES["button"]
        assert _button_style("red; display:none") == STYLES["button"]

    def test_background_and_text_never_match(self):
        from src.services.users.emails import _button_style

        for color in ("#000000", "#ffffff", "#808080", "#c9a85c", "#00ff00", "#0f172a"):
            style = _button_style(color)
            bg = style.split("background-color: ")[1].split(";")[0]
            fg = style.split(" color: ")[1].split(";")[0]
            assert bg != fg, color
