import asyncio
import logging
import os
import re
import importlib
from config.config import get_learnhouse_config
from fastapi import FastAPI
from sqlmodel import SQLModel, Session
from sqlalchemy import event
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession


def import_all_models():
    # List of directories to scan for models
    model_configs = [
        {'base_dir': 'src/db', 'base_module_path': 'src.db'},
        {'base_dir': 'ee/db', 'base_module_path': 'ee.db'}
    ]

    for config in model_configs:
        base_dir = config['base_dir']
        base_module_path = config['base_module_path']

        if not os.path.exists(base_dir):
            continue

        # Recursively walk through the base directory
        for root, dirs, files in os.walk(base_dir):
            # Filter out __init__.py and non-Python files
            module_files = [f for f in files if f.endswith('.py') and f != '__init__.py']

            # Calculate the module's base path from its directory structure
            path_diff = os.path.relpath(root, base_dir)
            if path_diff == '.':
                current_module_base = base_module_path
            else:
                current_module_base = f"{base_module_path}.{path_diff.replace(os.sep, '.')}"

            # Dynamically import each module
            for file_name in module_files:
                module_name = file_name[:-3]  # Remove the '.py' extension
                full_module_path = f"{current_module_base}.{module_name}"
                try:
                    importlib.import_module(full_module_path)
                except Exception as e:
                    logging.error(f"Failed to import model {full_module_path}: {e}")

# Import all models before creating engine
import_all_models()

learnhouse_config = get_learnhouse_config()

# Check if we're in test mode
is_testing = os.getenv("TESTING", "false").lower() == "true"


def _pool_env(name: str, default: int, minimum: int = 0) -> int:
    """Read an int pool setting from the environment, falling back loudly.

    ``minimum`` exists because SQLAlchemy reads the boundary values as
    *unlimited*, not as zero: pool_size=0 removes the pool's ceiling entirely
    and max_overflow=-1 removes the overflow's. Either would quietly undo the
    arithmetic this whole block is about, so a value below the minimum is
    refused rather than honoured.
    """
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        logging.warning("%s=%r is not an integer — using %s.", name, raw, default)
        return default
    if value < minimum:
        logging.warning(
            "%s=%s is below the minimum of %s — using %s.", name, value, minimum, default
        )
        return default
    return value


if is_testing:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
    )
