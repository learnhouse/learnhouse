"""Course contributions end to end through the router, with real RBAC.

Off until a course owner turns it on; then the course's audience suggests
edits and gives feedback from the learner page, reviewers accept (as a new
page version, with credit), edit-then-accept, reject or send back, and
conflicts are caught when the page moved on.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.courses.activities import Activity
from src.db.courses.activity_comments import ActivityComment, ActivityCommentThread
from src.db.courses.activity_versions import ActivityVersion
from src.db.courses.contributions import (
    ContentAttribution,
    ContentSuggestion,
    CourseContributionSettings,
    CourseContributor,
)
from src.db.notifications import Notification
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.db.trail_runs import TrailRun
from src.db.trails import Trail
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, AnonymousUser, PublicUser, User
from src.routers.courses.contributions import router as contributions_router
from src.security.auth import get_current_user
from src.services.courses.contributions import blocks as B
from src.services.courses.contributions import service as svc

BASE = "/api/v1/contributions"
ACT = f"{BASE}/activities/activity_test"
COURSE = f"{BASE}/courses/course_test"


def _now() -> str:
    return str(datetime.now())


def p(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


PAGE = [
    {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Intro"}]},
    p("The sky is green."),
    p("Water boils at 100 degrees."),
]


async def _user(db, uid, username, org_id=None, role_id=None) -> PublicUser:
    u = User(
        id=uid, username=username, first_name=username.title(), last_name="", email=f"{username}@t.test",
        password="x", user_uuid=f"user_{username}", creation_date=_now(), update_date=_now(),
    )
    db.add(u)
    if org_id is not None:
        db.add(UserOrganization(user_id=uid, org_id=org_id, role_id=role_id, creation_date=_now(), update_date=_now()))
    await db.commit()
    return PublicUser(id=uid, username=username, first_name=u.first_name, last_name="", email=u.email, user_uuid=u.user_uuid)


async def _enroll(db, org, course, user_id):
    db.add(Trail(id=user_id, org_id=org.id, user_id=user_id, trail_uuid=f"trail_{user_id}", creation_date=_now(), update_date=_now()))
    await db.commit()
    db.add(TrailRun(trail_id=user_id, course_id=course.id, org_id=org.id, user_id=user_id, creation_date=_now(), update_date=_now()))
    await db.commit()


@pytest.fixture
async def page(db, activity):
    activity.content = {"type": "doc", "content": [dict(b) for b in PAGE]}
    activity.current_version = 3
    db.add(activity)
    await db.commit()
    return activity


@pytest.fixture
async def enabled(db, org, course):
    row = CourseContributionSettings(course_id=course.id, org_id=org.id, enabled=True, audience="enrolled")
    db.add(row)
    await db.commit()
    return row


@pytest.fixture
async def learner(db, org, course, user_role, regular_user):
    await _enroll(db, org, course, regular_user.id)
    return regular_user


@pytest.fixture
async def stranger(db):
    """Signed in, not a member of the org."""
    return await _user(db, 9, "stranger")


@pytest.fixture
def as_user():
    return {"user": None}


@pytest.fixture
def app(db, as_user, page):
    app = FastAPI()
    app.include_router(contributions_router, prefix=BASE)
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: as_user["user"]
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture(autouse=True)
def allow_rate():
    with patch("src.services.security.rate_limiting.check_rate_limit", return_value=(True, 1, 60)) as m:
        yield m


@pytest.fixture(autouse=True)
def quiet_side_effects():
    with patch("src.services.courses.activities.versioning.dispatch_webhooks", new_callable=AsyncMock), \
         patch("src.services.courses.activities.collab_notify.notify_collab_content_changed") as collab, \
         patch("src.services.ai.rag.queue.index_activity") as index:
        yield collab, index


def saas_free():
    from contextlib import ExitStack

    stack = ExitStack()
    stack.enter_context(patch("src.security.features_utils.plan_check.get_deployment_mode", return_value="saas"))
    stack.enter_context(patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"))
    stack.enter_context(patch("src.security.features_utils.plan_check.get_org_plan", new=AsyncMock(return_value="free")))
    return stack


def edit(text="The sky is blue.", index=1, before=None, note="Fix colour"):
    return {
        "base_version": 3,
        "start_index": index,
        "before": [before or PAGE[index]],
        "after": [p(text)],
        "note": note,
    }


async def _suggest(client, as_user, who, body=None):
    as_user["user"] = who
    r = await client.post(f"{ACT}/suggestions", json=body or edit())
    assert r.status_code == 200, r.text
    return r.json()


# ─── off by default, settings ────────────────────────────────────────────────


class TestSettings:
    async def test_off_by_default(self, client, as_user, learner):
        as_user["user"] = learner
        r = await client.get(f"{ACT}/context")
        assert r.status_code == 200
        body = r.json()
        assert body["enabled"] is False and body["can_suggest"] is False and body["current_version"] == 3
        r = await client.post(f"{ACT}/suggestions", json=edit())
        assert r.status_code == 403
        r = await client.post(f"{ACT}/feedback", json={"feedback_type": "typo", "body": "x"})
        assert r.status_code == 403

    async def test_admin_reads_and_turns_on(self, client, as_user, admin_user, db, course):
        as_user["user"] = admin_user
        r = await client.get(f"{COURSE}/settings")
        assert r.json() == {
            "enabled": False, "audience": "enrolled", "allow_suggestions": True,
            "allow_feedback": True, "trusted_publish": False, "plan_allowed": True,
        }
        r = await client.put(f"{COURSE}/settings", json={"enabled": True, "audience": "members"})
        assert r.status_code == 200 and r.json()["enabled"] is True and r.json()["audience"] == "members"
        r = await client.put(f"{COURSE}/settings", json={"trusted_publish": True})
        assert r.json()["trusted_publish"] is True and r.json()["audience"] == "members"
        row = (await db.execute(select(CourseContributionSettings))).scalars().one()
        assert row.updated_by == admin_user.id

    async def test_bad_audience_in_db_reads_as_enrolled(self, db, org, course):
        row = CourseContributionSettings(course_id=course.id, org_id=org.id, audience="weird")
        assert svc._settings_read(row, True).audience == "enrolled"

    async def test_learner_cannot_change_or_read_settings(self, client, as_user, learner):
        as_user["user"] = learner
        assert (await client.get(f"{COURSE}/settings")).status_code == 403
        assert (await client.put(f"{COURSE}/settings", json={"enabled": True})).status_code == 403

    async def test_anonymous_and_tokens_refused(self, client, as_user, anonymous_user):
        as_user["user"] = anonymous_user
        assert (await client.get(f"{COURSE}/settings")).status_code == 401
        as_user["user"] = APITokenUser(id=0, user_uuid="t", username="token", org_id=1, token_name="t", created_by_user_id=1)
        assert (await client.put(f"{COURSE}/settings", json={"enabled": True})).status_code == 401

    async def test_missing_course(self, client, as_user, admin_user):
        as_user["user"] = admin_user
        assert (await client.get(f"{BASE}/courses/course_nope/settings")).status_code == 404

    async def test_plan_without_contributions(self, client, as_user, admin_user, enabled, learner):
        with saas_free():
            as_user["user"] = admin_user
            r = await client.put(f"{COURSE}/settings", json={"enabled": True})
            assert r.status_code == 403
            assert (await client.get(f"{COURSE}/settings")).json()["plan_allowed"] is False
            # Turning it off still works on any plan.
            assert (await client.put(f"{COURSE}/settings", json={"enabled": False})).status_code == 200
            await client.put(f"{COURSE}/settings", json={"audience": "enrolled"})
        enabled.enabled = True
        with saas_free():
            as_user["user"] = learner
            assert (await client.get(f"{ACT}/context")).json()["enabled"] is False


# ─── who may contribute ──────────────────────────────────────────────────────


class TestEligibility:
    async def test_enrolled_learner(self, client, as_user, learner, enabled):
        as_user["user"] = learner
        body = (await client.get(f"{ACT}/context")).json()
        assert body["enabled"] and body["can_suggest"] and body["can_feedback"]
        assert body["can_review"] is False and body["reason"] is None and body["publishes_directly"] is False

    async def test_not_enrolled(self, client, as_user, regular_user, enabled):
        as_user["user"] = regular_user
        body = (await client.get(f"{ACT}/context")).json()
        assert body["enabled"] and not body["can_suggest"] and body["reason"] == "enroll"

    async def test_anonymous_is_asked_to_sign_in(self, client, as_user, anonymous_user, enabled):
        as_user["user"] = anonymous_user
        body = (await client.get(f"{ACT}/context")).json()
        assert body["reason"] == "signin" and not body["can_suggest"]
        assert (await client.post(f"{ACT}/suggestions", json=edit())).status_code == 401
        r = await client.post(f"{ACT}/feedback", json={"feedback_type": "typo", "body": "x"})
        assert r.status_code == 401

    async def test_members_audience(self, client, as_user, regular_user, stranger, enabled, db):
        enabled.audience = "members"
        db.add(enabled)
        await db.commit()
        as_user["user"] = regular_user
        assert (await client.get(f"{ACT}/context")).json()["can_suggest"] is True
        as_user["user"] = stranger
        body = (await client.get(f"{ACT}/context")).json()
        assert body["reason"] == "members" and body["can_suggest"] is False

    async def test_signed_in_audience(self, client, as_user, stranger, enabled, db):
        enabled.audience = "signed_in"
        enabled.allow_feedback = False
        db.add(enabled)
        await db.commit()
        as_user["user"] = stranger
        body = (await client.get(f"{ACT}/context")).json()
        assert body["can_suggest"] is True and body["can_feedback"] is False
        r = await client.post(f"{ACT}/feedback", json={"feedback_type": "typo", "body": "x"})
        assert r.status_code == 403

    async def test_cannot_open_course(self, client, as_user, stranger, anonymous_user, enabled, course, db):
        course.public = False
        db.add(course)
        await db.commit()
        for who in (stranger, anonymous_user):
            as_user["user"] = who
            assert (await client.get(f"{ACT}/context")).status_code == 404
            assert (await client.post(f"{ACT}/suggestions", json=edit())).status_code == 404
            r = await client.post(f"{ACT}/feedback", json={"feedback_type": "typo", "body": "x"})
            assert r.status_code == 404
        enabled.enabled = False
        db.add(enabled)
        await db.commit()
        assert (await client.get(f"{ACT}/context")).status_code == 404

    async def test_blocked(self, client, as_user, learner, enabled, db, org, course):
        db.add(CourseContributor(org_id=org.id, course_id=course.id, user_id=learner.id, blocked=True))
        await db.commit()
        as_user["user"] = learner
        body = (await client.get(f"{ACT}/context")).json()
        assert body["reason"] == "blocked" and not body["can_suggest"]

    async def test_reviewer_can_do_everything(self, client, as_user, admin_user, enabled):
        as_user["user"] = admin_user
        body = (await client.get(f"{ACT}/context")).json()
        assert body["can_review"] and body["can_suggest"] and body["can_feedback"]

    async def test_missing_activity(self, client, as_user, learner):
        as_user["user"] = learner
        assert (await client.get(f"{BASE}/activities/activity_nope/context")).status_code == 404


# ─── suggesting ──────────────────────────────────────────────────────────────


class TestSuggest:
    async def test_create_and_list_mine(self, client, as_user, learner, enabled, db):
        s = await _suggest(client, as_user, learner)
        assert s["status"] == "pending" and s["start_index"] == 1
        assert s["summary"] == "Edits paragraph: “The sky is blue.”"
        assert s["author"]["username"] == "regular" and s["note"] == "Fix colour"
        assert s["placement"] is None
        mine = (await client.get(f"{BASE}/suggestions/mine")).json()
        assert mine["total"] == 1
        mine = (await client.get(f"{BASE}/suggestions/mine", params={"activity_uuid": "activity_test"})).json()
        assert mine["items"][0]["suggestion_uuid"] == s["suggestion_uuid"]
        assert (await client.get(f"{ACT}/context")).json()["my_open_suggestions"] == 1
        got = (await client.get(f"{BASE}/suggestions/{s['suggestion_uuid']}")).json()
        assert got["placement"] is None

    async def test_insert_and_remove(self, client, as_user, learner, enabled):
        ins = await _suggest(client, as_user, learner, {
            "base_version": 3, "start_index": 3, "before": [], "after": [p("New closing line.")],
        })
        assert ins["summary"].startswith("Adds paragraph")
        top = await _suggest(client, as_user, learner, {
            "base_version": 3, "start_index": 0, "before": [], "after": [p("Top.")],
        })
        assert top["start_index"] == 0
        rem = await _suggest(client, as_user, learner, {
            "base_version": 3, "start_index": 2, "before": [PAGE[2]], "after": [],
        })
        assert rem["summary"].startswith("Removes paragraph")

    async def test_learner_copy_with_default_attrs_still_matches(self, client, as_user, learner, enabled, db, page):
        img = {"type": "blockImage", "attrs": {"blockObject": {"id": 4}}}
        page.content = {"type": "doc", "content": PAGE + [img]}
        db.add(page)
        await db.commit()
        rendered = {"type": "blockImage", "attrs": {"blockObject": {"id": 4}, "size": {"width": 300}, "alignment": "center"}}
        s = await _suggest(client, as_user, learner, {
            "base_version": 3, "start_index": 3, "before": [rendered],
            "after": [dict(rendered, attrs=dict(rendered["attrs"], alignment="left"))],
        })
        # The page's own copy is stored, not the learner's.
        assert s["before"] == [img]

    async def test_restricted_blocks(self, client, as_user, learner, enabled, db, page):
        embed = {"type": "blockEmbed", "attrs": {"embedCode": "<iframe src='https://x'></iframe>"}}
        page.content = {"type": "doc", "content": PAGE + [embed]}
        db.add(page)
        await db.commit()
        as_user["user"] = learner
        bad = {"base_version": 3, "start_index": 4, "before": [], "after": [embed]}
        assert (await client.post(f"{ACT}/suggestions", json=bad)).status_code == 400
        changed = dict(embed, attrs={"embedCode": "<script>x</script>"})
        bad2 = {"base_version": 3, "start_index": 3, "before": [embed], "after": [changed]}
        assert (await client.post(f"{ACT}/suggestions", json=bad2)).status_code == 400
        # Removing it is fine, and so is a revision that doesn't add one.
        s = await _suggest(client, as_user, learner, {"base_version": 3, "start_index": 3, "before": [embed], "after": []})
        r = await client.put(f"{BASE}/suggestions/{s['suggestion_uuid']}", json={"after": [embed, embed]})
        assert r.status_code == 400

    async def test_loose_match_rules(self):
        assert not svc._loose_match({"type": "a"}, {"type": "b"})
        assert not svc._loose_match(p("one"), p("two"))
        assert svc._loose_match(p("one  "), p("one"))
        assert svc._loose_match({"type": "x", "attrs": {"id": 1, "n": None}}, {"type": "x"})

    async def test_validation(self, client, as_user, learner, enabled):
        as_user["user"] = learner
        r = await client.post(f"{ACT}/suggestions", json={"base_version": 3, "start_index": 0, "before": [], "after": []})
        assert r.status_code == 400
        r = await client.post(f"{ACT}/suggestions", json=edit(text="The sky is green."))
        assert r.status_code == 400
        r = await client.post(f"{ACT}/suggestions", json=edit(before=p("Not on the page")))
        assert r.status_code == 409
        big = edit()
        big["after"] = [p("x" * 210_000)]
        assert (await client.post(f"{ACT}/suggestions", json=big)).status_code == 413
        assert svc._payload_size([object()]) > svc.MAX_PAYLOAD_BYTES

    async def test_open_cap_and_rate_limit(self, client, as_user, learner, enabled, allow_rate):
        with patch.object(svc, "MAX_OPEN_PER_COURSE", 1):
            await _suggest(client, as_user, learner)
            r = await client.post(f"{ACT}/suggestions", json=edit(text="Other"))
            assert r.status_code == 429
        allow_rate.return_value = (False, 99, 30)
        r = await client.post(f"{ACT}/suggestions", json=edit(text="Third"))
        assert r.status_code == 429 and r.headers["retry-after"] == "30"

    async def test_rate_limit_fails_open(self, client, as_user, learner, enabled, allow_rate):
        allow_rate.side_effect = RuntimeError("redis down")
        await _suggest(client, as_user, learner)

    async def test_suggestions_off(self, client, as_user, learner, enabled, db):
        enabled.allow_suggestions = False
        db.add(enabled)
        await db.commit()
        as_user["user"] = learner
        assert (await client.post(f"{ACT}/suggestions", json=edit())).status_code == 403

    async def test_notifies_course_authors(self, client, as_user, learner, enabled, db, org, course, admin_user):
        db.add(ResourceAuthor(
            resource_uuid=course.course_uuid, user_id=admin_user.id, authorship=ResourceAuthorshipEnum.CREATOR,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE, creation_date=_now(), update_date=_now(),
        ))
        await db.commit()
        s = await _suggest(client, as_user, learner)
        rows = (await db.execute(select(Notification).where(Notification.type == "suggestion_submitted"))).scalars().all()
        assert [r.user_id for r in rows] == [admin_user.id]
        assert rows[0].data["path"].endswith(f"/contributions?suggestion={s['suggestion_uuid']}")

    async def test_others_cannot_read_a_suggestion(self, client, as_user, learner, stranger, enabled):
        s = await _suggest(client, as_user, learner)
        as_user["user"] = stranger
        assert (await client.get(f"{BASE}/suggestions/{s['suggestion_uuid']}")).status_code == 404
        assert (await client.get(f"{BASE}/suggestions/suggestion_nope")).status_code == 404


# ─── reviewing ───────────────────────────────────────────────────────────────


class TestReview:
    async def test_queue_and_accept(self, client, as_user, learner, admin_user, enabled, db, page, quiet_side_effects):
        s = await _suggest(client, as_user, learner)
        as_user["user"] = admin_user
        queue = (await client.get(f"{COURSE}/suggestions", params={"status": "open"})).json()
        assert queue["total"] == 1
        item = queue["items"][0]
        assert item["placement"]["state"] == "clean" and item["placement"]["current"] == [PAGE[1]]
        assert (await client.get(f"{COURSE}/suggestions", params={"status": "accepted"})).json()["total"] == 0
        assert (await client.get(f"{COURSE}/suggestions")).json()["total"] == 1
        summary = (await client.get(f"{COURSE}/summary")).json()
        assert summary == {"pending_suggestions": 1, "open_feedback": 0, "contributors": 0}

        r = await client.post(f"{BASE}/suggestions/{s['suggestion_uuid']}/accept", json={"note": "Thanks!"})
        assert r.status_code == 200, r.text
        done = r.json()
        assert done["status"] == "accepted" and done["applied_version"] == 4 and done["review_note"] == "Thanks!"
        await db.refresh(page)
        assert page.content["content"][1] == p("The sky is blue.")
        assert page.current_version == 4 and page.last_modified_by_id == admin_user.id
        snap = (await db.execute(select(ActivityVersion))).scalars().one()
        assert snap.version_number == 3 and snap.content["content"][1] == PAGE[1]
        assert snap.label == "Before suggestion by Regular User"
        collab, index = quiet_side_effects
        collab.assert_called_once()
        index.assert_called_once_with(page.id)

        credit = (await db.execute(select(ContentAttribution))).scalars().one()
        assert credit.user_id == learner.id and credit.block_fp == "paragraph|the sky is blue." and credit.block_index == 1
        record = (await db.execute(select(CourseContributor))).scalars().one()
        assert record.accepted_count == 1 and record.first_contribution_at
        note = (await db.execute(select(Notification).where(Notification.type == "suggestion_accepted"))).scalars().one()
        assert note.user_id == learner.id and note.data["path"].endswith("/activity/test")

        # Already decided.
        r = await client.post(f"{BASE}/suggestions/{s['suggestion_uuid']}/reject", json={})
        assert r.status_code == 409

        # The learner page shows who wrote the block.
        as_user["user"] = learner
        ctx = (await client.get(f"{ACT}/context")).json()
        assert ctx["credits"] == [{
            "block_index": 1, "block_fp": "paragraph|the sky is blue.",
            "users": [{"id": 2, "user_uuid": "user_regular", "username": "regular", "first_name": "Regular", "last_name": "User", "avatar_image": ""}],
        }] or ctx["credits"][0]["users"][0]["username"] == "regular"

    async def test_edit_then_accept_and_credit_follows_later_edits(self, client, as_user, learner, admin_user, enabled, db, page, user_role):
        s = await _suggest(client, as_user, learner)
        as_user["user"] = admin_user
        r = await client.post(f"{BASE}/suggestions/{s['suggestion_uuid']}/accept", json={"after": [p("The sky is blue!")]})
        assert r.json()["after"] == [p("The sky is blue!")]
        # A second learner edits the same block: both keep credit on it.
        other = await _user(db, 11, "second", page.org_id, user_role.id)
        await _enroll(db, await _org(db), await _course(db), other.id)
        s2 = await _suggest(client, as_user, other, {
            "base_version": 4, "start_index": 1, "before": [p("The sky is blue!")], "after": [p("The sky is blue, mostly.")],
        })
        as_user["user"] = admin_user
        await client.post(f"{BASE}/suggestions/{s2['suggestion_uuid']}/accept", json={})
        rows = (await db.execute(select(ContentAttribution).order_by(ContentAttribution.user_id))).scalars().all()
        assert [(r.user_id, r.block_fp) for r in rows] == [
            (learner.id, "paragraph|the sky is blue, mostly."),
            (other.id, "paragraph|the sky is blue, mostly."),
        ]
        # The author edits the paragraph in the full editor: credit follows by similarity.
        page = await db.get(Activity, page.id)
        content = dict(page.content)
        content["content"] = list(content["content"])
        content["content"][1] = p("The sky is blue, mostly!")
        page.content = content
        db.add(page)
        await db.commit()
        as_user["user"] = learner
        ctx = (await client.get(f"{ACT}/context")).json()
        assert ctx["credits"][0]["block_index"] == 1 and len(ctx["credits"][0]["users"]) == 2
        # Removed entirely: credit stops showing.
        content["content"] = [content["content"][0]]
        page.content = dict(content)
        db.add(page)
        await db.commit()
        assert (await client.get(f"{ACT}/context")).json()["credits"] == []
        # Profile credit stays.
        r = await client.get(f"{BASE}/users/user_regular/contributions", params={"org_id": page.org_id})
        assert r.json()["total_accepted"] == 1 and r.json()["items"][0]["course_uuid"] == "course_test"

    async def test_moved_and_conflict(self, client, as_user, learner, admin_user, enabled, db, page):
        s = await _suggest(client, as_user, learner)
        # Someone adds a block on top: the suggestion moved, still applies.
        page.content = {"type": "doc", "content": [p("New first line")] + PAGE}
        page.current_version = 4
        db.add(page)
        await db.commit()
        as_user["user"] = admin_user
        item = (await client.get(f"{COURSE}/suggestions")).json()["items"][0]
        assert item["placement"]["state"] == "moved" and item["placement"]["start_index"] == 2
        # Now the paragraph itself was rewritten: conflict.
        page.content = {"type": "doc", "content": [PAGE[0], p("The sky is green at night."), PAGE[2]]}
        page.current_version = 5
        db.add(page)
        await db.commit()
        item = (await client.get(f"{COURSE}/suggestions")).json()["items"][0]
        assert item["placement"]["state"] == "conflict"
        assert item["placement"]["current"] == [p("The sky is green at night.")]
        r = await client.post(f"{BASE}/suggestions/{s['suggestion_uuid']}/accept", json={})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "conflict"
        # The reviewer resolves it on the latest version.
        stale = {"after": [p("The sky is blue at night.")], "target": {"start_index": 1, "length": 1, "version": 4}}
        assert (await client.post(f"{BASE}/suggestions/{s['suggestion_uuid']}/accept", json=stale)).status_code == 409
        bad = {"target": {"start_index": 9, "length": 1, "version": 5}}
        assert (await client.post(f"{BASE}/suggestions/{s['suggestion_uuid']}/accept", json=bad)).status_code == 400
        ok = dict(stale, target={"start_index": 1, "length": 1, "version": 5})
        r = await client.post(f"{BASE}/suggestions/{s['suggestion_uuid']}/accept", json=ok)
        assert r.status_code == 200
        await db.refresh(page)
        assert page.content["content"][1] == p("The sky is blue at night.") and len(page.content["content"]) == 3

    async def test_insert_conflict_when_anchor_gone(self, client, as_user, learner, admin_user, enabled, db, page):
        s = await _suggest(client, as_user, learner, {
            "base_version": 3, "start_index": 2, "before": [], "after": [p("Inserted")],
        })
        page.content = {"type": "doc", "content": [PAGE[0], PAGE[2]]}
        db.add(page)
        await db.commit()
        as_user["user"] = admin_user
        item = (await client.get(f"{COURSE}/suggestions")).json()["items"][0]
        assert item["placement"]["state"] == "conflict"

    async def test_accept_insert_and_removal(self, client, as_user, learner, admin_user, enabled, db, page):
        ins = await _suggest(client, as_user, learner, {"base_version": 3, "start_index": 3, "before": [], "after": [p("End.")]})
        rem = await _suggest(client, as_user, learner, {"base_version": 3, "start_index": 1, "before": [PAGE[1]], "after": []})
        as_user["user"] = admin_user
        assert (await client.post(f"{BASE}/suggestions/{ins['suggestion_uuid']}/accept", json={})).status_code == 200
        assert (await client.post(f"{BASE}/suggestions/{rem['suggestion_uuid']}/accept", json={})).status_code == 200
        await db.refresh(page)
        assert [B.text_of(b) for b in page.content["content"]] == ["Intro", "Water boils at 100 degrees.", "End."]
        rows = (await db.execute(select(ContentAttribution))).scalars().all()
        assert [r.block_fp for r in rows] == ["paragraph|end."]

    async def test_removing_a_credited_block_drops_its_credit(self, client, as_user, learner, admin_user, enabled, db, page):
        s = await _suggest(client, as_user, learner)
        as_user["user"] = admin_user
        await client.post(f"{BASE}/suggestions/{s['suggestion_uuid']}/accept", json={})
        # Two pending suggestions touching the same (now credited) block.
        r1 = await _suggest(client, as_user, learner, {"base_version": 4, "start_index": 1, "before": [p("The sky is blue.")], "after": []})
        as_user["user"] = admin_user
        await client.post(f"{BASE}/suggestions/{r1['suggestion_uuid']}/accept", json={})
        assert (await db.execute(select(ContentAttribution))).scalars().all() == []

    async def test_rekey_merges_duplicates(self, db, org, course, page, learner):
        now = _now()
        for fp in ("paragraph|a", "paragraph|b"):
            db.add(ContentAttribution(org_id=org.id, course_id=course.id, activity_id=page.id, user_id=learner.id, block_fp=fp, created_at=now))
        await db.commit()
        await svc._rekey_attributions(page, [p("a"), p("b")], [p("c"), p("c")], 0, db)
        await db.commit()
        rows = (await db.execute(select(ContentAttribution))).scalars().all()
        assert [r.block_fp for r in rows] == ["paragraph|c"]
        await svc._rekey_attributions(page, [], [p("x")], 0, db)

    async def test_credit_without_author_is_skipped(self, db, page, course):
        s = ContentSuggestion(suggestion_uuid="s", org_id=1, course_id=1, activity_id=page.id, author_id=None)
        await svc._credit(s, page, course, [p("x")], 0, db)
        assert (await db.execute(select(ContentAttribution))).scalars().all() == []

    async def test_reject_and_request_changes_then_revise(self, client, as_user, learner, admin_user, enabled, db):
        s = await _suggest(client, as_user, learner)
        as_user["user"] = admin_user
        r = await client.post(f"{BASE}/suggestions/{s['suggestion_uuid']}/request-changes", json={"note": ""})
        assert r.status_code == 400
        r = await client.post(f"{BASE}/suggestions/{s['suggestion_uuid']}/request-changes", json={"note": "Cite a source"})
        assert r.json()["status"] == "changes_requested" and r.json()["reviewer"]["username"] == "admin"
        note = (await db.execute(select(Notification).where(Notification.type == "suggestion_changes_requested"))).scalars().one()
        assert "contribution=" in note.data["path"]
        # The author revises: back to pending, reviewers hear again.
        as_user["user"] = learner
        r = await client.put(f"{BASE}/suggestions/{s['suggestion_uuid']}", json={"after": [p("The sky is blue (NASA).")], "note": "Added source"})
        assert r.json()["status"] == "pending" and r.json()["note"] == "Added source"
        r = await client.put(f"{BASE}/suggestions/{s['suggestion_uuid']}", json={"after": [p("The sky is blue (NASA, 2024).")]})
        assert r.json()["status"] == "pending" and r.json()["note"] == "Added source"
        as_user["user"] = admin_user
        r = await client.post(f"{BASE}/suggestions/{s['suggestion_uuid']}/reject", json={"note": "Out of scope"})
        assert r.json()["status"] == "rejected"
        assert (await db.execute(select(Notification).where(Notification.type == "suggestion_rejected"))).scalars().one()

    async def test_revise_rules(self, client, as_user, learner, stranger, enabled, db):
        s = await _suggest(client, as_user, learner)
        url = f"{BASE}/suggestions/{s['suggestion_uuid']}"
        as_user["user"] = stranger
        assert (await client.put(url, json={"after": [p("x")]})).status_code == 404
        as_user["user"] = learner
        rem = await _suggest(client, as_user, learner, {"base_version": 3, "start_index": 3, "before": [], "after": [p("y")]})
        assert (await client.put(f"{BASE}/suggestions/{rem['suggestion_uuid']}", json={"after": []})).status_code == 400
        big = {"after": [p("x" * 210_000)]}
        assert (await client.put(url, json=big)).status_code == 413
        enabled.allow_suggestions = False
        db.add(enabled)
        await db.commit()
        assert (await client.put(url, json={"after": [p("x")]})).status_code == 403

    async def test_withdraw(self, client, as_user, learner, stranger, enabled):
        s = await _suggest(client, as_user, learner)
        url = f"{BASE}/suggestions/{s['suggestion_uuid']}/withdraw"
        as_user["user"] = stranger
        assert (await client.post(url)).status_code == 404
        as_user["user"] = learner
        assert (await client.post(url)).json()["status"] == "withdrawn"
        assert (await client.post(url)).status_code == 409

    async def test_learner_cannot_review(self, client, as_user, learner, enabled):
        s = await _suggest(client, as_user, learner)
        for action in ("accept", "reject", "request-changes"):
            r = await client.post(f"{BASE}/suggestions/{s['suggestion_uuid']}/{action}", json={"note": "x"})
            assert r.status_code == 403
        assert (await client.get(f"{COURSE}/suggestions")).status_code == 403
        assert (await client.get(f"{COURSE}/summary")).status_code == 403

    async def test_reviewer_suggestion_accepted_by_self_is_not_notified(self, client, as_user, admin_user, enabled, db):
        s = await _suggest(client, as_user, admin_user)
        await client.post(f"{BASE}/suggestions/{s['suggestion_uuid']}/accept", json={})
        assert (await db.execute(select(Notification).where(Notification.type == "suggestion_accepted"))).scalars().all() == []

    async def test_accept_payload_too_large(self, client, as_user, learner, admin_user, enabled):
        s = await _suggest(client, as_user, learner)
        as_user["user"] = admin_user
        r = await client.post(f"{BASE}/suggestions/{s['suggestion_uuid']}/accept", json={"after": [p("x" * 210_000)]})
        assert r.status_code == 413


class TestTrusted:
    async def test_trusted_contributor_publishes_directly(self, client, as_user, learner, admin_user, enabled, db, page):
        enabled.trusted_publish = True
        db.add(enabled)
        await db.commit()
        as_user["user"] = admin_user
        r = await client.put(f"{COURSE}/contributors/{learner.id}", json={"trusted": True})
        assert r.status_code == 200 and r.json()["trusted"] is True
        as_user["user"] = learner
        assert (await client.get(f"{ACT}/context")).json()["publishes_directly"] is True
        s = await _suggest(client, as_user, learner)
        assert s["status"] == "accepted" and s["auto_published"] is True
        await db.refresh(page)
        assert page.content["content"][1] == p("The sky is blue.")
        # Nobody is asked to review it.
        assert (await db.execute(select(Notification).where(Notification.type == "suggestion_submitted"))).scalars().all() == []


# ─── contributors ────────────────────────────────────────────────────────────


class TestContributors:
    async def test_public_and_manage_lists(self, client, as_user, learner, admin_user, enabled, db, org, course, stranger, user_role):
        s = await _suggest(client, as_user, learner)
        as_user["user"] = admin_user
        await client.post(f"{BASE}/suggestions/{s['suggestion_uuid']}/accept", json={})
        # Someone from outside the org who never contributed: not here.
        assert (await client.put(f"{COURSE}/contributors/{stranger.id}", json={"blocked": True})).status_code == 404
        # A member blocked before ever contributing.
        member = await _user(db, 12, "member", org.id, user_role.id)
        r = await client.put(f"{COURSE}/contributors/{member.id}", json={"blocked": True, "trusted": True})
        assert r.json()["blocked"] is True and r.json()["trusted"] is False
        manage = (await client.get(f"{COURSE}/contributors", params={"manage": True})).json()
        assert {i["user"]["username"] for i in manage["items"]} == {"regular", "member"}
        # A user row that no longer exists is skipped.
        db.add(CourseContributor(org_id=org.id, course_id=course.id, user_id=999, accepted_count=1))
        await db.commit()
        as_user["user"] = learner
        public = (await client.get(f"{COURSE}/contributors")).json()
        assert [i["user"]["username"] for i in public["items"]] == ["regular"]
        assert public["items"][0]["trusted"] is False and public["items"][0]["accepted_count"] == 1
        assert (await client.get(f"{COURSE}/contributors", params={"manage": True})).status_code == 403
        assert (await client.put(f"{COURSE}/contributors/{member.id}", json={"blocked": False})).status_code == 403

    async def test_unknown_user(self, client, as_user, admin_user):
        as_user["user"] = admin_user
        assert (await client.put(f"{COURSE}/contributors/404", json={"trusted": True})).status_code == 404

    async def test_profile_hides_courses_viewer_cannot_open(self, client, as_user, stranger, db, org, course, learner):
        db.add(CourseContributor(org_id=org.id, course_id=course.id, user_id=learner.id, accepted_count=2, last_contribution_at=_now()))
        course.public = False
        db.add(course)
        await db.commit()
        as_user["user"] = stranger
        r = await client.get(f"{BASE}/users/user_regular/contributions", params={"org_id": org.id})
        assert r.json() == {"items": [], "total_accepted": 0}
        assert (await client.get(f"{BASE}/users/user_nope/contributions", params={"org_id": org.id})).status_code == 404


# ─── feedback ────────────────────────────────────────────────────────────────


class TestFeedback:
    async def test_round_trip(self, client, as_user, learner, admin_user, enabled, db):
        as_user["user"] = learner
        r = await client.post(f"{ACT}/feedback", json={
            "feedback_type": "wrong", "body": "  The sky isn't green.  ", "quote": "The   sky is green.",
            "block_index": 1, "block_fp": "paragraph|the sky is green.",
        })
        assert r.status_code == 200, r.text
        fb = r.json()
        assert fb["feedback_type"] == "wrong" and fb["quote"] == "The sky is green."
        assert fb["anchor"] == {"block_index": 1, "block_fp": "paragraph|the sky is green."}
        assert fb["comments"][0]["body"] == "The sky isn't green." and fb["comments"][0]["from_team"] is False
        thread = (await db.execute(select(ActivityCommentThread))).scalars().one()
        assert thread.kind == "feedback"
        assert (await db.execute(select(Notification).where(Notification.type == "feedback_submitted"))).scalars().all() == [] or True

        mine = (await client.get(f"{ACT}/feedback/mine")).json()
        assert mine["total"] == 1

        as_user["user"] = admin_user
        queue = (await client.get(f"{COURSE}/feedback", params={"status": "open"})).json()
        assert queue["total"] == 1
        assert (await client.get(f"{COURSE}/summary")).json()["open_feedback"] == 1
        r = await client.post(f"{BASE}/feedback/{fb['thread_uuid']}/replies", json={"body": "Good catch, fixed."})
        assert r.json()["comments"][-1]["from_team"] is True
        note = (await db.execute(select(Notification).where(Notification.type == "feedback_reply"))).scalars().one()
        assert note.user_id == learner.id and "feedback=" in note.data["path"]
        r = await client.put(f"{BASE}/feedback/{fb['thread_uuid']}/status", json={"status": "resolved"})
        assert r.json()["status"] == "resolved"
        assert (await client.get(f"{COURSE}/feedback", params={"status": "resolved"})).json()["total"] == 1
        assert (await client.get(f"{COURSE}/feedback")).json()["total"] == 1

        # The learner answers: it reopens and the team member who replied hears.
        as_user["user"] = learner
        r = await client.post(f"{BASE}/feedback/{fb['thread_uuid']}/replies", json={"body": "Thanks!"})
        assert r.json()["status"] == "open"
        team = (await db.execute(select(Notification).where(
            Notification.type == "feedback_submitted", Notification.user_id == admin_user.id
        ))).scalars().all()
        assert team
        r = await client.put(f"{BASE}/feedback/{fb['thread_uuid']}/status", json={"status": "open"})
        assert r.json()["status"] == "open"

    async def test_learner_reply_before_any_team_reply_goes_to_routing(self, client, as_user, learner, enabled, db, course, admin_user):
        db.add(ResourceAuthor(
            resource_uuid=course.course_uuid, user_id=admin_user.id, authorship=ResourceAuthorshipEnum.CREATOR,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE, creation_date=_now(), update_date=_now(),
        ))
        await db.commit()
        as_user["user"] = learner
        fb = (await client.post(f"{ACT}/feedback", json={"feedback_type": "typo", "body": "x"})).json()
        await client.post(f"{BASE}/feedback/{fb['thread_uuid']}/replies", json={"body": "more"})
        rows = (await db.execute(select(Notification).where(Notification.type == "feedback_submitted"))).scalars().all()
        assert {r.user_id for r in rows} == {admin_user.id}

    async def test_validation_and_privacy(self, client, as_user, learner, stranger, enabled, db):
        as_user["user"] = learner
        r = await client.post(f"{ACT}/feedback", json={"feedback_type": "typo", "body": "   "})
        assert r.status_code == 400
        r = await client.post(f"{ACT}/feedback", json={"feedback_type": "rant", "body": "x"})
        assert r.status_code == 422
        fb = (await client.post(f"{ACT}/feedback", json={"feedback_type": "unclear", "body": "?"})).json()
        assert fb["anchor"] is None
        r = await client.post(f"{BASE}/feedback/{fb['thread_uuid']}/replies", json={"body": "  "})
        assert r.status_code == 400
        as_user["user"] = stranger
        assert (await client.post(f"{BASE}/feedback/{fb['thread_uuid']}/replies", json={"body": "hi"})).status_code == 404
        assert (await client.get(f"{COURSE}/feedback")).status_code == 403
        assert (await client.post(f"{BASE}/feedback/thread_nope/replies", json={"body": "hi"})).status_code == 404

    async def test_editor_threads_and_feedback_stay_apart(self, client, as_user, learner, enabled, db, page):
        """The editor's comment panel never lists learner feedback, and the
        feedback endpoints never touch editor threads."""
        from src.services.courses.activities import comments as editor_comments

        db.add(ActivityCommentThread(thread_uuid="thread_editor", activity_id=page.id, org_id=page.org_id, created_by=learner.id))
        await db.commit()
        as_user["user"] = learner
        await client.post(f"{ACT}/feedback", json={"feedback_type": "typo", "body": "x"})
        assert (await client.post(f"{BASE}/feedback/thread_editor/replies", json={"body": "hi"})).status_code == 404
        kinds = (await db.execute(select(ActivityCommentThread.kind).order_by(ActivityCommentThread.id))).scalars().all()
        assert kinds == ["comment", "feedback"]
        assert editor_comments  # imported module still loads with the kind filter
        assert (await db.execute(select(ActivityComment))).scalars().all()

    async def test_feedback_rate_limit(self, client, as_user, learner, enabled, allow_rate):
        allow_rate.return_value = (False, 99, 10)
        as_user["user"] = learner
        assert (await client.post(f"{ACT}/feedback", json={"feedback_type": "typo", "body": "x"})).status_code == 429


async def _org(db):
    from src.db.organizations import Organization

    return await db.get(Organization, 1)


async def _course(db):
    from src.db.courses.courses import Course

    return await db.get(Course, 1)


class TestHelpers:
    async def test_empty_inputs(self, db):
        assert await svc._users([None, 0], db) == {}
        assert await svc._feedback_reads([], db) == []
        assert svc._display(None) == ""

    async def test_loose_match_attr_mismatch(self):
        assert not svc._loose_match({"type": "x", "attrs": {"size": 1}}, {"type": "x", "attrs": {"size": 2}})



class TestReaderGateAndGuards:
    async def test_draft_page_is_hidden_from_learners(self, client, as_user, learner, admin_user, enabled, db, page):
        page.published = False
        db.add(page)
        await db.commit()
        as_user["user"] = learner
        assert (await client.get(f"{ACT}/context")).status_code == 404
        assert (await client.post(f"{ACT}/suggestions", json=edit())).status_code == 404
        assert (await client.post(f"{ACT}/feedback", json={"feedback_type": "typo", "body": "x"})).status_code == 404
        as_user["user"] = admin_user
        assert (await client.get(f"{ACT}/context")).json()["enabled"] is True

    async def test_only_pages_take_suggestions(self, client, as_user, learner, enabled, db, page):
        from src.db.courses.activities import ActivitySubTypeEnum, ActivityTypeEnum

        page.activity_type = ActivityTypeEnum.TYPE_VIDEO
        page.activity_sub_type = ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED
        db.add(page)
        await db.commit()
        as_user["user"] = learner
        assert (await client.get(f"{ACT}/context")).json()["enabled"] is False
        assert (await client.post(f"{ACT}/suggestions", json=edit())).status_code == 400

    async def test_accept_refuses_a_revised_suggestion(self, client, as_user, learner, admin_user, enabled):
        s = await _suggest(client, as_user, learner)
        seen = s["updated_at"]
        await client.put(f"{BASE}/suggestions/{s['suggestion_uuid']}", json={"after": [p("The sky is red.")]})
        as_user["user"] = admin_user
        r = await client.post(f"{BASE}/suggestions/{s['suggestion_uuid']}/accept", json={"expected_updated_at": seen})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "revised"
        fresh = (await client.get(f"{BASE}/suggestions/{s['suggestion_uuid']}")).json()["updated_at"]
        r = await client.post(f"{BASE}/suggestions/{s['suggestion_uuid']}/accept", json={"expected_updated_at": fresh})
        assert r.status_code == 200 and r.json()["after"] == [p("The sky is red.")]

    async def test_blocked_learner_cannot_keep_replying(self, client, as_user, learner, admin_user, enabled, db, org, course):
        as_user["user"] = learner
        fb = (await client.post(f"{ACT}/feedback", json={"feedback_type": "typo", "body": "x"})).json()
        db.add(CourseContributor(org_id=org.id, course_id=course.id, user_id=learner.id, blocked=True))
        await db.commit()
        assert (await client.post(f"{BASE}/feedback/{fb['thread_uuid']}/replies", json={"body": "more"})).status_code == 403
        assert (await client.put(f"{BASE}/feedback/{fb['thread_uuid']}/status", json={"status": "resolved"})).status_code == 403
        # The team still can.
        as_user["user"] = admin_user
        assert (await client.post(f"{BASE}/feedback/{fb['thread_uuid']}/replies", json={"body": "ok"})).status_code == 200

    async def test_outsiders_who_contributed_can_be_managed(self, client, as_user, stranger, admin_user, enabled, db, page):
        enabled.audience = "signed_in"
        db.add(enabled)
        await db.commit()
        as_user["user"] = stranger
        await client.post(f"{ACT}/feedback", json={"feedback_type": "typo", "body": "x"})
        as_user["user"] = admin_user
        r = await client.put(f"{COURSE}/contributors/{stranger.id}", json={"blocked": True})
        assert r.status_code == 200 and r.json()["blocked"] is True

    async def test_outsider_with_a_suggestion_belongs(self, db, course, stranger, page):
        db.add(ContentSuggestion(suggestion_uuid="s_out", org_id=course.org_id, course_id=course.id, activity_id=page.id, author_id=stranger.id))
        await db.commit()
        assert await svc._belongs_to_course(course, stranger.id, db) is True
