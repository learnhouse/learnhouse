"""
Shared test fixtures for the LearnHouse API test suite.

Provides reusable fixtures for database, models, users, RBAC bypass,
and httpx AsyncClient for router tests. All integration tests use an
in-memory SQLite database with JSONB-to-JSON remapping.
"""

import os
import sys

# Ensure src/ is on the Python path for all tests
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

# Set testing environment variable to use SQLite (must be before any app imports)
os.environ["TESTING"] = "true"

# Set a valid JWT secret key for tests (must be at least 32 characters)
os.environ["LEARNHOUSE_AUTH_JWT_SECRET_KEY"] = (
    "test-secret-key-for-unit-tests-32chars!"
)


from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine
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
from src.db.collections import Collection
from src.db.collections_courses import CollectionCourse
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
    collections=_full_permission(),
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
    collections=_readonly_permission(),
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

@pytest.fixture
def engine():
    """In-memory SQLite engine with JSONB-to-JSON remapping."""
    eng = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    for table in SQLModel.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, JSONB):
                col.type = JSON()
    SQLModel.metadata.create_all(eng)
    return eng


@pytest.fixture
def db(engine):
    """Yields a SQLModel Session bound to the in-memory engine."""
    with Session(engine) as session:
        yield session


# ---------------------------------------------------------------------------
# Organization fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def org(db):
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
    db.commit()
    db.refresh(o)
    return o


@pytest.fixture
def other_org(db):
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
    db.commit()
    db.refresh(o)
    return o


# ---------------------------------------------------------------------------
# Role fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def admin_role(db, org):
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
    db.commit()
    db.refresh(r)
    return r


@pytest.fixture
def user_role(db, org):
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
    db.commit()
    db.refresh(r)
    return r


# ---------------------------------------------------------------------------
# User fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def admin_user(db, org, admin_role):
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
    db.commit()
    db.refresh(u)
    uo = UserOrganization(
        user_id=u.id,
        org_id=org.id,
        role_id=admin_role.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(uo)
    db.commit()
    return PublicUser(
        id=u.id,
        username=u.username,
        first_name=u.first_name,
        last_name=u.last_name,
        email=u.email,
        user_uuid=u.user_uuid,
    )


@pytest.fixture
def regular_user(db, org, user_role):
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
    db.commit()
    db.refresh(u)
    uo = UserOrganization(
        user_id=u.id,
        org_id=org.id,
        role_id=user_role.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(uo)
    db.commit()
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
def course(db, org):
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
    db.commit()
    db.refresh(c)
    return c


@pytest.fixture
def chapter(db, org, course):
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
    db.commit()
    db.refresh(ch)
    link = CourseChapter(
        chapter_id=ch.id,
        course_id=course.id,
        org_id=org.id,
        order=1,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(link)
    db.commit()
    return ch


@pytest.fixture
def activity(db, org, course, chapter):
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
    db.commit()
    db.refresh(a)
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
    db.commit()
    return a


# ---------------------------------------------------------------------------
# Collection fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def collection(db, org, course):
    """A public collection containing the test course."""
    c = Collection(
        id=1,
        name="Test Collection",
        description="A test collection",
        public=True,
        org_id=org.id,
        collection_uuid="collection_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    link = CollectionCourse(
        collection_id=c.id,
        course_id=course.id,
        org_id=org.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(link)
    db.commit()
    return c


# ---------------------------------------------------------------------------
# Request / bypass fixtures
# ---------------------------------------------------------------------------

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
