"""Editor comments on activity content, end to end through the router.

Real RBAC (no bypass): an org admin and a course contributor may comment; a
learner, an anonymous visitor, an API token and another org's admin may not.
Authors edit and delete their own comments, admins delete anyone's, threads
resolve and reopen, deletes are soft, and @mentions are validated against who
may edit the course before anyone is emailed.
"""

from contextlib import asynccontextmanager
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.activity_comments import ActivityComment, ActivityCommentThread
from src.db.nudges import EmailPreference
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.roles import Role, RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, PublicUser, User
from src.routers.courses.activities.comments import router as comments_router
from src.security.auth import get_current_user
from src.services.courses.activities import comments as svc
from src.services.courses.activities import comments_email

BASE = "/api/v1/activities"
URL = f"{BASE}/activity_test/comments"
EMAIL = "src.services.courses.activities.comments_email.send_mention_emails"
# The real sender, kept before the autouse fixture below swaps it out.
SEND_MENTION_EMAILS = comments_email.send_mention_emails


def _now() -> str:
    return str(datetime.now())


async def _make_user(db, uid: int, username: str, org_id: int, role_id: int, **extra) -> PublicUser:
    u = User(
        id=uid,
        username=username,
        first_name=extra.get("first_name", username.title()),
        last_name="",
        email=extra.get("email", f"{username}@test.com"),
        password="x",
        user_uuid=f"user_{username}",
        creation_date=_now(),
        update_date=_now(),
    )
    db.add(u)
    db.add(UserOrganization(user_id=uid, org_id=org_id, role_id=role_id, creation_date=_now(), update_date=_now()))
    await db.commit()
    return PublicUser(
        id=uid, username=username, first_name=u.first_name, last_name="", email=u.email, user_uuid=u.user_uuid
    )


@pytest.fixture
async def contributor(db, org, course, user_role):
    """A member with read-only rights who edits this course as its contributor."""
    user = await _make_user(db, 3, "contrib", org.id, user_role.id)
    db.add(ResourceAuthor(
        resource_uuid=course.course_uuid,
        user_id=3,
        authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date=_now(),
        update_date=_now(),
    ))
    await db.commit()
    return user


@pytest.fixture
async def instructor(db, org):
    """A member whose org-scoped role may update any course."""
    role = Role(
        id=7,
        name="Instructor",
        org_id=org.id,
        role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_instructor",
        rights={"courses": {"action_update": True}},
        creation_date=_now(),
        update_date=_now(),
    )
    db.add(role)
    await db.commit()
    return await _make_user(db, 4, "teach", org.id, 7, first_name="Tina")


@pytest.fixture
async def outsider_admin(db, other_org, admin_role):
    """An admin, but of another organization."""
    return await _make_user(db, 5, "outsider", other_org.id, admin_role.id)


@pytest.fixture
def as_user():
    holder = {"user": None}
    return holder


@pytest.fixture
def app(db, as_user, activity):
    app = FastAPI()
    app.include_router(comments_router, prefix=BASE)
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
    with patch(
        "src.services.security.rate_limiting.check_rate_limit", return_value=(True, 1, 60)
    ) as m:
        yield m


@pytest.fixture(autouse=True)
def mention_mail():
    with patch(EMAIL, new_callable=AsyncMock) as m:
        yield m


