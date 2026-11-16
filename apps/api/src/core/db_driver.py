"""Which async PostgreSQL driver the API talks to, and how.

``LEARNHOUSE_DB_DRIVER`` picks it: ``asyncpg`` (the default) or ``psycopg``
(psycopg 3). The variable wins over whatever driver the connection string
names, so one setting switches the API, the CLI and their engines together.
Alembic is not affected: migrations always run on the synchronous psycopg2
driver (see ``src.core.migrations.sync_database_url``).

Why psycopg exists as an option: behind a transaction-mode pooler (Supavisor,
PgBouncer) named prepared statements cannot be reused, because consecutive
transactions of one client land on different backends. asyncpg therefore has to
run with its statement cache off, and it still prepares every query (parse, then
bind/execute): two round trips per query. psycopg with ``prepare_threshold=None``
never prepares and sends parse/bind/execute together: one round trip per query.
Against a pooler that sits a few tens of milliseconds away that halves the
database time of a request that runs ten queries.
"""

import logging
import os

ASYNCPG = "asyncpg"
PSYCOPG = "psycopg"
DEFAULT_DRIVER = ASYNCPG
DRIVERS = (ASYNCPG, PSYCOPG)

# Every spelling of a PostgreSQL URL the config may carry, longest first so
# "postgresql+psycopg2://" is not mistaken for "postgresql+psycopg://".
_POSTGRES_URL_PREFIXES = (
    "postgresql+psycopg2://",
    "postgresql+asyncpg://",
    "postgresql+psycopg://",
    "postgresql://",
    "postgres://",
)

# libpq waits forever for a connection by default; asyncpg gives up after 60s.
# A bounded wait lets the pool's own timeout and the startup retry loop work.
PSYCOPG_CONNECT_TIMEOUT_SECONDS = 30


def db_driver() -> str:
    """The configured async driver. An unknown value falls back to the default
    with a warning rather than failing the boot over a performance switch."""
    value = os.getenv("LEARNHOUSE_DB_DRIVER", "").strip().lower()
    if not value:
        return DEFAULT_DRIVER
    if value not in DRIVERS:
        logging.warning(
            "Unknown LEARNHOUSE_DB_DRIVER %r (expected one of %s); using %s.",
            value, ", ".join(DRIVERS), DEFAULT_DRIVER,
        )
        return DEFAULT_DRIVER
    return value


def async_database_url(url: str, driver: str | None = None) -> str:
    """``url`` pointed at ``driver`` (default: the configured one). Non-
    PostgreSQL URLs (sqlite in tests) are returned unchanged."""
    driver = driver or db_driver()
    for prefix in _POSTGRES_URL_PREFIXES:
        if url.startswith(prefix):
            return f"postgresql+{driver}://" + url[len(prefix):]
    return url


def async_connect_args(driver: str | None = None) -> dict:
    """``connect_args`` for an async engine on ``driver``. Both sets are safe
    behind a transaction-mode pooler: no named prepared statement ever outlives
    the statement that created it."""
    driver = driver or db_driver()
    if driver == PSYCOPG:
        return {
            # Never prepare server-side: every query goes out as one unnamed
            # parse/bind/execute message batch, valid on any backend.
            "prepare_threshold": None,
            "connect_timeout": PSYCOPG_CONNECT_TIMEOUT_SECONDS,
        }
    # asyncpg prepares every query even with its statement cache off, and by
    # default under a generated name (__asyncpg_stmt_N__): two clients whose
    # transactions share a backend then collide with "prepared statement ...
    # already exists" (or miss it: "... does not exist"). asyncpg._prepare()
    # does `named=True if name is None else name`, so the name function
    # returning "" forces the unnamed statement slot. All three are consumed by
    # SQLAlchemy's asyncpg dialect, not passed to asyncpg.connect() as is:
    #   statement_cache_size=0           -> asyncpg's per-connection LRU off
    #   prepared_statement_name_func=""  -> unnamed prepared statements
    #   prepared_statement_cache_size=0  -> SQLAlchemy's adapter-level LRU off
    return {
        "statement_cache_size": 0,
        "prepared_statement_name_func": lambda: "",
        "prepared_statement_cache_size": 0,
    }


def ping(dialect, dbapi_connection, driver: str | None = None) -> None:
    """Check that a pooled connection is alive, leaving it idle (outside a
    transaction) as it was. Raises whatever the driver raises when it is not.

    asyncpg's ping wraps its query in a transaction it rolls back. psycopg
    opens a transaction implicitly on the first statement, so a plain
    ``SELECT 1`` would hand the connection out mid-transaction; running it in
    autocommit costs one round trip and no BEGIN/ROLLBACK. Toggling autocommit
    on an idle psycopg connection is local, it sends nothing.
    """
    driver = driver or db_driver()
    if driver != PSYCOPG:
        dialect.do_ping(dbapi_connection)
        return
    dbapi_connection.autocommit = True
    try:
        dialect.do_ping(dbapi_connection)
    finally:
        dbapi_connection.autocommit = False


# Spellings PostgreSQL accepts for a zero-offset zone.
_UTC_ZONES = {"utc", "etc/utc", "uct", "etc/uct", "universal", "etc/universal", "zulu", "etc/zulu", "gmt", "etc/gmt", "gmt0", "etc/gmt0"}
_timezone_warned = False


def warn_if_server_timezone_not_utc(dbapi_connection) -> None:
    """psycopg reads a naive datetime bound to a ``timestamptz`` column in the
    server session's TimeZone, and returns ``timestamptz`` values in it; asyncpg
    treats naive values as UTC and returns UTC. On a server whose TimeZone is
    UTC (Supabase, the official images) the two agree. Warn once otherwise,
    from the TimeZone the server reports at connect time (no query sent)."""
    global _timezone_warned
    if _timezone_warned:
        return
    try:
        zone = dbapi_connection.driver_connection.info.parameter_status("TimeZone")
    except Exception:
        return
    if zone and zone.lower() not in _UTC_ZONES:
        _timezone_warned = True
        logging.warning(
            "LEARNHOUSE_DB_DRIVER=psycopg with database TimeZone %r: naive datetimes "
            "written to timestamptz columns are read in that zone, not UTC as with "
            "asyncpg. Set the database (or role) TimeZone to UTC.",
            zone,
        )
