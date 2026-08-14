"""Small pieces of the demo that are easier to pin down directly than through a sync.

Flag parsing, the registry's lookups, the persona and cohort draws, and the one
place the scheduler touches the database.
"""

from src.services.demo import flags


# ---------------------------------------------------------------------------
# flags
# ---------------------------------------------------------------------------

def test_boolean_flags_accept_the_usual_spellings(monkeypatch):
    for raw in ("1", "true", "TRUE", " yes ", "on"):
        monkeypatch.setenv("LEARNHOUSE_DEMO_ENABLED", raw)
        assert flags.demo_enabled() is True

    for raw in ("0", "false", "no", "off", ""):
        monkeypatch.setenv("LEARNHOUSE_DEMO_ENABLED", raw)
        assert flags.demo_enabled() is False


def test_an_unset_interval_uses_the_declared_default(monkeypatch):
    monkeypatch.delenv("LEARNHOUSE_DEMO_REFRESH_MINUTES", raising=False)
    assert flags.refresh_minutes() == flags.DEFAULT_REFRESH_MINUTES


def test_a_nonsense_interval_falls_back_rather_than_crashing(monkeypatch):
    """This is read at startup; a typo must not stop the API booting."""
    for raw in ("ten", "", "10 minutes", "1e3"):
        monkeypatch.setenv("LEARNHOUSE_DEMO_REFRESH_MINUTES", raw)
        assert flags.refresh_minutes() == flags.DEFAULT_REFRESH_MINUTES


def test_a_zero_or_negative_interval_falls_back(monkeypatch):
    """Otherwise the scheduler becomes a busy loop rebuilding the demo."""
    for raw in ("0", "-5"):
        monkeypatch.setenv("LEARNHOUSE_DEMO_REFRESH_MINUTES", raw)
        assert flags.refresh_minutes() == flags.DEFAULT_REFRESH_MINUTES


def test_a_valid_interval_is_honoured(monkeypatch):
    """The fallbacks above would be indistinguishable from ignoring the flag."""
    monkeypatch.setenv("LEARNHOUSE_DEMO_REFRESH_MINUTES", " 45 ")
    assert flags.refresh_minutes() == 45


def test_demo_addresses_are_recognised_whatever_the_case():
    assert flags.is_demo_email("demo-01@demo.example.com") is True
    assert flags.is_demo_email("DEMO-01@DEMO.EXAMPLE.COM") is True
    assert flags.is_demo_email("someone@example.com") is False
    assert flags.is_demo_email(None) is False


# ---------------------------------------------------------------------------
# the registry
# ---------------------------------------------------------------------------

async def test_an_unprovisioned_registry_is_empty(db):
    """Before the first sync there is no org, and nothing is owned."""
    from src.services.demo.registry import Registry

    registry = await Registry.load(None, db)

    assert registry.uuid_for("course", "anything") is None
    assert registry.uuids_of_kind("course") == set()
    assert registry.ids_of_kind("course") == set()


async def test_uuid_for_returns_the_registered_uuid(db, org):
    from src.db.demo_entities import DemoEntityKind
    from src.services.demo.registry import Registry

    registry = await Registry.load(org.id, db)
    registry.register(
        db,
        kind=DemoEntityKind.COURSE,
        bundle_key="a-course",
        entity_id=7,
        entity_uuid="course_abc",
        org_id=org.id,
    )

    assert registry.uuid_for(DemoEntityKind.COURSE, "a-course") == "course_abc"
    assert registry.uuid_for(DemoEntityKind.COURSE, "another") is None


# ---------------------------------------------------------------------------
# the draws
# ---------------------------------------------------------------------------

def test_the_persona_draw_always_returns_one():
    """The weighted walk must not be able to fall off the end of the table."""
    import random

    from src.services.demo.bundle_loader import PersonaSpec
    from src.services.demo.progress import _pick_persona

    personas = [
        PersonaSpec(
            id="completer", weight=1, min_courses=1, max_courses=1,
            min_completion=1.0, max_completion=1.0,
        ),
        PersonaSpec(
            id="lurker", weight=1, min_courses=1, max_courses=1,
            min_completion=0.0, max_completion=0.0,
        ),
    ]

    for seed in range(20):
        assert _pick_persona(personas, random.Random(seed)) in personas

    class _EdgeRng:
        """A roll landing exactly on the total, which walks past every bucket."""

        def randrange(self, total):
            return total

    assert _pick_persona(personas, _EdgeRng()) is personas[-1]


def test_every_student_gets_a_cohort():
    """Cohort shares are rounded, so the last student can round away."""
    from datetime import date

    from src.services.demo.bundle_loader import get_bundle
    from src.services.demo.progress import epoch_for, plan_students

    bundle = get_bundle()
    plans = plan_students(bundle, epoch_for(date(2026, 8, 9)))

    assert len(plans) == bundle.manifest.students.count
    assert all(plan.cohort_key for plan in plans), "a student ended up with no cohort"


# ---------------------------------------------------------------------------
# the scheduler's one database call
# ---------------------------------------------------------------------------

async def test_run_once_opens_a_session_and_syncs(monkeypatch):
    """_run_once is the only place the tick touches the database."""
    from contextlib import asynccontextmanager

    from src.services.demo import scheduler

    opened = []

    @asynccontextmanager
    async def _factory():
        opened.append(1)
        yield "session"

    class _Stats:
        provisioned = True
        epoch = "2026-08-09"
        created = 1
        updated = 0
        drift_deleted = 0

    async def _sync(session):
        assert session == "session"
        return _Stats()

    monkeypatch.setattr("src.core.events.database._async_session_factory", _factory)
    monkeypatch.setattr("src.services.demo.sync.sync_demo", _sync)

    await scheduler._run_once()

    assert opened == [1]


async def test_run_once_logs_a_settled_demo_quietly(monkeypatch, caplog):
    """A no-op refresh must not write an INFO line every ten minutes forever."""
    import logging
    from contextlib import asynccontextmanager

    from src.services.demo import scheduler

    @asynccontextmanager
    async def _factory():
        yield "session"

    class _Stats:
        provisioned = False
        epoch = "2026-08-09"
        created = 0
        updated = 0
        drift_deleted = 0

    async def _sync(session):
        return _Stats()

    monkeypatch.setattr("src.core.events.database._async_session_factory", _factory)
    monkeypatch.setattr("src.services.demo.sync.sync_demo", _sync)

    with caplog.at_level(logging.DEBUG, logger=scheduler.logger.name):
        await scheduler._run_once()

    levels = {
        record.levelno
        for record in caplog.records
        if record.name == scheduler.logger.name
    }
    assert logging.INFO not in levels, (
        f"a settled refresh logged above DEBUG: {[r.getMessage() for r in caplog.records]}"
    )
    assert logging.DEBUG in levels, "a settled refresh logged nothing at all"


def test_rounding_never_leaves_a_student_without_a_cohort():
    """Cohort sizes come from rounded shares, so they can fall short.

    A student with no cohort would be dropped from the seeding entirely, so the
    last cohort takes the remainder.
    """
    from datetime import date

    from src.services.demo.bundle_loader import get_bundle
    from src.services.demo.progress import epoch_for, plan_students

    full = get_bundle()
    manifest = full.manifest
    # Shares that deliberately sum to less than one.
    shares = [c.model_copy(update={"share": 0.1}) for c in manifest.cohorts]
    short = full.model_copy(
        update={"manifest": manifest.model_copy(update={"cohorts": shares})}
    )

    plans = plan_students(short, epoch_for(date(2026, 8, 9)))

    assert len(plans) == manifest.students.count
    assert all(plan.cohort_key for plan in plans)
