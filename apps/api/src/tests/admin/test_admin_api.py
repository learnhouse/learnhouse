"""
Tests for the Admin API service layer.

Tests the headless admin API functions that operate via API token authentication.
Uses an in-memory SQLite database with real SQLModel tables.
"""

import pytest
from datetime import datetime
from unittest.mock import AsyncMock, patch
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy import event, JSON
from sqlalchemy.pool import StaticPool
from sqlalchemy.dialects.postgresql import JSONB
from fastapi import HTTPException
from starlette.requests import Request

from src.db.users import APITokenUser, User, UserRead
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.courses.courses import Course
from src.db.courses.chapters import Chapter
from src.db.courses.activities import Activity, ActivityTypeEnum, ActivitySubTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.collections import Collection
from src.db.collections_courses import CollectionCourse
from src.db.trails import Trail
from src.db.trail_runs import TrailRun

from src.services.admin.admin import (
    _require_api_token,
    _resolve_org_slug,
    _get_user_in_org,
    get_user,
    list_users,
    get_user_courses,
    list_courses,
    get_course,
    check_course_access,
    list_collections,
    get_collection,
    get_chapter,
    get_activity,
    get_chapter_activities,
    enroll_user,
    unenroll_user,
    get_user_enrollments,
    get_user_progress,
    complete_activity,
    uncomplete_activity,
    get_all_user_progress,
    issue_user_token,
)


# ── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # Map JSONB -> JSON for SQLite compatibility
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        pass  # placeholder for future pragmas

    # Replace JSONB columns with JSON before creating tables
    for table in SQLModel.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, JSONB):
                col.type = JSON()

    SQLModel.metadata.create_all(engine)
    return engine


@pytest.fixture
def db(engine):
    with Session(engine) as session:
        yield session


