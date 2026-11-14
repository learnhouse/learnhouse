"""/api/v1/onboarding: one-step org creation (goal, address default and
collisions), the checklist, events, the plan picker, the hub and invitations,
with permissions and rate limits."""

import json
from contextlib import contextmanager
from datetime import datetime
from unittest.mock import AsyncMock, patch

import fakeredis
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.org_onboarding import OrgOnboarding
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.users import User
from src.routers.onboarding import router as onboarding_router
from src.security.auth import get_current_user

BASE = "/api/v1/onboarding"


@contextmanager
def saas():
    with patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"), patch(
        "src.security.features_utils.resolve.get_deployment_mode", return_value="saas"
    ), patch("src.routers.onboarding.deployment_mode.get_deployment_mode", return_value="saas"):
        yield


@pytest.fixture
def fake_redis():
    r = fakeredis.FakeRedis()
    with patch("src.core.redis.get_redis_client", return_value=r), patch(
        "src.services.security.rate_limiting.get_redis_connection", return_value=r
    ):
        yield r


@pytest.fixture
def make_app(db, fake_redis):
    def build(user):
        app = FastAPI()
        app.include_router(onboarding_router, prefix=BASE)
        app.dependency_overrides[get_db_session] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: user
        return app

    return build


async def call(app, method: str, path: str, **kw):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.request(method, BASE + path, **kw)


@contextmanager
def org_creation():
    with patch("src.services.orgs.orgs.is_multi_org_allowed", return_value=True), patch(
        "src.routers.users._invalidate_session_cache"
    ), patch("src.services.orgs.orgs._try_send_org_created", new=AsyncMock()), patch(
        "src.services.orgs.orgs._try_record_org_admin_in_loops"
    ):
        yield


class TestCreateOrg:
    async def test_creates_with_default_address_and_goal(self, make_app, admin_user, db):
        with org_creation():
            res = await call(make_app(admin_user), "POST", "/orgs", json={"name": "  Brightwater Academy ", "goal": "sell"})
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["org"]["slug"] == "brightwater-academy"
        assert body["onboarding"]["goal"] == "sell"
        # Payments isn't in this edition's plan, so the step is left out (never locked).
        assert [s["id"] for s in body["onboarding"]["steps"]] == ["create_course", "add_content", "brand_school", "publish_course", "share_grow"]
        row = (await db.execute(select(OrgOnboarding).where(OrgOnboarding.org_id == body["org"]["id"]))).scalars().first()
        assert {"org_created", "goal_selected"} <= set(row.milestones)

    async def test_default_address_avoids_a_collision(self, make_app, admin_user, org):
        with org_creation():
            res = await call(make_app(admin_user), "POST", "/orgs", json={"name": "Test Org"})
        assert res.status_code == 200
        assert res.json()["org"]["slug"] == "test-org-2"
        assert res.json()["onboarding"]["goal"] is None

    async def test_chosen_address(self, make_app, admin_user):
        with org_creation():
            res = await call(make_app(admin_user), "POST", "/orgs", json={"name": "X", "slug": "Harbor"})
        assert res.json()["org"]["slug"] == "harbor"

    async def test_taken_and_reserved_addresses_return_a_suggestion(self, make_app, admin_user, org):
        app = make_app(admin_user)
        res = await call(app, "POST", "/orgs", json={"name": "X", "slug": "test-org"})
        assert res.status_code == 409
        assert res.json()["detail"] == {"code": "SLUG_TAKEN", "message": "This address is not available", "suggestion": "test-org-2"}
        res = await call(app, "POST", "/orgs", json={"name": "X", "slug": "admin"})
        assert res.status_code == 409 and res.json()["detail"]["code"] == "SLUG_RESERVED"
        res = await call(app, "POST", "/orgs", json={"name": "X", "slug": "bad slug!"})
        assert res.status_code == 400 and res.json()["detail"]["code"] == "SLUG_INVALID"

    async def test_blank_name_and_unknown_goal(self, make_app, admin_user):
        app = make_app(admin_user)
        assert (await call(app, "POST", "/orgs", json={"name": "   "})).status_code == 400
        assert (await call(app, "POST", "/orgs", json={"name": "A", "goal": "nope"})).status_code == 422

    async def test_rate_limited(self, make_app, admin_user, fake_redis):
        fake_redis.set(f"rate_limit:onboarding:create:{admin_user.id}", 10, ex=60)
        res = await call(make_app(admin_user), "POST", "/orgs", json={"name": "A"})
        assert res.status_code == 429 and res.headers["Retry-After"]

    async def test_rate_limit_fails_open_without_redis(self, make_app, admin_user):
        with patch("src.services.security.rate_limiting.get_redis_connection", side_effect=RuntimeError("down")):
            res = await call(make_app(admin_user), "GET", "/slug?name=Acme")
        assert res.status_code == 200 and res.json()["slug"] == "acme"


class TestSlug:
    async def test_check(self, make_app, admin_user, org):
        res = await call(make_app(admin_user), "GET", "/slug?name=x&slug=test-org")
        assert res.json() == {"slug": "test-org", "available": False, "reason": "taken", "suggestion": "test-org-2"}


