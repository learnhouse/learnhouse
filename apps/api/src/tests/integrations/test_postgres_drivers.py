"""Real-PostgreSQL checks for both async drivers (asyncpg and psycopg 3).

The rest of the suite runs on SQLite, which cannot tell the drivers apart. This
module reruns a representative slice of real service calls on PostgreSQL once
per driver: course list and meta, activity read, a JSON content write, a trail
write, unique-violation recovery, timezone-aware and binary columns, the idle
ping and the no-named-prepared-statement guarantee transaction poolers rely on.

Opt-in: point ``LEARNHOUSE_TEST_POSTGRES_URL`` at a throwaway database (it is
truncated before every test), for instance a ``pgvector/pgvector:pg16``
container's ``postgres`` database, and run::

    LEARNHOUSE_TEST_POSTGRES_URL=... TESTING=true \\
        .venv/bin/python -m pytest -q src/tests/integrations/test_postgres_drivers.py

It also runs through PgBouncer in transaction mode (minus the TimeZone check,
whose startup option PgBouncer rejects).

The schema is brought to head with ``ensure_schema`` (the migration path the
API itself runs). The conftest fixtures that insert rows with fixed ids keep
working because every sequence is restarted far above them.
"""

import os
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool
from sqlmodel import SQLModel, select

from src.core.db_driver import (
    ASYNCPG,
    DRIVERS,
    PSYCOPG,
    async_connect_args,
    async_database_url,
    ping,
)
from src.core.migrations import sync_database_url

PG_URL = os.getenv("LEARNHOUSE_TEST_POSTGRES_URL", "")

pytestmark = pytest.mark.skipif(
    not PG_URL, reason="set LEARNHOUSE_TEST_POSTGRES_URL to run the PostgreSQL driver checks"
)

# conftest swaps JSONB columns for JSON on the shared metadata the first time a
# SQLite engine is built. Remember the real types at import (collection runs
# before any fixture) and put them back for the PostgreSQL tests.
_JSONB_COLUMNS = [
    col
    for table in SQLModel.metadata.tables.values()
    for col in table.columns
    if isinstance(col.type, JSONB)
]

FIRST_GENERATED_ID = 100_000


def _with_real_jsonb():
    swapped = [(col, col.type) for col in _JSONB_COLUMNS if not isinstance(col.type, JSONB)]
    for col, _ in swapped:
        col.type = JSONB()
    return swapped


def _restore(swapped):
    for col, original in swapped:
        col.type = original


@pytest.fixture(scope="module")
def pg_schema():
    from src.core.migrations import ensure_schema, load_models

    swapped = _with_real_jsonb()
    try:
        ensure_schema(sync_database_url(PG_URL), metadata=load_models())
    finally:
        _restore(swapped)
    sync_engine = create_engine(sync_database_url(PG_URL), poolclass=NullPool)
    with sync_engine.connect() as conn:
        tables = conn.execute(text(
            "SELECT quote_ident(tablename) FROM pg_tables "
            "WHERE schemaname = 'public' AND tablename <> 'alembic_version'"
        )).scalars().all()
        sequences = conn.execute(text(
            "SELECT quote_ident(sequencename) FROM pg_sequences WHERE schemaname = 'public'"
        )).scalars().all()
    yield sync_engine, tables, sequences
    sync_engine.dispose()


@pytest.fixture(params=DRIVERS)
def driver(request):
    return request.param


@pytest.fixture
async def engine(pg_schema, driver):
    """Overrides conftest's SQLite engine: every fixture built on ``db`` (org,
    users, course, chapter, activity) lands in PostgreSQL instead."""
    sync_engine, tables, sequences = pg_schema
    with sync_engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE"))
        for seq in sequences:
            conn.execute(text(f"ALTER SEQUENCE {seq} RESTART WITH {FIRST_GENERATED_ID}"))

    swapped = _with_real_jsonb()
    eng = create_async_engine(
        async_database_url(PG_URL, driver),
        connect_args=async_connect_args(driver),
        pool_size=2,
        max_overflow=0,
    )
    assert eng.dialect.driver == driver
    yield eng
    await eng.dispose()
    _restore(swapped)


@pytest.fixture
def no_caches():
    """Course caches live in Redis; keep them out of the way."""
    with patch("src.services.courses.cache.get_cached_course_meta", return_value=None), \
         patch("src.services.courses.cache.set_cached_course_meta"), \
         patch("src.services.courses.cache.get_cached_courses_list", return_value=None), \
         patch("src.services.courses.cache.set_cached_courses_list"):
        yield


