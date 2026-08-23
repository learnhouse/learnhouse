"""Runtime coverage for core event helpers and EE hooks."""

import asyncio
import contextlib
import inspect
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

import src.core.ee_hooks as ee_hooks
import src.core.events.autoinstall as autoinstall
import src.core.events.content as content_events
import src.core.events.events as core_events
import src.core.events.logs as logs_events


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

    def first(self):
        return self._row


class _FakeAsyncSession:
    """Stands in for a session handed out by ``_async_session_factory``."""

    def __init__(self, row, opened):
        self.row = row
        self._opened = opened

    async def execute(self, statement):
        return _FakeResult(self.row)

    async def __aenter__(self):
        self._opened.append(self)
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _patch_session_factory(monkeypatch, row):
    """Point autoinstall at a fake application session factory.

    The real one is the app-wide engine — the whole point of the module is that
    it must not build a second one.
    """
    opened = []
    monkeypatch.setattr(
        autoinstall, "_async_session_factory", lambda: _FakeAsyncSession(row, opened)
    )
    return opened


@pytest.mark.asyncio
async def test_auto_install_bootstraps_when_no_org_exists(monkeypatch):
    installs = []
    refreshes = []

    opened = _patch_session_factory(monkeypatch, None)

    async def fake_install_async(short=True):
        installs.append(short)

    async def fake_install_default_elements(db):
        refreshes.append(db)

    monkeypatch.setattr(autoinstall, "_install_async", fake_install_async)
    monkeypatch.setattr(autoinstall, "install_default_elements", fake_install_default_elements)

    await autoinstall.auto_install()

    assert installs == [True]
    assert refreshes == []  # bootstrap path returns before the role refresh
    assert len(opened) == 1  # only the org lookup


@pytest.mark.asyncio
async def test_auto_install_refreshes_roles_when_org_exists(monkeypatch):
    installs = []
    refreshes = []

    opened = _patch_session_factory(monkeypatch, SimpleNamespace(slug="anything"))

    async def fake_install_async(short=True):
        installs.append(short)

    async def fake_install_default_elements(db):
        refreshes.append(db)

    monkeypatch.setattr(autoinstall, "_install_async", fake_install_async)
    monkeypatch.setattr(autoinstall, "install_default_elements", fake_install_default_elements)

    await autoinstall.auto_install()

    assert installs == []
    assert len(refreshes) == 1
    assert len(opened) == 2  # org lookup + role refresh, both on the app engine


@pytest.mark.asyncio
async def test_auto_install_role_refresh_failure_is_non_fatal(monkeypatch):
    _patch_session_factory(monkeypatch, SimpleNamespace(slug="anything"))

    async def boom(db):
        raise RuntimeError("db went away mid-refresh")

    monkeypatch.setattr(autoinstall, "install_default_elements", boom)

    # Must not propagate: a failed role refresh cannot be allowed to abort boot.
    await autoinstall.auto_install()


@pytest.mark.asyncio
async def test_auto_install_does_not_create_its_own_engine():
    """Regression guard for the duplicate-pool startup crash loop.

    A second engine here doubled each pod's connection count against the
    Postgres pooler; when the pooler ran out of clients the extra pool raised
    during startup, the boot aborted, and the restart opened even more
    connections.
    """
    source = inspect.getsource(autoinstall)
    assert "create_engine" not in source
    assert "create_async_engine" not in source


@pytest.mark.asyncio
async def test_content_and_logs_helpers(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)

    created_dirs = []
    monkeypatch.setattr(
        content_events.os.path,
        "exists",
        lambda path: path == "content",
    )
    monkeypatch.setattr(content_events.os, "makedirs", lambda path: created_dirs.append(path))
    await content_events.check_content_directory()
    assert created_dirs == []

    monkeypatch.setattr(content_events.os.path, "exists", lambda path: False)
    await content_events.check_content_directory()
    assert created_dirs == ["content"]

    mkdir_calls = []
    monkeypatch.setattr(logs_events.os.path, "exists", lambda path: path == "logs")
    monkeypatch.setattr(logs_events.os, "mkdir", lambda path: mkdir_calls.append(path))
    await logs_events.create_logs_dir()
    assert mkdir_calls == []

    monkeypatch.setattr(logs_events.os.path, "exists", lambda path: False)
    await logs_events.create_logs_dir()
    assert mkdir_calls == ["logs"]



