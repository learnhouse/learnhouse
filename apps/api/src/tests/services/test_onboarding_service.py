"""Onboarding services: goals, addresses, the server-side checklist, starter
content, pending invitations, the hub summary, the plan picker and the funnel."""

import json
from contextlib import contextmanager
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import fakeredis
import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.communities.communities import Community
from src.db.courses.courses import Course
from src.db.org_onboarding import OrgOnboarding
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.usergroups import UserGroup
from src.db.users import User
from src.security.features_utils.plans import FEATURE_PLAN_REQUIREMENTS, PLAN_HIERARCHY
from src.services.onboarding import funnel, goals, hub, invites, plans, slugs, starter, state


def _now_str(days_ago: float = 0) -> str:
    return str(datetime.now() - timedelta(days=days_ago))


@contextmanager
def saas():
    with patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"), patch(
        "src.security.features_utils.resolve.get_deployment_mode", return_value="saas"
    ):
        yield


@contextmanager
def redis(fake=None):
    fake = fake if fake is not None else fakeredis.FakeRedis()
    with patch("src.core.redis.get_redis_client", return_value=fake):
        yield fake


async def set_plan(db, org_id: int, plan: str):
    db.add(OrganizationConfig(org_id=org_id, config={"config_version": "2.0", "plan": plan}, creation_date=_now_str(), update_date=_now_str()))
    await db.commit()


async def add_user(db, uid: int, email: str, *, verified=True, created=None) -> User:
    u = User(
        id=uid, username=f"u{uid}", first_name="F", last_name="L", email=email, password="x",
        user_uuid=f"user_{uid}", email_verified=verified, creation_date=created or _now_str(), update_date=_now_str(),
    )
    db.add(u)
    await db.commit()
    return u


async def add_member(db, org_id: int, user_id: int, role_id: int = 4):
    db.add(UserOrganization(user_id=user_id, org_id=org_id, role_id=role_id, creation_date=_now_str(), update_date=_now_str()))
    await db.commit()


# ── goals ────────────────────────────────────────────────────────────────


class TestGoals:
    def test_every_goal_has_known_steps_and_template(self):
        from src.services.landing import templates

        for g in goals.GOAL_IDS:
            assert goals.is_goal(g)
            assert all(s in goals.STEPS for s in goals.steps_for(g))
            assert templates.has(goals.template_for(g))
        assert templates.has(goals.DEFAULT_TEMPLATE)

    def test_no_goal_falls_back(self):
        assert not goals.is_goal(None)
        assert goals.steps_for(None) == goals.DEFAULT_STEPS
        assert goals.template_for("nope") == goals.DEFAULT_TEMPLATE

    def test_recommended_plan_is_cheapest_with_every_feature(self):
        for g, spec in goals.GOALS.items():
            need = max(PLAN_HIERARCHY.index(FEATURE_PLAN_REQUIREMENTS[f]) for f in spec["features"])
            assert goals.recommended_plan(g) == PLAN_HIERARCHY[need]
        assert goals.recommended_plan(None) == FEATURE_PLAN_REQUIREMENTS["analytics"]


# ── slugs ────────────────────────────────────────────────────────────────