async def _create(client, body="Looks off", quote="the  quick\nfox", mentions=None):
    resp = await client.post(URL, json={"quote": quote, "body": body, "mentions": mentions or []})
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestPermissions:
    async def test_admin_creates_and_lists(self, client, as_user, admin_user):
        as_user["user"] = admin_user
        thread = await _create(client)
        assert thread["thread_uuid"].startswith("thread_")
        assert thread["quote"] == "the quick fox"  # whitespace collapsed
        assert thread["status"] == "open"
        assert thread["created_by"]["username"] == "admin"
        assert thread["comments"][0]["body"] == "Looks off"
        assert thread["comments"][0]["comment_uuid"].startswith("comment_")

        listing = (await client.get(URL)).json()
        assert listing["can_moderate"] is True
        assert listing["current_user_id"] == admin_user.id
        assert [t["thread_uuid"] for t in listing["threads"]] == [thread["thread_uuid"]]

    async def test_empty_list(self, client, as_user, admin_user):
        as_user["user"] = admin_user
        assert (await client.get(URL)).json()["threads"] == []

    async def test_contributor_may_comment(self, client, as_user, contributor):
        as_user["user"] = contributor
        await _create(client)
        listing = (await client.get(URL)).json()
        assert listing["can_moderate"] is False
        assert len(listing["threads"]) == 1

    async def test_learner_is_refused(self, client, as_user, regular_user, admin_user):
        as_user["user"] = admin_user
        await _create(client)
        as_user["user"] = regular_user
        assert (await client.get(URL)).status_code == 403
        resp = await client.post(URL, json={"quote": "x", "body": "hi"})
        assert resp.status_code == 403

    async def test_anonymous_is_refused(self, client, as_user, anonymous_user):
        as_user["user"] = anonymous_user
        assert (await client.get(URL)).status_code == 401

    async def test_api_token_is_refused(self, client, as_user, org):
        as_user["user"] = APITokenUser(
            id=0, user_uuid="apitoken_x", username="api_token", org_id=org.id,
            rights={}, token_name="t", created_by_user_id=1,
        )
        assert (await client.get(URL)).status_code == 401

    async def test_other_org_admin_is_refused(self, client, as_user, outsider_admin, admin_user):
        as_user["user"] = admin_user
        thread = await _create(client)
        as_user["user"] = outsider_admin
        assert (await client.get(URL)).status_code == 403
        resp = await client.post(f"{URL}/{thread['thread_uuid']}/replies", json={"body": "hi"})
        assert resp.status_code == 403

    async def test_unknown_activity_404(self, client, as_user, admin_user):
        as_user["user"] = admin_user
        assert (await client.get(f"{BASE}/activity_nope/comments")).status_code == 404

    async def test_thread_of_another_activity_404(self, client, as_user, admin_user, db, org, course):
        as_user["user"] = admin_user
        other = Activity(
            id=9, name="Other", activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE, content={}, published=True,
            org_id=org.id, course_id=course.id, activity_uuid="activity_other",
            creation_date=_now(), update_date=_now(),
        )
        db.add(other)
        await db.commit()
        thread = await _create(client)
        resp = await client.post(
            f"{BASE}/activity_other/comments/{thread['thread_uuid']}/replies", json={"body": "hi"}
        )
        assert resp.status_code == 404


class TestConversation:
    async def test_reply_edit_delete_own(self, client, as_user, admin_user, contributor):
        as_user["user"] = admin_user
        thread = await _create(client)
        tid = thread["thread_uuid"]

        as_user["user"] = contributor
        replied = (await client.post(f"{URL}/{tid}/replies", json={"body": "Agreed"})).json()
        assert [c["body"] for c in replied["comments"]] == ["Looks off", "Agreed"]
        mine = replied["comments"][1]["comment_uuid"]
        theirs = replied["comments"][0]["comment_uuid"]

        edited = (await client.patch(f"{URL}/{tid}/{mine}", json={"body": "  Agreed, fixing  "})).json()
        assert edited["comments"][1]["body"] == "Agreed, fixing"
        assert edited["comments"][1]["edited_at"]

        # Not the author: neither edit nor delete.
        assert (await client.patch(f"{URL}/{tid}/{theirs}", json={"body": "x"})).status_code == 403
        assert (await client.delete(f"{URL}/{tid}/{theirs}")).status_code == 403

        deleted = (await client.delete(f"{URL}/{tid}/{mine}")).json()
        gone = deleted["comments"][1]
        assert gone["deleted"] is True and gone["body"] == "" and gone["mentions"] == []
        # Soft: the row is still there, emptied.
        assert (await client.patch(f"{URL}/{tid}/{mine}", json={"body": "back"})).status_code == 404

    async def test_admin_deletes_anyone_but_edits_only_own(self, client, as_user, admin_user, contributor, db):
        as_user["user"] = contributor
        thread = await _create(client, body="mine")
        tid, cid = thread["thread_uuid"], thread["comments"][0]["comment_uuid"]
        as_user["user"] = admin_user
        assert (await client.patch(f"{URL}/{tid}/{cid}", json={"body": "x"})).status_code == 403
        resp = await client.delete(f"{URL}/{tid}/{cid}")
        assert resp.status_code == 200
        row = (await db.execute(select(ActivityComment).where(ActivityComment.comment_uuid == cid))).scalars().one()
        assert row.deleted is True and row.body == ""
        # Every comment deleted: the thread is gone from the list.
        assert (await client.get(URL)).json()["threads"] == []

    async def test_root_deleted_keeps_replies(self, client, as_user, admin_user):
        as_user["user"] = admin_user
        thread = await _create(client)
        tid, root = thread["thread_uuid"], thread["comments"][0]["comment_uuid"]
        await client.post(f"{URL}/{tid}/replies", json={"body": "reply"})
        await client.delete(f"{URL}/{tid}/{root}")
        listed = (await client.get(URL)).json()["threads"][0]
        assert [c["deleted"] for c in listed["comments"]] == [True, False]

    async def test_resolve_and_reopen(self, client, as_user, admin_user, contributor):
        as_user["user"] = admin_user
        tid = (await _create(client))["thread_uuid"]
        as_user["user"] = contributor
        resolved = (await client.patch(f"{URL}/{tid}", json={"status": "resolved"})).json()
        assert resolved["status"] == "resolved"
        assert resolved["resolved_by"]["username"] == "contrib"
        first_at = resolved["resolved_at"]
        # Resolving again keeps who and when.
        as_user["user"] = admin_user
        again = (await client.patch(f"{URL}/{tid}", json={"status": "resolved"})).json()
        assert again["resolved_by"]["username"] == "contrib" and again["resolved_at"] == first_at
        reopened = (await client.patch(f"{URL}/{tid}", json={"status": "open"})).json()
        assert reopened["status"] == "open" and reopened["resolved_by"] is None and reopened["resolved_at"] is None
        assert (await client.patch(f"{URL}/{tid}", json={"status": "bogus"})).status_code == 422

    async def test_validation(self, client, as_user, admin_user):
        as_user["user"] = admin_user
        assert (await client.post(URL, json={"quote": "x", "body": ""})).status_code == 422
        assert (await client.post(URL, json={"quote": "x", "body": "   \n "})).status_code == 400
        assert (await client.post(URL, json={"quote": "x", "body": "a" * 5001})).status_code == 422
        long_quote = (await _create(client, quote="q" * 900))["quote"]
        assert len(long_quote) == 500
        tid = (await _create(client))["thread_uuid"]
        assert (await client.post(f"{URL}/thread_nope/replies", json={"body": "x"})).status_code == 404
        assert (await client.delete(f"{URL}/{tid}/comment_nope")).status_code == 404

    async def test_author_removed_shows_no_author(self, client, as_user, admin_user, db):
        as_user["user"] = admin_user
        tid = (await _create(client))["thread_uuid"]
        thread = (await db.execute(select(ActivityCommentThread))).scalars().one()
        thread.created_by = None
        db.add(thread)
        comment = (await db.execute(select(ActivityComment))).scalars().one()
        comment.author_id = None
        db.add(comment)
        await db.commit()
        listed = (await client.get(URL)).json()["threads"][0]
        assert listed["thread_uuid"] == tid
        assert listed["created_by"] is None and listed["comments"][0]["author"] is None


