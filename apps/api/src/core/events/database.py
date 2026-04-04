import logging
import os
import importlib
from config.config import get_learnhouse_config
from fastapi import FastAPI
from sqlmodel import SQLModel, Session, create_engine
from sqlalchemy import event

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
    # Use SQLite for tests
    engine = create_engine(
        "sqlite:///:memory:",
        echo=False,
        connect_args={"check_same_thread": False}
    )
else:
    # Use configured database for production/development
    engine = create_engine(
        learnhouse_config.database_config.sql_connection_string,  # type: ignore
        echo=False, 
        pool_pre_ping=True,  # type: ignore
        pool_size=20,  # Increased from 5 to handle more concurrent requests
        max_overflow=10,  # Allow 10 additional connections beyond pool_size
        pool_recycle=300,  # Recycle connections after 5 minutes
        pool_timeout=30
    )
    
    # Add connection pool monitoring for debugging
    @event.listens_for(engine, "connect")
    def receive_connect(dbapi_connection, connection_record):
        logging.debug("Database connection established")
    
    @event.listens_for(engine, "checkout")
    def receive_checkout(dbapi_connection, connection_record, connection_proxy):
        logging.debug("Connection checked out from pool")
    
    @event.listens_for(engine, "checkin")
    def receive_checkin(dbapi_connection, connection_record):
        logging.debug("Connection returned to pool")

# Only create tables if not in test mode (tests will handle this themselves)
if not is_testing:
    # Enable pgvector extension for vector similarity search (optional — RAG feature)
    from sqlalchemy import text
    try:
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.commit()
    except Exception as e:
        logging.warning(
            "pgvector extension not available — RAG features will be disabled. "
            "Install pgvector on your PostgreSQL server to enable course chatbot. "
            "Error: %s", e
        )
    SQLModel.metadata.create_all(engine)

async def connect_to_db(app: FastAPI):
    app.db_engine = engine  # type: ignore
    logging.info("LearnHouse database has been started.")

def _register_cache_invalidation_hooks():
    """
    Automatically invalidate the org Redis cache when Organization or
    OrganizationConfig rows are inserted, updated, or deleted.

    Uses mapper-level events (after_insert/after_update/after_delete) which
    fire per-object DURING the flush, while the target and its attribute
    history are still accessible. Slugs are collected per-session, then
    the actual Redis invalidation runs after_commit (so we only invalidate
    on successful transactions).
    """
    from sqlalchemy import event as sa_event, inspect as sa_inspect
    from src.db.organizations import Organization
    from src.db.organization_config import OrganizationConfig

    def _ensure_set(session):
        if not hasattr(session, '_org_slugs_to_invalidate'):
            session._org_slugs_to_invalidate = set()
        return session._org_slugs_to_invalidate

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
        # If slug was renamed, also invalidate the old slug
        try:
            history = sa_inspect(target).attrs.slug.history
            for old_slug in (history.deleted or []):
                _ensure_set(session).add(old_slug)
        except Exception:
            pass

    @sa_event.listens_for(Organization, "after_delete")
    def _org_after_delete(mapper, connection, target):
        session = Session.object_session(target)
        if session and target.slug:
            _ensure_set(session).add(target.slug)

    def _orgconfig_changed(mapper, connection, target):
        session = Session.object_session(target)
        if not session or not target.org_id:
            return
        # Use the identity map key to look up the org without issuing SQL.
        # session.get() is unsafe here because it can emit a SELECT mid-flush
        # if the org isn't already loaded, causing reentrancy issues.
        try:
            key = sa_inspect(Organization).identity_key_from_primary_key(
                (target.org_id,)
            )
            org = session.identity_map.get(key)
            if org and org.slug:
                _ensure_set(session).add(org.slug)
        except Exception:
            # If identity map lookup fails for any reason, fall back to
            # querying the slug directly via the connection (bypasses ORM flush)
            try:
                from sqlalchemy import text as sa_text
                row = connection.execute(
                    sa_text("SELECT slug FROM organization WHERE id = :oid"),
                    {"oid": target.org_id},
                ).first()
                if row and row[0]:
                    _ensure_set(session).add(row[0])
            except Exception:
                pass

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
        # Track course UUID for meta cache invalidation
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
                pass

    sa_event.listen(Course, "after_insert", _course_changed)
    sa_event.listen(Course, "after_update", _course_changed)
    sa_event.listen(Course, "after_delete", _course_changed)

    # ── Activity/Chapter/ChapterActivity changes also invalidate course meta ──
    from src.db.courses.activities import Activity
    from src.db.courses.chapters import Chapter
    from src.db.courses.chapter_activities import ChapterActivity

    def _course_child_changed(mapper, connection, target):
        """When an activity, chapter, or chapter_activity changes, invalidate the parent course meta."""
        session = Session.object_session(target)
        if not session or not getattr(target, 'course_id', None):
            return
        # Look up the course UUID from the identity map first (no SQL needed)
        try:
            course_key = sa_inspect(Course).identity_key_from_primary_key(
                (target.course_id,)
            )
            course = session.identity_map.get(course_key)
            if course and course.course_uuid:
                _ensure_course_uuids(session).add(course.course_uuid)
                return
        except Exception:
            pass
        # Fallback: query the course UUID directly via connection
        try:
            from sqlalchemy import text as sa_text
            row = connection.execute(
                sa_text("SELECT course_uuid FROM course WHERE id = :cid"),
                {"cid": target.course_id},
            ).first()
            if row and row[0]:
                _ensure_course_uuids(session).add(row[0])
        except Exception:
            pass

    for model in (Activity, Chapter, ChapterActivity):
        sa_event.listen(model, "after_insert", _course_child_changed)
        sa_event.listen(model, "after_update", _course_child_changed)
        sa_event.listen(model, "after_delete", _course_child_changed)

    # ── Session-level events: run after transaction completes ──

    @sa_event.listens_for(Session, "after_commit")
    def _on_after_commit(session):
        slugs = getattr(session, '_org_slugs_to_invalidate', None)
        course_uuids = getattr(session, '_course_uuids_to_invalidate', None)
        try:
            if slugs:
                from src.services.orgs.cache import invalidate_org_cache
                from src.services.courses.cache import invalidate_courses_cache
                for slug in slugs:
                    invalidate_org_cache(slug)
                    invalidate_courses_cache(slug)
            if course_uuids:
                from src.services.courses.cache import invalidate_course_meta_cache
                for uuid in course_uuids:
                    invalidate_course_meta_cache(uuid)
        except Exception:
            logging.warning("Cache invalidation after commit failed", exc_info=True)
        finally:
            session._org_slugs_to_invalidate = set()
            session._course_uuids_to_invalidate = set()

    @sa_event.listens_for(Session, "after_rollback")
    def _on_after_rollback(session):
        session._org_slugs_to_invalidate = set()
        session._course_uuids_to_invalidate = set()

if not is_testing:
    try:
        _register_cache_invalidation_hooks()
    except Exception:
        logging.warning("Failed to register cache invalidation hooks", exc_info=True)


def get_db_session():
    with Session(engine) as session:
        yield session

async def close_database(app: FastAPI):
    logging.info("LearnHouse has been shut down.")
    return app