class TestSlugs:
    def test_slugify(self):
        assert slugs.slugify("  Café Ünïcode Academy! ") == "cafe-unicode-academy"
        assert slugs.slugify("") == ""
        assert len(slugs.slugify("a" * 80)) == slugs.MAX_SLUG_LENGTH

    def test_problems(self):
        assert slugs.slug_problem("") == "invalid"
        assert slugs.slug_problem("Bad Slug") == "invalid"
        assert slugs.slug_problem("a" * 41) == "invalid"
        assert slugs.slug_problem("admin") == "reserved"
        assert slugs.slug_problem("acme") is None

    def test_demo_slug_is_reserved_when_the_demo_runs(self):
        with patch("src.services.demo.flags.demo_enabled", return_value=True), patch(
            "src.services.demo.flags.demo_slug", return_value="demo"
        ):
            assert slugs.slug_problem("demo") == "reserved"
        assert slugs.slug_problem("demo") is None

    async def test_suggest(self, db, org):
        assert await slugs.suggest_slug("Acme", db) == "acme"
        assert await slugs.suggest_slug("Test Org", db) == "test-org-2"
        assert await slugs.suggest_slug("admin", db) == "admin-academy"
        assert await slugs.suggest_slug("!!!", db) == "academy"

    async def test_suggest_random_tail_when_all_numbered_are_taken(self, db):
        for i, s in enumerate(["busy"] + [f"busy-{n}" for n in range(2, 10)]):
            db.add(Organization(id=100 + i, name=s, slug=s, email="a@b.c", org_uuid=f"o{i}", creation_date=_now_str(), update_date=_now_str()))
        await db.commit()
        with patch("src.services.onboarding.slugs.secrets.token_hex", side_effect=["busy", "ab12"]):
            # "busy-busy" is free, so the first random tail wins.
            assert await slugs.suggest_slug("busy", db) == "busy-busy"

    async def test_random_tail_retries_when_taken(self, db):
        for i, s in enumerate(["full"] + [f"full-{n}" for n in range(2, 10)] + ["full-aaaa"]):
            db.add(Organization(id=200 + i, name=s, slug=s, email="a@b.c", org_uuid=f"p{i}", creation_date=_now_str(), update_date=_now_str()))
        await db.commit()
        with patch("src.services.onboarding.slugs.secrets.token_hex", side_effect=["aaaa", "bbbb"]):
            assert await slugs.suggest_slug("full", db) == "full-bbbb"

    async def test_check(self, db, org):
        assert await slugs.check_slug("My School", None, db) == {"slug": "my-school", "available": True, "reason": None, "suggestion": "my-school"}
        taken = await slugs.check_slug("x", "Test-Org", db)
        assert taken["available"] is False and taken["reason"] == "taken" and taken["suggestion"] == "test-org-2"
        reserved = await slugs.check_slug("x", "www", db)
        assert reserved["reason"] == "reserved" and reserved["suggestion"] == "www-academy"


# ── checklist state ──────────────────────────────────────────────────────


