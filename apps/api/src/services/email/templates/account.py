"""Account and security mail: welcome, verification, password reset, magic
link, email change, account deletion."""

from __future__ import annotations

from src.services.email.blocks import Button, Callout, Code, Heading, LinkFallback, Paragraph, Safe, compact
from src.services.email.layout import Brand, Email
from src.services.email.registry import Sample, email_template
from src.services.email.safe_text import email_user_name
from src.services.email.templates import ACADEMY_URL, SAMPLE_ORG
from src.services.email.translations import t, th, tt


def _brand_name(brand: Brand) -> str:
    return brand.name if brand.org_scoped else "LearnHouse"


@email_template(
    "account.welcome",
    category="security",
    samples=(
        Sample({"username": "ada", "cta_url": "https://learnhouse.app/organizations"}, "Platform signup"),
        Sample({"username": "ada", "cta_url": "https://northwind.learnhouse.app/home"}, "Org signup", org=SAMPLE_ORG),
    ),
)
def welcome(v: dict, lang: str, brand: Brand) -> Email:
    """Welcome once an account exists (white-labeled inside an org)."""
    username = email_user_name(v.get("username"))
    if brand.org_scoped:
        subject = tt(lang, "account_creation.subject_org", org_name=brand.name, username=username)
        body = th(lang, "account_creation.body_in_org", org_name=brand.name)
        reason = ""
    else:
        subject = tt(lang, "account_creation.subject", username=username)
        body = th(lang, "account_creation.body")
        academy = Safe(
            f'<a href="{ACADEMY_URL}" style="color: #64748b; text-decoration: underline;">'
            f'{t(lang, "academy_link_text")}</a>'
        )
        reason = th(lang, "account_creation.footer", academy_link=academy)
    return Email(
        subject=subject,
        blocks=[
            Heading(th(lang, "account_creation.heading", username=username)),
            Paragraph(body),
            Button(t(lang, "account_creation.cta"), v.get("cta_url") or ACADEMY_URL),
        ],
        icon="user-circle",
        reason=reason,
    )


@email_template(
    "account.email_verification",
    category="security",
    critical=True,
    samples=(
        Sample({"username": "ada", "url": "https://learnhouse.app/verify-email?token=sample"}, "Platform"),
        Sample({"username": "ada", "url": "https://northwind.learnhouse.app/verify-email?token=sample"}, "Org", org=SAMPLE_ORG),
    ),
)
def email_verification(v: dict, lang: str, brand: Brand) -> Email:
    """Confirm an address with a one-hour link."""
    name = _brand_name(brand)
    return Email(
        subject=tt(lang, "email_verification.subject"),
        blocks=[
            Heading(th(lang, "email_verification.heading")),
            Paragraph(th(lang, "email_verification.body", username=email_user_name(v.get("username")), brand=name)),
            Button(t(lang, "email_verification.cta"), v["url"]),
            LinkFallback(v["url"], t(lang, "email_verification.copy_paste")),
        ],
        icon="envelope-simple",
        reason=th(lang, "email_verification.footer", brand=name),
    )


@email_template(
    "account.password_reset",
    category="security",
    critical=True,
    samples=(
        Sample({"username": "ada", "code": "482913", "url": "https://learnhouse.app/reset?email=ada%40example.com&resetCode=482913"}, "Platform"),
        Sample({"username": "ada", "code": "482913", "url": "https://northwind.learnhouse.app/reset?resetCode=482913"}, "Org", org=SAMPLE_ORG),
    ),
)
def password_reset(v: dict, lang: str, brand: Brand) -> Email:
    """A reset code plus a one-click reset link."""
    footer_key = "password_reset.footer_org" if brand.org_scoped else "password_reset.footer_platform"
    return Email(
        subject=tt(lang, "password_reset.subject"),
        blocks=[
            Heading(th(lang, "password_reset.heading")),
            Paragraph(th(lang, "password_reset.body", username=email_user_name(v.get("username")))),
            Code(v["code"]),
            Button(t(lang, "password_reset.cta"), v["url"]),
        ],
        icon="key",
        reason=th(lang, footer_key),
    )


@email_template(
    "account.magic_login",
    category="security",
    critical=True,
    samples=(Sample({"username": "ada", "url": "https://learnhouse.app/auth/magic?token=sample"}),),
)
def magic_login(v: dict, lang: str, brand: Brand) -> Email:
    """A single-use sign-in link."""
    name = _brand_name(brand)
    return Email(
        subject=tt(lang, "magic_login.subject", brand=name),
        blocks=[
            Heading(th(lang, "magic_login.heading", brand=name)),
            Paragraph(th(lang, "magic_login.body", username=v.get("username") or "")),
            Button(t(lang, "magic_login.cta"), v["url"]),
            LinkFallback(v["url"], t(lang, "email_verification.copy_paste")),
        ],
        icon="sign-in",
        reason=th(lang, "magic_login.footer", brand=name),
    )


@email_template(
    "account.email_changed",
    category="security",
    samples=(Sample({"username": "ada", "new_email": "ada.lovelace@example.org"}),),
)
def email_changed(v: dict, lang: str, brand: Brand) -> Email:
    """Tell the previous address the account moved to another inbox."""
    return Email(
        subject=tt(lang, "email_changed.subject"),
        blocks=[
            Heading(th(lang, "email_changed.heading")),
            Paragraph(th(lang, "email_changed.body", username=email_user_name(v.get("username")), new_email=v["new_email"])),
            Callout(th(lang, "email_changed.footer")),
        ],
        icon="shield-check",
    )


@email_template("account.deleted", category="security", samples=({},))
def account_deleted(v: dict, lang: str, brand: Brand) -> Email:
    """Goodbye after an account is deleted."""
    return Email(
        subject=tt(lang, "account_deleted.subject"),
        blocks=compact([Heading(th(lang, "account_deleted.heading")), Paragraph(th(lang, "account_deleted.body"))]),
        icon="trash",
        tone="neutral",
        reason=th(lang, "account_deleted.footer"),
    )
