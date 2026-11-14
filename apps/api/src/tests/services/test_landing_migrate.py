"""The one-time conversion of classic landing configs into builder home pages
(src/services/landing/migrate_legacy.py): dry run, conversion, the default
template, skips, per-org failure isolation and retries, replica claims,
idempotency and rollback."""

import asyncio
import copy
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.landing_pages import LandingLegacyBackup, LandingPage, LandingPageVersion
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.services.landing import migrate_legacy as mig
from src.services.landing import service

NOW = str(datetime.now())
LEGACY = {
    "enabled": True,
    "sections": [
        {"type": "hero", "title": "Hero", "background": {"type": "solid", "color": "#000000"}, "heading": {"text": "Old hero", "color": "#ffffff"},
         "subheading": {"text": "Sub", "color": "#eeeeee"}, "buttons": []},
        {"type": "faq", "title": "FAQ", "items": [{"question": "Q", "answer": "A"}]},
    ],
    "settings": {"background": {"type": "gradient", "colors": ["#000000", "#ffffff"], "direction": "90deg"}},
}


@pytest.fixture
def factory(engine):
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def _org(db, oid, slug, config=None):
    o = Organization(id=oid, name=f"Org {oid}", slug=slug, email=f"{slug}@x.io", org_uuid=f"org_{slug}", creation_date=NOW, update_date=NOW)
    db.add(o)
    if config is not None:
        db.add(OrganizationConfig(org_id=oid, config=config, creation_date=NOW, update_date=NOW))
    await db.commit()
    return o


@pytest.fixture
async def orgs(db):
    """Every classic shape: custom landing (v2), nothing, switched off (v1),
    and an org that already published a builder home."""
    await _org(db, 1, "custom", {"config_version": "2.0", "customization": {"landing": copy.deepcopy(LEGACY)}})
    await _org(db, 2, "plain")
    await _org(db, 3, "off", {"config_version": "1.4", "landing": {**copy.deepcopy(LEGACY), "enabled": False}})
    o4 = await _org(db, 4, "built", {"config_version": "2.0", "customization": {"landing": copy.deepcopy(LEGACY)}})
    page = service._new_page(o4.id, "", "Home", service.validate_doc({"root": []}), None)
    page.published = page.draft
    page.published_version = 3
    db.add(page)
    await db.commit()


async def _cfg(db, oid):
    return (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == oid).execution_options(populate_existing=True))).scalars().first()


async def _backup(db, oid):
    return (await db.execute(select(LandingLegacyBackup).where(LandingLegacyBackup.org_id == oid).execution_options(populate_existing=True))).scalars().first()


async def _home(db, oid):
    return (await db.execute(select(LandingPage).where(LandingPage.org_id == oid, LandingPage.slug == "").execution_options(populate_existing=True))).scalars().first()


async def test_dry_run_reports_and_writes_nothing(db, orgs, factory):
    summary = await mig.run(dry_run=True, session_factory=factory)
    got = {r.slug: (r.action, r.sections) for r in summary.results}
    assert got == {"custom": ("converted", 2), "plain": ("default", 2), "off": ("default", 2), "built": ("skipped", 0)}
    assert summary.as_dict()["counts"] == {"converted": 1, "default": 2, "skipped": 1} and summary.as_dict()["dry_run"]
    assert "kept as a variant" in next(r.note for r in summary.results if r.slug == "off")
    assert (await db.execute(select(LandingLegacyBackup))).scalars().all() == []
    assert await _home(db, 1) is None
    assert (await _cfg(db, 1)).config["customization"]["landing"] == LEGACY


async def test_run_converts_backs_up_and_is_idempotent(db, orgs, factory):
    summary = await mig.run(session_factory=factory, batch=2)
    assert summary.counts() == {"converted": 1, "default": 2, "skipped": 1}

    # Custom classic landing: converted, published, backgrounds kept, config cleared and backed up.
    home = await _home(db, 1)
    assert home.published == home.draft and home.published_version == 1 and len(home.published["root"]) == 2
    assert home.published["page"]["backgroundGradient"] == {"from": "#000000", "to": "#ffffff", "angle": 90}
    assert (await _cfg(db, 1)).config["customization"]["landing"] == {}
    b = await _backup(db, 1)
    assert b.status == "converted" and b.legacy == LEGACY and b.page_uuid == home.page_uuid and b.attempts == 1
    v = (await db.execute(select(LandingPageVersion).where(LandingPageVersion.page_id == home.id))).scalars().all()
    assert [(x.kind, x.number) for x in v] == [("convert", 1)]

    # No config: the default template, nothing to back up.
    plain = await _home(db, 2)
    assert [n["name"] for n in plain.published["root"]] == ["Hero", "Courses"]
    assert (await _backup(db, 2)).status == "default" and (await _backup(db, 2)).legacy is None

    # Switched-off classic landing (v1 config): default home, the classic one kept as a variant.
    off = await _home(db, 3)
    kinds = {x.kind: x.label for x in (await db.execute(select(LandingPageVersion).where(LandingPageVersion.page_id == off.id))).scalars().all()}
    assert kinds == {"convert": "Default home page", "variant": "Classic landing (was switched off)"}
    assert (await _cfg(db, 3)).config["landing"] == {}
    assert "kept as a variant" in (await _backup(db, 3)).error

    # Already built: untouched, recorded as skipped.
    built = await _home(db, 4)
    assert built.published_version == 3 and (await _backup(db, 4)).status == "skipped"
    assert (await _cfg(db, 4)).config["customization"]["landing"] == LEGACY

    # Second run: nothing left to do.
    assert (await mig.run(session_factory=factory)).results == []


