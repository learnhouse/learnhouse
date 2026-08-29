import importlib
import logging
from types import SimpleNamespace

import pytest
from sqlalchemy import event as sa_event
from sqlmodel import Session

import src.core.events.database as database
from src.db.courses.activities import Activity
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization


class _FakeResult:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


class _FakeConnection:
    def __init__(self, row=None, error=None):
        self.row = row
        self.error = error
        self.executed = []

    def execute(self, statement, params):
        self.executed.append((statement, params))
        if self.error is not None:
            raise self.error
        return _FakeResult(self.row)


def _capture_hooks(monkeypatch, inspect_stub=None):
    registrations = {}

    def listen(target, event_name, callback):
        registrations[(target, event_name)] = callback

    def listens_for(target, event_name):
        def decorator(callback):
            registrations[(target, event_name)] = callback
            return callback

        return decorator

    monkeypatch.setattr(sa_event, "listen", listen)
    monkeypatch.setattr(sa_event, "listens_for", listens_for)
    if inspect_stub is not None:
        monkeypatch.setattr("sqlalchemy.inspect", inspect_stub)

    database._register_cache_invalidation_hooks()
    return registrations


def test_import_all_models_imports_python_modules_and_logs_failures(monkeypatch, caplog):
    walked = {
        "src/db": [
            ("src/db", ["nested"], ["alpha.py", "__init__.py", "ignored.txt", "boom.py"]),
            ("src/db/nested", [], ["beta.py"]),
        ],
    }

    monkeypatch.setattr(database.os.path, "exists", lambda path: path == "src/db")
    monkeypatch.setattr(database.os, "walk", lambda base_dir: iter(walked.get(base_dir, [])))

    imported = []

    def fake_import_module(module_name):
        imported.append(module_name)
        if module_name.endswith("boom"):
            raise RuntimeError("boom")

    monkeypatch.setattr(database.importlib, "import_module", fake_import_module)

    with caplog.at_level(logging.ERROR):
        database.import_all_models()

    assert imported == ["src.db.alpha", "src.db.boom", "src.db.nested.beta"]
    assert "Failed to import model src.db.boom" in caplog.text


@pytest.mark.asyncio
async def test_connect_to_db_get_db_session_and_close_database():
    from sqlmodel.ext.asyncio.session import AsyncSession

    app = SimpleNamespace()

    await database.connect_to_db(app)
    assert app.db_engine is database.engine

    generator = database.get_db_session()
    session = await anext(generator)
    assert isinstance(session, AsyncSession)
    # Exhaust the generator so that cleanup runs (ignore StopAsyncIteration)
    try:
        await anext(generator)
    except StopAsyncIteration:
        pass

    assert await database.close_database(app) is app


@pytest.mark.asyncio
async def test_connect_to_db_runs_create_all_when_not_testing(monkeypatch):
    """The `if not is_testing: await conn.run_sync(SQLModel.metadata.create_all)`
    branch is unreachable under the normal TESTING=true env.  Patch the module-level
    flag to False so the branch executes, then restore it."""
    app = SimpleNamespace()
    create_all_calls = []

    original_is_testing = database.is_testing
    try:
        monkeypatch.setattr(database, "is_testing", False)
        monkeypatch.setattr(
            "sqlmodel.SQLModel.metadata.create_all",
            lambda bind: create_all_calls.append(bind),
        )
        await database.connect_to_db(app)
    finally:
        monkeypatch.setattr(database, "is_testing", original_is_testing)

    assert app.db_engine is database.engine
    assert len(create_all_calls) == 1


