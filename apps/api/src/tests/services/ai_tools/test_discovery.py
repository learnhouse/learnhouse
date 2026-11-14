"""Discovery and the tool foundations at their edges: what search and fetch
hand a learner, what never crosses the organization boundary, and how the
references, approval targets and the pipeline refuse."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from pydantic import BaseModel, Field

from src.db.communities.communities import Community
from src.db.communities.discussion_comments import DiscussionComment
from src.db.communities.discussions import Discussion
from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskTypeEnum,
    GradingTypeEnum,
)
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.db.folders.folders import Folder
from src.db.media.media import Media
from src.db.organization_config import OrganizationConfig
from src.db.roles import Role, RoleTypeEnum
from src.db.paths import Path
from src.db.user_organizations import UserOrganization
from src.db.usergroups import UserGroup
from src.db.users import APITokenUser, User
from src.security.rbac import AccessAction
from src.services.ai.tools import (
    ActionTier,
    ToolContext,
    ToolRegistry,
    ToolSpec,
    get_registry,
    make_synthetic_request,
    run_tool,
)
from src.services.ai.tools import discovery, fetch, refs, results
from src.services.ai.tools import registry as reg
from src.services.ai.tools.base import ApprovalNeeded
from src.services.ai.tools.results import UNTRUSTED_NOTE
from src.services.ai.tools.targets import describe_target

NOW = str(datetime(2026, 1, 1, 12, 0, 0))


def ctx_for(db, org, user, **kw):
    kw.setdefault("mode", "execute")
    return ToolContext(
        request=make_synthetic_request(), db_session=db, user=user, org=org,
        org_slug=org.slug, surface="mcp", **kw,
    )


def ok(out):
    assert out.status == "executed", (out.denied_code, out.reason)
    return out.result


async def add(db, row):
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


def _token(org, creator_id, **kw):
    full = {"action_create": True, "action_read": True, "action_update": True, "action_delete": True}
    return APITokenUser(
        id=7, user_uuid="apitoken_x", username="token", org_id=org.id, token_name="CI token",
        rights={"courses": full, "users": full, "search": full}, created_by_user_id=creator_id, **kw,
    )


async def _course(db, org, uuid, name, published=True, public=True, id=None):
    return await add(db, Course(
        id=id, name=name, description="d", public=public, published=published,
        open_to_contributors=False, org_id=org.id, course_uuid=uuid, creation_date=NOW, update_date=NOW,
    ))


async def _chapter(db, course, uuid, name):
    return await add(db, Chapter(
        name=name, description="", org_id=course.org_id, course_id=course.id,
        chapter_uuid=uuid, creation_date=NOW, update_date=NOW,
    ))


async def _activity(db, course, uuid, name, published=True):
    return await add(db, Activity(
        name=name, activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE, content={"type": "doc", "content": []},
        published=published, org_id=course.org_id, course_id=course.id, activity_uuid=uuid,
        creation_date=NOW, update_date=NOW,
    ))


async def _assignment(db, course, chapter, activity, uuid, title, published=True):
    return await add(db, Assignment(
        title=title, description="", published=published, grading_type=GradingTypeEnum.NUMERIC,
        org_id=course.org_id, course_id=course.id, chapter_id=chapter.id, activity_id=activity.id,
        assignment_uuid=uuid, creation_date=NOW, update_date=NOW,
    ))


async def _member(db, org, role, uuid, username, first, last, id):
    u = await add(db, User(
        id=id, username=username, first_name=first, last_name=last, email=f"{username}@test.com",
        password="x", user_uuid=uuid, creation_date=NOW, update_date=NOW,
    ))
    await add(db, UserOrganization(user_id=u.id, org_id=org.id, role_id=role.id, creation_date=NOW, update_date=NOW))
    return u


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all(discovery.SPECS)
    return r


@pytest.fixture
def fetch_registry():
    r = ToolRegistry()
    r.register_all(fetch.SPECS)
    return r


@pytest.fixture(autouse=True)
def no_search_throttle():
    with patch("src.services.security.rate_limiting.check_search_rate_limit", return_value=(True, 0)) as limit:
        yield limit


@pytest.fixture(autouse=True)
def quiet_side_effects():
    with patch("src.services.communities.discussions.track", new_callable=AsyncMock):
        yield


async def search(registry, ctx, **args):
    return ok(await run_tool(registry, "search", args, ctx))


# ─── scoring helpers ─────────────────────────────────────────────────────────


def test_scoring_and_plan_helpers():
    assert discovery._score("", "Python") == 0.0 and discovery._score("Python", "") == 0.0
    assert discovery._score("Python", "python") == 1.0
    assert discovery._score("Python", "Python Basics") == 0.85
    assert discovery._score("basics", "python basics course") == 0.75
    assert discovery._score("python basics", "basics of python") == pytest.approx(0.7 * 2 / 3)
    assert discovery._score("cats", "dogs") == 0.0
    assert discovery._norm("  Ｐython   Basics ") == "python basics"
    assert discovery._plan({"config_version": "2.0", "plan": "pro"}) == "pro"
    assert discovery._plan({"cloud": {"plan": "standard"}}) == "standard"
    assert discovery._plan({}) == "free"


def test_verdict_needs_a_clear_winner():
    tie = discovery._verdict("Python", [{"name": "Python A"}, {"name": "Python B"}])
    assert tie["status"] == "ambiguous" and tie["match"] is None
    clear = discovery._verdict("Python", [{"name": "Python"}, {"name": "Python B"}])
    assert clear["status"] == "resolved" and clear["match"]["name"] == "Python"
    assert discovery._verdict("Python", [{"name": "Rust"}])["status"] == "not_found"


# ─── get_context ─────────────────────────────────────────────────────────────


async def test_get_context_admin_connection_and_plan(db, org, admin_user, registry):
    await add(db, OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "plan": "pro"}, creation_date=NOW, update_date=NOW))
    data = ok(await run_tool(registry, "get_context", {}, ctx_for(db, org, admin_user)))
    assert data["connection"]["access"] == "admin" and "manage members" in data["connection"]["meaning"]
    assert data["organization"]["plan"] == "pro"
    assert data["caller"]["role"]["uuid"] == "role_admin" and data["caller"]["name"] == "Admin User"


async def test_get_context_as_an_api_token(db, org, admin_user, registry):
    data = ok(await run_tool(registry, "get_context", {}, ctx_for(db, org, _token(org, admin_user.id))))
    assert data["caller"]["kind"] == "api_token" and data["caller"]["name"] == "CI token"
    assert "user_uuid" not in data["caller"]


# ─── search: the org boundary and drafts ─────────────────────────────────────


@pytest.fixture
async def cells(db, org, other_org):
    """One published course with drafts inside it, one draft course, and the
    same names in another organization."""
    bio = await _course(db, org, "course_bio", "Biology")
    ch = await _chapter(db, bio, "chapter_cells", "Cells chapter")
    page = await _activity(db, bio, "activity_cells", "Cells intro")
    draft_page = await _activity(db, bio, "activity_cells_draft", "Cells draft page", published=False)
    await _assignment(db, bio, ch, page, "assignment_cells", "Cells quiz")
    await _assignment(db, bio, ch, page, "assignment_cells_draft", "Cells homework", published=False)
    secret = await _course(db, org, "course_secret", "Secret course", published=False, public=False)
    await _chapter(db, secret, "chapter_secret", "Cells hidden chapter")
    await _activity(db, secret, "activity_secret", "Cells hidden page")
    foreign = await _course(db, other_org, "course_foreign", "Cells abroad")
    foreign_ch = await _chapter(db, foreign, "chapter_foreign", "Cells foreign chapter")
    foreign_page = await _activity(db, foreign, "activity_foreign", "Cells elsewhere")
    await _assignment(db, foreign, foreign_ch, foreign_page, "assignment_foreign", "Cells foreign quiz")
    return SimpleNamespace(course=bio, draft_page=draft_page)


FOREIGN = {"course_foreign", "chapter_foreign", "activity_foreign", "assignment_foreign"}
KINDS = ["course", "chapter", "activity", "assignment"]


async def test_learner_search_skips_drafts_and_other_orgs(db, org, regular_user, registry, cells):
    out = await search(registry, ctx_for(db, org, regular_user), query="Cells", kinds=KINDS, limit=25)
    found = {m["uuid"] for m in out["matches"]}
    assert {"chapter_cells", "activity_cells", "assignment_cells"} <= found
    assert not found & FOREIGN
    assert not found & {"activity_cells_draft", "assignment_cells_draft", "chapter_secret", "activity_secret", "course_secret"}
    quiz = next(m for m in out["matches"] if m["uuid"] == "assignment_cells")
    assert quiz["in"]["uuid"] == "course_bio" and quiz["url"].endswith("/dash/assignments/cells")


async def test_admin_search_sees_drafts_but_not_other_orgs(db, org, admin_user, registry, cells):
    out = await search(registry, ctx_for(db, org, admin_user), query="Cells", kinds=KINDS, limit=25)
    found = {m["uuid"] for m in out["matches"]}
    assert {"activity_cells_draft", "assignment_cells_draft", "chapter_secret", "activity_secret"} <= found
    assert not found & FOREIGN


async def test_admin_of_both_orgs_still_bound_to_the_connected_one(db, org, other_org, admin_user, admin_role, registry, cells):
    await add(db, UserOrganization(user_id=admin_user.id, org_id=other_org.id, role_id=admin_role.id, creation_date=NOW, update_date=NOW))
    out = await search(registry, ctx_for(db, org, admin_user), query="Cells", limit=25)
    assert not {m["uuid"] for m in out["matches"]} & FOREIGN
    inside = await run_tool(registry, "search", {"query": "Cells", "course_uuid": "course_foreign"}, ctx_for(db, org, admin_user))
    assert inside.denied_code == "http_404"


async def test_search_inside_a_course_defaults_to_its_items(db, org, regular_user, registry, cells):
    out = await search(registry, ctx_for(db, org, regular_user), query="Cells", course_uuid="course_bio")
    assert {m["kind"] for m in out["matches"]} <= {"chapter", "activity", "assignment"}
    assert all(m["in"]["uuid"] == "course_bio" for m in out["matches"])


async def test_two_letter_query_skips_the_org_wide_search(db, org, admin_user, registry, cells):
    with patch("src.services.search.search.search_across_org", new_callable=AsyncMock) as org_search:
        out = await search(registry, ctx_for(db, org, admin_user), query="Ce", kinds=["course", "chapter"])
    org_search.assert_not_awaited()
    assert {m["kind"] for m in out["matches"]} == {"chapter"}


async def test_search_rate_limit_is_keyed_to_the_acting_person(db, org, admin_user, registry, no_search_throttle):
    await search(registry, ctx_for(db, org, admin_user), query="anything")
    no_search_throttle.assert_called_with(admin_user.id)


# ─── search: community, library, playgrounds, members ───────────────────────


@pytest.fixture
async def gardening(db, org, other_org, admin_user, user_role):
    mine = await add(db, Community(name="Gardening club", public=True, org_id=org.id, community_uuid="community_garden", creation_date=NOW, update_date=NOW))
    theirs = await add(db, Community(name="Gardening abroad", public=True, org_id=other_org.id, community_uuid="community_garden_f", creation_date=NOW, update_date=NOW))
    await add(db, Discussion(title="Gardening tips", content="", community_id=mine.id, org_id=org.id, author_id=admin_user.id, discussion_uuid="discussion_garden", creation_date=NOW, update_date=NOW))
    await add(db, Discussion(title="Gardening tips too", content="", community_id=theirs.id, org_id=other_org.id, author_id=admin_user.id, discussion_uuid="discussion_garden_f", creation_date=NOW, update_date=NOW))
    await add(db, Folder(name="Gardening shelf", description="", public=True, org_id=org.id, folder_uuid="folder_garden", creation_date=NOW, update_date=NOW))
    await add(db, Folder(name="Gardening shelf", description="", public=True, org_id=other_org.id, folder_uuid="folder_garden_f", creation_date=NOW, update_date=NOW))
    await _member(db, org, user_role, "user_gardener", "gardener", "Gardening", "Fan", id=50)
    foreign_role = await add(db, Role(name="User", org_id=other_org.id, role_type=RoleTypeEnum.TYPE_ORGANIZATION, role_uuid="role_their_user", rights={}, creation_date=NOW, update_date=NOW))
    await _member(db, other_org, foreign_role, "user_gardener_f", "gardener_f", "Gardening", "Elsewhere", id=51)


GARDEN_FOREIGN = {"community_garden_f", "discussion_garden_f", "folder_garden_f", "user_gardener_f"}


async def test_search_maps_every_org_search_kind(db, org, admin_user, registry, gardening):
    out = await search(registry, ctx_for(db, org, admin_user), query="Gardening", limit=25)
    by_uuid = {m["uuid"]: m for m in out["matches"]}
    assert {"community_garden", "discussion_garden", "folder_garden", "user_gardener"} <= set(by_uuid)
    assert not set(by_uuid) & GARDEN_FOREIGN
    member = by_uuid["user_gardener"]
    assert member["kind"] == "member" and member["name"] == "Gardening Fan" and member["username"] == "gardener"
    assert "email" not in member
    assert by_uuid["discussion_garden"]["url"].endswith("/community/garden/discussion/garden")


async def test_learner_org_search_stays_in_the_org(db, org, regular_user, registry, gardening):
    out = await search(registry, ctx_for(db, org, regular_user), query="Gardening", limit=25)
    found = {m["uuid"] for m in out["matches"]}
    assert "community_garden" in found and not found & GARDEN_FOREIGN


async def test_groups_and_roles_stay_in_the_org(db, org, other_org, admin_user, registry):
    await add(db, UserGroup(name="Staff cohort", description="", org_id=org.id, usergroup_uuid="usergroup_mine", creation_date=NOW, update_date=NOW))
    await add(db, UserGroup(name="Staff cohort", description="", org_id=other_org.id, usergroup_uuid="usergroup_theirs", creation_date=NOW, update_date=NOW))
    await add(db, Role(name="Staff global", org_id=None, role_type=RoleTypeEnum.TYPE_GLOBAL, role_uuid="role_global_staff", rights={}, creation_date=NOW, update_date=NOW))
    await add(db, Role(name="Staff theirs", org_id=other_org.id, role_type=RoleTypeEnum.TYPE_ORGANIZATION, role_uuid="role_staff_theirs", rights={}, creation_date=NOW, update_date=NOW))
    out = await search(registry, ctx_for(db, org, admin_user), query="Staff", kinds=["usergroup", "role"])
    found = {m["uuid"] for m in out["matches"]}
    assert found == {"usergroup_mine", "role_global_staff"}


# ─── search: passages ────────────────────────────────────────────────────────


def _rag_row(**kw):
    row = dict(
        source_type="activity", course_uuid="course_test", course_name="Test Course", chapter_name="Ch",
        activity_uuid="activity_test", activity_name="Lesson", block_uuid=None, locator=None,
        chunk_text="Mitochondria are the powerhouse.", distance=0.2,
    )
    row.update(kw)
    return SimpleNamespace(**row)


@pytest.fixture
def rag():
    with patch("src.routers.ai.rag._open_rag", new_callable=AsyncMock) as open_rag, \
         patch("src.security.features_utils.usage.reserve_ai_credit", new_callable=AsyncMock) as reserve, \
         patch("src.security.features_utils.usage.refund_ai_credit", new_callable=MagicMock) as refund, \
         patch("src.services.ai.rag.query_service.search_course_content", new_callable=AsyncMock) as find:
        yield SimpleNamespace(open=open_rag, reserve=reserve, refund=refund, find=find)


async def test_passages_are_charged_and_returned(db, org, admin_user, registry, rag):
    rag.open.return_value = (org.id, SimpleNamespace(course_ids=[1]))
    rag.find.return_value = [_rag_row()]
    out = await search(registry, ctx_for(db, org, admin_user), query="mitochondria", in_content=True, limit=20)
    assert out["passages"][0]["snippet"].startswith("Mitochondria") and "content" not in out["passages"][0]
    assert "note" not in out
    rag.reserve.assert_awaited_once()
    assert rag.find.await_args.kwargs["top_k"] == 8
    assert rag.open.await_args.args[3] == org.slug


async def test_no_readable_courses_means_no_charge(db, org, regular_user, registry, rag):
    rag.open.return_value = (org.id, SimpleNamespace(course_ids=[]))
    out = await search(registry, ctx_for(db, org, regular_user), query="mitochondria", in_content=True)
    assert out["passages"] == [] and "note" not in out
    rag.reserve.assert_not_awaited()
    rag.find.assert_not_awaited()


@pytest.mark.parametrize("status", [402, 403, 429])
async def test_unavailable_content_search_becomes_a_note(db, org, admin_user, registry, rag, status):
    rag.open.side_effect = HTTPException(status_code=status, detail="AI is off")
    out = await search(registry, ctx_for(db, org, admin_user), query="mitochondria", in_content=True)
    assert out["passages"] == [] and out["note"] == "Content search is not available: AI is off"
    rag.reserve.assert_not_awaited()


async def test_other_content_search_errors_are_refusals(db, org, admin_user, registry, rag):
    rag.open.side_effect = HTTPException(status_code=404, detail="Course not found")
    out = await run_tool(registry, "search", {"query": "mitochondria", "in_content": True}, ctx_for(db, org, admin_user))
    assert out.denied_code == "http_404"


async def test_failed_content_search_refunds_the_credit(db, org, admin_user, registry, rag):
    rag.open.return_value = (org.id, SimpleNamespace(course_ids=[1]))
    rag.find.side_effect = RuntimeError("embedding provider down")
    with pytest.raises(RuntimeError):
        await run_tool(registry, "search", {"query": "mitochondria", "in_content": True}, ctx_for(db, org, admin_user))
    rag.refund.assert_called_once_with(org.id, 1)


async def test_foreign_course_never_reaches_content_search(db, org, other_org, admin_user, admin_role, registry, rag):
    await add(db, UserOrganization(user_id=admin_user.id, org_id=other_org.id, role_id=admin_role.id, creation_date=NOW, update_date=NOW))
    await _course(db, other_org, "course_far", "Far away")
    out = await run_tool(registry, "search", {"query": "mitochondria", "course_uuid": "course_far", "in_content": True}, ctx_for(db, org, admin_user))
    assert out.denied_code == "http_404"
    rag.open.assert_not_awaited()


# ─── fetch ───────────────────────────────────────────────────────────────────


async def test_fetch_task_opens_its_assignment(db, org, admin_user, fetch_registry, assignment_task):
    out = ok(await run_tool(fetch_registry, "fetch", {"id": assignment_task.assignment_task_uuid}, ctx_for(db, org, admin_user)))
    assert out["id"] == assignment_task.assignment_task_uuid
    assert out["metadata"] == {"kind": "assignment", "read_with": "get_assignment"}
    assert "What is 2+2?" in out["text"]


async def test_fetch_comment_opens_its_discussion_marked_untrusted(db, org, admin_user, fetch_registry):
    community = await add(db, Community(name="Main", public=True, org_id=org.id, community_uuid="community_main", creation_date=NOW, update_date=NOW))
    thread = await add(db, Discussion(title="Welcome", content="Say hello", community_id=community.id, org_id=org.id, author_id=admin_user.id, discussion_uuid="discussion_welcome", creation_date=NOW, update_date=NOW))
    await add(db, DiscussionComment(content="hi there", discussion_id=thread.id, author_id=admin_user.id, comment_uuid="comment_hi", creation_date=NOW, update_date=NOW))
    out = ok(await run_tool(fetch_registry, "fetch", {"id": "comment_hi"}, ctx_for(db, org, admin_user)))
    assert out["id"] == "comment_hi" and out["metadata"]["kind"] == "discussion"
    assert out["note"] == UNTRUSTED_NOTE and "Welcome" in out["text"] and "hi there" in out["text"]


async def test_fetch_refuses_children_of_other_orgs(db, org, other_org, admin_user, admin_role, fetch_registry, foreign_rows):
    await add(db, UserOrganization(user_id=admin_user.id, org_id=other_org.id, role_id=admin_role.id, creation_date=NOW, update_date=NOW))
    for kind in ("chapter", "assignment_task", "comment", "user", "assignment", "discussion"):
        out = await run_tool(fetch_registry, "fetch", {"id": foreign_rows[kind]}, ctx_for(db, org, admin_user))
        assert out.denied_code == "http_404", (kind, out.denied_code, out.reason)


async def test_fetch_passes_on_the_readers_own_code(db, org, regular_user, fetch_registry):
    await _course(db, org, "course_draft", "Draft", published=False, public=False)
    learner = ctx_for(db, org, regular_user)
    direct = await run_tool(get_registry(), "get_course", {"course_uuid": "course_draft"}, learner)
    via_fetch = await run_tool(fetch_registry, "fetch", {"id": "course_draft"}, learner)
    assert direct.status == via_fetch.status == "denied"
    assert via_fetch.denied_code == direct.denied_code and via_fetch.reason == direct.reason


@pytest.mark.parametrize("bad", ["media_abc", "apitoken_x", "0b0e1a52-1111-4c3e-9a55", "nothing at all"])
async def test_fetch_refuses_kinds_it_cannot_open(db, org, admin_user, fetch_registry, bad):
    out = await run_tool(fetch_registry, "fetch", {"id": bad}, ctx_for(db, org, admin_user))
    assert out.denied_code == "http_400" and "find one with search" in out.reason


# ─── refs: every kind is org-scoped ──────────────────────────────────────────


@pytest.fixture
async def foreign_rows(db, other_org):
    """One row of every kind, all in the other organization."""
    o = other_org.id
    course = await _course(db, other_org, "course_f", "Theirs", id=900)
    chapter = await _chapter(db, course, "chapter_f", "Theirs")
    activity = await _activity(db, course, "activity_f", "Theirs")
    assignment = await _assignment(db, course, chapter, activity, "assignment_f", "Theirs")
    await add(db, AssignmentTask(
        title="T", description="", hint="", assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER, contents={},
        max_grade_value=10, assignment_id=assignment.id, org_id=o, course_id=course.id, chapter_id=chapter.id,
        activity_id=activity.id, assignment_task_uuid="assignmenttask_f", creation_date=NOW, update_date=NOW,
    ))
    await add(db, UserGroup(name="Theirs", description="", org_id=o, usergroup_uuid="usergroup_f", creation_date=NOW, update_date=NOW))
    role = await add(db, Role(name="Theirs", org_id=o, role_type=RoleTypeEnum.TYPE_ORGANIZATION, role_uuid="role_f", rights={}, creation_date=NOW, update_date=NOW))
    community = await add(db, Community(name="Theirs", public=True, org_id=o, community_uuid="community_f", creation_date=NOW, update_date=NOW))
    user = await _member(db, other_org, role, "user_f", "theirs", "Their", "Member", id=901)
    thread = await add(db, Discussion(title="Theirs", content="", community_id=community.id, org_id=o, author_id=user.id, discussion_uuid="discussion_f", creation_date=NOW, update_date=NOW))
    await add(db, DiscussionComment(content="theirs", discussion_id=thread.id, author_id=user.id, comment_uuid="comment_f", creation_date=NOW, update_date=NOW))
    await add(db, Folder(name="Theirs", description="", public=True, org_id=o, folder_uuid="folder_f", creation_date=NOW, update_date=NOW))
    await add(db, Media(name="Theirs", org_id=o, media_uuid="media_f", creation_date=NOW, update_date=NOW))
    await add(db, Path(name="Theirs", published=True, org_id=o, path_uuid="path_f", creation_date=NOW, update_date=NOW))
    return {kind: f"{refs.KINDS[kind].prefix}f" for kind in refs.KINDS}


# Kinds whose model is in core (Plays and boards live in EE: ee/tests).
CORE_KINDS = sorted(k for k, spec in refs.KINDS.items() if not spec.model.startswith("ee."))


@pytest.mark.parametrize("kind", CORE_KINDS)
async def test_load_404s_foreign_ids_of_every_kind(db, org, other_org, admin_user, admin_role, foreign_rows, kind):
    # Even a caller who belongs to both organizations.
    await add(db, UserOrganization(user_id=admin_user.id, org_id=other_org.id, role_id=admin_role.id, creation_date=NOW, update_date=NOW))
    uuid = foreign_rows[kind]
    with pytest.raises(HTTPException) as e:
        await refs.load(ctx_for(db, org, admin_user), kind, uuid)
    assert e.value.status_code == 404 and "this organization" in e.value.detail
    # The same id does load from its own organization.
    assert getattr(await refs.load(ctx_for(db, other_org, admin_user), kind, uuid), refs.KINDS[kind].uuid_field) == uuid


async def test_global_roles_load_everywhere(db, org, admin_user):
    await add(db, Role(name="Maintainer", org_id=None, role_type=RoleTypeEnum.TYPE_GLOBAL, role_uuid="role_global", rights={}, creation_date=NOW, update_date=NOW))
    assert (await refs.load(ctx_for(db, org, admin_user), "role", "role_global")).name == "Maintainer"


async def test_unknown_unscoped_kind_fails_closed(db, org, admin_user, course):
    ghost = refs.Kind("ghost", "course_", "src.db.courses.courses.Course", "course_uuid", "name", org_scoped=False)
    with patch.dict(refs.KINDS, {"ghost": ghost}):
        with pytest.raises(HTTPException) as e:
            await refs.load(ctx_for(db, org, admin_user), "ghost", course.course_uuid)
    assert e.value.status_code == 404


async def test_refs_small_helpers(db, org, admin_user, course):
    ctx = ctx_for(db, org, admin_user)
    assert await refs.uuid_for(ctx, "course", None) is None
    assert await refs.uuid_for(ctx, "course", course.id) == course.course_uuid
    assert await refs.uuid_for(ctx, "course", 999) is None
    # A template missing one of its ids makes no link.
    assert await refs.web_url(ctx, "course", activity="activity_x") is None
    assert refs.label("course", SimpleNamespace(name="n" * 200)) == "n" * 117 + "..."
    assert refs.label("course", SimpleNamespace(name="Short")) == "Short"


def _hosting(**kw):
    return SimpleNamespace(hosting_config=SimpleNamespace(**{"frontend_domain": "", "domain": "", "ssl": False, **kw}))


async def test_web_base_falls_back_to_configured_host(db, org, admin_user):
    with patch("src.services.email.utils.get_org_signup_base_url", new_callable=AsyncMock, return_value=""), \
         patch("config.config.get_learnhouse_config", return_value=_hosting(frontend_domain="school.test/", ssl=True)):
        assert await refs.web_base(ctx_for(db, org, admin_user)) == "https://school.test"
    with patch("config.config.get_learnhouse_config", return_value=_hosting()):
        assert refs._configured_frontend() == ""
    with patch("config.config.get_learnhouse_config", return_value=_hosting(domain="lh.local")):
        assert refs._configured_frontend() == "http://lh.local"


# ─── targets ─────────────────────────────────────────────────────────────────


async def test_targets_for_unprefixed_and_unknown_args(db, org, admin_user):
    # Plays are EE-only: without EE a playground target carries no name.
    bare = "0b0e1a52-1111-4c3e-9a55-000000000001"
    assert await describe_target("update_playground", {"playground_uuid": bare}, "playground_uuid", org.id, db) == {
        "kind": "playground", "uuid": bare,
    }
    assert await describe_target("poke_widget", {"widget_uuid": "w1", "name": "W"}, "widget_uuid", org.id, db) == {
        "kind": "widget", "name": "W",
    }
    assert await describe_target("delete_course", {"course_uuid": 5}, "course_uuid", org.id, db) == {"kind": "course", "uuid": "5"}


async def test_targets_name_comments_only_inside_the_org(db, org, admin_user, foreign_rows):
    community = await add(db, Community(name="Main", public=True, org_id=org.id, community_uuid="community_main", creation_date=NOW, update_date=NOW))
    thread = await add(db, Discussion(title="Welcome", content="", community_id=community.id, org_id=org.id, author_id=admin_user.id, discussion_uuid="discussion_welcome", creation_date=NOW, update_date=NOW))
    await add(db, DiscussionComment(content="c" * 80, discussion_id=thread.id, author_id=admin_user.id, comment_uuid="comment_long", creation_date=NOW, update_date=NOW))
    await add(db, DiscussionComment(content="short", discussion_id=thread.id, author_id=admin_user.id, comment_uuid="comment_short", creation_date=NOW, update_date=NOW))
    long = await describe_target("delete_comment", {"comment_uuid": "comment_long"}, "comment_uuid", org.id, db)
    assert long["name"] == "c" * 60 + "..."
    assert (await describe_target("delete_comment", {"comment_uuid": "comment_short"}, "comment_uuid", org.id, db))["name"] == "short"
    theirs = await describe_target("delete_comment", {"comment_uuid": "comment_f"}, "comment_uuid", org.id, db)
    assert theirs == {"kind": "comment", "uuid": "comment_f"}
    # A foreign id with a new name shows only the name the caller typed.
    renamed = await describe_target("update_course", {"course_uuid": "course_f", "name": "Mine now"}, "course_uuid", org.id, db)
    assert renamed == {"kind": "course", "uuid": "course_f", "name": "Mine now"}


# ─── registry ────────────────────────────────────────────────────────────────


class _Named(BaseModel):
    course_uuid: str
    name: str | None = None


async def _ok(ctx, p):
    return {"ok": True}


def _spec(name="touch", tier=ActionTier.EDIT, execute=_ok, **kw):
    kw.setdefault("target_param", "course_uuid")
    return ToolSpec(
        name=name, description=name, params_model=_Named, tier=tier, rights_bucket="courses",
        access_action=AccessAction.UPDATE, execute=execute, target_kind="course", **kw,
    )


def _registry(*specs):
    r = ToolRegistry()
    r.register_all(list(specs))
    return r


def test_duplicate_names_are_refused():
    r = _registry(_spec())
    with pytest.raises(ValueError, match="duplicate tool name"):
        r.register(_spec())


def test_token_rights_read_from_models_or_dicts():
    assert reg._token_bucket_allows(SimpleNamespace(courses=SimpleNamespace(action_update=True)), "courses", AccessAction.UPDATE)
    assert not reg._token_bucket_allows(SimpleNamespace(courses=SimpleNamespace(action_update=False)), "courses", AccessAction.UPDATE)
    assert not reg._token_bucket_allows(SimpleNamespace(), "courses", AccessAction.READ)
    assert not reg._token_bucket_allows({"courses": {}}, "courses", AccessAction.READ)
    assert not reg._token_bucket_allows(None, "courses", AccessAction.READ)


async def test_proposal_names_its_target(db, org, admin_user, course):
    out = await run_tool(_registry(_spec()), "touch", {"course_uuid": course.course_uuid, "name": "Renamed"}, ctx_for(db, org, admin_user, mode="confirm"))
    assert out.status == "proposed"
    assert out.proposal.target == {"kind": "course", "uuid": course.course_uuid, "name": "Renamed"}


@pytest.mark.parametrize("error, code", [
    (HTTPException(status_code=403, detail="nope"), "rbac_denied"),
    (RuntimeError("db down"), "rbac_error"),
])
async def test_rbac_preflight_failures_deny(db, org, admin_user, course, error, code):
    ran = AsyncMock(return_value={"ok": True})
    with patch.object(reg, "check_resource_access", new_callable=AsyncMock, side_effect=error):
        out = await run_tool(_registry(_spec(execute=ran)), "touch", {"course_uuid": course.course_uuid}, ctx_for(db, org, admin_user))
    assert out.denied_code == code
    ran.assert_not_awaited()


async def test_approved_call_that_still_asks_for_approval_raises(db, org, admin_user, course):
    async def asks(ctx, p):
        raise ApprovalNeeded("again")

    r = _registry(_spec(execute=asks))
    with pytest.raises(ApprovalNeeded):
        await run_tool(r, "touch", {"course_uuid": course.course_uuid}, ctx_for(db, org, admin_user, approved=True))
    out = await run_tool(r, "touch", {"course_uuid": course.course_uuid}, ctx_for(db, org, admin_user))
    assert out.denied_code == "approval_required" and out.reason == "again"


class _Many(BaseModel):
    a: int
    b: int
    c: int
    d: int
    e: int
    f: int
    g: str = Field(..., min_length=3)


async def test_validation_summary_names_the_first_five_fields(db, org, admin_user):
    r = _registry(ToolSpec(name="many", description="m", params_model=_Many, tier=ActionTier.READ, rights_bucket=None, access_action=AccessAction.READ, execute=_ok))
    out = await run_tool(r, "many", None, ctx_for(db, org, admin_user))
    assert out.denied_code == "invalid_args" and out.reason.startswith("Invalid arguments")
    assert out.reason.count(";") == 4 and "a: Field required" in out.reason and "g:" not in out.reason
    bad = await run_tool(_registry(*discovery.SPECS), "search", {"query": "x", "limit": 99}, ctx_for(db, org, admin_user))
    assert bad.denied_code == "invalid_args" and "query:" in bad.reason and "limit:" in bad.reason


async def test_search_and_fetch_refuse_strangers(db, org, other_org, admin_user, admin_role, registry, anonymous_user):
    outsider = await _member(db, other_org, admin_role, "user_out", "outsider", "Out", "Sider", id=60)
    from src.db.users import PublicUser

    stranger = PublicUser(id=outsider.id, username="outsider", first_name="Out", last_name="Sider", email="outsider@test.com", user_uuid="user_out")
    assert (await run_tool(registry, "search", {"query": "anything"}, ctx_for(db, org, stranger))).denied_code == "not_a_member"
    assert (await run_tool(registry, "search", {"query": "anything"}, ctx_for(db, org, anonymous_user))).denied_code == "unauthenticated"
    token = _token(other_org, admin_user.id)
    assert (await run_tool(registry, "get_context", {}, ctx_for(db, org, token))).denied_code == "org_mismatch"


# ─── base / results ──────────────────────────────────────────────────────────


def test_approval_fails_closed_and_mode_copies(db, org, admin_user):
    def boom(p):
        raise RuntimeError("bad predicate")

    spec = _spec(approval_if=boom)
    assert spec.approval_for(_Named(course_uuid="course_x")) is True
    assert spec.may_need_approval
    ctx = ctx_for(db, org, admin_user)
    other = ctx.with_mode("confirm")
    assert other.mode == "confirm" and ctx.mode == "execute" and other.org is ctx.org


def test_negative_cursor_is_refused():
    with pytest.raises(HTTPException) as e:
        results.offset_of(results.cursor_for(-1))
    assert e.value.status_code == 400


@pytest.fixture(autouse=True)
def _ai_credit_store(ai_credit_spy):
    """Fake credit store + usage ledger for metered AI charges (conftest)."""
    yield ai_credit_spy
