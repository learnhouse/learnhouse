"""
The nudge send loop and its guardrails.

Ordering here is deliberate. The ledger row is written *before* the provider is
called, so a process that dies mid-send loses one email rather than sending it
twice on the next run. Every other guard is a cheap check in front of that.

Defaults are conservative on purpose: the kill switch is off, the deployment
gate is SaaS-only, and the per-run budget is finite. Merging this code sends
nothing until somebody deliberately turns it on.
"""

import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func
from sqlmodel import select

from src.core.deployment_mode import get_deployment_mode
from src.db.nudges import NudgeSend, NudgeSendStatus
from src.services.email.utils import get_media_base_url
from src.services.nudges import links
from src.services.nudges.catalog import NudgeSpec, matching_specs, next_plan
from src.services.nudges.eligibility import iter_snapshots
from src.services.nudges.preferences import get_opted_out_user_ids
from src.services.nudges.snapshot import AdminRow, OrgSnapshot
from src.services.users.emails import send_nudge_email

logger = logging.getLogger(__name__)

# An admin hears from us at most this often, across every org they administer.
# Someone who runs three organizations should not receive triple the mail.
WEEKLY_CAP = 2
# The gap is the binding constraint, not a separate daily cap: two days between
# sends already implies at most one a day, so a daily cap would be dead weight.
MIN_GAP_HOURS = 48

# Blast radius fuse. Reached, the run stops and logs what it deferred; nothing
# was claimed, so those candidates are simply reconsidered tomorrow.
DEFAULT_MAX_SENDS = 500

# The only tracks allowed to reach organizations that predate this system.
# Both exist for exactly that audience; everything else is bounded by day_max
# and could not reach them anyway.
BACKFILL_TRACKS = frozenset({"dormancy", "reactivation"})

# Long-dormant organizations are a different audience from someone who signed
# up on Tuesday: there is no ongoing relationship to pace, and the sequence
# only works if its steps land close enough together to read as a sequence.
# These override the ordinary caps for orgs that predate the start date.
LEGACY_WEEKLY_CAP = 7
LEGACY_MIN_GAP_HOURS = 20


def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def nudges_enabled() -> bool:
    return _flag("LEARNHOUSE_NUDGES_ENABLED", False)


def backfill_mode() -> str:
    """``off`` | ``winback`` | ``full``.

    ``full`` exists only as an escape hatch and is not a supported setting —
    it would evaluate the entire catalog against years of history.
    """
    return (os.environ.get("LEARNHOUSE_NUDGES_BACKFILL_MODE") or "off").strip().lower()


async def _ledger_has_rows(db_session: AsyncSession) -> bool:
    return (
        await db_session.execute(select(func.count()).select_from(NudgeSend))
    ).scalar_one() > 0


async def activation_date(db_session: AsyncSession) -> datetime:
    """When this system started running here.

    Orgs created before it are "pre-existing" and only the winback tracks may
    reach them. Derived from the ledger rather than configured: the first row —
    written by `nudges-seed`, or by the first live send — *is* the boundary,
    so there is no date to remember to set and no way to set it wrongly.

    An empty ledger means nothing has run here yet, so every existing org
    predates the system and only the winback tracks may reach it. Running
    `nudges-seed` is what pins the boundary and lets ordinary tracks start
    applying to organizations created from then on.
    """
    earliest = (
        await db_session.execute(select(func.min(NudgeSend.claimed_at)))
    ).scalar_one_or_none()
    if earliest is None:
        return datetime.now(timezone.utc)
    return earliest if earliest.tzinfo else earliest.replace(tzinfo=timezone.utc)


@dataclass
class RunStats:
    considered: int = 0
    sent: int = 0
    skipped_dedupe: int = 0
    skipped_cap: int = 0
    skipped_optout: int = 0
    skipped_backfill: int = 0
    skipped_inactive_org: int = 0
    failed: int = 0
    budget_exhausted: bool = False
    # True when this run seeded the backlog rather than sending, which happens
    # once, automatically, the first time the job runs anywhere.
    auto_seeded: bool = False
    by_nudge: dict = field(default_factory=dict)

    def record(self, nudge_id: str) -> None:
        self.by_nudge[nudge_id] = self.by_nudge.get(nudge_id, 0) + 1

    def as_dict(self) -> dict:
        return {
            "considered": self.considered,
            "sent": self.sent,
            "failed": self.failed,
            "skipped_dedupe": self.skipped_dedupe,
            "skipped_cap": self.skipped_cap,
            "skipped_optout": self.skipped_optout,
            "skipped_backfill": self.skipped_backfill,
            "skipped_inactive_org": self.skipped_inactive_org,
            "budget_exhausted": self.budget_exhausted,
            "auto_seeded": self.auto_seeded,
            "by_nudge": dict(sorted(self.by_nudge.items())),
        }


