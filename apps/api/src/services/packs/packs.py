import logging
from datetime import datetime
from fastapi import HTTPException
from sqlmodel import Session, select

from src.db.packs import OrgPack, PackStatusEnum, PackTypeEnum
from src.security.features_utils.packs import AVAILABLE_PACKS
from src.security.features_utils.usage import (
    _get_redis_client,
    add_ai_credits,
)

logger = logging.getLogger(__name__)


def _add_member_seats(org_id: int, amount: int) -> int:
    r = _get_redis_client()
    key = f"member_seats_purchased:{org_id}"
    return r.incrby(key, amount)


def _remove_member_seats(org_id: int, amount: int) -> int:
    r = _get_redis_client()
    key = f"member_seats_purchased:{org_id}"
    new_val = r.decrby(key, amount)
    if new_val < 0:
        logger.warning(
            "member_seats_purchased went negative for org %d (was %d, removed %d). Resetting to 0.",
            org_id, new_val + amount, amount,
        )
        r.set(key, 0)
        return 0
    return new_val


def _remove_ai_credits(org_id: int, amount: int) -> int:
    r = _get_redis_client()
    key = f"ai_credits_purchased:{org_id}"
    new_val = r.decrby(key, amount)
    if new_val < 0:
        logger.warning(
            "ai_credits_purchased went negative for org %d (was %d, removed %d). Resetting to 0.",
            org_id, new_val + amount, amount,
        )
        r.set(key, 0)
        return 0
    return new_val


def _apply_pack_credits(org_id: int, pack_def: dict):
    """Add credits/seats to Redis for an activated pack."""
    if pack_def["type"] == "ai_credits":
        add_ai_credits(org_id, pack_def["quantity"])
    elif pack_def["type"] == "member_seats":
        _add_member_seats(org_id, pack_def["quantity"])


def _revoke_pack_credits(org_id: int, pack_type: PackTypeEnum, quantity: int):
    """Remove credits/seats from Redis for a deactivated pack."""
    if pack_type == PackTypeEnum.ai_credits:
        _remove_ai_credits(org_id, quantity)
    elif pack_type == PackTypeEnum.member_seats:
        _remove_member_seats(org_id, quantity)


def activate_pack(
    org_id: int,
    pack_id: str,
    platform_subscription_id: str,
    db_session: Session,
) -> OrgPack:
    if pack_id not in AVAILABLE_PACKS:
        raise HTTPException(status_code=400, detail=f"Unknown pack_id: {pack_id}")

    pack_def = AVAILABLE_PACKS[pack_id]

    # Use SELECT ... FOR UPDATE to prevent race conditions from concurrent webhooks
    existing = db_session.exec(
        select(OrgPack)
        .where(OrgPack.platform_subscription_id == platform_subscription_id)
        .with_for_update()
    ).first()

    if existing:
        # Validate org_id matches to prevent cross-org activation
        if existing.org_id != org_id:
            logger.error(
                "Cross-org pack activation attempt: subscription %s belongs to org %d, not %d",
                platform_subscription_id, existing.org_id, org_id,
            )
            raise HTTPException(
                status_code=409,
                detail="Subscription belongs to a different organization",
            )

        if existing.status == PackStatusEnum.active:
            # Already active — idempotent success, no Redis changes
            return existing

        # Was cancelled, now reactivated via Stripe
        existing.status = PackStatusEnum.active
        existing.cancel_at_period_end = False
        existing.cancelled_at = None
        existing.activated_at = datetime.now()
        # Use the stored quantity, not the pack_def quantity (they should match,
        # but the DB record is the source of truth)
        db_session.add(existing)
        db_session.flush()

        # Add credits/seats to Redis — use stored quantity from DB record
        _apply_pack_credits(org_id, pack_def)

        db_session.commit()
        db_session.refresh(existing)
        return existing

    # Create new pack record
    org_pack = OrgPack(
        org_id=org_id,
        pack_type=PackTypeEnum(pack_def["type"]),
        pack_id=pack_id,
        quantity=pack_def["quantity"],
        status=PackStatusEnum.active,
        activated_at=datetime.now(),
        platform_subscription_id=platform_subscription_id,
    )
    db_session.add(org_pack)
    db_session.flush()

    # Add credits/seats to Redis
    _apply_pack_credits(org_id, pack_def)

    db_session.commit()
    db_session.refresh(org_pack)
    return org_pack


def deactivate_pack(
    org_id: int,
    platform_subscription_id: str,
    db_session: Session,
) -> OrgPack:
    org_pack = db_session.exec(
        select(OrgPack)
        .where(
            OrgPack.org_id == org_id,
            OrgPack.platform_subscription_id == platform_subscription_id,
        )
        .with_for_update()
    ).first()

    if not org_pack:
        raise HTTPException(
            status_code=404,
            detail="No pack found for this subscription",
        )

    # Idempotent — already cancelled
    if org_pack.status == PackStatusEnum.cancelled:
        return org_pack

    org_pack.status = PackStatusEnum.cancelled
    org_pack.cancelled_at = datetime.now()
    db_session.add(org_pack)
    db_session.flush()

    # Remove credits/seats from Redis
    _revoke_pack_credits(org_id, org_pack.pack_type, org_pack.quantity)

    db_session.commit()
    db_session.refresh(org_pack)
    return org_pack


