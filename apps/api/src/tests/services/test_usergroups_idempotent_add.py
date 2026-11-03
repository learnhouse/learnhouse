"""Adding something a usergroup already has is a no-op, not an error.

The admin UI re-sends links that already exist; each one used to log an error
that Sentry filed as an issue.
"""

import logging
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import select

from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.services.users.usergroups import (
    add_resources_to_usergroup,
    add_users_to_usergroup,
)


@pytest.fixture
async def usergroup(db, org):
    group = UserGroup(
        name="Cohort",
        description="",
        org_id=org.id,
        usergroup_uuid="usergroup_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group


@pytest.fixture(autouse=True)
def _no_side_effects():
    with patch(
        "src.services.users.usergroups.rbac_check", new_callable=AsyncMock
    ), patch(
        "src.services.users.usergroups.dispatch_webhooks", new_callable=AsyncMock
    ):
        yield


async def test_adding_a_linked_resource_again_is_a_no_op(
    db, org, course, usergroup, admin_user, mock_request, caplog
):
    for _ in range(2):
        with caplog.at_level(logging.INFO):
            result = await add_resources_to_usergroup(
                mock_request, db, admin_user, usergroup.id, course.course_uuid
            )
        assert result == "Resources added to UserGroup successfully"

    links = (await db.execute(
        select(UserGroupResource).where(UserGroupResource.usergroup_id == usergroup.id)
    )).scalars().all()
    assert len(links) == 1
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert any("already exists in UserGroup" in r.getMessage() for r in caplog.records)


async def test_adding_a_member_again_is_a_no_op(
    db, org, usergroup, admin_user, mock_request, caplog
):
    for _ in range(2):
        with caplog.at_level(logging.INFO):
            await add_users_to_usergroup(
                mock_request, db, admin_user, usergroup.id, str(admin_user.id)
            )

    members = (await db.execute(
        select(UserGroupUser).where(UserGroupUser.usergroup_id == usergroup.id)
    )).scalars().all()
    assert len(members) == 1
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert any("already exists in UserGroup" in r.getMessage() for r in caplog.records)
