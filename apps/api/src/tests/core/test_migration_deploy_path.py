"""The deploy path has to apply migrations, and has to keep applying them.

Nothing in this repo ever ran alembic: the container went straight from waiting
on the database port to `exec uvicorn`, and the schema was built solely by
``SQLModel.metadata.create_all``. create_all only issues CREATE TABLE — it never
ALTERs an existing table — so `organization.is_demo`, added by migration
c7d8e9f0a1b2, was never applied to a database whose `organization` table already
existed. Every SELECT on Organization then raised UndefinedColumnError inside
the lifespan handler and the pods crash-looped (1632 events over five days).

Two kinds of test live here, and the difference matters:

* `test_alembic_*_transaction*` are BEHAVIOURAL. They drive the real
  `MigrationContext` from the installed alembic against a real SQLAlchemy
  connection and fail if the connection handed to alembic still has a
  transaction open. That is the bug that would have silently rolled a
  66-revision upgrade back while alembic exited 0.

* the rest are cheap STRUCTURAL guards over the source of docker-entrypoint.sh
  and migrations/env.py. They assert that strings are present in the right
  order; they are here so the migration step cannot be quietly deleted from the
  image again. They do NOT verify that alembic runs against the right database,
  from the right directory, or that it commits — do not read them as proof of
  any of that.
"""

import os
import re
import subprocess
from pathlib import Path

import pytest
import sqlalchemy as sa

import src.core.events.autoinstall as autoinstall

API_ROOT = Path(__file__).resolve().parents[3]
ENTRYPOINT = API_ROOT / "docker-entrypoint.sh"
ALEMBIC_ENV = API_ROOT / "migrations" / "env.py"


# ── behavioural: alembic must own (and therefore commit) its own transaction ──


def _env_namespace():
    """Exec just the helper defs out of migrations/env.py.

    env.py runs migrations at import, so it cannot be imported. The functions
    under test are pure and self-contained, so compiling the file and pulling
    the one definition out of it is enough — and it means the test reads the
    real shipped source, not a copy.
    """
    source = ALEMBIC_ENV.read_text()
    start = source.index("def _end_open_transaction(connection)")
    end = source.index("def run_migrations_online()")
    namespace: dict = {}
    exec(compile(source[start:end], str(ALEMBIC_ENV), "exec"), namespace)
    return namespace


def test_sqlalchemy_autobegins_on_the_advisory_lock_query():
    """The premise. Remove this and the next two tests read as paranoia.

    ``_acquire_migration_lock`` runs the advisory lock through
    ``exec_driver_sql``. Under SQLAlchemy 2.0 that autobegins a transaction on
    the connection, and ``_assert_stamped_or_empty``'s inspection then runs
    inside it. Nothing in env.py's original code ever ended it.
    """
    engine = sa.create_engine("sqlite://")
    with engine.connect() as connection:
        assert connection.in_transaction() is False
        connection.exec_driver_sql("SELECT 1").scalar()
        assert connection.in_transaction() is True


def test_end_open_transaction_hands_alembic_a_clean_connection():
    end_open_transaction = _env_namespace()["_end_open_transaction"]

    engine = sa.create_engine("sqlite://")
    with engine.connect() as connection:
        connection.exec_driver_sql("SELECT 1").scalar()
        assert connection.in_transaction() is True

        end_open_transaction(connection)
        assert connection.in_transaction() is False


def test_alembic_commits_its_own_transaction_only_on_a_clean_connection():
    """The actual regression, expressed in alembic's own terms.

    ``MigrationContext`` latches ``_in_external_transaction`` once, in its
    constructor. When it is True, ``begin_transaction()`` returns a nullcontext
    and alembic never commits — it assumes the caller will. env.py's caller is
    ``with connectable.connect() as connection:``, which ROLLS BACK on close, so
    the whole upgrade would have been committed only as a side effect of the
    ``connection.commit()`` that used to sit inside ``_release_migration_lock``,
    inside a try/except that only logs a warning.

    This test fails without ``_end_open_transaction``: the second half is the
    state env.py used to be in at ``context.configure`` time.
    """
    from contextlib import nullcontext

    from alembic.runtime.migration import MigrationContext

    end_open_transaction = _env_namespace()["_end_open_transaction"]

    engine = sa.create_engine("sqlite://")

    # As env.py leaves it now: lock + inspect, then the transaction ended.
    # `_per_migration=True` is the call run_migrations() itself makes.
    with engine.connect() as connection:
        connection.exec_driver_sql("SELECT 1").scalar()
        end_open_transaction(connection)
        context = MigrationContext.configure(connection=connection)
        assert context._in_external_transaction is False
        assert not isinstance(
            context.begin_transaction(_per_migration=True), nullcontext
        ), "alembic must open — and therefore commit — its own transaction"

    # As it was before: a transaction nobody owns is still open, so alembic
    # hands back a nullcontext and never commits anything.
    with engine.connect() as connection:
        connection.exec_driver_sql("SELECT 1").scalar()
        context = MigrationContext.configure(connection=connection)
        assert context._in_external_transaction is True
        assert isinstance(context.begin_transaction(_per_migration=True), nullcontext)


