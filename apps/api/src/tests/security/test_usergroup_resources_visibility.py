"""Usergroup resource listings only reveal what the caller could open.

Learners hold usergroups read (the catalog filters courses by group), so the
listing must not expose links to restricted or draft resources to them.
"""

from datetime import datetime

import pytest

from src.db.courses.courses import Course
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroups import UserGroup
from src.services.users.usergroups import get_resources_by_usergroup

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def group_with_courses(db, org, course):
    now = str(datetime.now())
    draft = Course(
        id=31, name="Draft", description="", public=False, published=False,
        open_to_contributors=False, org_id=org.id, course_uuid="course_draft_ug",
        creation_date=now, update_date=now,
    )
    db.add(draft)
    group = UserGroup(
        id=40, org_id=org.id, name="Group", description="",
        usergroup_uuid="usergroup_vis", creation_date=now, update_date=now,
    )
    db.add(group)
    await db.commit()
    for uuid in (course.course_uuid, draft.course_uuid):
        db.add(UserGroupResource(usergroup_id=group.id, resource_uuid=uuid, org_id=org.id))
    await db.commit()
    return group, course, draft


async def test_learner_sees_only_readable_resources(
    db, regular_user, group_with_courses, mock_request
):
    group, course, draft = group_with_courses
    uuids = await get_resources_by_usergroup(mock_request, db, regular_user, group.id)
    assert uuids == [course.course_uuid]


async def test_manager_sees_every_linked_resource(
    db, admin_user, group_with_courses, mock_request
):
    group, course, draft = group_with_courses
    uuids = await get_resources_by_usergroup(mock_request, db, admin_user, group.id)
    assert sorted(uuids) == sorted([course.course_uuid, draft.course_uuid])
