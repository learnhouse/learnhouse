"""Signup fields saved to people data, the core side: the mapping is
validated when the fields are saved, signup and the completion endpoint hand
the answers to EE, and the members list shows and filters custom attributes.
(The copying itself is EE: ee/tests/test_signup_people_mapping.py.)"""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core import ee_hooks
from src.core.events.database import get_db_session
from src.db.org_member_profile import OrgMemberProfile
from src.db.organization_config import OrganizationConfig
from src.db.user_organizations import UserOrganization
from src.db.users import User, UserCreate
from src.routers.orgs.orgs import router as orgs_router
from src.security.auth import get_authenticated_user, get_current_user
from src.security.features_utils.dependencies import require_org_admin
from src.services.orgs.member_profiles import parse_attribute_filters, profiles_for
from src.services.users.users import create_user
from src.tests.services.test_member_profiles_listing import _list
from src.tests.services.test_signup_custom_fields_flow import _set_signup_fields, _signup_patches

ON = {"enabled": True, "available": True}


@pytest.fixture
async def client(db, org, admin_user):
    db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0"},
                              creation_date=str(datetime.now()), update_date=str(datetime.now())))
    await db.commit()
    app = FastAPI()
    app.include_router(orgs_router, prefix="/api/v1/orgs")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    app.dependency_overrides[get_authenticated_user] = lambda: admin_user
    app.dependency_overrides[require_org_admin] = lambda: True
    with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c


async def _save(client, org, fields, feature=ON):
    with patch("src.security.features_utils.resolve.resolve_feature", return_value=feature):
        return await client.put(f"/api/v1/orgs/{org.id}/config/signup-fields", json={"fields": fields})


def field(key, people_field, type_="text", **kw):
    return {"key": key, "label": key.title(), "type": type_, "people_field": people_field, **kw}


class TestMappingSave:
    async def test_saved_with_the_fields(self, client, db, org):
        r = await _save(client, org, [
            field("team", "department", "select", options=["A"]), field("boss", "manager_email"),
            field("shirt", "attribute", "select", options=["S"]), field("ok", "attribute", "checkbox"),
            field("notes", None),
        ])
        assert r.status_code == 200
        row = (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org.id))).scalars().first()
        stored = {f["key"]: f["people_field"] for f in row.config["customization"]["signup_fields"]["fields"]}
        assert stored == {"team": "department", "boss": "manager_email", "shirt": "attribute", "ok": "attribute",
                          "notes": None}

    async def test_needs_the_people_data_feature(self, client, org):
        r = await _save(client, org, [field("team", "department")], feature={"enabled": False})
        assert r.status_code == 403
        # Without a mapping the feature does not matter.
        assert (await _save(client, org, [field("team", None)], feature={"enabled": False})).status_code == 200

    async def test_one_field_per_column_and_a_fitting_type(self, client, org):
        twice = await _save(client, org, [field("a", "department"), field("b", "department")])
        assert twice.status_code == 400 and "Only one" in twice.json()["detail"]
        assert (await _save(client, org, [field("a", "manager_email", "select", options=["x"])])).status_code == 400
        assert (await _save(client, org, [field("a", "title", "checkbox")])).status_code == 400
        assert (await _save(client, org, [field("a", "title", "date")])).status_code == 400


class TestSignupHandsAnswersToEE:
    async def test_create_user_calls_the_hook_with_answers(self, mock_request, db, admin_user, org):
        await _set_signup_fields(db, org, [field("team", "department")])
        with _signup_patches(), patch("src.core.ee_hooks.sync_ee_signup_answers", new_callable=AsyncMock) as hook:
            created = await create_user(mock_request, db, admin_user, UserCreate(
                username="mapped", first_name="M", last_name="U", email="mapped@test.com",
                password="Password123!", custom_fields={"team": "Sales"}), org.id)
            assert hook.await_args.args == (org.id, created.id, db)
            hook.reset_mock()
            await create_user(mock_request, db, admin_user, UserCreate(
                username="unanswered", first_name="M", last_name="U", email="unanswered@test.com",
                password="Password123!"), org.id)
            hook.assert_not_awaited()

    async def test_completion_calls_the_hook(self, db, org, admin_user):
        await _set_signup_fields(db, org, [field("team", "department")])
        from src.services.orgs.signup_fields import complete_signup_fields_for_user

        with patch("src.core.ee_hooks.sync_ee_signup_answers", new_callable=AsyncMock) as hook:
            await complete_signup_fields_for_user(org.id, admin_user.id, {"team": "Sales"}, db)
        assert hook.await_args.args == (org.id, admin_user.id, db)


