"""
Stripe dashboard data service.
Pulls live data directly from the Stripe API for the admin payments dashboard.
"""
import logging
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlmodel import Session, select

from ee.db.payments.payments import PaymentsConfig

logger = logging.getLogger(__name__)


def _get_stripe_client(org_id: int, db_session: Session):
    """Returns (stripe module, connected_account_id) or raises 404/400."""
    import stripe
    from config.config import get_learnhouse_config

    config = db_session.exec(
        select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
    ).first()

    if not config or not config.provider_specific_id or not config.active:
        raise HTTPException(status_code=404, detail="No active Stripe account configured for this org")

    lh_cfg = get_learnhouse_config()
    stripe.api_key = lh_cfg.payments_config.stripe.stripe_secret_key
    return stripe, config.provider_specific_id


def _ts(unix: int) -> str:
    return datetime.fromtimestamp(unix, tz=timezone.utc).isoformat()


def _fmt_customer(c) -> dict:
    if not c or isinstance(c, str):
        return {"id": c, "name": None, "email": None}
    return {"id": c.get("id"), "name": c.get("name"), "email": c.get("email")}


async def get_stripe_overview(org_id: int, db_session: Session) -> dict:
    stripe, acc_id = _get_stripe_client(org_id, db_session)

    # ── Active subscriptions ──────────────────────────────────────────────
    subs_active = stripe.Subscription.list(
        status="active", limit=100, stripe_account=acc_id
    )

    mrr = sum(
        (s["plan"]["amount"] / 100)
        * (12 if s["plan"]["interval"] == "year" else 1)
        / (12 if s["plan"]["interval"] == "year" else 1)
        for s in subs_active.auto_paging_iter()
        if s.get("plan")
    )

    active_sub_count = subs_active.total_count if hasattr(subs_active, "total_count") else len(subs_active.data)

    # ── All-time revenue from charges ─────────────────────────────────────
    total_revenue = 0.0
    customer_ids: set[str] = set()
    recent_charges = []

    charges_page = stripe.Charge.list(limit=100, stripe_account=acc_id)
    for i, ch in enumerate(charges_page.auto_paging_iter()):
        if ch.get("paid") and not ch.get("refunded"):
            total_revenue += ch["amount_captured"] / 100
        if ch.get("customer"):
            customer_ids.add(ch["customer"] if isinstance(ch["customer"], str) else ch["customer"]["id"])
        if i < 5:
            recent_charges.append({
                "id": ch["id"],
                "amount": ch["amount"] / 100,
                "currency": ch["currency"].upper(),
                "status": ch["status"],
                "paid": ch.get("paid"),
                "created": _ts(ch["created"]),
                "customer": _fmt_customer(ch.get("customer")),
                "description": ch.get("description"),
                "card": {
                    "brand": ch.get("payment_method_details", {}).get("card", {}).get("brand"),
                    "last4": ch.get("payment_method_details", {}).get("card", {}).get("last4"),
                } if ch.get("payment_method_details", {}).get("card") else None,
            })

    # ── Cancelled subscriptions in last 30 days (churn) ───────────────────
    import time
    since_30d = int(time.time()) - 30 * 86400
    cancelled_subs = stripe.Subscription.list(
        status="canceled",
        created={"gte": since_30d},
        limit=100,
        stripe_account=acc_id,
    )
    churn_30d = len(cancelled_subs.data)

    return {
        "mrr": round(mrr, 2),
        "arr": round(mrr * 12, 2),
        "total_revenue": round(total_revenue, 2),
        "active_subscribers": active_sub_count,
        "total_customers": len(customer_ids),
        "churn_30d": churn_30d,
        "recent_charges": recent_charges,
    }


async def get_stripe_charges(
    org_id: int,
    limit: int,
    starting_after: str | None,
    db_session: Session,
) -> dict:
    stripe, acc_id = _get_stripe_client(org_id, db_session)

    params: dict = {"limit": limit, "stripe_account": acc_id, "expand": ["data.customer"]}
    if starting_after:
        params["starting_after"] = starting_after

    page = stripe.Charge.list(**params)

    charges = []
    for ch in page.data:
        charges.append({
            "id": ch["id"],
            "amount": ch["amount"] / 100,
            "amount_refunded": ch["amount_refunded"] / 100,
            "currency": ch["currency"].upper(),
            "status": ch["status"],
            "paid": ch.get("paid"),
            "refunded": ch.get("refunded"),
            "created": _ts(ch["created"]),
            "description": ch.get("description"),
            "customer": _fmt_customer(ch.get("customer")),
            "receipt_url": ch.get("receipt_url"),
            "card": {
                "brand": ch.get("payment_method_details", {}).get("card", {}).get("brand"),
                "last4": ch.get("payment_method_details", {}).get("card", {}).get("last4"),
            } if ch.get("payment_method_details", {}).get("card") else None,
        })

    return {
        "data": charges,
        "has_more": page.has_more,
        "next_cursor": charges[-1]["id"] if charges and page.has_more else None,
    }


async def get_stripe_subscriptions(
    org_id: int,
    status: str,
    db_session: Session,
) -> dict:
    stripe, acc_id = _get_stripe_client(org_id, db_session)

    page = stripe.Subscription.list(
        status=status,
        limit=100,
        stripe_account=acc_id,
        expand=["data.customer", "data.default_payment_method"],
    )

    subs = []
    for s in page.auto_paging_iter():
        pm = s.get("default_payment_method")
        card = None
        if pm and isinstance(pm, dict) and pm.get("card"):
            card = {"brand": pm["card"].get("brand"), "last4": pm["card"].get("last4")}

        plan = s.get("plan") or (s.get("items", {}).get("data", [{}])[0].get("plan") if s.get("items") else None)

        subs.append({
            "id": s["id"],
            "status": s["status"],
            "created": _ts(s["created"]),
            "current_period_start": _ts(s["current_period_start"]),
            "current_period_end": _ts(s["current_period_end"]),
            "cancel_at_period_end": s.get("cancel_at_period_end"),
            "canceled_at": _ts(s["canceled_at"]) if s.get("canceled_at") else None,
            "customer": _fmt_customer(s.get("customer")),
            "card": card,
            "plan": {
                "amount": plan["amount"] / 100 if plan else None,
                "currency": plan["currency"].upper() if plan else None,
                "interval": plan["interval"] if plan else None,
                "nickname": plan.get("nickname") if plan else None,
            } if plan else None,
        })

    return {"data": subs, "total": len(subs)}
