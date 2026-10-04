"""Tests for src/services/users/emails.py."""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from src.db.organizations import OrganizationRead
from src.db.users import UserRead
from src.services.users.emails import (
    send_account_creation_email,
    send_account_deleted_email,
    send_email_verification_email,
    send_invitation_email,
    send_org_created_email,
    send_org_deleted_email,
    send_org_join_email,
    send_password_reset_email,
    send_password_reset_email_platform,
    send_role_changed_email,
)


def _user(**overrides):
    data = dict(
        id=1,
        username="user<script>",
        first_name="User",
        last_name="Test",
        email="user@test.com",
        user_uuid="user_uuid",
        email_verified=True,
        avatar_image="",
        bio="",
    )
    data.update(overrides)
    return UserRead(**data)


def _wordmark(escaped_name: str) -> str:
    """The org-name header an org-branded mail shows when it has no logo."""
    return f'line-height: 1.2;">{escaped_name}</span>'


def _org(**overrides):
    data = dict(
        id=1,
        name="Org & Co",
        slug="org",
        email="org@test.com",
        org_uuid="org_uuid",
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    data.update(overrides)
    return OrganizationRead(**data)


class TestEmailsService:
    def test_lifecycle_confirmation_emails(self):
        with patch("src.services.users.emails.send_email", return_value=True) as send_email:
            assert send_org_created_email("a@test.com", "Org & Co", "https://learnhouse.io/home") is True
            created = send_email.call_args
            assert "Org &amp; Co" in created.kwargs["body"]  # name html-escaped
            assert "https://learnhouse.io/home" in created.kwargs["body"]  # CTA link
            assert "Org &amp; Co" in created.kwargs["subject"]

            assert send_org_deleted_email("a@test.com", "Org & Co") is True
            assert "deleted" in send_email.call_args.kwargs["subject"].lower()

            assert send_account_deleted_email("a@test.com", "user<script>") is True
            assert "deleted" in send_email.call_args.kwargs["subject"].lower()

    def test_send_account_creation_email_escapes_username(self):
        with patch("src.services.users.emails.send_email", return_value=True) as send_email:
            result = send_account_creation_email(_user(), "user@test.com")

        assert result is True
        body = send_email.call_args.kwargs["body"]
        assert "user&lt;script&gt;" in body
        assert "Get Started" in body

    def test_orgless_welcome_uses_cta_url_and_learnhouse_branding(self):
        with patch("src.services.users.emails.send_email", return_value=True) as send_email:
            send_account_creation_email(
                _user(), "user@test.com", cta_url="https://platform.test/organizations"
            )
        call = send_email.call_args.kwargs
        assert "https://platform.test/organizations" in call["body"]
        # Org-less keeps the LearnHouse-branded subject + Academy footer, no org logo.
        assert "Welcome to LearnHouse" in call["subject"]
        assert "LearnHouse Academy" in call["body"]
        assert "<img" not in call["body"]

    def test_welcome_is_whitelabeled_when_org_supplied(self):
        with patch("src.services.users.emails.send_email", return_value=True) as send_email:
            send_account_creation_email(
                _user(),
                "user@test.com",
                cta_url="https://acme.test/home",
                org_name="Acme & Co",
                logo_url="https://api.test/content/orgs/org_uuid/logos/logo.png",
            )
        call = send_email.call_args.kwargs
        # Subject/body name the org (html-escaped), not LearnHouse.
        assert "Acme &amp; Co" in call["subject"]
        assert "Welcome to LearnHouse" not in call["subject"]
        assert "Acme &amp; Co" in call["body"]
        # Org logo replaces the mark; Academy link is gone; powered-by remains.
        assert '<img src="https://api.test/content/orgs/org_uuid/logos/logo.png"' in call["body"]
        assert "LearnHouse Academy" not in call["body"]
        assert "Powered by LearnHouse" in call["body"]
        assert "https://acme.test/home" in call["body"]

    def test_whitelabel_without_logo_uses_the_org_name_as_wordmark(self):
        with patch("src.services.users.emails.send_email", return_value=True) as send_email:
            send_account_creation_email(
                _user(), "user@test.com", org_name="Acme & Co", logo_url=None
            )
        call = send_email.call_args.kwargs
        # No org logo → the org's own name up top, never the LearnHouse mark.
        assert "<img" not in call["body"]
        assert "<svg" not in call["body"]
        assert _wordmark("Acme &amp; Co") in call["body"]
        assert "Acme &amp; Co" in call["subject"]
        assert "Powered by LearnHouse" in call["body"]

    def test_role_changed_email_links_back_to_the_org(self):
        """Telling someone their permissions changed is useless without a way
        to go use them."""
        with patch("src.services.users.emails.send_email", return_value=True) as send_email:
            send_role_changed_email(
                email="user@test.com",
                username="learner",
                org_name="Acme & Co",
                new_role_name="Admin",
                cta_url="https://learn.acme.test",
            )
        body = send_email.call_args.kwargs["body"]
        assert 'href="https://learn.acme.test"' in body
        assert "Acme &amp; Co" in body

    def test_role_changed_email_without_a_link_renders_no_button(self):
        with patch("src.services.users.emails.send_email", return_value=True) as send_email:
            send_role_changed_email(
                email="user@test.com",
                username="learner",
                org_name="Acme",
                new_role_name="Admin",
            )
        body = send_email.call_args.kwargs["body"]
        assert "Go to Acme" not in body
        assert 'href="/"' not in body
        # The only link left is the footer attribution, never a CTA.
        assert body.count("<a href") == 1
        assert "Powered by LearnHouse" in body

    def test_org_join_email_is_whitelabeled_and_links_to_the_org(self):
        with patch("src.services.users.emails.send_email", return_value=True) as send_email:
            assert send_org_join_email(
                email="user@test.com",
                username="user<script>",
                org_name="Acme & Co",
                cta_url="https://acme.test/home",
                logo_url="https://api.test/content/orgs/org_uuid/logos/logo.png",
            ) is True
        call = send_email.call_args.kwargs
        # Named after the org, with the org's own logo, not the LearnHouse mark.
        assert "Acme &amp; Co" in call["subject"]
        assert '<img src="https://api.test/content/orgs/org_uuid/logos/logo.png"' in call["body"]
        # The whole point of the email: a working way back into the org.
        assert "https://acme.test/home" in call["body"]
        # Hostile username/org names are escaped, never rendered as markup.
        assert "<script>" not in call["body"]

    def test_org_join_email_uses_the_org_name_as_wordmark_without_logo(self):
        with patch("src.services.users.emails.send_email", return_value=True) as send_email:
            send_org_join_email(
                email="user@test.com",
                username="learner",
                org_name="Acme",
                cta_url="https://acme.test/home",
            )
        call = send_email.call_args.kwargs
        assert "<img" not in call["body"]
        assert "<svg" not in call["body"]
        assert _wordmark("Acme") in call["body"]

    def test_org_join_email_translates(self):
        with patch("src.services.users.emails.send_email", return_value=True) as send_email:
            send_org_join_email(
                email="user@test.com",
                username="learner",
                org_name="Acme",
                cta_url="https://acme.test/home",
                lang="fr",
            )
        call = send_email.call_args.kwargs
        assert "Bienvenue" in call["subject"]

    def test_send_password_reset_email_variants_encode_params(self):
        with patch("src.services.users.emails.send_email", return_value=True) as send_email:
            send_password_reset_email(
                "code 123",
                _user(),
                _org(),
                "user+tag@test.com",
                "https://app.test",
            )
            send_password_reset_email_platform(
                "code 123",
                _user(),
                "user+tag@test.com",
                "https://app.test",
            )

        first_body = send_email.call_args_list[0].kwargs["body"]
        second_body = send_email.call_args_list[1].kwargs["body"]
        # Both variants now point at the real .io route `/reset` (the platform
        # variant previously used `/reset-password`, which 404s on .io).
        assert "/reset?email=user%2Btag%40test.com&amp;resetCode=code%20123" in first_body
        assert "/reset?email=user%2Btag%40test.com&amp;resetCode=code%20123" in second_body

    def test_send_invitation_role_change_and_verification_email(self):
        with patch("src.services.users.emails.send_email", return_value=True) as send_email:
            send_invitation_email(
                "invitee@test.com",
                "Org & Co",
                "owner<script>",
                "https://app.test/signup",
                invite_code="INV-123",
            )
            send_role_changed_email(
                "invitee@test.com",
                "member<script>",
                "Org & Co",
                "Admin",
            )
            send_email_verification_email(
                "token 123",
                _user(),
                _org(),
                "invitee@test.com",
                "https://app.test",
            )

        invite_body = send_email.call_args_list[0].kwargs["body"]
        role_body = send_email.call_args_list[1].kwargs["body"]
        verification_body = send_email.call_args_list[2].kwargs["body"]
        assert "INV-123" in invite_body
        assert "@owner&lt;script&gt;" in invite_body
        assert "member&lt;script&gt;" in role_body
        assert "verify-email?token=token%20123&amp;user=user_uuid&amp;org=org_uuid" in verification_body

    def test_send_invitation_email_without_invite_code(self):
        with patch("src.services.users.emails.send_email", return_value=True) as send_email:
            send_invitation_email(
                "invitee@test.com",
                "Test Org",
                "inviter",
                "https://app.test/signup",
            )
        invite_body = send_email.call_args.kwargs["body"]
        assert "Click the button below" in invite_body

    def test_send_emails_in_french_when_lang_is_fr(self):
        with patch("src.services.users.emails.send_email", return_value=True) as send_email:
            send_invitation_email(
                "invitee@test.com",
                "Org & Co",
                "owner",
                "https://app.test/signup",
                invite_code="INV-123",
                lang="fr",
            )
            send_password_reset_email(
                "abcd1234",
                _user(),
                _org(),
                "user@test.com",
                "https://app.test",
                lang="fr",
            )
            send_role_changed_email(
                "user@test.com",
                "member",
                "Org & Co",
                "Admin",
                lang="fr",
            )

        invite_call = send_email.call_args_list[0].kwargs
        reset_call = send_email.call_args_list[1].kwargs
        role_call = send_email.call_args_list[2].kwargs

        assert "Vous êtes invité" in invite_call["body"]
        assert "Vous êtes invité à rejoindre Org &amp; Co" == invite_call["subject"]
        assert "Réinitialisez votre mot de passe" in reset_call["body"]
        assert "Réinitialisez votre mot de passe" == reset_call["subject"]
        assert "Votre rôle a été mis à jour" in role_call["body"]

    def test_send_emails_falls_back_to_english_for_unknown_lang(self):
        with patch("src.services.users.emails.send_email", return_value=True) as send_email:
            send_invitation_email(
                "invitee@test.com",
                "Org",
                "owner",
                "https://app.test/signup",
                lang="xx",
            )
        body = send_email.call_args.kwargs["body"]
        assert "You've been invited" in body


class TestNotificationEmailResilience:
    """Lifecycle mail must never take the request down with it."""

    def test_notification_email_failure_does_not_propagate(self):
        from fastapi import HTTPException

        with patch(
            "src.services.users.emails.send_email",
            side_effect=HTTPException(status_code=503, detail="Email service temporarily unavailable"),
        ):
            # A signup whose welcome email fails still returns — the account is
            # already created, so a dead mail provider must not 5xx the caller.
            assert send_account_creation_email(_user(), "user@test.com") is False

    def test_password_reset_email_still_raises(self):
        from fastapi import HTTPException

        from src.services.users.emails import send_password_reset_email

        with patch(
            "src.services.users.emails.send_email",
            side_effect=HTTPException(status_code=503, detail="down"),
        ):
            with pytest.raises(HTTPException):
                send_password_reset_email(
                    "code 123",
                    _user(),
                    _org(),
                    "user@test.com",
                    "https://app.test",
                )


class TestResendTransientRetry:
    def test_timeout_is_retried_once_then_succeeds(self, monkeypatch):
        from src.services.email import utils as email_utils

        monkeypatch.setattr(email_utils.time, "sleep", lambda _s: None)
        calls = []

        def flaky(payload):
            calls.append(payload)
            if len(calls) == 1:
                raise RuntimeError("Read timed out. (read timeout=30)")
            return {"id": "sent"}

        monkeypatch.setattr(email_utils.resend.Emails, "send", staticmethod(flaky))

        result = email_utils._send_email_resend(
            "LearnHouse <no-reply@test>", "user@test.com", "hi", "<p>hi</p>",
            SimpleNamespace(resend_api_key="key"),
        )

        assert result == {"id": "sent"}
        assert len(calls) == 2

    def test_quota_error_is_not_retried(self, monkeypatch):
        from fastapi import HTTPException

        from src.services.email import utils as email_utils

        monkeypatch.setattr(email_utils.time, "sleep", lambda _s: None)
        calls = []

        def over_quota(payload):
            calls.append(payload)
            raise RuntimeError("You have reached your daily email sending quota.")

        monkeypatch.setattr(email_utils.resend.Emails, "send", staticmethod(over_quota))

        with pytest.raises(HTTPException) as exc_info:
            email_utils._send_email_resend(
                "LearnHouse <no-reply@test>", "user@test.com", "hi", "<p>hi</p>",
                SimpleNamespace(resend_api_key="key"),
            )

        assert exc_info.value.status_code == 503
        assert len(calls) == 1  # a quota error will not clear on retry


class TestSenderNameRouting:
    """Which emails carry an organization's display name, and which never do.

    Org-scoped mail is *about* one organization, so it may go out under that
    organization's name. Platform mail (org-less signup, platform password
    reset, account deletion) must not borrow one — the recipient has no
    relationship with any org in that moment.
    """

    def test_org_scoped_emails_forward_the_org_name(self):
        with patch("src.services.users.emails.send_email", return_value=True) as sent:
            send_password_reset_email(
                generated_reset_code="code",
                user=_user(),
                organization=_org(),
                email="user@test.com",
                base_url="https://org.test",
                sender_name="Acme Academy",
            )
            assert sent.call_args.kwargs["sender_name"] == "Acme Academy"

            send_invitation_email(
                email="user@test.com",
                org_name="Org & Co",
                inviter_username="admin",
                signup_url="https://org.test/signup",
                sender_name="Acme Academy",
            )
            assert sent.call_args.kwargs["sender_name"] == "Acme Academy"

            send_email_verification_email(
                token="tok",
                user=_user(),
                organization=_org(),
                email="user@test.com",
                base_url="https://org.test",
                sender_name="Acme Academy",
            )
            assert sent.call_args.kwargs["sender_name"] == "Acme Academy"

    def test_org_scoped_notifications_forward_the_org_name(self):
        with patch(
            "src.services.users.emails.send_email", return_value=True
        ) as sent:
            send_org_join_email(
                email="user@test.com",
                username="user",
                org_name="Org & Co",
                cta_url="https://org.test",
                sender_name="Acme Academy",
            )
            assert sent.call_args.kwargs["sender_name"] == "Acme Academy"

            send_role_changed_email(
                email="user@test.com",
                username="user",
                org_name="Org & Co",
                new_role_name="Admin",
                sender_name="Acme Academy",
            )
            assert sent.call_args.kwargs["sender_name"] == "Acme Academy"

    def test_platform_emails_send_no_org_name(self):
        with patch("src.services.users.emails.send_email", return_value=True) as sent:
            send_password_reset_email_platform(
                generated_reset_code="code",
                user=_user(),
                email="user@test.com",
                base_url="https://platform.test",
            )
            assert "sender_name" not in sent.call_args.kwargs

            send_account_deleted_email("user@test.com", "user")
            assert "sender_name" not in sent.call_args.kwargs

    def test_org_scoped_default_is_still_no_name(self):
        """Callers without org context keep the platform default by omission,
        so nothing had to change at the platform-scoped call sites."""
        with patch("src.services.users.emails.send_email", return_value=True) as sent:
            send_invitation_email(
                email="user@test.com",
                org_name="Org & Co",
                inviter_username="admin",
                signup_url="https://org.test/signup",
            )
            assert sent.call_args.kwargs["sender_name"] is None


class TestWhiteLabel:
    """Every org-scoped email is the organization's own, not LearnHouse's.

    With the org's watermark off there must be no trace of the platform in
    the rendered mail — no wordmark, no name in the copy, no attribution
    line. With it on, exactly one "Powered by LearnHouse" line remains.
    """

    LOGO = "https://api.test/content/orgs/org_uuid/logos/logo.png"
    BRANDING = dict(
        lang="en",
        sender_name="Acme Academy",
        logo_url=LOGO,
        brand_color="#ff5500",
        powered_by=False,
    )

    def _all_org_scoped_sends(self, **branding):
        """Render each org-scoped mail once; returns the captured calls."""
        from src.services.auth.magic_login import send_magic_login_email

        with patch("src.services.users.emails.send_email", return_value=True) as sent, patch(
            "src.services.auth.magic_login.send_email", return_value=True
        ) as sent_magic:
            send_password_reset_email(
                generated_reset_code="CODE1234",
                user=_user(),
                organization=_org(name="Acme & Co"),
                email="user@test.com",
                base_url="https://acme.test",
                **branding,
            )
            send_invitation_email(
                email="user@test.com",
                org_name="Acme & Co",
                inviter_username="owner",
                signup_url="https://acme.test/signup",
                invite_code="INV-1",
                **branding,
            )
            send_email_verification_email(
                token="tok",
                user=_user(),
                organization=_org(name="Acme & Co"),
                email="user@test.com",
                base_url="https://acme.test",
                **branding,
            )
            send_role_changed_email(
                email="user@test.com",
                username="learner",
                org_name="Acme & Co",
                new_role_name="Admin",
                cta_url="https://acme.test",
                **branding,
            )
            send_org_join_email(
                email="user@test.com",
                username="learner",
                org_name="Acme & Co",
                cta_url="https://acme.test",
                **branding,
            )
            send_account_creation_email(
                _user(),
                "user@test.com",
                cta_url="https://acme.test",
                org_name="Acme & Co",
                **branding,
            )
            send_magic_login_email(
                _user(),
                "user@test.com",
                "https://acme.test",
                "jwt",
                org_name="Acme & Co",
                **branding,
            )
        calls = [c.kwargs for c in sent.call_args_list] + [c.kwargs for c in sent_magic.call_args_list]
        assert len(calls) == 7
        return calls

    def test_no_platform_branding_leaks_when_watermark_is_off(self):
        for call in self._all_org_scoped_sends(**self.BRANDING):
            assert "LearnHouse" not in call["body"], call["subject"]
            assert "LearnHouse" not in call["subject"]
            assert "<svg" not in call["body"]
            assert f'<img src="{self.LOGO}" alt="Acme &amp; Co"' in call["body"]
            assert call["sender_name"] == "Acme Academy"

    def test_brand_color_tints_the_button(self):
        for call in self._all_org_scoped_sends(**self.BRANDING):
            assert "background-color: #ff5500;" in call["body"], call["subject"]
            assert "background-color: #000000;" not in call["body"]
            # Orange is light enough that white text would fail contrast.
            assert "color: #000000; text-decoration: none" in call["body"]

    def test_watermark_on_adds_exactly_one_powered_by_line(self):
        branding = dict(self.BRANDING, powered_by=True)
        for call in self._all_org_scoped_sends(**branding):
            assert call["body"].count("Powered by LearnHouse") == 1, call["subject"]
            # ...and that line is the only place the platform appears.
            assert call["body"].count("LearnHouse") == 1
            assert "LearnHouse" not in call["subject"]

    def test_square_logo_renders_as_a_square_box_and_wide_logo_letterboxed(self):
        square = "https://api.test/content/orgs/org_uuid/square_logos/sq.png"
        with patch("src.services.users.emails.send_email", return_value=True) as sent:
            send_invitation_email(
                email="user@test.com", org_name="Acme", inviter_username="owner",
                signup_url="https://acme.test/signup", logo_url=square,
            )
            square_body = sent.call_args.kwargs["body"]
            send_invitation_email(
                email="user@test.com", org_name="Acme", inviter_username="owner",
                signup_url="https://acme.test/signup", logo_url=self.LOGO,
            )
            wide_body = sent.call_args.kwargs["body"]
        assert f'<img src="{square}" alt="Acme" width="56" height="56"' in square_body
        assert "border-radius: 12px" in square_body
        assert f'<img src="{self.LOGO}" alt="Acme" height="40"' in wide_body
        assert "max-width: 180px" in wide_body
        assert "width=\"56\"" not in wide_body

    def test_org_without_logo_or_color_gets_wordmark_and_default_button(self):
        for call in self._all_org_scoped_sends(powered_by=False):
            assert _wordmark("Acme &amp; Co") in call["body"], call["subject"]
            assert "<img" not in call["body"]
            assert "<svg" not in call["body"]
            assert "background-color: #000000;" in call["body"]

    def test_invalid_brand_color_keeps_the_default_button(self):
        for bad in ("red", "#12345", "#ff5500; color: red", "url(x)", "", None):
            with patch("src.services.users.emails.send_email", return_value=True) as sent:
                send_invitation_email(
                    email="user@test.com",
                    org_name="Acme",
                    inviter_username="owner",
                    signup_url="https://acme.test/signup",
                    brand_color=bad,
                )
            body = sent.call_args.kwargs["body"]
            assert "background-color: #000000;" in body, bad
            assert "color: red" not in body
            assert "url(" not in body

    def test_org_verification_mail_names_the_org_not_the_platform(self):
        with patch("src.services.users.emails.send_email", return_value=True) as sent:
            send_email_verification_email(
                token="tok",
                user=_user(),
                organization=_org(name="Acme & Co"),
                email="user@test.com",
                base_url="https://acme.test",
                powered_by=False,
            )
        body = sent.call_args.kwargs["body"]
        assert "welcome to Acme &amp; Co!" in body
        assert "create a Acme &amp; Co account" in body or "Acme &amp; Co account" in body
        assert "LearnHouse" not in body

    def test_platform_mails_keep_the_learnhouse_mark_and_no_powered_by(self):
        with patch("src.services.users.emails.send_email", return_value=True) as sent:
            send_password_reset_email_platform(
                generated_reset_code="code",
                user=_user(),
                email="user@test.com",
                base_url="https://platform.test",
            )
            send_email_verification_email(
                token="tok",
                user=_user(),
                organization=None,
                email="user@test.com",
                base_url="https://platform.test",
                # A stray color from a caller must not tint a platform mail.
                brand_color="#ff5500",
            )
            send_account_creation_email(_user(), "user@test.com")
            send_account_deleted_email("user@test.com", "user")
        for call in sent.call_args_list:
            body = call.kwargs["body"]
            assert "<svg" in body, call.kwargs["subject"]
            assert "Powered by LearnHouse" not in body
            assert "#ff5500" not in body
        verification_body = sent.call_args_list[1].kwargs["body"]
        assert "welcome to LearnHouse!" in verification_body

    def test_translated_whitelabel_copy_has_no_unfilled_placeholders(self):
        from src.services.auth.magic_login import send_magic_login_email
        from src.services.email.translations import SUPPORTED_LANGUAGES

        for lang in SUPPORTED_LANGUAGES:
            with patch("src.services.users.emails.send_email", return_value=True) as sent, patch(
                "src.services.auth.magic_login.send_email", return_value=True
            ) as sent_magic:
                send_email_verification_email(
                    token="tok",
                    user=_user(),
                    organization=_org(name="Acme"),
                    email="user@test.com",
                    base_url="https://acme.test",
                    lang=lang,
                )
                send_magic_login_email(
                    _user(), "user@test.com", "https://acme.test", "jwt",
                    lang=lang, org_name="Acme", powered_by=False,
                )
            for call in [sent.call_args.kwargs, sent_magic.call_args.kwargs]:
                assert "{brand}" not in call["body"], lang
                assert "{brand}" not in call["subject"], lang
                assert "{username}" not in call["body"], lang
                assert "Acme" in call["body"], lang
            assert "LearnHouse" not in sent_magic.call_args.kwargs["body"], lang
            assert "LearnHouse" not in sent_magic.call_args.kwargs["subject"], lang
