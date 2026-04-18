"""
Tests for src/services/courses/lock_usergroups.py

Covers all private helpers and all 6 public async functions.
"""

import pytest
from datetime import datetime
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from src.db.usergroups import UserGroup
from src.db.usergroup_resources import UserGroupResource
from src.db.courses.chapters import Chapter
from src.db.courses.activities import Activity
from src.services.courses.lock_usergroups import (
    _load_chapter_and_course,
    _load_activity_and_course,
    _load_usergroup,
    _attach_usergroup,
    _detach_usergroup,
    _list_usergroups_for_resource,
    add_usergroup_to_chapter,
    remove_usergroup_from_chapter,
    get_chapter_usergroups,
    add_usergroup_to_activity,
    remove_usergroup_from_activity,
    get_activity_usergroups,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_usergroup(db, org, *, ug_id=10, ug_uuid="ug_test"):
    """Insert and return a UserGroup row."""
    ug = UserGroup(
        id=ug_id,
        name="Test Group",
        description="A test user group",
        org_id=org.id,
        usergroup_uuid=ug_uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(ug)
    db.commit()
    db.refresh(ug)
    return ug


def _make_ugr(db, org, *, resource_uuid, usergroup_id):
    """Insert and return a UserGroupResource row."""
    now = str(datetime.now())
    ugr = UserGroupResource(
        usergroup_id=usergroup_id,
        resource_uuid=resource_uuid,
        org_id=org.id,
        creation_date=now,
        update_date=now,
    )
    db.add(ugr)
    db.commit()
    db.refresh(ugr)
    return ugr


# ===========================================================================
# _load_chapter_and_course
# ===========================================================================

class TestLoadChapterAndCourse:
    def test_success(self, db, org, course, chapter):
        ch, co = _load_chapter_and_course("chapter_test", db)
        assert ch.chapter_uuid == "chapter_test"
        assert co.id == course.id

    def test_chapter_not_found(self, db, org):
        with pytest.raises(HTTPException) as exc_info:
            _load_chapter_and_course("nonexistent_chapter", db)
        assert exc_info.value.status_code == 404
        assert "Chapter not found" in exc_info.value.detail

    def test_course_not_found_when_chapter_has_no_course(self, db, org):
        """Chapter exists but its course_id points to a non-existent course."""
        orphan_chapter = Chapter(
            id=99,
            name="Orphan Chapter",
            description="No course",
            org_id=org.id,
            course_id=9999,  # no matching Course row
            chapter_uuid="chapter_orphan",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(orphan_chapter)
        db.commit()

        with pytest.raises(HTTPException) as exc_info:
            _load_chapter_and_course("chapter_orphan", db)
        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail


# ===========================================================================
# _load_activity_and_course
# ===========================================================================

class TestLoadActivityAndCourse:
    def test_success(self, db, org, course, chapter, activity):
        act, co = _load_activity_and_course("activity_test", db)
        assert act.activity_uuid == "activity_test"
        assert co.id == course.id

    def test_activity_not_found(self, db, org):
        with pytest.raises(HTTPException) as exc_info:
            _load_activity_and_course("nonexistent_activity", db)
        assert exc_info.value.status_code == 404
        assert "Activity not found" in exc_info.value.detail

    def test_course_not_found_when_activity_has_no_course(self, db, org, chapter):
        """Activity exists but its course_id points to a non-existent course."""
        from src.db.courses.activities import ActivityTypeEnum, ActivitySubTypeEnum

        orphan_activity = Activity(
            id=99,
            name="Orphan Activity",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            content={"type": "doc", "content": []},
            published=True,
            org_id=org.id,
            course_id=9999,  # no matching Course row
            activity_uuid="activity_orphan",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(orphan_activity)
        db.commit()

        with pytest.raises(HTTPException) as exc_info:
            _load_activity_and_course("activity_orphan", db)
        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail


# ===========================================================================
# _load_usergroup
# ===========================================================================

class TestLoadUsergroup:
    def test_success(self, db, org):
        ug = _make_usergroup(db, org)
        result = _load_usergroup("ug_test", db)
        assert result.id == ug.id
        assert result.usergroup_uuid == "ug_test"

    def test_not_found(self, db, org):
        with pytest.raises(HTTPException) as exc_info:
            _load_usergroup("nonexistent_ug", db)
        assert exc_info.value.status_code == 404
        assert "User group not found" in exc_info.value.detail


# ===========================================================================
# _attach_usergroup
# ===========================================================================

class TestAttachUsergroup:
    def test_attach_new(self, db, org):
        ug = _make_usergroup(db, org)
        result = _attach_usergroup("chapter_test", org.id, ug.id, db)
        assert result == {"detail": "User group added"}

    def test_attach_duplicate_returns_early(self, db, org):
        ug = _make_usergroup(db, org)
        # First attach creates the row
        _attach_usergroup("chapter_test", org.id, ug.id, db)
        # Second attach must return the early-exit message without raising
        result = _attach_usergroup("chapter_test", org.id, ug.id, db)
        assert result == {"detail": "User group already has access"}


# ===========================================================================
# _detach_usergroup
# ===========================================================================

class TestDetachUsergroup:
    def test_detach_existing(self, db, org):
        ug = _make_usergroup(db, org)
        _make_ugr(db, org, resource_uuid="chapter_test", usergroup_id=ug.id)
        result = _detach_usergroup("chapter_test", ug.id, db)
        assert result == {"detail": "User group removed"}

    def test_detach_nonexistent_raises_404(self, db, org):
        ug = _make_usergroup(db, org)
        with pytest.raises(HTTPException) as exc_info:
            _detach_usergroup("chapter_test", ug.id, db)
        assert exc_info.value.status_code == 404
        assert "User group not associated with resource" in exc_info.value.detail


# ===========================================================================
# _list_usergroups_for_resource
# ===========================================================================

class TestListUsergroupsForResource:
    def test_empty(self, db, org):
        result = _list_usergroups_for_resource("chapter_test", db)
        assert result == []

    def test_one_group(self, db, org):
        ug = _make_usergroup(db, org)
        _make_ugr(db, org, resource_uuid="chapter_test", usergroup_id=ug.id)
        result = _list_usergroups_for_resource("chapter_test", db)
        assert len(result) == 1
        assert result[0]["usergroup_uuid"] == "ug_test"
        assert result[0]["name"] == "Test Group"
        assert result[0]["description"] == "A test user group"
        assert result[0]["usergroup_id"] == ug.id


# ===========================================================================
# Public async – chapter
# ===========================================================================

class TestAddUsergroupToChapter:
    @pytest.mark.asyncio
    async def test_success(self, db, org, course, chapter, admin_user, mock_request):
        _make_usergroup(db, org)
        with patch(
            "src.services.courses.lock_usergroups.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await add_usergroup_to_chapter(
                mock_request, "chapter_test", "ug_test", admin_user, db
            )
        assert result == {"detail": "User group added"}

    @pytest.mark.asyncio
    async def test_chapter_not_found(self, db, org, admin_user, mock_request):
        with patch(
            "src.services.courses.lock_usergroups.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await add_usergroup_to_chapter(
                    mock_request, "bad_chapter", "ug_test", admin_user, db
                )
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_usergroup_not_found(self, db, org, course, chapter, admin_user, mock_request):
        with patch(
            "src.services.courses.lock_usergroups.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await add_usergroup_to_chapter(
                    mock_request, "chapter_test", "bad_ug", admin_user, db
                )
        assert exc_info.value.status_code == 404


class TestRemoveUsergroupFromChapter:
    @pytest.mark.asyncio
    async def test_success(self, db, org, course, chapter, admin_user, mock_request):
        ug = _make_usergroup(db, org)
        _make_ugr(db, org, resource_uuid="chapter_test", usergroup_id=ug.id)
        with patch(
            "src.services.courses.lock_usergroups.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await remove_usergroup_from_chapter(
                mock_request, "chapter_test", "ug_test", admin_user, db
            )
        assert result == {"detail": "User group removed"}

    @pytest.mark.asyncio
    async def test_not_associated_raises_404(self, db, org, course, chapter, admin_user, mock_request):
        _make_usergroup(db, org)
        with patch(
            "src.services.courses.lock_usergroups.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await remove_usergroup_from_chapter(
                    mock_request, "chapter_test", "ug_test", admin_user, db
                )
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_chapter_not_found(self, db, org, admin_user, mock_request):
        with patch(
            "src.services.courses.lock_usergroups.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await remove_usergroup_from_chapter(
                    mock_request, "bad_chapter", "ug_test", admin_user, db
                )
        assert exc_info.value.status_code == 404


class TestGetChapterUsergroups:
    @pytest.mark.asyncio
    async def test_empty(self, db, org, course, chapter, admin_user, mock_request):
        with patch(
            "src.services.courses.lock_usergroups.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await get_chapter_usergroups(
                mock_request, "chapter_test", admin_user, db
            )
        assert result == []

    @pytest.mark.asyncio
    async def test_with_one_group(self, db, org, course, chapter, admin_user, mock_request):
        ug = _make_usergroup(db, org)
        _make_ugr(db, org, resource_uuid="chapter_test", usergroup_id=ug.id)
        with patch(
            "src.services.courses.lock_usergroups.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await get_chapter_usergroups(
                mock_request, "chapter_test", admin_user, db
            )
        assert len(result) == 1
        assert result[0]["usergroup_uuid"] == "ug_test"

    @pytest.mark.asyncio
    async def test_chapter_not_found(self, db, org, admin_user, mock_request):
        with patch(
            "src.services.courses.lock_usergroups.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await get_chapter_usergroups(
                    mock_request, "bad_chapter", admin_user, db
                )
        assert exc_info.value.status_code == 404


# ===========================================================================
# Public async – activity
# ===========================================================================

class TestAddUsergroupToActivity:
    @pytest.mark.asyncio
    async def test_success(self, db, org, course, chapter, activity, admin_user, mock_request):
        _make_usergroup(db, org)
        with patch(
            "src.services.courses.lock_usergroups.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await add_usergroup_to_activity(
                mock_request, "activity_test", "ug_test", admin_user, db
            )
        assert result == {"detail": "User group added"}

    @pytest.mark.asyncio
    async def test_activity_not_found(self, db, org, admin_user, mock_request):
        with patch(
            "src.services.courses.lock_usergroups.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await add_usergroup_to_activity(
                    mock_request, "bad_activity", "ug_test", admin_user, db
                )
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_usergroup_not_found(self, db, org, course, chapter, activity, admin_user, mock_request):
        with patch(
            "src.services.courses.lock_usergroups.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await add_usergroup_to_activity(
                    mock_request, "activity_test", "bad_ug", admin_user, db
                )
        assert exc_info.value.status_code == 404


class TestRemoveUsergroupFromActivity:
    @pytest.mark.asyncio
    async def test_success(self, db, org, course, chapter, activity, admin_user, mock_request):
        ug = _make_usergroup(db, org)
        _make_ugr(db, org, resource_uuid="activity_test", usergroup_id=ug.id)
        with patch(
            "src.services.courses.lock_usergroups.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await remove_usergroup_from_activity(
                mock_request, "activity_test", "ug_test", admin_user, db
            )
        assert result == {"detail": "User group removed"}

    @pytest.mark.asyncio
    async def test_not_associated_raises_404(self, db, org, course, chapter, activity, admin_user, mock_request):
        _make_usergroup(db, org)
        with patch(
            "src.services.courses.lock_usergroups.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await remove_usergroup_from_activity(
                    mock_request, "activity_test", "ug_test", admin_user, db
                )
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_activity_not_found(self, db, org, admin_user, mock_request):
        with patch(
            "src.services.courses.lock_usergroups.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await remove_usergroup_from_activity(
                    mock_request, "bad_activity", "ug_test", admin_user, db
                )
        assert exc_info.value.status_code == 404


class TestGetActivityUsergroups:
    @pytest.mark.asyncio
    async def test_empty(self, db, org, course, chapter, activity, admin_user, mock_request):
        with patch(
            "src.services.courses.lock_usergroups.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await get_activity_usergroups(
                mock_request, "activity_test", admin_user, db
            )
        assert result == []

    @pytest.mark.asyncio
    async def test_with_one_group(self, db, org, course, chapter, activity, admin_user, mock_request):
        ug = _make_usergroup(db, org)
        _make_ugr(db, org, resource_uuid="activity_test", usergroup_id=ug.id)
        with patch(
            "src.services.courses.lock_usergroups.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await get_activity_usergroups(
                mock_request, "activity_test", admin_user, db
            )
        assert len(result) == 1
        assert result[0]["usergroup_uuid"] == "ug_test"

    @pytest.mark.asyncio
    async def test_activity_not_found(self, db, org, admin_user, mock_request):
        with patch(
            "src.services.courses.lock_usergroups.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await get_activity_usergroups(
                    mock_request, "bad_activity", admin_user, db
                )
        assert exc_info.value.status_code == 404
