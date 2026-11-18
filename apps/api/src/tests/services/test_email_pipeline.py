"""The shared email system: blocks, layout, registry, pipeline, transport, preview.

Every registered template is rendered with its samples (HTML and text), and a
repository-wide check makes sure nothing outside the pipeline talks to a mail
provider or builds its own email HTML.
"""

from __future__ import annotations

import re
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from src.services.email import blocks as b
from src.services.email import layout, pipeline, registry
from src.services.email.branding import OrgEmailBranding
from src.services.email.layout import Brand, Email
from src.services.email.theme import category

XSS = '<script>alert(1)</script>"&'


def _ctx(align="left"):
    return b.Ctx(button_bg="#171717", button_fg="#ffffff", align=align)


# ── blocks ───────────────────────────────────────────────────────────────


class TestBlocks:
    def test_esc_escapes_raw_text_and_keeps_safe(self):
        assert b.esc(XSS) == "&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;"
        assert b.esc(b.Safe("<b>x</b>")) == "<b>x</b>"
        assert b.esc(None) == ""

    def test_to_text_strips_tags_only_from_safe(self):
        assert b.to_text(None) == ""
        assert b.to_text("<b>raw</b>") == "<b>raw</b>"
        assert b.to_text(b.Safe("<p>a &amp; b</p><p>c<br>d</p>")) == "a & b\nc\nd"

    @pytest.mark.parametrize("block", [
        b.Heading(XSS), b.Subheading(XSS), b.Paragraph(XSS), b.Paragraph(XSS, muted=True),
        b.Paragraph(XSS, small=True), b.Button(XSS, "https://x.test/?a=1&b=2"),
        b.Button(XSS, "https://x.test", secondary=True), b.LinkFallback("https://x.test/?a=<b>"),
        b.Code(XSS), b.Callout(XSS, tone="danger", title=XSS), b.Callout(XSS, tone="nope"),
        b.Quote(XSS + "\nline 2", XSS), b.Quote("", None), b.Details([(XSS, XSS), ("empty", "")]),
        b.BulletList([XSS]), b.Links([(XSS, "https://x.test")], lead=XSS), b.Links([(XSS, "https://x.test")]),
        b.Table(XSS, [[XSS, XSS, XSS]] * 12, more=XSS), b.Table(XSS, [[XSS, XSS]]),
        b.Items([b.Row(XSS, XSS, "https://x.test", 3), b.Row(XSS)], more=XSS),
        b.Divider(), b.Buttons([b.Button("Go", "https://x.test"), b.Button("Also", "https://y.test", secondary=True)]),
    ])
    def test_every_block_escapes_user_text(self, block):
        for align in ("left", "right"):
            out = block.html(_ctx(align))
            assert "<script>" not in out
        assert isinstance(block.text(), str)

    def test_empty_blocks_render_nothing(self):
        for block in (b.Details([]), b.BulletList([]), b.Items([]), b.Table("t", []), b.Links([])):
            assert block.html(_ctx()) == ""

    def test_prose_styles_known_tags_and_has_text(self):
        prose = b.Prose(b.Safe('<p>Hi <strong>A</strong> <a href="https://x.test">go</a></p><ul><li>x</li></ul>'), "plain")
        out = prose.html(_ctx("right"))
        assert '<a href="https://x.test" style=' in out and "padding-right: 20px" in out
        assert prose.text() == "plain"
        assert b.Prose(b.Safe("<p>a</p>")).text() == "a"

    def test_text_alternatives(self):
        assert b.Heading("Title").text() == "Title"
        assert b.Subheading("Sub").text() == "Sub"
        assert b.Code("AB12").text() == "AB12"
        assert b.Button("Go", "https://x.test").text() == "Go: https://x.test"
        assert b.LinkFallback("https://x.test").text() == ""
        assert b.Callout("c", title="T").text() == "T: c"
        assert b.Quote("a\nb", "Ann").text() == "Ann\n> a\n> b"
        assert b.Details([("A", "1")]).text() == "A: 1"
        assert "- x" in b.BulletList(["x"]).text()
        assert b.Links([("G", "https://g")], lead="Add to").text() == "Add to\nG: https://g"
        assert b.Divider().text() == "---"
        assert "3 more" in b.Table("T", [["a", "b"]] * 4, limit=2, more="3 more").text()
        assert b.Items([b.Row("T", "B", "https://u", 2)], more="more").text() == "- T (2)\n  B\n  https://u\nmore"
        assert b.compact([None, b.Divider()]) and len(b.compact([None])) == 0


