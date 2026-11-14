"""One-time conversion of classic landing configs into page builder homes.

Every org ends up with a published builder home page:

* a classic custom landing (``landing.enabled`` with sections) is converted
  element by element (``convert.convert_landing``), backgrounds included;
* an org on the classic default home (no landing, landing off, or no
  sections) gets the "default" template built from its own name, description
  and courses. A classic landing that was switched off is also kept as a
  variant in the page history, so nothing typed is lost.

The old landing object is copied to ``landing_legacy_backup`` before the
config is cleared, and ``--rollback`` puts it back (and removes the home page
the job created).

Why a startup job and not an Alembic data migration:

* a data migration runs inside the deploy's schema step. One org with an odd
  config would fail it and block the whole release; here each org runs in its
  own transaction, a failure is logged and recorded, and the rest go on;
* it can be re-run safely (idempotent: orgs with a backup row are done, and
  orgs with a published home are skipped), retried per org, run for one org,
  dry-run, and rolled back, none of which a frozen migration file offers;
* the conversion is app code (the converter, templates and validator keep
  evolving); a migration would freeze a copy of it in migration history.

Replicas: each org is claimed by inserting its backup row (unique per org),
so two API pods starting together never convert the same org twice.

CLI (from apps/api)::

    python -m src.services.landing.migrate_legacy --dry-run
    python -m src.services.landing.migrate_legacy [--org ID] [--batch 50]
    python -m src.services.landing.migrate_legacy --rollback [--org ID]
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import json
import logging
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.landing_pages import LandingLegacyBackup, LandingPage
from src.db.organizations import Organization
from src.services.landing import service
from src.services.landing.convert import convert_landing
from src.services.landing.schema import validate_doc

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
STALE_RUNNING = timedelta(minutes=15)
STARTUP_DELAY_SECONDS = 20
DONE = {"converted", "default", "skipped", "rolled_back"}

_task: Optional[asyncio.Task] = None


@dataclass
class OrgResult:
    org_id: int
    slug: str = ""
    action: str = ""  # converted | default | skipped | failed | busy
    sections: int = 0
    note: str = ""


@dataclass
class Summary:
    dry_run: bool = False
    results: list[OrgResult] = field(default_factory=list)

    def counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for r in self.results:
            out[r.action] = out.get(r.action, 0) + 1
        return out

    def as_dict(self) -> dict:
        return {"dry_run": self.dry_run, "counts": self.counts(), "results": [asdict(r) for r in self.results]}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _session_factory() -> Callable[[], AsyncSession]:
    from src.core.events.database import _async_session_factory

    return _async_session_factory


def _holder(config: dict) -> dict:
    """Where the landing object lives: customization (v2) or the top (v1)."""
    if str(config.get("config_version", "1.0")).startswith("2"):
        return config.setdefault("customization", {})
    return config


async def _plan(db: AsyncSession, org: Organization) -> tuple[str, dict, Optional[dict], str]:
    """What the org gets: (action, doc, disabled-classic variant or None, note)."""
    cfg = await service._org_config(db, org.id)
    legacy = service._legacy_landing((cfg.config if cfg else None) or {})
    doc = service.legacy_doc(legacy)
    if doc is not None:
        return "converted", doc, None, ""
    note = ""
    variant = None
    if service.legacy_has_sections(legacy):
        if legacy.get("enabled"):
            note = "classic landing did not convert; default template used"
        else:
            try:
                variant = validate_doc(convert_landing(legacy))
                note = "classic landing was off; kept as a variant"
            except Exception:  # noqa: BLE001 - the variant is a bonus
                note = "classic landing was off and did not convert"
    return "default", await service.default_doc(db, org), variant, note


async def _claim(db: AsyncSession, org_id: int, legacy: Optional[dict]) -> bool:
    """Take the org for this run. False when another run has it or it is done."""
    now = _now()
    row = (await db.execute(select(LandingLegacyBackup).where(LandingLegacyBackup.org_id == org_id))).scalars().first()
    if row is None:
        db.add(LandingLegacyBackup(org_id=org_id, legacy=legacy, status="running", attempts=1, creation_date=now, update_date=now))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            return False
        return True
    retry = row.status == "failed" and row.attempts < MAX_ATTEMPTS
    stale = False
    if row.status == "running":
        try:
            stale = datetime.fromisoformat(row.update_date) < datetime.now(timezone.utc) - STALE_RUNNING
        except ValueError:
            stale = True
    if not (retry or stale):
        return False
    result = await db.execute(
        update(LandingLegacyBackup)
        .where(LandingLegacyBackup.id == row.id, LandingLegacyBackup.status == row.status, LandingLegacyBackup.update_date == row.update_date)
        .values(status="running", attempts=row.attempts + 1, update_date=now)
    )
    await db.commit()
    return bool(result.rowcount)


async def _finish(db: AsyncSession, org_id: int, *, status: str, page_uuid: str = "", error: str = "") -> None:
    await db.execute(
        update(LandingLegacyBackup)
        .where(LandingLegacyBackup.org_id == org_id)
        .values(status=status, page_uuid=page_uuid, error=error[:1000], update_date=_now())
    )


def _invalidate(org: Organization) -> None:
    try:
        from src.services.orgs.cache import invalidate_org_cache, invalidate_org_config_cache

        invalidate_org_config_cache(org.id)
        if org.slug:
            invalidate_org_cache(org.slug)
    except Exception:  # noqa: BLE001 - the cache expires on its own
        logger.debug("landing migration: cache invalidation skipped", exc_info=True)


async def migrate_org(db: AsyncSession, org: Organization, *, dry_run: bool = False) -> OrgResult:
    """Convert one org. Raises on unexpected errors (the caller isolates them)."""
    res = OrgResult(org_id=org.id, slug=org.slug or "")
    home = await service._home(db, org.id)
    if home is not None and home.published is not None:
        res.action, res.note = "skipped", "already has a published builder home"
        if not dry_run and await _claim(db, org.id, None):
            await _finish(db, org.id, status="skipped", page_uuid=home.page_uuid)
            await db.commit()
        return res

    cfg = await service._org_config(db, org.id)
    legacy = service._legacy_landing((cfg.config if cfg else None) or {})
    if not dry_run and not await _claim(db, org.id, copy.deepcopy(legacy) or None):
        res.action, res.note = "busy", "claimed by another run or already done"
        return res
    action, doc, variant, note = await _plan(db, org)
    res.action, res.sections, res.note = action, len(doc.get("root") or []), note
    if dry_run:
        return res

    page = await service._home(db, org.id)
    if page is None:
        page = service._new_page(org.id, "", "Home", doc, None)
        db.add(page)
        await db.flush()
    # A home draft someone started but never published stays as the draft.
    keep_draft = page.draft != doc and bool(page.draft.get("root") or page.draft.get("symbols"))
    now = _now()
    if not keep_draft:
        page.draft = doc
    page.published_version += 1
    page.published = doc
    page.published_at = now
    page.update_date = now
    label = "Converted from the classic landing" if action == "converted" else "Default home page"
    await service._add_version(db, page, "convert", doc, None, label=label, number=page.published_version)
    if variant is not None:
        await service._add_version(db, page, "variant", variant, None, label="Classic landing (was switched off)")
    db.add(page)

    if cfg is not None and legacy:
        config = copy.deepcopy(cfg.config or {})
        _holder(config)["landing"] = {}
        cfg.config = config
        cfg.update_date = str(datetime.now())
        db.add(cfg)

    await _finish(db, org.id, status=action, page_uuid=page.page_uuid, error=note)
    await db.commit()
    _invalidate(org)
    return res


async def _org_ids(db: AsyncSession, org_id: Optional[int], after: int, batch: int) -> list[int]:
    stmt = select(Organization.id).where(Organization.id > after).order_by(Organization.id).limit(batch)
    if org_id is not None:
        stmt = select(Organization.id).where(Organization.id == org_id)
    return list((await db.execute(stmt)).scalars().all())


async def _done_ids(db: AsyncSession, ids: list[int]) -> set[int]:
    rows = (await db.execute(
        select(LandingLegacyBackup.org_id, LandingLegacyBackup.status, LandingLegacyBackup.attempts).where(LandingLegacyBackup.org_id.in_(ids))
    )).all()
    return {r[0] for r in rows if r[1] in DONE or (r[1] == "failed" and r[2] >= MAX_ATTEMPTS)}


async def run(*, dry_run: bool = False, org_id: Optional[int] = None, batch: int = 50, session_factory: Optional[Callable[[], AsyncSession]] = None) -> Summary:
    """Convert every org that still needs it. Never raises for one org."""
    factory = session_factory or _session_factory()
    summary = Summary(dry_run=dry_run)
    after = 0
    batch = max(1, batch)
    while True:
        async with factory() as db:
            ids = await _org_ids(db, org_id, after, batch)
            done = set() if dry_run else await _done_ids(db, ids)
        if not ids:
            break
        for oid in ids:
            if oid in done:
                continue
            async with factory() as db:
                org = (await db.execute(select(Organization).where(Organization.id == oid))).scalars().first()
                if org is None:  # deleted mid-run
                    continue
                slug = org.slug or ""
                try:
                    res = await migrate_org(db, org, dry_run=dry_run)
                except Exception as e:  # noqa: BLE001 - one bad org never stops the run
                    await db.rollback()
                    logger.exception("landing migration: org %s (%s) failed", oid, slug)
                    res = OrgResult(org_id=oid, slug=slug, action="failed", note=str(e)[:300] or type(e).__name__)
                    if not dry_run:
                        try:
                            await _finish(db, oid, status="failed", error=res.note)
                            await db.commit()
                        except Exception:  # noqa: BLE001
                            logger.warning("landing migration: could not record the failure for org %s", oid, exc_info=True)
            summary.results.append(res)
            logger.info("landing migration%s: org %s (%s) %s %s", " [dry run]" if dry_run else "", res.org_id, res.slug, res.action, res.note)
        if org_id is not None or len(ids) < batch:
            break
        after = ids[-1]
    logger.info("landing migration%s done: %s", " [dry run]" if dry_run else "", summary.counts())
    return summary


async def rollback(*, org_id: Optional[int] = None, session_factory: Optional[Callable[[], AsyncSession]] = None) -> Summary:
    """Put the classic landing objects back and remove the home pages this job
    created (only when nobody published them again since)."""
    factory = session_factory or _session_factory()
    summary = Summary()
    async with factory() as db:
        stmt = select(LandingLegacyBackup).where(LandingLegacyBackup.status.in_(("converted", "default")))
        if org_id is not None:
            stmt = stmt.where(LandingLegacyBackup.org_id == org_id)
        rows = list((await db.execute(stmt)).scalars().all())
    for row in rows:
        async with factory() as db:
            res = OrgResult(org_id=row.org_id, action="rolled_back")
            try:
                backup = (await db.execute(select(LandingLegacyBackup).where(LandingLegacyBackup.id == row.id))).scalars().first()
                org = (await db.execute(select(Organization).where(Organization.id == row.org_id))).scalars().first()
                res.slug = (org.slug if org else "") or ""
                cfg = await service._org_config(db, row.org_id)
                if cfg is not None and backup.legacy:
                    config = copy.deepcopy(cfg.config or {})
                    _holder(config)["landing"] = copy.deepcopy(backup.legacy)
                    cfg.config = config
                    cfg.update_date = str(datetime.now())
                    db.add(cfg)
                page = (await db.execute(select(LandingPage).where(LandingPage.page_uuid == backup.page_uuid))).scalars().first() if backup.page_uuid else None
                if page is not None and page.published_version <= 1:
                    await db.delete(page)
                elif page is not None:
                    res.note = "home page was published again since; kept"
                backup.status = "rolled_back"
                backup.update_date = _now()
                db.add(backup)
                await db.commit()
                if org is not None:
                    _invalidate(org)
            except Exception as e:  # noqa: BLE001
                await db.rollback()
                logger.exception("landing migration rollback: org %s failed", row.org_id)
                res.action, res.note = "failed", str(e)[:300]
            summary.results.append(res)
    logger.info("landing migration rollback done: %s", summary.counts())
    return summary


async def _startup_run() -> None:
    try:
        await asyncio.sleep(STARTUP_DELAY_SECONDS)
        await run()
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001 - never takes the API down
        logger.exception("landing migration did not run; it retries on the next start")


def start_on_startup() -> None:
    """Run the conversion once in the background after startup. Never raises.
    Idle under tests and when ``LEARNHOUSE_LANDING_MIGRATION_DISABLED`` is set."""
    global _task
    try:
        if os.environ.get("TESTING") == "true" or os.environ.get("LEARNHOUSE_LANDING_MIGRATION_DISABLED"):
            return
        _task = asyncio.create_task(_startup_run())
    except Exception as exc:
        logger.warning("landing migration not started: %s", exc)


def main(argv: Optional[list[str]] = None) -> int:  # pragma: no cover - thin CLI over run()/rollback()
    parser = argparse.ArgumentParser(description="Convert classic landing configs into page builder homes.")
    parser.add_argument("--dry-run", action="store_true", help="Report what each org would get; write nothing.")
    parser.add_argument("--org", type=int, default=None, help="Only this organization id.")
    parser.add_argument("--batch", type=int, default=50)
    parser.add_argument("--rollback", action="store_true", help="Restore the classic landing objects from the backup.")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if args.rollback:
        summary = asyncio.run(rollback(org_id=args.org))
    else:
        summary = asyncio.run(run(dry_run=args.dry_run, org_id=args.org, batch=args.batch))
    print(json.dumps(summary.as_dict(), indent=2))
    return 1 if summary.counts().get("failed") else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