def test_env_ends_the_transaction_before_configuring_alembic():
    """Ordering is the whole fix: configure() is where the flag is latched."""
    online = ALEMBIC_ENV.read_text()
    online = online[online.index("def run_migrations_online()"):]

    assert "_end_open_transaction(connection)" in online
    assert online.index("_end_open_transaction(connection)") < online.index(
        "context.configure("
    )
    # And the commit must no longer be the release helper's job.
    assert online.index("_end_open_transaction(connection)") < online.index(
        "_release_migration_lock(connection)"
    )


def test_lock_timeout_env_never_raises_at_import(monkeypatch):
    """A typo in a tuning knob must not fail the boot under `set -e`.

    The value used to be parsed with a bare `float(os.environ.get(...))` at
    module import, so an empty string from a ConfigMap raised ValueError before
    any migration logic ran — alembic exits non-zero and `set -e` fails the boot,
    over pure tuning.
    """
    source = ALEMBIC_ENV.read_text()
    start = source.index("def _lock_timeout_seconds()")
    end = source.index("_MIGRATION_LOCK_TIMEOUT_SECONDS = _lock_timeout_seconds()")
    import logging

    namespace = {"os": os, "_env_logger": logging.getLogger("test.alembic.env")}
    exec(compile(source[start:end], str(ALEMBIC_ENV), "exec"), namespace)
    parse = namespace["_lock_timeout_seconds"]

    monkeypatch.delenv("LEARNHOUSE_MIGRATION_LOCK_TIMEOUT", raising=False)
    assert parse() == 300.0
    for bad in ("", "   ", "five minutes", "-1", "0"):
        monkeypatch.setenv("LEARNHOUSE_MIGRATION_LOCK_TIMEOUT", bad)
        assert parse() == 300.0
    monkeypatch.setenv("LEARNHOUSE_MIGRATION_LOCK_TIMEOUT", "60")
    assert parse() == 60.0


# ── behavioural: alembic must target the app's database, not alembic.ini's ──


def test_alembic_url_falls_back_to_the_yaml_config_not_localhost():
    """config.yaml is a real, shipped configuration source.

    config/config.py resolves the DB URL as `LEARNHOUSE_SQL_CONNECTION_STRING or
    config.yaml -> database_config.sql_connection_string`, and config.yaml is
    tracked and copied into both images. env.py used to read only the env var,
    so a yaml-configured deployment would have run `upgrade head` against
    alembic.ini's hardcoded localhost — and, under the entrypoint's `set -e`,
    refused to boot at all. env.py had the resolved config in hand and ignored
    it.
    """
    source = ALEMBIC_ENV.read_text()
    prelude = source[: source.index("# Interpret the config file for Python logging.")]

    assert "lh_config.database_config.sql_connection_string" in prelude, (
        "alembic must resolve the DB URL the way the application does"
    )
    assert 'os.environ.get("LEARNHOUSE_SQL_CONNECTION_STRING")' in prelude, (
        "the env var still wins over the yaml, as it does in config.py"
    )


# ── behavioural: every scheme the app accepts has to survive normalization ──

DATABASE_PY = API_ROOT / "src" / "core" / "events" / "database.py"


def _to_sync_url():
    """Pull `_to_sync_url` out of migrations/env.py, which cannot be imported."""
    source = ALEMBIC_ENV.read_text()
    start = source.index("_SYNC_URL_REWRITES = (")
    end = source.index("# Alembic must target the same DB")
    namespace: dict = {}
    exec(compile(source[start:end], str(ALEMBIC_ENV), "exec"), namespace)
    return namespace["_to_sync_url"]


