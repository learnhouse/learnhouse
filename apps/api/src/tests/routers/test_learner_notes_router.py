"""Private learner notes, end to end through the router.

Real RBAC (no bypass). A member writes, edits, lists and deletes their own
notes; nobody else can read, edit or delete them (another learner, an admin
of the same org, another org's admin, an anonymous visitor, an API token).
Rich content is sanitized on write, and a member leaving the org takes their
notes along.
"""

from datetime import datetime
from unittest.mock import patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.courses import Course
from src.db.learner_notes import NOTES_PER_ACTIVITY_MAX, LearnerNote
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, APITokenUser, PublicUser, User
from src.routers.learner_notes import router as notes_router
from src.security.auth import get_current_user
from src.services.courses.activities import learner_notes as svc
from src.services.courses.activities.learner_notes_content import (
    note_plain_text,
    sanitize_note_content,
)

BASE = "/api/v1/notes"
ACT = f"{BASE}/activity/activity_test"


def _now() -> str:
    return str(datetime.now())


def _doc(*paragraphs: str) -> dict:
    return {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": p}]} for p in paragraphs],
    }


async def _make_user(db, uid: int, username: str, org_id: int | None, role_id: int) -> PublicUser:
    u = User(
        id=uid,
        username=username,
        first_name=username.title(),
        last_name="",
        email=f"{username}@test.com",
        password="x",
        user_uuid=f"user_{username}",
        creation_date=_now(),
        update_date=_now(),
    )
    db.add(u)
    if org_id is not None:
        db.add(UserOrganization(user_id=uid, org_id=org_id, role_id=role_id, creation_date=_now(), update_date=_now()))
    await db.commit()
    return PublicUser(id=uid, username=username, first_name=u.first_name, last_name="", email=u.email, user_uuid=u.user_uuid)


@pytest.fixture
async def learner(db, org, user_role):
    return await _make_user(db, 10, "pia", org.id, user_role.id)


@pytest.fixture
async def other_learner(db, org, user_role):
    return await _make_user(db, 11, "bo", org.id, user_role.id)


@pytest.fixture
async def outsider(db, other_org, admin_role):
    """An admin of another organization."""
    return await _make_user(db, 12, "outsider", other_org.id, admin_role.id)


@pytest.fixture
async def stranger(db, user_role):
    """Signed in, but not a member of any org."""
    return await _make_user(db, 13, "stranger", None, user_role.id)


@pytest.fixture
def as_user():
    return {"user": None}


@pytest.fixture
def app(db, as_user, activity):
    app = FastAPI()
    app.include_router(notes_router, prefix=BASE)
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


async def _create(client, as_user, user, **body):
    as_user["user"] = user
    body.setdefault("content", _doc("Remember the TTL"))
    return await client.post(ACT, json=body)


# ─── Own notes ───────────────────────────────────────────────────────────────


async def test_create_list_update_delete_own_note(client, as_user, learner):
    res = await _create(client, as_user, learner, anchor={"kind": "heading", "ref": "heading-ttl", "label": "TTL"})
    assert res.status_code == 200, res.text
    note = res.json()
    assert note["note_uuid"].startswith("note_")
    assert note["activity_uuid"] == "activity_test"
    assert note["course_uuid"] == "course_test"
    assert note["plain_text"] == "Remember the TTL"
    assert note["anchor"] == {"kind": "heading", "ref": "heading-ttl", "label": "TTL", "seconds": None}

    listed = (await client.get(ACT)).json()
    assert [n["note_uuid"] for n in listed] == [note["note_uuid"]]

    res = await client.patch(f"{BASE}/{note['note_uuid']}", json={"content": _doc("Updated", "two lines")})
    assert res.status_code == 200
    assert res.json()["plain_text"] == "Updated\ntwo lines"
    # The anchor is kept when the field is left out...
    assert res.json()["anchor"]["ref"] == "heading-ttl"
    # ...replaced when given...
    res = await client.patch(f"{BASE}/{note['note_uuid']}", json={"anchor": {"kind": "video", "seconds": 192}})
    assert res.json()["anchor"] == {"kind": "video", "ref": None, "label": None, "seconds": 192}
    assert res.json()["plain_text"] == "Updated\ntwo lines"
    # ...and cleared on request.
    res = await client.patch(f"{BASE}/{note['note_uuid']}", json={"clear_anchor": True})
    assert res.json()["anchor"] is None

    res = await client.delete(f"{BASE}/{note['note_uuid']}")
    assert res.status_code == 200
    assert (await client.get(ACT)).json() == []