@pytest.mark.asyncio
async def test_register_cache_hooks_cover_listener_paths_and_commit_cleanup(db, monkeypatch):
    # The cache hooks track state on the underlying sync session.
    sync_session = db.sync_session

    registrations = _capture_hooks(monkeypatch)

    org_after_insert = registrations[(Organization, "after_insert")]
    org_after_update = registrations[(Organization, "after_update")]
    org_after_delete = registrations[(Organization, "after_delete")]
    org_config_changed = registrations[(OrganizationConfig, "after_insert")]
    course_changed = registrations[(Course, "after_insert")]
    child_changed = registrations[(Chapter, "after_insert")]
    after_commit = registrations[(Session, "after_commit")]
    after_rollback = registrations[(Session, "after_rollback")]

    org = Organization(
        id=101,
        name="Org",
        slug="org-slug",
        email="org@example.com",
        org_uuid="org-101",
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    db.add(org)
    await db.flush()

    org_after_insert(None, None, org)
    assert sync_session._org_slugs_to_invalidate == {"org-slug"}

    org.slug = "org-slug-renamed"
    org_after_update(None, None, org)
    assert sync_session._org_slugs_to_invalidate == {"org-slug", "org-slug-renamed"}

    org_after_delete(None, None, org)
    assert sync_session._org_slugs_to_invalidate == {"org-slug", "org-slug-renamed"}

    org_config = OrganizationConfig(org_id=org.id, config={})
    db.add(org_config)
    await db.flush()
    org_config_changed(None, sync_session.connection(), org_config)
    assert sync_session._org_slugs_to_invalidate == {"org-slug", "org-slug-renamed"}

    course = Course(
        name="Course",
        org_id=org.id,
        course_uuid="course-uuid",
        public=True,
        open_to_contributors=False,
    )
    db.add(course)
    await db.flush()
    course_changed(None, sync_session.connection(), course)
    assert sync_session._course_uuids_to_invalidate == {"course-uuid"}
    assert sync_session._org_slugs_to_invalidate == {"org-slug", "org-slug-renamed"}

    chapter = Chapter(name="Chapter", org_id=org.id, course_id=course.id)
    db.add(chapter)
    await db.flush()
    child_changed(None, sync_session.connection(), chapter)
    assert sync_session._course_uuids_to_invalidate == {"course-uuid"}

    org_cache_calls = []
    course_cache_calls = []
    course_meta_cache_calls = []
    monkeypatch.setattr(
        "src.services.orgs.cache.invalidate_org_cache",
        lambda slug: org_cache_calls.append(slug),
    )
    monkeypatch.setattr(
        "src.services.courses.cache.invalidate_courses_cache",
        lambda slug: course_cache_calls.append(slug),
    )
    monkeypatch.setattr(
        "src.services.courses.cache.invalidate_course_meta_cache",
        lambda uuid: course_meta_cache_calls.append(uuid),
    )

    after_commit(sync_session)
    assert set(org_cache_calls) == {"org-slug", "org-slug-renamed"}
    assert set(course_cache_calls) == {"org-slug", "org-slug-renamed"}
    assert course_meta_cache_calls == ["course-uuid"]
    assert sync_session._org_slugs_to_invalidate == set()
    assert sync_session._course_uuids_to_invalidate == set()

    sync_session._org_slugs_to_invalidate = {"rollback-slug"}
    sync_session._course_uuids_to_invalidate = {"rollback-course"}
    after_rollback(sync_session)
    assert sync_session._org_slugs_to_invalidate == set()
    assert sync_session._course_uuids_to_invalidate == set()


@pytest.mark.asyncio
async def test_register_cache_hooks_cover_early_returns_and_history_failure(db, monkeypatch):
    sync_session = db.sync_session

    registrations = _capture_hooks(monkeypatch)

    org_after_update = registrations[(Organization, "after_update")]
    org_after_delete = registrations[(Organization, "after_delete")]
    org_config_changed = registrations[(OrganizationConfig, "after_update")]
    course_changed = registrations[(Course, "after_update")]
    child_changed = registrations[(Activity, "after_update")]

    monkeypatch.setattr(database.Session, "object_session", lambda target: None)
    org_after_update(None, None, SimpleNamespace(slug="org"))
    org_after_delete(None, None, SimpleNamespace(slug="org"))
    course_changed(None, None, SimpleNamespace(org_id=1, course_uuid="course"))
    child_changed(None, None, SimpleNamespace(course_id=1))

    monkeypatch.setattr(database.Session, "object_session", lambda target: sync_session)
    org_config_changed(None, None, SimpleNamespace(org_id=None))
    course_changed(None, None, SimpleNamespace(org_id=None, course_uuid="course"))

    class _BadHistory:
        @property
        def history(self):
            raise RuntimeError("history failed")

    class _BadInspector:
        attrs = SimpleNamespace(slug=_BadHistory())

    bad_registrations = _capture_hooks(
        monkeypatch,
        inspect_stub=lambda *args, **kwargs: _BadInspector(),
    )
    bad_org_after_update = bad_registrations[(Organization, "after_update")]

    org = Organization(
        id=202,
        name="Org",
        slug="history-org",
        email="history@example.com",
        org_uuid="org-202",
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    db.add(org)
    await db.flush()
    org.slug = "history-org-renamed"
    sync_session._org_slugs_to_invalidate = set()
    bad_org_after_update(None, None, org)
    assert sync_session._org_slugs_to_invalidate == {"history-org-renamed"}


@pytest.mark.asyncio
async def test_org_config_change_busts_slug_cache_without_the_org_loaded(db, monkeypatch):
    """A config write that never loads its Organization must still bust the
    org-by-slug cache.

    This is the shape of every org-policy save: the endpoint selects only
    OrganizationConfig, so the identity map has no Organization to read the slug
    from. The lookup misses without raising, so the SQL fallback has to run on a
    miss and not only on an exception — otherwise the slug cache keeps serving
    the pre-write config and the dashboard shows the old values back.
    """
    sync_session = db.sync_session
    registrations = _capture_hooks(monkeypatch)
    org_config_changed = registrations[(OrganizationConfig, "after_update")]

    monkeypatch.setattr(database.Session, "object_session", lambda target: sync_session)
    sync_session._org_slugs_to_invalidate = set()

    org_config = OrganizationConfig(org_id=777, config={})
    db.add(org_config)
    await db.flush()

    # No Organization in the identity map — exactly what the org-policy PUT does.
    connection = _FakeConnection(row=("policy-only-org",))
    org_config_changed(None, connection, org_config)

    assert connection.executed
    assert "policy-only-org" in sync_session._org_slugs_to_invalidate
    assert 777 in sync_session._org_config_ids_to_invalidate


@pytest.mark.asyncio
async def test_register_cache_hooks_cover_fallback_queries_and_commit_warning(db, monkeypatch, caplog):
    sync_session = db.sync_session

    registrations = _capture_hooks(
        monkeypatch,
        inspect_stub=lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("inspect failed")),
    )

    org_config_changed = registrations[(OrganizationConfig, "after_update")]
    course_changed = registrations[(Course, "after_update")]
    child_changed = registrations[(Activity, "after_update")]
    after_commit = registrations[(Session, "after_commit")]

    monkeypatch.setattr(database.Session, "object_session", lambda target: sync_session)

    org_config = OrganizationConfig(org_id=404, config={})
    db.add(org_config)
    await db.flush()
    org_config_connection = _FakeConnection(row=("fallback-org",))
    org_config_changed(None, org_config_connection, org_config)
    assert org_config_connection.executed
    assert "fallback-org" in sync_session._org_slugs_to_invalidate

    org_config_error_connection = _FakeConnection(error=RuntimeError("query failed"))
    org_config_changed(None, org_config_error_connection, org_config)

    course = Course(
        name="Fallback Course",
        org_id=404,
        course_uuid="fallback-course",
        public=True,
        open_to_contributors=False,
    )
    db.add(course)
    await db.flush()
    course_connection = _FakeConnection(row=("fallback-org-course",))
    course_changed(None, course_connection, course)
    assert course_connection.executed
    assert "fallback-course" in sync_session._course_uuids_to_invalidate
    assert "fallback-org-course" in sync_session._org_slugs_to_invalidate

    course_error_connection = _FakeConnection(error=RuntimeError("query failed"))
    course_changed(None, course_error_connection, course)

    chapter = Chapter(name="Fallback Chapter", org_id=404, course_id=course.id)
    db.add(chapter)
    await db.flush()
    child_connection = _FakeConnection(row=("fallback-course-meta",))
    child_changed(None, child_connection, chapter)
    assert child_connection.executed
    assert "fallback-course-meta" in sync_session._course_uuids_to_invalidate

    child_error_connection = _FakeConnection(error=RuntimeError("query failed"))
    child_changed(None, child_error_connection, chapter)

    def failing_invalidator(_value):
        raise RuntimeError("commit failed")

    monkeypatch.setattr(
        "src.services.orgs.cache.invalidate_org_cache",
        failing_invalidator,
    )
    monkeypatch.setattr(
        "src.services.courses.cache.invalidate_courses_cache",
        lambda slug: None,
    )
    monkeypatch.setattr(
        "src.services.courses.cache.invalidate_course_meta_cache",
        lambda uuid: None,
    )
    sync_session._org_slugs_to_invalidate = {"commit-slug"}
    sync_session._course_uuids_to_invalidate = {"commit-course"}

    with caplog.at_level(logging.WARNING):
        after_commit(sync_session)

    assert "Cache invalidation after commit failed" in caplog.text
    assert sync_session._org_slugs_to_invalidate == set()
    assert sync_session._course_uuids_to_invalidate == set()


def test_reload_module_covers_production_branch(monkeypatch, caplog):
    class _FakeDatabaseConfig:
        sql_connection_string = "postgresql://example"

    class _FakeConfig:
        database_config = _FakeDatabaseConfig()

    # The new database.py uses create_async_engine and registers events on
    # engine.sync_engine. Provide a fake async engine with a sync_engine stub.
    class _FakeSyncEngine:
        pass

    class _FakeAsyncEngine:
        def __init__(self):
            self.sync_engine = _FakeSyncEngine()

    engine_callbacks = {}

    def capture_engine_listens_for(target, event_name):
        def decorator(fn):
            engine_callbacks[(target, event_name)] = fn
            return fn

        return decorator

    _fake_engine_instance = _FakeAsyncEngine()

    def fake_create_async_engine(*args, **kwargs):
        return _fake_engine_instance

    monkeypatch.setenv("TESTING", "false")
    monkeypatch.setattr("config.config.get_learnhouse_config", lambda: _FakeConfig())
    monkeypatch.setattr(
        "sqlalchemy.ext.asyncio.create_async_engine", fake_create_async_engine
    )
    monkeypatch.setattr(sa_event, "listens_for", capture_engine_listens_for)
    monkeypatch.setattr(sa_event, "listen", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        "sqlmodel.SQLModel.metadata.create_all",
        lambda engine: None,
    )

    with caplog.at_level(logging.WARNING):
        reloaded = importlib.reload(database)
    assert reloaded.is_testing is False
    assert reloaded.engine is not None
    sync_eng = reloaded.engine.sync_engine
    assert (sync_eng, "connect") in engine_callbacks
    assert (sync_eng, "checkout") in engine_callbacks
    assert (sync_eng, "checkin") in engine_callbacks

    # The callbacks just do logging.debug — invoke them to cover those branches.
    engine_callbacks[(sync_eng, "connect")](None, None)
    engine_callbacks[(sync_eng, "checkout")](None, None, None)
    engine_callbacks[(sync_eng, "checkin")](None, None)

    # Reload with listen raising to cover the "Failed to register cache
    # invalidation hooks" warning path.
    _fake_engine_instance2 = _FakeAsyncEngine()
    monkeypatch.setattr(
        "sqlalchemy.ext.asyncio.create_async_engine",
        lambda *args, **kwargs: _fake_engine_instance2,
    )
    monkeypatch.setattr(sa_event, "listens_for", capture_engine_listens_for)
    monkeypatch.setattr(
        sa_event,
        "listen",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("listen failed")),
    )
    with caplog.at_level(logging.WARNING):
        reloaded = importlib.reload(database)
    assert "Failed to register cache invalidation hooks" in caplog.text

    monkeypatch.setenv("TESTING", "true")
    monkeypatch.setattr(
        "sqlalchemy.ext.asyncio.create_async_engine", fake_create_async_engine
    )
    monkeypatch.setattr(sa_event, "listen", lambda *args, **kwargs: None)
    monkeypatch.setattr(sa_event, "listens_for", lambda *args, **kwargs: (lambda fn: fn))
    restored = importlib.reload(database)
    assert restored.is_testing is True