def dedupe_key(spec: NudgeSpec, org_id: int, user_id: int, now: datetime, dry_run: bool) -> str:
    """The idempotency boundary.

    A dry run uses a separate namespace so a rehearsal never consumes the key
    that the real send will need.
    """
    key = f"{spec.id}:{org_id}:{user_id}"
    if spec.repeat == "quarterly":
        key = f"{key}:{now.year}-Q{(now.month - 1) // 3 + 1}"
    elif spec.repeat == "monthly":
        key = f"{key}:{now.year}-{now.month:02d}"
    return f"dryrun:{key}" if dry_run else key


def _is_preexisting(snapshot: OrgSnapshot, cutoff: datetime) -> bool:
    """Whether this org predates the system running here."""
    if snapshot.created_at is None:
        return False
    return snapshot.created_at < cutoff


def _backfill_allows(spec: NudgeSpec, snapshot: OrgSnapshot, cutoff: datetime) -> bool:
    """Whether a spec may reach an organization older than this system.

    This is the structural half of the backfill guard — the other half is
    ``day_max`` on every spec, which already excludes old orgs from the
    recency-anchored tracks. Together they mean the worst case for a long
    dormant org on day one is one email, not the whole catalog.
    """
    if not _is_preexisting(snapshot, cutoff):
        return True
    mode = backfill_mode()
    if mode == "full":
        return True
    if mode == "winback":
        return spec.track in BACKFILL_TRACKS
    return False


async def _recent_send_counts(
    db_session: AsyncSession, user_ids: list[int], now: datetime
) -> dict[int, tuple[int, Optional[datetime]]]:
    """Sends per user in the trailing week, in one query for the whole batch."""
    if not user_ids:
        return {}

    rows = (
        await db_session.execute(
            select(NudgeSend.user_id, NudgeSend.sent_at).where(
                NudgeSend.user_id.in_(user_ids),
                NudgeSend.status == NudgeSendStatus.SENT,
                NudgeSend.sent_at.is_not(None),
                NudgeSend.sent_at >= now - timedelta(days=7),
            )
        )
    ).all()

    counts: dict[int, tuple[int, Optional[datetime]]] = {}
    for user_id, sent_at in rows:
        count, latest = counts.get(user_id, (0, None))
        stamp = sent_at if sent_at.tzinfo else sent_at.replace(tzinfo=timezone.utc)
        counts[user_id] = (count + 1, max(latest, stamp) if latest else stamp)
    return counts


def _cap_blocks(
    counts: dict[int, tuple[int, Optional[datetime]]],
    user_id: int,
    now: datetime,
    weekly_cap: int,
    min_gap_hours: int = MIN_GAP_HOURS,
) -> bool:
    count, latest = counts.get(user_id, (0, None))
    if count >= weekly_cap:
        return True
    if latest is not None and (now - latest) < timedelta(hours=min_gap_hours):
        return True
    return False


# Which figures are worth showing per track. Keys resolve to `nudge.stat.<key>`
# labels; the value beside them is a bare number, so no locale has to solve
# plural agreement.
TRACK_STATS: dict[str, tuple[str, ...]] = {
    "content": ("chapters", "lessons"),
    "audience": ("members", "learners"),
    "dormancy": ("courses", "lessons"),
    "milestone": ("learners", "completed"),
    # The whole message is "your work is still here" — the figures say it
    # faster than the sentence does.
    "reactivation": ("courses", "lessons"),
    # activation: an empty org has nothing but zeros, and a row of them reads
    # as an accusation rather than a prompt.
    # monetization: the plan and its ceiling are already the subject of the copy.
}


def _stats_for(spec: NudgeSpec, snapshot: OrgSnapshot) -> list[tuple[str, int]]:
    """Figures to show beneath the copy, or [] when none would help."""
    available = {
        "courses": snapshot.course_count,
        "chapters": snapshot.chapter_count,
        "lessons": snapshot.activity_count,
        "members": snapshot.member_count,
        "learners": snapshot.learner_count,
        "completed": snapshot.completed_trailrun_count,
    }
    keys = TRACK_STATS.get(spec.track, ())
    stats = [(key, available[key]) for key in keys]
    # All-zero tells the reader nothing they did not already know.
    return stats if any(value for _key, value in stats) else []


