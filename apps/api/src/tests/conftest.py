"""
Shared test fixtures for the LearnHouse API test suite.

Provides reusable fixtures for database, models, users, RBAC bypass,
and httpx AsyncClient for router tests. All integration tests use an
in-memory SQLite database with JSONB-to-JSON remapping.
"""

import copy
import os
import sys

# Ensure src/ is on the Python path for all tests
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

# Set testing environment variable to use SQLite (must be before any app imports)
os.environ["TESTING"] = "true"

# Pin the deployment mode to 'oss' for the whole suite.
#
# Unpinned, get_deployment_mode() resolves against the filesystem: 'oss' in CI
# (no ee/ checkout) but potentially 'ee' on a developer machine with the
# apps/api/ee symlink. That divergence hides EE-gating regressions locally.
# Going through LEARNHOUSE_DISABLE_EE rather than patching
# get_deployment_mode is deliberate: several modules import that symbol at
# load time, so a patch would reach only the lazy importers and leave the
# suite split-brained, silently relaxing the SaaS plan gates that key off the
# same function. Tests that need 'saas' or 'ee' patch it explicitly.
os.environ["LEARNHOUSE_DISABLE_EE"] = "1"

# Pin the demo organization off for the whole suite.
#
# config.py calls load_dotenv() while parsing, so a developer running the local
# demo stack has LEARNHOUSE_DEMO_ENABLED=1 in apps/api/.env and it leaks into
# the test process. The demo scheduler then starts a background task, and
# tests that assert on the application's task lifecycle fail on that machine
# and nowhere else. Tests that need the feature on enable it themselves.
os.environ["LEARNHOUSE_DEMO_ENABLED"] = "0"

# Set a valid JWT secret key for tests (must be at least 32 characters)
os.environ["LEARNHOUSE_AUTH_JWT_SECRET_KEY"] = (
    "test-secret-key-for-unit-tests-32chars!"
)


from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import JSON, create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.requests import Request

from src.db.courses.activities import (
    Activity,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.db.folders.folders import Folder
from src.db.folders.folder_content import FolderContent
from src.db.organizations import Organization
from src.db.roles import (
    DashboardPermission,
    Permission,
    PermissionsWithOwn,
    Rights,
    Role,
    RoleTypeEnum,
)
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, PublicUser, User


# ---------------------------------------------------------------------------
# Rights helpers
# ---------------------------------------------------------------------------

def _full_permission() -> Permission:
    return Permission(
        action_create=True,
        action_read=True,
        action_update=True,
        action_delete=True,
    )


def _full_permission_with_own() -> PermissionsWithOwn:
    return PermissionsWithOwn(
        action_create=True,
        action_read=True,
        action_read_own=True,
        action_update=True,
        action_update_own=True,
        action_delete=True,
        action_delete_own=True,
    )


def _readonly_permission() -> Permission:
    return Permission(
        action_create=False,
        action_read=True,
        action_update=False,
        action_delete=False,
    )


def _readonly_permission_with_own() -> PermissionsWithOwn:
    return PermissionsWithOwn(
        action_create=False,
        action_read=True,
        action_read_own=True,
        action_update=False,
        action_update_own=False,
        action_delete=False,
        action_delete_own=False,
    )


ADMIN_RIGHTS = Rights(
    courses=_full_permission_with_own(),
    users=_full_permission(),
    usergroups=_full_permission(),
    folders=_full_permission(),
    media=_full_permission(),
    organizations=_full_permission(),
    coursechapters=_full_permission(),
    activities=_full_permission(),
    roles=_full_permission(),
    dashboard=DashboardPermission(action_access=True),
    communities=_full_permission(),
    discussions=_full_permission_with_own(),
    podcasts=_full_permission_with_own(),
    boards=_full_permission_with_own(),
    playgrounds=_full_permission_with_own(),
)

USER_RIGHTS = Rights(
    courses=_readonly_permission_with_own(),
    users=_readonly_permission(),
    usergroups=_readonly_permission(),
    folders=_readonly_permission(),
    media=_readonly_permission(),
    organizations=_readonly_permission(),
    coursechapters=_readonly_permission(),
    activities=_readonly_permission(),
    roles=_readonly_permission(),
    dashboard=DashboardPermission(action_access=False),
    communities=_readonly_permission(),
    discussions=_readonly_permission_with_own(),
    podcasts=_readonly_permission_with_own(),
    boards=_readonly_permission_with_own(),
    playgrounds=_readonly_permission_with_own(),
)


# ---------------------------------------------------------------------------
# Database fixtures
# ---------------------------------------------------------------------------

_schema_cache: dict[frozenset[str], str] = {}


def _sqlite_schema_script() -> str:
    """The DDL that ``metadata.create_all`` emits on SQLite, as one script.

    ``create_all`` compiles every table and probes for its existence one
    statement at a time, which costs ~100ms per call. Every test that touches
    the database used to pay that, and it was most of the suite's runtime.
    Running it once on a throwaway sync engine and replaying what SQLite stored
    gives each test an identical schema for a few milliseconds.

    Keyed on the registered table names: model modules imported lazily by a
    test add tables to the metadata, and the next engine must include them.
    """
    for table in SQLModel.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, JSONB):
                col.type = JSON()

    key = frozenset(SQLModel.metadata.tables)
    script = _schema_cache.get(key)
    if script is None:
        sync_engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(sync_engine)
        with sync_engine.connect() as conn:
            rows = conn.exec_driver_sql(
                "SELECT sql FROM sqlite_master "
                "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid"
            ).all()
        sync_engine.dispose()
        script = ";\n".join(row[0] for row in rows) + ";"
        _schema_cache[key] = script
    return script