def _reload_with_url(monkeypatch, url: str, fake_create_async_engine=None):
    """Helper: reload database module with a specific SQL URL."""
    class _FakeDbConfig:
        sql_connection_string = url

    class _FakeConfig:
        database_config = _FakeDbConfig()

    class _FakeSyncEngine:
        pass

    class _FakeAsyncEngine:
        def __init__(self):
            self.sync_engine = _FakeSyncEngine()

    if fake_create_async_engine is None:
        captured = {}

        def _engine(*args, **kwargs):
            captured["args"] = args
            captured["kwargs"] = kwargs
            return _FakeAsyncEngine()

        fake_create_async_engine = _engine

    monkeypatch.setenv("TESTING", "false")
    monkeypatch.setattr("config.config.get_learnhouse_config", lambda: _FakeConfig())
    monkeypatch.setattr("sqlalchemy.ext.asyncio.create_async_engine", fake_create_async_engine)
    monkeypatch.setattr(sa_event, "listens_for", lambda *a, **kw: (lambda fn: fn))
    monkeypatch.setattr(sa_event, "listen", lambda *a, **kw: None)
    return importlib.reload(database)


def test_psycopg2_url_is_rewritten_to_asyncpg(monkeypatch):
    """postgresql+psycopg2:// URLs must be rewritten to postgresql+asyncpg://."""
    received_urls = []

    def capture_engine(url, *args, **kwargs):
        received_urls.append(url)

        class _FakeSyncEngine:
            pass

        class _E:
            sync_engine = _FakeSyncEngine()

        return _E()

    _reload_with_url(monkeypatch, "postgresql+psycopg2://user:pw@host/db", capture_engine)
    assert received_urls[0].startswith("postgresql+asyncpg://"), received_urls[0]