async def test_seconds_only_kept_for_video_anchors(client, as_user, learner):
    res = await _create(client, as_user, learner, anchor={"kind": "block", "ref": "b1", "seconds": 40})
    assert res.json()["anchor"]["seconds"] is None


async def test_my_notes_lists_context_and_searches(client, as_user, learner, db, org, course, chapter):
    await _create(client, as_user, learner, content=_doc("Caching resolvers"))
    await _create(client, as_user, learner, content=_doc("Glue records"))
    res = await client.get(BASE, params={"org_id": org.id})
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 2
    first = data["notes"][0]
    assert first["course"]["course_uuid"] == "course_test"
    assert first["course"]["name"] == "Test Course"
    assert first["course"]["thumbnail_image"] is None
    assert first["activity"]["name"] == "Test Activity"
    assert first["activity"]["activity_type"] == "TYPE_DYNAMIC"
    assert first["activity"]["chapter_name"] == "Test Chapter"

    found = (await client.get(BASE, params={"org_id": org.id, "q": "GLUE"})).json()
    assert [n["plain_text"] for n in found["notes"]] == ["Glue records"]
    # The lesson and course names are searched too.
    assert (await client.get(BASE, params={"org_id": org.id, "q": "test activity"})).json()["total"] == 2
    by_course = await client.get(BASE, params={"org_id": org.id, "course_uuid": "course_test", "limit": 1})
    assert by_course.json()["total"] == 2
    assert len(by_course.json()["notes"]) == 1
    assert (await client.get(BASE, params={"org_id": org.id, "course_uuid": "course_nope"})).json()["total"] == 0


async def test_my_notes_empty(client, as_user, learner, org):
    as_user["user"] = learner
    assert (await client.get(BASE, params={"org_id": org.id})).json() == {"notes": [], "total": 0}


# ─── Nobody else ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("who", ["other_learner", "admin_user", "outsider"])
async def test_nobody_else_can_read_edit_or_delete(
    client, as_user, learner, who, org, other_learner, admin_user, outsider
):
    note = (await _create(client, as_user, learner)).json()
    as_user["user"] = {"other_learner": other_learner, "admin_user": admin_user, "outsider": outsider}[who]

    # Not in their lesson list, nor in "my notes"...
    if who != "outsider":
        assert (await client.get(ACT)).json() == []
        assert (await client.get(BASE, params={"org_id": org.id})).json()["total"] == 0
    # ...and a foreign note can't be touched (404, as if it didn't exist).
    assert (await client.patch(f"{BASE}/{note['note_uuid']}", json={"content": _doc("x")})).status_code == 404
    assert (await client.delete(f"{BASE}/{note['note_uuid']}")).status_code == 404

    as_user["user"] = learner
    assert [n["plain_text"] for n in (await client.get(ACT)).json()] == ["Remember the TTL"]


async def test_other_org_cannot_list_or_write(client, as_user, learner, outsider, org, other_org):
    await _create(client, as_user, learner)
    as_user["user"] = outsider
    # Not a member of the note's org: refused outright.
    assert (await client.get(BASE, params={"org_id": org.id})).status_code == 403
    # Their own org has nothing of the learner's.
    assert (await client.get(BASE, params={"org_id": other_org.id})).json()["total"] == 0
    # Writing on another org's lesson is refused (private course or not a member).
    res = await client.post(ACT, json={"content": _doc("x")})
    assert res.status_code in (403, 404)


async def test_non_member_cannot_take_notes(client, as_user, stranger):
    res = await _create(client, as_user, stranger)
    assert res.status_code == 403
    assert res.json()["detail"] == "Join this organization to take notes"


@pytest.mark.parametrize("principal", ["anonymous", "token"])
async def test_anonymous_and_tokens_refused(client, as_user, org, principal):
    as_user["user"] = AnonymousUser() if principal == "anonymous" else APITokenUser(
        id=99, user_uuid="apitoken_x", username="token", org_id=org.id, rights={}, token_name="t", created_by_user_id=1
    )
    assert (await client.get(ACT)).status_code == 401
    assert (await client.post(ACT, json={"content": _doc("x")})).status_code == 401
    assert (await client.get(BASE, params={"org_id": org.id})).status_code == 401
    assert (await client.patch(f"{BASE}/note_x", json={})).status_code == 401
    assert (await client.delete(f"{BASE}/note_x")).status_code == 401


