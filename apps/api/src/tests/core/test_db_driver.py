"""LEARNHOUSE_DB_DRIVER: picking asyncpg or psycopg 3 for the async engine."""

import logging

import pytest

from src.core import db_driver
from src.core.db_driver import (
    ASYNCPG,
    PSYCOPG,
    async_connect_args,
    async_database_url,
    ping,
)


class TestDbDriver:
    def test_defaults_to_asyncpg(self, monkeypatch):
        monkeypatch.delenv("LEARNHOUSE_DB_DRIVER", raising=False)
        assert db_driver.db_driver() == ASYNCPG

    def test_blank_is_the_default(self, monkeypatch):
        monkeypatch.setenv("LEARNHOUSE_DB_DRIVER", "  ")
        assert db_driver.db_driver() == ASYNCPG

    @pytest.mark.parametrize("value", ["psycopg", "PSYCOPG", " psycopg "])
    def test_psycopg_opt_in(self, monkeypatch, value):
        monkeypatch.setenv("LEARNHOUSE_DB_DRIVER", value)
        assert db_driver.db_driver() == PSYCOPG

    def test_explicit_asyncpg(self, monkeypatch):
        monkeypatch.setenv("LEARNHOUSE_DB_DRIVER", "asyncpg")
        assert db_driver.db_driver() == ASYNCPG

    def test_unknown_value_falls_back_with_a_warning(self, monkeypatch, caplog):
        monkeypatch.setenv("LEARNHOUSE_DB_DRIVER", "psycopg2")
        with caplog.at_level(logging.WARNING):
            assert db_driver.db_driver() == ASYNCPG
        assert "Unknown LEARNHOUSE_DB_DRIVER 'psycopg2'" in caplog.text


class TestAsyncDatabaseUrl:
    @pytest.mark.parametrize(
        "url",
        [
            "postgresql://u:p@h:6543/db",
            "postgres://u:p@h:6543/db",
            "postgresql+psycopg2://u:p@h:6543/db",
            "postgresql+asyncpg://u:p@h:6543/db",
            "postgresql+psycopg://u:p@h:6543/db",
        ],
    )
    @pytest.mark.parametrize("driver", [ASYNCPG, PSYCOPG])
    def test_every_postgres_spelling_points_at_the_driver(self, url, driver):
        assert async_database_url(url, driver) == f"postgresql+{driver}://u:p@h:6543/db"

    def test_driver_defaults_to_the_env(self, monkeypatch):
        monkeypatch.setenv("LEARNHOUSE_DB_DRIVER", "psycopg")
        assert async_database_url("postgresql+asyncpg://h/db") == "postgresql+psycopg://h/db"
        monkeypatch.delenv("LEARNHOUSE_DB_DRIVER")
        assert async_database_url("postgresql+psycopg://h/db") == "postgresql+asyncpg://h/db"

    def test_non_postgres_urls_are_left_alone(self):
        assert async_database_url("sqlite+aiosqlite://", PSYCOPG) == "sqlite+aiosqlite://"


class TestConnectArgs:
    def test_psycopg_never_prepares(self):
        args = async_connect_args(PSYCOPG)
        assert args["prepare_threshold"] is None
        assert args["connect_timeout"] == db_driver.PSYCOPG_CONNECT_TIMEOUT_SECONDS

    def test_asyncpg_uses_unnamed_uncached_statements(self):
        args = async_connect_args(ASYNCPG)
        assert args["statement_cache_size"] == 0
        assert args["prepared_statement_cache_size"] == 0
        assert args["prepared_statement_name_func"]() == ""

    def test_driver_defaults_to_the_env(self, monkeypatch):
        monkeypatch.setenv("LEARNHOUSE_DB_DRIVER", "psycopg")
        assert "prepare_threshold" in async_connect_args()
        monkeypatch.delenv("LEARNHOUSE_DB_DRIVER")
        assert "statement_cache_size" in async_connect_args()


class _Conn:
    """Records what a ping did to the connection's autocommit flag."""

    def __init__(self):
        self.autocommit = False
        self.autocommit_during_ping = None


class _Dialect:
    def __init__(self, error=None):
        self.pinged = []
        self.error = error

    def do_ping(self, conn):
        self.pinged.append(conn)
        if isinstance(conn, _Conn):
            conn.autocommit_during_ping = conn.autocommit
        if self.error:
            raise self.error
        return True


class TestPing:
    def test_asyncpg_pings_through_the_dialect(self):
        dialect, conn = _Dialect(), _Conn()
        ping(dialect, conn, ASYNCPG)
        assert dialect.pinged == [conn]
        assert conn.autocommit_during_ping is False

    def test_psycopg_pings_in_autocommit_and_restores_it(self):
        dialect, conn = _Dialect(), _Conn()
        ping(dialect, conn, PSYCOPG)
        assert conn.autocommit_during_ping is True
        assert conn.autocommit is False

    def test_psycopg_restores_autocommit_when_the_ping_fails(self):
        dialect, conn = _Dialect(error=OSError("connection reset")), _Conn()
        with pytest.raises(OSError):
            ping(dialect, conn, PSYCOPG)
        assert conn.autocommit is False

    def test_driver_defaults_to_the_env(self, monkeypatch):
        monkeypatch.setenv("LEARNHOUSE_DB_DRIVER", "psycopg")
        dialect, conn = _Dialect(), _Conn()
        ping(dialect, conn)
        assert conn.autocommit_during_ping is True


def _conn_reporting(zone):
    class _Info:
        def parameter_status(self, name):
            assert name == "TimeZone"
            return zone

    class _Driver:
        info = _Info()

    class _Adapted:
        driver_connection = _Driver()

    return _Adapted()


class TestServerTimezoneWarning:
    @pytest.fixture(autouse=True)
    def _reset(self, monkeypatch):
        monkeypatch.setattr(db_driver, "_timezone_warned", False)

    @pytest.mark.parametrize("zone", ["UTC", "Etc/UTC", "GMT", None])
    def test_utc_or_unknown_is_quiet(self, zone, caplog):
        with caplog.at_level(logging.WARNING):
            db_driver.warn_if_server_timezone_not_utc(_conn_reporting(zone))
        assert caplog.text == ""

    def test_other_zone_warns_once(self, caplog):
        with caplog.at_level(logging.WARNING):
            db_driver.warn_if_server_timezone_not_utc(_conn_reporting("Europe/Paris"))
            db_driver.warn_if_server_timezone_not_utc(_conn_reporting("Europe/Paris"))
        assert caplog.text.count("database TimeZone 'Europe/Paris'") == 1

    def test_connection_without_server_info_is_ignored(self, caplog):
        with caplog.at_level(logging.WARNING):
            db_driver.warn_if_server_timezone_not_utc(object())
        assert caplog.text == ""
