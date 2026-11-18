"""Billing mail from LearnHouse to an org's admins: the trial sequence and
the notice when an org moves to the Free plan."""

from __future__ import annotations

from src.services.email.blocks import BulletList, Button, Callout, Details, Heading, Paragraph
from src.services.email.layout import Brand, Email, first_sentence
from src.services.email.registry import Sample, email_template
from src.services.email.safe_text import email_org_name
from src.services.email.templates import learning
from src.services.email.translations import t, th, tt


@email_template(
    "billing.plan",
    category="billing",
    samples=(
        Sample({"stage": "trial_welcome", "org_name": "Northwind Academy", "cta_url": "https://northwind.learnhouse.app/dash/billing",
                "unsubscribe_url": "https://api.learnhouse.app/api/v1/emails/unsubscribe?token=sample",
                "copy": {"plan_name": "Pro", "days": 14}}, "Trial welcome"),
        Sample({"stage": "trial_ended", "org_name": "Northwind Academy", "cta_url": "https://northwind.learnhouse.app/dash/billing",
                "copy": {"plan_name": "Pro"}}, "Trial ended"),
    ),
)
def plan(v: dict, lang: str, brand: Brand) -> Email:
    """Platform-branded plan mail; copy under ``plan_email.<stage>.*``.

    ``unsubscribe_url`` is set for the optional trial sequence and left empty
    for account notices, which report a change and can't be opted out of.
    """
    stage = v["stage"]
    copy = {k: str(val) for k, val in (v.get("copy") or {}).items() if val is not None}
    copy["org_name"] = email_org_name(v["org_name"])
    return Email(
        subject=tt(lang, f"plan_email.{stage}.subject", **copy),
        preheader=first_sentence(tt(lang, f"plan_email.{stage}.body", **copy)),
        blocks=[
            Heading(th(lang, f"plan_email.{stage}.heading", **copy)),
            Paragraph(th(lang, f"plan_email.{stage}.body", **copy)),
            Button(th(lang, f"plan_email.{stage}.cta", **copy), v["cta_url"]),
        ],
        reason=th(lang, "plan_email.common.footer", org_name=copy["org_name"]),
        unsubscribe_url=v.get("unsubscribe_url") or "",
        unsubscribe_label=t(lang, "nudge.common.unsubscribe"),
        one_click_unsubscribe=True,
        reply_to=learning.reply_to_address(),
    )


# ── Stripe billing mail (sent by the web app's webhook through the internal
# endpoint ``POST /cloud_internal/send_billing_email``) ───────────────────


def pretty_plan(plan: str | None) -> str:
    return " ".join(w[:1].upper() + w[1:] for w in (plan or "free").split("-"))


_PLAN_SAMPLE = {"org_slug": "northwind"}


@email_template(
    "billing.plan_changed",
    category="billing",
    samples=(
        Sample({**_PLAN_SAMPLE, "old_plan": "standard", "new_plan": "pro", "is_downgrade": False}, "Upgrade"),
        Sample({**_PLAN_SAMPLE, "old_plan": "pro", "new_plan": "standard", "is_downgrade": True}, "Downgrade"),
    ),
)
def plan_changed(v: dict, lang: str, brand: Brand) -> Email:
    """The organization switched plans."""
    new, old = pretty_plan(v.get("new_plan")), pretty_plan(v.get("old_plan"))
    down = bool(v.get("is_downgrade"))
    return Email(
        subject=f"You're on {new} now",
        blocks=[
            Heading(f"You're on {new} now" if down else f"{new} is ready for your learners"),
            Paragraph("The change is done. Anything your new plan doesn't include is paused, not deleted, "
                      "and comes back if you upgrade." if down
                      else f"Everything in {new} is unlocked for your academy, starting now."),
            Details([("Previous plan", old), ("New plan", new), ("Organization", v.get("org_slug") or "")]),
        ],
        reason="You're receiving this because you manage billing for this organization on LearnHouse.",
    )


@email_template("billing.subscription_canceled", category="billing",
                samples=(Sample({**_PLAN_SAMPLE, "plan": "pro"}),))
def subscription_canceled(v: dict, lang: str, brand: Brand) -> Email:
    """The subscription will not renew."""
    plan_name = pretty_plan(v.get("plan"))
    return Email(
        subject=f"Your {plan_name} plan won't renew",
        blocks=[
            Heading("Your plan won't renew"),
            Paragraph(f"Your {plan_name} plan stays active until the end of the current billing period. "
                      "After that, your academy moves to Free. Nothing is deleted."),
            Details([("Organization", v.get("org_slug") or "")]),
            Paragraph("If you change your mind, pick a plan again from your billing settings and everything "
                      "comes back as it was."),
        ],
        reason="You're receiving this because you manage billing for this organization on LearnHouse.",
    )


@email_template("billing.purchase_complete", category="billing",
                samples=(Sample({**_PLAN_SAMPLE, "plan": "pro"}),))
def purchase_complete(v: dict, lang: str, brand: Brand) -> Email:
    """A plan purchase went through."""
    plan_name = pretty_plan(v.get("plan"))
    return Email(
        subject=f"Your {plan_name} plan is active",
        blocks=[
            Heading(f"{plan_name} is active"),
            Paragraph(f"Your payment went through and every {plan_name} feature is available to your academy now."),
            Details([("Plan", plan_name), ("Organization", v.get("org_slug") or "")]),
            BulletList([
                "Anything paused on the Free plan, like private courses, is back as it was.",
                "Invoices and plan changes are in your billing settings.",
            ]),
        ],
        reason="You're receiving this because you manage billing for this organization on LearnHouse.",
    )


@email_template("billing.pack_activated", category="billing",
                samples=(Sample({**_PLAN_SAMPLE, "pack_id": "ai-credits-1000"}),))
def pack_activated(v: dict, lang: str, brand: Brand) -> Email:
    """An add-on pack is active."""
    return Email(
        subject="Your add-on is active",
        blocks=[
            Heading("Your add-on is active"),
            Paragraph("The extra capacity is available to your academy now."),
            Details([("Add-on", v.get("pack_id") or "Pack"), ("Organization", v.get("org_slug") or "")]),
        ],
        reason="You're receiving this because you manage billing for this organization on LearnHouse.",
    )


@email_template("billing.payment_failed", category="billing",
                samples=(Sample({**_PLAN_SAMPLE, "plan": "pro"}),))
def payment_failed(v: dict, lang: str, brand: Brand) -> Email:
    """A subscription payment failed."""
    plan_name = pretty_plan(v.get("plan"))
    return Email(
        subject=f"Your {plan_name} payment didn't go through",
        blocks=[
            Heading("Your payment didn't go through"),
            Callout(f"We couldn't charge your card for {plan_name}. Your learners keep full access for now.",
                    tone="danger"),
            Paragraph("Update your payment method in your billing settings and nothing changes for them."),
            Details([("Organization", v.get("org_slug") or "")]),
        ],
        reason="You're receiving this because you manage billing for this organization on LearnHouse.",
    )


# Templates the web app may ask the API to send (allowlist for the internal endpoint).
WEB_BILLING_TEMPLATES = frozenset({
    "billing.plan_changed", "billing.subscription_canceled", "billing.purchase_complete",
    "billing.pack_activated", "billing.payment_failed",
})