def _copy_vars(snapshot: OrgSnapshot, spec: NudgeSpec) -> dict:
    """Placeholder values for a nudge's copy.

    Plan names and tiers are resolved here rather than written into the
    translation strings, because the limits and hierarchy live in one place and
    change without anyone remembering the emails.
    """
    course_name = (
        snapshot.oldest_draft_course_name
        or snapshot.newest_course_name
        or snapshot.org_name
    )
    # org_name is deliberately absent: send_nudge_email takes it as a named
    # argument, and repeating it here collides with that parameter.
    return {
        "course_name": course_name,
        "plan_name": snapshot.plan,
        "next_plan": next_plan(snapshot.plan) or "",
    }


async def _claim(
    db_session: AsyncSession,
    spec: NudgeSpec,
    snapshot: OrgSnapshot,
    admin: AdminRow,
    key: str,
    now: datetime,
    dry_run: bool,
) -> Optional[NudgeSend]:
    """Insert the ledger row. Returns None when someone already holds the key.

    The unique constraint, not the preceding read, is what makes this safe:
    two runs racing the same tick collide in the database rather than in
    someone's inbox.
    """
    row = NudgeSend(
        nudge_id=spec.id,
        dedupe_key=key,
        org_id=snapshot.org_id,
        user_id=admin.user_id,
        status=NudgeSendStatus.DRY_RUN if dry_run else NudgeSendStatus.CLAIMED,
        lang=snapshot.lang,
        claimed_at=now,
        meta={
            # The recipient, so a delivery check days later knows which
            # address to suppress without re-deriving it.
            "email": admin.email,
            "track": spec.track,
            "plan": snapshot.plan,
            "course_count": snapshot.course_count,
            "published_course_count": snapshot.published_course_count,
            "member_count": snapshot.member_count,
        },
    )
    db_session.add(row)
    try:
        await db_session.commit()
    except IntegrityError:
        await db_session.rollback()
        return None
    return row