class TestChecklist:
    async def test_admin_reads_updates_and_records(self, make_app, admin_user, org):
        app = make_app(admin_user)
        res = await call(app, "GET", f"/orgs/{org.id}")
        assert res.status_code == 200 and res.json()["goal"] is None and res.json()["total"] == 6
        res = await call(app, "PATCH", f"/orgs/{org.id}", json={"goal": "community", "skip": "create_course", "welcome_seen": True})
        assert res.status_code == 200
        body = res.json()
        assert body["goal"] == "community" and body["welcome_seen"]
        assert {s["id"]: s for s in body["steps"]}["create_course"]["skipped"]
        res = await call(app, "POST", f"/orgs/{org.id}/events", json={"event": "share_grow"})
        assert res.json() == {"event": "share_grow", "first": True}
        assert (await call(app, "POST", f"/orgs/{org.id}/events", json={"event": "bogus"})).status_code == 400
        assert (await call(app, "PATCH", f"/orgs/{org.id}", json={"skip": "bogus"})).status_code == 400

    async def test_learner_and_other_admins_are_denied(self, make_app, regular_user, admin_user, org, other_org):
        assert (await call(make_app(regular_user), "GET", f"/orgs/{org.id}")).status_code == 403
        assert (await call(make_app(admin_user), "GET", f"/orgs/{other_org.id}")).status_code == 403
        assert (await call(make_app(regular_user), "GET", f"/orgs/{org.id}/plans")).status_code == 403

    async def test_starter(self, make_app, admin_user, org, db):
        db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "plan": "free"}, creation_date=str(datetime.now()), update_date=str(datetime.now())))
        await db.commit()
        with patch("src.services.onboarding.starter.apply_website_template", new=AsyncMock(return_value="lp_1")):
            res = await call(make_app(admin_user), "POST", f"/orgs/{org.id}/starter", json={})
        assert res.status_code == 200 and res.json()["page_uuid"] == "lp_1" and res.json()["course_uuid"]
        res = await call(make_app(admin_user), "POST", f"/orgs/{org.id}/starter", json={"website": False})
        assert res.status_code == 409


class TestPlanPicker:
    async def test_saas_only(self, make_app, admin_user, org, db):
        assert (await call(make_app(admin_user), "GET", f"/orgs/{org.id}/plans")).status_code == 404
        db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "plan": "free"}, creation_date=str(datetime.now()), update_date=str(datetime.now())))
        await db.commit()
        with saas():
            await call(make_app(admin_user), "PATCH", f"/orgs/{org.id}", json={"goal": "team"})
            res = await call(make_app(admin_user), "GET", f"/orgs/{org.id}/plans")
        assert res.status_code == 200
        body = res.json()
        assert body["current_plan"] == "free" and body["recommended_plan"] == "pro" and body["can_continue_free"]


class TestGoalsAndHub:
    async def test_goals(self, make_app, admin_user):
        res = await call(make_app(admin_user), "GET", "/goals")
        assert [g["id"] for g in res.json()["goals"]] == ["sell", "team", "school", "customers", "community"]

    async def test_hub(self, make_app, admin_user, org):
        res = await call(make_app(admin_user), "GET", "/hub")
        assert res.status_code == 200 and res.json()["orgs"][0]["role"] == "admin"


class TestInvites:
    async def test_list_accept_decline(self, make_app, db, other_org, fake_redis, mock_request):
        u = User(id=10, username="n", first_name="N", last_name="Q", email="n@x.com", password="x", user_uuid="user_n", email_verified=True, creation_date=str(datetime.now()), update_date=str(datetime.now()))
        third = Organization(id=3, name="Third", slug="third", email="a@b.c", org_uuid="org_third", creation_date=str(datetime.now()), update_date=str(datetime.now()))
        db.add_all([u, third])
        db.add(OrganizationConfig(org_id=other_org.id, config={"config_version": "2.0", "plan": "standard"}, creation_date=str(datetime.now()), update_date=str(datetime.now())))
        await db.commit()
        from src.db.users import PublicUser

        me = PublicUser(id=10, username="n", first_name="N", last_name="Q", email="n@x.com", user_uuid="user_n")
        for uuid in ("org_other", "org_third"):
            fake_redis.set(f"invited_user:n@x.com:org:{uuid}", json.dumps({"pending": True, "created_at": "2026-11-01"}))
        app = make_app(me)
        res = await call(app, "GET", "/invites")
        assert {i["slug"] for i in res.json()} == {"other-org", "third"}
        with patch("src.routers.users._invalidate_session_cache"), patch(
            "src.services.orgs.join_notifications.notify_user_joined_org", new=AsyncMock()
        ):
            res = await call(app, "POST", "/invites/org_other/accept")
        assert res.status_code == 200 and res.json()["slug"] == "other-org"
        res = await call(app, "POST", "/invites/org_third/decline")
        assert res.json() == {"org_id": 3, "declined": True}
        assert (await call(app, "GET", "/invites")).json() == []
        assert (await call(app, "POST", "/invites/org_third/accept")).status_code == 404

    async def test_unverified_user_gets_nothing(self, make_app, db, other_org, fake_redis):
        from src.db.users import PublicUser

        db.add(User(id=11, username="m", first_name="M", last_name="Q", email="m@x.com", password="x", user_uuid="user_m", email_verified=False, creation_date=str(datetime.now()), update_date=str(datetime.now())))
        await db.commit()
        fake_redis.set("invited_user:m@x.com:org:org_other", json.dumps({"pending": True}))
        app = make_app(PublicUser(id=11, username="m", first_name="M", last_name="Q", email="m@x.com", user_uuid="user_m"))
        assert (await call(app, "GET", "/invites")).json() == []
        hub = (await call(app, "GET", "/hub")).json()
        assert hub["email_verified"] is False and hub["invites"] == []
        assert (await call(app, "POST", "/invites/org_other/decline")).status_code == 403
        assert (await call(app, "POST", "/invites/org_other/accept")).status_code == 403
        assert fake_redis.get("invited_user:m@x.com:org:org_other") is not None