def test_postgres_shorthand_url_is_rewritten_to_asyncpg(monkeypatch):
    """postgres:// (no 'ql') URLs must be rewritten to postgresql+asyncpg://."""
    received_urls = []

    def capture_engine(url, *args, **kwargs):
        received_urls.append(url)

        class _FakeSyncEngine:
            pass

        class _E:
            sync_engine = _FakeSyncEngine()

        return _E()

    _reload_with_url(monkeypatch, "postgres://user:pw@host/db", capture_engine)
    assert received_urls[0].startswith("postgresql+asyncpg://"), received_urls[0]


def _capture_engine_kwargs():
    """Engine factory that records the kwargs it was called with."""
    received = {}

    def capture_engine(url, *args, **kwargs):
        received.update(kwargs)

        class _FakeSyncEngine:
            pass

        class _E:
            sync_engine = _FakeSyncEngine()

        return _E()

    return received, capture_engine


def test_pooler_url_uses_small_pool_and_logs(monkeypatch, caplog):
    """A Supavisor pooler URL should trigger the small pool path and log a message."""
    received_kwargs, capture_engine = _capture_engine_kwargs()

    monkeypatch.delenv("LEARNHOUSE_DB_POOL_SIZE", raising=False)
    monkeypatch.delenv("LEARNHOUSE_DB_MAX_OVERFLOW", raising=False)

    # :6543/ is the Supavisor port; detected as a pooler
    with caplog.at_level(logging.INFO):
        _reload_with_url(monkeypatch, "postgresql://host:6543/db", capture_engine)

    # Two things have to hold at once, and the second is why 3 + 2 was wrong.
    #
    # (1) One process must not be able to claim a whole session-mode pooler on
    #     its own. That is the arithmetic that produced EMAXCONNSESSION (727
    #     events) when it was 5 + 10 = 15 per process against a 15-client
    #     Supavisor.
    ceiling = received_kwargs["pool_size"] + received_kwargs["max_overflow"]
    assert ceiling <= 10, f"a pooled process may hold {ceiling} connections"
    # (2) Steady-state capacity must not drop below what one uvicorn worker
    #     actually serves. pool_size was 5 before this change; cutting it turns
    #     a pooler-level error into in-process QueuePool timeouts (500s) without
    #     adding capacity anywhere.
    assert received_kwargs["pool_size"] >= 5, (
        "shrinking pool_size below its previous value trades a pooler error for "
        "an in-process one"
    )
    # Saturation should degrade into latency, not an immediate 5xx — but stay
    # under SQLAlchemy's 30s default, because /health takes a session from this
    # same pool and a 30s wait there outlasts every k8s probe timeout.
    assert 10 < received_kwargs["pool_timeout"] < 30
    assert "connection pooler" in caplog.text
    # The deployed numbers have to be visible in the pod logs, not just in
    # source, and so does the rule ops must satisfy to change them.
    assert "pool_size=" in caplog.text and "max_overflow=" in caplog.text
    assert "pool_timeout=" in caplog.text
    assert "more than one replica" in caplog.text


