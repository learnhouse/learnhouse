"""
Tests for src/services/courses/contributors.py

Covers contributor application, contributor updates, contributor listing,
and bulk add/remove flows including common error branches.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.courses import Course
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.users import User
from src.services.courses.contributors import (
    add_bulk_course_contributors,
    apply_course_contributor,
    get_course_contributors,
    remove_bulk_course_contributors,
    update_course_contributor,
)


def _make_user(db, *, user_id: int, username: str) -> User:
    user = User(
        id=user_id,
        username=username,
        first_name=username.capitalize(),
        last_name="User",
        email=f"{username}@test.com",
        password="hashed_password",
        user_uuid=f"user_{username}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_contributor(
    db,
    course: Course,
    user_id: int,
    *,
    authorship: ResourceAuthorshipEnum = ResourceAuthorshipEnum.CONTRIBUTOR,
    status: ResourceAuthorshipStatusEnum = ResourceAuthorshipStatusEnum.ACTIVE,
) -> ResourceAuthor:
    contributor = ResourceAuthor(
        resource_uuid=course.course_uuid,
        user_id=user_id,
        authorship=authorship,
        authorship_status=status,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(contributor)
    db.commit()
    db.refresh(contributor)
    return contributor


class TestApplyCourseContributor:
    @pytest.mark.asyncio
    async def test_apply_course_contributor_success(
        self, db, course, regular_user, mock_request
    ):
        with patch(
            "src.services.courses.contributors.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ) as mock_auth:
            result = await apply_course_contributor(
                mock_request,
                course.course_uuid,
                regular_user,
                db,
            )

        mock_auth.assert_awaited_once_with(regular_user.id)
        assert result == {
            "detail": "Contributor application submitted successfully",
            "status": "pending",
        }

        authorship = db.exec(
            select(ResourceAuthor).where(ResourceAuthor.resource_uuid == course.course_uuid)
        ).first()
        assert authorship is not None
        assert authorship.user_id == regular_user.id
        assert authorship.authorship == ResourceAuthorshipEnum.CONTRIBUTOR
        assert authorship.authorship_status == ResourceAuthorshipStatusEnum.PENDING

    @pytest.mark.asyncio
    async def test_apply_course_contributor_anon_rejected(
        self, db, course, anonymous_user, mock_request
    ):
        with patch(
            "src.services.courses.contributors.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=401, detail="Anonymous user"),
        ) as mock_auth:
            with pytest.raises(HTTPException) as exc_info:
                await apply_course_contributor(
                    mock_request,
                    course.course_uuid,
                    anonymous_user,
                    db,
                )

        mock_auth.assert_awaited_once_with(anonymous_user.id)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_apply_course_contributor_course_not_found(
        self, db, regular_user, mock_request
    ):
        with patch(
            "src.services.courses.contributors.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await apply_course_contributor(
                    mock_request,
                    "missing-course",
                    regular_user,
                    db,
                )

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_apply_course_contributor_existing_authorship_rejected(
        self, db, course, regular_user, mock_request
    ):
        _make_contributor(db, course, regular_user.id)

        with patch(
            "src.services.courses.contributors.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await apply_course_contributor(
                    mock_request,
                    course.course_uuid,
                    regular_user,
                    db,
                )

        assert exc_info.value.status_code == 400


class TestUpdateCourseContributor:
    @pytest.mark.asyncio
    async def test_update_course_contributor_success(
        self, db, course, admin_user, mock_request
    ):
        contributor_user = _make_user(db, user_id=20, username="contrib")
        _make_contributor(db, course, contributor_user.id)

        with patch(
            "src.services.courses.contributors.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ) as mock_auth, patch(
            "src.services.courses.contributors.check_resource_access",
            new_callable=AsyncMock,
        ) as mock_access:
            result = await update_course_contributor(
                mock_request,
                course.course_uuid,
                contributor_user.id,
                ResourceAuthorshipEnum.MAINTAINER,
                ResourceAuthorshipStatusEnum.INACTIVE,
                admin_user,
                db,
            )

        mock_auth.assert_awaited_once_with(admin_user.id)
        mock_access.assert_awaited_once()
        assert result == {
            "detail": "Contributor updated successfully",
            "status": "success",
        }

        updated = db.exec(
            select(ResourceAuthor).where(
                ResourceAuthor.resource_uuid == course.course_uuid,
                ResourceAuthor.user_id == contributor_user.id,
            )
        ).first()
        assert updated is not None
        assert updated.authorship == ResourceAuthorshipEnum.MAINTAINER
        assert updated.authorship_status == ResourceAuthorshipStatusEnum.INACTIVE

    @pytest.mark.asyncio
    async def test_update_course_contributor_course_not_found(
        self, db, admin_user, mock_request
    ):
        with patch(
            "src.services.courses.contributors.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.contributors.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await update_course_contributor(
                    mock_request,
                    "missing-course",
                    999,
                    ResourceAuthorshipEnum.CONTRIBUTOR,
                    ResourceAuthorshipStatusEnum.ACTIVE,
                    admin_user,
                    db,
                )

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_update_course_contributor_missing_contributor(
        self, db, course, admin_user, mock_request
    ):
        with patch(
            "src.services.courses.contributors.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.contributors.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await update_course_contributor(
                    mock_request,
                    course.course_uuid,
                    999,
                    ResourceAuthorshipEnum.CONTRIBUTOR,
                    ResourceAuthorshipStatusEnum.ACTIVE,
                    admin_user,
                    db,
                )

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_update_course_contributor_creator_guard(
        self, db, course, admin_user, mock_request
    ):
        creator_user = _make_user(db, user_id=21, username="creator")
        _make_contributor(
            db,
            course,
            creator_user.id,
            authorship=ResourceAuthorshipEnum.CREATOR,
        )

        with patch(
            "src.services.courses.contributors.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.contributors.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await update_course_contributor(
                    mock_request,
                    course.course_uuid,
                    creator_user.id,
                    ResourceAuthorshipEnum.CONTRIBUTOR,
                    ResourceAuthorshipStatusEnum.ACTIVE,
                    admin_user,
                    db,
                )

        assert exc_info.value.status_code == 400


class TestGetCourseContributors:
    @pytest.mark.asyncio
    async def test_get_course_contributors_success(
        self, db, course, admin_user, mock_request
    ):
        contributor_user = _make_user(db, user_id=30, username="reader")
        _make_contributor(db, course, contributor_user.id)

        with patch(
            "src.services.courses.contributors.check_resource_access",
            new_callable=AsyncMock,
        ) as mock_access:
            result = await get_course_contributors(
                mock_request,
                course.course_uuid,
                admin_user,
                db,
            )

        mock_access.assert_awaited_once()
        assert len(result) == 1
        assert result[0]["user_id"] == contributor_user.id
        assert result[0]["authorship"] == ResourceAuthorshipEnum.CONTRIBUTOR
        assert result[0]["authorship_status"] == ResourceAuthorshipStatusEnum.ACTIVE
        assert result[0]["user"]["username"] == "reader"
        assert result[0]["user"]["email"] == "reader@test.com"

    @pytest.mark.asyncio
    async def test_get_course_contributors_course_not_found(
        self, db, admin_user, mock_request
    ):
        with pytest.raises(HTTPException) as exc_info:
            await get_course_contributors(
                mock_request,
                "missing-course",
                admin_user,
                db,
            )

        assert exc_info.value.status_code == 404


class TestAddBulkCourseContributors:
    @pytest.mark.asyncio
    async def test_add_bulk_course_contributors_mixed_result(
        self, db, course, admin_user, mock_request
    ):
        alice = _make_user(db, user_id=40, username="alice")
        bob = _make_user(db, user_id=41, username="bob")
        _make_contributor(db, course, bob.id)
        _make_user(db, user_id=42, username="carol")

        with patch(
            "src.services.courses.contributors.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ) as mock_auth, patch(
            "src.services.courses.contributors.check_resource_access",
            new_callable=AsyncMock,
        ) as mock_access, patch(
            "src.services.courses.contributors.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_webhook:
            result = await add_bulk_course_contributors(
                mock_request,
                course.course_uuid,
                ["alice", "bob", "missing"],
                admin_user,
                db,
            )

        mock_auth.assert_awaited_once_with(admin_user.id)
        mock_access.assert_awaited_once()
        mock_webhook.assert_awaited_once()
        assert result["successful"] == [{"username": "alice", "user_id": alice.id}]
        assert result["failed"] == [
            {
                "username": "bob",
                "reason": "User already has an authorship role for this course",
            },
            {
                "username": "missing",
                "reason": "User not found or invalid",
            },
        ]

        created = db.exec(
            select(ResourceAuthor).where(
                ResourceAuthor.resource_uuid == course.course_uuid,
                ResourceAuthor.user_id == alice.id,
            )
        ).first()
        assert created is not None
        assert created.authorship == ResourceAuthorshipEnum.CONTRIBUTOR
        assert created.authorship_status == ResourceAuthorshipStatusEnum.PENDING

    @pytest.mark.asyncio
    async def test_add_bulk_course_contributors_exception_branch(
        self, db, course, admin_user, mock_request
    ):
        user = _make_user(db, user_id=43, username="boom")

        with patch(
            "src.services.courses.contributors.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.contributors.check_resource_access",
            new_callable=AsyncMock,
        ), patch.object(db, "add", side_effect=RuntimeError("boom")), patch(
            "src.services.courses.contributors.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_webhook:
            result = await add_bulk_course_contributors(
                mock_request,
                course.course_uuid,
                [user.username],
                admin_user,
                db,
            )

        mock_webhook.assert_not_awaited()
        assert result["successful"] == []
        assert result["failed"] == [{"username": "boom", "reason": "boom"}]


class TestRemoveBulkCourseContributors:
    @pytest.mark.asyncio
    async def test_remove_bulk_course_contributors_mixed_result(
        self, db, course, admin_user, mock_request
    ):
        alice = _make_user(db, user_id=50, username="alice")
        bob = _make_user(db, user_id=51, username="bob")
        _make_contributor(db, course, alice.id)
        _make_contributor(db, course, bob.id, authorship=ResourceAuthorshipEnum.CREATOR)

        with patch(
            "src.services.courses.contributors.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.contributors.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.contributors.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_webhook:
            result = await remove_bulk_course_contributors(
                mock_request,
                course.course_uuid,
                ["alice", "bob", "missing"],
                admin_user,
                db,
            )

        mock_webhook.assert_awaited_once()
        assert result["successful"] == [{"username": "alice", "user_id": alice.id}]
        assert result["failed"] == [
            {
                "username": "bob",
                "reason": "Cannot remove the course creator",
            },
            {
                "username": "missing",
                "reason": "User not found or invalid",
            },
        ]
        assert db.exec(
            select(ResourceAuthor).where(
                ResourceAuthor.resource_uuid == course.course_uuid,
                ResourceAuthor.user_id == bob.id,
            )
        ).first() is not None

    @pytest.mark.asyncio
    async def test_remove_bulk_course_contributors_exception_branch(
        self, db, course, admin_user, mock_request
    ):
        user = _make_user(db, user_id=52, username="boom")
        _make_contributor(db, course, user.id)

        with patch(
            "src.services.courses.contributors.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.contributors.check_resource_access",
            new_callable=AsyncMock,
        ), patch.object(db, "delete", side_effect=RuntimeError("boom")), patch(
            "src.services.courses.contributors.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as mock_webhook:
            result = await remove_bulk_course_contributors(
                mock_request,
                course.course_uuid,
                [user.username],
                admin_user,
                db,
            )

        mock_webhook.assert_not_awaited()
        assert result["successful"] == []
        assert result["failed"] == [{"username": "boom", "reason": "boom"}]
