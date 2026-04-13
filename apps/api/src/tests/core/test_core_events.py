import asyncio
import logging
from types import SimpleNamespace

import pytest

import src.core.ee_hooks as ee_hooks
import src.core.events.autoinstall as autoinstall
import src.core.events.content as content
import src.core.events.events as events
import src.core.events.logs as logs


class _FakeResult:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


class _FakeSession:
    def __init__(self, engine, row=None, error=None):
        self.engine = engine
        self.row = row
        self.error = error
        self.closed = False

    def exec(self, statement):
        if self.error is not None:
            raise self.error
        return _FakeResult(self.row)

    def close(self):
        self.closed = True


def test_auto_install_triggers_install_when_default_org_missing(monkeypatch):
    created_engines = []
    created_tables = []
    installs = []

    config = SimpleNamespace(database_config=SimpleNamespace(sql_connection_string="sqlite:///test.db"))

    monkeypatch.setattr(autoinstall, "get_learnhouse_config", lambda: config)
    monkeypatch.setattr(autoinstall, "create_engine", lambda *args, **kwargs: created_engines.append((args, kwargs)) or object())
    monkeypatch.setattr(autoinstall.SQLModel.metadata, "create_all", lambda engine: created_tables.append(engine))
    monkeypatch.setattr(autoinstall, "Session", lambda engine: _FakeSession(engine, row=None))
    monkeypatch.setattr(autoinstall, "install", lambda short: installs.append(short))

    autoinstall.auto_install()

    assert created_engines
    assert created_tables
    assert installs == [True]


def test_auto_install_skips_install_when_default_org_exists(monkeypatch):
    created_tables = []
    installs = []

    config = SimpleNamespace(database_config=SimpleNamespace(sql_connection_string="sqlite:///test.db"))

    monkeypatch.setattr(autoinstall, "get_learnhouse_config", lambda: config)
    monkeypatch.setattr(autoinstall, "create_engine", lambda *args, **kwargs: object())
    monkeypatch.setattr(autoinstall.SQLModel.metadata, "create_all", lambda engine: created_tables.append(engine))
    monkeypatch.setattr(autoinstall, "Session", lambda engine: _FakeSession(engine, row=object()))
    monkeypatch.setattr(autoinstall, "install", lambda short: installs.append(short))

    autoinstall.auto_install()

    assert created_tables
    assert installs == []


@pytest.mark.asyncio
async def test_check_content_directory_creates_directory_when_missing(monkeypatch):
    calls = []
    monkeypatch.setattr(content.os.path, "exists", lambda path: False)
    monkeypatch.setattr(content.os, "makedirs", lambda path: calls.append(path))

    await content.check_content_directory()

    assert calls == ["content"]


@pytest.mark.asyncio
async def test_check_content_directory_skips_existing_directory(monkeypatch):
    calls = []
    monkeypatch.setattr(content.os.path, "exists", lambda path: True)
    monkeypatch.setattr(content.os, "makedirs", lambda path: calls.append(path))

    await content.check_content_directory()

    assert calls == []


@pytest.mark.asyncio
async def test_create_logs_dir_creates_missing_directory(monkeypatch):
    calls = []
    monkeypatch.setattr(logs.os.path, "exists", lambda path: False)
    monkeypatch.setattr(logs.os, "mkdir", lambda path: calls.append(path))

    await logs.create_logs_dir()

    assert calls == ["logs"]


@pytest.mark.asyncio
async def test_init_logging_configures_logging(monkeypatch):
    calls = []

    async def create_logs_dir():
        calls.append("create")

    monkeypatch.setattr(logs, "create_logs_dir", create_logs_dir)
    monkeypatch.setattr(logs.logging, "FileHandler", lambda *args, **kwargs: object())
    monkeypatch.setattr(logs.logging, "StreamHandler", lambda *args, **kwargs: object())
    monkeypatch.setattr(logs.logging, "basicConfig", lambda **kwargs: calls.append(kwargs))
    monkeypatch.setattr(logs.logging, "info", lambda message: calls.append(message))

    await logs.init_logging()

    assert calls[0] == "create"
    assert calls[1]["level"] == logging.INFO
    assert calls[-1] == "Logging initiated"