class TestChecklist:
    async def test_row_is_created_once_and_old_orgs_skip_the_welcome(self, db, org):
        row = await state.get_or_create(db, org)
        assert row.state == {"welcome_seen": False}
        assert (await state.get_or_create(db, org)).id == row.id
        old = Organization(id=9, name="Old", slug="old", email="a@b.c", org_uuid="org_old", creation_date=_now_str(30), update_date=_now_str())
        db.add(old)
        await db.commit()
        assert (await state.get_or_create(db, old)).state == {"welcome_seen": True}

    async def test_get_org_404(self, db):
        with pytest.raises(HTTPException) as e:
            await state.get_org(db, 999)
        assert e.value.status_code == 404

    async def test_signals_from_real_rows(self, db, org, admin_user, regular_user, activity):
        org.logo_image = "logo.png"
        db.add(org)
        db.add(Community(name="C", org_id=org.id, community_uuid="c1"))
        db.add(UserGroup(name="G", description="", org_id=org.id, usergroup_uuid="g1"))
        from src.db.landing_pages import LandingPage

        db.add(LandingPage(page_uuid="lp1", org_id=org.id, slug="", title="Home", draft={}, published={"root": {}}, published_version=1, preview_token="t", creation_date="x", update_date="x"))
        await db.commit()
        with redis():
            done = await state.data_signals(db, org)
        assert done == {"create_course", "add_content", "publish_course", "brand_school", "invite_learners", "build_community", "create_group", "share_grow"}

    async def test_pending_invite_counts_as_inviting(self, db, org, admin_user):
        with redis() as r:
            assert "invite_learners" not in await state.data_signals(db, org)
            r.set("invited_user:x@y.z:org:org_test", "{}")
            assert "invite_learners" in await state.data_signals(db, org)

    async def test_pending_invite_without_redis_or_on_error(self, db, org):
        with patch("src.core.redis.get_redis_client", return_value=None):
            assert not state._has_pending_invite(org)
        broken = SimpleNamespace(scan_iter=lambda **_: (_ for _ in ()).throw(RuntimeError("down")))
        with patch("src.core.redis.get_redis_client", return_value=broken):
            assert not state._has_pending_invite(org)

    async def test_invite_gate(self, db, org, admin_user):
        assert await state.invite_gate(db, org, None) == {"gated": False, "unlocks_at": None}
        with patch("src.services.security.account_age.is_free_tier_age_gated", new=AsyncMock(return_value=[])):
            assert (await state.invite_gate(db, org, admin_user.id))["gated"] is False
        with patch("src.services.security.account_age.is_free_tier_age_gated", new=AsyncMock(return_value=["organization"])):
            gate = await state.invite_gate(db, org, admin_user.id)
            assert gate["gated"] is True and gate["unlocks_at"]
            # Unknown user: the org's date alone decides.
            assert (await state.invite_gate(db, org, 404))["unlocks_at"]
            org.creation_date = "not a date"
            assert (await state.invite_gate(db, org, 404))["unlocks_at"] is None

    async def test_build_state_seeds_then_celebrates_new_steps(self, db, org, admin_user, course):
        with redis():
            first = await state.build_state(db, org, admin_user.id)
            assert first["celebrate"] == []  # the course existed before the checklist
            assert {s["id"]: s["done"] for s in first["steps"]}["create_course"]
            assert first["mode"] == "oss" and first["plan"] is None and first["recommended_plan"] is None
            org.logo_image = "l.png"
            db.add(org)
            await db.commit()
            again = await state.build_state(db, org, admin_user.id)
        assert again["celebrate"] == ["brand_school"]
        assert "step:brand_school" in again["milestones"]

    async def test_steps_the_plan_lacks_are_left_out(self, db, org, admin_user):
        # Onboarding never shows a plan lock: a free "sell" org simply has no
        # payments step; on Standard it is an ordinary step.
        await set_plan(db, org.id, "free")
        await state.update_state(db, org, goal="sell")
        with saas(), redis():
            view = await state.build_state(db, org, admin_user.id)
        ids = [s["id"] for s in view["steps"]]
        assert "setup_payments" not in ids and ids == ["create_course", "add_content", "brand_school", "publish_course", "share_grow"]
        assert all(set(s) == {"id", "kind", "minutes", "done", "skipped"} for s in view["steps"])
        assert view["plan"] == "free" and view["recommended_plan"] == "standard"
        for s in ids:
            await state.update_state(db, org, skip=s)
        with saas(), redis():
            view = await state.build_state(db, org, admin_user.id)
        assert view["all_done"] and view["next_step"] is None

    async def test_payments_step_on_a_plan_that_has_it(self, db, org, admin_user):
        await set_plan(db, org.id, "standard")
        await state.update_state(db, org, goal="sell")
        with saas(), redis():
            view = await state.build_state(db, org, admin_user.id)
        assert [s["id"] for s in view["steps"]][3] == "setup_payments"
        assert view["next_step"] == "create_course"

    def test_visible_steps_without_a_goal(self, org):
        assert state.visible_step_ids(None, {}, org.id) == goals.DEFAULT_STEPS

    async def test_update_state(self, db, org):
        await state.update_state(db, org, goal="team", dismissed=True, welcome_seen=True, celebrated=["create_course"])
        row = (await db.execute(select(OrgOnboarding))).scalars().first()
        assert row.goal == "team" and row.state["dismissed"] and row.state["welcome_seen"]
        assert {"goal_selected", "checklist_dismissed"} <= set(row.milestones)
        await state.update_state(db, org, dismissed=False, skip="share_grow")
        await state.update_state(db, org, unskip="share_grow", clear_goal=True)
        await db.refresh(row)
        assert row.goal is None and row.state["skipped"] == [] and row.state["dismissed"] is False
        with pytest.raises(HTTPException):
            await state.update_state(db, org, goal="nope")
        with pytest.raises(HTTPException):
            await state.update_state(db, org, skip="nope")

    async def test_record_event(self, db, org):
        assert await state.record_event(db, org, "plan_picker_viewed") is True
        assert await state.record_event(db, org, "plan_picker_viewed") is False
        assert await state.record_event(db, org, "share_grow") is True
        assert await state.record_event(db, org, "share_grow") is False
        row = (await db.execute(select(OrgOnboarding))).scalars().first()
        assert row.state["clicked"] == ["share_grow"]
        with pytest.raises(HTTPException):
            await state.record_event(db, org, "made_up")


# ── starter ──────────────────────────────────────────────────────────────