# ── layout ───────────────────────────────────────────────────────────────


class TestLayout:
    def _email(self, **kw):
        return Email(subject="Subj", blocks=[b.Heading("Hello <b>"), b.Paragraph("First sentence. Second.")], **kw)

    def test_platform_frame_v2(self):
        html = layout.render_html(self._email(), layout.PLATFORM_BRAND, "security", "en")
        assert html.startswith("<!DOCTYPE html>") and 'lang="en" dir="ltr"' in html
        assert "<title>Hello &lt;b&gt;</title>" in html
        assert "learnhouse-wordmark@2x.png" in html and 'alt="LearnHouse"' in html
        assert "background-color: #f8f8f8" in html  # the V2 canvas
        assert "max-width: 560px" in html and "border-radius: 16px" in html  # the card
        assert "0 4px 6px -1px rgba(209,213,219,0.25)" in html  # nice-shadow
        assert "icons/shield-check-sky.png" in html  # the hero tile (security default)
        assert "learnhouse-wordmark-grey@2x.png" in html  # footer wordmark
        assert "<!--[if mso]>" in html
        assert 'content="light"' in html
        assert "First sentence." in html.split("<table", 1)[0]  # preheader
        assert 'alt="LearnHouse" width="109"' in html  # grey footer wordmark

    def test_logo_url_override(self, monkeypatch):
        monkeypatch.setenv("LEARNHOUSE_EMAIL_LOGO_URL", "https://cdn.test/logo.png")
        assert "https://cdn.test/logo.png" in layout.learnhouse_mark()

    def test_org_brand_logo_name_color_powered_by(self):
        brand = Brand(name="Acme & Co", org_scoped=True, color="#ff5500", powered_by=True)
        html = layout.render_html(self._email(), brand, "learning", "en")
        assert "Acme &amp; Co</span>" in html and "learnhouse-wordmark" not in html
        assert html.count("LearnHouse") == 1 and "Sent by Acme &amp; Co via LearnHouse" in html
        assert layout._button_colors(brand) == ("#ff5500", "#000000")
        square = Brand(name="A", org_scoped=True, logo_url="https://x.test/square_logos/a.png")
        assert 'width="36" height="36"' in layout.render_html(self._email(), square, "x", "en")
        wide = Brand(name="A", org_scoped=True, logo_url="https://x.test/logos/a.png", color="#ffffff")
        out = layout.render_html(self._email(), wide, "x", "en")
        assert 'height="32"' in out and layout._button_colors(wide) == ("#171717", "#ffffff")
        assert "Powered by" not in out

    def test_rtl_and_language_normalisation(self):
        assert 'dir="rtl"' in layout.render_html(self._email(), layout.PLATFORM_BRAND, "team", "ar")
        assert 'lang="en"' in layout.render_html(self._email(), layout.PLATFORM_BRAND, "team", 'xx"><script>')

    def test_footer_links_and_text(self):
        email = self._email(reason="Why", footer="More", unsubscribe_url="https://u.test", manage_url="https://m.test")
        html = layout.render_html(email, layout.PLATFORM_BRAND, "team", "en")
        assert 'href="https://u.test"' in html and 'href="https://m.test"' in html
        text = layout.render_text(email, Brand(name="Acme", org_scoped=True, powered_by=True))
        assert text.startswith("Acme\n") and "Unsubscribe: https://u.test" in text
        assert "Email preferences: https://m.test" in text and "Powered by" not in text
        assert layout.render_text(Email(subject="s", blocks=[]), layout.PLATFORM_BRAND).endswith("--\nLearnHouse\n")
        assert text.endswith("Sent by Acme via LearnHouse\n")

    def test_preheader(self):
        assert layout.preheader_block("") == ""
        assert layout.first_sentence("") == ""
        assert layout.first_sentence("短い。次") == "短い。"
        assert layout.first_sentence("short") == "short"
        assert layout.first_sentence("word " * 40).endswith("…")
        assert layout._auto_preheader(Email(subject="s", blocks=[b.Divider()])) == ""
        assert layout._auto_preheader(Email(subject="s", blocks=[], preheader="P")) == "P"


