"""The unread-messages digest and the org button colours of the shared layout."""

from unittest.mock import patch

from src.services.users.emails import send_unread_messages_email


def _render_unread(conversations, **kwargs):
    captured = {}
    with patch(
        "src.services.email.pipeline.deliver_message",
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
    def test_rows_show_title_snippet_and_count(self):
        captured = _render_unread([
            {"title": "Grace Hopper", "count": 3, "snippet": "See you at the lab"},
        ])
        body = captured["body"]
        assert "Grace Hopper" in body
        assert "See you at the lab" in body
        assert ">3 new</td>" in body
        assert captured["subject"] == "3 unread messages in Acme & Co"

    def test_dm_rows_have_no_author_placeholder(self):
        body = _render_unread([{"title": "Grace", "count": 1, "snippet": "hi"}])["body"]
        assert "LearnHouse user" not in body
        assert "Powered by LearnHouse" not in body

    def test_group_rows_name_the_author(self):
        body = _render_unread([
            {"title": "Study group", "count": 2, "author": "Linus", "snippet": "Review?"},
        ])["body"]
        assert "Linus: Review?" in body

    def test_rows_are_plain_text_without_avatars(self):
        body = _render_unread([
            {"title": "Tutor", "count": 1, "emoji": "🦉", "color": "#7c3aed",
             "image": "https://x.test/a.png", "snippet": "Think again"},
        ])["body"]
        assert "Tutor" in body and "Think again" in body
        assert "🦉" not in body and "#7c3aed" not in body and "https://x.test/a.png" not in body

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
        assert "background-color: #ff5500; color: #000000" in body
        assert "https://acme.test/messages?settings=notifications" in body
        assert "LearnHouse" not in body


class TestButtonColors:
    """The CTA button tinted with the org's brand colour."""

    @staticmethod
    def _colors(color):
        from src.services.email.layout import Brand, _button_colors

        return _button_colors(Brand(name="Acme", org_scoped=True, color=color))

    def test_dark_brand_gets_white_text(self):
        assert self._colors("#1d4ed8") == ("#1d4ed8", "#ffffff")

    def test_light_brand_gets_black_text(self):
        assert self._colors("#fbbf24") == ("#fbbf24", "#000000")

    def test_white_brand_keeps_a_visible_default_button(self):
        assert self._colors("#ffffff") == ("#171717", "#ffffff")
        assert self._colors("#fafafa") == ("#171717", "#ffffff")

    def test_no_or_invalid_brand_keeps_default(self):
        assert self._colors(None) == ("#171717", "#ffffff")
        assert self._colors("red; display:none") == ("#171717", "#ffffff")

    def test_platform_mail_ignores_a_stray_colour(self):
        from src.services.email.layout import Brand, _button_colors

        assert _button_colors(Brand(color="#ff5500")) == ("#171717", "#ffffff")

    def test_background_and_text_never_match(self):
        for color in ("#000000", "#ffffff", "#808080", "#c9a85c", "#00ff00", "#0f172a"):
            bg, fg = self._colors(color)
            assert bg != fg, color
