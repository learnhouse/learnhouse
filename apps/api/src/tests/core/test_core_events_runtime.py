"""Runtime coverage for core event helpers and EE hooks."""

import asyncio
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

import src.core.ee_hooks as ee_hooks
import src.core.events.autoinstall as autoinstall
import src.core.events.content as content_events
import src.core.events.events as core_events
import src.core.events.logs as logs_events


class _FakeResult:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


class _FakeSession:
    def __init__(self, row):
        self.row = row
        self.closed = False

    def exec(self, statement):
        return _FakeResult(self.row)

    def close(self):
        self.closed = True


def test_auto_install_branches(monkeypatch):
    create_all_calls = []
    installs = []

    fake_config = SimpleNamespace(
        database_config=SimpleNamespace(sql_connection_string="sqlite:///fake.db")
    )

    monkeypatch.setattr(autoinstall, "get_learnhouse_config", lambda: fake_config)
    monkeypatch.setattr(autoinstall, "create_engine", lambda *args, **kwargs: object())
    monkeypatch.setattr(
        autoinstall.SQLModel.metadata,
        "create_all",
        lambda engine: create_all_calls.append(engine),
    )

    monkeypatch.setattr(
        autoinstall,
        "Session",
        lambda engine: _FakeSession(None),
    )
    monkeypatch.setattr(autoinstall, "install", lambda short=True: installs.append(short))

    autoinstall.auto_install()

    assert create_all_calls and len(create_all_calls) == 1
    assert installs == [True]

    monkeypatch.setattr(
        autoinstall,
        "Session",
        lambda engine: _FakeSession(SimpleNamespace(slug="default")),
    )
    autoinstall.auto_install()

    assert installs == [True]


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

    basic_config_calls = []
    info_calls = []

    async def fake_create_logs_dir():
        return None

    monkeypatch.setattr(logs_events, "create_logs_dir", fake_create_logs_dir)
    monkeypatch.setattr(logs_events.logging, "FileHandler", lambda path: f"file:{path}")
    monkeypatch.setattr(logs_events.logging, "StreamHandler", lambda: "stream")
    monkeypatch.setattr(
        logs_events.logging,
        "basicConfig",
        lambda **kwargs: basic_config_calls.append(kwargs),
    )
    monkeypatch.setattr(logs_events.logging, "info", lambda message: info_calls.append(message))

    await logs_events.init_logging()

    assert basic_config_calls and basic_config_calls[0]["handlers"] == ["file:logs/learnhouse.log", "stream"]
    assert info_calls == ["Logging initiated"]


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
    auto_install = Mock()
    reconcile_packs = Mock()
    cleanup_temp_migrations = Mock()

    fake_task = SimpleNamespace(cancel=Mock())

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


def test_reconcile_packs_branches(monkeypatch, caplog):
    fake_config = SimpleNamespace(
        database_config=SimpleNamespace(sql_connection_string="sqlite:///fake.db")
    )
    closed_sessions = []

    class _Session:
        def __init__(self, engine):
            self.engine = engine

        def close(self):
            closed_sessions.append(self.engine)

    monkeypatch.setattr(core_events, "get_learnhouse_config", lambda: fake_config)
    monkeypatch.setattr("sqlalchemy.create_engine", lambda *args, **kwargs: object())
    monkeypatch.setattr("sqlmodel.Session", _Session)
    monkeypatch.setattr(
        "src.services.packs.packs.reconcile_pack_credits",
        lambda db_session: {"packs": 3},
    )
    core_events._reconcile_packs()
    assert closed_sessions

    monkeypatch.setattr(
        "src.services.packs.packs.reconcile_pack_credits",
        lambda db_session: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    with caplog.at_level(logging.WARNING):
        core_events._reconcile_packs()
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
    monkeypatch.setattr(ee_hooks.os.path, "exists", lambda path: path == "ee")
    assert ee_hooks.is_ee_available() is True

    monkeypatch.setenv("LEARNHOUSE_DISABLE_EE", "1")
    assert ee_hooks.is_ee_available() is False
    assert ee_hooks.get_ee_hooks() is None

    monkeypatch.delenv("LEARNHOUSE_DISABLE_EE", raising=False)
    monkeypatch.setattr(ee_hooks.os.path, "exists", lambda path: True)
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