def test_is_ee_available(monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_DISABLE_EE", "1")
    assert ee_hooks.is_ee_available() is False

    monkeypatch.delenv("LEARNHOUSE_DISABLE_EE", raising=False)
    monkeypatch.setattr(ee_hooks.os.path, "exists", lambda path: True)
    assert ee_hooks.is_ee_available() is True

    monkeypatch.setattr(ee_hooks.os.path, "exists", lambda path: False)
    assert ee_hooks.is_ee_available() is False


def test_get_ee_hooks_handles_missing_module_and_import_errors(monkeypatch, caplog):
    monkeypatch.setattr(ee_hooks, "is_ee_available", lambda: False)
    assert ee_hooks.get_ee_hooks() is None

    monkeypatch.setattr(ee_hooks, "is_ee_available", lambda: True)
    monkeypatch.setattr(ee_hooks.importlib.util, "find_spec", lambda name: None)
    assert ee_hooks.get_ee_hooks() is None

    class _BoomImport:
        def __call__(self, name):
            raise ImportError("boom")

    monkeypatch.setattr(ee_hooks.importlib.util, "find_spec", lambda name: object())
    monkeypatch.setattr(ee_hooks.importlib, "import_module", _BoomImport())
    with caplog.at_level(logging.ERROR):
        assert ee_hooks.get_ee_hooks() is None
    assert "Failed to import EE hooks" in caplog.text


def test_get_ee_hooks_returns_module_when_available(monkeypatch):
    sentinel = SimpleNamespace(name="hooks")
    monkeypatch.setattr(ee_hooks, "is_ee_available", lambda: True)
    monkeypatch.setattr(ee_hooks.importlib.util, "find_spec", lambda name: object())
    monkeypatch.setattr(ee_hooks.importlib, "import_module", lambda name: sentinel)

    assert ee_hooks.get_ee_hooks() is sentinel


def test_get_ee_hooks_handles_unexpected_errors(monkeypatch, caplog):
    monkeypatch.setattr(ee_hooks, "is_ee_available", lambda: True)
    monkeypatch.setattr(ee_hooks.importlib.util, "find_spec", lambda name: object())
    monkeypatch.setattr(ee_hooks.importlib, "import_module", lambda name: (_ for _ in ()).throw(RuntimeError("boom")))

    with caplog.at_level(logging.ERROR):
        assert ee_hooks.get_ee_hooks() is None

    assert "Unexpected error loading EE hooks" in caplog.text


def test_register_ee_helpers_and_startup(monkeypatch):
    calls = []

    hooks = SimpleNamespace(
        register_middlewares=lambda app: calls.append(("middlewares", app)),
        register_routers=lambda router: calls.append(("routers", router)),
        on_startup=lambda app: calls.append(("startup", app)),
    )
    monkeypatch.setattr(ee_hooks, "get_ee_hooks", lambda: hooks)

    app = object()
    router = object()
    ee_hooks.register_ee_middlewares(app)
    ee_hooks.register_ee_routers(router)
    ee_hooks.run_ee_startup(app)

    assert calls == [("middlewares", app), ("routers", router), ("startup", app)]


def test_register_ee_helpers_skip_when_hook_missing(monkeypatch):
    monkeypatch.setattr(ee_hooks, "get_ee_hooks", lambda: SimpleNamespace())

    ee_hooks.register_ee_middlewares(object())
    ee_hooks.register_ee_routers(object())
    ee_hooks.run_ee_startup(object())


def test_is_multi_org_allowed(monkeypatch):
    monkeypatch.setattr("src.core.deployment_mode.get_deployment_mode", lambda: "ee")
    assert ee_hooks.is_multi_org_allowed() is True

    monkeypatch.setattr("src.core.deployment_mode.get_deployment_mode", lambda: "local")
    assert ee_hooks.is_multi_org_allowed() is False


@pytest.mark.asyncio
async def test_check_ee_activity_paid_access(monkeypatch):
    calls = []

    async def check_activity_paid_access(request, activity_id, user, db_session):
        calls.append((request, activity_id, user, db_session))
        return False

    hooks = SimpleNamespace(check_activity_paid_access=check_activity_paid_access)
    monkeypatch.setattr(ee_hooks, "get_ee_hooks", lambda: hooks)

    result = await ee_hooks.check_ee_activity_paid_access("req", 7, "user", "db")
    assert result is False
    assert calls == [("req", 7, "user", "db")]


@pytest.mark.asyncio
async def test_check_ee_activity_paid_access_defaults_to_free(monkeypatch):
    monkeypatch.setattr(ee_hooks, "get_ee_hooks", lambda: None)

    result = await ee_hooks.check_ee_activity_paid_access("req", 7, "user", "db")
    assert result is True


@pytest.mark.asyncio
async def test_startup_and_shutdown_app(monkeypatch):
    app = SimpleNamespace()
    calls = []

    monkeypatch.setattr(events, "get_learnhouse_config", lambda: SimpleNamespace(name="cfg"))

    async def connect_to_db(app_):
        calls.append(("connect", app_))

    async def create_logs_dir():
        calls.append("logs")

    async def check_content_directory():
        calls.append("content")

    monkeypatch.setattr(events, "connect_to_db", connect_to_db)
    monkeypatch.setattr(events, "create_logs_dir", create_logs_dir)
    monkeypatch.setattr(events, "check_content_directory", check_content_directory)
    monkeypatch.setattr(events, "auto_install", lambda: calls.append("install"))
    monkeypatch.setattr(events, "_reconcile_packs", lambda: calls.append("reconcile"))
    monkeypatch.setattr(events, "run_ee_startup", lambda app_: calls.append(("ee", app_)))
    monkeypatch.setattr(
        "src.services.courses.migration.migration_service.cleanup_old_temp_migrations",
        lambda: calls.append("cleanup"),
    )

    created_tasks = []

    class _FakeTask:
        def cancel(self):
            calls.append("cancel")

    def create_task(coro):
        created_tasks.append(coro)
        coro.close()
        return _FakeTask()

    monkeypatch.setattr(events.asyncio, "create_task", create_task)

    start_app = events.startup_app(app)
    await start_app()

    assert app.learnhouse_config.name == "cfg"
    assert calls[:5] == [("connect", app), "logs", "content", "install", "reconcile"]
    assert "cleanup" in calls
    assert calls[-1] == ("ee", app)
    assert created_tasks

    async def fake_close_webhook_client():
        calls.append("webhook-close")

    async def fake_close_database(app_):
        calls.append(("db-close", app_))

    monkeypatch.setattr("src.services.webhooks.dispatch.close_webhook_client", fake_close_webhook_client)
    monkeypatch.setattr(events, "close_database", fake_close_database)
    events._cleanup_task = _FakeTask()

    close_app = events.shutdown_app(app)
    await close_app()

    assert "cancel" in calls
    assert "webhook-close" in calls
    assert ("db-close", app) in calls


def test_reconcile_packs_success_and_failure(monkeypatch, caplog):
    config = SimpleNamespace(database_config=SimpleNamespace(sql_connection_string="sqlite:///packs.db"))
    created_sessions = []
    reconciled = []

    class _SessionFactory:
        def __init__(self, engine):
            created_sessions.append(engine)
            self.session = _FakeSession(engine)

        def __getattr__(self, name):
            return getattr(self.session, name)

    monkeypatch.setattr(events, "get_learnhouse_config", lambda: config)
    monkeypatch.setattr("sqlalchemy.create_engine", lambda *args, **kwargs: object())
    monkeypatch.setattr("sqlmodel.Session", lambda engine: _SessionFactory(engine))
    monkeypatch.setattr(
        "src.services.packs.packs.reconcile_pack_credits",
        lambda db_session: reconciled.append(db_session) or "ok",
    )

    events._reconcile_packs()
    assert created_sessions
    assert reconciled

    monkeypatch.setattr(
        "src.services.packs.packs.reconcile_pack_credits",
        lambda db_session: (_ for _ in ()).throw(RuntimeError("boom")),
    )

    with caplog.at_level(logging.WARNING):
        events._reconcile_packs()

    assert "Pack reconciliation skipped (non-fatal)" in caplog.text


@pytest.mark.asyncio
async def test_periodic_migration_cleanup_logs_and_exits(monkeypatch, caplog):
    calls = []

    async def fake_sleep(delay):
        calls.append(delay)
        if len(calls) > 1:
            raise asyncio.CancelledError

    monkeypatch.setattr(events.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(
        "src.services.courses.migration.migration_service.cleanup_old_temp_migrations",
        lambda: (_ for _ in ()).throw(RuntimeError("cleanup failed")),
    )

    with caplog.at_level(logging.WARNING):
        with pytest.raises(asyncio.CancelledError):
            await events._periodic_migration_cleanup()

    assert "Periodic migration cleanup failed" in caplog.text