# ── registry ─────────────────────────────────────────────────────────────


class TestRegistry:
    def test_unknown_template(self):
        with pytest.raises(ValueError):
            registry.get_template("nope.nope")

    def test_samples_accept_dicts(self):
        registry.email_template("test.dict_sample", category="team", samples=({"a": 1},))(
            lambda v, lang, brand: Email(subject="s", blocks=[])
        )
        assert registry.get_template("test.dict_sample").samples[0].values == {"a": 1}

    def test_ee_templates_load_when_available(self, monkeypatch):
        monkeypatch.setattr(registry, "_loaded", False)
        imported = []
        monkeypatch.setattr(registry.importlib, "import_module", lambda m: imported.append(m))
        import src.core.ee_hooks as hooks

        monkeypatch.setattr(hooks, "is_ee_available", lambda: True)
        registry.load_templates()
        assert imported[-1] == registry.EE_TEMPLATE_MODULE

    def test_missing_ee_package_is_tolerated(self, monkeypatch):
        monkeypatch.setattr(registry, "_loaded", False)

        def fake(module):
            if module == registry.EE_TEMPLATE_MODULE:
                raise ImportError(module)

        monkeypatch.setattr(registry.importlib, "import_module", fake)
        import src.core.ee_hooks as hooks

        monkeypatch.setattr(hooks, "is_ee_available", lambda: True)
        registry.load_templates()
        assert registry._loaded is True


ALL_SAMPLES = [
    pytest.param(tpl, sample, id=f"{tpl.name}-{i}")
    for tpl in registry.all_templates()
    for i, sample in enumerate(tpl.samples)
]


class TestEveryTemplate:
    @pytest.mark.parametrize("tpl,sample", ALL_SAMPLES)
    @pytest.mark.parametrize("lang", ["en", "fr", "ar"])
    def test_renders_html_and_text_without_placeholders(self, tpl, sample, lang):
        from src.services.email.preview import sample_org

        out = pipeline.render_email(tpl.name, sample.values, org=sample_org(sample), lang=lang)
        assert out.subject and "\n" not in out.subject
        body = out.html.split("<body", 1)[1]
        assert not re.search(r"\{[a-z_]+\}", body), tpl.name
        assert not re.search(r"\{[a-z_]+\}", out.text + out.subject), tpl.name
        assert out.text.strip() and "<td" not in out.text and "<p" not in out.text
        assert out.category == tpl.category and out.template == tpl.name

    @pytest.mark.parametrize("tpl,sample", ALL_SAMPLES)
    def test_user_text_is_escaped(self, tpl, sample):
        """Every string value replaced by an XSS payload never reaches the HTML raw."""
        from src.services.email.preview import sample_org

        def poison(value, key=""):
            if isinstance(value, str) and key not in ("html", "stage", "nudge_id", "kind", "status", "category"):
                return value if value.startswith("http") else XSS
            if isinstance(value, dict):
                return {k: poison(v, k) for k, v in value.items()}
            if isinstance(value, list):
                return [poison(v, key) for v in value]
            if isinstance(value, tuple):
                return tuple(poison(v, key) for v in value)
            return value

        org = sample_org(sample)
        if org is not None:
            org = OrgEmailBranding(org_name=XSS, sender_name=XSS, brand_color=XSS)
        try:
            out = pipeline.render_email(tpl.name, poison(dict(sample.values)), org=org)
        except (KeyError, ValueError, TypeError, AttributeError):
            pytest.skip("payload not valid for a structured field")
        assert "<script>" not in out.html