def test_pool_size_is_configurable_from_the_environment(monkeypatch, caplog):
    """The pooled ceiling must follow the pooler's limit without a code change."""
    received_kwargs, capture_engine = _capture_engine_kwargs()

    monkeypatch.setenv("LEARNHOUSE_DB_POOL_SIZE", "7")
    monkeypatch.setenv("LEARNHOUSE_DB_MAX_OVERFLOW", "1")
    with caplog.at_level(logging.INFO):
        _reload_with_url(monkeypatch, "postgresql://host:6543/db", capture_engine)

    assert received_kwargs["pool_size"] == 7
    assert received_kwargs["max_overflow"] == 1
    assert "pool_size=7" in caplog.text

    # A direct (non-pooled) connection honours the same two variables.
    received_kwargs, capture_engine = _capture_engine_kwargs()
    _reload_with_url(monkeypatch, "postgresql://host:5432/db", capture_engine)
    assert received_kwargs["pool_size"] == 7
    assert received_kwargs["max_overflow"] == 1


def test_unparsable_pool_env_falls_back_to_the_safe_default(monkeypatch, caplog):
    """A typo in the env must not silently produce an unbounded or zero pool."""
    received_kwargs, capture_engine = _capture_engine_kwargs()

    monkeypatch.setenv("LEARNHOUSE_DB_POOL_SIZE", "lots")
    monkeypatch.setenv("LEARNHOUSE_DB_MAX_OVERFLOW", "-4")
    with caplog.at_level(logging.WARNING):
        _reload_with_url(monkeypatch, "postgresql://host:6543/db", capture_engine)

    assert received_kwargs["pool_size"] + received_kwargs["max_overflow"] <= 10
    assert received_kwargs["pool_size"] >= 5
    assert "LEARNHOUSE_DB_POOL_SIZE" in caplog.text
    assert "LEARNHOUSE_DB_MAX_OVERFLOW" in caplog.text


