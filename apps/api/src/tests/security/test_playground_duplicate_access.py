"""Duplicating a playground must not hand out content the caller cannot read.

The copy carries the source's html_content, so duplicate_playground applies the
same access-type and draft rules as get_playground on top of the create right.
"""

from datetime import datetime

import pytest
from fastapi import HTTPException

from src.db.playgrounds import Playground, PlaygroundAccessType
from src.db.roles import Role, RoleTypeEnum
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User
from src.services.playgrounds.playgrounds import (
    add_usergroup_to_playground,
    duplicate_playground,
)
from src.tests.conftest import USER_RIGHTS, _full_permission_with_own

SECRET = "<p>owner-only marker</p>"


@pytest.fixture
async def instructor(db, org):
    """A non-admin member whose role may create playgrounds."""
    rights = USER_RIGHTS.model_copy(update={"playgrounds": _full_permission_with_own()})
    role = Role(
        id=5,
        name="Instructor",
        org_id=org.id,
        role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_instructor",
        rights=rights.model_dump(),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(role)
    u = User(
        id=7,
        username="instructor",
        first_name="In",
        last_name="Structor",
        email="instructor@test.com",
        password="hashed_password",
        user_uuid="user_instructor",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(u)
    await db.commit()
    db.add(UserOrganization(
        user_id=u.id,
        org_id=org.id,
        role_id=role.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    ))
    await db.commit()
    return PublicUser(
        id=u.id,
        username=u.username,
        first_name=u.first_name,
        last_name=u.last_name,
        email=u.email,
        user_uuid=u.user_uuid,
    )


async def _playground(db, org, owner_id, uuid, access_type, published):
    pg = Playground(
        org_id=org.id,
        name="Source",
        description="",
        thumbnail_image="",
        access_type=access_type,
        published=published,
        html_content=SECRET,
        playground_uuid=uuid,
        created_by=owner_id,
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    db.add(pg)
    await db.commit()
    await db.refresh(pg)
    return pg


async def _usergroup(db, org_id, uuid, ug_id):
    ug = UserGroup(
        id=ug_id,
        org_id=org_id,
        name="Group",
        description="",
        usergroup_uuid=uuid,
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    db.add(ug)
    await db.commit()
    await db.refresh(ug)
    return ug


@pytest.mark.asyncio
async def test_restricted_playground_cannot_be_duplicated_by_outsider(
    db, org, admin_user, instructor, mock_request
):
    pg = await _playground(
        db, org, admin_user.id, "pg_restricted", PlaygroundAccessType.RESTRICTED, True
    )
    ug = await _usergroup(db, org.id, "ug_restricted", 50)
    db.add(UserGroupResource(usergroup_id=ug.id, resource_uuid=pg.playground_uuid, org_id=org.id))
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await duplicate_playground(mock_request, pg.playground_uuid, instructor, db)
    assert exc.value.status_code == 403

    # Once the instructor is in the linked group, the source is readable and
    # duplication works as before.
    db.add(UserGroupUser(usergroup_id=ug.id, user_id=instructor.id, org_id=org.id))
    await db.commit()
    copy = await duplicate_playground(mock_request, pg.playground_uuid, instructor, db)
    assert copy.html_content == SECRET
    assert copy.created_by == instructor.id


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "access_type",
    [
        PlaygroundAccessType.PUBLIC,
        PlaygroundAccessType.AUTHENTICATED,
        PlaygroundAccessType.RESTRICTED,
    ],
)
async def test_draft_playground_cannot_be_duplicated_by_non_owner(
    db, org, admin_user, instructor, mock_request, access_type
):
    pg = await _playground(db, org, admin_user.id, "pg_draft", access_type, False)

    with pytest.raises(HTTPException) as exc:
        await duplicate_playground(mock_request, pg.playground_uuid, instructor, db)
    assert exc.value.status_code in (403, 404)


@pytest.mark.asyncio
async def test_owner_and_admin_can_still_duplicate_drafts(
    db, org, admin_user, instructor, mock_request
):
    own = await _playground(
        db, org, instructor.id, "pg_own", PlaygroundAccessType.RESTRICTED, False
    )
    other = await _playground(
        db, org, instructor.id, "pg_admin", PlaygroundAccessType.RESTRICTED, False
    )

    assert (await duplicate_playground(mock_request, own.playground_uuid, instructor, db)).html_content == SECRET
    assert (await duplicate_playground(mock_request, other.playground_uuid, admin_user, db)).html_content == SECRET


@pytest.mark.asyncio
async def test_published_playground_still_duplicable_by_creator_role(
    db, org, admin_user, instructor, mock_request
):
    pg = await _playground(
        db, org, admin_user.id, "pg_published", PlaygroundAccessType.AUTHENTICATED, True
    )
    copy = await duplicate_playground(mock_request, pg.playground_uuid, instructor, db)
    assert copy.published is False


@pytest.mark.asyncio
async def test_usergroup_from_another_org_cannot_be_linked(
    db, org, other_org, admin_user, mock_request
):
    pg = await _playground(
        db, org, admin_user.id, "pg_link", PlaygroundAccessType.RESTRICTED, True
    )
    foreign = await _usergroup(db, other_org.id, "ug_foreign", 60)

    with pytest.raises(HTTPException) as exc:
        await add_usergroup_to_playground(
            mock_request, pg.playground_uuid, foreign.usergroup_uuid, admin_user, db
        )
    assert exc.value.status_code == 404
