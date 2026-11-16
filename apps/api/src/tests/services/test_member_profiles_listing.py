"""People data on the members list: profile columns and filters
(src/services/orgs/member_profiles.py, get_organization_users)."""

from datetime import datetime
from unittest.mock import patch

from src.db.org_member_profile import OrgMemberProfile
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.services.orgs.member_profiles import profiles_for, report_user_ids
from src.services.orgs.users import get_organization_users


async def _member(db, org, uid, name, role_id):
    db.add(User(id=uid, username=name, first_name=name.title(), last_name="T", email=f"{name}@t.test", password="x",
                user_uuid=f"user_{name}", creation_date=str(datetime.now()), update_date=str(datetime.now())))
    await db.commit()
    db.add(UserOrganization(user_id=uid, org_id=org.id, role_id=role_id, creation_date="", update_date=""))
    await db.commit()


async def _team(db, org, admin_user, user_role):
    # admin(1) > mgr(10) > dev(11) > intern(12); ops(13) has no profile.
    for uid, name in ((10, "mgr"), (11, "dev"), (12, "intern"), (13, "ops")):
        await _member(db, org, uid, name, user_role.id)
    db.add_all([
        OrgMemberProfile(org_id=org.id, user_id=10, manager_user_id=1, department="Engineering", title="Lead"),
        OrgMemberProfile(org_id=org.id, user_id=11, manager_user_id=10, department="engineering", title="Dev"),
        OrgMemberProfile(org_id=org.id, user_id=12, manager_user_id=11, department="Sales", employee_id="E12"),
    ])
    await db.commit()


async def _list(db, org, admin_user, mock_request, **filters):
    with patch("src.security.org_auth.is_org_admin", return_value=True):
        result = await get_organization_users(mock_request, org.id, db, admin_user, limit=50, **filters)
    return {item.user.id: item for item in result["items"]}, result["total"]


async def test_profile_columns_and_filters(db, org, admin_user, user_role, mock_request):
    await _team(db, org, admin_user, user_role)
    items, total = await _list(db, org, admin_user, mock_request)
    assert total == 5
    assert items[11].profile["department"] == "engineering" and items[11].profile["manager"]["id"] == 10
    assert items[12].profile["employee_id"] == "E12" and items[13].profile is None

    items, total = await _list(db, org, admin_user, mock_request, department="ENGINEERING ")
    assert set(items) == {10, 11} and total == 2
    items, _ = await _list(db, org, admin_user, mock_request, manager_id=10)
    assert set(items) == {11, 12}
    items, _ = await _list(db, org, admin_user, mock_request, no_manager=True)
    assert set(items) == {1, 13}  # the admin has no profile either
    # The caller (admin, id 1) sees their whole reporting line.
    items, _ = await _list(db, org, admin_user, mock_request, my_reports=True)
    assert set(items) == {10, 11, 12}
    items, total = await _list(db, org, admin_user, mock_request, manager_id=13)
    assert items == {} and total == 0


async def test_helpers(db, org, admin_user, user_role):
    await _team(db, org, admin_user, user_role)
    assert await report_user_ids(db, org.id, 11) == {12}
    # A bad loop (admin reporting to the intern) never hangs the walk.
    db.add(OrgMemberProfile(org_id=org.id, user_id=1, manager_user_id=12))
    await db.commit()
    assert await report_user_ids(db, org.id, 11) == {12, 1, 10}
    assert await profiles_for(db, org.id, []) == {}
    out = await profiles_for(db, org.id, [13, 12])
    assert set(out) == {12} and out[12]["manager"]["username"] == "dev"


async def test_router_passes_people_filters(db):
    from unittest.mock import AsyncMock

    from src.routers.orgs.orgs import api_get_org_users

    with patch("src.routers.orgs.orgs.get_organization_users", new_callable=AsyncMock, return_value={"items": []}) as fn:
        await api_get_org_users(request=None, org_id=1, page=1, limit=20, search="", usergroup_id=None,
                                usergroup_filter=None, sort_order="desc", role_id=None, status=None,
                                department="Sales", manager_id=4, no_manager=True, my_reports=True,
                                attribute=[], current_user=None, db_session=db)
    assert fn.call_args.kwargs == {"department": "Sales", "manager_id": 4, "no_manager": True, "my_reports": True,
                                   "attributes": {}}
