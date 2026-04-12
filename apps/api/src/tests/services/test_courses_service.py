"""
Tests for src/services/courses/courses.py

Covers: get_course, get_course_by_id, get_courses_orgslug,
        get_courses_count_orgslug, delete_course, search_courses.
"""

from datetime import datetime
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.courses import Course, CourseRead, FullCourseRead
from src.security.rbac import AccessAction, AccessContext
from src.services.courses.courses import (
    delete_course,
    get_course,
    get_course_by_id,
    get_course_meta,
    get_courses_count_orgslug,
    get_courses_orgslug,
    search_courses,
)


def _make_course(db, org, *, id, name="Extra Course", course_uuid=None,
                 public=True, published=True):
    """Helper to insert an additional course for multi-course tests."""
    c = Course(
        id=id,
        name=name,
        description=f"Description for {name}",
        public=public,
        published=published,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid=course_uuid or f"course_{id}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def _make_course_read_payload(**overrides):
    payload = dict(
        id=1,
        name="Cached Course",
        description="Cached course description",
        public=True,
        published=True,
        open_to_contributors=False,
        org_id=1,
        course_uuid="course_cached",
        creation_date="2024-01-01",
        update_date="2024-01-01",
        authors=[],
    )
    payload.update(overrides)
    return payload


class TestGetCourse:
    """Tests for get_course()."""

    @pytest.mark.asyncio
    async def test_get_course_found(
        self, db, org, course, admin_user, mock_request, bypass_rbac
    ):
        result = await get_course(mock_request, "course_test", admin_user, db)

        assert isinstance(result, CourseRead)
        assert result.course_uuid == "course_test"
        assert result.name == "Test Course"
        assert result.authors == []

    @pytest.mark.asyncio
    async def test_get_course_not_found(
        self, db, org, admin_user, mock_request, bypass_rbac
    ):
        with pytest.raises(HTTPException) as exc_info:
            await get_course(mock_request, "nonexistent_uuid", admin_user, db)

        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_get_course_uses_dashboard_context_for_access_check(
        self, db, org, course, admin_user, mock_request
    ):
        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ) as mock_access:
            await get_course(mock_request, "course_test", admin_user, db)

        mock_access.assert_awaited_once_with(
            mock_request,
            db,
            admin_user,
            "course_test",
            AccessAction.READ,
            context=AccessContext.DASHBOARD,
        )


class TestGetCourseMeta:
    """Tests for get_course_meta()."""

    @pytest.mark.asyncio
    async def test_get_course_meta_returns_cached_payload(
        self, db, org, course, admin_user, mock_request
    ):
        cached = FullCourseRead(
            id=course.id,
            name=course.name,
            description=course.description,
            public=course.public,
            published=course.published,
            open_to_contributors=course.open_to_contributors,
            org_id=course.org_id,
            course_uuid=course.course_uuid,
            creation_date=course.creation_date,
            update_date=course.update_date,
            org_uuid=org.org_uuid,
            authors=[],
            chapters=[],
        ).model_dump(mode="json")

        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.cache.get_cached_course_meta",
            return_value=cached,
        ), patch(
            "src.services.courses.chapters.get_course_chapters",
            new_callable=AsyncMock,
        ) as mock_chapters:
            result = await get_course_meta(
                mock_request,
                "course_test",
                False,
                admin_user,
                db,
                slim=True,
            )

        assert isinstance(result, FullCourseRead)
        assert result.course_uuid == "course_test"
        mock_chapters.assert_not_called()

    @pytest.mark.asyncio
    async def test_get_course_meta_passes_prefetched_course_and_caches_result(
        self, db, org, course, admin_user, mock_request
    ):
        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.cache.get_cached_course_meta",
            return_value=None,
        ), patch(
            "src.services.courses.cache.set_cached_course_meta",
        ) as mock_set_cache, patch(
            "src.services.courses.chapters.get_course_chapters",
            new_callable=AsyncMock,
            return_value=[],
        ) as mock_chapters:
            result = await get_course_meta(
                mock_request,
                "course_test",
                False,
                admin_user,
                db,
                slim=True,
            )

        assert result.org_uuid == "org_test"
        mock_chapters.assert_awaited_once()
        call = mock_chapters.await_args
        assert call.args[:5] == (mock_request, course.id, db, admin_user, False)
        assert call.kwargs["slim"] is True
        assert call.kwargs["course"].id == course.id
        mock_set_cache.assert_called_once_with("course_test", True, result.model_dump())


class TestGetCourseById:
    """Tests for get_course_by_id()."""

    @pytest.mark.asyncio
    async def test_get_course_by_id_found(
        self, db, org, course, admin_user, mock_request, bypass_rbac
    ):
        result = await get_course_by_id(mock_request, course.id, admin_user, db)

        assert isinstance(result, CourseRead)
        assert result.id == course.id
        assert result.course_uuid == "course_test"

    @pytest.mark.asyncio
    async def test_get_course_by_id_not_found(
        self, db, org, admin_user, mock_request, bypass_rbac
    ):
        with pytest.raises(HTTPException) as exc_info:
            await get_course_by_id(mock_request, 9999, admin_user, db)

        assert exc_info.value.status_code == 404


