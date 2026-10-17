"""Board access rules: private boards, cross-org public boards, owner grants.

* A private board with no linked usergroup belongs to its members (plus its
  authors and org admins/maintainers), not to every member of the org.
* A public board is readable by anyone, as a viewer only.
* Only a board owner or an org admin may make someone an owner, and org admins
  can remove owners.
"""

from datetime import datetime

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from src.db.boards import (
    Board,
    BoardMember,
    BoardMemberBatchCreate,
    BoardMemberCreate,
    BoardMemberRole,
    BoardUpdate,
)
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.roles import Role, RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import APITokenUser, PublicUser, User
from src.services.boards.boards import (
    add_board_member,
    add_board_members_batch,
    check_board_membership,
    duplicate_board,
    get_board,
    get_board_members,
    get_boards_by_org,
    remove_board_member,
    update_board,
)
from src.tests.conftest import ADMIN_RIGHTS

NOW = str(datetime.now())


def _req() -> Request:
    # A fresh request per call: RBAC memoizes lookups on request.state.
    return Request({"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b""})


async def _user(db, id, org_id=None, role_id=None) -> PublicUser:
    db.add(User(
        id=id, username=f"user{id}", first_name="U", last_name=str(id),
        email=f"user{id}@test.com", password="hashed", user_uuid=f"user_{id}",
        creation_date=NOW, update_date=NOW,
    ))
    if org_id is not None:
        db.add(UserOrganization(
            user_id=id, org_id=org_id, role_id=role_id, creation_date=NOW, update_date=NOW,
        ))
    await db.commit()
    return PublicUser(
        id=id, username=f"user{id}", first_name="U", last_name=str(id),
        email=f"user{id}@test.com", user_uuid=f"user_{id}",
    )


async def _board(db, org, creator, *, public=False, uuid="board_sweep7") -> Board:
    board = Board(
        org_id=org.id, name="Board", description="", thumbnail_image="", public=public,
        board_uuid=uuid, created_by=creator.id, creation_date=NOW, update_date=NOW,
    )
    db.add(board)
    await db.commit()
    await db.refresh(board)
    db.add(BoardMember(board_id=board.id, user_id=creator.id, role=BoardMemberRole.OWNER, creation_date=NOW))
    db.add(ResourceAuthor(
        resource_uuid=board.board_uuid, user_id=creator.id,
        authorship=ResourceAuthorshipEnum.CREATOR,
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date=NOW, update_date=NOW,
    ))
    await db.commit()
    return board


async def _member(db, board, user, role=BoardMemberRole.EDITOR):
    db.add(BoardMember(board_id=board.id, user_id=user.id, role=role, creation_date=NOW))
    await db.commit()


async def _link_group(db, org, board, members=()):
    group = UserGroup(name="G", description="", org_id=org.id, usergroup_uuid="usergroup_s7",
                      creation_date=NOW, update_date=NOW)
    db.add(group)
    await db.commit()
    await db.refresh(group)
    db.add(UserGroupResource(usergroup_id=group.id, resource_uuid=board.board_uuid, org_id=org.id,
                             creation_date=NOW, update_date=NOW))
    for user in members:
        db.add(UserGroupUser(usergroup_id=group.id, user_id=user.id, org_id=org.id,
                             creation_date=NOW, update_date=NOW))
    await db.commit()


@pytest.fixture
async def manager_role(db, org):
    """A custom org role that may update any board (not admin/maintainer)."""
    role = Role(
        id=3, name="Instructor", org_id=org.id, role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_instructor", rights=ADMIN_RIGHTS.model_dump(),
        creation_date=NOW, update_date=NOW,
    )
    db.add(role)
    await db.commit()
    return role


async def _denied(coro, status=403):
    with pytest.raises(HTTPException) as exc:
        await coro
    assert exc.value.status_code == status
    return exc.value


class TestPrivateBoardWithoutUsergroup:
    @pytest.mark.asyncio
    async def test_org_member_cannot_read_or_join(self, db, org, admin_user, regular_user):
        board = await _board(db, org, admin_user)

        await _denied(get_board(_req(), board.board_uuid, regular_user, db))
        await _denied(get_board_members(_req(), board.board_uuid, regular_user, db))
        await _denied(check_board_membership(_req(), board.board_uuid, regular_user, db))
        await _denied(duplicate_board(_req(), board.board_uuid, regular_user, db))
        assert await get_boards_by_org(_req(), org.id, regular_user, db) == []

    @pytest.mark.asyncio
    async def test_anonymous_is_denied_with_rbac_reason(self, db, org, admin_user, anonymous_user):
        board = await _board(db, org, admin_user)
        err = await _denied(get_board(_req(), board.board_uuid, anonymous_user, db))
        assert err.detail == "Resource is not public"

    @pytest.mark.asyncio
    async def test_members_creator_and_admins_keep_access(
        self, db, org, admin_role, user_role, regular_user
    ):
        creator = await _user(db, 10, org.id, user_role.id)
        board = await _board(db, org, creator)
        await _member(db, board, regular_user)
        admin = await _user(db, 11, org.id, admin_role.id)

        # Board member (editor) reads, lists and joins as an editor
        assert (await get_board(_req(), board.board_uuid, regular_user, db)).board_uuid == board.board_uuid
        assert [b.board_uuid for b in await get_boards_by_org(_req(), org.id, regular_user, db)] == [board.board_uuid]
        assert (await check_board_membership(_req(), board.board_uuid, regular_user, db)).role == "editor"
        assert len(await get_board_members(_req(), board.board_uuid, regular_user, db)) == 2

        # Creator (author) and an org admin without a member row
        assert (await get_board(_req(), board.board_uuid, creator, db)).board_uuid == board.board_uuid
        assert (await get_board(_req(), board.board_uuid, admin, db)).board_uuid == board.board_uuid
        assert (await check_board_membership(_req(), board.board_uuid, admin, db)).role == "viewer"

    @pytest.mark.asyncio
    async def test_maintainer_lists_private_board(self, db, org, admin_user):
        db.add(Role(
            id=2, name="Maintainer", org_id=org.id, role_type=RoleTypeEnum.TYPE_ORGANIZATION,
            role_uuid="role_maintainer", rights=ADMIN_RIGHTS.model_dump(),
            creation_date=NOW, update_date=NOW,
        ))
        await db.commit()
        maintainer = await _user(db, 12, org.id, 2)
        board = await _board(db, org, admin_user)
        assert [b.board_uuid for b in await get_boards_by_org(_req(), org.id, maintainer, db)] == [board.board_uuid]

    @pytest.mark.asyncio
    async def test_member_row_does_not_survive_leaving_the_org(
        self, db, org, other_org, admin_user, user_role
    ):
        board = await _board(db, org, admin_user)
        former = await _user(db, 13, other_org.id, user_role.id)
        await _member(db, board, former)
        await _denied(get_board(_req(), board.board_uuid, former, db))


class TestPrivateBoardWithUsergroup:
    @pytest.mark.asyncio
    async def test_linked_group_grants_read(self, db, org, admin_user, regular_user, user_role):
        board = await _board(db, org, admin_user)
        outsider = await _user(db, 14, org.id, user_role.id)
        await _link_group(db, org, board, members=[regular_user])

        assert (await get_board(_req(), board.board_uuid, regular_user, db)).board_uuid == board.board_uuid
        assert (await check_board_membership(_req(), board.board_uuid, regular_user, db)).role == "viewer"
        await _denied(get_board(_req(), board.board_uuid, outsider, db))
        assert await get_boards_by_org(_req(), org.id, outsider, db) == []

    @pytest.mark.asyncio
    async def test_board_member_outside_the_group_still_reads(self, db, org, admin_user, regular_user):
        board = await _board(db, org, admin_user)
        await _link_group(db, org, board)
        await _member(db, board, regular_user)
        assert (await get_board(_req(), board.board_uuid, regular_user, db)).board_uuid == board.board_uuid


class TestPublicBoard:
    @pytest.mark.asyncio
    async def test_public_board_is_read_only_across_orgs(
        self, db, org, other_org, admin_user, anonymous_user, user_role
    ):
        board = await _board(db, org, admin_user, public=True)
        org_user = await _user(db, 15, org.id, user_role.id)
        foreign = await _user(db, 16, other_org.id, user_role.id)

        assert (await get_board(_req(), board.board_uuid, anonymous_user, db)).public is True
        assert (await get_board(_req(), board.board_uuid, org_user, db)).public is True
        assert [b.board_uuid for b in await get_boards_by_org(_req(), org.id, org_user, db)] == [board.board_uuid]
        # A foreign user joins the collab session read-only and cannot write
        assert (await check_board_membership(_req(), board.board_uuid, foreign, db)).role == "viewer"
        await _denied(update_board(_req(), board.board_uuid, BoardUpdate(name="x"), foreign, db))
        members = await get_board_members(_req(), board.board_uuid, foreign, db)
        assert all(m.email is None for m in members)


class TestOwnerGrants:
    @pytest.mark.asyncio
    async def test_manager_cannot_grant_owner(self, db, org, admin_user, manager_role, user_role):
        board = await _board(db, org, admin_user)
        manager = await _user(db, 17, org.id, manager_role.id)
        target = await _user(db, 18, org.id, user_role.id)

        err = await _denied(add_board_member(
            _req(), board.board_uuid, BoardMemberCreate(user_id=target.id, role="owner"), manager, db,
        ))
        assert "owner" in err.detail
        await _denied(add_board_members_batch(
            _req(), board.board_uuid,
            BoardMemberBatchCreate(members=[BoardMemberCreate(user_id=target.id, role="owner")]),
            manager, db,
        ))
        # Other roles are still the manager's to grant
        added = await add_board_member(
            _req(), board.board_uuid, BoardMemberCreate(user_id=target.id, role="editor"), manager, db,
        )
        assert added.role == "editor"

    @pytest.mark.asyncio
    async def test_owner_and_admin_can_grant_owner(self, db, org, admin_user, user_role):
        owner = await _user(db, 19, org.id, user_role.id)
        board = await _board(db, org, owner)
        first = await _user(db, 20, org.id, user_role.id)
        second = await _user(db, 21, org.id, user_role.id)

        by_owner = await add_board_member(
            _req(), board.board_uuid, BoardMemberCreate(user_id=first.id, role="owner"), owner, db,
        )
        by_admin = await add_board_members_batch(
            _req(), board.board_uuid,
            BoardMemberBatchCreate(members=[BoardMemberCreate(user_id=second.id, role="owner")]),
            admin_user, db,
        )
        assert by_owner.role == "owner"
        assert [m.role for m in by_admin] == ["owner"]

    @pytest.mark.asyncio
    async def test_api_token_cannot_grant_or_remove_owner(self, db, org, admin_user, user_role):
        board = await _board(db, org, admin_user)
        target = await _user(db, 22, org.id, user_role.id)
        token = APITokenUser(
            id=999, org_id=org.id, created_by_user_id=admin_user.id,
            rights={"boards": {"action_read": True, "action_update": True}},
        )
        await _denied(add_board_member(
            _req(), board.board_uuid, BoardMemberCreate(user_id=target.id, role="owner"), token, db,
        ))
        await _denied(remove_board_member(_req(), board.board_uuid, admin_user.id, token, db), 400)


class TestOwnerRemoval:
    @pytest.mark.asyncio
    async def test_admin_removes_owner_manager_cannot(self, db, org, admin_user, manager_role, user_role):
        owner = await _user(db, 23, org.id, user_role.id)
        board = await _board(db, org, owner)
        manager = await _user(db, 24, org.id, manager_role.id)

        await _denied(remove_board_member(_req(), board.board_uuid, owner.id, manager, db), 400)
        await _denied(remove_board_member(_req(), board.board_uuid, owner.id, owner, db), 400)
        assert await remove_board_member(_req(), board.board_uuid, owner.id, admin_user, db) == {
            "detail": "Member removed"
        }

    @pytest.mark.asyncio
    async def test_admin_cannot_remove_own_owner_row(self, db, org, admin_user):
        board = await _board(db, org, admin_user)
        await _denied(remove_board_member(_req(), board.board_uuid, admin_user.id, admin_user, db), 400)