async def test_an_unpublished_draft_in_progress_is_kept(db, factory):
    await _org(db, 1, "custom", {"config_version": "2.0", "customization": {"landing": copy.deepcopy(LEGACY)}})
    mine = service.validate_doc({"root": [{"id": "s1", "type": "section", "props": {}, "children": [{"id": "h", "type": "heading", "props": {"text": "Mine"}}]}]})
    db.add(service._new_page(1, "", "Home", mine, None))
    await db.commit()
    await mig.run(session_factory=factory)
    home = await _home(db, 1)
    assert home.draft == mine and len(home.published["root"]) == 2


async def test_one_bad_org_never_stops_the_run_and_is_retried(db, orgs, factory, monkeypatch):
    real = mig._plan

    async def flaky(db_, org):
        if org.id == 1:
            raise RuntimeError("odd config")
        return await real(db_, org)

    monkeypatch.setattr(mig, "_plan", flaky)
    summary = await mig.run(session_factory=factory)
    assert summary.counts() == {"failed": 1, "default": 2, "skipped": 1}
    b = await _backup(db, 1)
    assert b.status == "failed" and b.error == "odd config" and b.attempts == 1
    assert (await _cfg(db, 1)).config["customization"]["landing"] == LEGACY
    # Retried on the next runs, up to MAX_ATTEMPTS, then left alone.
    await mig.run(session_factory=factory)
    await mig.run(session_factory=factory)
    assert (await _backup(db, 1)).attempts == mig.MAX_ATTEMPTS
    assert (await mig.run(session_factory=factory)).results == []
    # Fixed converter: one org at a time after resetting its row.
    monkeypatch.setattr(mig, "_plan", real)
    b = await _backup(db, 1)
    b.attempts = 0
    db.add(b)
    await db.commit()
    assert (await mig.run(org_id=1, session_factory=factory)).counts() == {"converted": 1}


async def test_failures_while_recording_and_dry_run_failures(db, orgs, factory, monkeypatch):
    monkeypatch.setattr(mig, "_plan", AsyncMock(side_effect=RuntimeError("")))
    summary = await mig.run(dry_run=True, session_factory=factory)
    assert {r.action for r in summary.results} == {"failed", "skipped"}
    assert next(r.note for r in summary.results if r.action == "failed") == "RuntimeError"
    monkeypatch.setattr(mig, "_finish", AsyncMock(side_effect=RuntimeError("db down")))
    summary = await mig.run(org_id=1, session_factory=factory)
    assert summary.counts() == {"failed": 1}


async def test_orgs_deleted_mid_run_are_skipped(db, orgs, factory, monkeypatch):
    monkeypatch.setattr(mig, "_org_ids", AsyncMock(side_effect=[[999], []]))
    assert (await mig.run(session_factory=factory, batch=1)).results == []


async def test_replica_claims(db, orgs, factory):
    org = (await db.execute(select(Organization).where(Organization.id == 1))).scalars().first()
    # Another replica holds the org right now.
    db.add(LandingLegacyBackup(org_id=1, legacy=None, status="running", attempts=1, creation_date=mig._now(), update_date=mig._now()))
    await db.commit()
    res = await mig.migrate_org(db, org)
    assert res.action == "busy" and await _home(db, 1) is None
    # A run that died long ago is taken over.
    b = await _backup(db, 1)
    b.update_date = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    db.add(b)
    await db.commit()
    assert (await mig.migrate_org(db, org)).action == "converted"
    assert (await _backup(db, 1)).attempts == 2
    # Unreadable dates count as stale.
    b = await _backup(db, 2) or LandingLegacyBackup(org_id=2, status="running", attempts=1)
    b.update_date = "garbage"
    db.add(b)
    await db.commit()
    assert await mig._claim(db, 2, None)


