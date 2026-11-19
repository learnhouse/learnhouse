"""Bring the database schema to the version of the code that is starting.

One routine for every way LearnHouse runs: the API calls it on startup (the
all-in-one image, docker compose, the CLI's installs), ``python cli.py migrate``
runs it by hand, and the Kubernetes chart runs that command as a pre-deploy
job, so a release never serves traffic against an older schema.

What it does depends on the database it finds:

- **empty**: create every table from the models, then stamp the current
  Alembic head. The migration chain starts from a ``create_all`` schema, so
  it can't build a database from nothing.
- **stamped** (``alembic_version`` present): ``alembic upgrade heads``.
- **unstamped with tables**: an install made by ``create_all`` before this
  existed, at an unknown version. Add whatever the models have and the
  database lacks (tables, columns, indexes, never a drop or a type change),
  then stamp the head.

After an upgrade it also adds any table or column the models have that the
migrations missed, and logs it, so a forgotten migration degrades into a
warning instead of an outage. CI fails the pull request that forgets one.

Every step runs in one transaction under a Postgres advisory lock: replicas
starting together take turns, and a failed migration leaves the database as
it was. The caller then refuses to start, so a rollout stalls on the old
pods instead of serving errors.
"""

import importlib
import logging
import os
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator, Optional

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import Enum, MetaData, create_engine, inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.pool import NullPool
from sqlmodel import SQLModel

logger = logging.getLogger(__name__)

API_DIR = Path(__file__).resolve().parents[2]
# Arbitrary, fixed: every LearnHouse process agrees on it. ("LHMIGR")
ADVISORY_LOCK_KEY = 0x4C484D494752

_MODEL_PACKAGES = (("src/db", "src.db"), ("ee/db", "ee.db"))

# Key in the Alembic config attributes under which migrations defer index builds.
DEFERRED_INDEXES = "deferred_indexes"


class SchemaMigrationError(RuntimeError):
    """The schema could not be brought to the code's version. Not retryable."""


@dataclass
class SchemaReport:
    state: str  # "empty" | "stamped" | "unstamped"
    before: list[str] = field(default_factory=list)
    after: list[str] = field(default_factory=list)
    # Tables/columns/indexes added to match the models, as readable strings.
    reconciled: list[str] = field(default_factory=list)
    # Differences left alone because applying them could lose data.
    skipped: list[str] = field(default_factory=list)

    def summary(self) -> str:
        before = ", ".join(self.before) or "none"
        after = ", ".join(self.after) or "none"
        return f"schema {self.state}: {before} -> {after}, {len(self.reconciled)} reconciled"


def auto_migrate_enabled() -> bool:
    """``LEARNHOUSE_AUTO_MIGRATE=false`` leaves the schema to the operator."""
    return os.getenv("LEARNHOUSE_AUTO_MIGRATE", "true").strip().lower() not in ("0", "false", "no", "off")


def load_models() -> MetaData:
    """Import every model module (core, and EE when present) and return the
    metadata they register on. Independent of the working directory."""
    for base_dir, base_module in _MODEL_PACKAGES:
        root_dir = API_DIR / base_dir
        if not root_dir.is_dir():
            continue
        for path in sorted(root_dir.rglob("*.py")):
            if path.name == "__init__.py":
                continue
            relative = path.relative_to(root_dir).with_suffix("")
            module = ".".join((base_module, *relative.parts))
            try:
                importlib.import_module(module)
            except Exception:
                logger.error("Failed to import model module %s", module, exc_info=True)
    return SQLModel.metadata