class TestServices:
    async def test_course_list_and_meta(
        self, db, org, admin_user, course, chapter, activity, mock_request, no_caches
    ):
        from src.services.courses.courses import get_course_meta, get_courses_orgslug

        courses = await get_courses_orgslug(mock_request, admin_user, org.slug, db, 1, 10)
        assert [c.course_uuid for c in courses] == [course.course_uuid]

        meta = await get_course_meta(mock_request, course.course_uuid, True, admin_user, db)
        assert meta.course_uuid == course.course_uuid
        assert [ch.chapter_uuid for ch in meta.chapters] == [chapter.chapter_uuid]
        assert [a.activity_uuid for a in meta.chapters[0].activities] == [activity.activity_uuid]

    async def test_activity_read_and_json_content_write(
        self, db, admin_user, regular_user, activity, mock_request, bypass_webhooks
    ):
        from src.db.courses.activities import ActivityUpdate
        from src.services.courses.activities.activities import get_activity, update_activity

        uuid = activity.activity_uuid
        content = {
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": "héllo \"wörld\" ✓"}]}],
            "nested": {"n": 1, "f": 1.5, "b": True, "none": None, "list": [1, "two", {"three": 3}]},
        }
        await update_activity(
            mock_request, ActivityUpdate(content=content), uuid, admin_user, db
        )
        db.expire_all()

        read = await get_activity(mock_request, uuid, regular_user, db)
        assert read.activity_uuid == uuid
        assert read.content["nested"] == content["nested"]
        assert read.content["content"][0]["content"][0]["text"] == "héllo \"wörld\" ✓"

        # JSONB operators see the same document whichever driver wrote it.
        text_value = (await db.execute(text(
            "SELECT content #>> '{content,0,content,0,text}' FROM activity WHERE activity_uuid = :u"
        ), {"u": uuid})).scalar_one()
        assert text_value == "héllo \"wörld\" ✓"

    async def test_trail_write_is_idempotent(
        self, db, org, regular_user, course, chapter, activity, mock_request
    ):
        from src.db.trail_steps import TrailStep
        from src.services.trail.trail import add_activity_to_trail

        first = await add_activity_to_trail(mock_request, regular_user, activity.activity_uuid, db)
        again = await add_activity_to_trail(mock_request, regular_user, activity.activity_uuid, db)
        assert first.trail_uuid == again.trail_uuid

        steps = (await db.execute(
            select(TrailStep).where(TrailStep.user_id == regular_user.id)
        )).scalars().all()
        assert [s.activity_id for s in steps] == [activity.id]
        assert all(s.id >= FIRST_GENERATED_ID for s in steps)

    async def test_unique_violation_is_an_integrity_error(self, db, org):
        from src.db.organizations import Organization

        slug = org.slug
        db.add(Organization(
            name="Dup", slug=slug, email="dup@org.com", org_uuid="org_dup",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
        with pytest.raises(IntegrityError) as caught:
            await db.commit()
        await db.rollback()

        # Driver-neutral: the SQLSTATE and the server message are the same.
        assert getattr(caught.value.orig, "sqlstate", None) == "23505"
        assert "duplicate key value violates unique constraint" in str(caught.value)

        # The session is usable again after the rollback.
        assert (await db.execute(select(Organization.slug))).scalars().all() == [slug]

    async def test_duplicate_activity_day_is_swallowed(self, engine, db, org, regular_user):
        """security/activity.py relies on the unique constraint plus an
        IntegrityError catch; it must hold on both drivers."""
        from sqlalchemy.ext.asyncio import async_sessionmaker
        from sqlmodel.ext.asyncio.session import AsyncSession

        from src.db.user_activity import UserActivityDay
        from src.services.security import activity as security_activity

        factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        org_id, user_id = org.id, regular_user.id
        today = datetime.now(timezone.utc).date()
        with patch("src.core.events.database._async_session_factory", factory):
            assert await security_activity._insert_activity_row(org_id, user_id, today) is True
            assert await security_activity._insert_activity_row(org_id, user_id, today) is True

        rows = (await db.execute(select(UserActivityDay))).scalars().all()
        assert len(rows) == 1
        # A timezone-aware column comes back aware.
        assert rows[0].first_seen_at.tzinfo is not None


class TestTypes:
    async def test_timestamptz_and_bytes_round_trip(self, db, org, regular_user):
        from src.db.user_activity import UserActivityDay

        aware = datetime(2026, 11, 16, 12, 30, 15, 123456, tzinfo=timezone(timedelta(hours=2)))
        row = UserActivityDay(
            org_id=org.id, user_id=regular_user.id, activity_date=aware.date(), first_seen_at=aware
        )
        db.add(row)
        await db.commit()
        db.expire_all()
        stored = (await db.execute(select(UserActivityDay))).scalars().one()
        assert stored.first_seen_at == aware
        assert stored.first_seen_at.utcoffset() is not None

        blob = bytes(range(256)) * 4
        value = (await db.execute(text("SELECT CAST(:b AS bytea)"), {"b": blob})).scalar_one()
        assert bytes(value) == blob

    async def test_untyped_parameters(self, db, org):
        """Plain text() binds: psycopg sends Python types as is, asyncpg infers
        from the statement. Both must accept what the services pass."""
        row = (await db.execute(text(
            "SELECT id, slug FROM organization WHERE id = :id AND slug = :slug LIMIT :n"
        ), {"id": org.id, "slug": org.slug, "n": 1})).one()
        assert tuple(row) == (org.id, org.slug)
        assert (await db.execute(text("SELECT :a + 1"), {"a": 41})).scalar_one() == 42


class TestConnection:
    async def test_no_named_prepared_statement_is_left_behind(self, engine, driver):
        """What a transaction pooler needs: repeating a query many times must not
        leave a named statement on the backend for the next client to trip on.
        (Behind a pooler the backend may hold other clients' statements, hence
        the marker.)"""
        marker = f"lh-driver-check-{driver}"
        async with engine.connect() as conn:
            for i in range(12):
                assert (await conn.execute(
                    text(f"SELECT CAST(:i AS int) + 1 /* {marker} */"), {"i": i}
                )).scalar_one() == i + 1
            prepared = (await conn.execute(
                text("SELECT name FROM pg_prepared_statements WHERE statement LIKE :m"),
                {"m": f"%{marker}%"},
            )).scalars().all()
        assert prepared == [], f"{driver} left prepared statements: {prepared}"

    async def test_idle_ping_leaves_the_connection_idle(self, engine, driver):
        async with engine.connect() as conn:
            raw = await conn.get_raw_connection()

            def _ping(sync_conn):
                ping(sync_conn.dialect, raw.dbapi_connection, driver)

            await conn.run_sync(_ping)
            driver_conn = raw.driver_connection
            if driver == PSYCOPG:
                from psycopg.pq import TransactionStatus

                assert driver_conn.info.transaction_status == TransactionStatus.IDLE
                assert driver_conn.autocommit is False
            else:
                assert driver == ASYNCPG
                assert not driver_conn.is_in_transaction()

    async def test_failed_ping_raises_on_a_closed_connection(self, engine, driver):
        async with engine.connect() as conn:
            raw = await conn.get_raw_connection()
            await raw.driver_connection.close()

            def _ping(sync_conn):
                ping(sync_conn.dialect, raw.dbapi_connection, driver)

            with pytest.raises(Exception):
                await conn.run_sync(_ping)
            await conn.invalidate()


    async def test_psycopg_server_timezone_check(self, engine, driver, monkeypatch, caplog):
        """The TimeZone check reads what the server reported at connect time;
        with a non-UTC role default it warns."""
        import logging

        from src.core import db_driver

        if driver != PSYCOPG:
            pytest.skip("psycopg only")
        monkeypatch.setattr(db_driver, "_timezone_warned", False)
        async with engine.connect() as conn:
            raw = await conn.get_raw_connection()
            assert raw.driver_connection.info.parameter_status("TimeZone").lower() in db_driver._UTC_ZONES
            with caplog.at_level(logging.WARNING):
                db_driver.warn_if_server_timezone_not_utc(raw.dbapi_connection)
            assert caplog.text == ""

        paris = create_async_engine(
            async_database_url(PG_URL, PSYCOPG),
            connect_args={**async_connect_args(PSYCOPG), "options": "-c TimeZone=Europe/Paris"},
        )
        try:
            async with paris.connect() as conn:
                raw = await conn.get_raw_connection()
                with caplog.at_level(logging.WARNING):
                    db_driver.warn_if_server_timezone_not_utc(raw.dbapi_connection)
        finally:
            await paris.dispose()
        assert "database TimeZone 'Europe/Paris'" in caplog.text


@pytest.fixture
def bypass_webhooks():
    with patch("src.services.webhooks.dispatch.dispatch_webhooks", new_callable=AsyncMock) as mock:
        yield mock