else:
    sql_url = str(learnhouse_config.database_config.sql_connection_string)  # type: ignore

    # Ensure we use the asyncpg driver for PostgreSQL
    if sql_url.startswith("postgresql+psycopg2://"):
        sql_url = sql_url.replace("postgresql+psycopg2://", "postgresql+asyncpg://", 1)
    elif sql_url.startswith("postgresql://"):
        sql_url = sql_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif sql_url.startswith("postgres://"):
        sql_url = sql_url.replace("postgres://", "postgresql+asyncpg://", 1)

    # PgBouncer/Supavisor in transaction pool mode recycles backend connections
    # between client requests, which breaks asyncpg's named prepared statements:
    # two asyncpg connections independently generate __asyncpg_stmt_N__ and when
    # PgBouncer routes them to the same backend, the second prepare fails with
    # DuplicatePreparedStatementError.
    #
    # Root cause: asyncpg._prepare() does `named=True if name is None else name`.
    # When SQLAlchemy calls prepare(query, name=None) (its default), asyncpg
    # generates named statements (__asyncpg_stmt_N__) even when statement_cache_size=0.
    # Passing name="" makes named="" (falsy) → asyncpg uses stmt_name='' (unnamed slot).
    #
    # All three connect_args are popped by SQLAlchemy's asyncpg dialect before
    # forwarding to asyncpg.connect(), so they do NOT reach asyncpg as raw kwargs:
    #   statement_cache_size=0           → disable asyncpg's own per-connection LRU
    #   prepared_statement_name_func=""  → force unnamed prepared statements
    #   prepared_statement_cache_size=0  → disable SQLAlchemy's adapter-level LRU
    _connect_args = {
        "statement_cache_size": 0,
        "prepared_statement_name_func": lambda: "",
        "prepared_statement_cache_size": 0,
    }

    # Detect connection poolers (Supavisor, PgBouncer) to use a smaller
    # client-side pool so we don't overwhelm the pooler's upstream limit.
    is_pooled = (
        "pooler.supabase" in sql_url
        or ":6543/" in sql_url
        or ":6432/" in sql_url
        or "pgbouncer" in sql_url.lower()
        or os.getenv("LEARNHOUSE_PGBOUNCER", "").lower() in ("1", "true", "yes")
    )

    # Pool sizing against a pooler is arithmetic, not a knob to turn up.
    # Supavisor in *session* mode caps the whole project at a fixed number of
    # client connections (15 on the current plan), and every process claims up
    # to pool_size + max_overflow of them. At 5 + 10 a single uvicorn process
    # could hold the entire budget on its own, so two replicas were guaranteed
    # to hit "max clients reached in session mode" (EMAXCONNSESSION) under any
    # real load, and the failed boots that followed opened another batch of
    # connections against the pooler that was already out of clients.
    #
    # THE INVARIANT, whatever these numbers become:
    #   sum over ALL processes of (pool_size + max_overflow)
    #       < the pooler's session-mode client limit
    # "all processes" means every replica times every uvicorn worker, plus the
    # entrypoint's `alembic upgrade head`, plus any cli.py / cron process. Code
    # cannot see the pooler's limit or the replica count, so the default below
    # is only sized for ONE replica; more than that is an ops setting, not a
    # default. The log line prints the arithmetic so the deployed numbers can be
    # checked against the pooler in pod logs.
    #
    # Why 5 + 5 and not 3 + 2: pool_size is the steady-state ceiling and it was
    # 5 before this change — dropping it to 3 would have cut the concurrency a
    # single uvicorn worker actually serves, converting a pooler-level error
    # into in-process QueuePool timeouts (i.e. 500s) without adding capacity
    # anywhere. Only max_overflow, the burst headroom, is reduced: 15 -> 10 per
    # process, which is what makes a second process fit under a 15-client limit.
    _pooled_ceiling_note = (
        "the sum of (pool_size + max_overflow) across ALL processes — replicas, "
        "workers, the entrypoint's alembic run and CLI commands — must stay "
        "below the pooler's session-mode client limit; set "
        "LEARNHOUSE_DB_POOL_SIZE / LEARNHOUSE_DB_MAX_OVERFLOW explicitly when "
        "running more than one replica"
    )

    if is_pooled:
        pool_size = _pool_env("LEARNHOUSE_DB_POOL_SIZE", 5, minimum=1)
        max_overflow = _pool_env("LEARNHOUSE_DB_MAX_OVERFLOW", 5, minimum=0)
        # Saturation should degrade into latency, not into an immediate 5xx: a
        # request that waits 20s and then succeeds is far better than one that
        # raises QueuePool TimeoutError at 10s. It stays below SQLAlchemy's 30s
        # default because /health takes a session from this same pool, and a
        # 30s wait there outlasts every k8s probe timeout — the pod would stop
        # answering probes instead of shedding load.
        pool_timeout = _pool_env("LEARNHOUSE_DB_POOL_TIMEOUT", 20, minimum=1)
        engine_kwargs = dict(
            pool_pre_ping=True,
            pool_size=pool_size,
            max_overflow=max_overflow,
            pool_recycle=1800,
            pool_timeout=pool_timeout,
            connect_args=_connect_args,
        )
        logging.info(
            "DB engine: detected connection pooler — pool_size=%s, max_overflow=%s, "
            "pool_timeout=%ss, up to %s connections from this process. Invariant: %s.",
            pool_size, max_overflow, pool_timeout, pool_size + max_overflow,
            _pooled_ceiling_note,
        )
    else:
        pool_size = _pool_env("LEARNHOUSE_DB_POOL_SIZE", 20, minimum=1)
        max_overflow = _pool_env("LEARNHOUSE_DB_MAX_OVERFLOW", 10, minimum=0)
        pool_timeout = _pool_env("LEARNHOUSE_DB_POOL_TIMEOUT", 30, minimum=1)
        engine_kwargs = dict(
            pool_pre_ping=True,
            pool_size=pool_size,
            max_overflow=max_overflow,
            pool_recycle=300,
            pool_timeout=pool_timeout,
            connect_args=_connect_args,
        )
        logging.info(
            "DB engine: direct database connection (pool_size=%s, max_overflow=%s, "
            "pool_timeout=%ss, up to %s connections from this process).",
            pool_size, max_overflow, pool_timeout, pool_size + max_overflow,
        )

    engine = create_async_engine(sql_url, echo=False, **engine_kwargs)  # type: ignore

    @event.listens_for(engine.sync_engine, "connect")
    def receive_connect(dbapi_connection, connection_record):
        logging.debug("Database connection established")

    @event.listens_for(engine.sync_engine, "checkout")
    def receive_checkout(dbapi_connection, connection_record, connection_proxy):
        logging.debug("Connection checked out from pool")

    @event.listens_for(engine.sync_engine, "checkin")
    def receive_checkin(dbapi_connection, connection_record):
        logging.debug("Connection returned to pool")