async def test_two_replicas_inserting_at_once(db, orgs):
    db.add(LandingLegacyBackup(org_id=1, status="running", attempts=1, creation_date=mig._now(), update_date=mig._now()))
    await db.commit()
    real = db.execute
    calls = {"n": 0}

    async def first_read_misses(stmt, *a, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            return MagicMock(scalars=lambda: MagicMock(first=lambda: None))
        return await real(stmt, *a, **kw)

    with patch.object(db, "execute", side_effect=first_read_misses):
        assert not await mig._claim(db, 1, None)


async def test_rollback_restores_the_classic_configs(db, orgs, factory):
    await mig.run(session_factory=factory)
    # Org 3's home was published again by a member since: kept.
    off = await _home(db, 3)
    off.published_version = 2
    db.add(off)
    await db.commit()
    only = await mig.rollback(org_id=1, session_factory=factory)
    assert [(r.slug, r.action) for r in only.results] == [("custom", "rolled_back")]
    assert (await _cfg(db, 1)).config["customization"]["landing"] == LEGACY and await _home(db, 1) is None
    summary = await mig.rollback(session_factory=factory)
    got = {r.org_id: (r.action, r.note) for r in summary.results}
    assert got[2] == ("rolled_back", "") and "kept" in got[3][1] and 1 not in got
    assert await _home(db, 2) is None and await _home(db, 3) is not None
    assert (await _cfg(db, 3)).config["landing"]["sections"] == LEGACY["sections"]
    assert (await _backup(db, 4)).status == "skipped"
    # Rolled back orgs are done until their row is removed (a re-run converts them again).
    assert (await mig.run(session_factory=factory)).results == []
    await db.delete(await _backup(db, 1))
    await db.commit()
    assert (await mig.run(session_factory=factory)).counts() == {"converted": 1}


async def test_rollback_failure_is_isolated(db, orgs, factory, monkeypatch):
    await mig.run(session_factory=factory)
    monkeypatch.setattr(mig.service, "_org_config", AsyncMock(side_effect=RuntimeError("down")))
    summary = await mig.rollback(session_factory=factory)
    assert {r.action for r in summary.results} == {"failed"}


async def test_plan_notes_for_odd_classic_configs(db, monkeypatch):
    org = await _org(db, 1, "odd", {"config_version": "2.0", "customization": {"landing": copy.deepcopy(LEGACY)}})
    monkeypatch.setattr(service, "convert_landing", MagicMock(side_effect=ValueError("bad")))
    action, doc, variant, note = await mig._plan(db, org)
    assert action == "default" and variant is None and "did not convert; default template used" in note
    cfg = await _cfg(db, 1)
    cfg.config = {"config_version": "2.0", "customization": {"landing": {**LEGACY, "enabled": False}}}
    db.add(cfg)
    await db.commit()
    monkeypatch.setattr(mig, "convert_landing", MagicMock(side_effect=ValueError("bad")))
    action, doc, variant, note = await mig._plan(db, org)
    assert variant is None and note == "classic landing was off and did not convert"


def test_helpers():
    assert mig._holder({"config_version": "2.0"}) == {} and mig._holder({"landing": 1}) == {"landing": 1}
    org = Organization(id=1, slug="x", name="x", org_uuid="o", creation_date=NOW, update_date=NOW)
    with patch("src.services.orgs.cache.invalidate_org_config_cache", side_effect=RuntimeError("redis")):
        mig._invalidate(org)
    assert mig._session_factory() is not None


async def test_startup_hook(monkeypatch):
    monkeypatch.setenv("TESTING", "true")
    mig._task = None
    mig.start_on_startup()
    assert mig._task is None
    monkeypatch.delenv("TESTING")
    monkeypatch.setenv("LEARNHOUSE_LANDING_MIGRATION_DISABLED", "1")
    mig.start_on_startup()
    assert mig._task is None
    monkeypatch.delenv("LEARNHOUSE_LANDING_MIGRATION_DISABLED")
    monkeypatch.setattr(mig, "STARTUP_DELAY_SECONDS", 0)
    run = AsyncMock(side_effect=[None, RuntimeError("db not ready")])
    monkeypatch.setattr(mig, "run", run)
    mig.start_on_startup()
    await mig._task
    await mig._startup_run()  # a failed run is logged, never raised
    assert run.await_count == 2
    monkeypatch.setattr(mig.asyncio, "create_task", MagicMock(side_effect=RuntimeError("no loop")))
    mig.start_on_startup()
    mig._task = None


async def test_startup_run_cancellation(monkeypatch):
    monkeypatch.setattr(mig, "STARTUP_DELAY_SECONDS", 10)
    task = asyncio.create_task(mig._startup_run())
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