def test_bare_postgres_scheme_is_not_a_sqlalchemy_dialect():
    """The premise. Without it the normalization below reads as decoration.

    `postgres://` is a perfectly good libpq/Heroku-style URL and one of the
    three schemes src/core/events/database.py accepts — but it is not a
    SQLAlchemy dialect name.
    """
    with pytest.raises(sa.exc.NoSuchModuleError):
        sa.create_engine("postgres://u:p@h:5432/d")


@pytest.mark.parametrize(
    "configured, expected",
    [
        ("postgresql+asyncpg://u:p@h:5432/d", "postgresql://u:p@h:5432/d"),
        ("postgres://u:p@h:5432/d", "postgresql://u:p@h:5432/d"),
        # Already sync and already valid — must come through untouched. A naive
        # `.replace("postgres://", "postgresql://")` would mangle this one into
        # `postgresqlql://`, which is the trap the anchored rewrite avoids.
        ("postgresql://u:p@h:5432/d", "postgresql://u:p@h:5432/d"),
        ("postgresql+psycopg2://u:p@h:5432/d", "postgresql+psycopg2://u:p@h:5432/d"),
        # Not a postgres URL at all: left alone.
        ("sqlite:///./local.db", "sqlite:///./local.db"),
    ],
)
def test_alembic_normalizes_every_scheme_to_a_loadable_dialect(configured, expected):
    """alembic runs on psycopg2, so the URL has to be a SYNC dialect it can load.

    env.py used to rewrite only `postgresql+asyncpg://`. On a deployment
    configured with `postgres://`, `engine_from_config` in
    `run_migrations_online()` would then raise NoSuchModuleError on all five of
    the entrypoint's attempts and docker-entrypoint.sh would exit 1 — the same
    dead pod the migration step was added to prevent, on the one scheme the
    rewrite missed.
    """
    to_sync = _to_sync_url()
    assert to_sync(configured) == expected
    # And the result is a URL SQLAlchemy can actually build an engine from.
    sa.create_engine(to_sync(configured))


def test_alembic_covers_every_scheme_database_py_accepts():
    """Pins the two files together, so a fourth scheme cannot be added alone."""
    accepted = set(
        re.findall(r'sql_url\.startswith\("([^"]+)"\)', DATABASE_PY.read_text())
    )
    assert accepted, "the scheme checks in database.py moved — update this regex"

    to_sync = _to_sync_url()
    for scheme in accepted:
        # Would raise NoSuchModuleError for any scheme left unnormalized.
        sa.create_engine(to_sync(scheme + "u:p@h:5432/d"))


def test_entrypoint_resolves_the_db_url_the_same_way():
    """The port wait was gated on the same env var and had the same hole."""
    script = ENTRYPOINT.read_text()
    assert "config.yaml" in script
    assert 'DB_URL="$LEARNHOUSE_SQL_CONNECTION_STRING"' in script
    assert 'if [ -n "$DB_URL" ]; then' in script


# ── structural guards over the deploy path ──


def test_entrypoint_applies_migrations_before_starting_uvicorn():
    script = ENTRYPOINT.read_text()

    assert "LEARNHOUSE_RUN_MIGRATIONS" in script, (
        "the migration step needs an env gate so an external Job can own it"
    )

    # Match the real command line, not the phrase — the phrase also appears in
    # the comment block above the step, and its first occurrence there would
    # satisfy an ordering check even if the step itself were commented out.
    assert "MIGRATE_CMD=(\"$ALEMBIC\" upgrade head)" in script
    assert script.index('MIGRATE_CMD=("$ALEMBIC" upgrade head)') < script.index(
        'exec "$UVICORN"'
    ), "migrations must run before uvicorn is exec'd"


def test_entrypoint_migration_step_defaults_to_on():
    """The gate must be opt-out. An opt-in gate is the bug all over again."""
    script = ENTRYPOINT.read_text()
    assert '"${LEARNHOUSE_RUN_MIGRATIONS:-true}" = "true"' in script


