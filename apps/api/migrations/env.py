import importlib
import logging
from logging.config import fileConfig
import os
import time
import alembic_postgresql_enum # noqa: F401
from sqlalchemy import engine_from_config
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import pool
from sqlmodel import SQLModel
from alembic import context

from config.config import get_learnhouse_config

# LearnHouse config

lh_config = get_learnhouse_config()

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Alembic runs on psycopg2, so the URL has to be normalized to the SYNC scheme
# SQLAlchemy's default postgresql dialect understands — and it has to cover
# every scheme the running app accepts, not just the one this file used to
# rewrite. src/core/events/database.py accepts three:
# `postgresql+psycopg2://`, `postgresql://` and `postgres://`.
#
# `postgres://` is the one that bites. It is a valid libpq/Heroku-style URL and
# a supported configuration of this app, but it is NOT a SQLAlchemy dialect
# name: on the SQLAlchemy pinned here (2.0.x) `create_engine("postgres://...")`
# raises `NoSuchModuleError: Can't load plugin: sqlalchemy.dialects:postgres`.
# Left unnormalized, `engine_from_config` in run_migrations_online() would raise
# that on all five of the entrypoint's attempts and docker-entrypoint.sh would
# exit 1 — a deployment that booted before this file learned to run migrations
# would stop booting at all, which is the exact failure the migration step was
# added to prevent.
#
# `postgresql+psycopg2://` is already sync and already valid, so it is left
# alone. Matching is anchored with startswith and the first rule wins: a bare
# `str.replace("postgres://", ...)` is safe only by luck of ordering, and an
# unanchored one would be a live footgun for anyone adding a rule later.
_SYNC_URL_REWRITES = (
    ("postgresql+asyncpg://", "postgresql://"),
    ("postgres://", "postgresql://"),
)


def _to_sync_url(url: str) -> str:
    """Rewrite any scheme the app accepts to a sync `postgresql://` URL."""
    for prefix, replacement in _SYNC_URL_REWRITES:
        if url.startswith(prefix):
            return replacement + url[len(prefix):]
    return url


# Alembic must target the same DB as the running app, and it has to resolve it
# the SAME WAY the app does. The app reads
# `lh_config.database_config.sql_connection_string`, which config.py builds as
# `LEARNHOUSE_SQL_CONNECTION_STRING or config.yaml -> database_config`. Reading
# only the env var here was a live footgun: config/config.yaml is tracked, is
# copied into both images by `ADD . /app`, and ships
# `postgresql://learnhouse:learnhouse@localhost:5432/learnhouse` — the same
# localhost fallback alembic.ini carries. A deployment configured through
# config.yaml would therefore have run `upgrade head` against localhost and,
# under the entrypoint's `set -e`, refused to boot at all.
_runtime_db_url = os.environ.get("LEARNHOUSE_SQL_CONNECTION_STRING") or (
    lh_config.database_config.sql_connection_string
    if lh_config.database_config
    else None
)
if _runtime_db_url:
    # Alembic uses psycopg2 (sync); normalize every scheme database.py accepts.
    _runtime_db_url = _to_sync_url(_runtime_db_url)
    # set_main_option goes through ConfigParser, which reads `%` as the start of
    # an interpolation token. A URL-encoded password (`p%40ss`) would therefore
    # raise InterpolationSyntaxError when the URL is read back — and now that
    # every pod runs `alembic upgrade head` on boot, that is a failed rollout
    # rather than one grumpy developer. A literal percent is escaped as `%%`.
    config.set_main_option("sqlalchemy.url", _runtime_db_url.replace("%", "%%"))

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata

# IMPORTING ALL SCHEMAS
base_dir = 'src/db'
base_module_path = 'src.db'

# Recursively walk through the base directory
for root, dirs, files in os.walk(base_dir):
    # Filter out __init__.py and non-Python files
    module_files = [f for f in files if f.endswith('.py') and f != '__init__.py']
    # Calculate the module's base path from its directory structure
    path_diff = os.path.relpath(root, base_dir)
    if path_diff == '.':
        # Root of the base_dir, no additional path to add
        current_module_base = base_module_path
    else:
        # Convert directory path to a module path
        current_module_base = f"{base_module_path}.{path_diff.replace(os.sep, '.')}"
    
    # Dynamically import each module
    for file_name in module_files:
        module_name = file_name[:-3]  # Remove the '.py' extension
        full_module_path = f"{current_module_base}.{module_name}"
        importlib.import_module(full_module_path)