class TestMentions:
    async def test_mentionable_lists_course_editors(
        self, client, as_user, admin_user, contributor, instructor, regular_user, outsider_admin
    ):
        as_user["user"] = admin_user
        names = [u["username"] for u in (await client.get(f"{URL}/mentionable")).json()]
        assert names == ["admin", "contrib", "teach"]  # not the learner, not the other org
        found = (await client.get(f"{URL}/mentionable", params={"q": "@TIN"})).json()
        assert [u["username"] for u in found] == ["teach"]

    async def test_mentions_are_validated_and_mailed(
        self, client, as_user, admin_user, contributor, regular_user, mention_mail
    ):
        as_user["user"] = admin_user
        thread = await _create(client, body="@contrib look", mentions=[3, 2, 1, 3, 999])
        # Self, learner and unknown ids are dropped; duplicates collapse.
        assert thread["comments"][0]["mentions"] == [3]
        mention_mail.assert_awaited_once()
        kwargs = mention_mail.await_args.kwargs
        assert kwargs["mention_ids"] == [3]
        assert kwargs["thread_uuid"] == thread["thread_uuid"]
        assert kwargs["author_id"] == admin_user.id

    async def test_typed_handles_count_as_mentions(
        self, client, as_user, admin_user, contributor, instructor, regular_user, mention_mail
    ):
        as_user["user"] = admin_user
        thread = await _create(client, body="Ping @Teach. and @regular, cc @admin @nobody")
        # Only course editors other than the author; the learner is not mentioned.
        assert thread["comments"][0]["mentions"] == [4]
        assert mention_mail.await_args.kwargs["mention_ids"] == [4]

    def test_body_handles(self):
        assert svc.body_handles("hi @a.b. and @c-, mail x@y.com @@z") == {"a.b", "c"}

    async def test_no_mail_without_mentions(self, client, as_user, admin_user, mention_mail):
        as_user["user"] = admin_user
        await _create(client)
        mention_mail.assert_not_awaited()

    async def test_reply_and_edit_mail_only_new_mentions(
        self, client, as_user, admin_user, contributor, instructor, mention_mail
    ):
        as_user["user"] = admin_user
        tid = (await _create(client))["thread_uuid"]
        replied = (await client.post(f"{URL}/{tid}/replies", json={"body": "@contrib", "mentions": [3]})).json()
        assert mention_mail.await_args.kwargs["mention_ids"] == [3]
        cid = replied["comments"][1]["comment_uuid"]
        mention_mail.reset_mock()
        await client.patch(f"{URL}/{tid}/{cid}", json={"body": "@contrib @teach", "mentions": [3, 4]})
        assert mention_mail.await_args.kwargs["mention_ids"] == [4]


