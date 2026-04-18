"""
Tests for src/services/courses/courses.py

Covers: get_course, get_course_by_id, get_courses_orgslug,
        get_courses_count_orgslug, delete_course, search_courses.
"""

from datetime import datetime
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.courses import (
    Course,
    CourseCreate,
    CourseRead,
    CourseUpdate,
    FullCourseRead,
    ThumbnailType,
)
from src.db.courses.activities import Activity, ActivityTypeEnum, ActivitySubTypeEnum
from src.db.courses.blocks import Block, BlockTypeEnum
from src.db.courses.chapters import Chapter
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.course_chapters import CourseChapter
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.users import APITokenUser
from src.security.rbac import AccessAction, AccessContext
from src.services.courses.courses import (
    clone_course,
    create_course,
    delete_course,
    get_course,
    get_course_by_id,
    get_course_meta,
    get_course_user_rights,
    get_courses_count_orgslug,
    get_courses_orgslug,
    get_user_courses,
    search_courses,
    update_course,
    update_course_thumbnail,
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

    @pytest.mark.asyncio
    async def test_get_course_meta_skips_chapters_when_course_id_missing(
        self, org, mock_request, admin_user
    ):
        course = Course(
            id=None,
            name="Detached Course",
            description="Detached course description",
            public=True,
            published=False,
            open_to_contributors=False,
            org_id=org.id,
            course_uuid="course_detached",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        fake_rows = [(course, None, None, org)]
        fake_exec = Mock(all=Mock(return_value=fake_rows))
        fake_db = Mock(exec=Mock(return_value=fake_exec))

        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.courses.FullCourseRead",
            side_effect=lambda **kwargs: kwargs,
        ), patch(
            "src.services.courses.chapters.get_course_chapters",
            new_callable=AsyncMock,
        ) as mock_chapters:
            result = await get_course_meta(
                mock_request,
                "course_detached",
                True,
                admin_user,
                fake_db,
            )

        assert result["course_uuid"] == "course_detached"
        mock_chapters.assert_not_called()

    @pytest.mark.asyncio
    async def test_get_course_meta_not_found_raises(self, mock_request, admin_user):
        fake_db = Mock(exec=Mock(return_value=Mock(all=Mock(return_value=[]))))

        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await get_course_meta(
                    mock_request,
                    "missing-course",
                    False,
                    admin_user,
                    fake_db,
                )

        assert exc_info.value.status_code == 404


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
    async def test_get_courses_orgslug_existing_org_without_courses(
        self, db, other_org, admin_user, mock_request
    ):
        with patch(
            "src.services.courses.courses.is_user_superadmin", return_value=False
        ):
            result = await get_courses_orgslug(
                mock_request, admin_user, other_org.slug, db
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

    @pytest.mark.asyncio
    async def test_get_courses_orgslug_include_unpublished_for_superadmin(
        self, db, org, course, admin_user, mock_request, bypass_rbac
    ):
        _make_course(
            db,
            org,
            id=13,
            name="Superadmin Draft",
            course_uuid="course_superadmin_draft",
            public=False,
            published=False,
        )

        with patch(
            "src.services.courses.courses.is_user_superadmin", return_value=True
        ):
            result = await get_courses_orgslug(
                mock_request,
                admin_user,
                "test-org",
                db,
                include_unpublished=True,
            )

        uuids = [c.course_uuid for c in result]
        assert "course_superadmin_draft" in uuids

    @pytest.mark.asyncio
    async def test_get_courses_orgslug_groups_multiple_authors(
        self, db, org, course, regular_user, admin_user, mock_request, bypass_rbac
    ):
        db.add(
            ResourceAuthor(
                resource_uuid=course.course_uuid,
                user_id=admin_user.id,
                authorship=ResourceAuthorshipEnum.CREATOR,
                authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.add(
            ResourceAuthor(
                resource_uuid=course.course_uuid,
                user_id=regular_user.id,
                authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
                authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        with patch(
            "src.services.courses.courses.is_user_superadmin", return_value=False
        ):
            result = await get_courses_orgslug(
                mock_request, admin_user, "test-org", db
            )

        assert len(result) == 1
        assert len(result[0].authors) >= 2


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

    @pytest.mark.asyncio
    async def test_get_courses_count_orgslug_superadmin_counts_all(
        self, db, org, course, admin_user, mock_request, bypass_rbac
    ):
        _make_course(db, org, id=21, name="Hidden", course_uuid="course_hidden", public=False, published=False)

        with patch(
            "src.services.courses.courses.is_user_superadmin", return_value=True
        ):
            count = await get_courses_count_orgslug(
                mock_request, admin_user, "test-org", db
            )

        assert count == 2

    @pytest.mark.asyncio
    async def test_get_courses_count_orgslug_authenticated_user_branch(
        self, db, org, course, regular_user, mock_request
    ):
        count = await get_courses_count_orgslug(
            mock_request, regular_user, "test-org", db
        )

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


class TestCourseMutationsAndRights:
    @pytest.mark.asyncio
    async def test_create_course_without_thumbnail_uses_defaults(
        self, db, org, admin_user, mock_request, bypass_webhooks
    ):
        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.courses.check_limits_with_usage"
        ), patch(
            "src.services.courses.courses.increase_feature_usage"
        ), patch(
            "src.services.courses.courses.upload_thumbnail",
            new_callable=AsyncMock,
        ) as mock_upload, patch(
            "src.services.courses.courses.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            created = await create_course(
                mock_request,
                org.id,
                CourseCreate(
                    org_id=org.id,
                    name="Default Course",
                    description="Default desc",
                    public=False,
                    published=False,
                    open_to_contributors=False,
                ),
                admin_user,
                db,
            )

        assert created.thumbnail_image == ""
        assert created.thumbnail_video == ""
        assert created.thumbnail_type == ThumbnailType.IMAGE
        mock_upload.assert_not_called()

    @pytest.mark.asyncio
    async def test_create_course_and_get_user_courses(
        self, db, org, admin_user, regular_user, mock_request, bypass_webhooks
    ):
        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.courses.check_limits_with_usage"
        ), patch(
            "src.services.courses.courses.increase_feature_usage"
        ), patch(
            "src.services.courses.courses.upload_thumbnail",
            new_callable=AsyncMock,
            return_value="thumb.png",
        ):
            created = await create_course(
                mock_request,
                org.id,
                CourseCreate(
                    org_id=org.id,
                    name="Created Course",
                    description="Desc",
                    public=True,
                    published=False,
                    open_to_contributors=False,
                ),
                admin_user,
                db,
                thumbnail_file=Mock(filename="thumb.png"),
                thumbnail_type=ThumbnailType.IMAGE,
            )

        user_courses = await get_user_courses(
            mock_request, regular_user, admin_user.id, db
        )

        assert created.name == "Created Course"
        assert created.thumbnail_image == "thumb.png"
        assert created.authors[0].user.id == admin_user.id
        assert user_courses[0].course_uuid == created.course_uuid

    @pytest.mark.asyncio
    async def test_create_course_and_get_user_courses_empty_after_lookup(
        self, db, org, admin_user, mock_request, bypass_webhooks
    ):
        db.add(
            ResourceAuthor(
                resource_uuid="course_missing_lookup",
                user_id=999,
                authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
                authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        with patch(
            "src.services.courses.courses.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ):
            result = await get_user_courses(
                mock_request, admin_user, 999, db
            )

        assert result == []

    @pytest.mark.asyncio
    async def test_update_course_thumbnail_and_sensitive_fields(
        self, db, org, course, admin_user, regular_user, mock_request, bypass_webhooks
    ):
        db.add(
            ResourceAuthor(
                resource_uuid=course.course_uuid,
                user_id=admin_user.id,
                authorship=ResourceAuthorshipEnum.CREATOR,
                authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.courses.upload_thumbnail",
            new_callable=AsyncMock,
            return_value="video.mp4",
        ):
            thumbnail_updated = await update_course_thumbnail(
                mock_request,
                course.course_uuid,
                admin_user,
                db,
                thumbnail_file=Mock(filename="video.mp4"),
                thumbnail_type=ThumbnailType.VIDEO,
            )

        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.courses.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ):
            updated = await update_course(
                mock_request,
                CourseUpdate(name="Updated Course", published=False),
                course.course_uuid,
                admin_user,
                db,
            )

            with pytest.raises(HTTPException) as forbidden_exc:
                await update_course(
                    mock_request,
                    CourseUpdate(public=False),
                    course.course_uuid,
                    regular_user,
                    db,
                )

        assert thumbnail_updated.thumbnail_video == "video.mp4"
        assert updated.name == "Updated Course"
        assert forbidden_exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_update_course_open_to_contributors_owner_path(
        self, db, org, course, admin_user, mock_request
    ):
        db.add(
            ResourceAuthor(
                resource_uuid=course.course_uuid,
                user_id=admin_user.id,
                authorship=ResourceAuthorshipEnum.CREATOR,
                authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.courses.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ):
            updated = await update_course(
                mock_request,
                CourseUpdate(open_to_contributors=True),
                course.course_uuid,
                admin_user,
                db,
            )

        assert updated.open_to_contributors is True

    @pytest.mark.asyncio
    async def test_update_course_thumbnail_image_sets_both(
        self, db, org, course, admin_user, mock_request
    ):
        course.thumbnail_video = "existing.mp4"
        db.add(course)
        db.commit()

        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.courses.upload_thumbnail",
            new_callable=AsyncMock,
            return_value="cover.png",
        ):
            updated = await update_course_thumbnail(
                mock_request,
                course.course_uuid,
                admin_user,
                db,
                thumbnail_file=Mock(filename="cover.png"),
                thumbnail_type=ThumbnailType.IMAGE,
            )

        assert updated.thumbnail_image == "cover.png"
        assert updated.thumbnail_type == ThumbnailType.BOTH

    @pytest.mark.asyncio
    async def test_update_course_publish_dispatches_webhook(
        self, db, org, course, admin_user, mock_request
    ):
        db.add(
            ResourceAuthor(
                resource_uuid=course.course_uuid,
                user_id=admin_user.id,
                authorship=ResourceAuthorshipEnum.CREATOR,
                authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        course.published = False
        db.add(course)
        db.commit()

        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.courses.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "src.services.courses.courses.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_webhooks:
            updated = await update_course(
                mock_request,
                CourseUpdate(published=True),
                course.course_uuid,
                admin_user,
                db,
            )

        assert updated.published is True
        mock_webhooks.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_get_course_user_rights_variants(
        self, db, org, course, admin_user, regular_user, anonymous_user, mock_request
    ):
        db.add(
            ResourceAuthor(
                resource_uuid=course.course_uuid,
                user_id=admin_user.id,
                authorship=ResourceAuthorshipEnum.CREATOR,
                authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        with patch(
            "src.security.rbac.rbac.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.security.rbac.rbac.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            side_effect=[True, True],
        ):
            admin_rights = await get_course_user_rights(
                mock_request, course.course_uuid, admin_user, db
            )

        anon_rights = await get_course_user_rights(
            mock_request, course.course_uuid, anonymous_user, db
        )

        assert admin_rights["ownership"]["is_creator"] is True
        assert admin_rights["permissions"]["manage_access"] is True
        assert admin_rights["permissions"]["create"] is True
        assert anon_rights["permissions"]["read"] is True
        assert anon_rights["permissions"]["update"] is False

    @pytest.mark.asyncio
    async def test_create_course_uses_api_token_creator_and_video_thumbnail(
        self, db, org, regular_user, mock_request
    ):
        token_user = APITokenUser(
            org_id=org.id,
            created_by_user_id=regular_user.id,
        )

        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.courses.check_limits_with_usage"
        ), patch(
            "src.services.courses.courses.increase_feature_usage"
        ), patch(
            "src.services.courses.courses.upload_thumbnail",
            new_callable=AsyncMock,
            return_value="thumb.mp4",
        ), patch(
            "src.services.courses.courses.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_webhooks:
            created = await create_course(
                mock_request,
                org.id,
                CourseCreate(
                    org_id=org.id,
                    name="Token Created Course",
                    description="Token desc",
                    public=True,
                    published=True,
                    open_to_contributors=False,
                ),
                token_user,
                db,
                thumbnail_file=Mock(filename="thumb.mp4"),
                thumbnail_type=ThumbnailType.VIDEO,
            )

        author = db.exec(
            select(ResourceAuthor).where(
                ResourceAuthor.resource_uuid == created.course_uuid
            )
        ).first()

        assert created.thumbnail_video == "thumb.mp4"
        assert created.thumbnail_type == ThumbnailType.VIDEO
        assert author is not None
        assert author.user_id == regular_user.id
        mock_webhooks.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_update_course_thumbnail_missing_file_raises(
        self, db, org, course, admin_user, mock_request
    ):
        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await update_course_thumbnail(
                    mock_request,
                    course.course_uuid,
                    admin_user,
                    db,
                    thumbnail_file=None,
                )

        assert exc_info.value.status_code == 500

    @pytest.mark.asyncio
    async def test_update_course_thumbnail_missing_course_raises(
        self, db, admin_user, mock_request
    ):
        with pytest.raises(HTTPException) as exc_info:
            await update_course_thumbnail(
                mock_request,
                "missing-course",
                admin_user,
                db,
                thumbnail_file=Mock(filename="thumb.png"),
            )

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_update_course_missing_course_raises(
        self, db, admin_user, mock_request
    ):
        with pytest.raises(HTTPException) as exc_info:
            await update_course(
                mock_request,
                CourseUpdate(name="Missing"),
                "missing-course",
                admin_user,
                db,
            )

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_clone_course_happy_path_clones_content_and_authorship(
        self, db, org, course, admin_user, regular_user, mock_request
    ):
        course.thumbnail_image = "cover.png"
        course.thumbnail_video = "intro.mp4"
        course.thumbnail_type = ThumbnailType.BOTH
        db.add(course)
        db.commit()

        chapter = Chapter(
            name="Clone Chapter",
            description="Clone chapter description",
            thumbnail_image="chapter.png",
            org_id=org.id,
            course_id=course.id,
            chapter_uuid="chapter_clone",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(chapter)
        db.commit()
        db.refresh(chapter)

        db.add(
            CourseChapter(
                order=1,
                course_id=course.id,
                chapter_id=chapter.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )

        activity = Activity(
            name="Clone Activity",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            content={"activity_uuid": "activity_clone", "file_id": "block_old"},
            details={"level": 1},
            published=True,
            org_id=org.id,
            course_id=course.id,
            activity_uuid="activity_clone",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(activity)
        db.commit()
        db.refresh(activity)

        db.add(
            ChapterActivity(
                order=1,
                chapter_id=chapter.id,
                activity_id=activity.id,
                course_id=course.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.add(
            Block(
                block_type=BlockTypeEnum.BLOCK_VIDEO,
                content={"activity_uuid": "activity_clone", "file_id": "block_old"},
                org_id=org.id,
                course_id=course.id,
                chapter_id=chapter.id,
                activity_id=activity.id,
                block_uuid="block_old",
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        token_user = APITokenUser(
            org_id=org.id,
            created_by_user_id=regular_user.id,
        )

        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.courses.check_limits_with_usage"
        ), patch(
            "src.services.courses.courses.increase_feature_usage"
        ), patch(
            "src.services.courses.transfer.storage_utils.is_s3_enabled",
            return_value=False,
        ), patch(
            "src.services.courses.transfer.storage_utils.file_exists",
            return_value=True,
        ), patch(
            "src.services.courses.transfer.storage_utils.list_directory",
            return_value=["asset.txt"],
        ), patch(
            "src.services.courses.courses._copy_storage_file"
        ) as mock_copy_file, patch(
            "src.services.courses.courses._delete_storage_file"
        ) as mock_delete_file, patch(
            "src.services.courses.courses._copy_storage_directory"
        ) as mock_copy_dir, patch(
            "os.makedirs"
        ):
            cloned = await clone_course(
                mock_request,
                course.course_uuid,
                token_user,
                db,
            )

        cloned_course = db.exec(
            select(Course).where(Course.course_uuid == cloned.course_uuid)
        ).first()
        cloned_author = db.exec(
            select(ResourceAuthor).where(
                ResourceAuthor.resource_uuid == cloned.course_uuid
            )
        ).first()

        assert cloned.name == "Test Course (Copy)"
        assert cloned.public is False
        assert cloned.published is False
        assert cloned.thumbnail_image
        assert cloned.thumbnail_video
        assert cloned_author is not None
        assert cloned_author.user_id == regular_user.id
        assert cloned_course is not None
        assert cloned_course.course_uuid == cloned.course_uuid
        assert mock_copy_file.call_count >= 3
        mock_delete_file.assert_called_once()
        mock_copy_dir.assert_called_once()

    @pytest.mark.asyncio
    async def test_clone_course_missing_course_and_org_failures(
        self, db, org, admin_user, mock_request
    ):
        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.courses.check_limits_with_usage"
        ):
            with pytest.raises(HTTPException) as missing_course_exc:
                await clone_course(
                    mock_request,
                    "missing-course",
                    admin_user,
                    db,
                )

        assert missing_course_exc.value.status_code == 404

        orphan = Course(
            id=99,
            name="Orphan",
            description="Orphan course",
            public=True,
            published=True,
            open_to_contributors=False,
            org_id=999,
            course_uuid="course_orphan",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(orphan)
        db.commit()

        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.courses.check_limits_with_usage"
        ):
            with pytest.raises(HTTPException) as missing_org_exc:
                await clone_course(
                    mock_request,
                    "course_orphan",
                    admin_user,
                    db,
                )

        assert missing_org_exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_clone_course_regular_user_and_storage_helpers(
        self, db, org, course, regular_user, mock_request
    ):
        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.courses.check_limits_with_usage"
        ), patch(
            "src.services.courses.courses.increase_feature_usage"
        ), patch(
            "src.services.courses.transfer.storage_utils.is_s3_enabled",
            return_value=False,
        ), patch(
            "src.services.courses.transfer.storage_utils.file_exists",
            return_value=False,
        ), patch(
            "src.services.courses.courses._copy_storage_file"
        ), patch(
            "src.services.courses.courses._delete_storage_file"
        ), patch(
            "src.services.courses.courses._copy_storage_directory"
        ), patch(
            "os.makedirs"
        ):
            cloned = await clone_course(
                mock_request,
                course.course_uuid,
                regular_user,
                db,
            )

        author = db.exec(
            select(ResourceAuthor).where(
                ResourceAuthor.resource_uuid == cloned.course_uuid
            )
        ).first()

        assert cloned.name == "Test Course (Copy)"
        assert author is not None
        assert author.user_id == regular_user.id

    @pytest.mark.asyncio
    async def test_clone_course_image_and_pdf_blocks_cover_rename_and_ast_failure(
        self, db, org, course, admin_user, mock_request
    ):
        chapter = Chapter(
            name="Clone Chapter 2",
            description="Clone chapter 2 description",
            thumbnail_image="chapter2.png",
            org_id=org.id,
            course_id=course.id,
            chapter_uuid="chapter_clone_2",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(chapter)
        db.commit()
        db.refresh(chapter)

        db.add(
            CourseChapter(
                order=1,
                course_id=course.id,
                chapter_id=chapter.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )

        activity = Activity(
            name="Clone Activity 2",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            content={"activity_uuid": "activity_clone_2", "file_id": "block_old_2"},
            details={"level": 2},
            published=True,
            org_id=org.id,
            course_id=course.id,
            activity_uuid="activity_clone_2",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(activity)
        db.commit()
        db.refresh(activity)

        db.add(
            ChapterActivity(
                order=1,
                chapter_id=chapter.id,
                activity_id=activity.id,
                course_id=course.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.add(
            Block(
                block_type=BlockTypeEnum.BLOCK_IMAGE,
                content={"activity_uuid": "activity_clone_2", "file_id": "block_old_2"},
                org_id=org.id,
                course_id=course.id,
                chapter_id=chapter.id,
                activity_id=activity.id,
                block_uuid="block_old_2",
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.add(
            Block(
                block_type=BlockTypeEnum.BLOCK_DOCUMENT_PDF,
                content={"activity_uuid": "activity_clone_2", "file_id": "block_old_3"},
                org_id=org.id,
                course_id=course.id,
                chapter_id=chapter.id,
                activity_id=activity.id,
                block_uuid="block_old_3",
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.courses.check_limits_with_usage"
        ), patch(
            "src.services.courses.courses.increase_feature_usage"
        ), patch(
            "src.services.courses.transfer.storage_utils.is_s3_enabled",
            return_value=False,
        ), patch(
            "src.services.courses.transfer.storage_utils.file_exists",
            return_value=True,
        ), patch(
            "src.services.courses.transfer.storage_utils.list_directory",
            return_value=["asset.txt"],
        ), patch(
            "src.services.courses.courses._copy_storage_file"
        ) as mock_copy_file, patch(
            "src.services.courses.courses._delete_storage_file"
        ) as mock_delete_file, patch(
            "src.services.courses.courses._copy_storage_directory"
        ), patch(
            "src.services.courses.courses.logger.error"
        ), patch(
            "ast.literal_eval",
            side_effect=ValueError("bad literal"),
        ), patch(
            "os.makedirs"
        ):
            cloned = await clone_course(
                mock_request,
                course.course_uuid,
                admin_user,
                db,
        )

        assert cloned.name == "Test Course (Copy)"
        assert mock_copy_file.call_count >= 2
        assert mock_delete_file.call_count >= 2


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

    @pytest.mark.asyncio
    async def test_search_courses_authenticated_author_sees_unpublished(
        self, db, org, regular_user, mock_request
    ):
        authored = _make_course(
            db,
            org,
            id=31,
            name="Draft Searchable",
            course_uuid="course_draft_search",
            public=False,
            published=False,
        )
        db.add(
            ResourceAuthor(
                resource_uuid=authored.course_uuid,
                user_id=regular_user.id,
                authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
                authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        with patch(
            "src.services.courses.courses.is_user_superadmin", return_value=False
        ):
            result = await search_courses(
                mock_request, regular_user, "test-org", "Draft Searchable", db
            )

        uuids = [c.course_uuid for c in result]
        assert "course_draft_search" in uuids

    @pytest.mark.asyncio
    async def test_search_courses_superadmin_uses_unbounded_branch(
        self, db, org, course, admin_user, mock_request
    ):
        with patch(
            "src.services.courses.courses.is_user_superadmin", return_value=True
        ):
            result = await search_courses(
                mock_request, admin_user, "test-org", "Test", db, limit=500
            )

        assert any(c.course_uuid == "course_test" for c in result)


class TestGetUserCoursesAndRights:
    """Additional tests for get_user_courses() and get_course_user_rights()."""

    @pytest.mark.asyncio
    async def test_get_user_courses_empty_when_no_authors(
        self, db, org, admin_user, mock_request
    ):
        with patch(
            "src.services.courses.courses.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ):
            result = await get_user_courses(
                mock_request, admin_user, 999, db
            )

        assert result == []

    @pytest.mark.asyncio
    async def test_get_course_user_rights_for_maintainer_and_contributor(
        self, db, org, course, admin_user, regular_user, mock_request
    ):
        db.add(
            ResourceAuthor(
                resource_uuid=course.course_uuid,
                user_id=admin_user.id,
                authorship=ResourceAuthorshipEnum.MAINTAINER,
                authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.add(
            ResourceAuthor(
                resource_uuid=course.course_uuid,
                user_id=regular_user.id,
                authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
                authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        with patch(
            "src.security.rbac.rbac.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "src.security.rbac.rbac.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=False,
        ):
            maintainer_rights = await get_course_user_rights(
                mock_request, course.course_uuid, admin_user, db
            )
            contributor_rights = await get_course_user_rights(
                mock_request, course.course_uuid, regular_user, db
            )

        assert maintainer_rights["ownership"]["is_maintainer"] is True
        assert maintainer_rights["permissions"]["manage_access"] is True
        assert contributor_rights["ownership"]["is_contributor"] is True
        assert contributor_rights["permissions"]["update"] is True

    @pytest.mark.asyncio
    async def test_get_course_user_rights_not_found(
        self, db, mock_request, admin_user
    ):
        with pytest.raises(HTTPException) as exc_info:
            await get_course_user_rights(
                mock_request, "missing-course", admin_user, db
            )

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_storage_helper_branches_cover_local_and_s3_paths(self):
        with patch(
            "src.services.courses.transfer.storage_utils.is_s3_enabled",
            return_value=False,
        ), patch(
            "os.makedirs"
        ) as mock_makedirs, patch(
            "shutil.copy2"
        ) as mock_copy2:
            from src.services.courses.courses import _copy_storage_file

            _copy_storage_file("src.txt", "dst/child.txt")

        mock_makedirs.assert_called_once()
        mock_copy2.assert_called_once_with("src.txt", "dst/child.txt")

        with patch(
            "src.services.courses.transfer.storage_utils.delete_storage_file"
        ) as mock_delete:
            from src.services.courses.courses import _delete_storage_file

            _delete_storage_file("file.txt")

        mock_delete.assert_called_once_with("file.txt")

        with patch(
            "src.services.courses.transfer.storage_utils.is_s3_enabled",
            return_value=False,
        ), patch(
            "os.path.exists",
            return_value=True,
        ), patch(
            "shutil.copytree"
        ) as mock_copytree:
            from src.services.courses.courses import _copy_storage_directory

            _copy_storage_directory("srcdir", "dstdir")

        mock_copytree.assert_called_once_with("srcdir", "dstdir", dirs_exist_ok=True)

        class _FakePaginator:
            def paginate(self, Bucket, Prefix):  # noqa: N803
                return [{"Contents": [{"Key": "srcdir/file.txt"}]}]

        class _FakeS3Client:
            def __init__(self, raise_on_copy: bool = False):
                self.raise_on_copy = raise_on_copy
                self.copied = []

            def get_paginator(self, name):
                return _FakePaginator()

            def copy_object(self, **kwargs):
                if self.raise_on_copy:
                    raise RuntimeError("copy failed")
                self.copied.append(kwargs)

        with patch(
            "src.services.courses.transfer.storage_utils.is_s3_enabled",
            return_value=True,
        ), patch(
            "src.services.courses.transfer.storage_utils.read_file_content",
            return_value=b"payload",
        ), patch(
            "src.services.courses.transfer.storage_utils.upload_to_s3"
        ) as mock_upload:
            from src.services.courses.courses import _copy_storage_file

            _copy_storage_file("src.txt", "dst.txt")

        mock_upload.assert_called_once_with("dst.txt", b"payload")

        fake_client = _FakeS3Client()
        with patch(
            "src.services.courses.transfer.storage_utils.is_s3_enabled",
            return_value=True,
        ), patch(
            "src.services.courses.transfer.storage_utils.get_storage_client",
            return_value=fake_client,
        ), patch(
            "src.services.courses.transfer.storage_utils.get_s3_bucket_name",
            return_value="bucket",
        ):
            from src.services.courses.courses import _copy_storage_directory

            _copy_storage_directory("srcdir", "dstdir")

        assert fake_client.copied[0]["Key"] == "dstdir/file.txt"

        with patch(
            "src.services.courses.transfer.storage_utils.is_s3_enabled",
            return_value=True,
        ), patch(
            "src.services.courses.transfer.storage_utils.get_storage_client",
            return_value=None,
        ):
            from src.services.courses.courses import _copy_storage_directory

            _copy_storage_directory("srcdir", "dstdir")

        fake_client_error = _FakeS3Client(raise_on_copy=True)
        with patch(
            "src.services.courses.transfer.storage_utils.is_s3_enabled",
            return_value=True,
        ), patch(
            "src.services.courses.transfer.storage_utils.get_storage_client",
            return_value=fake_client_error,
        ), patch(
            "src.services.courses.transfer.storage_utils.get_s3_bucket_name",
            return_value="bucket",
        ), patch(
            "src.services.courses.courses.logger.error"
        ) as mock_logger_error:
            from src.services.courses.courses import _copy_storage_directory

            _copy_storage_directory("srcdir", "dstdir")

        mock_logger_error.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_course_rolls_back_on_db_exception(
        self, db, org, admin_user, mock_request
    ):
        """Cover lines 668-670: db_session.rollback() and re-raise when commit fails."""
        from unittest.mock import MagicMock

        mock_db = MagicMock()
        mock_db.exec.return_value.first.return_value = org
        mock_db.flush.side_effect = Exception("DB constraint violation")

        with patch(
            "src.services.courses.courses.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.courses.check_limits_with_usage"
        ), patch(
            "src.services.courses.courses.increase_feature_usage"
        ):
            with pytest.raises(Exception, match="DB constraint violation"):
                await create_course(
                    mock_request,
                    org.id,
                    CourseCreate(
                        org_id=org.id,
                        name="Rollback Course",
                        description="Will fail",
                        public=False,
                        published=False,
                        open_to_contributors=False,
                    ),
                    admin_user,
                    mock_db,
                )

        mock_db.rollback.assert_called_once()

    def test_replace_uuids_in_content_handles_list(self):
        """Cover line 1064: list branch in _replace_uuids_in_content."""
        from src.services.courses.courses import _replace_uuids_in_content

        uuid_map = {"old-uuid": "new-uuid", "another-old": "another-new"}

        # List at top level — exercises the list branch (line 1064)
        result = _replace_uuids_in_content(["old-uuid", "keep-me", "another-old"], uuid_map)
        assert result == ["new-uuid", "keep-me", "another-new"]

        # Nested list inside dict
        result2 = _replace_uuids_in_content(
            {"blocks": ["old-uuid", "keep-me"]}, uuid_map
        )
        assert result2 == {"blocks": ["new-uuid", "keep-me"]}