_async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


def _register_cache_invalidation_hooks():
    """
    Automatically invalidate the org Redis cache when Organization or
    OrganizationConfig rows are inserted, updated, or deleted.

    Uses mapper-level events (after_insert/after_update/after_delete) which
    fire per-object DURING the flush via the underlying sync session layer.
    Slugs/ids are collected per-session, then the actual Redis invalidation
    runs after_commit (so we only invalidate on successful transactions).
    """
    from sqlalchemy import event as sa_event, inspect as sa_inspect
    from src.db.organizations import Organization
    from src.db.organization_config import OrganizationConfig

    def _ensure_set(session):
        if not hasattr(session, '_org_slugs_to_invalidate'):
            session._org_slugs_to_invalidate = set()
        return session._org_slugs_to_invalidate

    def _ensure_org_config_ids(session):
        if not hasattr(session, '_org_config_ids_to_invalidate'):
            session._org_config_ids_to_invalidate = set()
        return session._org_config_ids_to_invalidate

    # ── Mapper-level events: fire per-object during flush ──

    @sa_event.listens_for(Organization, "after_insert")
    def _org_after_insert(mapper, connection, target):
        session = Session.object_session(target)
        if session and target.slug:
            _ensure_set(session).add(target.slug)

    @sa_event.listens_for(Organization, "after_update")
    def _org_after_update(mapper, connection, target):
        session = Session.object_session(target)
        if not session:
            return
        if target.slug:
            _ensure_set(session).add(target.slug)
        try:
            history = sa_inspect(target).attrs.slug.history
            for old_slug in (history.deleted or []):
                _ensure_set(session).add(old_slug)
        except Exception:
            logging.debug("Could not inspect slug history for org %s", target.id, exc_info=True)

    @sa_event.listens_for(Organization, "after_delete")
    def _org_after_delete(mapper, connection, target):
        session = Session.object_session(target)
        if session and target.slug:
            _ensure_set(session).add(target.slug)

    def _orgconfig_changed(mapper, connection, target):
        session = Session.object_session(target)
        if not session or not target.org_id:
            return
        _ensure_org_config_ids(session).add(target.org_id)

        # The org-by-slug cache carries the whole config blob, so a config write
        # has to bust it too. The identity map is only a shortcut: a request that
        # updates OrganizationConfig without ever loading its Organization (the
        # org-policy endpoints do exactly that) gets a miss here, and a miss is a
        # None — not an exception. Falling back only on exception therefore left
        # the slug cache holding the pre-write config until its TTL expired, and
        # the dashboard, refetching immediately after a save, cached that stale
        # copy for another five minutes and showed the old values back.
        slug = None
        try:
            key = sa_inspect(Organization).identity_key_from_primary_key(
                (target.org_id,)
            )
            org = session.identity_map.get(key)
            if org and org.slug:
                slug = org.slug
        except Exception:
            logging.debug(
                "Identity-map lookup failed for org_id=%s", target.org_id, exc_info=True
            )

        if slug is None:
            try:
                from sqlalchemy import text as sa_text
                row = connection.execute(
                    sa_text("SELECT slug FROM organization WHERE id = :oid"),
                    {"oid": target.org_id},
                ).first()
                if row and row[0]:
                    slug = row[0]
            except Exception:
                logging.debug("Could not look up org slug for config org_id=%s", target.org_id, exc_info=True)

        if slug:
            _ensure_set(session).add(slug)

    sa_event.listen(OrganizationConfig, "after_insert", _orgconfig_changed)
    sa_event.listen(OrganizationConfig, "after_update", _orgconfig_changed)
    sa_event.listen(OrganizationConfig, "after_delete", _orgconfig_changed)

    # ── Course cache invalidation: bust course list cache on changes ──
    from src.db.courses.courses import Course

    def _ensure_course_uuids(session):
        if not hasattr(session, '_course_uuids_to_invalidate'):
            session._course_uuids_to_invalidate = set()
        return session._course_uuids_to_invalidate

    def _course_changed(mapper, connection, target):
        session = Session.object_session(target)
        if not session:
            return
        if target.course_uuid:
            _ensure_course_uuids(session).add(target.course_uuid)
        if not target.org_id:
            return
        try:
            key = sa_inspect(Organization).identity_key_from_primary_key(
                (target.org_id,)
            )
            org = session.identity_map.get(key)
            if org and org.slug:
                _ensure_set(session).add(org.slug)
        except Exception:
            try:
                from sqlalchemy import text as sa_text
                row = connection.execute(
                    sa_text("SELECT slug FROM organization WHERE id = :oid"),
                    {"oid": target.org_id},
                ).first()
                if row and row[0]:
                    _ensure_set(session).add(row[0])
            except Exception:
                logging.debug("Could not look up org slug for course org_id=%s", target.org_id, exc_info=True)

    sa_event.listen(Course, "after_insert", _course_changed)
    sa_event.listen(Course, "after_update", _course_changed)
    sa_event.listen(Course, "after_delete", _course_changed)

    # ── Activity/Chapter/ChapterActivity changes also invalidate course meta ──
    from src.db.courses.activities import Activity
    from src.db.courses.chapters import Chapter
    from src.db.courses.chapter_activities import ChapterActivity

    def _course_child_changed(mapper, connection, target):
        session = Session.object_session(target)
        if not session or not getattr(target, 'course_id', None):
            return
        try:
            course_key = sa_inspect(Course).identity_key_from_primary_key(
                (target.course_id,)
            )
            course = session.identity_map.get(course_key)
            if course and course.course_uuid:
                _ensure_course_uuids(session).add(course.course_uuid)
                return
        except Exception:
            logging.debug("Could not look up course UUID from identity map for course_id=%s", target.course_id, exc_info=True)
        try:
            from sqlalchemy import text as sa_text
            row = connection.execute(
                sa_text("SELECT course_uuid FROM course WHERE id = :cid"),
                {"cid": target.course_id},
            ).first()
            if row and row[0]:
                _ensure_course_uuids(session).add(row[0])
        except Exception:
            logging.debug("Could not query course UUID for course_id=%s", target.course_id, exc_info=True)

    for model in (Activity, Chapter, ChapterActivity):
        sa_event.listen(model, "after_insert", _course_child_changed)
        sa_event.listen(model, "after_update", _course_child_changed)
        sa_event.listen(model, "after_delete", _course_child_changed)

    # ── Session-level events: run after transaction completes ──
    # These fire on the underlying sync Session that AsyncSession wraps.

    @sa_event.listens_for(Session, "after_commit")
    def _on_after_commit(session):
        slugs = getattr(session, '_org_slugs_to_invalidate', None)
        course_uuids = getattr(session, '_course_uuids_to_invalidate', None)
        org_config_ids = getattr(session, '_org_config_ids_to_invalidate', None)
        try:
            if slugs:
                from src.services.orgs.cache import invalidate_org_cache
                from src.services.courses.cache import invalidate_courses_cache
                for slug in slugs:
                    invalidate_org_cache(slug)
                    invalidate_courses_cache(slug)
            if org_config_ids:
                from src.services.orgs.cache import invalidate_org_config_cache
                for org_id in org_config_ids:
                    invalidate_org_config_cache(org_id)
            if course_uuids:
                from src.services.courses.cache import invalidate_course_meta_cache
                for uuid in course_uuids:
                    invalidate_course_meta_cache(uuid)
        except Exception:
            logging.warning("Cache invalidation after commit failed", exc_info=True)
        finally:
            session._org_slugs_to_invalidate = set()
            session._course_uuids_to_invalidate = set()
            session._org_config_ids_to_invalidate = set()

    @sa_event.listens_for(Session, "after_rollback")
    def _on_after_rollback(session):
        session._org_slugs_to_invalidate = set()
        session._course_uuids_to_invalidate = set()
        session._org_config_ids_to_invalidate = set()