class TestStarter:
    async def test_applies_template_and_course_once(self, db, org, admin_user):
        await set_plan(db, org.id, "free")
        await state.update_state(db, org, goal="school")
        with patch("src.services.onboarding.starter.apply_website_template", new=AsyncMock(return_value="landingpage_1")) as web:
            out = await starter.apply_starter(db, org, admin_user, admin_user.id)
            assert web.await_args.args[3] == "university"
        assert out["template"] == "university" and out["page_uuid"] == "landingpage_1"
        course = (await db.execute(select(Course).where(Course.course_uuid == out["course_uuid"]))).scalars().first()
        assert course.name == starter.COURSES["school"]["name"] and not course.published
        row = (await db.execute(select(OrgOnboarding))).scalars().first()
        assert "starter_applied" in row.milestones and {"create_course", "add_content", "share_grow"} <= set(row.state["celebrated"])
        with pytest.raises(HTTPException) as e:
            await starter.apply_starter(db, org, admin_user, admin_user.id)
        assert e.value.status_code == 409

    async def test_course_skipped_when_plan_is_full(self, db, org, admin_user, course):
        await set_plan(db, org.id, "free")
        with saas():
            out = await starter.apply_starter(db, org, admin_user, admin_user.id, website=False)
        assert out == {"template": None, "page_uuid": None, "course_uuid": None}

    async def test_website_only(self, db, org, admin_user):
        await set_plan(db, org.id, "free")
        with patch("src.services.onboarding.starter.apply_website_template", new=AsyncMock(return_value="p")):
            out = await starter.apply_starter(db, org, admin_user, admin_user.id, course=False)
        assert out["course_uuid"] is None and out["template"] == goals.DEFAULT_TEMPLATE

    async def test_website_template_is_published_as_home(self, db, org, admin_user):
        await set_plan(db, org.id, "free")
        page_uuid = await starter.apply_website_template(db, org, admin_user, "coach")
        from src.db.landing_pages import LandingPage

        page = (await db.execute(select(LandingPage).where(LandingPage.page_uuid == page_uuid))).scalars().first()
        assert page.slug == "" and page.published and page.published_version == 1

    def test_unknown_goal_gets_the_welcome_course(self):
        assert starter.course_spec(None)["name"] == "Start here"
        assert starter.course_spec("team")["chapters"]


# ── invitations ──────────────────────────────────────────────────────────


async def verify(db, user_id: int):
    u = (await db.execute(select(User).where(User.id == user_id))).scalars().first()
    u.email_verified = True
    db.add(u)
    await db.commit()


def invite(r, email, org_uuid, **extra):
    r.set(f"invited_user:{email}:org:{org_uuid}", json.dumps({"pending": True, "created_at": "2026-11-01T00:00:00", **extra}), ex=3600)