def _run_bounded_int(raw, default, minimum, maximum):
    """Run the REAL `bounded_int` out of docker-entrypoint.sh, in bash."""
    script = (
        "set -e\n"
        + f"eval \"$(sed -n '/^bounded_int() {{$/,/^}}$/p' {ENTRYPOINT})\"\n"
        + f'bounded_int "$1" {default} {minimum} {maximum} KNOB 2>/dev/null\n'
    )
    result = subprocess.run(
        ["bash", "-c", script, "bash", str(raw)],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def test_entrypoint_script_is_valid_bash():
    subprocess.run(["bash", "-n", str(ENTRYPOINT)], check=True)


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("5", "5"),
        ("1", "1"),
        ("100", "100"),
        # Every one of these has to fall back rather than reach the loop.
        ("abc", "5"),
        ("", "5"),
        ("0", "5"),
        ("-1", "5"),
        ("3.5", "5"),
        ("101", "5"),
        # Would wrap in bash's 64-bit arithmetic and could land back in range.
        ("999999999999999999999", "5"),
    ],
)
def test_migration_attempts_knob_is_validated(raw, expected):
    """A typo in a tuning knob must change the TIMING, never whether it runs.

    `[ "$migration_attempt" -le "$MIGRATION_ATTEMPTS" ]` with a non-numeric
    right-hand side prints "integer expression expected" AND returns non-zero,
    so with LEARNHOUSE_MIGRATION_ATTEMPTS=abc the retry loop body never executed
    once: alembic was never invoked, migration_ok stayed 0, and the pod exited 1
    reporting "failed after abc attempts" — a bricked boot that also lied about
    the cause. `:-` only substitutes an unset or empty value, so it caught none
    of it.
    """
    assert _run_bounded_int(raw, 5, 1, 100) == expected


def test_every_numeric_migration_knob_goes_through_the_validator():
    """All three, not just the one that bricked the boot: `timeout abc` fails
    every attempt the same way, and a bad backoff is read as 0."""
    script = ENTRYPOINT.read_text()
    for knob in (
        "LEARNHOUSE_MIGRATION_ATTEMPTS",
        "LEARNHOUSE_MIGRATION_BACKOFF",
        "LEARNHOUSE_MIGRATION_TIMEOUT",
    ):
        assert f'bounded_int "${{{knob}' in script, (
            f"{knob} is read straight into the retry loop without validation"
        )


def test_entrypoint_retries_the_migration_and_reports_a_final_failure():
    """A transient pooler blip must not become a crash loop, or a silent one.

    database.py retries its startup connect five times for exactly this reason.
    The alembic step has none of that resilience by default, and it runs BEFORE
    sentry_sdk.init, so an unretried failure is both a dead pod and an invisible
    one — the issue going quiet would be the instrumentation gap, not a fix.
    """
    script = ENTRYPOINT.read_text()

    assert "LEARNHOUSE_MIGRATION_ATTEMPTS" in script
    assert "MIGRATION_ATTEMPTS:-5" in script
    assert "report_migration_failure" in script
    assert "capture_message" in script, (
        "a failure before sentry_sdk.init has to be reported explicitly"
    )
    assert "level='error'" in script, (
        "warning level does not reach Sentry — LoggingIntegration captures at ERROR"
    )
    # Still fail-closed after the retries are spent.
    assert "refusing to start on an unmigrated schema" in script

    # A permanent failure (an unstamped database) must not be retried five
    # times: env.py exits 78 / EX_CONFIG for those and the loop stops on it.
    assert "_EX_CONFIG = 78" in ALEMBIC_ENV.read_text()
    assert "_PermanentMigrationError" in ALEMBIC_ENV.read_text()
    assert '"$migration_status" -eq 78' in script


def test_alembic_env_serializes_concurrent_replicas():
    """Replicas boot together, so `alembic upgrade head` has to be serialized.

    A session-scoped advisory lock, not the _xact_ variant: alembic commits
    between migrations, so a transaction-scoped lock would be dropped at the
    first commit — and session scope is what the Supavisor pooler can hold.
    """
    env_source = ALEMBIC_ENV.read_text()

    assert "pg_try_advisory_lock" in env_source
    assert "pg_advisory_unlock" in env_source
    assert "pg_try_advisory_xact_lock" not in env_source
    online = env_source[env_source.index("def run_migrations_online()"):]
    assert "_acquire_migration_lock(connection)" in online
    assert online.index("_acquire_migration_lock(connection)") < online.index(
        "context.run_migrations()"
    ), "the lock must be held before any migration runs"
    assert "_release_migration_lock(connection)" in online