if not is_testing:
    try:
        _register_cache_invalidation_hooks()
    except Exception:
        logging.warning("Failed to register cache invalidation hooks", exc_info=True)


# A saturated connection pooler ("max clients reached in session mode"), a
# rolling database restart or a brief network blip are all transient: the pod
# just needs to try again in a moment. Failing the boot instead turns a
# seconds-long blip into a crash loop, and every restart opens a fresh batch of
# connections against the pooler that is already out of clients — the outage
# feeds itself. Retry those, but keep failing fast on permanent errors
# (bad password, unknown database) where retrying only delays the real signal.
_STARTUP_CONNECT_ATTEMPTS = int(os.getenv("LEARNHOUSE_DB_STARTUP_ATTEMPTS", "5"))
_STARTUP_CONNECT_BACKOFF_SECONDS = 2.0
#
# The markers are anchored on purpose. A bare "does not exist" used to be in
# this list, which matched every missing-relation and missing-column message
# too — so a transient failure that happened to mention one was classified
# permanent and skipped the retry entirely.
_PERMANENT_CONNECT_ERROR_MARKERS = (
    "password authentication failed",
    "no pg_hba.conf entry",
    "permission denied",
)

# The other two permanent cases are a missing database and a missing role, and
# both need BOTH halves of the message. Matching only the `database "` prefix
# would classify as permanent any future pooler/proxy error that happens to
# quote a database name — which is the same over-matching the bare
# "does not exist" had, just narrower.
_PERMANENT_CONNECT_ERROR_PATTERN = re.compile(r'(?:database|role) "[^"]*" does not exist')