# ── pipeline ─────────────────────────────────────────────────────────────


class TestPipeline:
    def test_brand_for(self):
        assert pipeline.brand_for(None) is layout.PLATFORM_BRAND
        brand = Brand(name="X", org_scoped=True)
        assert pipeline.brand_for(brand) is brand
        named = pipeline.brand_for("Acme\nBcc: x")
        assert named.org_scoped and "\n" not in named.name and named.sender_name == named.name
        full = pipeline.brand_for(OrgEmailBranding(org_name="Acme", lang="fr", sender_name="", logo_url="u",
                                                   brand_color="#123456", powered_by=False))
        assert (full.name, full.lang, full.sender_name, full.color, full.powered_by) == ("Acme", "fr", None, "#123456", False)

    def test_send_hands_html_text_headers_to_the_provider(self):
        with patch("src.services.email.pipeline.deliver_message", return_value={"id": "1"}) as sent:
            result = pipeline.send_email(
                "learning.nudge", "a@test.com",
                {"nudge_id": "activation.first_course_d1", "cta_url": "https://x.test", "unsubscribe_url": "https://u.test"},
                org=OrgEmailBranding(org_name="Acme", sender_name="Acme Academy"), headers={"X-Extra": "1"},
            )
        assert result == {"id": "1"}
        kw = sent.call_args.kwargs
        assert kw["sender_name"] == "Acme Academy" and kw["text"].startswith("Acme")
        assert kw["headers"]["List-Unsubscribe"] == "<https://u.test>"
        assert kw["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
        assert kw["headers"]["X-Extra"] == "1"

    def test_critical_mail_raises_and_other_mail_is_swallowed(self):
        with patch("src.services.email.pipeline.deliver_message", side_effect=RuntimeError("down")):
            with pytest.raises(RuntimeError):
                pipeline.send_email("account.magic_login", "a@test.com", {"url": "https://x.test"})
            assert pipeline.send_email("account.deleted", "a@test.com", {}) is False
            assert pipeline.send_email("account.deleted", "a@test.com", {}, critical=False) is False
            with pytest.raises(RuntimeError):
                pipeline.send_email("account.deleted", "a@test.com", {}, critical=True)

    @pytest.mark.asyncio
    async def test_async_wrapper(self):
        with patch("src.services.email.pipeline.deliver_message", return_value=True):
            assert await pipeline.asend_email("account.deleted", "a@test.com", {}) is True

    def test_subject_header_injection_is_stripped(self):
        out = pipeline.render_email("org.deleted", {"org_name": "Acme\r\nBcc: evil@test"})
        assert "\r" not in out.subject and "\n" not in out.subject


class TestTranslationsHelpers:
    def test_th_escapes_values_and_tt_returns_plain(self):
        from src.services.email.translations import th, tt

        html = th("en", "invitation.intro", inviter="<x>", org_name="A & B")
        assert isinstance(html, b.Safe) and "&lt;x&gt;" in html and "<strong>" in html
        assert tt("en", "invitation.intro", inviter="<x>", org_name="A & B") == "@<x> has invited you to join A & B."


class TestTransport:
    def test_smtp_sends_text_and_html_alternatives(self, monkeypatch):
        from src.services.email import transport

        sent = {}

        class FakeSMTP:
            def __init__(self, *a, **k):
                pass

            def sendmail(self, frm, to, msg):
                sent["msg"] = msg

            def quit(self):
                pass

        monkeypatch.setattr(transport.smtplib, "SMTP", FakeSMTP)
        mailing = SimpleNamespace(smtp_use_tls=False, smtp_host="h", smtp_port=25, smtp_username="",
                                  smtp_password="", system_email_address="no-reply@test")
        transport._send_email_smtp("LH <no-reply@test>", "a@test.com", "S", "<p>h</p>", mailing, None, "plain body")
        assert "text/plain" in sent["msg"] and "text/html" in sent["msg"]
        assert sent["msg"].index("text/plain") < sent["msg"].index("text/html")

    def test_resend_payload_carries_text(self, monkeypatch):
        from src.services.email import transport

        payloads = []
        monkeypatch.setattr(transport.resend.Emails, "send", staticmethod(lambda p: payloads.append(p) or {"id": "x"}))
        transport._send_email_resend("LH <n@test>", "a@test.com", "S", "<p>h</p>", SimpleNamespace(resend_api_key="k"),
                                     None, "plain")
        assert payloads[0]["text"] == "plain"


class TestPreview:
    def test_gallery_writes_every_sample_and_an_index(self, tmp_path):
        from src.services.email.preview import main

        index = main(["--out", str(tmp_path), "--lang", "en"])
        names = {p.name for p in tmp_path.iterdir()}
        assert index.name == "index.html" and "account-password-reset-1-en.html" in names
        assert "account-password-reset-1-en.txt" in names
        assert "Email gallery" in index.read_text()


class TestOrgEmailBranding:
    @pytest.mark.asyncio
    async def test_loads_the_config_row(self):
        from src.services.email.branding import org_email_branding

        class _Result:
            def scalars(self):
                return self

            def first(self):
                return None

        class _Db:
            async def execute(self, _stmt):
                return _Result()

        org = SimpleNamespace(id=1, name="Acme", org_uuid="org_1", logo_image=None)
        branding = await org_email_branding(_Db(), org)
        assert branding.org_name == "Acme"


# ── the single entry point ───────────────────────────────────────────────

API_ROOT = Path(__file__).resolve().parents[3]

# Only the pipeline may reach the transport, and only the transport may reach
# a provider SDK. Nothing else may build an email document by hand.
PROVIDER_CALL = re.compile(r"resend\.Emails\.send|smtplib\.SMTP|services\.email\.transport|email import transport")
HAND_BUILT = re.compile(
    r"_email_layout|_send_notification_email|email\.utils import[^\n]*send_email"
    r"|users\.emails import[^\n]*(STYLES|COLORS|LOGO_SVG)"
)
ALLOWED = {
    "src/services/email/transport.py",
    "src/services/email/pipeline.py",
    "src/services/email/layout.py",
}


def _sources():
    roots = [API_ROOT / "src"]
    if (API_ROOT / "ee").exists():
        roots.append(API_ROOT / "ee")
    for root in roots:
        for path in root.rglob("*.py"):
            rel = path.relative_to(API_ROOT).as_posix()
            if "/tests/" in rel or rel.startswith(("src/tests", "ee/tests")):
                continue
            # Customer-authored newsletters keep their own renderer and providers.
            if rel.startswith("ee/services/newsletter/") and not rel.endswith("deliverability.py"):
                continue
            yield rel, path.read_text(encoding="utf-8")


def test_no_sender_bypasses_the_pipeline():
    offenders = [
        rel for rel, text in _sources()
        if rel not in ALLOWED and (PROVIDER_CALL.search(text) or HAND_BUILT.search(text))
    ]
    assert offenders == []


def test_send_billing_email_internal_endpoint(monkeypatch):
    import asyncio

    from fastapi import HTTPException

    from src.routers.orgs.org_plan import SendBillingEmailRequest, send_billing_email_internal

    with pytest.raises(HTTPException):
        asyncio.run(send_billing_email_internal(SendBillingEmailRequest(template="account.magic_login", to=["a@test.com"])))
    with patch("src.services.email.pipeline.deliver_message", side_effect=[True, RuntimeError("down")]):
        out = asyncio.run(send_billing_email_internal(SendBillingEmailRequest(
            template="billing.payment_failed", to=["a@test.com", "b@test.com", "b@test.com", "bad"],
            context={"plan": "pro", "org_slug": "acme"})))
    assert out == {"sent": 1, "recipients": 2}


def test_categories_and_human_dates():
    from datetime import date, datetime

    from src.services.email.dates import human_date

    assert category("nope").name == "team" and category("billing").label == "Billing"
    assert human_date(date(2026, 12, 2)) == "2 December 2026"
    assert human_date(datetime(2026, 11, 29, 8, 0)) == "29 November 2026"
    assert human_date("2026-12-02") == "2 December 2026"
    assert human_date("2026-12-02T10:00:00Z") == "2 December 2026"
    assert human_date("soon") == "soon" and human_date(None) == "" and human_date("") == ""


def test_org_mail_footer_is_the_sent_by_line():
    brand = Brand(name="Acme", org_scoped=True)
    assert "Sent by Acme via LearnHouse" in layout.footer_html(Email(subject="s", blocks=[]), brand)


def test_kit_blocks():
    from src.services.email.blocks import Hero, Stat, Stats, chip, icon_tile

    ctx = b.Ctx(tone="emerald")
    assert "background-color: #fff1f2" in chip("Failed", "rose", dot=True)  # rose-50 tint
    assert "icons/key-sky.png" in icon_tile("key", "sky")
    hero = Hero("T", "D", "key", "sky")
    assert "icons/key-sky.png" in hero.html(ctx) and hero.text() == "T\n\nD"
    assert Hero("T").text() == "T"
    stats = Stats([Stat("Courses", 3, "book-open", "emerald"), ("Members", 5)])
    html = stats.html(ctx)
    assert "icons/book-open-emerald.png" in html and ">5</div>" in html
    assert stats.text() == "Courses: 3   Members: 5" and Stats([]).html(ctx) == ""
    assert "background-color: #fffbeb" in b.Callout("x", tone="warning").html(ctx)
    assert "background-color: #fafafa" in b.Callout("x").html(ctx)
    org = b.Button("Go", "https://x.test").html(b.Ctx(button_bg="#2563eb", org_button=True))
    assert "background-color: #2563eb" in org and "v:roundrect" in org


def test_asset_base_override(monkeypatch):
    from src.services.email.blocks import asset_url

    monkeypatch.setenv("LEARNHOUSE_EMAIL_ASSETS_URL", "https://cdn.test/mail/")
    assert asset_url("icons/key-sky.png") == "https://cdn.test/mail/icons/key-sky.png"


def test_every_template_icon_has_its_png():
    """Each hero icon (template or category default) exists in apps/web/public/emails/icons."""
    from src.services.email.theme import CATEGORIES, ICONS

    icons_dir = API_ROOT.parent / "web" / "public" / "emails" / "icons"
    if not icons_dir.is_dir():
        pytest.skip("web app not checked out")
    for icon, tones in ICONS.items():
        for tone_name in tones:
            assert (icons_dir / f"{icon}-{tone_name}.png").is_file(), (icon, tone_name)
    for cat in CATEGORIES.values():
        assert cat.tone in ICONS[cat.icon], cat
    for tpl, sample in [(p.values[0], p.values[1]) for p in ALL_SAMPLES]:
        from src.services.email.preview import sample_org

        html = pipeline.render_email(tpl.name, sample.values, org=sample_org(sample)).html
        for icon, tone_name in re.findall(r"icons/([a-z-]+)-([a-z]+)\.png", html):
            assert tone_name in ICONS.get(icon, ()), (tpl.name, icon, tone_name)


def test_preheader_from_a_hero_and_billing_url_from_the_org(monkeypatch):
    import asyncio

    from src.routers.orgs.org_plan import SendBillingEmailRequest, send_billing_email_internal
    from src.services.email.blocks import Hero

    assert layout._auto_preheader(Email(subject="s", blocks=[Hero("T", "Short one. Then more.")])) == "Short one."

    async def base(slug):
        return "https://acme.test/"

    monkeypatch.setattr("src.services.email.utils.get_org_signup_base_url", base)
    with patch("src.services.email.pipeline.deliver_message", return_value=True) as sent:
        asyncio.run(send_billing_email_internal(SendBillingEmailRequest(
            template="billing.payment_failed", to=["a@test.com"], context={"plan": "pro", "org_slug": "acme"})))
    assert "https://acme.test/dash/org/settings/plan" in sent.call_args.kwargs["body"]