# IMPORTING ALL SCHEMAS

target_metadata = SQLModel.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


# Every API replica runs `alembic upgrade head` on boot (docker-entrypoint.sh),
# so on a rollout several of them start migrating at the same moment and race on
# alembic_version — the losers fail their boot on a duplicate revision insert or
# a half-applied DDL step. A Postgres advisory lock makes the run serial: the
# first replica migrates, the rest block here and then find themselves already
# at head, which is a no-op.
#
# It has to be a *session* advisory lock (pg_try_advisory_lock, not the _xact_
# variant): alembic commits between migrations, and a transaction-scoped lock
# would be dropped at the first commit. Session scope is also what the Supavisor
# pooler can hold, because the API connects to it in session mode. The lock is
# taken on the same connection that runs the migrations for exactly that reason.
_MIGRATION_LOCK_ID = 8_312_774_051
_MIGRATION_LOCK_POLL_SECONDS = 1.0

_env_logger = logging.getLogger("alembic.env")


def _lock_timeout_seconds() -> float:
    """Parse LEARNHOUSE_MIGRATION_LOCK_TIMEOUT, falling back loudly.

    This is pure tuning, so a typo (or an empty string from a k8s ConfigMap)
    must not raise at import and fail the whole boot under `set -e`.
    """
    raw = os.environ.get("LEARNHOUSE_MIGRATION_LOCK_TIMEOUT")
    if raw is None or not raw.strip():
        return 300.0
    try:
        value = float(raw)
    except (TypeError, ValueError):
        _env_logger.warning(
            "LEARNHOUSE_MIGRATION_LOCK_TIMEOUT=%r is not a number — using 300s.", raw
        )
        return 300.0
    if value <= 0:
        _env_logger.warning(
            "LEARNHOUSE_MIGRATION_LOCK_TIMEOUT=%s must be positive — using 300s.", value
        )
        return 300.0
    return value


_MIGRATION_LOCK_TIMEOUT_SECONDS = _lock_timeout_seconds()


def _acquire_migration_lock(connection) -> bool:
    """Block until this process owns the migration lock. Postgres only."""
    if connection.dialect.name != "postgresql":
        return False

    deadline = time.monotonic() + _MIGRATION_LOCK_TIMEOUT_SECONDS
    waited = False
    while True:
        acquired = bool(
            connection.exec_driver_sql(
                f"SELECT pg_try_advisory_lock({_MIGRATION_LOCK_ID})"
            ).scalar()
        )
        if acquired:
            if waited:
                _env_logger.info("Migration advisory lock acquired.")
            return True

        # Don't sit idle-in-transaction while waiting on another replica.
        connection.rollback()
        if time.monotonic() >= deadline:
            raise RuntimeError(
                f"Timed out after {_MIGRATION_LOCK_TIMEOUT_SECONDS}s waiting for the "
                f"migration advisory lock ({_MIGRATION_LOCK_ID}); another replica is "
                "still running `alembic upgrade head`."
            )
        if not waited:
            waited = True
            _env_logger.info(
                "Another replica is migrating — waiting for the advisory lock."
            )
        time.sleep(_MIGRATION_LOCK_POLL_SECONDS)


def _release_migration_lock(connection) -> None:
    """Best-effort unlock. Nothing the migration needs depends on this.

    It is deliberately allowed to fail: the lock is session-scoped, so dropping
    the connection releases it anyway. This used to also carry the
    `connection.commit()` that was the ONLY thing committing the migration (see
    `_end_open_transaction`), which meant a failure here silently rolled the
    whole upgrade back while alembic still exited 0.
    """
    try:
        connection.exec_driver_sql(
            f"SELECT pg_advisory_unlock({_MIGRATION_LOCK_ID})"
        )
        connection.commit()
    except Exception:
        # Session-scoped, so closing the connection drops it anyway. Never let
        # this mask the migration's own outcome.
        _env_logger.warning("Could not release the migration advisory lock", exc_info=True)