async def create_test_engine():
    """In-memory async SQLite engine with the full schema already created."""
    script = _sqlite_schema_script()
    eng = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with eng.connect() as conn:
        raw = await conn.get_raw_connection()
        await raw.driver_connection.executescript(script)
    return eng


_data_snapshots: dict[str, tuple[str, object]] = {}


async def build_once(engine, db, key: str, build):
    """Run ``build(db)`` once per test process and replay its rows afterwards.

    For fixtures that write thousands of rows through the real code (the demo
    sync takes ~10s), every test after the first gets the same database
    contents from a SQL dump in milliseconds. Returns a deep copy of what
    ``build`` returned. Must be called before the session has done anything
    else, since the replay runs on the engine's single connection.
    """
    cached = _data_snapshots.get(key)
    if cached is None:
        result = await build(db)
        async with engine.connect() as conn:
            raw = await conn.get_raw_connection()
            statements = [s async for s in raw.driver_connection.iterdump()]
        # The schema is already there on a fresh engine; keep only the rows.
        rows = "\n".join(s for s in statements if not s.startswith("CREATE "))
        _data_snapshots[key] = (rows, result)
        return result

    rows, result = cached
    async with engine.connect() as conn:
        raw = await conn.get_raw_connection()
        await raw.driver_connection.executescript(rows)
    return copy.deepcopy(result)


@pytest.fixture
async def engine():
    """In-memory async SQLite engine with JSONB-to-JSON remapping."""
    eng = await create_test_engine()
    yield eng
    await eng.dispose()


@pytest.fixture
async def db(engine):
    """Yields an async SQLModel AsyncSession bound to the in-memory engine."""
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session