class TestInvites:
    async def test_lists_pending_invites_for_my_email(self, db, org, other_org, admin_user):
        third = Organization(id=3, name="Third", slug="third", email="a@b.c", org_uuid="org_third", creation_date=_now_str(), update_date=_now_str())
        demo = Organization(id=4, name="Demo", slug="demo", email="a@b.c", org_uuid="org_demo", is_demo=True, creation_date=_now_str(), update_date=_now_str())
        db.add_all([third, demo])
        await db.commit()
        await verify(db, admin_user.id)
        with redis() as r:
            invite(r, "admin@test.com", "org_other", created_at="2026-11-02T00:00:00")
            invite(r, "admin@test.com", "org_third")
            invite(r, "admin@test.com", "org_test")  # already a member
            invite(r, "admin@test.com", "org_demo")
            r.set("invited_user:admin@test.com:org:org_gone", json.dumps({"pending": False}))
            got = await invites.list_pending_invites(db, admin_user.id)
        assert [i["slug"] for i in got] == ["other-org", "third"]

    async def test_unverified_email_sees_nothing_and_can_change_nothing(self, db, mock_request, other_org):
        # Anyone can sign up with someone else's address: until it is verified,
        # the invitations sent to it stay hidden and untouchable.
        await add_user(db, 15, "victim@x.com", verified=False)
        with redis() as r:
            invite(r, "victim@x.com", "org_other")
            assert await invites.list_pending_invites(db, 15) == []
            for action in (
                invites.decline_invite(db, 15, "org_other"),
                invites.accept_invite(mock_request, db, 15, "org_other"),
            ):
                with pytest.raises(HTTPException) as e:
                    await action
                assert e.value.status_code == 403 and e.value.detail == invites.VERIFY_FIRST
            assert r.get("invited_user:victim@x.com:org:org_other") is not None
            with patch("src.core.redis.get_redis_client", return_value=r):
                out = await hub.hub_summary(db, 15)
            assert out["email_verified"] is False and out["invites"] == []

    async def test_hub_lists_invites_once_verified(self, db, other_org):
        await add_user(db, 16, "ok@x.com")
        with redis() as r:
            invite(r, "ok@x.com", "org_other")
            out = await hub.hub_summary(db, 16)
        assert out["email_verified"] is True and [i["slug"] for i in out["invites"]] == ["other-org"]

    async def test_no_redis_no_email_or_errors(self, db, admin_user):
        await verify(db, admin_user.id)
        with patch("src.core.redis.get_redis_client", return_value=None):
            assert await invites.list_pending_invites(db, admin_user.id) == []
        assert invites._pending_records("") == {}
        broken = SimpleNamespace(scan_iter=lambda **_: (_ for _ in ()).throw(RuntimeError("down")))
        with patch("src.core.redis.get_redis_client", return_value=broken):
            assert invites._pending_records("a@b.c") == {}
        with redis() as r:
            r.set("invited_user:a@b.c:org:x", "")
            assert invites._pending_records("a@b.c") == {}

    async def test_unknown_user(self, db):
        with pytest.raises(HTTPException) as e:
            await invites.decline_invite(db, 999, "org_other")
        assert e.value.status_code == 404
        with pytest.raises(HTTPException) as e:
            await invites.list_pending_invites(db, 999)
        assert e.value.status_code == 404

    async def test_accept_joins_as_member_and_adds_the_group(self, db, mock_request, other_org):
        await add_user(db, 10, "new@x.com")
        await set_plan(db, other_org.id, "standard")
        with redis() as r:
            invite(r, "new@x.com", "org_other", invite_code_uuid="org_invite_code_1")
            r.set("org_invite_code_1:org:org_other:code:ABC", json.dumps({"usergroup_id": 7}))
            with patch("src.routers.users._invalidate_session_cache"), patch(
                "src.services.orgs.join_notifications.notify_user_joined_org", new=AsyncMock()
            ), patch("src.services.users.usergroups.add_users_to_usergroup", new=AsyncMock()) as add:
                out = await invites.accept_invite(mock_request, db, 10, "org_other")
            assert add.await_args.args[3] == 7
            assert json.loads(r.get("invited_user:new@x.com:org:org_other"))["pending"] is False
        assert out["slug"] == "other-org"
        link = (await db.execute(select(UserOrganization).where(UserOrganization.user_id == 10))).scalars().first()
        assert link.role_id == 4

    async def test_accept_survives_a_group_failure_and_codes_without_group(self, db, mock_request, other_org):
        await add_user(db, 11, "g@x.com")
        await set_plan(db, other_org.id, "standard")
        with redis() as r:
            invite(r, "g@x.com", "org_other", invite_code_uuid="org_invite_code_2")
            r.set("org_invite_code_2:org:org_other:code:Z", json.dumps({"usergroup_id": 3}))
            r.persist("invited_user:g@x.com:org:org_other")
            with patch("src.routers.users._invalidate_session_cache"), patch(
                "src.services.orgs.join_notifications.notify_user_joined_org", new=AsyncMock()
            ), patch("src.services.users.usergroups.add_users_to_usergroup", new=AsyncMock(side_effect=HTTPException(404))):
                await invites.accept_invite(mock_request, db, 11, "org_other")
            assert invites._invite_usergroup(r, {"invite_code_uuid": "nope"}, "org_other") is None
            r.set("org_invite_code_3:org:org_other:code:Y", "")
            assert invites._invite_usergroup(r, {"invite_code_uuid": "org_invite_code_3"}, "org_other") is None
            r.set("org_invite_code_4:org:org_other:code:Q", json.dumps({}))
            assert invites._invite_usergroup(r, {"invite_code_uuid": "org_invite_code_4"}, "org_other") is None

    async def test_accept_refusals(self, db, mock_request, org, other_org, admin_user):
        await add_user(db, 12, "unverified@x.com", verified=False)
        with pytest.raises(HTTPException) as e:
            await invites.accept_invite(mock_request, db, 12, "org_other")
        assert e.value.status_code == 403
        await add_user(db, 13, "v@x.com")
        with pytest.raises(HTTPException) as e:
            await invites.accept_invite(mock_request, db, 13, "org_missing")
        assert e.value.status_code == 404
        with patch("src.core.redis.get_redis_client", return_value=None), pytest.raises(HTTPException) as e:
            await invites.accept_invite(mock_request, db, 13, "org_other")
        assert e.value.status_code == 503
        with redis() as r:
            with pytest.raises(HTTPException) as e:
                await invites.accept_invite(mock_request, db, 13, "org_other")
            assert e.value.status_code == 404
            r.set("invited_user:v@x.com:org:org_other", json.dumps({"pending": False}))
            with pytest.raises(HTTPException):
                await invites.accept_invite(mock_request, db, 13, "org_other")
            invite(r, "admin@test.com", "org_test")
            await db.execute(select(User).where(User.id == admin_user.id))
            u = (await db.execute(select(User).where(User.id == admin_user.id))).scalars().first()
            u.email_verified = True
            db.add(u)
            await db.commit()
            with pytest.raises(HTTPException) as e:
                await invites.accept_invite(mock_request, db, admin_user.id, "org_test")
            assert e.value.status_code == 400

    async def test_decline(self, db, other_org):
        await add_user(db, 14, "d@x.com")
        with patch("src.core.redis.get_redis_client", return_value=None), pytest.raises(HTTPException) as e:
            await invites.decline_invite(db, 14, "org_other")
        assert e.value.status_code == 503
        with redis() as r:
            with pytest.raises(HTTPException) as e:
                await invites.decline_invite(db, 14, "org_other")
            assert e.value.status_code == 404
            invite(r, "d@x.com", "org_other")
            assert (await invites.decline_invite(db, 14, "org_other"))["declined"]
            assert r.get("invited_user:d@x.com:org:org_other") is None


