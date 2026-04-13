"""
Integration tests for the course-tree loader (get_course_chapters).

Uses an in-memory SQLite database with real SQLModel tables to verify:

  1. slim=True returns ActivityRead objects with content={} / details=None
     even when the underlying Activity rows have huge content/details.
  2. slim=False returns the full content/details (regression guard for the
     non-slim branch).
  3. with_unpublished_activities=False filters out unpublished activities
     in the slim projection path.
  4. Passing course= as a kwarg produces output identical to the implicit
     course lookup path (regression guard for the duplicate-SELECT removal).
"""

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
from src.db.organizations import Organization
from src.db.users import PublicUser
from src.services.courses.chapters import get_course_chapters


# ── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # Map JSONB -> JSON for SQLite compatibility
    for table in SQLModel.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, JSONB):
                col.type = JSON()
    SQLModel.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def db(engine):
    with Session(engine) as session:
        yield session


@pytest.fixture
def org(db):
    o = Organization(
        id=1,
        name="Test Org",
        slug="test-org",
        email="e@o.com",
        org_uuid="org_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(o)
    db.commit()
    db.refresh(o)
    return o


@pytest.fixture
def course(db, org):
    c = Course(
        id=1,
        name="Test Course",
        description="",
        public=True,
        published=True,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid="course_tree",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@pytest.fixture
def chapter(db, org, course):
    ch = Chapter(
        id=1,
        name="Ch 1",
        description="",
        org_id=org.id,
        course_id=course.id,
        chapter_uuid="chapter_1",
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
def heavy_activity(db, org, course, chapter):
    """An activity with a large content dict, to prove slim strips it."""
    big_content = {
        "type": "doc",
        "content": [{"type": "paragraph", "text": "x" * 5000}] * 20,
    }
    big_details = {"key": "value" * 500, "another": ["item"] * 100}
    a = Activity(
        id=1,
        name="Heavy Activity",
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content=big_content,
        details=big_details,
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid="activity_heavy",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    db.add(
        ChapterActivity(
            order=1,
            chapter_id=chapter.id,
            activity_id=a.id,
            course_id=course.id,
            org_id=org.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    db.commit()
    return a


@pytest.fixture
def second_activity(db, org, course, chapter):
    a = Activity(
        id=2,
        name="Second Activity",
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE,
        content={"videoId": "abc123"},
        details=None,
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid="activity_second",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    db.add(
        ChapterActivity(
            order=2,
            chapter_id=chapter.id,
            activity_id=a.id,
            course_id=course.id,
            org_id=org.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    db.commit()
    return a


@pytest.fixture
def mock_request():
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [],
        "query_string": b"",
    }
    return Request(scope)


@pytest.fixture
def public_user():
    return PublicUser(
        id=1,
        username="u",
        first_name="U",
        last_name="T",
        email="u@t.com",
        user_uuid="user_t",
    )


@pytest.fixture
def bypass_rbac():
    """RBAC checks are covered by test_resource_access.py; here we just want
    to exercise the data path."""
    with patch(
        "src.services.courses.chapters.check_resource_access",
        new_callable=AsyncMock,
    ):
        yield


# ── Tests ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_slim_projection_strips_content_and_details(
    db,
    mock_request,
    public_user,
    course,
    chapter,
    heavy_activity,
    second_activity,
    bypass_rbac,
):
    """slim=True returns navigation fields with content={} / details=None."""
    chapters = await get_course_chapters(
        mock_request,
        course.id,
        db,
        public_user,
        with_unpublished_activities=True,
        slim=True,
        course=course,
    )

    assert len(chapters) == 1
    activities = chapters[0].activities
    assert len(activities) == 2

    # Order follows ChapterActivity.order: heavy (1) then second (2)
    heavy = activities[0]
    assert heavy.activity_uuid == "activity_heavy"
    assert heavy.name == "Heavy Activity"
    assert heavy.activity_type == ActivityTypeEnum.TYPE_DYNAMIC
    assert heavy.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE
    assert heavy.published is True
    assert heavy.org_id == course.org_id
    assert heavy.course_id == course.id
    # Critical: content and details stripped regardless of DB payload
    assert heavy.content == {}
    assert heavy.details is None

    second = activities[1]
    assert second.activity_uuid == "activity_second"
    assert second.activity_type == ActivityTypeEnum.TYPE_VIDEO
    assert second.content == {}
    assert second.details is None


@pytest.mark.asyncio
async def test_non_slim_returns_full_content(
    db,
    mock_request,
    public_user,
    course,
    chapter,
    heavy_activity,
    bypass_rbac,
):
    """slim=False returns the full activity content (regression guard)."""
    chapters = await get_course_chapters(
        mock_request,
        course.id,
        db,
        public_user,
        with_unpublished_activities=True,
        slim=False,
        course=course,
    )

    activities = chapters[0].activities
    assert len(activities) == 1
    full = activities[0]
    assert full.content.get("type") == "doc"
    assert full.details is not None
    assert "key" in full.details


@pytest.mark.asyncio
async def test_slim_respects_published_filter(
    db,
    mock_request,
    public_user,
    course,
    chapter,
    heavy_activity,
    second_activity,
    bypass_rbac,
):
    """with_unpublished_activities=False filters unpublished rows in slim mode."""
    heavy_activity.published = False
    db.add(heavy_activity)
    db.commit()

    chapters = await get_course_chapters(
        mock_request,
        course.id,
        db,
        public_user,
        with_unpublished_activities=False,
        slim=True,
        course=course,
    )

    remaining = chapters[0].activities
    assert len(remaining) == 1
    assert remaining[0].activity_uuid == "activity_second"


@pytest.mark.asyncio
async def test_course_kwarg_matches_implicit_lookup(
    db,
    mock_request,
    public_user,
    course,
    chapter,
    heavy_activity,
    second_activity,
    bypass_rbac,
):
    """Passing course= must produce identical output to the fetch-inside path."""
    from_kwarg = await get_course_chapters(
        mock_request,
        course.id,
        db,
        public_user,
        with_unpublished_activities=True,
        slim=True,
        course=course,
    )
    from_lookup = await get_course_chapters(
        mock_request,
        course.id,
        db,
        public_user,
        with_unpublished_activities=True,
        slim=True,
        course=None,
    )

    assert [c.model_dump() for c in from_kwarg] == [
        c.model_dump() for c in from_lookup
    ]


@pytest.mark.asyncio
async def test_slim_returns_empty_tree_when_no_chapters(
    db,
    mock_request,
    public_user,
    course,
    bypass_rbac,
):
    """A course with no chapters yields an empty list (boundary)."""
    chapters = await get_course_chapters(
        mock_request,
        course.id,
        db,
        public_user,
        with_unpublished_activities=True,
        slim=True,
        course=course,
    )
    assert chapters == []


@pytest.mark.asyncio
async def test_non_slim_matches_slim_on_navigation_fields(
    db,
    mock_request,
    public_user,
    course,
    chapter,
    heavy_activity,
    second_activity,
    bypass_rbac,
):
    """Slim and non-slim must agree on every navigation field — only
    content/details should differ."""
    slim_tree = await get_course_chapters(
        mock_request,
        course.id,
        db,
        public_user,
        with_unpublished_activities=True,
        slim=True,
        course=course,
    )
    full_tree = await get_course_chapters(
        mock_request,
        course.id,
        db,
        public_user,
        with_unpublished_activities=True,
        slim=False,
        course=course,
    )

    assert len(slim_tree) == len(full_tree) == 1
    slim_acts = slim_tree[0].activities
    full_acts = full_tree[0].activities
    assert len(slim_acts) == len(full_acts) == 2

    for s, f in zip(slim_acts, full_acts):
        assert s.id == f.id
        assert s.activity_uuid == f.activity_uuid
        assert s.name == f.name
        assert s.activity_type == f.activity_type
        assert s.activity_sub_type == f.activity_sub_type
        assert s.published == f.published
        assert s.org_id == f.org_id
        assert s.course_id == f.course_id
        assert s.current_version == f.current_version
        assert s.last_modified_by_id == f.last_modified_by_id
        # Slim always strips content/details regardless of stored value.
        assert s.content == {}
        assert s.details is None

    # And at least one of the full activities must carry real content/details —
    # otherwise this test would pass vacuously.
    assert any(f.content for f in full_acts)
    assert any(f.details for f in full_acts)