async def _record_sent(spec: NudgeSpec, snapshot: OrgSnapshot, admin: AdminRow) -> None:
    """Emit an analytics event for one delivered nudge.

    Without this there is no way to tell which of the catalog earns its place —
    the ledger records that mail went out, not whether it brought anyone back.
    Failures are swallowed: analytics must never be the reason a send loop dies.
    """
    try:
        from src.services.analytics.analytics import track
        from src.services.analytics.events import NUDGE_SENT

        await track(
            event_name=NUDGE_SENT,
            org_id=snapshot.org_id,
            user_id=admin.user_id,
            properties={
                "nudge_id": spec.id,
                "track": spec.track,
                "plan": snapshot.plan,
                "lang": snapshot.lang,
            },
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Nudge analytics event not recorded: %s", exc)


async def run_nudges(
    db_session: AsyncSession,
    *,
    dry_run: bool = False,
    max_sends: Optional[int] = None,
    only: Optional[str] = None,
    org_id: Optional[int] = None,
    now: Optional[datetime] = None,
    force: bool = False,
    seed: bool = False,
) -> RunStats:
    """Evaluate every organization and send what is due.

    ``seed`` writes suppressed ledger rows instead of sending, permanently
    consuming those dedupe keys. Run once before switching the system on, so
    the first live run does not fire a backlog of everything that happens to be
    true today.
    """
    stats = RunStats()
    now = now or datetime.now(timezone.utc)
    max_sends = max_sends if max_sends is not None else DEFAULT_MAX_SENDS
    cutoff = await activation_date(db_session)

    if not force and get_deployment_mode() != "saas":
        logger.info("Nudges skipped: deployment mode is not saas")
        return stats

    if not force and not dry_run and not seed and not nudges_enabled():
        logger.info("Nudges skipped: LEARNHOUSE_NUDGES_ENABLED is not set")
        return stats

    # First run here: seed instead of sending. Seeding consumes the dedupe
    # keys for everything that happens to be true today, so switching the
    # system on cannot fire a backlog accumulated over the org's whole life.
    # Doing it automatically means there is no prerequisite step to forget.
    if not seed and not dry_run and not await _ledger_has_rows(db_session):
        logger.info("First nudge run here — seeding the backlog instead of sending")
        seeded = await run_nudges(
            db_session, seed=True, now=now, org_id=org_id, force=True
        )
        seeded.auto_seeded = True
        return seeded

    # Ask the provider what became of recent messages before sending more.
    # This is what lets bounces and complaints be noticed without a webhook.
    try:
        from src.services.nudges.delivery import reconcile_delivery

        await reconcile_delivery(db_session, now=now)
    except Exception as exc:
        logger.warning("Delivery reconcile skipped: %s", exc)

    media_base = get_media_base_url(None)

    async for snapshot in iter_snapshots(db_session, now=now, org_id=org_id):
        if stats.sent >= max_sends:
            stats.budget_exhausted = True
            logger.info("Nudge budget of %s reached; deferring the rest", max_sends)
            break

        if not snapshot.org_active_flag:
            stats.skipped_inactive_org += 1
            continue

        admins = snapshot.mailable_admins
        if not admins:
            continue

        specs = matching_specs(snapshot)
        if only:
            specs = [s for s in specs if s.id == only]
        if not specs:
            continue

        opted_out = await get_opted_out_user_ids(db_session, [a.user_id for a in admins])
        counts = await _recent_send_counts(
            db_session, [a.user_id for a in admins], now
        )

        base_url = await links.org_base_url(
            snapshot.org_slug, db_session, snapshot.org_id
        )

        for admin in admins:
            if stats.sent >= max_sends:
                stats.budget_exhausted = True
                break

            if admin.user_id in opted_out:
                stats.skipped_optout += 1
                continue

            # An org that predates the system gets the looser pacing: there is
            # no ongoing relationship to protect, and the reactivation ladder
            # only reads as a sequence if its steps arrive close together.
            cap, gap = (
                (LEGACY_WEEKLY_CAP, LEGACY_MIN_GAP_HOURS)
                if _is_preexisting(snapshot, cutoff)
                else (WEEKLY_CAP, MIN_GAP_HOURS)
            )
            if not seed and _cap_blocks(counts, admin.user_id, now, cap, gap):
                stats.skipped_cap += 1
                continue

            # At most one nudge per admin per run: the highest-priority spec
            # takes the slot and the rest wait for another day.
            for spec in specs:
                stats.considered += 1

                # Seeding deliberately ignores the backfill gate: its whole
                # job is to consume the keys for everything true today, and a
                # key left unconsumed is one that fires on the first live run.
                if not seed and not _backfill_allows(spec, snapshot, cutoff):
                    stats.skipped_backfill += 1
                    continue

                key = dedupe_key(spec, snapshot.org_id, admin.user_id, now, dry_run)
                row = await _claim(
                    db_session, spec, snapshot, admin, key, now, dry_run or seed
                )
                if row is None:
                    stats.skipped_dedupe += 1
                    continue

                if seed:
                    row.status = NudgeSendStatus.SUPPRESSED
                    db_session.add(row)
                    await db_session.commit()
                    break

                if dry_run:
                    stats.record(spec.id)
                    logger.info(
                        "[dry-run] %s -> %s (org %s)", spec.id, admin.email, snapshot.org_slug
                    )
                    break

                logo_url = None
                if snapshot.logo_image and snapshot.org_uuid and media_base:
                    logo_url = (
                        f"{media_base}/content/orgs/{snapshot.org_uuid}"
                        f"/logos/{snapshot.logo_image}"
                    )

                result = send_nudge_email(
                    nudge_id=spec.id,
                    email=admin.email,
                    org_name=snapshot.org_name,
                    cta_url=spec.cta(snapshot, base_url),
                    unsubscribe_url=links.unsubscribe_url(media_base, admin.user_uuid),
                    lang=snapshot.lang,
                    logo_url=logo_url,
                    has_cta=spec.has_cta,
                    track=spec.track,
                    stats=_stats_for(spec, snapshot),
                    **_copy_vars(snapshot, spec),
                )

                if result is False:
                    row.status = NudgeSendStatus.FAILED
                    row.error = "provider rejected or unavailable"
                    stats.failed += 1
                else:
                    row.status = NudgeSendStatus.SENT
                    row.sent_at = now
                    if isinstance(result, dict) and result.get("id"):
                        row.provider_id = str(result["id"])
                    stats.sent += 1
                    stats.record(spec.id)
                    counts[admin.user_id] = (
                        counts.get(admin.user_id, (0, None))[0] + 1,
                        now,
                    )
                    await _record_sent(spec, snapshot, admin)

                db_session.add(row)
                await db_session.commit()
                break

    return stats