@pytest.mark.asyncio
async def test_events_startup_shutdown_and_reconcile(monkeypatch):
    app = SimpleNamespace()
    fake_config = SimpleNamespace(
        database_config=SimpleNamespace(sql_connection_string="sqlite:///fake.db")
    )

    connect_to_db = AsyncMock()
    create_logs_dir = AsyncMock()
    check_content_directory = AsyncMock()
    run_ee_startup = Mock()
    auto_install = AsyncMock()
    reconcile_packs = AsyncMock()
    cleanup_temp_migrations = Mock()

    class _AwaitableFakeTask:
        def __init__(self):
            self.cancel = Mock()

        def __await__(self):
            raise asyncio.CancelledError
            yield  # pragma: no cover

    fake_task = _AwaitableFakeTask()

    def fake_create_task(coro):
        coro.close()
        return fake_task

    monkeypatch.setattr(core_events, "get_learnhouse_config", lambda: fake_config)
    monkeypatch.setattr(core_events, "connect_to_db", connect_to_db)
    monkeypatch.setattr(core_events, "create_logs_dir", create_logs_dir)
    monkeypatch.setattr(core_events, "check_content_directory", check_content_directory)
    monkeypatch.setattr(core_events, "auto_install", auto_install)
    monkeypatch.setattr(core_events, "_reconcile_packs", reconcile_packs)
    monkeypatch.setattr(core_events, "run_ee_startup", run_ee_startup)
    monkeypatch.setattr(core_events.asyncio, "create_task", fake_create_task)
    monkeypatch.setattr(
        "src.services.courses.migration.migration_service.cleanup_old_temp_migrations",
        cleanup_temp_migrations,
    )
    # The HLS + captions consumers only start when Redis is available; this test
    # exercises the migration-cleanup lifecycle, so keep them no-ops (no Redis).
    import src.services.utils.caption_jobs as _cap_jobs
    import src.services.utils.hls_jobs as _hls_jobs
    monkeypatch.setattr(_cap_jobs, "get_redis_client", lambda: None)
    monkeypatch.setattr(_hls_jobs, "get_redis_client", lambda: None)

    start_app = core_events.startup_app(app)
    await start_app()

    assert app.learnhouse_config is fake_config
    connect_to_db.assert_awaited_once_with(app)
    create_logs_dir.assert_awaited_once()
    check_content_directory.assert_awaited_once()
    auto_install.assert_called_once()
    reconcile_packs.assert_called_once()
    cleanup_temp_migrations.assert_called_once()
    run_ee_startup.assert_called_once_with(app)
    assert core_events._cleanup_task is fake_task

    close_webhook_client = AsyncMock()
    close_database = AsyncMock()
    monkeypatch.setattr(core_events, "_cleanup_task", fake_task)
    monkeypatch.setattr(
        "src.services.webhooks.dispatch.close_webhook_client",
        close_webhook_client,
    )
    monkeypatch.setattr(core_events, "close_database", close_database)

    close_app = core_events.shutdown_app(app)
    await close_app()

    fake_task.cancel.assert_called_once()
    close_webhook_client.assert_awaited_once()
    close_database.assert_awaited_once_with(app)


@pytest.mark.asyncio
async def test_reconcile_packs_branches(monkeypatch, caplog):
    reconciled = []
    fake_session = SimpleNamespace()

    @contextlib.asynccontextmanager
    async def fake_session_factory():
        yield fake_session

    monkeypatch.setattr(
        "src.core.events.database._async_session_factory",
        fake_session_factory,
    )

    async def fake_reconcile(db_session):
        reconciled.append(db_session)
        return {"packs": 3}

    monkeypatch.setattr(
        "src.services.packs.packs.reconcile_pack_credits",
        fake_reconcile,
    )
    await core_events._reconcile_packs()
    assert reconciled == [fake_session]

    async def boom_reconcile(db_session):
        raise RuntimeError("boom")

    monkeypatch.setattr(
        "src.services.packs.packs.reconcile_pack_credits",
        boom_reconcile,
    )
    with caplog.at_level(logging.WARNING):
        await core_events._reconcile_packs()
    assert "Pack reconciliation skipped (non-fatal)" in caplog.text