def _is_transient_connect_error(exc: BaseException) -> bool:
    message = str(exc).lower()
    if any(marker in message for marker in _PERMANENT_CONNECT_ERROR_MARKERS):
        return False
    return _PERMANENT_CONNECT_ERROR_PATTERN.search(message) is None


async def _bootstrap_schema():
    async with engine.begin() as conn:
        # Enable pgvector extension for vector similarity search (optional — RAG feature)
        try:
            from sqlalchemy import text
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        except Exception as e:
            logging.warning(
                "pgvector extension not available — RAG features will be disabled. "
                "Install pgvector on your PostgreSQL server to enable course chatbot. "
                "Error: %s", e
            )
        # Create all tables — but only on a database alembic does not own.
        #
        # create_all is checkfirst=True, which sounds safe and is not: on an
        # alembic-managed database that is merely BEHIND head it happily creates
        # the tables belonging to revisions that have NOT been applied yet, and
        # the next `alembic upgrade head` then dies on their CREATE TABLE. That
        # is not hypothetical here — LEARNHOUSE_RUN_MIGRATIONS=false is exactly
        # the mode where the schema can be behind at this point (an external Job
        # owns migrations and may not have run yet), and it is the mode
        # `_log_schema_drift` below exists to serve. So in the one configuration
        # where drift is expected, this call would silently poison the Job's
        # next upgrade.
        #
        # Once alembic_version exists, alembic owns the whole schema. cli.py's
        # `install` takes the same guard for the same reason.
        if not is_testing:
            alembic_managed = await conn.run_sync(
                lambda sync_conn: "alembic_version"
                in sa_inspect(sync_conn).get_table_names()
            )
            if alembic_managed:
                logging.debug(
                    "Schema is managed by alembic (alembic_version present) — "
                    "skipping create_all."
                )
            else:
                await conn.run_sync(SQLModel.metadata.create_all)


