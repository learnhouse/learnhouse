"""
Tests for the Admin API service layer.

Tests the headless admin API functions that operate via API token authentication.
Uses an in-memory SQLite database with real SQLModel tables.
"""

import pytest
from datetime import datetime
from unittest.mock import AsyncMock, patch
from sqlmodel import Session, SQLModel, create_engine, select
from sqlalchemy import event, JSON
from sqlalchemy.pool import StaticPool
from sqlalchemy.dialects.postgresql import JSONB
from fastapi import HTTPException
from starlette.requests import Request

from src.db.users import APITokenUser, User
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.courses.courses import Course
from src.db.courses.certifications import CertificateUser, Certifications
from src.db.courses.chapters import Chapter
from src.db.courses.activities import Activity, ActivityTypeEnum, ActivitySubTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.trails import Trail
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.usergroups import UserGroup
from src.db.usergroup_user import UserGroupUser

from src.services.admin.admin import (
    _require_api_token,
    _resolve_org_slug,
    _get_user_in_org,
    add_usergroup_member,
    award_certificate,
    bulk_enroll_users,
    check_course_access,
    consume_magic_link_token,
    enroll_user,
    get_user_by_email,
    get_user_enrollments,
    get_user_progress,
    issue_magic_link,
    complete_activity,
    uncomplete_activity,
    complete_course,
    get_all_user_progress,
    get_user_certificates,
    issue_user_token,
    list_course_enrollments,
    provision_user,
    remove_usergroup_member,
    remove_user_from_org_admin,
    reset_user_progress,
    revoke_certificate,
    unenroll_user,
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
    yield engine
    engine.dispose()


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
def foreign_activity(db, other_org):
    foreign_course = Course(
        id=200,
        name="Foreign Course",
        description="A foreign course",
        public=True,
        published=True,
        open_to_contributors=False,
        org_id=other_org.id,
        course_uuid="course_foreign200",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(foreign_course)
    db.commit()
    db.refresh(foreign_course)

    foreign_activity = Activity(
        id=200,
        name="Foreign Activity",
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        published=True,
        org_id=other_org.id,
        course_id=foreign_course.id,
        activity_uuid="activity_foreign200",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(foreign_activity)
    db.commit()
    db.refresh(foreign_activity)
    return foreign_activity


@pytest.fixture
def mock_request():
    """Create a minimal mock request for functions that need it."""
    scope = {"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b""}
    return Request(scope)


@pytest.fixture
def second_user(db, org):
    """A second org member, used in bulk-enroll and group-membership tests."""
    u = User(
        id=20,
        username="bob",
        first_name="Bob",
        last_name="User",
        email="bob@example.com",
        password="hashed",
        user_uuid="user_bob20",
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    membership = UserOrganization(
        user_id=u.id, org_id=org.id, role_id=4,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(membership)
    db.commit()
    return u


@pytest.fixture
def org_admin_user(db, org):
    """A user with the admin role in the org — required for last-admin tests."""
    u = User(
        id=30,
        username="orgadmin",
        first_name="Admin",
        last_name="Root",
        email="admin@example.com",
        password="hashed",
        user_uuid="user_admin30",
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    membership = UserOrganization(
        user_id=u.id, org_id=org.id, role_id=1,  # ADMIN_ROLE_ID
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(membership)
    db.commit()
    return u


@pytest.fixture
def certification(db, course):
    """A Certifications row tied to the test course."""
    cert = Certifications(
        id=1,
        certification_uuid="certification_test123",
        course_id=course.id,
        config={},
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(cert)
    db.commit()
    db.refresh(cert)
    return cert


@pytest.fixture
def usergroup(db, org):
    """A user group in the test org."""
    group = UserGroup(
        id=1,
        name="Test Cohort",
        description="Cohort for tests",
        org_id=org.id,
        usergroup_uuid="usergroup_test123",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@pytest.fixture
def other_org_usergroup(db, other_org):
    """A user group in a DIFFERENT org — used for cross-org tests."""
    group = UserGroup(
        id=2,
        name="Other Cohort",
        description="Cohort in a different org",
        org_id=other_org.id,
        usergroup_uuid="usergroup_other456",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@pytest.fixture
def mock_admin_side_effects():
    """Mock side-effect calls (webhooks, analytics, usage, redis cache).

    These external dependencies are not available in the sqlite test environment.
    """
    patches = [
        patch("src.services.admin.admin.dispatch_webhooks", new_callable=AsyncMock),
        patch("src.services.admin.admin.track", new_callable=AsyncMock),
        patch("src.services.admin.admin.check_limits_with_usage", return_value=True),
        patch("src.services.admin.admin.increase_feature_usage", return_value=True),
        patch("src.services.admin.admin.decrease_feature_usage", return_value=True),
    ]
    started = [p.start() for p in patches]
    yield {
        "dispatch_webhooks": started[0],
        "track": started[1],
        "check_limits_with_usage": started[2],
        "increase_feature_usage": started[3],
        "decrease_feature_usage": started[4],
    }
    for p in patches:
        p.stop()


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


# ── Course access tests ─────────────────────────────────────────────────────


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

    @patch("src.services.admin.admin.track", new_callable=AsyncMock)
    async def test_unenrolls_user_and_removes_steps(self, mock_track, token_user, user, course, db, mock_request):
        await enroll_user(mock_request, token_user, user.id, "course_test123", db)
        trail_run = db.exec(
            select(TrailRun).where(
                TrailRun.course_id == course.id,
                TrailRun.user_id == user.id,
                TrailRun.org_id == token_user.org_id,
            )
        ).first()
        assert trail_run is not None

        step = TrailStep(
            trailrun_id=trail_run.id,
            activity_id=999,
            course_id=course.id,
            trail_id=trail_run.trail_id,
            org_id=token_user.org_id,
            complete=True,
            teacher_verified=False,
            grade="",
            user_id=user.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(step)
        db.commit()

        result = await unenroll_user(token_user, user.id, "course_test123", db)
        assert result["detail"] == "User unenrolled successfully"
        assert db.exec(select(TrailStep).where(TrailStep.id == step.id)).first() is None

    async def test_unenroll_not_enrolled(self, token_user, user, course, db):
        with pytest.raises(HTTPException) as exc:
            await unenroll_user(token_user, user.id, "course_test123", db)
        assert exc.value.status_code == 404

    async def test_course_not_found(self, token_user, user, db):
        with pytest.raises(HTTPException) as exc:
            await unenroll_user(token_user, user.id, "missing-course", db)
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

    @patch("src.services.admin.admin.check_course_completion_and_create_certificate", new_callable=AsyncMock, return_value=False)
    @patch("src.services.admin.admin.track", new_callable=AsyncMock)
    async def test_cross_org_blocked(self, mock_track, mock_cert, token_user, user, foreign_activity, db, mock_request):
        with pytest.raises(HTTPException) as exc:
            await complete_activity(mock_request, token_user, user.id, "activity_foreign200", db)
        assert exc.value.status_code == 404


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

    async def test_cross_org_blocked(self, token_user, user, foreign_activity, db, mock_request):
        with pytest.raises(HTTPException) as exc:
            await uncomplete_activity(token_user, user.id, "activity_foreign200", db)
        assert exc.value.status_code == 404


class TestCompleteCourse:

    @patch("src.services.admin.admin.check_course_completion_and_create_certificate", new_callable=AsyncMock, return_value=False)
    @patch("src.services.admin.admin.track", new_callable=AsyncMock)
    async def test_no_activities(self, mock_track, mock_cert, token_user, user, course, db, mock_request):
        result = await complete_course(mock_request, token_user, user.id, "course_test123", db)
        assert result["completed_count"] == 0
        assert result["detail"] == "No activities in course"
        mock_cert.assert_not_awaited()
        mock_track.assert_not_awaited()

    @patch("src.services.admin.admin.check_course_completion_and_create_certificate", new_callable=AsyncMock, return_value=True)
    @patch("src.services.admin.admin.track", new_callable=AsyncMock)
    async def test_completes_course(self, mock_track, mock_cert, token_user, user, course, chapter_activity, db, mock_request):
        result = await complete_course(mock_request, token_user, user.id, "course_test123", db)
        assert result["completed_count"] == 1
        assert result["total_activities"] == 1
        assert result["certificate_awarded"] is True
        mock_cert.assert_awaited_once()
        mock_track.assert_awaited_once()

    async def test_course_not_found(self, token_user, user, db, mock_request):
        with pytest.raises(HTTPException) as exc:
            await complete_course(mock_request, token_user, user.id, "missing-course", db)
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

    async def test_skips_missing_course(self, token_user, user, db):
        trail = Trail(
            org_id=token_user.org_id,
            user_id=user.id,
            trail_uuid="trail_missing_course",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(trail)
        db.commit()
        db.refresh(trail)

        trail_run = TrailRun(
            trail_id=trail.id,
            course_id=999,
            org_id=token_user.org_id,
            user_id=user.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(trail_run)
        db.commit()

        result = await get_all_user_progress(token_user, user.id, db)
        assert result == []


class TestGetUserCertificates:

    async def test_no_certificates(self, token_user, user, db):
        result = await get_user_certificates(token_user, user.id, db)
        assert result == []

    async def test_returns_filtered_certificates(self, token_user, user, other_org, db):
        valid_course = Course(
            id=101,
            name="Valid Course",
            description="A valid course",
            public=True,
            published=True,
            open_to_contributors=False,
            org_id=token_user.org_id,
            course_uuid="course_valid101",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        other_course = Course(
            id=102,
            name="Other Course",
            description="Not in org",
            public=True,
            published=True,
            open_to_contributors=False,
            org_id=other_org.id,
            course_uuid="course_other102",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(valid_course)
        db.add(other_course)
        db.commit()

        valid_cert = Certifications(
            id=201,
            certification_uuid="cert_201",
            course_id=valid_course.id,
            config={"level": "gold"},
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        other_cert = Certifications(
            id=202,
            certification_uuid="cert_202",
            course_id=other_course.id,
            config={"level": "silver"},
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(valid_cert)
        db.add(other_cert)
        db.commit()

        valid_user_cert = CertificateUser(
            id=301,
            user_id=user.id,
            certification_id=valid_cert.id,
            user_certification_uuid="user_cert_301",
            created_at=str(datetime.now()),
            updated_at=str(datetime.now()),
        )
        missing_cert_user = CertificateUser(
            id=302,
            user_id=user.id,
            certification_id=9999,
            user_certification_uuid="user_cert_302",
            created_at=str(datetime.now()),
            updated_at=str(datetime.now()),
        )
        other_org_user_cert = CertificateUser(
            id=303,
            user_id=user.id,
            certification_id=other_cert.id,
            user_certification_uuid="user_cert_303",
            created_at=str(datetime.now()),
            updated_at=str(datetime.now()),
        )
        db.add(valid_user_cert)
        db.add(missing_cert_user)
        db.add(other_org_user_cert)
        db.commit()

        result = await get_user_certificates(token_user, user.id, db)
        assert len(result) == 1
        assert result[0]["certificate_user"]["user_certification_uuid"] == "user_cert_301"
        assert result[0]["certification"]["certification_uuid"] == "cert_201"
        assert result[0]["course"]["course_uuid"] == "course_valid101"


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


# ── Provision user tests ────────────────────────────────────────────────────


class TestProvisionUser:

    async def test_creates_user_and_membership(self, token_user, mock_request, db, mock_admin_side_effects):
        result = await provision_user(
            token_user=token_user,
            email="new@example.com",
            username="newuser",
            first_name="New",
            last_name="User",
            password=None,
            role_id=4,
            request=mock_request,
            db_session=db,
        )
        assert result.email == "new@example.com"
        assert result.email_verified is True

        membership = db.exec(
            select(UserOrganization).where(
                UserOrganization.user_id == result.id,
                UserOrganization.org_id == token_user.org_id,
            )
        ).first()
        assert membership is not None
        assert membership.role_id == 4
        mock_admin_side_effects["check_limits_with_usage"].assert_called_once()
        mock_admin_side_effects["increase_feature_usage"].assert_called_once()

    async def test_duplicate_email_rejected(self, token_user, user, mock_request, db, mock_admin_side_effects):
        with pytest.raises(HTTPException) as exc:
            await provision_user(
                token_user=token_user,
                email=user.email,
                username="different",
                first_name="", last_name="", password=None, role_id=4,
                request=mock_request, db_session=db,
            )
        assert exc.value.status_code == 400

    async def test_duplicate_username_rejected(self, token_user, user, mock_request, db, mock_admin_side_effects):
        with pytest.raises(HTTPException) as exc:
            await provision_user(
                token_user=token_user,
                email="unique@example.com",
                username=user.username,
                first_name="", last_name="", password=None, role_id=4,
                request=mock_request, db_session=db,
            )
        assert exc.value.status_code == 400

    async def test_weak_password_rejected(self, token_user, mock_request, db, mock_admin_side_effects):
        with pytest.raises(HTTPException) as exc:
            await provision_user(
                token_user=token_user,
                email="weak@example.com",
                username="weakuser",
                first_name="", last_name="",
                password="short",
                role_id=4,
                request=mock_request, db_session=db,
            )
        assert exc.value.status_code == 400

    async def test_member_limit_enforced(self, token_user, mock_request, db, mock_admin_side_effects):
        mock_admin_side_effects["check_limits_with_usage"].side_effect = HTTPException(
            status_code=403, detail="Usage Limit has been reached for Members"
        )
        with pytest.raises(HTTPException) as exc:
            await provision_user(
                token_user=token_user,
                email="over@example.com",
                username="overuser",
                first_name="", last_name="", password=None, role_id=4,
                request=mock_request, db_session=db,
            )
        assert exc.value.status_code == 403


# ── Remove user from org tests ──────────────────────────────────────────────


class TestRemoveUserFromOrg:

    async def test_removes_membership(self, token_user, second_user, db, mock_admin_side_effects):
        result = await remove_user_from_org_admin(token_user, second_user.id, db)
        assert result["detail"] == "User removed from org"

        membership = db.exec(
            select(UserOrganization).where(
                UserOrganization.user_id == second_user.id,
                UserOrganization.org_id == token_user.org_id,
            )
        ).first()
        assert membership is None

        still_exists = db.exec(select(User).where(User.id == second_user.id)).first()
        assert still_exists is not None

    async def test_last_admin_blocked(self, org, org_admin_user, db, mock_admin_side_effects):
        admin_token = APITokenUser(
            id=77,
            user_uuid="apitoken_admin",
            username="api_token",
            org_id=org.id,
            token_name="Admin Token",
            created_by_user_id=org_admin_user.id,
        )
        with pytest.raises(HTTPException) as exc:
            await remove_user_from_org_admin(admin_token, org_admin_user.id, db)
        assert exc.value.status_code == 400

    async def test_user_not_in_org(self, token_user, db, mock_admin_side_effects):
        with pytest.raises(HTTPException) as exc:
            await remove_user_from_org_admin(token_user, 9999, db)
        assert exc.value.status_code == 404


# ── Get user by email tests ─────────────────────────────────────────────────


class TestGetUserByEmail:

    async def test_finds_user_in_org(self, token_user, user, db):
        result = await get_user_by_email(token_user, user.email, db)
        assert result.id == user.id
        assert result.email == user.email

    async def test_user_in_other_org_returns_404(self, token_user, other_org, db):
        outsider = User(
            id=50, username="outsider50", first_name="Out", last_name="Sider",
            email="outsider50@example.com", password="hashed", user_uuid="user_out50",
        )
        db.add(outsider)
        db.commit()
        db.add(UserOrganization(
            user_id=outsider.id, org_id=other_org.id, role_id=1,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
        db.commit()

        with pytest.raises(HTTPException) as exc:
            await get_user_by_email(token_user, "outsider50@example.com", db)
        assert exc.value.status_code == 404

    async def test_nonexistent_email_returns_404(self, token_user, db):
        with pytest.raises(HTTPException) as exc:
            await get_user_by_email(token_user, "nobody@example.com", db)
        assert exc.value.status_code == 404


# ── Magic link tests ────────────────────────────────────────────────────────


class TestIssueMagicLink:

    @patch("src.services.admin.admin.create_access_token", return_value="magic_jwt_abc")
    async def test_issues_link(self, mock_create, token_user, user, mock_request, db):
        result = await issue_magic_link(
            token_user=token_user,
            user_id=user.id,
            redirect_to="/course/foo",
            ttl_seconds=300,
            org_slug="test-org",
            request=mock_request,
            db_session=db,
        )
        assert result["token"] == "magic_jwt_abc"
        assert "magic-consume?token=magic_jwt_abc" in result["url"]
        assert "expires_at" in result

        call_kwargs = mock_create.call_args.kwargs
        assert call_kwargs["data"]["purpose"] == "magic_link"
        assert call_kwargs["data"]["redirect_to"] == "/course/foo"

    @patch("src.services.admin.admin.create_access_token", return_value="magic_jwt_clamp")
    async def test_ttl_clamped_low(self, mock_create, token_user, user, mock_request, db):
        await issue_magic_link(
            token_user=token_user, user_id=user.id, redirect_to=None,
            ttl_seconds=10,  # below floor
            org_slug="test-org", request=mock_request, db_session=db,
        )
        expires_delta = mock_create.call_args.kwargs["expires_delta"]
        assert expires_delta.total_seconds() == 60

    @patch("src.services.admin.admin.create_access_token", return_value="magic_jwt_clamp")
    async def test_ttl_clamped_high(self, mock_create, token_user, user, mock_request, db):
        await issue_magic_link(
            token_user=token_user, user_id=user.id, redirect_to=None,
            ttl_seconds=10000,  # above ceiling
            org_slug="test-org", request=mock_request, db_session=db,
        )
        expires_delta = mock_create.call_args.kwargs["expires_delta"]
        assert expires_delta.total_seconds() == 900

    async def test_user_not_in_org(self, token_user, mock_request, db):
        with pytest.raises(HTTPException) as exc:
            await issue_magic_link(
                token_user=token_user, user_id=9999, redirect_to=None,
                ttl_seconds=300, org_slug="test-org",
                request=mock_request, db_session=db,
            )
        assert exc.value.status_code == 404


class TestMagicLinkConsume:

    @patch("src.services.admin.admin.create_refresh_token", return_value="refresh_consumed")
    @patch("src.services.admin.admin.create_access_token", return_value="access_consumed")
    async def test_valid_token(self, mock_access, mock_refresh, token_user, user, db):
        with patch("src.security.auth.decode_jwt") as mock_decode:
            mock_decode.return_value = {
                "sub": user.email,
                "purpose": "magic_link",
                "org_id": token_user.org_id,
                "redirect_to": "/course/bar",
            }
            consumed_user, access, refresh, redirect = await consume_magic_link_token(
                token="fake_token", db_session=db,
            )
        assert consumed_user.id == user.id
        assert access == "access_consumed"
        assert refresh == "refresh_consumed"
        assert redirect == "/course/bar"

    async def test_invalid_token(self, db):
        with patch("src.security.auth.decode_jwt", side_effect=Exception("bad")):
            with pytest.raises(HTTPException) as exc:
                await consume_magic_link_token(token="bogus", db_session=db)
            assert exc.value.status_code == 401

    async def test_wrong_purpose(self, user, db):
        with patch("src.security.auth.decode_jwt") as mock_decode:
            mock_decode.return_value = {"sub": user.email, "purpose": "other"}
            with pytest.raises(HTTPException) as exc:
                await consume_magic_link_token(token="t", db_session=db)
            assert exc.value.status_code == 410

    async def test_user_no_longer_member(self, user, other_org, db):
        with patch("src.security.auth.decode_jwt") as mock_decode:
            mock_decode.return_value = {
                "sub": user.email,
                "purpose": "magic_link",
                "org_id": other_org.id,  # user is not in other_org
                "redirect_to": "",
            }
            with pytest.raises(HTTPException) as exc:
                await consume_magic_link_token(token="t", db_session=db)
            assert exc.value.status_code == 410


# ── Bulk enroll tests ───────────────────────────────────────────────────────


class TestBulkEnroll:

    async def test_enrolls_members(self, token_user, user, second_user, course, mock_request, db, mock_admin_side_effects):
        result = await bulk_enroll_users(
            token_user=token_user,
            course_uuid=course.course_uuid,
            user_ids=[user.id, second_user.id],
            request=mock_request,
            db_session=db,
        )
        assert sorted(result["enrolled"]) == sorted([user.id, second_user.id])
        assert result["already_enrolled"] == []
        assert result["skipped"] == []

        runs = db.exec(
            select(TrailRun).where(TrailRun.course_id == course.id)
        ).all()
        assert len(runs) == 2

    async def test_already_enrolled_filtered(self, token_user, user, course, mock_request, db, mock_admin_side_effects):
        # First enroll
        await bulk_enroll_users(
            token_user=token_user, course_uuid=course.course_uuid,
            user_ids=[user.id], request=mock_request, db_session=db,
        )
        # Second enroll — should be flagged as already_enrolled
        result = await bulk_enroll_users(
            token_user=token_user, course_uuid=course.course_uuid,
            user_ids=[user.id], request=mock_request, db_session=db,
        )
        assert result["enrolled"] == []
        assert result["already_enrolled"] == [user.id]

    async def test_non_member_skipped(self, token_user, course, mock_request, db, mock_admin_side_effects):
        result = await bulk_enroll_users(
            token_user=token_user, course_uuid=course.course_uuid,
            user_ids=[9999], request=mock_request, db_session=db,
        )
        assert result["skipped"] == [9999]
        assert result["enrolled"] == []

    async def test_course_not_found(self, token_user, user, mock_request, db, mock_admin_side_effects):
        with pytest.raises(HTTPException) as exc:
            await bulk_enroll_users(
                token_user=token_user, course_uuid="nope",
                user_ids=[user.id], request=mock_request, db_session=db,
            )
        assert exc.value.status_code == 404

    async def test_mixed_results(self, token_user, user, second_user, course, mock_request, db, mock_admin_side_effects):
        # Pre-enroll user
        await bulk_enroll_users(
            token_user=token_user, course_uuid=course.course_uuid,
            user_ids=[user.id], request=mock_request, db_session=db,
        )
        # Now mixed bulk: user (already), second_user (new), 9999 (skipped)
        result = await bulk_enroll_users(
            token_user=token_user, course_uuid=course.course_uuid,
            user_ids=[user.id, second_user.id, 9999],
            request=mock_request, db_session=db,
        )
        assert result["enrolled"] == [second_user.id]
        assert result["already_enrolled"] == [user.id]
        assert result["skipped"] == [9999]


# ── List course enrollments tests ───────────────────────────────────────────


class TestListCourseEnrollments:

    async def test_returns_enrolled_users(self, token_user, user, second_user, course, mock_request, db, mock_admin_side_effects):
        await bulk_enroll_users(
            token_user=token_user, course_uuid=course.course_uuid,
            user_ids=[user.id, second_user.id],
            request=mock_request, db_session=db,
        )
        result = await list_course_enrollments(token_user, course.course_uuid, db)
        assert len(result) == 2
        user_ids = {row["user"]["id"] for row in result}
        assert user.id in user_ids
        assert second_user.id in user_ids

    async def test_pagination(self, token_user, user, second_user, course, mock_request, db, mock_admin_side_effects):
        await bulk_enroll_users(
            token_user=token_user, course_uuid=course.course_uuid,
            user_ids=[user.id, second_user.id],
            request=mock_request, db_session=db,
        )
        page1 = await list_course_enrollments(token_user, course.course_uuid, db, page=1, limit=1)
        page2 = await list_course_enrollments(token_user, course.course_uuid, db, page=2, limit=1)
        assert len(page1) == 1
        assert len(page2) == 1
        assert page1[0]["user"]["id"] != page2[0]["user"]["id"]

    async def test_empty_course(self, token_user, course, db):
        result = await list_course_enrollments(token_user, course.course_uuid, db)
        assert result == []


# ── Reset progress tests ────────────────────────────────────────────────────


class TestResetUserProgress:

    async def test_deletes_steps(self, token_user, user, course, activity, chapter_activity, mock_request, db, mock_admin_side_effects):
        # Enroll then complete an activity to create a step
        await bulk_enroll_users(
            token_user=token_user, course_uuid=course.course_uuid,
            user_ids=[user.id], request=mock_request, db_session=db,
        )
        trailrun = db.exec(
            select(TrailRun).where(TrailRun.user_id == user.id)
        ).first()
        step = TrailStep(
            trailrun_id=trailrun.id,
            activity_id=activity.id,
            course_id=course.id,
            trail_id=trailrun.trail_id,
            org_id=token_user.org_id,
            complete=True,
            teacher_verified=False,
            grade="",
            user_id=user.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(step)
        db.commit()

        result = await reset_user_progress(token_user, user.id, course.course_uuid, db)
        assert result["steps_deleted"] == 1

        remaining = db.exec(
            select(TrailStep).where(
                TrailStep.user_id == user.id,
                TrailStep.course_id == course.id,
            )
        ).all()
        assert remaining == []

    async def test_no_progress_is_noop(self, token_user, user, course, db):
        result = await reset_user_progress(token_user, user.id, course.course_uuid, db)
        assert result["steps_deleted"] == 0

    async def test_course_not_found(self, token_user, user, db):
        with pytest.raises(HTTPException) as exc:
            await reset_user_progress(token_user, user.id, "missing", db)
        assert exc.value.status_code == 404


# ── Award / revoke certificate tests ────────────────────────────────────────


class TestAwardCertificate:

    @patch("src.services.courses.certifications.dispatch_webhooks", new_callable=AsyncMock)
    @patch("src.services.courses.certifications.track", new_callable=AsyncMock)
    async def test_awards_certificate(self, mock_track, mock_hooks, token_user, user, course, certification, mock_request, db):
        result = await award_certificate(
            token_user=token_user,
            user_id=user.id,
            course_uuid=course.course_uuid,
            request=mock_request,
            db_session=db,
        )
        assert result["user_id"] == user.id
        assert result["course_uuid"] == course.course_uuid
        assert result["user_certification_uuid"]

        cert_row = db.exec(
            select(CertificateUser).where(CertificateUser.user_id == user.id)
        ).first()
        assert cert_row is not None

    async def test_no_certification_configured(self, token_user, user, course, mock_request, db):
        with pytest.raises(HTTPException) as exc:
            await award_certificate(
                token_user=token_user, user_id=user.id,
                course_uuid=course.course_uuid,
                request=mock_request, db_session=db,
            )
        assert exc.value.status_code == 404

    @patch("src.services.courses.certifications.dispatch_webhooks", new_callable=AsyncMock)
    @patch("src.services.courses.certifications.track", new_callable=AsyncMock)
    async def test_duplicate_award_rejected(self, mock_track, mock_hooks, token_user, user, course, certification, mock_request, db):
        await award_certificate(
            token_user=token_user, user_id=user.id,
            course_uuid=course.course_uuid,
            request=mock_request, db_session=db,
        )
        with pytest.raises(HTTPException) as exc:
            await award_certificate(
                token_user=token_user, user_id=user.id,
                course_uuid=course.course_uuid,
                request=mock_request, db_session=db,
            )
        assert exc.value.status_code == 400

    async def test_cross_org_blocked(self, other_org_token, user, course, certification, mock_request, db):
        with pytest.raises(HTTPException) as exc:
            await award_certificate(
                token_user=other_org_token, user_id=user.id,
                course_uuid=course.course_uuid,
                request=mock_request, db_session=db,
            )
        assert exc.value.status_code == 403 or exc.value.status_code == 404


class TestRevokeCertificate:

    @patch("src.services.courses.certifications.dispatch_webhooks", new_callable=AsyncMock)
    @patch("src.services.courses.certifications.track", new_callable=AsyncMock)
    async def test_revokes(self, mock_track, mock_hooks, token_user, user, course, certification, mock_request, db, mock_admin_side_effects):
        awarded = await award_certificate(
            token_user=token_user, user_id=user.id,
            course_uuid=course.course_uuid,
            request=mock_request, db_session=db,
        )
        result = await revoke_certificate(
            token_user=token_user, user_id=user.id,
            user_certification_uuid=awarded["user_certification_uuid"],
            db_session=db,
        )
        assert result["detail"] == "Certificate revoked"

        remaining = db.exec(
            select(CertificateUser).where(
                CertificateUser.user_certification_uuid == awarded["user_certification_uuid"]
            )
        ).first()
        assert remaining is None

    async def test_not_found(self, token_user, user, db, mock_admin_side_effects):
        with pytest.raises(HTTPException) as exc:
            await revoke_certificate(
                token_user=token_user, user_id=user.id,
                user_certification_uuid="missing", db_session=db,
            )
        assert exc.value.status_code == 404


# ── User group membership tests ─────────────────────────────────────────────


class TestUserGroupMembers:

    async def test_add_member(self, token_user, user, usergroup, db, mock_admin_side_effects):
        result = await add_usergroup_member(
            token_user, usergroup.usergroup_uuid, user.id, db
        )
        assert result["detail"] == "User added to group"

        row = db.exec(
            select(UserGroupUser).where(
                UserGroupUser.usergroup_id == usergroup.id,
                UserGroupUser.user_id == user.id,
            )
        ).first()
        assert row is not None

    async def test_add_duplicate_rejected(self, token_user, user, usergroup, db, mock_admin_side_effects):
        await add_usergroup_member(token_user, usergroup.usergroup_uuid, user.id, db)
        with pytest.raises(HTTPException) as exc:
            await add_usergroup_member(token_user, usergroup.usergroup_uuid, user.id, db)
        assert exc.value.status_code == 400

    async def test_remove_member(self, token_user, user, usergroup, db, mock_admin_side_effects):
        await add_usergroup_member(token_user, usergroup.usergroup_uuid, user.id, db)
        result = await remove_usergroup_member(
            token_user, usergroup.usergroup_uuid, user.id, db
        )
        assert result["detail"] == "User removed from group"

        row = db.exec(
            select(UserGroupUser).where(
                UserGroupUser.usergroup_id == usergroup.id,
                UserGroupUser.user_id == user.id,
            )
        ).first()
        assert row is None

    async def test_remove_non_member(self, token_user, user, usergroup, db, mock_admin_side_effects):
        with pytest.raises(HTTPException) as exc:
            await remove_usergroup_member(
                token_user, usergroup.usergroup_uuid, user.id, db
            )
        assert exc.value.status_code == 404

    async def test_cross_org_group_blocked(self, token_user, user, other_org_usergroup, db, mock_admin_side_effects):
        with pytest.raises(HTTPException) as exc:
            await add_usergroup_member(
                token_user, other_org_usergroup.usergroup_uuid, user.id, db
            )
        assert exc.value.status_code == 404