# ── hub ──────────────────────────────────────────────────────────────────


class TestHub:
    async def test_roles_plans_status_and_setup(self, db, org, other_org, admin_user):
        await set_plan(db, org.id, "free")
        await add_member(db, other_org.id, admin_user.id, role_id=4)
        custom = Organization(id=5, name="Custom", slug="custom", email="a@b.c", org_uuid="org_c", creation_date=_now_str(), update_date=_now_str())
        db.add(custom)
        await db.commit()
        await add_member(db, custom.id, admin_user.id, role_id=99)
        extras = {"lifecycle": "poc", "poc": {"state": "active", "ends_at": "2026-12-01T00:00:00+00:00"}, "usage": {}, "license": None}
        with saas(), redis(), patch("src.services.onboarding.hub._ee_extras", new=AsyncMock(return_value=extras)):
            out = await hub.hub_summary(db, admin_user.id)
        by_id = {o["org_id"]: o for o in out["orgs"]}
        assert by_id[org.id]["role"] == "admin" and by_id[org.id]["status"] == "poc"
        assert by_id[org.id]["poc_ends_at"] == "2026-12-01T00:00:00+00:00"
        assert by_id[org.id]["setup"] == {"done": 0, "total": 6, "goal": None}
        assert by_id[other_org.id]["role"] == "member" and by_id[other_org.id]["setup"] is None
        assert by_id[custom.id]["role"] == "custom"
        assert out["invites"] == []

    async def test_outside_saas_no_plan_and_inactive_poc(self, db, org, admin_user):
        with redis():
            out = await hub.hub_summary(db, admin_user.id)
        assert out["orgs"][0]["plan"] is None and out["orgs"][0]["status"] is None
        extras = {"lifecycle": None, "poc": {"state": "ended"}, "usage": {}, "license": None}
        with saas(), redis(), patch("src.services.onboarding.hub._ee_extras", new=AsyncMock(return_value=extras)):
            out = await hub.hub_summary(db, admin_user.id)
        assert out["orgs"][0]["poc_ends_at"] is None and out["orgs"][0]["status"] == "free"

    async def test_no_orgs(self, db):
        await add_user(db, 20, "lonely@x.com")
        with redis():
            assert (await hub.hub_summary(db, 20))["orgs"] == []

    async def test_setup_hidden_when_old_demo_dismissed_or_done(self, db, org, course, activity):
        assert await hub._setup(db, org, None) is not None
        org.is_demo = True
        assert await hub._setup(db, org, None) is None
        org.is_demo = False
        org.creation_date = _now_str(90)
        assert await hub._setup(db, org, None) is None
        org.creation_date = _now_str()
        row = OrgOnboarding(org_id=org.id, state={"dismissed": True}, milestones={})
        assert await hub._setup(db, org, row) is None
        everything = OrgOnboarding(org_id=org.id, goal=None, state={"skipped": goals.DEFAULT_STEPS}, milestones={})
        assert await hub._setup(db, org, everything) is None


