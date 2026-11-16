"""Agent tools for communities and the library (Plays and boards: ee/tests).

Every call goes through `run_tool` with a registry holding just these
modules' SPECS, so argument validation, the token gate, the RBAC pre-flight,
the approval gate and the org boundary all run as they do in production.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import select

from src.db.communities.communities import Community
from src.db.communities.discussion_comments import DiscussionComment
from src.db.communities.discussions import Discussion
from src.db.courses.courses import Course
from src.db.folders.folder_content import FolderContent
from src.db.folders.folders import Folder
from src.db.media.media import Media
from src.db.usergroups import UserGroup
from src.db.users import APITokenUser
from src.services.ai.tools import (
    ToolContext,
    ToolRegistry,
    make_synthetic_request,
    run_tool,
)
from src.services.ai.tools import communities, library
from src.services.ai.tools.results import UNTRUSTED_NOTE

NOW = str(datetime(2026, 1, 1, 12, 0, 0))


@pytest.fixture(autouse=True)
def quiet_side_effects():
    """Webhooks and analytics are not under test here."""
    targets = [
        "src.services.communities.discussions.dispatch_webhooks",
        "src.services.communities.discussions.track",
        "src.services.communities.comments.dispatch_webhooks",
        "src.services.folders.folders.dispatch_webhooks",
    ]
    patches = [patch(t, new_callable=AsyncMock) for t in targets]
    for p in patches:
        p.start()
    yield
    for p in patches:
        p.stop()


@pytest.fixture
def registry():
    r = ToolRegistry()
    for module in (communities, library):
        r.register_all(module.SPECS)
    return r


def ctx(db, org, user, *, approved=False):
    return ToolContext(
        request=make_synthetic_request(),
        db_session=db,
        user=user,
        org=org,
        org_slug=org.slug,
        mode="execute",
        scope_key="test",
        surface="mcp",
        approved=approved,
    )


async def call(registry, db, org, user, name, args, *, approved=False):
    return await run_tool(registry, name, args, ctx(db, org, user, approved=approved))


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


def _token(org_id):
    full = {"action_create": True, "action_read": True, "action_update": True, "action_delete": True}
    return APITokenUser(
        id=7,
        user_uuid="apitoken_x",
        username="token",
        org_id=org_id,
        rights={"boards": full, "playgrounds": full},
        created_by_user_id=1,
    )


# ─── fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture
async def learners_post(db, user_role):
    """The default User role may post in communities (the test role is read-only)."""
    rights = dict(user_role.rights)
    rights["discussions"] = {
        **rights["discussions"], "action_create": True, "action_update_own": True, "action_delete_own": True,
    }
    user_role.rights = rights
    return await add(db, user_role)


@pytest.fixture
async def community(db, org):
    return await add(db, Community(
        id=1, name="Main", description="The main community", public=True, org_id=org.id,
        community_uuid="community_main", creation_date=NOW, update_date=NOW,
    ))


@pytest.fixture
async def private_community(db, org):
    return await add(db, Community(
        id=2, name="Staff", description="Staff only", public=False, org_id=org.id,
        community_uuid="community_staff", creation_date="2025-01-01 00:00:00", update_date=NOW,
    ))


@pytest.fixture
async def foreign_community(db, other_org):
    return await add(db, Community(
        id=3, name="Elsewhere", public=True, org_id=other_org.id,
        community_uuid="community_foreign", creation_date=NOW, update_date=NOW,
    ))


@pytest.fixture
async def discussion(db, org, community, admin_user):
    return await add(db, Discussion(
        id=1, title="Welcome", content="Say hello", label="announcement", community_id=community.id,
        org_id=org.id, author_id=admin_user.id, discussion_uuid="discussion_welcome",
        upvote_count=3, creation_date=NOW, update_date=NOW,
    ))


@pytest.fixture
async def learner_discussion(db, org, community, regular_user):
    return await add(db, Discussion(
        id=2, title="My question", content="How do I start?", label="question",
        community_id=community.id, org_id=org.id, author_id=regular_user.id,
        discussion_uuid="discussion_question", upvote_count=1,
        creation_date="2026-01-02 09:00:00", update_date=NOW,
    ))


@pytest.fixture
async def other_course(db, org):
    return await add(db, Course(
        id=2, name="Second Course", description="", public=True, published=True,
        open_to_contributors=False, org_id=org.id, course_uuid="course_second",
        creation_date=NOW, update_date=NOW,
    ))


@pytest.fixture
async def foreign_course(db, other_org):
    return await add(db, Course(
        id=3, name="Foreign Course", description="", public=True, published=True,
        open_to_contributors=False, org_id=other_org.id, course_uuid="course_foreign",
        creation_date=NOW, update_date=NOW,
    ))


@pytest.fixture
async def usergroup(db, org):
    return await add(db, UserGroup(
        id=1, name="Cohort A", description="", org_id=org.id, usergroup_uuid="usergroup_a",
        creation_date=NOW, update_date=NOW,
    ))


@pytest.fixture
async def foreign_usergroup(db, other_org):
    return await add(db, UserGroup(
        id=2, name="Theirs", description="", org_id=other_org.id, usergroup_uuid="usergroup_theirs",
        creation_date=NOW, update_date=NOW,
    ))


# ─── communities ─────────────────────────────────────────────────────────────


async def test_list_communities_refs_paging_and_org_boundary(
    db, org, admin_user, registry, community, private_community, foreign_community, course, discussion
):
    community.course_id = course.id
    await add(db, community)
    page = ok(await call(registry, db, org, admin_user, "list_communities", {"limit": 1}))
    assert page["total"] == 2 and page["has_more"] and page["next_cursor"]
    first = page["items"][0]
    assert first["kind"] == "community" and first["uuid"] == "community_main"
    assert first["course"]["uuid"] == "course_test" and first["discussions"] == 1
    assert "id" not in first and "course_id" not in first
    rest = ok(await call(registry, db, org, admin_user, "list_communities", {"limit": 5, "cursor": page["next_cursor"]}))
    assert [c["uuid"] for c in rest["items"]] == ["community_staff"] and not rest["has_more"]


async def test_list_communities_hides_group_restricted_from_learner(
    db, org, regular_user, registry, community, private_community, usergroup
):
    from src.db.usergroup_resources import UserGroupResource

    await add(db, UserGroupResource(
        usergroup_id=usergroup.id, resource_uuid="community_staff", org_id=org.id,
        creation_date=NOW, update_date=NOW,
    ))
    page = ok(await call(registry, db, org, regular_user, "list_communities", {}))
    assert [c["uuid"] for c in page["items"]] == ["community_main"]


async def test_get_community_details_and_untrusted(db, org, admin_user, registry, community, discussion):
    out = ok(await call(registry, db, org, admin_user, "get_community", {"community_uuid": "community_main"}))
    assert out["community"]["name"] == "Main" and out["discussions"] == 1
    assert out["recent_discussions"][0]["uuid"] == "discussion_welcome"
    assert out["note"] == UNTRUSTED_NOTE


async def test_get_community_refuses_other_org_and_wrong_prefix(
    db, org, admin_user, registry, foreign_community, course
):
    denied(await call(registry, db, org, admin_user, "get_community", {"community_uuid": "community_foreign"}))
    reason = denied(await call(registry, db, org, admin_user, "get_community", {"community_uuid": "course_test"}), "http_400")
    assert "community_" in reason


async def test_create_community_public_needs_approval(db, org, admin_user, registry, admin_role):
    denied(await call(registry, db, org, admin_user, "create_community", {"name": "Open", "public": True}), "approval_required")
    out = ok(await call(registry, db, org, admin_user, "create_community", {"name": "Open", "public": True}, approved=True))
    assert out["ok"] and out["community"]["uuid"].startswith("community_")
    out = ok(await call(registry, db, org, admin_user, "create_community", {"name": "Closed"}))
    row = (await db.execute(select(Community).where(Community.community_uuid == out["community"]["uuid"]))).scalars().one()
    assert row.public is False


async def test_create_community_learner_denied(db, org, regular_user, registry):
    denied(await call(registry, db, org, regular_user, "create_community", {"name": "Mine"}))


async def test_create_community_course_link_checks(db, org, admin_user, registry, community, course, foreign_course):
    community.course_id = course.id
    await add(db, community)
    reason = denied(await call(registry, db, org, admin_user, "create_community", {"name": "X", "course_uuid": "course_test"}, approved=True), "http_400")
    assert "already has a linked community" in reason
    denied(await call(registry, db, org, admin_user, "create_community", {"name": "X", "course_uuid": "course_foreign"}, approved=True), "http_404")


async def test_update_community_link_and_unlink(db, org, admin_user, registry, community, course):
    args = {"community_uuid": "community_main", "course_uuid": "course_test"}
    denied(await call(registry, db, org, admin_user, "update_community", args), "approval_required")
    out = ok(await call(registry, db, org, admin_user, "update_community", args, approved=True))
    assert out["course"]["uuid"] == "course_test"
    out = ok(await call(registry, db, org, admin_user, "update_community", {"community_uuid": "community_main", "course_uuid": "none"}, approved=True))
    assert "course" not in out
    out = ok(await call(registry, db, org, admin_user, "update_community", {"community_uuid": "community_main", "name": "Renamed"}))
    assert out["community"]["name"] == "Renamed"
    denied(await call(registry, db, org, admin_user, "update_community", {"community_uuid": "community_main"}), "http_400")


async def test_learner_can_post_discussion_and_comment(db, org, regular_user, registry, community, discussion, learners_post):
    out = ok(await call(registry, db, org, regular_user, "create_discussion", {
        "community_uuid": "community_main", "title": "Hi all", "body": "First post", "label": "general",
    }))
    assert out["discussion"]["uuid"].startswith("discussion_") and "body" not in out
    out = ok(await call(registry, db, org, regular_user, "create_comment", {
        "discussion_uuid": "discussion_welcome", "body": "Thanks!",
    }))
    assert out["comment"]["uuid"].startswith("comment_")
    assert "Thanks!" not in str(out)


async def test_comment_size_cap(db, org, regular_user, registry, discussion, learners_post):
    denied(await call(registry, db, org, regular_user, "create_comment", {
        "discussion_uuid": "discussion_welcome", "body": "x" * 10001,
    }), "invalid_args")


async def test_moderation_block_is_readable(db, org, regular_user, registry, community, learners_post):
    community.moderation_words = ["forbidden"]
    await add(db, community)
    reason = denied(await call(registry, db, org, regular_user, "create_discussion", {
        "community_uuid": "community_main", "title": "forbidden topic", "body": "text",
    }))
    assert "{" not in reason and "not allowed" in reason


async def test_learner_cannot_post_in_other_org(db, org, regular_user, registry, foreign_community, learners_post):
    denied(await call(registry, db, org, regular_user, "create_discussion", {
        "community_uuid": "community_foreign", "title": "t", "body": "b",
    }))
    assert (await db.execute(select(Discussion))).scalars().first() is None


async def test_update_discussion_author_and_moderator(
    db, org, regular_user, admin_user, registry, learner_discussion, learners_post
):
    out = ok(await call(registry, db, org, regular_user, "update_discussion", {
        "discussion_uuid": "discussion_question", "title": "Better question",
    }))
    assert "title" in out["summary"]
    # A learner asking to pin and retitle changes nothing.
    reason = denied(await call(registry, db, org, regular_user, "update_discussion", {
        "discussion_uuid": "discussion_question", "title": "Sneaky", "pinned": True,
    }), "http_403")
    assert "moderators" in reason
    await db.refresh(learner_discussion)
    assert learner_discussion.title == "Better question" and not learner_discussion.is_pinned
    out = ok(await call(registry, db, org, admin_user, "update_discussion", {
        "discussion_uuid": "discussion_question", "pinned": True, "locked": True,
    }))
    assert out["discussion"]["pinned"] and out["discussion"]["locked"]


async def test_get_discussion_with_paged_comments(db, org, admin_user, regular_user, registry, discussion):
    for i in range(3):
        await add(db, DiscussionComment(
            content=f"comment {i}", discussion_id=discussion.id, author_id=regular_user.id,
            comment_uuid=f"comment_{i}", creation_date=f"2026-01-0{i + 2} 00:00:00", update_date=NOW,
        ))
    out = ok(await call(registry, db, org, regular_user, "get_discussion", {"discussion_uuid": "discussion_welcome", "limit": 2}))
    assert out["body"] == "Say hello" and out["author"]["name"] == "admin"
    assert [c["comment"]["uuid"] for c in out["comments"]["items"]] == ["comment_0", "comment_1"]
    assert out["comments"]["total"] == 3 and out["comments"]["has_more"]
    assert out["note"] == UNTRUSTED_NOTE
    assert "email" not in str(out)


async def test_list_discussions_filters_and_scope(
    db, org, admin_user, regular_user, registry, discussion, learner_discussion, foreign_community, other_org
):
    await add(db, Discussion(
        title="Hidden", content="", community_id=foreign_community.id, org_id=other_org.id,
        author_id=admin_user.id, discussion_uuid="discussion_hidden", creation_date=NOW, update_date=NOW,
    ))
    page = ok(await call(registry, db, org, admin_user, "list_discussions", {"sort": "top"}))
    assert [d["uuid"] for d in page["items"]] == ["discussion_welcome", "discussion_question"]
    assert page["items"][0]["url"].endswith("/community/main/discussion/welcome")
    page = ok(await call(registry, db, org, admin_user, "list_discussions", {"author_uuid": "regular"}))
    assert [d["uuid"] for d in page["items"]] == ["discussion_question"]
    page = ok(await call(registry, db, org, admin_user, "list_discussions", {"community_uuid": "community_main", "label": "announcement"}))
    assert [d["uuid"] for d in page["items"]] == ["discussion_welcome"]
    assert page["note"] == UNTRUSTED_NOTE
    page = ok(await call(registry, db, org, admin_user, "list_discussions", {"sort": "hot", "limit": 1}))
    assert len(page["items"]) == 1 and page["has_more"]


async def test_delete_discussion_and_comment(db, org, admin_user, regular_user, registry, discussion, learner_discussion):
    comment = await add(db, DiscussionComment(
        content="mine", discussion_id=discussion.id, author_id=regular_user.id,
        comment_uuid="comment_mine", creation_date=NOW, update_date=NOW,
    ))
    denied(await call(registry, db, org, regular_user, "delete_comment", {"comment_uuid": "comment_mine"}), "approval_required")
    ok(await call(registry, db, org, regular_user, "delete_comment", {"comment_uuid": "comment_mine"}, approved=True))
    assert await db.get(DiscussionComment, comment.id) is None
    # A learner cannot delete someone else's thread.
    denied(await call(registry, db, org, regular_user, "delete_discussion", {"discussion_uuid": "discussion_welcome"}, approved=True), "http_403")
    ok(await call(registry, db, org, regular_user, "delete_discussion", {"discussion_uuid": "discussion_question"}, approved=True))
    ok(await call(registry, db, org, admin_user, "delete_discussion", {"discussion_uuid": "discussion_welcome"}, approved=True))


async def test_delete_community_destructive(db, org, admin_user, regular_user, registry, community):
    denied(await call(registry, db, org, admin_user, "delete_community", {"community_uuid": "community_main"}), "approval_required")
    denied(await call(registry, db, org, regular_user, "delete_community", {"community_uuid": "community_main"}, approved=True))
    ok(await call(registry, db, org, admin_user, "delete_community", {"community_uuid": "community_main"}, approved=True))


# ─── library ─────────────────────────────────────────────────────────────────


async def test_browse_root_and_folder(db, org, admin_user, registry, folder, other_course):
    await add(db, FolderContent(folder_id=None, resource_uuid="course_second", org_id=org.id, creation_date=NOW, update_date=NOW))
    root = ok(await call(registry, db, org, admin_user, "browse_library", {}))
    kinds = [(e["kind"], e["uuid"]) for e in root["items"]]
    assert kinds == [("folder", "folder_test"), ("course", "course_second")]
    assert root["items"][0]["items"] == 1 and root["items"][1]["url"].endswith("/course/second")
    inside = ok(await call(registry, db, org, admin_user, "browse_library", {"folder_uuid": "folder_test"}))
    assert inside["folder"]["uuid"] == "folder_test"
    assert [(e["kind"], e["uuid"]) for e in inside["items"]] == [("course", "course_test")]
    paged = ok(await call(registry, db, org, admin_user, "browse_library", {"limit": 1}))
    assert paged["has_more"] and paged["total"] == 2


async def test_browse_other_org_folder_refused(db, org, other_org, admin_user, registry):
    await add(db, Folder(name="Theirs", org_id=other_org.id, folder_uuid="folder_theirs", creation_date=NOW, update_date=NOW))
    denied(await call(registry, db, org, admin_user, "browse_library", {"folder_uuid": "folder_theirs"}))


async def test_create_and_update_folder(db, org, admin_user, regular_user, registry, folder):
    out = ok(await call(registry, db, org, admin_user, "create_folder", {"name": "Sub", "parent_folder_uuid": "folder_test", "color": "rose"}))
    row = (await db.execute(select(Folder).where(Folder.folder_uuid == out["folder"]["uuid"]))).scalars().one()
    assert row.parent_folder_id == folder.id and row.public is False and row.color == "rose"
    denied(await call(registry, db, org, admin_user, "create_folder", {"name": "Open", "public": True}), "approval_required")
    denied(await call(registry, db, org, admin_user, "create_folder", {"name": "Bad", "color": "red;}"}), "invalid_args")
    denied(await call(registry, db, org, regular_user, "create_folder", {"name": "Mine"}))
    denied(await call(registry, db, org, admin_user, "update_folder", {"folder_uuid": row.folder_uuid, "public": True}), "approval_required")
    ok(await call(registry, db, org, admin_user, "update_folder", {"folder_uuid": row.folder_uuid, "parent_folder_uuid": "root", "name": "Top"}))
    await db.refresh(row)
    assert row.parent_folder_id is None and row.name == "Top"


async def test_delete_folder_keeps_resources(db, org, admin_user, registry, folder, course):
    out = ok(await call(registry, db, org, admin_user, "delete_folder", {"folder_uuid": "folder_test"}, approved=True))
    assert "not deleted" in out["summary"]
    assert await db.get(Course, course.id) is not None


async def test_place_in_library_garbage_id(db, org, admin_user, registry, folder):
    reason = denied(await call(registry, db, org, admin_user, "place_in_library", {"resource_uuid": "garbage"}), "http_400")
    assert "not a valid library resource id" in reason


async def test_place_add_move_remove(db, org, admin_user, registry, folder, other_course):
    async def where():
        rows = (await db.execute(select(FolderContent).where(FolderContent.resource_uuid == "course_second"))).scalars().all()
        return sorted(str(r.folder_id) for r in rows)

    ok(await call(registry, db, org, admin_user, "place_in_library", {"resource_uuid": "course_second"}))
    assert await where() == ["None"]
    out = ok(await call(registry, db, org, admin_user, "place_in_library", {
        "resource_uuid": "course_second", "folder_uuid": "folder_test", "from_folder_uuid": "root",
    }))
    assert out["folder"]["uuid"] == "folder_test" and out["from_folder"] == "root"
    assert await where() == [str(folder.id)]
    ok(await call(registry, db, org, admin_user, "place_in_library", {"resource_uuid": "course_second", "from_folder_uuid": "folder_test"}))
    assert await where() == ["None"]
    out = ok(await call(registry, db, org, admin_user, "place_in_library", {"resource_uuid": "course_second", "remove": True}))
    assert await where() == [] and "unchanged" in out["summary"]
    out = ok(await call(registry, db, org, admin_user, "place_in_library", {"resource_uuid": "course_second", "remove": True}))
    assert "nothing changed" in out["summary"]


async def test_denied_move_keeps_item(db, org, regular_user, registry, folder):
    denied(await call(registry, db, org, regular_user, "place_in_library", {
        "resource_uuid": "course_test", "from_folder_uuid": "folder_test",
    }))
    rows = (await db.execute(select(FolderContent).where(FolderContent.resource_uuid == "course_test"))).scalars().all()
    assert [r.folder_id for r in rows] == [folder.id]


async def test_place_refuses_other_org_resource(db, org, admin_user, registry, folder, foreign_course):
    denied(await call(registry, db, org, admin_user, "place_in_library", {"resource_uuid": "course_foreign", "folder_uuid": "folder_test"}), "http_404")


async def test_list_media(db, org, other_org, admin_user, registry):
    for i, name in enumerate(["Intro video", "Syllabus", "Intro slides"]):
        await add(db, Media(name=name, org_id=org.id, media_uuid=f"media_{i}", file_size=10 + i, storage_key="secret", creation_date=NOW, update_date=NOW))
    await add(db, Media(name="Intro other", org_id=other_org.id, media_uuid="media_foreign", creation_date=NOW, update_date=NOW))
    page = ok(await call(registry, db, org, admin_user, "list_media", {"limit": 2}))
    assert len(page["items"]) == 2 and page["has_more"] and page["items"][0]["kind"] == "media"
    assert "secret" not in str(page)
    rest = ok(await call(registry, db, org, admin_user, "list_media", {"limit": 2, "cursor": page["next_cursor"]}))
    assert len(rest["items"]) == 1 and not rest["has_more"]
    found = ok(await call(registry, db, org, admin_user, "list_media", {"query": "intro"}))
    assert sorted(m["uuid"] for m in found["items"]) == ["media_0", "media_2"]
    one = ok(await call(registry, db, org, admin_user, "list_media", {"media_uuid": "media_1"}))
    assert one["items"][0]["name"] == "Syllabus" and one["items"][0]["type"] == "upload"
    denied(await call(registry, db, org, admin_user, "list_media", {"media_uuid": "media_foreign"}))


async def test_moderator_editing_someone_elses_post_needs_approval(db, org, admin_user):
    from src.services.ai.tools import ActionTier, ToolRegistry, ToolSpec, make_synthetic_request, run_tool
    from src.services.ai.tools.base import ToolContext, require_approval
    from src.security.rbac import AccessAction
    from pydantic import BaseModel

    class P(BaseModel):
        mine: bool

    async def execute(ctx, p):
        if not p.mine:
            require_approval(ctx, "Editing a post written by someone else needs the user's approval.")
        return {"ok": True}

    registry = ToolRegistry()
    registry.register(ToolSpec(
        name="edit_post", description="e", params_model=P, tier=ActionTier.EDIT, rights_bucket=None,
        access_action=AccessAction.UPDATE, execute=execute, approval_in_call=True,
    ))
    assert registry.get("edit_post").may_need_approval

    def ctx(mode="execute", approved=False):
        return ToolContext(request=make_synthetic_request(), db_session=db, user=admin_user, org=org,
                           org_slug=org.slug, mode=mode, surface="mcp", approved=approved)

    assert (await run_tool(registry, "edit_post", {"mine": True}, ctx())).status == "executed"
    denied = await run_tool(registry, "edit_post", {"mine": False}, ctx())
    assert denied.denied_code == "approval_required" and "someone else" in denied.reason
    assert (await run_tool(registry, "edit_post", {"mine": False}, ctx(approved=True))).status == "executed"
    # The in-app agent in autonomous mode turns it into a proposal.
    proposed = await run_tool(registry, "edit_post", {"mine": False}, ctx(mode="autonomous"))
    assert proposed.status == "proposed"