def test_cli_install_cannot_flood_the_pooler():
    """`auto_install` awaits `cli._install_async` in-process on a fresh deploy.

    Its two engines used SQLAlchemy's defaults (5 + 10 each), so a bootstrap
    boot could claim up to 30 connections against a session-mode pooler capped
    at 15 clients — entirely outside the pool arithmetic in database.py. This is
    the second pool that the autoinstall-only check below cannot see.
    """
    source = (API_ROOT / "cli.py").read_text()
    install = source[source.index("async def _install_async"):]
    install = install[: install.index("@cli.command()")]

    assert install.count("poolclass=NullPool") == 2, (
        "both the sync and the async engine in _install_async must be bounded"
    )
    # create_all is checkfirst=True: on a database that alembic manages but that
    # is merely behind head, it would create the tables of unapplied revisions
    # and the next `upgrade head` would then die on their CREATE TABLE.
    assert "alembic_version" in install


def test_autoinstall_opens_no_second_connection_pool():
    """auto_install must keep using the application engine.

    NOTE: this is a guard, not a regression test for anything this sweep
    changed — autoinstall.py already used `_async_session_factory` on dev. It
    also cannot see `cli._install_async`, which auto_install awaits one frame
    down; that is what `test_cli_install_cannot_flood_the_pooler` covers.
    """
    source = Path(autoinstall.__file__).read_text()

    assert "create_all" not in source
    assert "create_engine" not in source  # covers create_async_engine too
    assert "_async_session_factory" in source


def test_autoinstall_names_migrations_when_the_schema_probe_fails():
    """The first real query on boot must diagnose drift, not just re-raise.

    Left unannotated it produced a bare UndefinedColumnError that read as an
    Organization bug rather than a missing `alembic upgrade head`.
    """
    source = Path(autoinstall.__file__).read_text()

    assert "alembic upgrade head" in source
    # Still fail-closed: a pod on a stale schema answers every request with a
    # 500, so the exception has to keep escaping the lifespan handler. `raise`
    # bare on its own line — the word alone appears in any Python file.
    assert any(line.strip() == "raise" for line in source.splitlines()), (
        "the schema probe must re-raise, not swallow"
    )


def test_alembic_env_refuses_to_replay_over_an_unstamped_database():
    """A create_all-built database must get an instruction, not DuplicateTable.

    Long-lived deployments have every application table and no alembic_version,
    because create_all was the only thing that ever built the schema. Replaying
    all 66 revisions there fails on the first CREATE TABLE — which, now that the
    entrypoint runs migrations, would be a failed rollout on every pod.
    """
    env_source = ALEMBIC_ENV.read_text()
    online = env_source[env_source.index("def run_migrations_online()"):]

    assert "_assert_stamped_or_empty(connection)" in online
    assert online.index("_assert_stamped_or_empty(connection)") < online.index(
        "context.run_migrations()"
    )
    assert "alembic stamp" in env_source, "the error has to say how to fix it"


def test_url_encoded_password_survives_the_alembic_config():
    """`%` in the DB URL must be escaped before it reaches ConfigParser.

    alembic's set_main_option reads `%` as the start of an interpolation token,
    so a URL-encoded password (`p%40ss`) raises InterpolationSyntaxError when the
    URL is read back. Now that every pod runs `alembic upgrade head` on boot,
    that would be a failed rollout rather than one grumpy developer.
    """
    from alembic.config import Config

    assert 'replace("%", "%%")' in ALEMBIC_ENV.read_text()

    url = "postgresql://user:p%40ss%2Fword@host:5432/db"  # gitleaks:allow — synthetic fixture
    alembic_config = Config()
    alembic_config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    assert alembic_config.get_main_option("sqlalchemy.url") == url


def test_migrations_directory_is_where_the_entrypoint_expects_it():
    """The entrypoint cds to the script dir and runs alembic from there."""
    assert (API_ROOT / "alembic.ini").is_file()
    assert (API_ROOT / "migrations" / "versions").is_dir()
    assert any(
        name.endswith(".py")
        for name in os.listdir(API_ROOT / "migrations" / "versions")
    )


def test_the_migration_graph_has_exactly_one_head():
    """`upgrade head` is ambiguous with two heads and fails on every boot."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    alembic_config = Config()
    alembic_config.set_main_option("script_location", str(API_ROOT / "migrations"))
    heads = ScriptDirectory.from_config(alembic_config).get_heads()
    assert len(heads) == 1, f"expected one head, found {heads}"


@pytest.mark.parametrize("shell_var", ["MIGRATION_ATTEMPTS", "MIGRATION_TIMEOUT"])
def test_entrypoint_is_valid_bash(shell_var):
    """`bash -n` the shipped script — a syntax error here bricks every image."""
    import subprocess

    assert shell_var in ENTRYPOINT.read_text()
    result = subprocess.run(
        ["bash", "-n", str(ENTRYPOINT)], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr
