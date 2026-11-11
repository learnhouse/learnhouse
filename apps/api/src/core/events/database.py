import asyncio
import logging
import os
import importlib
import time
from config.config import get_learnhouse_config
from fastapi import FastAPI
from sqlmodel import SQLModel, Session
from sqlalchemy import event, exc as sa_exc
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

    # Pre-ping is done by hand below: only for connections that sat idle.
    if is_pooled:
        engine_kwargs = dict(
            pool_pre_ping=False,
            pool_size=5,
            max_overflow=10,
            pool_recycle=1800,
            pool_timeout=30,
            connect_args=_connect_args,
        )
        logging.info("DB engine: detected connection pooler, using small client-side pool.")
    else:
        engine_kwargs = dict(
            pool_pre_ping=False,
            pool_size=20,
            max_overflow=10,
            pool_recycle=300,
            pool_timeout=30,
            connect_args=_connect_args,
        )

    engine = create_async_engine(sql_url, echo=False, **engine_kwargs)  # type: ignore

    _PING_AFTER_IDLE_SECONDS = float(os.getenv("LEARNHOUSE_DB_PING_AFTER_IDLE_SECONDS", "10"))

    @event.listens_for(engine.sync_engine, "checkin")
    def receive_checkin(dbapi_connection, connection_record):
        connection_record.info["checked_in_at"] = time.monotonic()

    # SQLAlchemy's pool_pre_ping pings on every checkout, and on asyncpg a ping
    # is BEGIN + a prepared ";" + ROLLBACK: four round trips to the database
    # before each request does any work. A connection that was in use a moment
    # ago is alive, so only ping the ones that sat idle long enough for the
    # pooler or a database restart to have dropped them. A failed ping raises
    # InvalidatePoolError: the pool hands out a fresh connection and recycles
    # the others, exactly like pool_pre_ping.
    @event.listens_for(engine.sync_engine, "checkout")
    def ping_if_idle(dbapi_connection, connection_record, connection_proxy):
        checked_in_at = connection_record.info.get("checked_in_at")
        if checked_in_at is None or time.monotonic() - checked_in_at < _PING_AFTER_IDLE_SECONDS:
            return
        try:
            engine.dialect.do_ping(dbapi_connection)
        except Exception as error:
            raise sa_exc.InvalidatePoolError() from error


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
        # None, not an exception. Falling back only on exception therefore left
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

# Not a cache hook, so it runs under tests too: editing a course's content
# moves the course's update_date.
from src.core.events.content_dates import register_content_date_hooks  # noqa: E402

register_content_date_hooks()


# A saturated connection pooler ("max clients reached in session mode"), a
# rolling database restart or a brief network blip are all transient: the pod
# just needs to try again in a moment. Failing the boot instead turns a
# seconds-long blip into a crash loop, and every restart opens a fresh batch of
# connections against the pooler that is already out of clients; the outage
# feeds itself. Retry those, but keep failing fast on permanent errors
# (bad password, unknown database) where retrying only delays the real signal.
_STARTUP_CONNECT_ATTEMPTS = int(os.getenv("LEARNHOUSE_DB_STARTUP_ATTEMPTS", "5"))
_STARTUP_CONNECT_BACKOFF_SECONDS = 2.0
_PERMANENT_CONNECT_ERROR_MARKERS = (
    "password authentication failed",
    "role \"",
    "does not exist",
    "no pg_hba.conf entry",
    "permission denied",
)


def _is_transient_connect_error(exc: BaseException) -> bool:
    message = str(exc).lower()
    return not any(marker in message for marker in _PERMANENT_CONNECT_ERROR_MARKERS)


async def _bootstrap_schema():
    # The normal path: migrate (or bootstrap) the schema under a lock, in a
    # worker thread since Alembic is synchronous. See src/core/migrations.py.
    if not is_testing:
        from src.core.migrations import auto_migrate_enabled, ensure_schema

        if auto_migrate_enabled():
            await asyncio.to_thread(ensure_schema)
            return
        logging.info("LEARNHOUSE_AUTO_MIGRATE is off; only creating missing tables")

    async with engine.begin() as conn:
        # Enable pgvector extension for vector similarity search (optional; used by the RAG feature)
        try:
            from sqlalchemy import text
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        except Exception as e:
            logging.warning(
                "pgvector extension not available; RAG features will be disabled. "
                "Install pgvector on your PostgreSQL server to enable course chatbot. "
                "Error: %s", e
            )
        # Create all tables
        if not is_testing:
            await conn.run_sync(SQLModel.metadata.create_all)


async def connect_to_db(app: FastAPI):
    attempts = max(1, _STARTUP_CONNECT_ATTEMPTS)
    for attempt in range(1, attempts + 1):
        try:
            await _bootstrap_schema()
            break
        except Exception as e:
            from src.core.migrations import SchemaMigrationError

            # A failed migration is not a blip: retrying only delays the
            # crash that keeps this release from serving on the old schema.
            if attempt >= attempts or isinstance(e, SchemaMigrationError) or not _is_transient_connect_error(e):
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
