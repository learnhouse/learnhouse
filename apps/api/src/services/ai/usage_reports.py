"""Reports over the AI usage ledger (``ai_usage_event``).

``org_usage`` feeds an organization's usage page (credits by feature, by member,
by day). ``platform_costs`` feeds the platform console's AI costs view: provider
cost against credits charged, per feature, per org and per day, with the margin.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.ai_usage import AIUsageEvent
from src.services.ai import pricing

MAX_DAYS = 366

# Low-balance thresholds (percent of the org's total credits left).
LOW_BALANCE_PCT = 20
CRITICAL_BALANCE_PCT = 5


def balance_state(remaining: Any, total: Any) -> dict[str, Any]:
    """``ok`` / ``low`` (<= 20% left) / ``critical`` (<= 5%) / ``empty`` / ``unlimited``."""
    if not isinstance(total, int) or not isinstance(remaining, int):
        return {"state": "unlimited", "remaining_pct": None}
    if total <= 0 or remaining <= 0:
        return {"state": "empty", "remaining_pct": 0.0}
    pct = round(remaining / total * 100, 1)
    if pct <= CRITICAL_BALANCE_PCT:
        state = "critical"
    elif pct <= LOW_BALANCE_PCT:
        state = "low"
    else:
        state = "ok"
    return {"state": state, "remaining_pct": pct}


def _window(days: int) -> tuple[datetime, datetime]:
    days = max(1, min(int(days), MAX_DAYS))
    end = datetime.now(timezone.utc)
    return end - timedelta(days=days), end


def _label(key: str) -> str:
    fp = pricing.FEATURES.get(key)
    return fp.label if fp else key


async def org_usage(db: AsyncSession, org_id: int, *, days: int = 30) -> dict[str, Any]:
    """Credits used by feature, by member and by day for one organization."""
    start, end = _window(days)
    base = (AIUsageEvent.org_id == org_id, AIUsageEvent.created_at >= start)

    feat_rows = (
        await db.execute(
            select(
                AIUsageEvent.feature,
                func.coalesce(func.sum(AIUsageEvent.credits), 0),
                func.count(AIUsageEvent.id),
            )
            .where(*base)
            .group_by(AIUsageEvent.feature)
        )
    ).all()
    by_feature = sorted(
        (
            {"feature": f, "label": _label(f), "credits": int(c or 0), "requests": int(n or 0)}
            for f, c, n in feat_rows
        ),
        key=lambda r: -r["credits"],
    )

    member_rows = (
        await db.execute(
            select(
                AIUsageEvent.user_id,
                func.coalesce(func.sum(AIUsageEvent.credits), 0),
                func.count(AIUsageEvent.id),
            )
            .where(*base)
            .group_by(AIUsageEvent.user_id)
        )
    ).all()
    users = await _users(db, [u for u, _, _ in member_rows if u])
    by_member = sorted(
        (
            {
                "user_id": u,
                **(users.get(u) or {"username": None, "first_name": None, "last_name": None, "avatar_image": None, "user_uuid": None}),
                "credits": int(c or 0),
                "requests": int(n or 0),
            }
            for u, c, n in member_rows
        ),
        key=lambda r: -r["credits"],
    )

    day = func.date(AIUsageEvent.created_at)
    day_rows = (
        await db.execute(
            select(day, AIUsageEvent.feature, func.coalesce(func.sum(AIUsageEvent.credits), 0))
            .where(*base)
            .group_by(day, AIUsageEvent.feature)
            .order_by(day)
        )
    ).all()
    by_day: dict[str, dict[str, Any]] = {}
    for d, f, c in day_rows:
        key = d.isoformat() if hasattr(d, "isoformat") else str(d)[:10]
        entry = by_day.setdefault(key, {"date": key, "credits": 0, "by_feature": {}})
        entry["credits"] += int(c or 0)
        entry["by_feature"][f] = entry["by_feature"].get(f, 0) + int(c or 0)

    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "days": (end - start).days,
        "total_credits": sum(r["credits"] for r in by_feature),
        "total_requests": sum(r["requests"] for r in by_feature),
        "by_feature": by_feature,
        "by_member": by_member,
        "by_day": list(by_day.values()),
    }


async def _users(db: AsyncSession, ids: list[int]) -> dict[int, dict[str, Any]]:
    if not ids:
        return {}
    from src.db.users import User

    rows = (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    return {
        u.id: {
            "username": u.username,
            "first_name": u.first_name,
            "last_name": u.last_name,
            "avatar_image": getattr(u, "avatar_image", None),
            "user_uuid": getattr(u, "user_uuid", None),
        }
        for u in rows
    }


def _row_cost(cost_micros: Any) -> float:
    return round(int(cost_micros or 0) / 1_000_000, 6)


def _margin(credits: int, cost: float) -> dict[str, Any]:
    value = credits * pricing.CREDIT_VALUE_USD
    return {
        "credits": credits,
        "value_usd": round(value, 4),
        "cost_usd": round(cost, 6),
        "margin_multiple": pricing.margin_multiple(credits, cost),
        "gross_margin_pct": pricing.gross_margin_pct(credits, cost),
        "below_floor": cost > 0 and value < cost * pricing.MARGIN_FLOOR,
    }


async def platform_costs(
    db: AsyncSession, *, days: int = 30, org_id: Optional[int] = None, feature: Optional[str] = None
) -> dict[str, Any]:
    """Provider cost vs credits charged, by feature, by org and by day."""
    start, end = _window(days)
    cond = [AIUsageEvent.created_at >= start]
    if org_id is not None:
        cond.append(AIUsageEvent.org_id == org_id)
    if feature:
        cond.append(AIUsageEvent.feature == feature)

    def agg():
        return (
            func.coalesce(func.sum(AIUsageEvent.credits), 0),
            func.coalesce(func.sum(AIUsageEvent.cost_micros), 0),
            func.count(AIUsageEvent.id),
        )

    feat_rows = (await db.execute(select(AIUsageEvent.feature, *agg()).where(*cond).group_by(AIUsageEvent.feature))).all()
    by_feature = []
    for f, c, m, n in feat_rows:
        fp = pricing.FEATURES.get(f)
        by_feature.append(
            {
                "feature": f,
                "label": _label(f),
                "requests": int(n or 0),
                "published_credits": fp.credits if fp else None,
                "metered": fp.metered if fp else None,
                **_margin(int(c or 0), _row_cost(m)),
            }
        )
    by_feature.sort(key=lambda r: -r["cost_usd"])

    org_rows = (
        await db.execute(
            select(AIUsageEvent.org_id, *agg()).where(*cond).group_by(AIUsageEvent.org_id)
            .order_by(func.sum(AIUsageEvent.cost_micros).desc()).limit(50)
        )
    ).all()
    names = await _org_names(db, [o for o, *_ in org_rows])
    by_org = [
        {"org_id": o, "org_name": names.get(o), "requests": int(n or 0), **_margin(int(c or 0), _row_cost(m))}
        for o, c, m, n in org_rows
    ]

    day = func.date(AIUsageEvent.created_at)
    day_rows = (await db.execute(select(day, *agg()).where(*cond).group_by(day).order_by(day))).all()
    by_day = [
        {"date": d.isoformat() if hasattr(d, "isoformat") else str(d)[:10], "requests": int(n or 0), **_margin(int(c or 0), _row_cost(m))}
        for d, c, m, n in day_rows
    ]

    total_credits = sum(r["credits"] for r in by_feature)
    total_cost = sum(r["cost_usd"] for r in by_feature)
    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "totals": {"requests": sum(r["requests"] for r in by_feature), **_margin(total_credits, total_cost)},
        "by_feature": by_feature,
        "by_org": by_org,
        "by_day": by_day,
        "pricing": pricing.pricing_summary(),
        "unmetered": unmetered_calls(days=min(days, 90)),
    }


def unmetered_calls(*, days: int = 30) -> list[dict[str, Any]]:
    """Model calls no charge covered (free paths), by model, from Redis."""
    try:
        from src.security.features_utils.usage import _get_redis_client

        r = _get_redis_client()
    except Exception:
        return []
    totals: dict[str, dict[str, Any]] = {}
    today = datetime.now(timezone.utc)
    for i in range(max(1, min(days, 90))):
        key = f"ai_unmetered:{(today - timedelta(days=i)).strftime('%Y%m%d')}"
        try:
            raw = r.hgetall(key) or {}
        except Exception:
            return []
        for k, v in raw.items():
            k = k.decode() if isinstance(k, (bytes, bytearray)) else str(k)
            model, _, field = k.rpartition(":")
            row = totals.setdefault(model, {"model": model, "calls": 0, "cost_usd": 0.0})
            if field == "calls":
                row["calls"] += int(v)
            elif field == "cost_micros":
                row["cost_usd"] = round(row["cost_usd"] + int(v) / 1_000_000, 6)
    return sorted(totals.values(), key=lambda r: -r["cost_usd"])


async def _org_names(db: AsyncSession, ids: list[int]) -> dict[int, str]:
    if not ids:
        return {}
    from src.db.organizations import Organization

    rows = (await db.execute(select(Organization.id, Organization.name).where(Organization.id.in_(ids)))).all()
    return {i: n for i, n in rows}


async def features_below_floor(db: AsyncSession, *, days: int = 7, min_requests: int = 20) -> list[dict[str, Any]]:
    """Features whose real margin over the window is under the floor (alerts)."""
    data = await platform_costs(db, days=days)
    return [
        r for r in data["by_feature"]
        if r["below_floor"] and r["requests"] >= min_requests
        and not getattr(pricing.FEATURES.get(r["feature"]), "absorbed", False)
    ]
