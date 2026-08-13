import asyncio
import logging
from types import SimpleNamespace

import pytest

import src.core.ee_hooks as ee_hooks
import src.core.events.autoinstall as autoinstall
import src.core.events.content as content
import src.core.events.events as events
import src.core.events.logs as logs


class _FakeScalars:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


class _FakeResult:
    def __init__(self, row):
        self._row = row

    def scalars(self):
        return _FakeScalars(self._row)


class _FakeAsyncSession:
    """Stands in for a session from the application-wide session factory."""

    def __init__(self, row, opened, error=None):
        self.row = row
        self.error = error
        self._opened = opened

    async def execute(self, statement):
        if self.error is not None:
            raise self.error
        return _FakeResult(self.row)

    async def __aenter__(self):
        self._opened.append(self)
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _patch_session_factory(monkeypatch, row, error=None):
    opened = []
    monkeypatch.setattr(
        autoinstall,
        "_async_session_factory",
        lambda: _FakeAsyncSession(row, opened, error),
    )
    return opened


async def test_auto_install_triggers_install_when_no_orgs_exist(monkeypatch):
    installs = []
    refreshes = []

    async def fake_install_async(short=False):
        installs.append(short)

    _patch_session_factory(monkeypatch, None)
    monkeypatch.setattr(autoinstall, "_install_async", fake_install_async)
    monkeypatch.setattr(autoinstall, "install_default_elements", lambda db: refreshes.append(db))

    await autoinstall.auto_install()

    assert installs == [True]
    # Fresh bootstrap path returns before the refresh helper runs.
    assert refreshes == []


async def test_auto_install_refreshes_default_roles_when_any_org_exists(monkeypatch):
    installs = []
    refreshes = []

    async def fake_install_async(short=False):
        installs.append(short)

    async def fake_install_default_elements(db):
        refreshes.append(db)

    opened = _patch_session_factory(monkeypatch, object())
    monkeypatch.setattr(autoinstall, "_install_async", fake_install_async)
    monkeypatch.setattr(autoinstall, "install_default_elements", fake_install_default_elements)

    await autoinstall.auto_install()

    assert installs == []
    # Existing install: role refresh always runs so new permission keys land.
    assert len(refreshes) == 1
    # Both steps borrow the application engine — no private pool is opened here.
    assert len(opened) == 2


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
def test_init_logging_attaches_a_stdout_handler():
    """Until this runs the root logger has no handler, so Python's fallback
    drops everything below WARNING and every logger.info in the codebase is
    invisible in production."""
    root = logging.getLogger()
    before = list(root.handlers)
    try:
        root.handlers = []
        logs.init_logging()

        ours = [h for h in root.handlers if getattr(h, "_learnhouse", False)]
        assert len(ours) == 1
        assert isinstance(ours[0], logging.StreamHandler)
        assert root.level == logging.INFO
    finally:
        root.handlers = before


def test_init_logging_is_idempotent():
    """Startup can run more than once in a process; a second call must not
    double every log line."""
    root = logging.getLogger()
    before = list(root.handlers)
    try:
        root.handlers = []
        logs.init_logging()
        logs.init_logging()
        assert len([h for h in root.handlers if getattr(h, "_learnhouse", False)]) == 1
    finally:
        root.handlers = before


def test_init_logging_honours_an_explicit_level(monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_LOG_LEVEL", "WARNING")
    root = logging.getLogger()
    before, before_level = list(root.handlers), root.level
    try:
        root.handlers = []
        logs.init_logging()
        assert root.level == logging.WARNING
    finally:
        root.handlers, root.level = before, before_level


def test_init_logging_leaves_uvicorn_handlers_alone():
    """basicConfig(force=True) would tear these down and take the access log
    with it."""
    root = logging.getLogger()
    before = list(root.handlers)
    sentinel = logging.NullHandler()
    try:
        root.handlers = [sentinel]
        logs.init_logging()
        assert sentinel in root.handlers
    finally:
        root.handlers = before


def test_is_ee_available(monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_DISABLE_EE", "1")
    assert ee_hooks.is_ee_available() is False

    monkeypatch.delenv("LEARNHOUSE_DISABLE_EE", raising=False)
    monkeypatch.setattr(ee_hooks.os.path, "isdir", lambda path: True)
    monkeypatch.setattr(ee_hooks.os.path, "isfile", lambda path: True)
    assert ee_hooks.is_ee_available() is True

    # A directory named "ee" with no hooks.py imports nothing, so it does not
    # count as EE being available.
    monkeypatch.setattr(ee_hooks.os.path, "isfile", lambda path: False)
    assert ee_hooks.is_ee_available() is False

    monkeypatch.setattr(ee_hooks.os.path, "isdir", lambda path: False)
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

    async def fake_reconcile_packs():
        calls.append("reconcile")

    async def fake_auto_install():
        calls.append("install")

    monkeypatch.setattr(events, "connect_to_db", connect_to_db)
    monkeypatch.setattr(events, "create_logs_dir", create_logs_dir)
    monkeypatch.setattr(events, "check_content_directory", check_content_directory)
    monkeypatch.setattr(events, "auto_install", fake_auto_install)
    monkeypatch.setattr(events, "_reconcile_packs", fake_reconcile_packs)
    monkeypatch.setattr(events, "run_ee_startup", lambda app_: calls.append(("ee", app_)))
    monkeypatch.setattr(
        "src.services.courses.migration.migration_service.cleanup_old_temp_migrations",
        lambda: calls.append("cleanup"),
    )

    created_tasks = []

    class _FakeTask:
        def cancel(self):
            calls.append("cancel")

        def __await__(self):
            # shutdown_app awaits the task after cancelling; simulate the
            # cancellation completing by raising CancelledError, matching the
            # real asyncio.Task contract.
            raise asyncio.CancelledError
            yield  # pragma: no cover - unreachable, makes this a generator

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


@pytest.mark.asyncio
async def test_reconcile_packs_success_and_failure(monkeypatch, caplog):
    import contextlib
    reconciled = []

    # _reconcile_packs is now async and uses _async_session_factory from database.
    # Patch the factory at the import location used inside events._reconcile_packs.
    fake_session = SimpleNamespace()

    @contextlib.asynccontextmanager
    async def fake_session_factory():
        yield fake_session

    monkeypatch.setattr(
        "src.core.events.database._async_session_factory",
        fake_session_factory,
    )

    async def fake_reconcile_credits(db_session):
        reconciled.append(db_session)
        return "ok"

    monkeypatch.setattr(
        "src.services.packs.packs.reconcile_pack_credits",
        fake_reconcile_credits,
    )

    await events._reconcile_packs()
    assert reconciled == [fake_session]

    async def boom_reconcile(db_session):
        raise RuntimeError("boom")

    monkeypatch.setattr(
        "src.services.packs.packs.reconcile_pack_credits",
        boom_reconcile,
    )

    with caplog.at_level(logging.WARNING):
        await events._reconcile_packs()

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