def test_saturated_pooler_is_transient_but_bad_credentials_are_not():
    """EMAXCONNSESSION must be retried; a permanent error must fail fast.

    The marker list is the whole transient/permanent split. A bare
    "does not exist" used to be in it, which swallowed every missing-relation
    and missing-column message. Anchoring on the `database "` prefix alone was
    still too loose — it claimed any error that merely quotes a database name —
    so the rule now requires BOTH halves: a quoted database/role identifier AND
    "does not exist".
    """
    transient = [
        "(EMAXCONNSESSION) max clients reached in session mode - "
        "max clients are limited to pool_size: 15",
        "connection was closed in the middle of operation",
        'column organization.is_demo does not exist',
        'relation "organization" does not exist',
        # A pooler/proxy message that merely quotes the database name. The
        # `database "` prefix on its own classified this as permanent and
        # skipped the retry entirely.
        'could not route to database "learnhouse": upstream unavailable',
        'server closed the connection unexpectedly (database "learnhouse")',
    ]
    permanent = [
        'password authentication failed for user "postgres"',
        'database "learnhouse" does not exist',
        'role "postgres" does not exist',
        "no pg_hba.conf entry for host",
        "permission denied for database",
    ]

    for message in transient:
        assert database._is_transient_connect_error(Exception(message)), message
    for message in permanent:
        assert not database._is_transient_connect_error(Exception(message)), message


