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
    app = SimpleNamespace()

    await database.connect_to_db(app)
    assert app.db_engine is database.engine

    generator = database.get_db_session()
    session = next(generator)
    assert isinstance(session, Session)
    assert session.get_bind() is database.engine
    generator.close()

    assert await database.close_database(app) is app


def test_register_cache_hooks_cover_listener_paths_and_commit_cleanup(db, monkeypatch):
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
    db.flush()

    org_after_insert(None, None, org)
    assert db._org_slugs_to_invalidate == {"org-slug"}

    org.slug = "org-slug-renamed"
    org_after_update(None, None, org)
    assert db._org_slugs_to_invalidate == {"org-slug", "org-slug-renamed"}

    org_after_delete(None, None, org)
    assert db._org_slugs_to_invalidate == {"org-slug", "org-slug-renamed"}

    org_config = OrganizationConfig(org_id=org.id, config={})
    db.add(org_config)
    db.flush()
    org_config_changed(None, db.connection(), org_config)
    assert db._org_slugs_to_invalidate == {"org-slug", "org-slug-renamed"}

    course = Course(
        name="Course",
        org_id=org.id,
        course_uuid="course-uuid",
        public=True,
        open_to_contributors=False,
    )
    db.add(course)
    db.flush()
    course_changed(None, db.connection(), course)
    assert db._course_uuids_to_invalidate == {"course-uuid"}
    assert db._org_slugs_to_invalidate == {"org-slug", "org-slug-renamed"}

    chapter = Chapter(name="Chapter", org_id=org.id, course_id=course.id)
    db.add(chapter)
    db.flush()
    child_changed(None, db.connection(), chapter)
    assert db._course_uuids_to_invalidate == {"course-uuid"}

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

    after_commit(db)
    assert set(org_cache_calls) == {"org-slug", "org-slug-renamed"}
    assert set(course_cache_calls) == {"org-slug", "org-slug-renamed"}
    assert course_meta_cache_calls == ["course-uuid"]
    assert db._org_slugs_to_invalidate == set()
    assert db._course_uuids_to_invalidate == set()

    db._org_slugs_to_invalidate = {"rollback-slug"}
    db._course_uuids_to_invalidate = {"rollback-course"}
    after_rollback(db)
    assert db._org_slugs_to_invalidate == set()
    assert db._course_uuids_to_invalidate == set()


def test_register_cache_hooks_cover_early_returns_and_history_failure(db, monkeypatch):
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

    monkeypatch.setattr(database.Session, "object_session", lambda target: db)
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
    db.flush()
    org.slug = "history-org-renamed"
    db._org_slugs_to_invalidate = set()
    bad_org_after_update(None, None, org)
    assert db._org_slugs_to_invalidate == {"history-org-renamed"}


def test_register_cache_hooks_cover_fallback_queries_and_commit_warning(db, monkeypatch, caplog):
    registrations = _capture_hooks(
        monkeypatch,
        inspect_stub=lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("inspect failed")),
    )

    org_config_changed = registrations[(OrganizationConfig, "after_update")]
    course_changed = registrations[(Course, "after_update")]
    child_changed = registrations[(Activity, "after_update")]
    after_commit = registrations[(Session, "after_commit")]

    monkeypatch.setattr(database.Session, "object_session", lambda target: db)

    org_config = OrganizationConfig(org_id=404, config={})
    db.add(org_config)
    db.flush()
    org_config_connection = _FakeConnection(row=("fallback-org",))
    org_config_changed(None, org_config_connection, org_config)
    assert org_config_connection.executed
    assert "fallback-org" in db._org_slugs_to_invalidate

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
    db.flush()
    course_connection = _FakeConnection(row=("fallback-org-course",))
    course_changed(None, course_connection, course)
    assert course_connection.executed
    assert "fallback-course" in db._course_uuids_to_invalidate
    assert "fallback-org-course" in db._org_slugs_to_invalidate

    course_error_connection = _FakeConnection(error=RuntimeError("query failed"))
    course_changed(None, course_error_connection, course)

    chapter = Chapter(name="Fallback Chapter", org_id=404, course_id=course.id)
    db.add(chapter)
    db.flush()
    child_connection = _FakeConnection(row=("fallback-course-meta",))
    child_changed(None, child_connection, chapter)
    assert child_connection.executed
    assert "fallback-course-meta" in db._course_uuids_to_invalidate

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
    db._org_slugs_to_invalidate = {"commit-slug"}
    db._course_uuids_to_invalidate = {"commit-course"}

    with caplog.at_level(logging.WARNING):
        after_commit(db)

    assert "Cache invalidation after commit failed" in caplog.text
    assert db._org_slugs_to_invalidate == set()
    assert db._course_uuids_to_invalidate == set()


def test_reload_module_covers_production_branch(monkeypatch, caplog):
    class _FakeDatabaseConfig:
        sql_connection_string = "postgresql://example"

    class _FakeConfig:
        database_config = _FakeDatabaseConfig()

    class _EngineConnection:
        def __init__(self, fail_execute=False):
            self.fail_execute = fail_execute
            self.executed = []

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, statement):
            self.executed.append(statement)
            if self.fail_execute:
                raise RuntimeError("vector extension unavailable")

        def commit(self):
            self.executed.append("commit")

    class _FakeEngine:
        def __init__(self, fail_execute=False):
            self.fail_execute = fail_execute
            self.connections = []

        def connect(self):
            connection = _EngineConnection(fail_execute=self.fail_execute)
            self.connections.append(connection)
            return connection

    engine_callbacks = {}

    def capture_engine_listens_for(target, event_name):
        def decorator(fn):
            engine_callbacks[(target, event_name)] = fn
            return fn

        return decorator

    def fake_create_engine(*args, **kwargs):
        return _FakeEngine(fail_execute=False)

    monkeypatch.setenv("TESTING", "false")
    monkeypatch.setattr("config.config.get_learnhouse_config", lambda: _FakeConfig())
    monkeypatch.setattr("sqlmodel.create_engine", fake_create_engine)
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
    assert (reloaded.engine, "connect") in engine_callbacks
    assert (reloaded.engine, "checkout") in engine_callbacks
    assert (reloaded.engine, "checkin") in engine_callbacks

    engine_callbacks[(reloaded.engine, "connect")](None, None)
    engine_callbacks[(reloaded.engine, "checkout")](None, None, None)
    engine_callbacks[(reloaded.engine, "checkin")](None, None)
    assert reloaded.engine.connections[0].executed
    assert "commit" in reloaded.engine.connections[0].executed

    monkeypatch.setattr(
        "sqlmodel.create_engine",
        lambda *args, **kwargs: _FakeEngine(fail_execute=True),
    )
    monkeypatch.setattr(sa_event, "listens_for", capture_engine_listens_for)
    monkeypatch.setattr(sa_event, "listen", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("listen failed")))
    with caplog.at_level(logging.WARNING):
        reloaded = importlib.reload(database)
    assert "pgvector extension not available" in caplog.text
    assert "Failed to register cache invalidation hooks" in caplog.text

    monkeypatch.setenv("TESTING", "true")
    monkeypatch.setattr("sqlmodel.create_engine", fake_create_engine)
    monkeypatch.setattr(sa_event, "listen", lambda *args, **kwargs: None)
    monkeypatch.setattr(sa_event, "listens_for", lambda *args, **kwargs: (lambda fn: fn))
    restored = importlib.reload(database)
    assert restored.is_testing is True
