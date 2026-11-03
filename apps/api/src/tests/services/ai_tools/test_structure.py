"""Edge cases and refusals across the structure, people, settings, library,
playground, board, community and media-from-URL tools.

Everything runs through `run_tool` (validation, scope, rights pre-flight,
approval gate, execute) unless a helper is only reachable directly. The
security cases come first in each section: ids from another course or
organization, rights the caller does not hold, settings that must stay out
of reach, and URLs or files the media fetcher must refuse.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import httpx
import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.boards import Board, BoardMember
from src.db.communities.communities import Community
from src.db.communities.discussions import Discussion
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter, LockType
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.db.folders.folder_content import FolderContent
from src.db.folders.folders import Folder
from src.db.media.media import Media
from src.db.organization_config import OrganizationConfig
from src.db.playgrounds import Playground
from src.db.podcasts.podcasts import Podcast
from src.db.roles import Role, RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import AnonymousUser, APITokenUser, PublicUser, User
from src.services.ai.tools import (
    ToolContext,
    ToolRegistry,
    make_synthetic_request,
    run_tool,
)
from src.services.ai.tools import activities as activity_tools
from src.services.ai.tools import boards as board_tools
from src.services.ai.tools import chapters as chapter_tools
from src.services.ai.tools import communities as community_tools
from src.services.ai.tools import content_assets
from src.services.ai.tools import courses as course_tools
from src.services.ai.tools import library as library_tools
from src.services.ai.tools import org as org_tools
from src.services.ai.tools import playgrounds as playground_tools
from src.services.ai.tools import roles as role_tools
from src.services.ai.tools import usergroups as group_tools
from src.services.ai.tools import users as user_tools
from src.tests.conftest import ADMIN_RIGHTS, USER_RIGHTS
from src.tests.services.ai_tools.test_content import PNG, PUBLIC_IP, FakeNet
from src.tests.services.ai_tools.test_courses import _add_activity, _add_chapter
from src.tests.services.ai_tools.test_people_org import FakeRedis, _config

NOW = str(datetime(2026, 1, 1, 12, 0, 0))
BASE = "https://test-org.example"


# ─── environment ─────────────────────────────────────────────────────────────


@pytest.fixture
def fake_redis():
    return FakeRedis()


@pytest.fixture(autouse=True)
def environment(fake_redis):
    """Plan counters, webhooks, mail, Redis and links replaced by fakes."""
    cfg = SimpleNamespace(redis_config=SimpleNamespace(redis_connection_string="redis://fake"))
    send = AsyncMock(return_value=True)
    targets = {
        "src.services.courses.courses.check_limits_with_usage": AsyncMock(),
        "src.services.courses.courses.increase_feature_usage": AsyncMock(),
        "src.services.courses.courses.decrease_feature_usage": AsyncMock(),
        "src.services.courses.courses.dispatch_webhooks": AsyncMock(),
        "src.services.courses.updates.dispatch_webhooks": AsyncMock(),
        "src.services.courses.transfer.storage_utils.delete_storage_directory": Mock(),
        "src.services.courses.activities.versioning.dispatch_webhooks": AsyncMock(),
        "src.services.orgs.users.get_learnhouse_config": Mock(return_value=cfg),
        "src.services.orgs.invites.get_learnhouse_config": Mock(return_value=cfg),
        "src.services.orgs.users.redis.Redis.from_url": Mock(return_value=fake_redis),
        "src.services.orgs.invites._get_redis": Mock(return_value=fake_redis),
        "src.services.orgs.users.send_invite_email": send,
        "src.services.orgs.users.enforce_invite_rate_limit": Mock(),
        "src.services.orgs.users.dispatch_webhooks": AsyncMock(),
        "src.services.users.usergroups.dispatch_webhooks": AsyncMock(),
        "src.services.orgs.orgs.dispatch_webhooks": AsyncMock(),
        "src.routers.users._invalidate_session_cache": Mock(),
        "src.services.orgs.cache.get_redis_client": Mock(return_value=None),
        "src.services.ai.tools.refs.web_base": AsyncMock(return_value=BASE),
        "src.services.communities.discussions.dispatch_webhooks": AsyncMock(),
        "src.services.communities.discussions.track": AsyncMock(),
        "src.services.communities.comments.dispatch_webhooks": AsyncMock(),
        "src.services.folders.folders.dispatch_webhooks": AsyncMock(),
        "src.services.boards.boards.dispatch_webhooks": AsyncMock(),
        "src.services.playgrounds.playgrounds.dispatch_webhooks": AsyncMock(),
    }
    patches = [patch(target, new) for target, new in targets.items()]
    for p in patches:
        p.start()
    yield SimpleNamespace(send=send)
    for p in reversed(patches):
        p.stop()


@pytest.fixture
def registry():
    r = ToolRegistry()
    for module in (
        course_tools, chapter_tools, activity_tools, group_tools, role_tools, org_tools, user_tools,
        library_tools, playground_tools, board_tools, community_tools, content_assets,
    ):
        r.register_all(module.SPECS)
    return r


def _ctx(db, org, user, *, approved=False, can_admin=True):
    return ToolContext(
        request=make_synthetic_request(),
        db_session=db,
        user=user,
        org=org,
        org_slug=org.slug,
        mode="execute",
        scope_key="mcp:test",
        surface="mcp",
        can_admin=can_admin,
        approved=approved,
    )


async def call(registry, name, args, ctx):
    return await run_tool(registry, name, args, ctx)


def ok(out):
    assert out.status == "executed", (out.denied_code, out.reason)
    return out.result


def denied(out, code=None):
    assert out.status == "denied", out.result
    if code:
        assert out.denied_code == code, (out.denied_code, out.reason)
    return out.reason


async def add(db, row):
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


def _course(id, uuid, org_id, *, public=True, published=True, name=None):
    return Course(
        id=id, name=name or uuid, description="", public=public, published=published,
        open_to_contributors=False, org_id=org_id, course_uuid=uuid, creation_date=NOW, update_date=NOW,
    )


def _token(org_id, rights):
    return APITokenUser(
        id=0, user_uuid="apitoken_t", username="api_token", org_id=org_id,
        rights=rights, token_name="t", created_by_user_id=1,
    )


async def _grant(db, role, bucket, **flags):
    """Give a role extra flags in one bucket."""
    rights = json.loads(json.dumps(role.rights))
    rights[bucket] = {**rights[bucket], **flags}
    role.rights = rights
    await add(db, role)


# ─── course structure: moves stay inside one course ──────────────────────────


@pytest.fixture
async def sibling(db, org):
    """Another course of the same organization, with a chapter and a page."""
    c = await add(db, _course(6, "course_sibling", org.id, name="Sibling"))
    ch = await _add_chapter(db, org, c, id=6, uuid="chapter_sibling", name="Theirs", order=1)
    await _add_activity(db, org, c, ch, id=6, uuid="activity_sibling", name="Sibling page")
    return c


@pytest.fixture
async def chapter_two(db, org, course, chapter):
    ch = await _add_chapter(db, org, course, id=2, uuid="chapter_two", name="Second", order=2)
    await _add_activity(db, org, course, ch, id=3, uuid="activity_three", name="Three", order=1)
    return ch


async def _links(db):
    rows = (await db.execute(select(ChapterActivity))).scalars().all()
    return sorted((r.activity_id, r.chapter_id, r.course_id) for r in rows)


async def test_move_refuses_items_of_another_course(
    registry, db, org, other_org, admin_user, course, chapter, activity, sibling
):
    foreign = await add(db, _course(9, "course_other", other_org.id))
    fch = await _add_chapter(db, other_org, foreign, id=9, uuid="chapter_other", name="F", order=1)
    await _add_activity(db, other_org, foreign, fch, id=9, uuid="activity_other", name="F page")
    before = await _links(db)
    ctx = _ctx(db, org, admin_user)
    for moves in (
        [{"item_uuid": "activity_sibling", "to_chapter_uuid": "chapter_test", "position": 0}],
        [{"item_uuid": "activity_test", "to_chapter_uuid": "chapter_sibling"}],
        [{"item_uuid": "activity_test", "after_uuid": "activity_sibling"}],
        [{"item_uuid": "chapter_sibling", "position": 0}],
        [{"item_uuid": "chapter_test", "before_uuid": "chapter_sibling"}],
        [{"item_uuid": "activity_other", "to_chapter_uuid": "chapter_test"}],
        [{"item_uuid": "activity_test", "to_chapter_uuid": "chapter_other"}],
    ):
        reason = denied(await call(registry, "move_course_items", {"course_uuid": "course_test", "moves": moves}, ctx), "http_404")
        assert "in course 'Test Course'" in reason
    # Naming the other course as the target is refused too.
    denied(await call(registry, "move_course_items", {
        "course_uuid": "course_other", "moves": [{"item_uuid": "activity_other", "position": 0}],
    }, ctx))
    assert await _links(db) == before


async def test_move_course_items_anchors_and_errors(
    registry, db, org, admin_user, course, chapter, activity, chapter_two
):
    ctx = _ctx(db, org, admin_user)

    async def move(*moves):
        return await call(registry, "move_course_items", {"course_uuid": "course_test", "moves": list(moves)}, ctx)

    out = ok(await move(
        {"item_uuid": "chapter_two", "before_uuid": "chapter_test"},
        {"item_uuid": "activity_test", "to_chapter_uuid": "chapter_two"},
    ))
    assert [(c["uuid"], [a["uuid"] for a in c["activities"]]) for c in out["outline"]] == [
        ("chapter_two", ["activity_three", "activity_test"]),
        ("chapter_test", []),
    ]
    assert "itself" in denied(await move({"item_uuid": "activity_test", "before_uuid": "activity_test"}), "http_400")
    assert "chapter_... id" in denied(await move({"item_uuid": "activity_test", "to_chapter_uuid": "activity_three"}), "http_400")
    assert "is not in chapter" in denied(
        await move({"item_uuid": "activity_test", "to_chapter_uuid": "chapter_test", "after_uuid": "activity_three"}),
        "http_400",
    )
    assert "Say where" in denied(await move({"item_uuid": "activity_test"}), "http_400")
    # A move that lands where the item already is writes nothing.
    with patch.object(chapter_tools, "write_order", new=AsyncMock()) as write:
        ok(await move({"item_uuid": "chapter_two", "position": 0}))
    write.assert_not_called()


async def test_current_order_ignores_duplicate_links(db, org, admin_user, course, chapter, activity):
    db.add(CourseChapter(chapter_id=chapter.id, course_id=course.id, org_id=org.id, order=5, creation_date=NOW, update_date=NOW))
    # A chapter row of this course that is not in its chapter list.
    db.add(Chapter(id=5, name="Loose", description="", org_id=org.id, course_id=course.id,
                   chapter_uuid="chapter_loose", creation_date=NOW, update_date=NOW))
    await db.commit()
    db.add(ChapterActivity(order=1, chapter_id=5, activity_id=activity.id, course_id=course.id, org_id=org.id, creation_date=NOW, update_date=NOW))
    await db.commit()
    order, chs, acts = await chapter_tools.current_order(_ctx(db, org, admin_user), course)
    assert order == [(chapter.id, [activity.id])]
    assert chs == {"chapter_test": chapter.id} and acts == {"activity_test": activity.id}


async def test_place_helpers_skip_no_op_moves(registry, db, org, admin_user, course, chapter, activity):
    ctx = _ctx(db, org, admin_user)
    with patch.object(chapter_tools, "write_order", new=AsyncMock()) as write:
        await chapter_tools.place_activity(ctx, course, chapter.id, 999, 0)
        await chapter_tools.place_activity(ctx, course, 999, activity.id, 0)
        await chapter_tools.place_activity(ctx, course, chapter.id, activity.id, 3)
        await chapter_tools.place_chapter(ctx, course, chapter.id, 7)
    write.assert_not_called()
    # A new chapter asked to go past the end just stays last.
    out = ok(await call(registry, "create_chapter", {"course_uuid": "course_test", "name": "Last", "position": 50}, ctx))
    outline = ok(await call(registry, "get_course", {"course_uuid": "course_test"}, ctx))
    assert [c["uuid"] for c in outline["chapters"]] == ["chapter_test", out["chapter"]["uuid"]]


async def test_update_chapter_needs_a_change(registry, db, org, admin_user, course, chapter):
    denied(await call(registry, "update_chapter", {"chapter_uuid": "chapter_test"}, _ctx(db, org, admin_user)), "http_400")


async def test_outline_locks_and_truncation(
    registry, db, org, admin_user, regular_user, course, chapter, activity
):
    await _add_activity(db, org, course, chapter, id=2, uuid="activity_two", name="Two", order=2)
    chapter.lock_type = LockType.RESTRICTED
    await add(db, chapter)

    learner = ok(await call(registry, "get_course", {"course_uuid": "course_test"}, _ctx(db, org, regular_user)))
    [ch] = learner["chapters"]
    assert ch["locked"] is True and "lock" not in ch
    assert all(a.get("locked") is True for a in ch["activities"])

    admin = ok(await call(registry, "get_course", {"course_uuid": "course_test"}, _ctx(db, org, admin_user)))
    assert admin["chapters"][0]["lock"] == "restricted" and "locked" not in admin["chapters"][0]

    with patch.object(chapter_tools, "OUTLINE_MAX_ACTIVITIES", 1):
        cut = ok(await call(registry, "get_course", {"course_uuid": "course_test"}, _ctx(db, org, admin_user)))
    assert len(cut["chapters"][0]["activities"]) == 1
    assert cut["chapters"][0]["more_activities"] == 1 and "search inside" in cut["truncated"]


async def test_structure_helpers(db, org, other_org, admin_user, course):
    assert chapter_tools.iso(None) is None
    assert chapter_tools.iso("not a date") == "not a date"
    assert chapter_tools.activity_type("TYPE_VIDEO", None) == "video"
    assert chapter_tools.activity_type("TYPE_NEW_KIND", None) == "type_new_kind"
    ctx = _ctx(db, org, admin_user)
    with patch.object(chapter_tools, "check_resource_access", AsyncMock(side_effect=HTTPException(status_code=403))):
        assert await chapter_tools.can_edit_course(ctx, "course_test") is False
    foreign = await add(db, _course(9, "course_other", other_org.id))
    for course_id in (foreign.id, 404):
        with pytest.raises(HTTPException) as e:
            await chapter_tools.course_of(ctx, course_id, "chapter", "chapter_x")
        assert e.value.status_code == 404


# ─── courses ─────────────────────────────────────────────────────────────────


def test_course_field_readers_and_summaries():
    assert course_tools._learnings_out("Read, Write ,") == ["Read", "Write"]
    assert course_tools._learnings_out('"one line"') == ["one line"]
    assert course_tools._learnings_out(json.dumps([{"text": "A"}, {"x": 1}, "b"])) == ["A"]

    p = course_tools.UpdateCourseParams(
        course_uuid="course_test", published=True, public=False, publish_activities=False,
        open_to_contributors=True, name="New",
    )
    text = course_tools._update_summary(p)
    for part in ("publish it for learners", "make it private", "unpublish all of its pages",
                 "open it to contributors", "change name"):
        assert part in text, text
    other = course_tools._update_summary(course_tools.UpdateCourseParams(
        course_uuid="course_test", published=False, public=True, publish_activities=True, open_to_contributors=False,
    ))
    for part in ("unpublish it", "make it public", "publish all of its pages", "close it to contributors"):
        assert part in other, other
    assert course_tools._update_summary(course_tools.UpdateCourseParams(course_uuid="course_test")).endswith("no change")

    copy = course_tools.CreateCourseParams(name="Copy", copy_from_course_uuid="course_test")
    assert course_tools._create_summary(copy) == "Copy course course_test as 'Copy'"
    built = course_tools.CreateCourseParams(name="Plants", chapters=[{"name": "A", "activities": [{"name": "1"}]}])
    assert course_tools._create_summary(built) == "Create course 'Plants' with 1 chapter and 1 page"


async def test_create_course_caps(registry, db, org, admin_user):
    ctx = _ctx(db, org, admin_user)
    pages = [{"name": f"p{i}", "markdown": "a" * 190_000} for i in range(6)]
    reason = denied(await call(registry, "create_course", {"name": "Long", "chapters": [{"name": "A", "activities": pages}]}, ctx), "invalid_args")
    assert "characters of Markdown per call" in reason
    reason = denied(await call(registry, "create_course", {"name": "Tags", "tags": [f"t{i}" for i in range(21)]}, ctx), "invalid_args")
    assert "at most 20 tags" in reason
    assert (await db.execute(select(Course))).scalars().all() == []


async def test_list_courses_for_a_refused_session_is_the_visitor_view(registry, db, org, regular_user, course):
    await add(db, _course(7, "course_members", org.id, public=False))
    await add(db, _course(8, "course_public_draft", org.id, published=False))
    with patch.object(course_tools, "viewer_for_org", AsyncMock(return_value=AnonymousUser())):
        out = ok(await call(registry, "list_courses", {}, _ctx(db, org, regular_user)))
    assert [i["uuid"] for i in out["items"]] == ["course_test"]


async def test_get_course_details_show_seo_to_editors(registry, db, org, admin_user, course):
    course.seo = {"title": "Plants 101", "description": "", "keywords": None}
    await add(db, course)
    out = ok(await call(registry, "get_course", {"course_uuid": "course_test", "include_details": True}, _ctx(db, org, admin_user)))
    assert out["seo"] == {"title": "Plants 101"}


async def test_update_course_visibility(registry, db, org, admin_user, regular_user, course):
    args = {"course_uuid": "course_test", "public": False}
    denied(await call(registry, "update_course", args, _ctx(db, org, admin_user)), "approval_required")
    denied(await call(registry, "update_course", args, _ctx(db, org, regular_user, approved=True)))
    await db.refresh(course)
    assert course.public is True
    ok(await call(registry, "update_course", args, _ctx(db, org, admin_user, approved=True)))
    await db.refresh(course)
    assert course.public is False


# ─── people fixtures ─────────────────────────────────────────────────────────


@pytest.fixture
async def people(db, org, other_org, admin_user, regular_user, user_role, course):
    """A reviewer role and member, an outsider in the other org, a group with
    the learner in it, and a course, a group and a podcast over there."""
    db.add(_config(org.id))
    db.add(_config(other_org.id))
    reviewer = Role(
        id=8, name="Reviewer", org_id=org.id, role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_reviewer", rights=USER_RIGHTS.model_dump(), creation_date=NOW, update_date=NOW,
    )
    global_role = Role(
        id=2, name="Maintainer", org_id=None, role_type=RoleTypeEnum.TYPE_GLOBAL,
        role_uuid="role_global_maintainer", rights=ADMIN_RIGHTS.model_dump(), creation_date=NOW, update_date=NOW,
    )
    other_role = Role(
        id=7, name="Other", org_id=other_org.id, role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_other", rights=USER_RIGHTS.model_dump(), creation_date=NOW, update_date=NOW,
    )
    db.add_all([reviewer, global_role, other_role])
    db.add_all([
        User(id=3, username="third", first_name="Third", last_name="", email="third@test.com", password="x",
             user_uuid="user_third", creation_date=NOW, update_date=NOW),
        User(id=4, username="outsider", first_name="Out", last_name="Sider", email="out@other.com", password="x",
             user_uuid="user_outsider", creation_date=NOW, update_date=NOW),
    ])
    await db.commit()
    db.add_all([
        UserOrganization(user_id=3, org_id=org.id, role_id=4, creation_date=NOW, update_date=NOW),
        UserOrganization(user_id=4, org_id=other_org.id, role_id=7, creation_date=NOW, update_date=NOW),
        UserGroup(id=1, name="Cohort A", description="", org_id=org.id, usergroup_uuid="usergroup_a",
                  creation_date=NOW, update_date=NOW),
        UserGroup(id=2, name="Theirs", description="", org_id=other_org.id, usergroup_uuid="usergroup_other",
                  creation_date=NOW, update_date=NOW),
        _course(2, "course_other", other_org.id),
        Podcast(id=1, name="Our show", public=True, org_id=org.id, podcast_uuid="podcast_ours",
                creation_date=NOW, update_date=NOW),
        Podcast(id=2, name="Their show", public=True, org_id=other_org.id, podcast_uuid="podcast_theirs",
                creation_date=NOW, update_date=NOW),
    ])
    await db.commit()
    db.add(UserGroupUser(usergroup_id=1, user_id=regular_user.id, org_id=org.id, creation_date=NOW, update_date=NOW))
    await db.commit()
    return SimpleNamespace(reviewer=reviewer)


async def _members_of(db, group_id):
    return sorted((await db.execute(select(UserGroupUser.user_id).where(UserGroupUser.usergroup_id == group_id))).scalars().all())


async def _linked(db, group_id):
    return sorted((await db.execute(select(UserGroupResource.resource_uuid).where(UserGroupResource.usergroup_id == group_id))).scalars().all())


# ─── user groups ─────────────────────────────────────────────────────────────


async def test_usergroup_never_takes_people_or_resources_from_another_org(
    registry, db, org, admin_user, people
):
    args = {
        "usergroup_uuid": "usergroup_a",
        "add_members": ["outsider", "out@other.com", "user_outsider"],
        "link_resources": ["course_other", "podcast_theirs", "podcast_ours"],
    }
    out = ok(await call(registry, "update_usergroup", args, _ctx(db, org, admin_user, approved=True)))
    assert {r["member"]: r["result"] for r in out["member_results"]} == {
        "outsider": "not_a_member", "out@other.com": "not_a_member", "user_outsider": "not_a_member",
    }
    assert {r["resource_uuid"]: r["result"] for r in out["resource_results"]} == {
        "course_other": "not_found", "podcast_theirs": "not_found", "podcast_ours": "linked",
    }
    assert await _members_of(db, 1) == [2]
    assert await _linked(db, 1) == ["podcast_ours"]
    # Nor can this org's tools touch the other org's group.
    denied(await call(registry, "update_usergroup", {"usergroup_uuid": "usergroup_other", "add_members": ["regular"]},
                      _ctx(db, org, admin_user, approved=True)), "http_404")
    assert await _members_of(db, 2) == []


async def test_usergroup_remove_and_relink_results(registry, db, org, admin_user, people, course):
    ctx = _ctx(db, org, admin_user, approved=True)
    ok(await call(registry, "update_usergroup", {"usergroup_uuid": "usergroup_a", "link_resources": ["course_test"]}, ctx))
    out = ok(await call(registry, "update_usergroup", {
        "usergroup_uuid": "usergroup_a",
        "remove_members": ["user_ghost", "third"],
        "link_resources": ["course_test"],
    }, ctx))
    assert {r["member"]: r["result"] for r in out["member_results"]} == {"user_ghost": "not_a_member", "third": "not_in_group"}
    assert out["resource_results"] == [{"resource_uuid": "course_test", "result": "already_linked"}]
    assert await _members_of(db, 1) == [2]


async def test_get_usergroup_names_podcasts_and_unknown_links(registry, db, org, admin_user, people):
    db.add_all([
        UserGroupResource(usergroup_id=1, resource_uuid="podcast_ours", org_id=org.id, creation_date=NOW, update_date=NOW),
        UserGroupResource(usergroup_id=1, resource_uuid="legacy_thing", org_id=org.id, creation_date=NOW, update_date=NOW),
    ])
    await db.commit()
    out = ok(await call(registry, "get_usergroup", {"usergroup_uuid": "usergroup_a"}, _ctx(db, org, admin_user)))
    items = {i["uuid"]: i for i in out["resources"]["items"]}
    assert items["podcast_ours"] == {"kind": "podcast", "uuid": "podcast_ours", "name": "Our show"}
    assert items["legacy_thing"] == {"kind": "resource", "uuid": "legacy_thing"}


def test_usergroup_update_summary():
    p = group_tools.UpdateUserGroupParams(
        usergroup_uuid="usergroup_a", name="B", description="", add_members=["a"], remove_members=["b", "c"],
        link_resources=["course_x"], unlink_resources=["course_y"],
    )
    assert group_tools._summarize_update(p) == (
        "User group usergroup_a: rename to 'B', change the description, add 1 member(s), "
        "remove 2 member(s), link 1 resource(s), unlink 1 resource(s)"
    )
    assert group_tools._summarize_update(group_tools.UpdateUserGroupParams(usergroup_uuid="usergroup_a")).endswith("no change")


# ─── roles ───────────────────────────────────────────────────────────────────


async def _refused(registry, db, org, user, name, args):
    """One call, rolled back afterwards as the MCP handler does when refused."""
    out = await call(registry, name, args, _ctx(db, org, user, approved=True))
    await db.rollback()
    return out


@pytest.mark.parametrize("name, args", [
    ("update_role", {"role_uuid": "role_reviewer", "rights": {"users": {"action_delete": True}}}),
    # Copying the admin role's rights is the same escalation.
    ("create_role", {"name": "Copy", "base_role_uuid": "role_admin"}),
])
async def test_role_tools_cannot_grant_more_than_the_caller_holds(
    registry, db, org, regular_user, user_role, people, name, args
):
    await _grant(db, user_role, "roles", action_update=True, action_create=True)
    out = await _refused(registry, db, org, regular_user, name, args)
    assert "don't have this permission" in denied(out, "http_403")
    row = await db.get(Role, 8)
    assert row.rights["users"]["action_delete"] is False
    assert (await db.execute(select(Role.id).where(Role.name == "Copy"))).first() is None


async def test_built_in_and_foreign_roles_are_out_of_reach(registry, db, org, admin_user, people):
    ctx = _ctx(db, org, admin_user, approved=True)
    for name, args in (
        ("update_role", {"role_uuid": "role_global_maintainer", "rights": {"users": {"action_delete": False}}}),
        ("delete_role", {"role_uuid": "role_global_maintainer"}),
    ):
        assert "built-in" in denied(await call(registry, name, args, ctx), "http_403")
    denied(await call(registry, "delete_role", {"role_uuid": "role_other"}, ctx), "http_404")
    denied(await call(registry, "update_role", {"role_uuid": "role_other", "name": "Mine"}, ctx), "http_404")
    assert await db.get(Role, 2) is not None and await db.get(Role, 7) is not None


async def test_update_role_description_and_helpers(registry, db, org, admin_user, people):
    out = ok(await call(registry, "update_role", {"role_uuid": "role_reviewer", "description": " Reads things "},
                        _ctx(db, org, admin_user, approved=True)))
    assert "rights" not in out and "rights_before" not in out
    row = await db.get(Role, 8)
    await db.refresh(row)
    assert row.description == "Reads things"

    assert role_tools._rights_dict(None) == {} and role_tools._summary(None) == {}
    assert await role_tools._holders(_ctx(db, org, admin_user), []) == {}
    many = {b: {"action_read": True, "action_create": False} for b in ("courses", "users", "folders", "media", "roles")}
    p = role_tools.UpdateRoleParams(role_uuid="role_reviewer", rights=many)
    text = role_tools._patch_text(p)
    assert text.startswith(" with rights courses.create=off, courses.read=on") and text.endswith(" and more")
    assert role_tools._patch_text(role_tools.UpdateRoleParams(role_uuid="role_reviewer", name="x")) == ""
    spec = next(s for s in role_tools.SPECS if s.name == "update_role")
    assert spec.summarize(p).startswith("Update role role_reviewer")


# ─── organization settings ───────────────────────────────────────────────────


async def _org_config(db, org) -> dict:
    row = (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org.id))).scalars().first()
    await db.refresh(row)
    return row.config


async def test_org_settings_that_stay_out_of_reach(registry, db, org, admin_user, people):
    ctx = _ctx(db, org, admin_user, approved=True)
    before = await _org_config(db, org)
    for bad in (
        {"section": "plan", "plan": "enterprise"},
        {"section": "payments", "enabled": True},
        {"section": "domains", "custom_domain": "evil.example"},
        {"section": "scripts", "head": "<script>alert(1)</script>"},
        {"section": "branding", "scripts": "<script></script>"},
        {"section": "ai", "mcp_enabled": True},
        {"section": "signup", "mode": "sso_only"},
        {"section": "auth_branding", "background_image": "https://evil.example/x.png"},
        {"section": "seo", "twitter_handle": "<b>x</b>"},
        {"section": "menu", "items": [{"type": "custom", "url": "//evil.example"}]},
        {"section": "course_end", "button_link": "javascript:alert(1)"},
    ):
        denied(await call(registry, "update_org_settings", {"settings": bad}, ctx), "invalid_args")
    # Unknown profile keys are dropped, never applied.
    denied(await call(registry, "update_org", {"slug": "moved", "org_uuid": "org_x", "id": 99}, ctx), "http_400")
    await db.refresh(org)
    assert (org.slug, org.org_uuid, org.id) == ("test-org", "org_test", 1)
    assert await _org_config(db, org) == before


async def test_org_settings_v1_layout(registry, db, org, admin_user, people):
    row = (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org.id))).scalars().first()
    row.config = {
        "config_version": "1.0",
        "cloud": {"plan": "pro"},
        "general": {
            "color": "#222222",
            "menu": {"items": [{"type": "courses", "enabled": True}]},
            "course_end": {"message": "Done"},
        },
        "features": {
            "ai": {"enabled": False, "copilot_enabled": False},
            "members": {"signup_mode": "inviteOnly"},
            "courses": {"enabled": True},
            "boards": {"enabled": False},
        },
        "seo": {"twitter_handle": "@acme"},
        "landing": {"enabled": True, "sections": [{"type": "hero", "heading": "Hi"}]},
    }
    await add(db, row)
    out = ok(await call(registry, "get_org_settings", {}, _ctx(db, org, admin_user)))
    assert out["plan"] == "pro" and out["signup"]["mode"] == "invite_only"
    assert out["ai"] == {"enabled": False, "copilot_enabled": False}
    assert out["branding"]["color"] == "#222222"
    assert out["seo"] == {"twitter_handle": "@acme"}
    assert out["menu"]["items"][0]["type"] == "courses"
    assert out["landing"]["sections"][0]["title"] == "Hi"
    assert out["course_end"]["message"] == "Done"
    assert out["features"]["courses"]["switched_on"] is True and out["features"]["boards"]["switched_on"] is False


async def test_org_settings_without_a_config_row(registry, db, org, admin_user):
    denied(await call(registry, "get_org_settings", {}, _ctx(db, org, admin_user)), "http_404")


async def test_org_profile_email_and_links(registry, db, org, admin_user, people):
    ctx = _ctx(db, org, admin_user, approved=True)
    out = ok(await call(registry, "update_org", {"email": "hello@acme.example"}, ctx))
    assert out["fields"] == ["email"]
    await db.refresh(org)
    assert org.email == "hello@acme.example"
    denied(await call(registry, "update_org", {"links": [{"label": "Blog", "url": ""}]}, ctx), "invalid_args")
    denied(await call(registry, "update_org", {"links": [{"label": "Blog", "url": "ftp://x.example"}]}, ctx), "invalid_args")


async def test_org_menu_landing_and_branding_edges(registry, db, org, admin_user, people):
    ctx = _ctx(db, org, admin_user, approved=True)

    async def apply(section):
        return await call(registry, "update_org_settings", {"settings": section}, ctx)

    assert "need a url to match" in denied(await apply({"section": "menu", "items": [{"type": "custom", "url": ""}]}), "http_400")
    assert "need a url" in denied(await apply({"section": "menu", "mode": "replace", "items": [{"type": "custom", "label": "x"}]}), "http_400")
    big = [{"type": "rich-text", "content": "x" * 100_001}]
    assert "100000 characters" in denied(await apply({"section": "landing", "sections": big}), "invalid_args")
    assert "Nothing to change" in denied(await apply({"section": "landing"}), "http_400")

    ok(await apply({"section": "landing", "mode": "replace", "sections": [], "settings": {"width": "wide"}}))
    landing = (await _org_config(db, org))["customization"]["landing"]
    assert landing == {"sections": [], "enabled": False, "settings": {"width": "wide"}}

    out = ok(await apply({"section": "branding", "watermark": True, "email_sender_name": "Acme", "footer_text": " Hi "}))
    assert set(out["fields"]) == {"watermark", "email_sender_name", "footer_text"}
    general = (await _org_config(db, org))["customization"]["general"]
    assert general["footer_text"] == "Hi" and general["watermark"] is True


def test_org_settings_summaries():
    def summary(section):
        return org_tools._summarize_settings(org_tools.UpdateOrgSettingsParams(settings=section))

    assert summary({"section": "signup", "mode": "open"}) == "Let anyone sign up"
    assert summary({"section": "signup", "mode": "invite_only"}) == "Make signup invitation only"
    assert summary({"section": "menu", "mode": "replace", "items": []}) == "Replace the organization's menu settings"
    assert summary({"section": "landing", "enabled": True}) == "Update the organization's landing settings"
    assert summary({"section": "auth_branding", "text_color": "dark"}) == (
        "Change the organization's auth branding settings: text_color=dark"
    )


# ─── members ─────────────────────────────────────────────────────────────────


def test_member_helpers():
    assert user_tools._iso("garbage") == "garbage"
    assert user_tools._expires_at(None, "x") is None
    assert user_tools._role_ref(None) is None


async def test_list_members_paging_and_invite_filters(registry, db, org, admin_user, people, fake_redis):
    ctx = _ctx(db, org, admin_user)
    first = ok(await call(registry, "list_members", {"limit": 2}, ctx))
    assert "same limit" in denied(await call(registry, "list_members", {"limit": 3, "cursor": first["next_cursor"]}, ctx), "http_400")
    assert "only filter active" in denied(await call(registry, "list_members", {"status": "invited", "role_uuid": "role_user"}, ctx), "http_400")
    for email in ("new@x.com", "other@x.com"):
        fake_redis.set(
            f"invited_user:{email}:org:{org.org_uuid}",
            json.dumps({"email": email, "pending": True, "expires": 60, "created_at": NOW}),
        )
    out = ok(await call(registry, "list_members", {"status": "invited", "query": "NEW"}, ctx))
    assert [i["email"] for i in out["items"]] == ["new@x.com"]


async def test_invite_into_a_group_uses_its_link(registry, db, org, admin_user, people, environment):
    ctx = _ctx(db, org, admin_user, approved=True)
    ok(await call(registry, "create_invite_code", {"usergroup_uuid": "usergroup_a"}, ctx))
    out = ok(await call(registry, "invite_members", {"emails": ["g@x.com"], "usergroup_uuid": "usergroup_a"}, ctx))
    assert out["results"] == [{"email": "g@x.com", "result": "invited"}]
    # A group of another organization is not found, and nothing is sent.
    environment.send.reset_mock()
    denied(await call(registry, "invite_members", {"emails": ["h@x.com"], "usergroup_uuid": "usergroup_other"}, ctx), "http_404")
    environment.send.assert_not_called()


async def test_invite_reports_rejected_addresses(registry, db, org, admin_user, people):
    outcome = {"results": [{"email": "bad@x.com", "status": "invalid_email"}]}
    with patch.object(user_tools, "invite_batch_users", AsyncMock(return_value=outcome)):
        out = ok(await call(registry, "invite_members", {"emails": ["bad@x.com"]}, _ctx(db, org, admin_user, approved=True)))
    assert out["ok"] is False and "rejected as invalid" in out["summary"]


async def test_invite_code_service_refusal_passes_through(registry, db, org, admin_user, people):
    refusal = HTTPException(status_code=403, detail="Not allowed.")
    with patch.object(user_tools, "create_invite_code", AsyncMock(side_effect=refusal)):
        denied(await call(registry, "create_invite_code", {}, _ctx(db, org, admin_user, approved=True)), "http_403")


async def test_ai_connection_helpers_without_the_mcp_modules(db, org, admin_user, monkeypatch):
    ctx = _ctx(db, org, admin_user)
    monkeypatch.setitem(sys.modules, "src.db.mcp_oauth", None)
    monkeypatch.setitem(sys.modules, "src.services.mcp.oauth", None)
    assert await user_tools._active_ai_connections(ctx, admin_user.id) is None
    assert await user_tools._revoke_mcp_grants(ctx, admin_user.id) is None


# ─── library ─────────────────────────────────────────────────────────────────


@pytest.fixture
async def shelf(db, org, other_org, folder):
    """A second folder, a private folder, media and podcasts on both sides."""
    two = await add(db, Folder(id=2, name="Two", public=True, org_id=org.id, folder_uuid="folder_two",
                               creation_date=NOW, update_date=NOW))
    await add(db, Folder(id=3, name="Staff", public=False, org_id=org.id, folder_uuid="folder_staff",
                         creation_date=NOW, update_date=NOW))
    await add(db, Folder(id=4, name="Theirs", public=True, org_id=other_org.id, folder_uuid="folder_theirs",
                         creation_date=NOW, update_date=NOW))
    db.add_all([
        _course(2, "course_second", org.id),
        _course(3, "course_foreign", other_org.id),
        Media(id=1, name="Clip", org_id=org.id, media_uuid="media_clip", media_type="UPLOAD",
              creation_date=NOW, update_date=NOW),
        Media(id=2, name="Their clip", org_id=other_org.id, media_uuid="media_theirs",
              creation_date=NOW, update_date=NOW),
        Podcast(id=1, name="Our show", public=True, org_id=org.id, podcast_uuid="podcast_ours",
                creation_date=NOW, update_date=NOW),
        Podcast(id=2, name="Their show", public=True, org_id=other_org.id, podcast_uuid="podcast_theirs",
                creation_date=NOW, update_date=NOW),
        Community(id=9, name="Their community", public=True, org_id=other_org.id,
                  community_uuid="community_theirs", creation_date=NOW, update_date=NOW),
        Board(id=9, name="Their board", public=True, org_id=other_org.id, board_uuid="board_theirs",
              creation_date=NOW, update_date=NOW),
    ])
    await db.commit()
    return two


async def _placements(db):
    rows = (await db.execute(select(FolderContent))).scalars().all()
    return sorted((r.resource_uuid, str(r.folder_id), r.org_id) for r in rows)


async def test_place_in_library_refuses_foreign_resources_and_folders(registry, db, org, admin_user, shelf):
    ctx = _ctx(db, org, admin_user)
    before = await _placements(db)
    for args in (
        {"resource_uuid": "course_foreign"},
        {"resource_uuid": "podcast_theirs"},
        {"resource_uuid": "media_theirs"},
        {"resource_uuid": "community_theirs"},
        {"resource_uuid": "board_theirs"},
        {"resource_uuid": "course_second", "folder_uuid": "folder_theirs"},
        {"resource_uuid": "course_test", "folder_uuid": "folder_two", "from_folder_uuid": "folder_theirs"},
        {"resource_uuid": "course_test", "folder_uuid": "folder_theirs", "remove": True},
    ):
        denied(await call(registry, "place_in_library", args, ctx), "http_404")
    assert await _placements(db) == before


async def test_place_in_library_paths(registry, db, org, admin_user, shelf, folder):
    ctx = _ctx(db, org, admin_user)

    async def place(**args):
        return await call(registry, "place_in_library", args, ctx)

    assert "not both" in denied(await place(resource_uuid="course_test", remove=True, from_folder_uuid="root"), "http_400")
    ok(await place(resource_uuid="course_second", folder_uuid="folder_test"))
    out = ok(await place(resource_uuid="podcast_ours"))
    assert out["resource"] == {"kind": "podcast", "uuid": "podcast_ours", "name": "Our show"}
    assert "same place" in denied(await place(resource_uuid="course_test", folder_uuid="folder_test", from_folder_uuid="folder_test"), "http_400")
    assert "same place" in denied(await place(resource_uuid="podcast_ours", from_folder_uuid="root"), "http_400")
    assert "is not in folder \"Two\"" in denied(await place(resource_uuid="course_second", folder_uuid="folder_test", from_folder_uuid="folder_two"), "http_404")
    assert "is not in the library root" in denied(await place(resource_uuid="course_test", folder_uuid="folder_two", from_folder_uuid="root"), "http_404")
    moved = ok(await place(resource_uuid="course_test", folder_uuid="folder_two", from_folder_uuid="folder_test"))
    assert moved["from_folder"]["uuid"] == "folder_test" and moved["folder"]["uuid"] == "folder_two"
    out = ok(await place(resource_uuid="course_second", folder_uuid="folder_test", remove=True))
    assert "unchanged" in out["summary"]
    assert await _placements(db) == [("course_test", "2", org.id), ("podcast_ours", "None", org.id)]


async def test_browse_library_media_and_visibility(
    registry, db, org, other_org, admin_user, regular_user, user_role, shelf, folder
):
    await add(db, FolderContent(folder_id=folder.id, resource_uuid="media_clip", org_id=org.id, creation_date=NOW, update_date=NOW))
    inside = ok(await call(registry, "browse_library", {"folder_uuid": "folder_test"}, _ctx(db, org, admin_user)))
    media = next(e for e in inside["items"] if e["kind"] == "media")
    assert media["uuid"] == "media_clip" and "url" not in media
    # Members see members-only folders; someone from another org does not.
    member = ok(await call(registry, "browse_library", {}, _ctx(db, org, regular_user)))
    assert "folder_staff" in {e["uuid"] for e in member["items"]}
    await add(db, User(id=4, username="outsider", first_name="", last_name="", email="out@other.com", password="x",
                       user_uuid="user_outsider", creation_date=NOW, update_date=NOW))
    await add(db, UserOrganization(user_id=4, org_id=other_org.id, role_id=4, creation_date=NOW, update_date=NOW))
    outsider = PublicUser(id=4, username="outsider", first_name="", last_name="", email="out@other.com", user_uuid="user_outsider")
    folders = await library_tools._root_folders(_ctx(db, org, outsider))
    assert [f.folder_uuid for f in folders] == ["folder_test", "folder_two"]
    assert await library_tools._folder_counts(_ctx(db, org, admin_user), []) == {}


async def test_update_folder_moves_and_needs_a_change(registry, db, org, admin_user, shelf, folder):
    ctx = _ctx(db, org, admin_user)
    ok(await call(registry, "update_folder", {"folder_uuid": "folder_two", "parent_folder_uuid": "folder_test"}, ctx))
    await db.refresh(shelf)
    assert shelf.parent_folder_id == folder.id
    denied(await call(registry, "update_folder", {"folder_uuid": "folder_two"}, ctx), "http_400")
    denied(await call(registry, "update_folder", {"folder_uuid": "folder_two", "parent_folder_uuid": "folder_theirs"}, ctx), "http_404")


async def test_list_media_pages_through_the_service(registry, db, org, admin_user, monkeypatch):
    for i in range(5):
        await add(db, Media(name=f"m{i}", org_id=org.id, media_uuid=f"media_{i}", creation_date=NOW, update_date=NOW))
    monkeypatch.setattr(library_tools, "_MEDIA_PAGE", 2)
    out = ok(await call(registry, "list_media", {"limit": 3, "cursor": None}, _ctx(db, org, admin_user)))
    assert len(out["items"]) == 3 and out["has_more"]


# ─── playgrounds ─────────────────────────────────────────────────────────────


@pytest.fixture
async def playground(db, org, admin_user):
    return await add(db, Playground(
        id=1, name="Sim", description="", html_content="<p>x</p>", published=True, org_id=org.id,
        playground_uuid="0b0e1a52-1111-4c3e-9a55-000000000001", created_by=admin_user.id,
        creation_date=NOW, update_date=NOW,
    ))


@pytest.fixture
async def cohort(db, org):
    return await add(db, UserGroup(id=1, name="Cohort A", description="", org_id=org.id, usergroup_uuid="usergroup_a",
                                   creation_date=NOW, update_date=NOW))


async def test_playground_access_changes_are_guarded(
    registry, db, org, other_org, admin_user, regular_user, course, playground, cohort
):
    uuid = playground.playground_uuid
    await add(db, _course(9, "course_other", other_org.id))
    # Opening it to everyone needs a person's approval; a learner may not at all.
    denied(await call(registry, "update_playground", {"playground_uuid": uuid, "access_type": "public"}, _ctx(db, org, admin_user)), "approval_required")
    denied(await call(registry, "update_playground", {"playground_uuid": uuid, "access_type": "public"}, _ctx(db, org, regular_user, approved=True)), "http_403")
    grant = {"playground_uuid": uuid, "usergroup_uuid": "usergroup_a", "grant": True}
    denied(await call(registry, "set_playground_access", grant, _ctx(db, org, regular_user, approved=True)), "http_403")
    # A course of another organization cannot be linked.
    denied(await call(registry, "update_playground", {"playground_uuid": uuid, "course_uuid": "course_other"}, _ctx(db, org, admin_user)), "http_404")
    await db.refresh(playground)
    assert playground.course_id is None and str(getattr(playground.access_type, "value", playground.access_type)).lower() != "public"
    out = ok(await call(registry, "update_playground", {"playground_uuid": uuid, "access_type": "restricted"}, _ctx(db, org, admin_user, approved=True)))
    assert out["playground"]["access"] == "restricted"
    granted = ok(await call(registry, "set_playground_access", grant, _ctx(db, org, admin_user, approved=True)))
    assert "note" not in granted


async def test_playground_course_link_and_unlink(registry, db, org, other_org, admin_user, course, playground):
    uuid = playground.playground_uuid
    ctx = _ctx(db, org, admin_user)
    ok(await call(registry, "update_playground", {"playground_uuid": uuid, "course_uuid": "course_test"}, ctx))
    out = ok(await call(registry, "get_playground", {"playground_uuid": uuid}, ctx))
    assert out["course"]["uuid"] == "course_test"
    out = ok(await call(registry, "update_playground", {"playground_uuid": uuid, "course_uuid": "None"}, ctx))
    assert "course" in out["summary"]
    await db.refresh(playground)
    assert playground.course_id is None
    denied(await call(registry, "update_playground", {"playground_uuid": uuid}, ctx), "http_400")
    # A link pointing outside the organization is not shown.
    foreign = await add(db, _course(9, "course_other", other_org.id, name="Hidden name"))
    playground.course_id = foreign.id
    await add(db, playground)
    out = ok(await call(registry, "get_playground", {"playground_uuid": uuid}, ctx))
    assert out["course"] is None and "Hidden name" not in json.dumps(out)


async def test_playground_revoke_error_passes_through(registry, db, org, admin_user, playground, cohort):
    args = {"playground_uuid": playground.playground_uuid, "usergroup_uuid": "usergroup_a", "grant": False}
    with patch.object(playground_tools, "remove_usergroup_from_playground", AsyncMock(side_effect=HTTPException(status_code=403, detail="no"))):
        denied(await call(registry, "set_playground_access", args, _ctx(db, org, admin_user, approved=True)), "http_403")


# ─── boards ──────────────────────────────────────────────────────────────────


@pytest.fixture
async def board(db, org, admin_user):
    b = await add(db, Board(
        id=1, name="Planning", description="Roadmap", public=False, org_id=org.id,
        board_uuid="board_plan", created_by=admin_user.id, creation_date=NOW, update_date=NOW,
    ))
    await add(db, BoardMember(board_id=b.id, user_id=admin_user.id, role="owner", creation_date=NOW))
    return b


async def _board_members(db, board_id):
    return sorted((await db.execute(select(BoardMember.user_id).where(BoardMember.board_id == board_id))).scalars().all())


async def test_board_members_stay_inside_the_org(registry, db, org, admin_user, regular_user, board, people):
    ctx = _ctx(db, org, admin_user, approved=True)
    for who in ("outsider", "out@other.com", "user_outsider"):
        denied(await call(registry, "manage_board_members", {"board_uuid": "board_plan", "add": [{"member": who}]}, ctx), "http_404")
    # A learner who is not on the board cannot add anyone.
    denied(await call(registry, "manage_board_members", {"board_uuid": "board_plan", "add": [{"member": "regular"}]},
                      _ctx(db, org, regular_user, approved=True)))
    assert await _board_members(db, board.id) == [admin_user.id]


async def test_board_member_outcomes(registry, db, org, admin_user, regular_user, board):
    ctx = _ctx(db, org, admin_user, approved=True)
    out = ok(await call(registry, "manage_board_members", {"board_uuid": "board_plan", "remove": ["regular"]}, ctx))
    assert out["members"][0]["result"] == "not_a_member"
    full = HTTPException(status_code=403, detail="Board member limit reached (max 10)")
    with patch.object(board_tools, "add_board_member", AsyncMock(side_effect=full)):
        out = ok(await call(registry, "manage_board_members", {"board_uuid": "board_plan", "add": [{"member": "regular"}]}, ctx))
    assert out["members"][0]["result"] == "not_added" and "limit" in out["members"][0]["error"]
    refusal = HTTPException(status_code=403, detail="Only owners")
    with patch.object(board_tools, "add_board_member", AsyncMock(side_effect=refusal)):
        denied(await call(registry, "manage_board_members", {"board_uuid": "board_plan", "add": [{"member": "regular"}]}, ctx), "http_403")
    with patch.object(board_tools, "remove_board_member", AsyncMock(side_effect=refusal)):
        denied(await call(registry, "manage_board_members", {"board_uuid": "board_plan", "remove": ["admin"]}, ctx), "http_403")


async def test_board_create_and_update_edges(registry, db, org, admin_user, board):
    ctx = _ctx(db, org, admin_user)
    denied(await call(registry, "create_board", {}, ctx), "invalid_args")
    out = ok(await call(registry, "create_board", {"copy_from_board_uuid": "board_plan", "name": "Copy", "description": "Mine"}, ctx))
    row = (await db.execute(select(Board).where(Board.board_uuid == out["board"]["uuid"]))).scalars().one()
    assert (row.name, row.description, row.public) == ("Copy", "Mine", False)
    denied(await call(registry, "update_board", {"board_uuid": "board_plan"}, ctx), "http_400")


# ─── communities ─────────────────────────────────────────────────────────────


@pytest.fixture
async def community(db, org):
    return await add(db, Community(
        id=1, name="Main", description="", public=True, org_id=org.id, community_uuid="community_main",
        moderation_words=["spam"], creation_date=NOW, update_date=NOW,
    ))


@pytest.fixture
async def threads(db, org, community, admin_user, regular_user):
    db.add_all([
        Discussion(id=1, title="Pinned", content="Rules", label="announcement", community_id=community.id,
                   org_id=org.id, author_id=admin_user.id, discussion_uuid="discussion_pinned", is_pinned=True,
                   creation_date=NOW, update_date=NOW),
        Discussion(id=2, title="Question", content="How?", label="question", community_id=community.id,
                   org_id=org.id, author_id=regular_user.id, discussion_uuid="discussion_question", is_locked=True,
                   creation_date=NOW, update_date=NOW),
    ])
    await db.commit()


async def test_moderator_rewriting_a_learners_post_needs_approval(registry, db, org, admin_user, threads):
    args = {"discussion_uuid": "discussion_question", "title": "Edited"}
    assert "someone else" in denied(await call(registry, "update_discussion", args, _ctx(db, org, admin_user)), "approval_required")
    row = await db.get(Discussion, 2)
    await db.refresh(row)
    assert row.title == "Question"
    denied(await call(registry, "update_discussion", {"discussion_uuid": "discussion_question"}, _ctx(db, org, admin_user)), "http_400")


async def test_list_discussions_filters_and_tokens(registry, db, org, admin_user, threads):
    ctx = _ctx(db, org, admin_user)
    pinned = ok(await call(registry, "list_discussions", {"pinned": True}, ctx))
    assert [i["uuid"] for i in pinned["items"]] == ["discussion_pinned"]
    locked = ok(await call(registry, "list_discussions", {"locked": True}, ctx))
    assert [i["uuid"] for i in locked["items"]] == ["discussion_question"]
    read = {"action_create": False, "action_read": True, "action_update": False, "action_delete": False}
    token = _token(org.id, {"communities": read, "discussions": read})
    out = ok(await call(registry, "list_discussions", {}, _ctx(db, org, token)))
    assert {i["uuid"] for i in out["items"]} == {"discussion_pinned", "discussion_question"}


async def test_community_moderation_words(registry, db, org, admin_user, community):
    ctx = _ctx(db, org, admin_user)
    out = ok(await call(registry, "get_community", {"community_uuid": "community_main"}, ctx))
    assert out["moderation_words"] == ["spam"]
    ok(await call(registry, "update_community", {"community_uuid": "community_main", "moderation_words": [" scam ", "", "x" * 150]}, ctx))
    await db.refresh(community)
    assert community.moderation_words == ["scam", "x" * 100]


async def test_community_helpers(db, org, admin_user, community):
    ctx = _ctx(db, org, admin_user)
    assert community_tools._iso(None) is None and community_tools._iso("soon") == "soon"
    assert await community_tools._author_refs(ctx, set()) == {}
    assert await community_tools._comment_counts(ctx, []) == {}
    assert await community_tools._discussion_items(ctx, []) == []
    orphan = Discussion(id=50, title="Orphan", content="", community_id=999, org_id=org.id, author_id=admin_user.id,
                        discussion_uuid="discussion_orphan", creation_date=NOW, update_date=NOW)
    assert await community_tools._discussion_items(ctx, [orphan]) == []
    with pytest.raises(HTTPException) as e:
        await community_tools._community_of(ctx, orphan)
    assert e.value.status_code == 404


# ─── media from a URL ────────────────────────────────────────────────────────


@pytest.fixture
def net(monkeypatch):
    fake = FakeNet({})
    monkeypatch.setattr(content_assets, "_transport", lambda: httpx.MockTransport(fake.handler))
    monkeypatch.setattr(content_assets, "_check_peer", lambda response, ip: None)
    real = content_assets._resolve

    def resolve(url):
        return [PUBLIC_IP] if httpx.URL(url).host.endswith(".test") else real(url)

    monkeypatch.setattr(content_assets, "_resolve", resolve)
    create = AsyncMock(return_value={"block_uuid": "block_new", "content": {"file_name": "image.png"}})
    monkeypatch.setitem(content_assets.KINDS, "image", content_assets.MediaKind("blockImage", 1024, "image/*", create))
    fake.create = create
    return fake


async def _add_media(registry, db, org, user, **args):
    return await call(registry, "add_media_block", {"activity_uuid": "activity_test", "kind": "image", **args},
                      _ctx(db, org, user, approved=True))


async def test_media_url_refusals(registry, db, org, admin_user, activity, net):
    cases = [
        ("file:///etc/passwd", "http and https"),
        ("javascript:alert(1)", "http and https"),
        ("data:image/png;base64,AAAA", "http and https"),
        ("gopher://files.test/a", "http and https"),
        ("https://files.test:99999/a.png", "not valid"),
        ("https:///a.png", "no host"),
        ("http://[::1]/a.png", "private"),
        ("http://0.0.0.0/a.png", "private"),
        ("http://10.0.0.7/a.png", "private"),
        ("http://192.168.1.1/a.png", "private"),
        ("http://2130706433/a.png", "private"),
        ("http://[::ffff:127.0.0.1]/a.png", "private"),
        ("https://user@files.test/a.png", "password"),
        ("https://youtu.be/abc", "youtube.com/embed/abc"),
        ("https://vimeo.com/123", "vimeo page"),
    ]
    for url, expected in cases:
        reason = denied(await _add_media(registry, db, org, admin_user, url=url))
        assert expected in reason, (url, reason)
    assert not net.requests
    net.create.assert_not_called()


async def test_media_body_refusals(registry, db, org, admin_user, activity, net):
    async def chunks():
        yield PNG
        yield PNG * 10

    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    net.routes.update({
        ("files.test", "/x.xhtml"): httpx.Response(200, content=PNG, headers={"content-type": "application/xhtml+xml"}),
        ("files.test", "/x.svg"): httpx.Response(200, content=svg, headers={"content-type": "image/svg+xml"}),
        ("files.test", "/lie.png"): httpx.Response(200, content=b"<html><script></script></html>", headers={"content-type": "image/png"}),
        ("files.test", "/declared"): httpx.Response(200, content=PNG, headers={"content-type": "image/png", "content-length": "5000"}),
        ("files.test", "/stream"): lambda: httpx.Response(200, content=chunks(), headers={"content-type": "image/png"}),
        ("files.test", "/tiny"): httpx.Response(200, content=b"tiny"),
        ("files.test", "/boom"): httpx.Response(500),
        ("files.test", "/nowhere"): httpx.Response(302, headers={"location": ""}),
    })
    for path, expected in (
        ("/x.xhtml", "web page"),
        ("/x.svg", "not a supported file"),
        ("/lie.png", "not a supported file"),
        ("/declared", "limit"),
        ("/stream", "limit"),
        ("/tiny", "not a supported file"),
        ("/boom", "answered 500"),
        ("/nowhere", "without a location"),
    ):
        reason = denied(await _add_media(registry, db, org, admin_user, url=f"https://files.test{path}"))
        assert expected in reason, (path, reason)
    net.create.assert_not_called()


async def test_media_network_errors_and_placement(registry, db, org, admin_user, activity, net):
    def broken():
        raise httpx.ConnectError("refused")

    net.routes[("files.test", "/down")] = broken
    net.routes[("files.test", "/a.png")] = httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    assert "ConnectError" in denied(await _add_media(registry, db, org, admin_user, url="https://files.test/down"))
    assert "needs the path" in denied(await _add_media(registry, db, org, admin_user, url="https://files.test/a.png", at="after"), "http_400")
    denied(await _add_media(registry, db, org, admin_user, url="https://files.test/a.png", at="after", path=[7]), "http_400")
    assert not [r for r in net.requests if r.url.path == "/a.png"]
    with patch.object(content_assets.d.Editor, "check", side_effect=content_assets.d.DocError("broken")):
        reason = denied(await _add_media(registry, db, org, admin_user, url="https://files.test/a.png"), "http_400")
    assert "stored but the block could not be placed" in reason


async def test_media_fetch_seams():
    with patch.object(content_assets, "_fetch", AsyncMock(side_effect=TimeoutError())):
        with pytest.raises(HTTPException) as e:
            await content_assets.fetch("https://files.test/a.png", "pdf")
    assert "longer than" in e.value.detail
    assert content_assets._transport() is None
    with patch.object(content_assets, "resolve_and_validate_url", return_value={"2001:db8::1", PUBLIC_IP}):
        assert content_assets._resolve("https://files.test/a.png") == [PUBLIC_IP, "2001:db8::1"]
    response = httpx.Response(200)
    with patch.object(content_assets, "assert_connected_peer_allowed") as peer:
        content_assets._check_peer(response, PUBLIC_IP)
    peer.assert_called_once_with(response, {PUBLIC_IP})


def test_sniff_more_formats():
    assert content_assets.sniff(b"\xff\xd8\xff\xe0" + b"\x00" * 12)[1] == "image/jpeg"
    assert content_assets.sniff(b"GIF89a" + b"\x00" * 10)[1] == "image/gif"
    assert content_assets.sniff(b"RIFF\x00\x00\x00\x00WEBPVP8 ")[1] == "image/webp"
    assert content_assets.sniff(b"RIFF\x00\x00\x00\x00WAVEfmt ")[1] == "audio/wav"
    assert content_assets.sniff(b"\x1a\x45\xdf\xa3" + b"\x00" * 12)[1] == "video/webm"
    assert content_assets.sniff(b"OggS" + b"\x00" * 12)[1] == "audio/ogg"
    assert content_assets.sniff(b"\xff\xfb\x90\x00")[2] == "mp3"
    assert content_assets.sniff(b"<svg></svg>") is None
