"""Organization membership mail: created, deleted, invitation, joined, role changed."""

from __future__ import annotations

from src.services.email.blocks import Button, Code, Details, Heading, LinkFallback, Paragraph, Quote, chip, compact
from src.services.email.layout import Brand, Email
from src.services.email.registry import Sample, email_template
from src.services.email.safe_text import email_org_name, email_user_name
from src.services.email.templates import SAMPLE_ORG
from src.services.email.translations import t, th, tt


@email_template(
    "org.created",
    category="team",
    samples=(
        Sample({"org_name": "Northwind Academy", "dashboard_url": "https://northwind.learnhouse.app/dash",
                "trial_plan": "pro", "trial_days": 14}, "With trial"),
        Sample({"org_name": "Northwind Academy", "dashboard_url": "https://northwind.learnhouse.app/dash"}, "No trial"),
    ),
)
def org_created(v: dict, lang: str, brand: Brand) -> Email:
    """Confirmation when someone creates an organization (mentions the trial)."""
    name = email_org_name(v["org_name"])
    if v.get("trial_plan"):
        plan = str(v["trial_plan"]).replace("-", " ").title()
        body = th(lang, "org_created.body_trial", plan=plan, days=v.get("trial_days") or 0)
    else:
        body = th(lang, "org_created.body")
    return Email(
        subject=tt(lang, "org_created.subject", org_name=name),
        blocks=[
            Heading(th(lang, "org_created.heading", org_name=name)),
            Paragraph(body),
            Button(t(lang, "org_created.cta"), v["dashboard_url"]),
        ],
        icon="rocket-launch",
        tone="emerald",
        reason=th(lang, "org_created.footer"),
    )


@email_template("org.deleted", category="team", samples=({"org_name": "Northwind Academy"},))
def org_deleted(v: dict, lang: str, brand: Brand) -> Email:
    """Confirmation to the admins after an organization is deleted."""
    name = email_org_name(v["org_name"])
    return Email(
        subject=tt(lang, "org_deleted.subject", org_name=name),
        blocks=[Heading(th(lang, "org_deleted.heading", org_name=name)), Paragraph(th(lang, "org_deleted.body"))],
        icon="trash",
        reason=th(lang, "org_deleted.footer"),
    )


@email_template(
    "org.invitation",
    category="team",
    critical=True,
    samples=(
        Sample({"inviter": "grace", "signup_url": "https://northwind.learnhouse.app/signup?inviteCode=K7Q2",
                "invite_code": "K7Q2-9XPL", "role_name": "Instructor",
                "message": "Welcome aboard! Your first cohort starts Monday.\nSee you there.",
                "expires_on": "2 December 2026"}, "Full", org=SAMPLE_ORG),
        Sample({"inviter": "grace", "signup_url": "https://northwind.learnhouse.app/signup"}, "Minimal", org=SAMPLE_ORG),
    ),
)
def invitation(v: dict, lang: str, brand: Brand) -> Email:
    """An invitation into an organization, branded to it."""
    org = brand.name
    inviter = email_user_name(v.get("inviter"))
    code = v.get("invite_code")
    return Email(
        subject=tt(lang, "invitation.subject", org_name=org),
        blocks=compact([
            Heading(th(lang, "invitation.heading")),
            Paragraph(th(lang, "invitation.intro", inviter=inviter, org_name=org)),
            Quote(v["message"], th(lang, "invitation.message_label", inviter=inviter)) if v.get("message") else None,
            Details([
                (t(lang, "label.organization"), org),
                (t(lang, "label.role"), chip(v["role_name"], "sky")) if v.get("role_name") else ("", ""),
                (t(lang, "label.expires"), v.get("expires_on") or ""),
            ]),
            Paragraph(th(lang, "invitation.code_hint" if code else "invitation.no_code_hint")),
            Code(code) if code else None,
            Button(th(lang, "invitation.cta", org_name=org), v["signup_url"]),
            LinkFallback(v["signup_url"]),
        ]),
        icon="user-plus",
        tone="sky",
        reason=th(lang, "invitation.footer", inviter=inviter),
    )


@email_template(
    "org.joined",
    category="team",
    samples=(Sample({"username": "ada", "cta_url": "https://northwind.learnhouse.app/home"}, org=SAMPLE_ORG),),
)
def org_joined(v: dict, lang: str, brand: Brand) -> Email:
    """Greeting when an existing account joins an organization."""
    org = brand.name
    return Email(
        subject=tt(lang, "org_join.subject", org_name=org),
        blocks=[
            Heading(th(lang, "org_join.heading", username=email_user_name(v.get("username")))),
            Paragraph(th(lang, "org_join.body", org_name=org)),
            Button(t(lang, "org_join.cta"), v["cta_url"]),
            LinkFallback(v["cta_url"]),
        ],
        icon="users",
        tone="emerald",
        reason=th(lang, "org_join.footer", org_name=org),
    )


@email_template(
    "org.role_changed",
    category="team",
    samples=(Sample({"username": "ada", "role_name": "Maintainer", "cta_url": "https://northwind.learnhouse.app/"}, org=SAMPLE_ORG),),
)
def role_changed(v: dict, lang: str, brand: Brand) -> Email:
    """A member's role in an organization changed."""
    org = brand.name
    cta = v.get("cta_url")
    return Email(
        subject=tt(lang, "role_changed.subject", org_name=org),
        blocks=compact([
            Heading(th(lang, "role_changed.heading")),
            Paragraph(th(lang, "role_changed.body_1", username=email_user_name(v.get("username")), org_name=org,
                         role=v["role_name"])),
            Details([(t(lang, "label.organization"), org), (t(lang, "label.role"), chip(v["role_name"]))]),
            Paragraph(th(lang, "role_changed.body_2")),
            Button(th(lang, "role_changed.cta", org_name=org), cta) if cta else None,
        ]),
        icon="identification-badge",
        reason=th(lang, "role_changed.footer", org_name=org),
    )