@pytest.fixture
def org(db):
    org = Organization(
        id=1,
        name="Test Org",
        slug="test-org",
        email="test@org.com",
        org_uuid="org_test123",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


@pytest.fixture
def other_org(db):
    org = Organization(
        id=2,
        name="Other Org",
        slug="other-org",
        email="other@org.com",
        org_uuid="org_other456",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


@pytest.fixture
def user(db, org):
    u = User(
        id=1,
        username="testuser",
        first_name="Test",
        last_name="User",
        email="test@example.com",
        password="hashed",
        user_uuid="user_test123",
    )
    db.add(u)
    db.commit()
    db.refresh(u)

    membership = UserOrganization(
        user_id=u.id, org_id=org.id, role_id=1,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(membership)
    db.commit()
    return u


@pytest.fixture
def second_user(db, org):
    u = User(
        id=2,
        username="seconduser",
        first_name="Second",
        last_name="User",
        email="second@example.com",
        password="hashed",
        user_uuid="user_second456",
    )
    db.add(u)
    db.commit()
    db.refresh(u)

    membership = UserOrganization(
        user_id=u.id, org_id=org.id, role_id=1,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(membership)
    db.commit()
    return u


@pytest.fixture
def token_user(org, user):
    return APITokenUser(
        id=1,
        user_uuid="apitoken_test123",
        username="api_token",
        org_id=org.id,
        token_name="Test Token",
        created_by_user_id=user.id,
    )


@pytest.fixture
def other_org_token(other_org):
    return APITokenUser(
        id=2,
        user_uuid="apitoken_other456",
        username="api_token",
        org_id=other_org.id,
        token_name="Other Org Token",
        created_by_user_id=99,
    )


@pytest.fixture
def course(db, org):
    c = Course(
        id=1,
        name="Test Course",
        description="A test course",
        public=True,
        published=True,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid="course_test123",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@pytest.fixture
def unpublished_course(db, org):
    c = Course(
        id=2,
        name="Unpublished Course",
        description="Not published",
        public=False,
        published=False,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid="course_unpub456",
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
        name="Test Chapter",
        description="A chapter",
        org_id=org.id,
        course_id=course.id,
        chapter_uuid="chapter_test123",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return ch


@pytest.fixture
def activity(db, org, course):
    a = Activity(
        id=1,
        name="Test Activity",
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid="activity_test123",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


@pytest.fixture
def second_activity(db, org, course):
    a = Activity(
        id=2,
        name="Second Activity",
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE,
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid="activity_second456",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


@pytest.fixture
def chapter_activity(db, org, course, chapter, activity):
    ca = ChapterActivity(
        id=1,
        order=1,
        chapter_id=chapter.id,
        activity_id=activity.id,
        course_id=course.id,
        org_id=org.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(ca)
    db.commit()
    db.refresh(ca)
    return ca


@pytest.fixture
def second_chapter_activity(db, org, course, chapter, second_activity):
    ca = ChapterActivity(
        id=2,
        order=2,
        chapter_id=chapter.id,
        activity_id=second_activity.id,
        course_id=course.id,
        org_id=org.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(ca)
    db.commit()
    db.refresh(ca)
    return ca


@pytest.fixture
def collection(db, org):
    col = Collection(
        id=1,
        name="Test Collection",
        public=True,
        description="A collection",
        org_id=org.id,
        collection_uuid="collection_test123",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(col)
    db.commit()
    db.refresh(col)
    return col


@pytest.fixture
def collection_course(db, org, collection, course):
    cc = CollectionCourse(
        id=1,
        collection_id=collection.id,
        course_id=course.id,
        org_id=org.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(cc)
    db.commit()
    db.refresh(cc)
    return cc


@pytest.fixture
def mock_request():
    """Create a minimal mock request for functions that need it."""
    scope = {"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b""}
    return Request(scope)


# ── Helper: patch plan check ────────────────────────────────────────────────

def _patch_plan():
    """Patch plan check to always allow (returns 'pro')."""
    return patch(
        "src.services.admin.admin.get_org_plan",
        return_value="pro",
    )


def _patch_plan_and_meets():
    """Patch both plan functions for _resolve_org_slug."""
    return [
        patch("src.services.admin.admin.get_org_plan", return_value="pro"),
        patch("src.services.admin.admin.plan_meets_requirement", return_value=True),
    ]


# ── Auth / Guard tests ─────────────────────────────────────────────────────


class TestRequireApiToken:

    def test_accepts_api_token_user(self, token_user):
        result = _require_api_token(token_user)
        assert isinstance(result, APITokenUser)
        assert result.org_id == token_user.org_id

    def test_rejects_regular_user(self):
        from src.db.users import PublicUser
        regular = PublicUser(
            id=1, email="a@b.com", username="x",
            first_name="A", last_name="B", user_uuid="u1",
        )
        with pytest.raises(HTTPException) as exc:
            _require_api_token(regular)
        assert exc.value.status_code == 403

    def test_rejects_anonymous_user(self):
        from src.db.users import AnonymousUser
        with pytest.raises(HTTPException) as exc:
            _require_api_token(AnonymousUser())
        assert exc.value.status_code == 403


class TestResolveOrgSlug:

    def test_resolves_matching_org(self, token_user, org, db):
        with _patch_plan(), patch("src.services.admin.admin.plan_meets_requirement", return_value=True):
            result = _resolve_org_slug("test-org", token_user, db)
        assert result.id == org.id

    def test_rejects_unknown_slug(self, token_user, db):
        with pytest.raises(HTTPException) as exc:
            _resolve_org_slug("nonexistent", token_user, db)
        assert exc.value.status_code == 404

    def test_rejects_mismatched_org(self, other_org_token, org, db):
        with _patch_plan(), patch("src.services.admin.admin.plan_meets_requirement", return_value=True):
            with pytest.raises(HTTPException) as exc:
                _resolve_org_slug("test-org", other_org_token, db)
            assert exc.value.status_code == 403

    def test_rejects_insufficient_plan(self, token_user, org, db):
        with patch("src.services.admin.admin.get_org_plan", return_value="free"), \
             patch("src.services.admin.admin.plan_meets_requirement", return_value=False):
            with pytest.raises(HTTPException) as exc:
                _resolve_org_slug("test-org", token_user, db)
            assert exc.value.status_code == 403
            assert "Pro plan" in exc.value.detail


class TestGetUserInOrg:

    def test_returns_user_in_org(self, user, org, db):
        result = _get_user_in_org(user.id, org.id, db)
        assert result.id == user.id

    def test_rejects_nonexistent_user(self, org, db):
        with pytest.raises(HTTPException) as exc:
            _get_user_in_org(9999, org.id, db)
        assert exc.value.status_code == 404

    def test_rejects_user_not_in_org(self, user, other_org, db):
        with pytest.raises(HTTPException) as exc:
            _get_user_in_org(user.id, other_org.id, db)
        assert exc.value.status_code == 403


# ── User endpoint tests ────────────────────────────────────────────────────


class TestGetUser:

    async def test_returns_user(self, token_user, user, db):
        result = await get_user(token_user, user.id, db)
        assert isinstance(result, UserRead)
        assert result.username == "testuser"

    async def test_not_found(self, token_user, db):
        with pytest.raises(HTTPException) as exc:
            await get_user(token_user, 9999, db)
        assert exc.value.status_code == 404


class TestListUsers:

    async def test_lists_org_users(self, token_user, user, second_user, db):
        result = await list_users(token_user, db)
        assert len(result) == 2
        usernames = {u.username for u in result}
        assert "testuser" in usernames
        assert "seconduser" in usernames

    async def test_pagination(self, token_user, user, second_user, db):
        page1 = await list_users(token_user, db, page=1, limit=1)
        page2 = await list_users(token_user, db, page=2, limit=1)
        assert len(page1) == 1
        assert len(page2) == 1
        assert page1[0].id != page2[0].id

    async def test_empty_org(self, other_org_token, db, other_org):
        result = await list_users(other_org_token, db)
        assert result == []


class TestGetUserCourses:

    async def test_returns_enrolled_courses(self, token_user, user, course, db):
        # Create enrollment
        trail = Trail(
            org_id=token_user.org_id, user_id=user.id,
            trail_uuid="trail_1",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(trail)
        db.commit()
        db.refresh(trail)
        tr = TrailRun(
            trail_id=trail.id, course_id=course.id,
            org_id=token_user.org_id, user_id=user.id,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(tr)
        db.commit()

        result = await get_user_courses(token_user, user.id, db)
        assert len(result) == 1
        assert result[0].course_uuid == "course_test123"

    async def test_no_enrollments(self, token_user, user, db):
        result = await get_user_courses(token_user, user.id, db)
        assert result == []


# ── Course endpoint tests ───────────────────────────────────────────────────


class TestListCourses:

    async def test_lists_published_courses(self, token_user, course, unpublished_course, db, mock_request):
        result = await list_courses(mock_request, token_user, db)
        assert len(result) == 1
        assert result[0].name == "Test Course"

    async def test_includes_unpublished(self, token_user, course, unpublished_course, db, mock_request):
        result = await list_courses(mock_request, token_user, db, published_only=False)
        assert len(result) == 2

    async def test_pagination(self, token_user, course, unpublished_course, db, mock_request):
        result = await list_courses(mock_request, token_user, db, published_only=False, page=1, limit=1)
        assert len(result) == 1


class TestGetCourse:

    async def test_returns_course(self, token_user, course, db, mock_request):
        result = await get_course(mock_request, token_user, "course_test123", db)
        assert result.name == "Test Course"

    async def test_not_found(self, token_user, db, mock_request):
        with pytest.raises(HTTPException) as exc:
            await get_course(mock_request, token_user, "nonexistent", db)
        assert exc.value.status_code == 404

    async def test_cross_org_blocked(self, other_org_token, course, db, mock_request):
        with pytest.raises(HTTPException) as exc:
            await get_course(mock_request, other_org_token, "course_test123", db)
        assert exc.value.status_code == 404


class TestCheckCourseAccess:

    async def test_public_course_accessible(self, token_user, user, course, db):
        result = await check_course_access(token_user, "course_test123", user.id, db)
        assert result["has_access"] is True
        assert result["is_public"] is True
        assert result["is_enrolled"] is False

    async def test_enrolled_user(self, token_user, user, course, db):
        trail = Trail(
            org_id=token_user.org_id, user_id=user.id,
            trail_uuid="trail_acc",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(trail)
        db.commit()
        db.refresh(trail)
        tr = TrailRun(
            trail_id=trail.id, course_id=course.id,
            org_id=token_user.org_id, user_id=user.id,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(tr)
        db.commit()

        result = await check_course_access(token_user, "course_test123", user.id, db)
        assert result["has_access"] is True
        assert result["is_enrolled"] is True

    async def test_private_unenrolled(self, token_user, user, unpublished_course, db):
        result = await check_course_access(token_user, "course_unpub456", user.id, db)
        assert result["has_access"] is False
        assert result["is_enrolled"] is False

    async def test_course_not_found(self, token_user, user, db):
        with pytest.raises(HTTPException) as exc:
            await check_course_access(token_user, "nonexistent", user.id, db)
        assert exc.value.status_code == 404


# ── Collection endpoint tests ──────────────────────────────────────────────


class TestListCollections:

    async def test_lists_collections(self, token_user, collection, collection_course, course, db):
        result = await list_collections(token_user, db)
        assert len(result) == 1
        assert result[0]["name"] == "Test Collection"
        assert len(result[0]["courses"]) == 1

    async def test_empty(self, other_org_token, db, other_org):
        result = await list_collections(other_org_token, db)
        assert result == []


class TestGetCollection:

    async def test_returns_collection(self, token_user, collection, collection_course, course, db):
        result = await get_collection(token_user, "collection_test123", db)
        assert result["name"] == "Test Collection"
        assert len(result["courses"]) == 1

    async def test_not_found(self, token_user, db):
        with pytest.raises(HTTPException) as exc:
            await get_collection(token_user, "nonexistent", db)
        assert exc.value.status_code == 404

    async def test_cross_org_blocked(self, other_org_token, collection, db):
        with pytest.raises(HTTPException) as exc:
            await get_collection(other_org_token, "collection_test123", db)
        assert exc.value.status_code == 404


# ── Content endpoint tests ─────────────────────────────────────────────────


class TestGetChapter:

    async def test_returns_chapter(self, token_user, chapter, activity, chapter_activity, db):
        result = await get_chapter(token_user, chapter.id, db)
        assert result["name"] == "Test Chapter"
        assert len(result["activities"]) == 1

    async def test_not_found(self, token_user, db):
        with pytest.raises(HTTPException) as exc:
            await get_chapter(token_user, 9999, db)
        assert exc.value.status_code == 404

    async def test_cross_org_blocked(self, other_org_token, chapter, course, db):
        with pytest.raises(HTTPException) as exc:
            await get_chapter(other_org_token, chapter.id, db)
        assert exc.value.status_code == 404


class TestGetActivity:

    async def test_returns_activity(self, token_user, activity, course, db):
        result = await get_activity(token_user, "activity_test123", db)
        assert result["name"] == "Test Activity"

    async def test_not_found(self, token_user, db):
        with pytest.raises(HTTPException) as exc:
            await get_activity(token_user, "nonexistent", db)
        assert exc.value.status_code == 404

    async def test_cross_org_blocked(self, other_org_token, activity, course, db):
        with pytest.raises(HTTPException) as exc:
            await get_activity(other_org_token, "activity_test123", db)
        assert exc.value.status_code == 404


class TestGetChapterActivities:

    async def test_returns_activities(self, token_user, chapter, activity, second_activity, chapter_activity, second_chapter_activity, db):
        result = await get_chapter_activities(token_user, chapter.id, db)
        assert len(result) == 2

    async def test_chapter_not_found(self, token_user, db):
        with pytest.raises(HTTPException) as exc:
            await get_chapter_activities(token_user, 9999, db)
        assert exc.value.status_code == 404


# ── Enrollment endpoint tests ──────────────────────────────────────────────


class TestEnrollUser:

    @patch("src.services.admin.admin.track", new_callable=AsyncMock)
    async def test_enrolls_user(self, mock_track, token_user, user, course, db, mock_request):
        result = await enroll_user(mock_request, token_user, user.id, "course_test123", db)
        assert result is not None
        mock_track.assert_called_once()

    @patch("src.services.admin.admin.track", new_callable=AsyncMock)
    async def test_duplicate_enrollment(self, mock_track, token_user, user, course, db, mock_request):
        await enroll_user(mock_request, token_user, user.id, "course_test123", db)
        with pytest.raises(HTTPException) as exc:
            await enroll_user(mock_request, token_user, user.id, "course_test123", db)
        assert exc.value.status_code == 400

    @patch("src.services.admin.admin.track", new_callable=AsyncMock)
    async def test_enroll_course_not_found(self, mock_track, token_user, user, db, mock_request):
        with pytest.raises(HTTPException) as exc:
            await enroll_user(mock_request, token_user, user.id, "nonexistent", db)
        assert exc.value.status_code == 404


class TestUnenrollUser:

    @patch("src.services.admin.admin.track", new_callable=AsyncMock)
    async def test_unenrolls_user(self, mock_track, token_user, user, course, db, mock_request):
        await enroll_user(mock_request, token_user, user.id, "course_test123", db)
        result = await unenroll_user(token_user, user.id, "course_test123", db)
        assert result["detail"] == "User unenrolled successfully"

    async def test_unenroll_not_enrolled(self, token_user, user, course, db):
        with pytest.raises(HTTPException) as exc:
            await unenroll_user(token_user, user.id, "course_test123", db)
        assert exc.value.status_code == 404


class TestGetUserEnrollments:

    async def test_no_enrollments(self, token_user, user, db):
        result = await get_user_enrollments(token_user, user.id, db)
        assert result.runs == []

    @patch("src.services.admin.admin.track", new_callable=AsyncMock)
    async def test_with_enrollments(self, mock_track, token_user, user, course, db, mock_request):
        await enroll_user(mock_request, token_user, user.id, "course_test123", db)
        result = await get_user_enrollments(token_user, user.id, db)
        assert len(result.runs) == 1


# ── Progress endpoint tests ────────────────────────────────────────────────


class TestGetUserProgress:

    async def test_zero_progress(self, token_user, user, course, chapter_activity, db):
        result = await get_user_progress(token_user, user.id, "course_test123", db)
        assert result["total_activities"] == 1
        assert result["completed_activities"] == 0
        assert result["completion_percentage"] == 0

    async def test_course_not_found(self, token_user, user, db):
        with pytest.raises(HTTPException) as exc:
            await get_user_progress(token_user, user.id, "nonexistent", db)
        assert exc.value.status_code == 404


class TestCompleteActivity:

    @patch("src.services.admin.admin.check_course_completion_and_create_certificate", new_callable=AsyncMock, return_value=False)
    @patch("src.services.admin.admin.track", new_callable=AsyncMock)
    async def test_completes_activity(self, mock_track, mock_cert, token_user, user, activity, course, db, mock_request):
        result = await complete_activity(mock_request, token_user, user.id, "activity_test123", db)
        assert result["completed"] is True
        assert result["is_new_completion"] is True
        assert result["course_completed"] is False

    @patch("src.services.admin.admin.check_course_completion_and_create_certificate", new_callable=AsyncMock, return_value=False)
    @patch("src.services.admin.admin.track", new_callable=AsyncMock)
    async def test_idempotent_completion(self, mock_track, mock_cert, token_user, user, activity, course, db, mock_request):
        await complete_activity(mock_request, token_user, user.id, "activity_test123", db)
        result = await complete_activity(mock_request, token_user, user.id, "activity_test123", db)
        assert result["is_new_completion"] is False

    @patch("src.services.admin.admin.check_course_completion_and_create_certificate", new_callable=AsyncMock, return_value=False)
    @patch("src.services.admin.admin.track", new_callable=AsyncMock)
    async def test_activity_not_found(self, mock_track, mock_cert, token_user, user, db, mock_request):
        with pytest.raises(HTTPException) as exc:
            await complete_activity(mock_request, token_user, user.id, "nonexistent", db)
        assert exc.value.status_code == 404

    @patch("src.services.admin.admin.check_course_completion_and_create_certificate", new_callable=AsyncMock, return_value=True)
    @patch("src.services.admin.admin.track", new_callable=AsyncMock)
    async def test_course_completion_triggered(self, mock_track, mock_cert, token_user, user, activity, course, db, mock_request):
        result = await complete_activity(mock_request, token_user, user.id, "activity_test123", db)
        assert result["course_completed"] is True


class TestUncompleteActivity:

    @patch("src.services.admin.admin.check_course_completion_and_create_certificate", new_callable=AsyncMock, return_value=False)
    @patch("src.services.admin.admin.track", new_callable=AsyncMock)
    async def test_uncompletes_activity(self, mock_track, mock_cert, token_user, user, activity, course, db, mock_request):
        await complete_activity(mock_request, token_user, user.id, "activity_test123", db)
        result = await uncomplete_activity(token_user, user.id, "activity_test123", db)
        assert result["completed"] is False

    async def test_uncomplete_not_completed(self, token_user, user, activity, course, db):
        # Should succeed silently even if not completed
        result = await uncomplete_activity(token_user, user.id, "activity_test123", db)
        assert result["completed"] is False

    async def test_activity_not_found(self, token_user, user, db):
        with pytest.raises(HTTPException) as exc:
            await uncomplete_activity(token_user, user.id, "nonexistent", db)
        assert exc.value.status_code == 404


class TestGetAllUserProgress:

    async def test_no_enrollments(self, token_user, user, db):
        result = await get_all_user_progress(token_user, user.id, db)
        assert result == []

    @patch("src.services.admin.admin.track", new_callable=AsyncMock)
    async def test_with_enrollment(self, mock_track, token_user, user, course, chapter_activity, db, mock_request):
        await enroll_user(mock_request, token_user, user.id, "course_test123", db)
        result = await get_all_user_progress(token_user, user.id, db)
        assert len(result) == 1
        assert result[0]["course_uuid"] == "course_test123"
        assert result[0]["total_activities"] == 1
        assert result[0]["completed_activities"] == 0


# ── Auth token endpoint tests ──────────────────────────────────────────────


class TestIssueUserToken:

    @patch("src.services.admin.admin.create_access_token", return_value="jwt_test_token")
    async def test_issues_token(self, mock_create, token_user, user, db):
        result = await issue_user_token(token_user, user.id, db)
        assert result["access_token"] == "jwt_test_token"
        assert result["token_type"] == "bearer"
        assert result["user_id"] == user.id
        assert result["user_uuid"] == user.user_uuid

    async def test_user_not_found(self, token_user, db):
        with pytest.raises(HTTPException) as exc:
            await issue_user_token(token_user, 9999, db)
        assert exc.value.status_code == 404

    async def test_user_not_in_org(self, token_user, other_org, db):
        # Create user only in other_org
        u = User(
            id=99,
            username="outsider",
            first_name="Out",
            last_name="Sider",
            email="out@example.com",
            password="hashed",
            user_uuid="user_out99",
        )
        db.add(u)
        db.commit()
        membership = UserOrganization(
            user_id=u.id, org_id=other_org.id, role_id=1,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(membership)
        db.commit()

        with pytest.raises(HTTPException) as exc:
            await issue_user_token(token_user, u.id, db)
        assert exc.value.status_code == 403