class TestRateLimit:
    async def test_limited_writes_get_429(self, client, as_user, admin_user, allow_rate):
        as_user["user"] = admin_user
        allow_rate.return_value = (False, 31, 42)
        resp = await client.post(URL, json={"quote": "x", "body": "hi"})
        assert resp.status_code == 429
        assert resp.headers["retry-after"] == "42"

    async def test_redis_down_fails_open(self, client, as_user, admin_user, allow_rate):
        as_user["user"] = admin_user
        allow_rate.side_effect = ConnectionError("no redis")
        await _create(client)


class TestMentionEmail:
    @pytest.fixture
    def mailer(self):
        with patch("src.services.email.utils.send_email") as send, patch(
            "src.services.email.utils.get_org_signup_base_url",
            new_callable=AsyncMock,
            return_value="https://acme.test/",
        ):
            yield send

    async def _send(self, db, mention_ids, **kw):
        return await SEND_MENTION_EMAILS(
            None, course_id=1, activity_id=1, thread_uuid="thread_t", quote="the fox",
            author_id=1, body=kw.get("body", "please <b>check</b>"), mention_ids=mention_ids,
            db_session=db,
        )

    async def test_sends_branded_mail_with_link(self, db, activity, admin_user, contributor, mailer):
        assert await self._send(db, [3]) == 1
        kwargs = mailer.call_args.kwargs
        assert kwargs["to"] == "contrib@test.com"
        assert kwargs["subject"] == "Admin User mentioned you in Test Activity"
        page = kwargs["body"]
        assert "https://acme.test/course/test/activity/test/edit?thread=thread_t" in page
        assert "&lt;b&gt;check&lt;/b&gt;" in page and "<b>check</b>" not in page
        assert "the fox" in page

    async def test_long_body_is_cut(self, db, activity, admin_user, contributor, mailer):
        await self._send(db, [3], body="x" * 700)
        assert "x" * 600 + "…" in mailer.call_args.kwargs["body"]

    async def test_opted_out_and_missing_users_skipped(self, db, activity, admin_user, contributor, instructor, mailer):
        db.add(EmailPreference(user_id=4, lifecycle_opt_out=True))
        await db.commit()
        assert await self._send(db, [3, 4, 404]) == 1
        assert await self._send(db, [4]) == 0

    async def test_user_without_email_skipped(self, db, activity, admin_user, contributor, mailer):
        user = await db.get(User, 3)
        user.email = ""
        db.add(user)
        await db.commit()
        assert await self._send(db, [3]) == 0
        mailer.assert_not_called()

    async def test_failed_send_does_not_stop_others(self, db, activity, admin_user, contributor, instructor, mailer):
        mailer.side_effect = [RuntimeError("provider down"), None]
        assert await self._send(db, [3, 4]) == 1

    async def test_demo_org_never_mails(self, db, org, activity, admin_user, contributor, mailer):
        org.is_demo = True
        db.add(org)
        await db.commit()
        assert await self._send(db, [3]) == 0

    async def test_unknown_activity(self, db, org, admin_user, mailer):
        assert await self._send(db, [3]) == 0

    async def test_opens_its_own_session(self, db, activity, admin_user, contributor, mailer):
        @asynccontextmanager
        async def factory():
            yield db

        with patch("src.core.events.database._async_session_factory", factory):
            sent = await SEND_MENTION_EMAILS(
                None, course_id=1, activity_id=1, thread_uuid="thread_t", quote="",
                author_id=999, body="hi", mention_ids=[3],
            )
        assert sent == 1
        # Unknown author still reads as a person, and no quote block.
        assert mailer.call_args.kwargs["subject"].startswith("Someone mentioned you")

    def test_display_name_falls_back_to_username(self):
        user = User(username="kit", first_name="", last_name="", email="k@x.com", password="x", user_uuid="u")
        assert comments_email._display_name(user) == "kit"


def test_background_task_skipped_without_queue():
    # Called outside a request (no BackgroundTasks): nothing to schedule.
    svc._notify_mentions(
        None, None, course=None, activity=None, thread=None, author=None, body="", mention_ids=[1]
    )
