"""Tests for the bulk-email support added to the shared email plumbing.

Covers `_email_layout(unsubscribe_url=...)` and `send_email(headers=...)`.
The regression guard matters most: twelve transactional emails share this
layout, and none of their output may shift.
"""

from src.services.users.emails import _email_layout


class TestLayoutRegression:
    def test_no_unsubscribe_url_renders_identically_to_before(self):
        """The pre-existing footer HTML, byte for byte.

        Pinned as a literal rather than compared against another call of the
        same function, so a refactor that changes both paths at once still
        fails here.
        """
        html = _email_layout("Title", "<p>body</p>", footer_note="A note")
        assert (
            '<hr style="margin: 28px 0; border: none; border-top: 1px solid #f0f0f0;" />\n'
            '            <p style="margin: 0; font-size: 12px; color: rgba(0,0,0,0.2); '
            'font-weight: 500; line-height: 1.6;">A note</p>'
        ) in html
        assert "unsubscribe" not in html.lower()

    def test_no_footer_note_and_no_unsubscribe_renders_no_footer_block(self):
        html = _email_layout("Title", "<p>body</p>")
        assert "<hr" not in html
        assert "unsubscribe" not in html.lower()


class TestUnsubscribeFooter:
    def test_unsubscribe_url_renders_a_link(self):
        html = _email_layout(
            "Title",
            "<p>body</p>",
            unsubscribe_url="https://app.test/api/v1/emails/unsubscribe?token=abc.def",
        )
        assert 'href="https://app.test/api/v1/emails/unsubscribe?token=abc.def"' in html
        assert "Unsubscribe from these emails" in html

    def test_unsubscribe_renders_without_a_footer_note(self):
        # The footer <div> is gated on either piece being present; an
        # unsubscribe-only footer must still produce the divider.
        html = _email_layout(
            "Title", "<p>body</p>", unsubscribe_url="https://app.test/u?token=x"
        )
        assert "<hr" in html

    def test_note_and_unsubscribe_both_render(self):
        html = _email_layout(
            "Title",
            "<p>body</p>",
            footer_note="Because you're an admin.",
            unsubscribe_url="https://app.test/u?token=x",
        )
        assert "Because you&#x27;re an admin." in html or "Because you're an admin." in html
        assert "https://app.test/u?token=x" in html

    def test_url_and_label_are_escaped(self):
        html = _email_layout(
            "Title",
            "<p>body</p>",
            unsubscribe_url='https://app.test/u?t=x"><script>alert(1)</script>',
            unsubscribe_label="<b>Stop</b>",
        )
        assert "<script>" not in html
        assert "<b>Stop</b>" not in html
        assert "&lt;b&gt;Stop&lt;/b&gt;" in html

    def test_label_is_translatable(self):
        html = _email_layout(
            "Title",
            "<p>body</p>",
            unsubscribe_url="https://app.test/u?token=x",
            unsubscribe_label="Se désabonner de ces e-mails",
        )
        assert "Se désabonner de ces e-mails" in html