def deactivate_all_packs_for_org(
    org_id: int,
    db_session: Session,
) -> int:
    """Deactivate all active packs for an org. Returns count of deactivated packs."""
    active_packs = list(db_session.exec(
        select(OrgPack)
        .where(OrgPack.org_id == org_id, OrgPack.status == PackStatusEnum.active)
        .with_for_update()
    ).all())

    count = 0
    for pack in active_packs:
        pack.status = PackStatusEnum.cancelled
        pack.cancelled_at = datetime.now()
        db_session.add(pack)
        _revoke_pack_credits(org_id, pack.pack_type, pack.quantity)
        count += 1

    if count > 0:
        db_session.commit()

    return count


def mark_pack_canceling(
    org_id: int,
    platform_subscription_id: str,
    db_session: Session,
) -> OrgPack:
    org_pack = db_session.exec(
        select(OrgPack).where(
            OrgPack.org_id == org_id,
            OrgPack.platform_subscription_id == platform_subscription_id,
            OrgPack.status == PackStatusEnum.active,
        )
    ).first()

    if not org_pack:
        raise HTTPException(
            status_code=404,
            detail="No active pack found for this subscription",
        )

    org_pack.cancel_at_period_end = True
    db_session.add(org_pack)
    db_session.commit()
    db_session.refresh(org_pack)

    return org_pack


def get_org_active_packs(org_id: int, db_session: Session) -> list[OrgPack]:
    return list(db_session.exec(
        select(OrgPack).where(
            OrgPack.org_id == org_id,
            OrgPack.status == PackStatusEnum.active,
        )
    ).all())


def reconcile_pack_credits(db_session: Session) -> dict:
    """
    Rebuild Redis purchased credits/seats from OrgPack DB records.
    Call this on API startup to ensure Redis matches DB state.
    Returns a summary of what was reconciled.
    """

    # Get all active packs grouped by org
    active_packs = list(db_session.exec(
        select(OrgPack).where(OrgPack.status == PackStatusEnum.active)
    ).all())

    # Aggregate by org_id
    org_totals: dict[int, dict[str, int]] = {}
    for pack in active_packs:
        if pack.org_id not in org_totals:
            org_totals[pack.org_id] = {"ai_credits": 0, "member_seats": 0}
        if pack.pack_type == PackTypeEnum.ai_credits:
            org_totals[pack.org_id]["ai_credits"] += pack.quantity
        elif pack.pack_type == PackTypeEnum.member_seats:
            org_totals[pack.org_id]["member_seats"] += pack.quantity

    r = _get_redis_client()
    reconciled = {"orgs": 0, "ai_credits_fixed": 0, "member_seats_fixed": 0}

    for org_id, totals in org_totals.items():
        # Reconcile AI credits
        current_ai = int(r.get(f"ai_credits_purchased:{org_id}") or 0)
        if current_ai != totals["ai_credits"]:
            r.set(f"ai_credits_purchased:{org_id}", totals["ai_credits"])
            logger.info(
                "Reconciled ai_credits_purchased for org %d: %d -> %d",
                org_id, current_ai, totals["ai_credits"],
            )
            reconciled["ai_credits_fixed"] += 1

        # Reconcile member seats
        current_seats = int(r.get(f"member_seats_purchased:{org_id}") or 0)
        if current_seats != totals["member_seats"]:
            r.set(f"member_seats_purchased:{org_id}", totals["member_seats"])
            logger.info(
                "Reconciled member_seats_purchased for org %d: %d -> %d",
                org_id, current_seats, totals["member_seats"],
            )
            reconciled["member_seats_fixed"] += 1

        reconciled["orgs"] += 1

    # Also zero out Redis keys for orgs that have NO active packs
    # but might still have stale Redis values
    for key_pattern, credit_type in [
        ("ai_credits_purchased:*", "ai_credits_fixed"),
        ("member_seats_purchased:*", "member_seats_fixed"),
    ]:
        for key in r.scan_iter(match=key_pattern):
            org_id_str = key.decode().split(":")[-1]
            try:
                org_id = int(org_id_str)
            except ValueError:
                continue
            if org_id not in org_totals:
                current_val = int(r.get(key) or 0)
                if current_val != 0:
                    r.set(key, 0)
                    logger.info(
                        "Zeroed stale %s for org %d (was %d, no active packs)",
                        key.decode(), org_id, current_val,
                    )
                    reconciled[credit_type] += 1

    logger.info("Pack credit reconciliation complete: %s", reconciled)
    return reconciled


def get_org_pack_summary(org_id: int, db_session: Session) -> dict:
    active_packs = get_org_active_packs(org_id, db_session)

    total_ai_credits = sum(
        p.quantity for p in active_packs if p.pack_type == PackTypeEnum.ai_credits
    )
    total_member_seats = sum(
        p.quantity for p in active_packs if p.pack_type == PackTypeEnum.member_seats
    )

    return {
        "ai_credits": total_ai_credits,
        "member_seats": total_member_seats,
        "active_pack_count": len(active_packs),
    }
