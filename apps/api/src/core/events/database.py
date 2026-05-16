import logging
import os
import importlib
from config.config import get_learnhouse_config
from fastapi import FastAPI
from sqlmodel import SQLModel, Session
from sqlalchemy import event
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

    # Supavisor (Supabase connection pooler) multiplexes many client requests
    # over a small set of upstream backends, so the app-side pool should be
    # small. The pooler hostname is "*.pooler.supabase.*" and transaction-mode
    # listens on :6543; either signal switches us to pooler-friendly settings.
    is_pooled = "pooler.supabase" in sql_url or ":6543/" in sql_url

    if is_pooled:
        engine_kwargs = dict(
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=10,
            pool_recycle=1800,
            pool_timeout=30,
        )
        logging.info("DB engine: detected Supavisor pooler URL — using small client-side pool.")
    else:
        engine_kwargs = dict(
            pool_pre_ping=True,
            pool_size=20,
            max_overflow=10,
            pool_recycle=300,
            pool_timeout=30,
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
                logging.debug("Could not look up org slug for config org_id=%s", target.org_id, exc_info=True)

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


async def connect_to_db(app: FastAPI):
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
        # Create all tables
        if not is_testing:
            await conn.run_sync(SQLModel.metadata.create_all)
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