class TestGetCoursesOrgslug:
    """Tests for get_courses_orgslug()."""

    @pytest.mark.asyncio
    async def test_get_courses_orgslug_anonymous_uses_cache(
        self, anonymous_user, mock_request
    ):
        cached = [_make_course_read_payload()]

        with patch(
            "src.services.courses.cache.get_cached_courses_list",
            return_value=cached,
        ) as mock_cache:
            result = await get_courses_orgslug(
                mock_request, anonymous_user, "test-org", Mock()
            )

        mock_cache.assert_called_once_with("test-org", 1, 10)
        assert len(result) == 1
        assert result[0].course_uuid == "course_cached"

    @pytest.mark.asyncio
    async def test_get_courses_orgslug_returns_courses(
        self, db, org, course, admin_user, mock_request, bypass_rbac
    ):
        with patch(
            "src.services.courses.courses.is_user_superadmin", return_value=False
        ):
            result = await get_courses_orgslug(
                mock_request, admin_user, "test-org", db
            )

        assert len(result) == 1
        assert result[0].course_uuid == "course_test"

    @pytest.mark.asyncio
    async def test_get_courses_orgslug_empty_org(
        self, db, org, admin_user, mock_request, bypass_rbac
    ):
        result = await get_courses_orgslug(
            mock_request, admin_user, "unknown-org-slug", db
        )

        assert result == []

    @pytest.mark.asyncio
    async def test_get_courses_orgslug_anonymous_only_public_published(
        self, db, org, course, anonymous_user, mock_request, bypass_rbac
    ):
        # Add a private course that anonymous users should NOT see
        _make_course(db, org, id=10, name="Private Course",
                     course_uuid="course_private", public=False, published=True)

        # Add an unpublished course that anonymous users should NOT see
        _make_course(db, org, id=11, name="Unpublished Course",
                     course_uuid="course_unpub", public=True, published=False)

        with patch(
            "src.services.courses.cache.get_cached_courses_list", return_value=None
        ):
            result = await get_courses_orgslug(
                mock_request, anonymous_user, "test-org", db
            )

        # Only the original public+published course should appear
        uuids = [c.course_uuid for c in result]
        assert "course_test" in uuids
        assert "course_private" not in uuids
        assert "course_unpub" not in uuids

    @pytest.mark.asyncio
    async def test_get_courses_orgslug_pagination(
        self, db, org, course, admin_user, mock_request, bypass_rbac
    ):
        _make_course(db, org, id=2, name="Course Two", course_uuid="course_2")
        _make_course(db, org, id=3, name="Course Three", course_uuid="course_3")

        with patch(
            "src.services.courses.courses.is_user_superadmin", return_value=False
        ):
            result = await get_courses_orgslug(
                mock_request, admin_user, "test-org", db, page=1, limit=2
            )

        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_get_courses_orgslug_include_unpublished_for_admin(
        self, db, org, course, admin_user, mock_request, bypass_rbac
    ):
        _make_course(
            db,
            org,
            id=12,
            name="Draft Course",
            course_uuid="course_draft",
            public=False,
            published=False,
        )

        with patch(
            "src.services.courses.courses.is_user_superadmin", return_value=False
        ):
            result = await get_courses_orgslug(
                mock_request,
                admin_user,
                "test-org",
                db,
                include_unpublished=True,
            )

        uuids = [c.course_uuid for c in result]
        assert "course_test" in uuids
        assert "course_draft" in uuids


class TestGetCoursesCountOrgslug:
    """Tests for get_courses_count_orgslug()."""

    @pytest.mark.asyncio
    async def test_get_courses_count_orgslug(
        self, db, org, course, anonymous_user, mock_request
    ):
        count = await get_courses_count_orgslug(
            mock_request, anonymous_user, "test-org", db
        )

        assert count == 1

    @pytest.mark.asyncio
    async def test_get_courses_count_orgslug_excludes_private_for_anon(
        self, db, org, course, anonymous_user, mock_request
    ):
        _make_course(db, org, id=20, name="Private", course_uuid="course_priv",
                     public=False, published=True)

        count = await get_courses_count_orgslug(
            mock_request, anonymous_user, "test-org", db
        )

        # Only the public+published fixture course counts
        assert count == 1


class TestDeleteCourse:
    """Tests for delete_course()."""

    @pytest.mark.asyncio
    async def test_delete_course(
        self, db, org, course, admin_user, mock_request, bypass_rbac, bypass_webhooks
    ):
        with patch(
            "src.services.courses.courses.decrease_feature_usage"
        ), patch(
            "src.services.courses.courses.delete_storage_directory",
            create=True,
        ):
            result = await delete_course(
                mock_request, "course_test", admin_user, db
            )

        assert result == {"detail": "Course deleted"}

        # Verify the course is actually gone from the DB
        remaining = db.get(Course, 1)
        assert remaining is None

    @pytest.mark.asyncio
    async def test_delete_course_not_found(
        self, db, org, admin_user, mock_request, bypass_rbac, bypass_webhooks
    ):
        with pytest.raises(HTTPException) as exc_info:
            await delete_course(mock_request, "nonexistent_uuid", admin_user, db)

        assert exc_info.value.status_code == 404


class TestSearchCourses:
    """Tests for search_courses()."""

    @pytest.mark.asyncio
    async def test_search_courses_finds_by_name(
        self, db, org, course, anonymous_user, mock_request
    ):
        result = await search_courses(
            mock_request, anonymous_user, "test-org", "Test", db
        )

        assert len(result) >= 1
        uuids = [c.course_uuid for c in result]
        assert "course_test" in uuids

    @pytest.mark.asyncio
    async def test_search_courses_no_results(
        self, db, org, course, anonymous_user, mock_request
    ):
        result = await search_courses(
            mock_request, anonymous_user, "test-org", "nonexistent_xyz", db
        )

        assert result == []

    @pytest.mark.asyncio
    async def test_search_courses_anonymous_excludes_private(
        self, db, org, course, anonymous_user, mock_request
    ):
        _make_course(db, org, id=30, name="Secret Stuff",
                     course_uuid="course_secret", public=False, published=True)

        result = await search_courses(
            mock_request, anonymous_user, "test-org", "Secret", db
        )

        uuids = [c.course_uuid for c in result]
        assert "course_secret" not in uuids