# ── plan picker ──────────────────────────────────────────────────────────


class TestPlanPicker:
    def test_plans_limits_and_unlocks(self):
        out = plans.picker("free", "sell")
        ids = [p["id"] for p in out["plans"]]
        assert ids == ["free", "standard", "pro", "enterprise"]
        std = out["plans"][1]
        assert std["recommended"] and "payments" in std["unlocks"] and "payments" not in out["plans"][0]["unlocks"]
        assert out["plans"][0]["current"] and out["can_continue_free"]
        assert out["upgrades"] == ["standard", "pro", "enterprise"]
        assert out["plans"][3]["contact_sales"]

    def test_current_personal_plan_is_listed(self):
        out = plans.picker("personal", None)
        assert [p["id"] for p in out["plans"]][:2] == ["free", "personal"]
        assert not out["can_continue_free"] and "free" not in out["upgrades"]

    def test_recommended_never_flags_the_current_plan(self):
        out = plans.picker("standard", "sell")
        assert not any(p["recommended"] for p in out["plans"])
        assert plans.picker(None, None)["can_continue_free"]


# ── funnel ───────────────────────────────────────────────────────────────


class TestFunnel:
    async def test_counts_each_step_for_the_cohort(self, db):
        old = await add_user(db, 30, "old@x.com", created=_now_str(400))
        a = await add_user(db, 31, "a@x.com")
        b = await add_user(db, 32, "b@x.com")
        await add_user(db, 33, "c@x.com", verified=False)
        with patch("src.services.onboarding.funnel.is_demo_email", side_effect=lambda e: e == "c@x.com"):
            o1 = Organization(id=40, name="A", slug="a", email="a@x.com", org_uuid="oa", creation_date=_now_str(), update_date=_now_str())
            o2 = Organization(id=41, name="B", slug="b", email="b@x.com", org_uuid="ob", creation_date=_now_str(), update_date=_now_str())
            db.add_all([o1, o2])
            await db.commit()
            await add_member(db, 40, a.id, 1)
            await add_member(db, 41, b.id, 1)
            await add_member(db, 40, old.id, 4)
            await set_plan(db, 40, "standard")
            db.add(Course(name="c", description="", public=True, published=True, open_to_contributors=False, org_id=40, course_uuid="c40", creation_date=_now_str(), update_date=_now_str()))
            db.add(Course(name="d", description="", public=False, published=False, open_to_contributors=False, org_id=41, course_uuid="c41", creation_date=_now_str(), update_date=_now_str()))
            db.add(OrgOnboarding(org_id=40, goal="sell", state={}, milestones={"plan_picker_viewed": "x", "checkout_started": "x"}))
            db.add(OrgOnboarding(org_id=41, goal="unknown", state={}, milestones={"continued_free": "x"}))
            await db.commit()
            out = await funnel.compute_funnel(db, 30)
        counts = {s["key"]: s["count"] for s in out["steps"]}
        assert counts == {"signed_up": 2, "verified": 2, "created_org": 2, "picked_goal": 2, "first_course": 2, "published": 1, "first_learner": 1, "paid": 1}
        assert out["steps"][-1]["rate"] == 0.5
        assert out["by_goal"]["sell"] == 1 and out["events"]["checkout_started"] == 1 and out["events"]["continued_free"] == 1
        assert out["orgs"] == 2

    async def test_empty_cohort_and_clamped_days(self, db):
        out = await funnel.compute_funnel(db, 0)
        assert out["days"] == 30 and all(s["count"] == 0 and s["rate"] == 0.0 for s in out["steps"])
        assert (await funnel.compute_funnel(db, 9999))["days"] == funnel.MAX_DAYS

    async def test_signups_without_orgs(self, db):
        await add_user(db, 50, "solo@x.com")
        out = await funnel.compute_funnel(db, 7)
        assert out["steps"][0]["count"] == 1 and out["steps"][2]["count"] == 0