_alembic_head_cache = None


def _alembic_head_revision():
    """The migration revision this build of the code expects.

    Memoised: resolving the revision map makes alembic *execute* every file in
    migrations/versions as a Python module (66 of them), which is real startup
    latency on a path the team has been trimming. The answer cannot change
    within a process.
    """
    global _alembic_head_cache
    if _alembic_head_cache is not None:
        return _alembic_head_cache

    from alembic.config import Config
    from alembic.script import ScriptDirectory

    # .../apps/api/src/core/events/database.py -> .../apps/api
    api_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    )
    alembic_config = Config()
    alembic_config.set_main_option(
        "script_location", os.path.join(api_root, "migrations")
    )
    _alembic_head_cache = ScriptDirectory.from_config(alembic_config).get_current_head()
    return _alembic_head_cache


async def _log_schema_drift():
    """Say out loud when the database is behind the code's migrations.

    ``SQLModel.metadata.create_all`` above only ever issues CREATE TABLE — it
    never ALTERs an existing one — so a column a migration added is invisible to
    it. Before the entrypoint learned to run ``alembic upgrade head`` that
    surfaced as an UndefinedColumnError several startup steps later, on whatever
    query happened to touch the new column first, with nothing in the message
    about migrations. One SELECT per boot turns that into a one-line diagnosis.

    Never fatal: booting is decided by the migration step in the entrypoint, not
    by this check.

    Skipped entirely when the entrypoint owns migrations (the default), because
    then the boot is already gated on `alembic upgrade head` succeeding and the
    answer is known. It exists for LEARNHOUSE_RUN_MIGRATIONS=false, where an
    external Job owns migrations and nothing else would notice it never ran.
    """
    if is_testing:
        return
    if os.getenv("LEARNHOUSE_RUN_MIGRATIONS", "true").lower() == "true":
        return

    try:
        from sqlalchemy import text

        # SELECT first: on a database that has no alembic_version at all there
        # is nothing to compare against, and building the ScriptDirectory to
        # find that out would execute all 66 migration modules for nothing.
        async with engine.connect() as conn:
            row = (
                await conn.execute(text("SELECT version_num FROM alembic_version"))
            ).first()
        db_revision = row[0] if row else None
        head = _alembic_head_revision()
    except Exception:
        # No alembic_version table yet (a database only ever built by
        # create_all), no migrations directory in the image, or the DB blinked —
        # none of which is worth a word in the startup logs.
        logging.debug("Schema drift check skipped", exc_info=True)
        return

    if head and db_revision != head:
        logging.error(
            "Database schema is out of date: alembic_version is at %s, this "
            "release expects %s. Run `alembic upgrade head` — the container "
            "entrypoint does this unless LEARNHOUSE_RUN_MIGRATIONS is not 'true'.",
            db_revision or "<empty>", head,
        )


async def connect_to_db(app: FastAPI):
    attempts = max(1, _STARTUP_CONNECT_ATTEMPTS)
    for attempt in range(1, attempts + 1):
        try:
            await _bootstrap_schema()
            break
        except Exception as e:
            if attempt >= attempts or not _is_transient_connect_error(e):
                raise
            delay = _STARTUP_CONNECT_BACKOFF_SECONDS * attempt
            logging.warning(
                "Database not reachable on startup (attempt %s/%s), retrying in %ss: %s",
                attempt, attempts, delay, e,
            )
            # Drop whatever half-open connections the failed attempt left in the
            # pool so the retry doesn't hand them straight back to us.
            try:
                await engine.dispose()
            except Exception:
                logging.debug("Engine dispose before retry failed", exc_info=True)
            await asyncio.sleep(delay)

    await _log_schema_drift()

    app.db_engine = engine  # type: ignore
    logging.info("LearnHouse database has been started.")


async def get_db_session() -> AsyncSession:  # type: ignore[override]
    async with _async_session_factory() as session:
        yield session


async def close_database(app: FastAPI):
    db_engine = getattr(app, "db_engine", None)
    if db_engine is not None and hasattr(db_engine, "dispose"):
        await db_engine.dispose()
    logging.info("LearnHouse has been shut down.")
    return app