@pytest.mark.asyncio
async def test_periodic_migration_cleanup(monkeypatch, caplog):
    sleep_calls = []

    async def fake_sleep(seconds):
        sleep_calls.append(seconds)
        if len(sleep_calls) > 1:
            raise asyncio.CancelledError

    cleanup_calls = []

    def fake_cleanup():
        cleanup_calls.append(True)
        raise RuntimeError("cleanup failed")

    monkeypatch.setattr(core_events.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(
        "src.services.courses.migration.migration_service.cleanup_old_temp_migrations",
        fake_cleanup,
    )

    with caplog.at_level(logging.WARNING):
        task = asyncio.create_task(core_events._periodic_migration_cleanup())
        with pytest.raises(asyncio.CancelledError):
            await task

    assert sleep_calls == [600, 600]
    assert cleanup_calls == [True]
    assert "Periodic migration cleanup failed" in caplog.text


def test_ee_hooks_availability_and_loading(monkeypatch, caplog):
    monkeypatch.delenv("LEARNHOUSE_DISABLE_EE", raising=False)
    monkeypatch.setattr(ee_hooks.os.path, "isdir", lambda path: path == "ee")
    monkeypatch.setattr(ee_hooks.os.path, "isfile", lambda path: True)
    assert ee_hooks.is_ee_available() is True

    monkeypatch.setenv("LEARNHOUSE_DISABLE_EE", "1")
    assert ee_hooks.is_ee_available() is False
    assert ee_hooks.get_ee_hooks() is None

    monkeypatch.delenv("LEARNHOUSE_DISABLE_EE", raising=False)
    monkeypatch.setattr(ee_hooks.os.path, "isdir", lambda path: True)
    monkeypatch.setattr(ee_hooks.importlib.util, "find_spec", lambda name: None)
    assert ee_hooks.get_ee_hooks() is None

    monkeypatch.setattr(ee_hooks.importlib.util, "find_spec", lambda name: object())
    monkeypatch.setattr(
        ee_hooks.importlib,
        "import_module",
        lambda name: SimpleNamespace(register_middlewares=Mock()),
    )
    hooks = ee_hooks.get_ee_hooks()
    assert hooks is not None

    monkeypatch.setattr(
        ee_hooks.importlib,
        "import_module",
        lambda name: (_ for _ in ()).throw(ImportError("missing hooks")),
    )
    with caplog.at_level(logging.ERROR):
        assert ee_hooks.get_ee_hooks() is None
    assert "Failed to import EE hooks" in caplog.text

    monkeypatch.setattr(
        ee_hooks.importlib,
        "import_module",
        lambda name: (_ for _ in ()).throw(RuntimeError("unexpected")),
    )
    with caplog.at_level(logging.ERROR):
        assert ee_hooks.get_ee_hooks() is None
    assert "Unexpected error loading EE hooks" in caplog.text


def test_ee_hook_registration_and_paid_access(monkeypatch):
    middleware_calls = []
    router_calls = []
    startup_calls = []
    paid_calls = []

    fake_hooks = SimpleNamespace(
        register_middlewares=lambda app: middleware_calls.append(app),
        register_routers=lambda router: router_calls.append(router),
        on_startup=lambda app: startup_calls.append(app),
        check_activity_paid_access=AsyncMock(side_effect=lambda request, activity_id, user, db_session: paid_calls.append((activity_id, user))),
    )

    monkeypatch.setattr(ee_hooks, "get_ee_hooks", lambda: fake_hooks)

    app = object()
    router = object()
    ee_hooks.register_ee_middlewares(app)
    ee_hooks.register_ee_routers(router)
    ee_hooks.run_ee_startup(app)

    assert middleware_calls == [app]
    assert router_calls == [router]
    assert startup_calls == [app]

    monkeypatch.setattr("src.core.deployment_mode.get_deployment_mode", lambda: "ee")
    assert ee_hooks.is_multi_org_allowed() is True
    monkeypatch.setattr("src.core.deployment_mode.get_deployment_mode", lambda: "saas")
    assert ee_hooks.is_multi_org_allowed() is True
    monkeypatch.setattr("src.core.deployment_mode.get_deployment_mode", lambda: "free")
    assert ee_hooks.is_multi_org_allowed() is False

    result = asyncio.run(
        ee_hooks.check_ee_activity_paid_access(
            object(),
            99,
            object(),
            object(),
        )
    )
    assert result is None
    assert paid_calls

    monkeypatch.setattr(ee_hooks, "get_ee_hooks", lambda: None)
    assert asyncio.run(
        ee_hooks.check_ee_activity_paid_access(
            object(),
            99,
            object(),
            object(),
        )
    ) is True


# --------------------------------------------------------------------------
# Startup database connect: retry transient, fail fast on permanent
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_connect_to_db_retries_transient_failure(monkeypatch):
    import src.core.events.database as db_events

    app = SimpleNamespace()
    attempts = []

    async def flaky():
        attempts.append(1)
        if len(attempts) < 3:
            raise RuntimeError(
                "(EMAXCONNSESSION) max clients reached in session mode - "
                "max clients are limited to pool_size: 15"
            )

    monkeypatch.setattr(db_events, "_bootstrap_schema", flaky)
    monkeypatch.setattr(db_events, "_STARTUP_CONNECT_BACKOFF_SECONDS", 0)

    await db_events.connect_to_db(app)

    assert len(attempts) == 3
    assert app.db_engine is db_events.engine


@pytest.mark.asyncio
async def test_connect_to_db_fails_fast_on_bad_credentials(monkeypatch):
    import src.core.events.database as db_events

    app = SimpleNamespace()
    attempts = []

    async def bad_password():
        attempts.append(1)
        raise RuntimeError('password authentication failed for user "postgres"')

    monkeypatch.setattr(db_events, "_bootstrap_schema", bad_password)

    with pytest.raises(RuntimeError):
        await db_events.connect_to_db(app)

    # Retrying a wrong password only delays the real signal.
    assert len(attempts) == 1