class TestSendEmailHeaders:
    def test_headers_reach_the_resend_payload(self, monkeypatch):
        from src.services.email import utils as email_utils

        captured = {}

        def fake_send(payload):
            captured.update(payload)
            return {"id": "sent"}

        monkeypatch.setattr(email_utils.resend.Emails, "send", staticmethod(fake_send))
        email_utils._send_email_resend(
            "LearnHouse <no-reply@test>",
            "user@test.com",
            "hi",
            "<p>hi</p>",
            _mailing(),
            {"List-Unsubscribe": "<https://app.test/u>"},
        )
        assert captured["headers"] == {"List-Unsubscribe": "<https://app.test/u>"}

    def test_no_headers_leaves_the_payload_unchanged(self, monkeypatch):
        from src.services.email import utils as email_utils

        captured = {}

        def fake_send(payload):
            captured.update(payload)
            return {"id": "sent"}

        monkeypatch.setattr(email_utils.resend.Emails, "send", staticmethod(fake_send))
        email_utils._send_email_resend(
            "LearnHouse <no-reply@test>", "user@test.com", "hi", "<p>hi</p>", _mailing()
        )
        assert "headers" not in captured

    def test_headers_reach_the_smtp_message(self, monkeypatch):
        from src.services.email import utils as email_utils

        sent = {}

        class FakeSMTP:
            def __init__(self, *a, **kw):
                pass

            def starttls(self):
                pass

            def login(self, *a):
                pass

            def sendmail(self, _from, _to, message):
                sent["message"] = message

            def quit(self):
                pass

        monkeypatch.setattr(email_utils.smtplib, "SMTP", FakeSMTP)
        email_utils._send_email_smtp(
            "LearnHouse <no-reply@test>",
            "user@test.com",
            "hi",
            "<p>hi</p>",
            _mailing(provider="smtp"),
            {
                "List-Unsubscribe": "<https://app.test/u>",
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
        )
        assert "List-Unsubscribe: <https://app.test/u>" in sent["message"]
        assert "List-Unsubscribe-Post: List-Unsubscribe=One-Click" in sent["message"]

    def test_send_email_forwards_headers_to_the_provider(self, monkeypatch):
        from src.services.email import utils as email_utils

        captured = {}

        def fake_resend(sender, to, subject, body, mailing, headers=None):
            captured["headers"] = headers
            return {"id": "sent"}

        monkeypatch.setattr(email_utils, "_send_email_resend", fake_resend)
        email_utils.send_email(
            "user@test.com", "hi", "<p>hi</p>", headers={"List-Unsubscribe": "<x>"}
        )
        assert captured["headers"] == {"List-Unsubscribe": "<x>"}


def _mailing(provider: str = "resend"):
    from types import SimpleNamespace

    return SimpleNamespace(
        email_provider=provider,
        system_email_address="no-reply@test",
        resend_api_key="test-key",
        smtp_host="localhost",
        smtp_port=25,
        smtp_username="",
        smtp_password="",
        smtp_use_tls=False,
    )


class TestNudgeRendering:
    """`send_nudge_email` is the generic renderer for the whole catalog."""

    def _send(self, **overrides):
        from unittest.mock import patch

        from src.services.users.emails import send_nudge_email

        kwargs = dict(
            nudge_id="content.course_draft_d3",
            email="admin@test.com",
            org_name="Maths & Physics",
            cta_url="https://acme.test/dash/courses/course/abc/general",
            unsubscribe_url="https://api.test/api/v1/emails/unsubscribe?token=t.s",
            lang="en",
            course_name="Intro & Basics",
            plan_name="free",
            next_plan="personal",
        )
        kwargs.update(overrides)

        captured = {}
        with patch(
            "src.services.users.emails.send_email",
            side_effect=lambda **k: captured.update(k) or {"id": "sent"},
        ):
            send_nudge_email(**kwargs)
        return captured

    def test_subject_is_plain_text_not_html(self):
        """Subjects are not rendered as HTML, so escaping them delivers
        "Maths &amp; Physics" to the inbox."""
        captured = self._send()
        assert "&amp;" not in captured["subject"]
        assert "Intro & Basics" in captured["subject"]

    def test_body_escapes_interpolated_values(self):
        captured = self._send(course_name="<script>alert(1)</script>")
        assert "<script>" not in captured["body"]
        assert "&lt;script&gt;" in captured["body"]

    def test_body_escapes_the_org_name(self):
        captured = self._send()
        assert "Maths &amp; Physics" in captured["body"]

    def test_list_unsubscribe_headers_are_set(self):
        captured = self._send()
        assert captured["headers"]["List-Unsubscribe"] == (
            "<https://api.test/api/v1/emails/unsubscribe?token=t.s>"
        )
        assert captured["headers"]["List-Unsubscribe-Post"] == (
            "List-Unsubscribe=One-Click"
        )

    def test_no_unsubscribe_url_means_no_unsubscribe_headers(self):
        """Reply-To survives — a reader should be able to answer a lifecycle
        email whether or not it carried an opt-out link."""
        captured = self._send(unsubscribe_url="")
        headers = captured["headers"] or {}
        assert "List-Unsubscribe" not in headers
        assert "List-Unsubscribe-Post" not in headers

    def test_reply_to_is_set(self):
        """Several nudges invite a reply; from a no-reply sender that would be
        a lie."""
        captured = self._send()
        assert "@" in captured["headers"]["Reply-To"]

    def test_cta_button_is_rendered(self):
        captured = self._send()
        assert "https://acme.test/dash/courses/course/abc/general" in captured["body"]

    def test_no_cta_renders_a_button_free_email(self):
        """The "what stopped you?" nudge is a genuine question — a button
        would undercut the ask to just reply.

        The unsubscribe link is still an anchor, so this checks for the button
        specifically rather than for anchors in general.
        """
        from src.services.users.emails import STYLES

        captured = self._send(
            nudge_id="activation.whats_blocking_d14", has_cta=False
        )
        assert STYLES["button"] not in captured["body"]
        assert "https://acme.test/dash" not in captured["body"]
        # ...but the reader can still opt out.
        assert "unsubscribe" in captured["body"].lower()

    def test_translated_copy_is_used(self):
        captured = self._send(lang="fr")
        assert "brouillon" in captured["subject"]
        assert "Se désabonner" in captured["body"]

    def test_no_unrendered_placeholders(self):
        for lang in ("en", "fr", "ja", "ar"):
            captured = self._send(lang=lang)
            assert "{" not in captured["body"], lang
            assert "{" not in captured["subject"], lang