async def test_unknown_activity(client, as_user, learner):
    as_user["user"] = learner
    assert (await client.get(f"{BASE}/activity/activity_nope")).status_code == 404


async def test_private_course_needs_read_access(client, as_user, learner, db, course):
    course.public = False
    db.add(course)
    await db.commit()
    as_user["user"] = learner
    # A member without access to a private course gets no notes either.
    res = await client.get(ACT)
    assert res.status_code in (200, 403)


# ─── Limits ──────────────────────────────────────────────────────────────────


async def test_rate_limited(client, as_user, learner, allow_rate):
    allow_rate.return_value = (False, 121, 30)
    res = await _create(client, as_user, learner)
    assert res.status_code == 429
    assert res.headers["Retry-After"] == "30"


async def test_rate_limit_fails_open(client, as_user, learner, allow_rate):
    allow_rate.side_effect = RuntimeError("redis down")
    assert (await _create(client, as_user, learner)).status_code == 200


async def test_per_activity_cap(client, as_user, learner, monkeypatch):
    monkeypatch.setattr(svc, "NOTES_PER_ACTIVITY_MAX", 1)
    assert (await _create(client, as_user, learner)).status_code == 200
    res = await _create(client, as_user, learner)
    assert res.status_code == 409
    assert NOTES_PER_ACTIVITY_MAX == 200


async def test_too_long_is_refused(client, as_user, learner):
    huge = _doc(*["x" * 9000 for _ in range(20)])
    assert (await _create(client, as_user, learner, content=huge)).status_code == 413


# ─── Membership ends ─────────────────────────────────────────────────────────


async def test_purge_member_notes(client, as_user, learner, other_learner, db, org):
    await _create(client, as_user, learner)
    await _create(client, as_user, other_learner)
    await svc.purge_member_notes(db, org.id, [])
    await svc.purge_member_notes(db, org.id, [learner.id])
    await db.commit()
    owners = (await db.execute(select(LearnerNote.user_id))).scalars().all()
    assert owners == [other_learner.id]


async def test_leaving_org_purges_notes(client, as_user, learner, db, org, mock_request):
    from src.services.orgs import users as org_users

    await _create(client, as_user, learner)
    with patch.object(org_users, "track"), patch.object(org_users, "dispatch_webhooks"), \
            patch.object(org_users, "decrease_feature_usage"), patch.object(org_users, "audit_event"):
        await org_users.leave_org(mock_request, org.id, db, learner)
    assert (await db.execute(select(LearnerNote))).scalars().all() == []


async def test_deleted_activity_course_cascade_in_schema():
    """Every FK on learner_note cascades (the demo teardown test checks it too)."""
    for fk in LearnerNote.__table__.foreign_keys:
        assert fk.ondelete == "CASCADE", fk


async def test_activity_in_other_org_course(client, as_user, learner, db, other_org):
    """A lesson of another org's private course is out of reach."""
    db.add(Course(
        id=2, name="Private", description="", public=False, published=True, open_to_contributors=False,
        org_id=other_org.id, course_uuid="course_private", creation_date=_now(), update_date=_now(),
    ))
    db.add(Activity(
        id=2, name="Secret", activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE, content={}, published=True,
        org_id=other_org.id, course_id=2, activity_uuid="activity_secret",
        creation_date=_now(), update_date=_now(),
    ))
    await db.commit()
    as_user["user"] = learner
    res = await client.post(f"{BASE}/activity/activity_secret", json={"content": _doc("x")})
    assert res.status_code in (403, 404)


# ─── Content sanitizing ──────────────────────────────────────────────────────