def sync_database_url(url: Optional[str] = None) -> str:
    """The configured database URL, with the synchronous driver Alembic uses."""
    if url is None:
        from config.config import get_learnhouse_config

        url = str(get_learnhouse_config().database_config.sql_connection_string)
    for prefix in ("postgresql+asyncpg://", "postgresql+psycopg2://", "postgresql+psycopg://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql://" + url[len(prefix):]
    return url


def alembic_config(
    connection: Optional[Connection] = None,
    deferred_indexes: Optional[list[tuple[str, str, list[str]]]] = None,
) -> Config:
    config = Config(str(API_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(API_DIR / "migrations"))
    # migrations/env.py runs on this connection (inside our transaction and
    # lock) and leaves the app's logging alone.
    config.attributes["connection"] = connection
    config.attributes["configure_logger"] = False
    # A migration can hand an index over here instead of building it, and it
    # is built concurrently once the migration transaction has committed.
    if deferred_indexes is not None:
        config.attributes[DEFERRED_INDEXES] = deferred_indexes
    return config


def head_revisions() -> list[str]:
    return sorted(ScriptDirectory.from_config(alembic_config()).get_heads())


def current_revisions(connection: Connection) -> list[str]:
    return sorted(MigrationContext.configure(connection).get_current_heads())


@contextmanager
def _migration_lock(connection: Connection) -> Iterator[None]:
    if connection.dialect.name != "postgresql":
        yield
        return
    if not connection.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": ADVISORY_LOCK_KEY}).scalar():
        logger.info("Another instance is updating the database schema; waiting for it")
        connection.execute(text("SELECT pg_advisory_lock(:k)"), {"k": ADVISORY_LOCK_KEY})
    try:
        yield
    finally:
        connection.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": ADVISORY_LOCK_KEY})


def _ensure_extensions(engine) -> None:
    if engine.dialect.name != "postgresql":
        return
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    except Exception as exc:
        logger.warning(
            "pgvector extension not available; RAG features will be disabled. "
            "Install pgvector on your PostgreSQL server to enable the course chatbot. Error: %s",
            exc,
        )


def reconcile(connection: Connection, metadata: MetaData, *, indexes: bool = True) -> tuple[list[str], list[str]]:
    """Add the tables, columns (and indexes) the models have and the database
    lacks. Returns (applied, skipped) descriptions; anything that could lose
    data (drops, type or nullability changes) is only reported."""
    diffs = compare_metadata(MigrationContext.configure(connection), metadata)
    operations = Operations(MigrationContext.configure(connection))
    applied: list[str] = []
    skipped: list[str] = []
    created: set[str] = set()
    # Tables first, so columns and indexes never point at a missing table.
    ordered = sorted(diffs, key=lambda d: 0 if isinstance(d, tuple) and d[0] == "add_table" else 1)
    for diff in ordered:
        kind = diff[0] if isinstance(diff, tuple) else None
        if kind == "add_table":
            table = diff[1]
            table.create(connection, checkfirst=True)
            created.add(table.name)
            applied.append(f"table {table.name}")
        elif kind == "add_column":
            _, schema, table_name, column = diff
            new_column = column._copy()
            if not new_column.nullable and new_column.server_default is None:
                # Existing rows have no value to give it; the app fills it in
                # from here on.
                new_column.nullable = True
            if isinstance(new_column.type, Enum):
                new_column.type.create(connection, checkfirst=True)
            operations.add_column(table_name, new_column, schema=schema)
            applied.append(f"column {table_name}.{column.name}")
        elif kind == "add_index":
            # Autogenerate reports a new table's indexes separately; they
            # belong to the table, so they're built even when indexes=False.
            index = diff[1]
            if index.table.name in created:
                index.create(connection, checkfirst=True)
            elif indexes:
                index.create(connection, checkfirst=True)
                applied.append(f"index {index.name}")
        elif kind is None or not kind.startswith(("remove_", "drop_")):
            # Things the database has and the models don't (an EE table or
            # enum on a CE image, an index a migration added) are harmless; type and
            # nullability differences are reported, never applied.
            skipped.append(str(diff)[:200])
    return applied, skipped


# Unique indexes the app relies on that migrations build concurrently: each
# startup checks they exist and are valid (a failed or killed concurrent build
# leaves none, or an invalid one), and rebuilds them after removing the
# duplicates they would refuse. (name, table, columns, options), see
# ``build_indexes_concurrently``.
UNIQUE_INDEX_GUARDS: tuple[tuple, ...] = (
    ("uq_userorganization_user_org", "userorganization", ["user_id", "org_id"], {
        "unique": True,
        # One row per person and org: the strongest built-in role, then the oldest.
        "before": [
            "DELETE FROM userorganization WHERE id IN ("
            "  SELECT id FROM ("
            "    SELECT id, ROW_NUMBER() OVER ("
            "      PARTITION BY user_id, org_id ORDER BY COALESCE(role_id, 2147483647), id"
            "    ) AS rn FROM userorganization"
            "  ) ranked WHERE rn > 1"
            ")"
        ],
    }),
    ("uq_org_invitation_pending_email", "org_invitation", ["org_id", "email"], {
        "unique": True,
        "where": "status = 'pending'",
        # The newest pending invitation per org and address stays.
        "before": [
            "UPDATE org_invitation SET status = 'revoked' "
            "WHERE status = 'pending' AND id NOT IN ("
            "  SELECT MAX(id) FROM org_invitation WHERE status = 'pending' GROUP BY org_id, email"
            ")"
        ],
    }),
)

# A concurrent build waits for every older transaction; under the migration
# lock that would hold up every replica's startup. Give up quickly instead:
# the guard above retries on the next start.
BUILD_LOCK_TIMEOUT = "10s"
BUILD_STATEMENT_TIMEOUT = "10min"


def guarded_indexes_to_build(connection: Connection) -> list[tuple]:
    """The ``UNIQUE_INDEX_GUARDS`` entries missing or invalid (Postgres only),
    an invalid one dropped first."""
    if connection.dialect.name != "postgresql":
        return []
    names = [guard[0] for guard in UNIQUE_INDEX_GUARDS]
    valid = dict(connection.execute(
        text(
            "SELECT c.relname, i.indisvalid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid "
            "WHERE c.relname = ANY(:names)"
        ),
        {"names": names},
    ).all())
    inspector = inspect(connection)
    todo = []
    for name, table, columns, options in UNIQUE_INDEX_GUARDS:
        if valid.get(name) is True or not inspector.has_table(table):
            continue
        before = list(options.get("before", ()))
        if name in valid:
            quote = connection.dialect.identifier_preparer.quote
            before.insert(0, f"DROP INDEX CONCURRENTLY IF EXISTS {quote(name)}")
        todo.append((name, table, columns, {**options, "before": before}))
    return todo


def build_indexes_concurrently(engine, indexes: list[tuple]) -> list[str]:
    """Build indexes that migrations deferred, outside any transaction.

    ``CREATE INDEX CONCURRENTLY`` can't run inside the migration transaction
    (it would also wait on that transaction forever), but unlike a plain build
    it doesn't block writes to a live table while it runs. Each entry is
    ``(name, table, columns)`` or ``(name, table, columns, options)`` with
    options ``unique`` (bool), ``where`` (a partial index's predicate, trusted
    SQL from the migration) and ``before`` (statements run just before the
    build, such as removing duplicates a unique index would refuse). A failure
    is logged, not raised: the app keeps working without the index (a unique
    one is logged as an error, since it is what enforces the rule). Returns
    the names built.
    """
    built: list[str] = []
    if not indexes:
        return built
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        connection.exec_driver_sql(f"SET lock_timeout = '{BUILD_LOCK_TIMEOUT}'")
        connection.exec_driver_sql(f"SET statement_timeout = '{BUILD_STATEMENT_TIMEOUT}'")
        quote = connection.dialect.identifier_preparer.quote
        for entry in indexes:
            name, table, columns = entry[:3]
            options = entry[3] if len(entry) > 3 else {}
            column_list = ", ".join(quote(column) for column in columns)
            unique = "UNIQUE " if options.get("unique") else ""
            where = f" WHERE {options['where']}" if options.get("where") else ""
            try:
                for statement in options.get("before", ()):
                    connection.execute(text(statement))
                connection.execute(
                    text(f"CREATE {unique}INDEX CONCURRENTLY IF NOT EXISTS {quote(name)} ON {quote(table)} ({column_list}){where}")
                )
                built.append(name)
            except Exception as exc:
                log = logger.error if unique else logger.warning
                log("Could not build index %s on %s, reads stay slower without it: %s", name, table, exc)
                # A failed concurrent build leaves an invalid index behind that
                # writes still have to maintain.
                try:
                    connection.execute(text(f"DROP INDEX CONCURRENTLY IF EXISTS {quote(name)}"))
                except Exception:
                    logger.warning("Could not drop the invalid index %s", name, exc_info=True)
    return built


def ensure_schema(url: Optional[str] = None, *, metadata: Optional[MetaData] = None) -> SchemaReport:
    """Bring the database at ``url`` (default: the configured one) to the
    code's schema. Raises SchemaMigrationError when it can't."""
    metadata = metadata if metadata is not None else load_models()
    engine = create_engine(sync_database_url(url), poolclass=NullPool)
    try:
        _ensure_extensions(engine)
        heads = head_revisions()
        deferred: list[tuple[str, str, list[str]]] = []
        with engine.connect() as lock_connection, _migration_lock(lock_connection):
            with engine.begin() as connection:
                report = SchemaReport(state="stamped", before=current_revisions(connection))
                has_tables = any(inspect(connection).has_table(name) for name in metadata.tables)
                if not report.before and not has_tables:
                    report.state = "empty"
                    metadata.create_all(connection)
                    command.stamp(alembic_config(connection), "heads")
                elif not report.before:
                    report.state = "unstamped"
                    report.reconciled, report.skipped = reconcile(connection, metadata)
                    command.stamp(alembic_config(connection), "heads")
                else:
                    command.upgrade(alembic_config(connection, deferred), "heads")
                    # Safety net for a migration someone forgot. Indexes are
                    # left to migrations here: building one can lock a large
                    # table for a while on a live database.
                    report.reconciled, report.skipped = reconcile(connection, metadata, indexes=False)
                report.after = current_revisions(connection)
                if report.after != heads:
                    raise SchemaMigrationError(f"database at {report.after} after migrating, expected {heads}")
            # Still under the lock, so another replica doesn't start the same
            # builds.
            # Unique indexes a failed or killed build left missing or invalid
            # (not already queued by a migration just now).
            # Best effort: a failed check must never stop the API starting.
            try:
                with engine.connect() as connection:
                    queued = {entry[0] for entry in deferred}
                    deferred += [entry for entry in guarded_indexes_to_build(connection) if entry[0] not in queued]
            except Exception:
                logger.exception("Could not check the guarded unique indexes; skipping their rebuild")
            built = build_indexes_concurrently(engine, deferred)
    except SchemaMigrationError:
        raise
    except Exception as exc:
        raise SchemaMigrationError(f"database schema update failed: {exc}") from exc
    finally:
        engine.dispose()

    if report.reconciled and report.state == "stamped":
        logger.warning("Added schema the migrations did not cover (add a migration): %s", ", ".join(report.reconciled))
    elif report.reconciled:
        logger.info("Brought the schema up to the models: %s", ", ".join(report.reconciled))
    if built:
        logger.info("Built indexes concurrently: %s", ", ".join(built))
    if report.skipped:
        logger.info("Schema differences left alone (could lose data): %s", "; ".join(report.skipped))
    logger.info("Database %s", report.summary())
    return report