class TestCoreHook:
    async def test_without_ee_does_nothing(self):
        with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
            assert await ee_hooks.sync_ee_signup_answers(1, 2, None) is None

    async def test_returns_what_ee_did(self):
        hooks = MagicMock()
        hooks.on_signup_answers = AsyncMock(return_value={"changed": ["department"]})
        with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks):
            assert await ee_hooks.sync_ee_signup_answers(1, 2, "db", actor="a") == {"changed": ["department"]}
        hooks.on_signup_answers.assert_awaited_once_with(1, 2, "db", actor="a", request=None)

    async def test_never_raises(self):
        hooks = MagicMock()
        hooks.on_signup_answers = AsyncMock(side_effect=RuntimeError("boom"))
        with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks):
            assert await ee_hooks.sync_ee_signup_answers(1, 2, None) is None


class TestMembersList:
    async def _people(self, db, org, user_role):
        for uid, shirt in ((20, "L"), (21, "M"), (22, None)):
            db.add(User(id=uid, username=f"u{uid}", first_name="U", last_name=str(uid), email=f"u{uid}@t.test",
                        password="x", user_uuid=f"user_{uid}", creation_date="", update_date=""))
            await db.commit()
            db.add(UserOrganization(user_id=uid, org_id=org.id, role_id=user_role.id, creation_date="", update_date=""))
            if shirt:
                db.add(OrgMemberProfile(org_id=org.id, user_id=uid, location="Paris", cost_center="CC",
                                        source="signup", attributes={"shirt": shirt}))
            await db.commit()

    async def test_attribute_columns_and_filter(self, db, org, admin_user, user_role, mock_request):
        await self._people(db, org, user_role)
        items, total = await _list(db, org, admin_user, mock_request, attributes={"shirt": "L"})
        assert set(items) == {20} and total == 1
        assert items[20].profile["attributes"] == {"shirt": "L"} and items[20].profile["location"] == "Paris"
        items, _ = await _list(db, org, admin_user, mock_request, attributes={"shirt": "XL"})
        assert items == {}
        out = await profiles_for(db, org.id, [21])
        assert out[21]["cost_center"] == "CC"

    def test_parse_attribute_filters(self):
        assert parse_attribute_filters(["shirt=L", "bad", "=x", " team = A=B"]) == {"shirt": "L", "team": " A=B"}
        assert parse_attribute_filters([]) == {}

    async def test_router_passes_attribute_filters(self, db):
        from src.routers.orgs.orgs import api_get_org_users

        with patch("src.routers.orgs.orgs.get_organization_users", new_callable=AsyncMock,
                   return_value={"items": []}) as fn:
            await api_get_org_users(request=None, org_id=1, page=1, limit=20, search="", usergroup_id=None,
                                    usergroup_filter=None, sort_order="desc", role_id=None, status=None,
                                    department=None, manager_id=None, no_manager=False, my_reports=False,
                                    attribute=["shirt=L"], current_user=None, db_session=db)
        assert fn.call_args.kwargs["attributes"] == {"shirt": "L"}


class TestManagerEmailAnswers:
    def test_a_manager_field_takes_an_email_not_a_link(self):
        from fastapi import HTTPException

        from src.db.organization_config import SignupFieldItem
        from src.services.orgs.signup_fields import validate_signup_field_values

        boss = SignupFieldItem(key="boss", label="Boss", type="text", people_field="manager_email")
        note = SignupFieldItem(key="note", label="Note", type="text")
        assert validate_signup_field_values([boss], {"boss": " Ann@Acme.test "}) == {"boss": "Ann@Acme.test"}
        for bad in ("not an email", "http://evil.test/@x", "a@b", "a b@acme.test", "x" * 250 + "@acme.test"):
            with pytest.raises(HTTPException):
                validate_signup_field_values([boss], {"boss": bad})
        # Other text fields still refuse anything that looks like a link.
        with pytest.raises(HTTPException):
            validate_signup_field_values([note], {"note": "ann@example.com"})