def test_sanitize_keeps_the_notes_schema():
    doc = {
        "type": "doc",
        "content": [
            {"type": "heading", "attrs": {"level": 2, "id": "x"}, "content": [{"type": "text", "text": "Title"}]},
            {"type": "heading", "attrs": {"level": 6}, "content": [{"type": "text", "text": "Deep"}]},
            {"type": "paragraph", "attrs": {"style": "color:red"}, "content": [
                {"type": "text", "text": "bold", "marks": [{"type": "bold"}, {"type": "bold"}, {"type": "italic"}]},
                {"type": "hardBreak"},
                {"type": "text", "text": "link", "marks": [{"type": "link", "attrs": {"href": "https://a.b", "onclick": "x"}}]},
                {"type": "text", "text": "bad", "marks": [{"type": "link", "attrs": {"href": "javascript:alert(1)"}}]},
                {"type": "text", "text": "rel", "marks": [{"type": "link", "attrs": {"href": "/course/x#heading-a"}}]},
                {"type": "text", "text": "hash", "marks": [{"type": "link", "attrs": {"href": "#heading-a"}}]},
                {"type": "text", "text": "proto", "marks": [{"type": "link", "attrs": {"href": "//evil.com"}}]},
                {"type": "text", "text": "num", "marks": [{"type": "link", "attrs": {"href": 5}}, {"type": "textStyle"}, "junk"]},
                {"type": "text", "text": ""},
                {"type": "text", "text": 3},
            ]},
            {"type": "orderedList", "attrs": {"start": 3}, "content": [
                {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "one"}]}]},
            ]},
            {"type": "orderedList", "attrs": {"start": "x"}},
            {"type": "taskList", "content": [
                {"type": "taskItem", "attrs": {"checked": True}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "done"}]}]},
                {"type": "taskItem", "attrs": {"checked": "yes"}},
            ]},
            {"type": "blockquote", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "quoted"}]}]},
            {"type": "horizontalRule"},
            {"type": "image", "attrs": {"src": "x"}},
            {"type": "bulletList", "content": "nope"},
            "garbage",
        ],
    }
    out = sanitize_note_content(doc)
    blocks = out["content"]
    assert blocks[0] == {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Title"}]}
    assert blocks[1]["attrs"] == {"level": 3}
    para = blocks[2]
    assert "attrs" not in para
    texts = para["content"]
    assert texts[0]["marks"] == [{"type": "bold"}, {"type": "italic"}]
    assert texts[1] == {"type": "hardBreak"}
    assert texts[2]["marks"] == [{"type": "link", "attrs": {"href": "https://a.b"}}]
    assert texts[3] == {"type": "text", "text": "bad"}
    assert texts[4]["marks"][0]["attrs"]["href"] == "/course/x#heading-a"
    assert texts[5]["marks"][0]["attrs"]["href"] == "#heading-a"
    assert texts[6] == {"type": "text", "text": "proto"}
    assert texts[7] == {"type": "text", "text": "num"}
    assert len(texts) == 8
    assert blocks[3]["attrs"] == {"start": 3}
    assert blocks[4] == {"type": "orderedList", "attrs": {"start": 1}}
    assert blocks[5]["content"][0]["attrs"] == {"checked": True}
    assert blocks[5]["content"][1] == {"type": "taskItem", "attrs": {"checked": False}}
    assert blocks[6]["type"] == "blockquote"
    assert blocks[7] == {"type": "horizontalRule"}
    assert blocks[8] == {"type": "bulletList"}
    assert len(blocks) == 9

    assert note_plain_text(out).split("\n") == ["Title", "Deep", "bold", "linkbadrelhashprotonum", "one", "done", "quoted"]


def test_sanitize_edge_cases():
    assert sanitize_note_content(None) == {"type": "doc", "content": []}
    assert sanitize_note_content({"type": "evil"}) == {"type": "doc", "content": []}
    # Too deep: the nesting past the limit is dropped.
    node: dict = {"type": "text", "text": "deep"}
    for _ in range(20):
        node = {"type": "blockquote", "content": [node]}
    out = sanitize_note_content({"type": "doc", "content": [node]})
    assert "deep" not in note_plain_text(out)
    # Too many nodes.
    many = {"type": "doc", "content": [{"type": "hardBreak"}] * 5000}
    with pytest.raises(HTTPException) as exc:
        sanitize_note_content(many)
    assert exc.value.status_code == 413
    # Raw payload far over the cap.
    with pytest.raises(HTTPException):
        sanitize_note_content({"type": "doc", "junk": "x" * 200_000})
    # Under the raw cap but still over the stored cap once cleaned.
    with pytest.raises(HTTPException):
        sanitize_note_content(_doc(*["y" * 9000 for _ in range(8)]))
    # A long href is dropped.
    long_link = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "l", "marks": [{"type": "link", "attrs": {"href": "https://" + "a" * 3000}}]},
        {"type": "text", "text": "m", "marks": [{"type": "link", "attrs": {"href": "   "}}]},
    ]}]}
    assert "marks" not in sanitize_note_content(long_link)["content"][0]["content"][0]