class _DriftConnection:
    """Minimal async connection returning one alembic_version row."""

    def __init__(self, row):
        self._row = row

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False

    async def execute(self, statement):
        return _FakeResult(self._row)


class _DriftEngine:
    def __init__(self, row=None, error=None):
        self.row = row
        self.error = error

    def connect(self):
        if self.error is not None:
            raise self.error
        return _DriftConnection(self.row)


async def test_schema_drift_is_reported_with_both_revisions(monkeypatch, caplog):
    """A database behind the code's migrations must name both revisions once."""
    monkeypatch.setattr(database, "is_testing", False)
    # The check is skipped when the entrypoint owns migrations (the default),
    # because the boot is already gated on `alembic upgrade head`. It exists for
    # deployments where an external Job owns them and nothing else would notice.
    monkeypatch.setenv("LEARNHOUSE_RUN_MIGRATIONS", "false")
    monkeypatch.setattr(database, "_alembic_head_revision", lambda: "headrev")
    monkeypatch.setattr(database, "engine", _DriftEngine(row=("oldrev",)))

    with caplog.at_level(logging.ERROR):
        await database._log_schema_drift()

    assert "oldrev" in caplog.text and "headrev" in caplog.text
    assert "alembic upgrade head" in caplog.text


async def test_schema_drift_is_silent_when_in_sync_and_never_raises(monkeypatch, caplog):
    """No noise at head, and a failing probe must never take down a boot."""
    monkeypatch.setattr(database, "is_testing", False)
    # The check is skipped when the entrypoint owns migrations (the default),
    # because the boot is already gated on `alembic upgrade head`. It exists for
    # deployments where an external Job owns them and nothing else would notice.
    monkeypatch.setenv("LEARNHOUSE_RUN_MIGRATIONS", "false")
    monkeypatch.setattr(database, "_alembic_head_revision", lambda: "headrev")
    monkeypatch.setattr(database, "engine", _DriftEngine(row=("headrev",)))
    with caplog.at_level(logging.ERROR):
        await database._log_schema_drift()
    assert caplog.text == ""

    # No alembic_version table at all (a create_all-only database) — the boot
    # continues; the entrypoint's `alembic upgrade head` is what gates it.
    monkeypatch.setattr(
        database,
        "engine",
        _DriftEngine(error=RuntimeError('relation "alembic_version" does not exist')),
    )
    with caplog.at_level(logging.ERROR):
        await database._log_schema_drift()
    assert caplog.text == ""


async def test_schema_drift_check_is_skipped_when_the_entrypoint_migrates(monkeypatch, caplog):
    """Don't pay for the check when the boot is already gated on migrations.

    Resolving the head makes alembic execute all 66 files in migrations/versions
    as Python modules. With LEARNHOUSE_RUN_MIGRATIONS at its default the
    entrypoint has already run `alembic upgrade head` and failed the boot if it
    did not succeed, so the answer is known.
    """
    calls = []
    monkeypatch.setattr(database, "is_testing", False)
    monkeypatch.setenv("LEARNHOUSE_RUN_MIGRATIONS", "true")
    monkeypatch.setattr(
        database, "_alembic_head_revision", lambda: calls.append(1) or "headrev"
    )
    monkeypatch.setattr(database, "engine", _DriftEngine(row=("oldrev",)))

    with caplog.at_level(logging.ERROR):
        await database._log_schema_drift()

    assert calls == []
    assert caplog.text == ""


def test_alembic_head_revision_is_memoised(monkeypatch):
    """Once per process, not once per call — it executes 66 modules."""
    monkeypatch.setattr(database, "_alembic_head_cache", None)
    first = database._alembic_head_revision()
    assert first
    assert database._alembic_head_cache == first
    monkeypatch.setattr(database, "_alembic_head_cache", "sentinel")
    assert database._alembic_head_revision() == "sentinel"


def test_alembic_head_revision_resolves_to_a_single_head():
    """`alembic upgrade head` in the entrypoint is only unambiguous with one head.

    Two heads would make the migration step in docker-entrypoint.sh fail on
    every pod boot, which is the same crash loop by another route.
    """
    assert database._alembic_head_revision()