# The entrypoint retries `alembic upgrade head`, because the usual failure is a
# transient one (saturated pooler, rolling restart). A misconfigured or
# unstamped database is NOT transient — retrying it five times just prints the
# same instruction five times and delays the real signal — so it exits 78
# (sysexits.h EX_CONFIG) and docker-entrypoint.sh stops immediately on that code.
_EX_CONFIG = 78


class _PermanentMigrationError(RuntimeError):
    """A migration failure no retry can fix."""


def _assert_stamped_or_empty(connection) -> None:
    """Refuse to replay every revision over a database alembic has never seen.

    The schema used to be created solely by ``SQLModel.metadata.create_all``, so
    a long-lived deployment can have every application table and no
    alembic_version at all. `upgrade head` against that replays all revisions
    from the beginning and dies on the first CREATE TABLE — a wall of
    DuplicateTable errors that says nothing about what to do. One inspection
    turns it into an instruction, and it only ever fires once per database.
    """
    if connection.dialect.name != "postgresql":
        return

    tables = set(sa_inspect(connection).get_table_names())
    if "alembic_version" in tables or "organization" not in tables:
        return

    raise _PermanentMigrationError(
        "This database has application tables but no alembic_version table, so "
        "it was built by SQLModel.metadata.create_all and alembic cannot know "
        "which revisions its schema already reflects. Running `upgrade head` "
        "here would replay every revision and fail on the first CREATE TABLE. "
        "Stamp it once with the revision matching the schema it actually has "
        "(`alembic heads` shows the newest, then `alembic stamp <revision>`) and "
        "redeploy. LEARNHOUSE_RUN_MIGRATIONS=false boots without migrating."
    )


def _end_open_transaction(connection) -> None:
    """Hand alembic a connection with NO transaction open. This is load-bearing.

    Under SQLAlchemy 2.0 every statement autobegins, so the advisory-lock
    ``SELECT pg_try_advisory_lock(...)`` and the ``inspect()`` in
    ``_assert_stamped_or_empty`` leave the connection inside a transaction that
    nobody owns. alembic reads that state once, in ``MigrationContext.__init__``
    (runtime/migration.py): ``self._in_external_transaction =
    _get_connection_in_transaction(connection)``. When it is True,
    ``begin_transaction()`` returns a ``nullcontext`` — alembic assumes the
    CALLER will commit and never commits anything itself.

    The caller here is ``with connectable.connect() as connection:``, which
    ROLLS BACK on close. So the entire upgrade would have been committed only as
    a side effect of the ``connection.commit()`` that used to live inside
    ``_release_migration_lock`` — inside a ``try/except`` that only logs a
    warning. One failed unlock and the migration silently reverted while alembic
    exited 0, the entrypoint printed "Database migrations applied." and uvicorn
    booted on the unmigrated schema.

    A session-scoped advisory lock survives a commit, so ending the transaction
    here costs nothing and gives alembic back its normal, self-committing,
    transaction-per-migration behaviour.
    """
    if connection.in_transaction():
        connection.commit()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        locked = _acquire_migration_lock(connection)
        try:
            _assert_stamped_or_empty(connection)

            # MUST come before context.configure: alembic latches
            # `_in_external_transaction` there and, if it is set, never commits.
            _end_open_transaction(connection)
            if connection.in_transaction():
                raise _PermanentMigrationError(
                    "Refusing to migrate: a transaction is still open on the "
                    "connection handed to alembic. alembic would treat it as "
                    "externally owned and never commit, so the upgrade would be "
                    "rolled back when the connection closes while alembic still "
                    "exited 0."
                )

            context.configure(connection=connection, target_metadata=target_metadata)

            with context.begin_transaction():
                context.run_migrations()

            # alembic commits its own transaction on the way out of the block
            # above. This is a belt-and-braces guard so that a future change
            # which reintroduces an externally-owned transaction cannot silently
            # discard the migration again.
            _end_open_transaction(connection)
        finally:
            if locked:
                _release_migration_lock(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    try:
        run_migrations_online()
    except _PermanentMigrationError as exc:
        # Not a traceback: the message IS the instruction, and burying it under
        # a stack trace on every one of five retries is how it gets missed.
        _env_logger.error("%s", exc)
        raise SystemExit(_EX_CONFIG) from None
