"""Regression tests: author/member lists must not leak private user fields.

Course/podcast authors, course contributors, board members and usergroup
members are all readable by people who are not editors of the resource
(anonymous readers on public courses and boards, learners on usergroups).
Emails and other private user fields must only reach callers who can edit.
"""

from datetime import datetime

import pytest

from src.db.boards import Board, BoardMember, BoardMemberRole
from src.db.courses.courses import AuthorWithRole
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import UserRead
from src.services.boards.boards import get_board_members
from src.services.courses.contributors import get_course_contributors
from src.services.courses.courses import get_course
from src.services.users.usergroups import get_users_linked_to_usergroup

PRIVATE_FIELDS = {"email", "is_superadmin", "signup_method", "last_login_at", "extra_metadata"}


async def _add_course_creator(db, course, user_id):
    now = str(datetime.now())
    db.add(ResourceAuthor(
        resource_uuid=course.course_uuid,
        user_id=user_id,
        authorship=ResourceAuthorshipEnum.CREATOR,
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date=now,
        update_date=now,
    ))
    await db.commit()


async def _make_board(db, org, owner_id):
    board = Board(
        org_id=org.id,
        name="Board",
        description="Desc",
        thumbnail_image="",
        public=True,
        board_uuid="board_email_test",
        created_by=owner_id,
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    db.add(board)
    await db.commit()
    await db.refresh(board)
    db.add(BoardMember(
        board_id=board.id,
        user_id=owner_id,
        role=BoardMemberRole.OWNER,
        creation_date="2024-01-01",
    ))
    await db.commit()
    return board


class TestCourseAuthors:
    @pytest.mark.asyncio
    async def test_anonymous_sees_no_private_author_fields(
        self, db, org, admin_user, anonymous_user, course, mock_request
    ):
        await _add_course_creator(db, course, admin_user.id)

        result = await get_course(mock_request, course.course_uuid, anonymous_user, db)

        dumped = result.model_dump()
        assert dumped["authors"], "creator should be listed"
        for author in dumped["authors"]:
            assert PRIVATE_FIELDS.isdisjoint(author["user"].keys())
            assert author["user"]["username"] == "admin"

    @pytest.mark.asyncio
    async def test_regular_user_sees_no_private_author_fields(
        self, db, org, admin_user, regular_user, course, mock_request
    ):
        await _add_course_creator(db, course, admin_user.id)

        result = await get_course(mock_request, course.course_uuid, regular_user, db)

        for author in result.model_dump()["authors"]:
            assert PRIVATE_FIELDS.isdisjoint(author["user"].keys())

    def test_author_model_drops_private_fields_from_full_user(self):
        # Callers that still build AuthorWithRole from a UserRead get it
        # narrowed to the author projection on validation.
        full = UserRead(
            id=1, user_uuid="u", username="x", first_name="A", last_name="B",
            email="secret@test.com", is_superadmin=True, signup_method="email",
        )
        author = AuthorWithRole(
            user=full,
            authorship=ResourceAuthorshipEnum.CREATOR,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
            creation_date="", update_date="",
        )
        assert "secret@test.com" not in author.model_dump_json()
        assert PRIVATE_FIELDS.isdisjoint(author.model_dump()["user"].keys())


class TestCourseContributors:
    @pytest.mark.asyncio
    async def test_anonymous_sees_no_contributor_email(
        self, db, org, admin_user, anonymous_user, course, mock_request
    ):
        await _add_course_creator(db, course, admin_user.id)

        contributors = await get_course_contributors(
            mock_request, course.course_uuid, anonymous_user, db
        )

        assert contributors
        for c in contributors:
            assert PRIVATE_FIELDS.isdisjoint(c["user"].keys())

    @pytest.mark.asyncio
    async def test_regular_user_sees_no_contributor_email(
        self, db, org, admin_user, regular_user, course, mock_request
    ):
        await _add_course_creator(db, course, admin_user.id)

        contributors = await get_course_contributors(
            mock_request, course.course_uuid, regular_user, db
        )

        for c in contributors:
            assert "email" not in c["user"]

    @pytest.mark.asyncio
    async def test_admin_sees_contributor_email(
        self, db, org, admin_user, course, mock_request
    ):
        await _add_course_creator(db, course, admin_user.id)

        contributors = await get_course_contributors(
            mock_request, course.course_uuid, admin_user, db
        )

        assert contributors[0]["user"]["email"] == "admin@test.com"


class TestBoardMembers:
    @pytest.mark.asyncio
    async def test_anonymous_sees_no_member_email(
        self, db, org, admin_user, anonymous_user, mock_request
    ):
        board = await _make_board(db, org, admin_user.id)

        members = await get_board_members(mock_request, board.board_uuid, anonymous_user, db)

        assert members
        assert all(m.email is None for m in members)
        assert members[0].username == "admin"

    @pytest.mark.asyncio
    async def test_owner_sees_member_email(
        self, db, org, admin_user, mock_request
    ):
        board = await _make_board(db, org, admin_user.id)

        members = await get_board_members(mock_request, board.board_uuid, admin_user, db)

        assert members[0].email == "admin@test.com"


class TestUsergroupMembers:
    @pytest.mark.asyncio
    async def test_regular_user_sees_no_member_email(
        self, db, org, admin_user, regular_user, mock_request
    ):
        now = str(datetime.now())
        usergroup = UserGroup(
            name="Group", description="", org_id=org.id,
            usergroup_uuid="usergroup_email_test",
            creation_date=now, update_date=now,
        )
        db.add(usergroup)
        await db.commit()
        await db.refresh(usergroup)
        db.add(UserGroupUser(
            usergroup_id=usergroup.id, user_id=admin_user.id, org_id=org.id,
            creation_date=now, update_date=now,
        ))
        await db.commit()

        # The roster is a management view: a learner is refused outright,
        # and even a manager only gets the public projection.
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await get_users_linked_to_usergroup(
                mock_request, db, regular_user, usergroup.id
            )
        assert exc_info.value.status_code == 403

        users = await get_users_linked_to_usergroup(
            mock_request, db, admin_user, usergroup.id
        )

        assert users
        for u in users:
            assert PRIVATE_FIELDS.isdisjoint(u.model_dump().keys())