# ---------------------------------------------------------------------------
# Organization fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
async def org(db):
    """Primary test organization."""
    o = Organization(
        id=1,
        name="Test Org",
        slug="test-org",
        email="test@org.com",
        org_uuid="org_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(o)
    await db.commit()
    await db.refresh(o)
    return o


@pytest.fixture
async def other_org(db):
    """Secondary organization for cross-org isolation tests."""
    o = Organization(
        id=2,
        name="Other Org",
        slug="other-org",
        email="other@org.com",
        org_uuid="org_other",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(o)
    await db.commit()
    await db.refresh(o)
    return o


# ---------------------------------------------------------------------------
# Role fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
async def admin_role(db, org):
    """Admin role (id=1) with full permissions."""
    r = Role(
        id=1,
        name="Admin",
        org_id=org.id,
        role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_admin",
        rights=ADMIN_RIGHTS.model_dump(),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return r


@pytest.fixture
async def user_role(db, org):
    """Regular user role (id=4) with read-only permissions."""
    r = Role(
        id=4,
        name="User",
        org_id=org.id,
        role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_user",
        rights=USER_RIGHTS.model_dump(),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return r


# ---------------------------------------------------------------------------
# User fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
async def admin_user(db, org, admin_role):
    """Admin user linked to the test org with admin role."""
    u = User(
        id=1,
        username="admin",
        first_name="Admin",
        last_name="User",
        email="admin@test.com",
        password="hashed_password",
        user_uuid="user_admin",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    uo = UserOrganization(
        user_id=u.id,
        org_id=org.id,
        role_id=admin_role.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(uo)
    await db.commit()
    return PublicUser(
        id=u.id,
        username=u.username,
        first_name=u.first_name,
        last_name=u.last_name,
        email=u.email,
        user_uuid=u.user_uuid,
    )


@pytest.fixture
async def regular_user(db, org, user_role):
    """Regular user linked to the test org with user role."""
    u = User(
        id=2,
        username="regular",
        first_name="Regular",
        last_name="User",
        email="regular@test.com",
        password="hashed_password",
        user_uuid="user_regular",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    uo = UserOrganization(
        user_id=u.id,
        org_id=org.id,
        role_id=user_role.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(uo)
    await db.commit()
    return PublicUser(
        id=u.id,
        username=u.username,
        first_name=u.first_name,
        last_name=u.last_name,
        email=u.email,
        user_uuid=u.user_uuid,
    )


@pytest.fixture
def anonymous_user():
    """Anonymous (unauthenticated) user."""
    return AnonymousUser()


# ---------------------------------------------------------------------------
# Course / Chapter / Activity fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
async def course(db, org):
    """A published, public course in the test org."""
    c = Course(
        id=1,
        name="Test Course",
        description="A test course",
        public=True,
        published=True,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid="course_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return c


@pytest.fixture
async def chapter(db, org, course):
    """A chapter linked to the test course."""
    ch = Chapter(
        id=1,
        name="Test Chapter",
        description="A test chapter",
        org_id=org.id,
        course_id=course.id,
        chapter_uuid="chapter_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(ch)
    await db.commit()
    await db.refresh(ch)
    link = CourseChapter(
        chapter_id=ch.id,
        course_id=course.id,
        org_id=org.id,
        order=1,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(link)
    await db.commit()
    return ch


@pytest.fixture
async def activity(db, org, course, chapter):
    """A published activity linked to the test chapter."""
    a = Activity(
        id=1,
        name="Test Activity",
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={"type": "doc", "content": []},
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid="activity_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    link = ChapterActivity(
        order=1,
        chapter_id=chapter.id,
        activity_id=a.id,
        course_id=course.id,
        org_id=org.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(link)
    await db.commit()
    return a


# ---------------------------------------------------------------------------
# Folder fixture
# ---------------------------------------------------------------------------

@pytest.fixture
async def folder(db, org, course):
    """A public folder containing the test course."""
    f = Folder(
        id=1,
        name="Test Folder",
        description="A test folder",
        public=True,
        org_id=org.id,
        folder_uuid="folder_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(f)
    await db.commit()
    await db.refresh(f)
    link = FolderContent(
        folder_id=f.id,
        resource_uuid=course.course_uuid,
        org_id=org.id,
        position=0,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(link)
    await db.commit()
    return f


# ---------------------------------------------------------------------------
# Request / bypass fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def no_legacy_link_markers():
    """Keep sign-in link redemption off any real Redis.

    The single-use record is the database; the legacy Redis markers are a
    best-effort rollout bridge. Reaching a local Redis from tests would leak
    "spent" markers between tests that reuse a jti. Tests of the bridge patch
    ``_legacy_redis`` themselves.
    """
    with patch("src.services.auth.link_tokens._legacy_redis", return_value=None):
        yield


@pytest.fixture(autouse=True)
def analytics_queue():
    """Collect the events ``track()`` sends instead of handing them to EE.

    ``track()`` forwards every event to the Enterprise Edition, which stores
    it. Here each call is kept as a dict of its arguments (``event_name``,
    ``org_id``, ``user_id``, ``properties``...), in order, for tests that want
    to look at them; nothing reaches EE even when it is installed. The EE
    suite overrides this fixture with one that yields its writer's queue.
    """
    queue: list[dict] = []

    async def record(**event) -> None:
        queue.append(event)

    with patch("src.services.analytics.analytics.track_ee_analytics_event", new=record):
        yield queue


@pytest.fixture(autouse=True)
def rag_dispatch():
    """Keep content saves from starting real AI indexing runs.

    Every content mutation schedules re-indexing; unpatched, that would reach
    Redis or start a background run against the app database. The mock
    records what would have been scheduled.
    """
    with patch("src.services.ai.rag.queue._dispatch") as dispatch:
        yield dispatch


@pytest.fixture(autouse=True)
def no_ai_acting_user():
    """Start every test with no AI acting user.

    ``enforce_ai_rate_limit`` records the caller in a ContextVar. A sync test
    that calls it sets the variable in the main thread's context, where it
    stays for every later test on that worker; the AI credit tests then hit
    the demo-visitor branch and fail depending on test order.
    """
    from src.services.security.rate_limiting import ai_acting_user

    ai_acting_user.set(None)


@pytest.fixture
def mock_request():
    """Minimal Starlette Request for passing to service functions."""
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [],
        "query_string": b"",
    }
    return Request(scope)


@pytest.fixture
def bypass_rbac():
    """Patches check_resource_access to a no-op AsyncMock."""
    with patch(
        "src.security.rbac.check_resource_access",
        new_callable=AsyncMock,
    ) as mock:
        yield mock


@pytest.fixture
def bypass_webhooks():
    """Patches dispatch_webhooks to a no-op AsyncMock."""
    with patch(
        "src.services.webhooks.dispatch.dispatch_webhooks",
        new_callable=AsyncMock,
    ) as mock:
        yield mock


@pytest.fixture
def bypass_analytics():
    """Patches analytics track to a no-op AsyncMock."""
    with patch(
        "src.services.analytics.analytics.track",
        new_callable=AsyncMock,
    ) as mock:
        yield mock


class AICreditSpy:
    """Records what AI charges reserve, refund and settle (see ``ai_credit_spy``)."""

    def __init__(self):
        self.reserved: list[tuple[int, int]] = []
        self.refunded: list[tuple[int, int]] = []
        self.extra: list[tuple[int, int]] = []
        self.settled: list = []  # Meter objects, in settlement order
        self.reserve_error: Exception | None = None

    @property
    def features(self) -> list[str]:
        return [m.feature for m in self.settled]

    @property
    def last(self):
        return self.settled[-1]

    def charged(self, feature: str | None = None) -> int:
        return sum(m.credits for m in self.settled if feature is None or m.feature == feature)


@pytest.fixture
def ai_credit_spy():
    """Fakes the Redis credit store under ``src.services.ai.metering`` (reserve,
    refund, settlement charge, limits, idempotency lock) and the usage ledger,
    and records every settled charge. Set ``spy.reserve_error`` to make the
    reservation fail (e.g. ``HTTPException(403)`` for "out of credits")."""
    spy = AICreditSpy()

    async def reserve(org_id, db_session=None, amount=1):
        if spy.reserve_error is not None:
            raise spy.reserve_error
        spy.reserved.append((org_id, amount))
        return amount

    def refund(org_id, amount=1):
        spy.refunded.append((org_id, amount))
        return 0

    def up_to(org_id, amount, limits=None):
        spy.extra.append((org_id, amount))
        return amount

    async def limits(org_id, db_session):
        return {"base": 0, "extra": 0, "unlimited": True}

    async def ledger(meter):
        spy.settled.append(meter)

    with patch("src.security.features_utils.usage.reserve_ai_credit", reserve), \
         patch("src.security.features_utils.usage.refund_ai_credit", refund), \
         patch("src.security.features_utils.usage.charge_ai_credit_up_to", up_to), \
         patch("src.security.features_utils.usage.ai_credit_limits", limits), \
         patch("src.services.ai.metering._write_ledger", ledger), \
         patch("src.services.ai.metering._take_lock", lambda key: None), \
         patch("src.services.ai.metering._forget_lock", lambda key: None):
        yield spy
