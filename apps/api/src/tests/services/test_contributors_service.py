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

from src.security.rbac import AccessAction
from src.db.courses.courses import Course
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.services.courses.contributors import (
    add_bulk_course_contributors,
    apply_course_contributor,
    get_course_contributors,
    remove_bulk_course_contributors,
    update_course_contributor,
)


async def _make_user(db, *, user_id: int, username: str) -> User:
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
    await db.commit()
    await db.refresh(user)
    return user


async def _join_org(db, user_id: int, org_id: int = 1) -> None:
    db.add(UserOrganization(
        user_id=user_id, org_id=org_id, role_id=4,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    await db.commit()


async def _make_contributor(
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
    await db.commit()
    await db.refresh(contributor)
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

        authorship = (
            await db.execute(
                select(ResourceAuthor).where(ResourceAuthor.resource_uuid == course.course_uuid)
            )
        ).scalars().first()
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
        await _make_contributor(db, course, regular_user.id)

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
        contributor_user = await _make_user(db, user_id=20, username="contrib")
        await _make_contributor(db, course, contributor_user.id)

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

        updated = (
            await db.execute(
                select(ResourceAuthor).where(
                    ResourceAuthor.resource_uuid == course.course_uuid,
                    ResourceAuthor.user_id == contributor_user.id,
                )
            )
        ).scalars().first()
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
        creator_user = await _make_user(db, user_id=21, username="creator")
        await _make_contributor(
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
        contributor_user = await _make_user(db, user_id=30, username="reader")
        await _make_contributor(db, course, contributor_user.id)

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

        # READ to list, then UPDATE (non-raising) to decide whether emails show.
        assert mock_access.await_count == 2
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
    async def test_add_bulk_course_contributors_missing_course_raises(
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
                await add_bulk_course_contributors(
                    mock_request,
                    "missing-course-uuid",
                    ["someuser"],
                    admin_user,
                    db,
                )
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_add_bulk_course_contributors_all_usernames_not_found(
        self, db, course, admin_user, mock_request
    ):
        with patch(
            "src.services.courses.contributors.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.contributors.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.contributors.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            result = await add_bulk_course_contributors(
                mock_request,
                course.course_uuid,
                ["ghost1", "ghost2"],
                admin_user,
                db,
            )
        assert result["successful"] == []
        assert len(result["failed"]) == 2
        assert all(f["reason"] == "User not found or invalid" for f in result["failed"])

    @pytest.mark.asyncio
    async def test_add_bulk_course_contributors_mixed_result(
        self, db, course, admin_user, mock_request
    ):
        alice = await _make_user(db, user_id=40, username="alice")
        bob = await _make_user(db, user_id=41, username="bob")
        await _join_org(db, alice.id)
        await _join_org(db, bob.id)
        await _make_contributor(db, course, bob.id)
        await _make_user(db, user_id=42, username="carol")

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

        created = (
            await db.execute(
                select(ResourceAuthor).where(
                    ResourceAuthor.resource_uuid == course.course_uuid,
                    ResourceAuthor.user_id == alice.id,
                )
            )
        ).scalars().first()
        assert created is not None
        assert created.authorship == ResourceAuthorshipEnum.CONTRIBUTOR
        assert created.authorship_status == ResourceAuthorshipStatusEnum.PENDING

    @pytest.mark.asyncio
    async def test_add_bulk_course_contributors_exception_branch(
        self, db, course, admin_user, mock_request
    ):
        user = await _make_user(db, user_id=43, username="boom")
        await _join_org(db, user.id)

        with patch(
            "src.services.courses.contributors.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.contributors.check_resource_access",
            new_callable=AsyncMock,
        ), patch.object(db, "commit", side_effect=RuntimeError("boom")), patch.object(
            db, "rollback"
        ), patch(
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
        assert len(result["failed"]) == 1
        assert result["failed"][0]["username"] == "boom"
        assert "boom" in result["failed"][0]["reason"]


class TestRemoveBulkCourseContributors:
    @pytest.mark.asyncio
    async def test_remove_bulk_course_contributors_missing_course_raises(
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
                await remove_bulk_course_contributors(
                    mock_request,
                    "missing-course-uuid",
                    ["someuser"],
                    admin_user,
                    db,
                )
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_remove_bulk_course_contributors_all_usernames_not_found(
        self, db, course, admin_user, mock_request
    ):
        with patch(
            "src.services.courses.contributors.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.contributors.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.contributors.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            result = await remove_bulk_course_contributors(
                mock_request,
                course.course_uuid,
                ["ghost1", "ghost2"],
                admin_user,
                db,
            )
        assert result["successful"] == []
        assert len(result["failed"]) == 2
        assert all(f["reason"] == "User not found or invalid" for f in result["failed"])

    @pytest.mark.asyncio
    async def test_remove_bulk_course_contributors_user_not_contributor_fails(
        self, db, course, admin_user, mock_request
    ):
        non_contrib = await _make_user(db, user_id=60, username="noncontrib")

        with patch(
            "src.services.courses.contributors.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.contributors.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.contributors.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            result = await remove_bulk_course_contributors(
                mock_request,
                course.course_uuid,
                [non_contrib.username],
                admin_user,
                db,
            )
        assert result["successful"] == []
        assert len(result["failed"]) == 1
        assert result["failed"][0]["reason"] == "User is not a contributor for this course"

    @pytest.mark.asyncio
    async def test_remove_bulk_course_contributors_mixed_result(
        self, db, course, admin_user, mock_request
    ):
        alice = await _make_user(db, user_id=50, username="alice")
        bob = await _make_user(db, user_id=51, username="bob")
        await _make_contributor(db, course, alice.id)
        await _make_contributor(db, course, bob.id, authorship=ResourceAuthorshipEnum.CREATOR)

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
        assert (
            await db.execute(
                select(ResourceAuthor).where(
                    ResourceAuthor.resource_uuid == course.course_uuid,
                    ResourceAuthor.user_id == bob.id,
                )
            )
        ).scalars().first() is not None

    @pytest.mark.asyncio
    async def test_remove_bulk_course_contributors_exception_branch(
        self, db, course, admin_user, mock_request
    ):
        user = await _make_user(db, user_id=52, username="boom")
        await _make_contributor(db, course, user.id)

        with patch(
            "src.services.courses.contributors.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.contributors.check_resource_access",
            new_callable=AsyncMock,
        ), patch.object(db, "commit", side_effect=RuntimeError("boom")), patch.object(
            db, "rollback"
        ), patch(
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
        assert len(result["failed"]) == 1
        assert result["failed"][0]["username"] == "boom"
        assert "boom" in result["failed"][0]["reason"]


class TestContributorEmailsAreForManagers:
    @pytest.mark.asyncio
    async def test_reader_gets_public_profile_only(self, db, course, admin_user, mock_request):
        from src.security.rbac.resource_access import AccessDecision

        contributor_user = await _make_user(db, user_id=31, username="writer")
        await _make_contributor(db, course, contributor_user.id)

        async def access(*args, **kwargs):
            # Readers pass READ but not UPDATE.
            return AccessDecision(allowed=args[4] == AccessAction.READ, reason="")

        with patch("src.services.courses.contributors.check_resource_access", side_effect=access):
            result = await get_course_contributors(mock_request, course.course_uuid, admin_user, db)

        assert "email" not in result[0]["user"]


class TestBulkContributorManagementGuards:
    """Course UPDATE alone (an active contributor has it) doesn't let a caller
    manage contributors; maintainers can't remove each other; only members of
    the course's org can be added."""

    def _patches(self):
        return (
            patch(
                "src.services.courses.contributors.check_resource_access",
                new_callable=AsyncMock,
            ),
            patch(
                "src.services.courses.contributors.dispatch_webhooks",
                new_callable=AsyncMock,
            ),
        )

    @pytest.mark.asyncio
    async def test_contributor_cannot_bulk_add_or_remove(self, db, course, regular_user, mock_request):
        await _make_contributor(db, course, regular_user.id)
        access, hooks = self._patches()
        with access, hooks:
            for fn in (add_bulk_course_contributors, remove_bulk_course_contributors):
                with pytest.raises(HTTPException) as exc:
                    await fn(mock_request, course.course_uuid, ["someone"], regular_user, db)
                assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_maintainer_cannot_remove_other_maintainer(self, db, course, regular_user, mock_request):
        await _make_contributor(
            db, course, regular_user.id, authorship=ResourceAuthorshipEnum.MAINTAINER
        )
        peer = await _make_user(db, user_id=60, username="peer")
        helper = await _make_user(db, user_id=61, username="helper")
        await _make_contributor(db, course, peer.id, authorship=ResourceAuthorshipEnum.MAINTAINER)
        await _make_contributor(db, course, helper.id)
        access, hooks = self._patches()
        with access, hooks:
            result = await remove_bulk_course_contributors(
                mock_request, course.course_uuid, ["peer", "helper"], regular_user, db
            )
        assert [s["username"] for s in result["successful"]] == ["helper"]
        assert result["failed"][0]["username"] == "peer"

    @pytest.mark.asyncio
    async def test_bulk_add_skips_users_of_other_orgs(self, db, course, admin_user, mock_request):
        outsider = await _make_user(db, user_id=62, username="outsider")
        await _join_org(db, outsider.id, org_id=2)
        access, hooks = self._patches()
        with access, hooks:
            result = await add_bulk_course_contributors(
                mock_request, course.course_uuid, ["outsider"], admin_user, db
            )
        assert result["successful"] == []
        assert result["failed"] == [{"username": "outsider", "reason": "User not found or invalid"}]
