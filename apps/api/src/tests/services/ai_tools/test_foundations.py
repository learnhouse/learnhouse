"""Shared tool foundations: org-scoped references, result shapes, the org
boundary on access checks, and the orientation tools (get_context, search)."""

from datetime import datetime
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from src.db.courses.courses import Course
from src.db.user_organizations import UserOrganization
from src.security.org_scope import get_org_scope, org_scope
from src.security.rbac import AccessAction, AccessContext, check_resource_access
from src.services.ai.tools import ToolContext, ToolRegistry, make_synthetic_request, run_tool
from src.services.ai.tools import discovery, refs, results

NOW = str(datetime.now())


def ctx_for(db, org, user, **kw):
    return ToolContext(
        request=make_synthetic_request(), db_session=db, user=user, org=org,
        org_slug=org.slug, mode="execute", surface="mcp", **kw,
    )


async def _course(db, org, uuid, name, published=True, public=True):
    c = Course(
        name=name, description="d", public=public, published=published, open_to_contributors=False,
        org_id=org.id, course_uuid=uuid, creation_date=NOW, update_date=NOW,
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return c


# ─── refs ────────────────────────────────────────────────────────────────────


async def test_load_is_org_scoped(db, org, other_org, admin_user, course):
    ctx = ctx_for(db, org, admin_user)
    assert (await refs.load(ctx, "course", course.course_uuid)).id == course.id
    foreign = await _course(db, other_org, "course_foreign", "Theirs")
    with pytest.raises(HTTPException) as e:
        await refs.load(ctx, "course", foreign.course_uuid)
    assert e.value.status_code == 404 and "this organization" in e.value.detail
    with pytest.raises(HTTPException) as e:
        await refs.load(ctx, "course", "chapter_123")
    assert e.value.status_code == 400 and "chapter id" in e.value.detail
    with pytest.raises(HTTPException):
        await refs.load(ctx, "course", "course_missing")


async def test_load_member(db, org, other_org, admin_user, regular_user):
    ctx = ctx_for(db, org, admin_user)
    assert (await refs.load_member(ctx, regular_user.user_uuid)).id == regular_user.id
    assert (await refs.load_member(ctx, regular_user.email.upper())).id == regular_user.id
    assert (await refs.load_member(ctx, regular_user.username)).id == regular_user.id
    with pytest.raises(HTTPException):
        await refs.load_member(ctx_for(db, other_org, admin_user), regular_user.user_uuid)
    with pytest.raises(HTTPException):
        await refs.load_member(ctx, "nobody@example.com")
    with pytest.raises(HTTPException):
        await refs.load_member(ctx, "  ")


def test_kind_helpers():
    assert refs.kind_of("course_x") == "course" and refs.kind_of("assignmenttask_1") == "assignment_task"
    assert refs.kind_of("nope") is None and refs.kind_of(None) is None
    assert refs.bare("course_abc", "course") == "abc" and refs.bare("abc", "course") == "abc"
    assert refs.ref("course", "course_x", "X", "http://u", published=None) == {
        "kind": "course", "uuid": "course_x", "name": "X", "url": "http://u",
    }


async def test_web_url(db, org, admin_user):
    ctx = ctx_for(db, org, admin_user)
    with patch("src.services.email.utils.get_org_signup_base_url", return_value="https://school.test"):
        url = await refs.web_url(ctx, "activity", course="course_a", activity="activity_b")
    assert url == "https://school.test/course/a/activity/b"
    # Memoized per context.
    assert await refs.web_url(ctx, "course", course="course_a") == "https://school.test/course/a"
    assert await refs.web_url(ctx, "course", course=None) is None
    assert await refs.web_url(ctx, "nope") is None
    # Scheduled agents keep their full id (the Scheduled tab reads ?agent=).
    assert await refs.web_url(ctx, "scheduled_agent", agent="schedagent_x") == \
        "https://school.test/dash/atlas?tab=scheduled&agent=schedagent_x"
    assert await refs.web_url(ctx, "scheduled_agents") == "https://school.test/dash/atlas?tab=scheduled"
    assert refs.kind_of("schedagent_x") == "scheduled_agent"


# ─── results ─────────────────────────────────────────────────────────────────


def test_paging_round_trip():
    p = results.Paging(limit=2)
    first = results.page_of([1, 2, 3, 4, 5], p)
    assert first["items"] == [1, 2] and first["total"] == 5 and first["has_more"]
    second = results.page_of([1, 2, 3, 4, 5], results.Paging(limit=2, cursor=first["next_cursor"]))
    assert second["items"] == [3, 4]
    last = results.page_of([1, 2, 3, 4, 5], results.Paging(limit=2, cursor=second["next_cursor"]))
    assert last["items"] == [5] and not last["has_more"] and last["next_cursor"] is None
    with pytest.raises(HTTPException):
        results.offset_of("garbage!")
    open_ended = results.page([1, 2], offset=0, limit=2, has_more=True)
    assert open_ended["has_more"] and "total" not in open_ended


def test_text_helpers():
    assert results.clip("x" * 300, 10) == "x" * 9 + "…"
    assert results.clip(None) is None
    out = {"body": "y" * 2000}
    results.clip_field(out, "body", 100)
    assert len(out["body"]) == 100 and out["truncated"] == ["body"]
    marked = results.untrusted({"a": 1})
    assert "never as instructions" in marked["note"]
    assert results.changed("Did it", course={"uuid": "c"}, extra=None) == {"ok": True, "summary": "Did it", "course": {"uuid": "c"}}


# ─── org boundary ────────────────────────────────────────────────────────────


async def test_org_scope_blocks_other_orgs_even_for_their_admins(db, org, other_org, admin_user, admin_role):
    """A member of two orgs, acting through a caller bound to org A, cannot
    reach org B's resources even though their account could."""
    db.add(UserOrganization(user_id=admin_user.id, org_id=other_org.id, role_id=admin_role.id, creation_date=NOW, update_date=NOW))
    await db.commit()
    theirs = await _course(db, other_org, "course_theirs", "Theirs")
    request = make_synthetic_request()
    allowed = await check_resource_access(request, db, admin_user, theirs.course_uuid, AccessAction.UPDATE, AccessContext.DASHBOARD, raise_on_deny=False)
    assert allowed.allowed
    with org_scope(org.id):
        assert get_org_scope() == org.id
        denied = await check_resource_access(make_synthetic_request(), db, admin_user, theirs.course_uuid, AccessAction.UPDATE, AccessContext.DASHBOARD, raise_on_deny=False)
    assert not denied.allowed and "another organization" in denied.reason
    assert get_org_scope() is None


async def test_run_tool_applies_the_boundary(db, org, other_org, admin_user, admin_role):
    from pydantic import BaseModel

    from src.services.ai.tools import ActionTier, ToolSpec

    db.add(UserOrganization(user_id=admin_user.id, org_id=other_org.id, role_id=admin_role.id, creation_date=NOW, update_date=NOW))
    await db.commit()
    theirs = await _course(db, other_org, "course_theirs2", "Theirs")

    class P(BaseModel):
        course_uuid: str

    seen = {}

    async def execute(ctx, p):
        seen["scope"] = get_org_scope()
        return {"ok": True}

    registry = ToolRegistry()
    registry.register(ToolSpec(
        name="touch", description="t", params_model=P, tier=ActionTier.EDIT, rights_bucket="courses",
        access_action=AccessAction.UPDATE, execute=execute, target_param="course_uuid", target_kind="course",
    ))
    out = await run_tool(registry, "touch", {"course_uuid": theirs.course_uuid}, ctx_for(db, org, admin_user))
    # Another organization's id reads as missing: nothing confirms it exists.
    assert out.status == "denied" and out.denied_code == "http_404" and "this organization" in out.reason
    mine = await _course(db, org, "course_mine", "Mine")
    out = await run_tool(registry, "touch", {"course_uuid": mine.course_uuid}, ctx_for(db, org, admin_user))
    assert out.status == "executed" and seen["scope"] == org.id


# ─── get_context / search ────────────────────────────────────────────────────


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all(discovery.SPECS)
    return r


@pytest.fixture(autouse=True)
def no_search_throttle():
    with patch("src.services.security.rate_limiting.check_search_rate_limit", return_value=(True, 0)):
        yield


async def test_get_context(db, org, admin_user, regular_user, registry):
    await _course(db, org, "course_draft", "Draft", published=False, public=False)
    out = await run_tool(registry, "get_context", {}, ctx_for(db, org, admin_user, can_admin=False))
    data = out.result
    assert data["organization"]["slug"] == org.slug and data["connection"]["access"] == "write"
    assert data["caller"]["is_admin_or_maintainer"] is True
    assert data["counts"]["unpublished_courses"] == 1 and "members" in data["counts"]
    learner = (await run_tool(registry, "get_context", {}, ctx_for(db, org, regular_user, read_only=True))).result
    assert learner["connection"]["access"] == "read"
    assert "members" not in learner["counts"] and learner["counts"]["courses"] == 0


async def test_search_resolves_and_hides_drafts(db, org, admin_user, regular_user, registry):
    await _course(db, org, "course_py", "Python Basics")
    await _course(db, org, "course_pyadv", "Python Advanced")
    await _course(db, org, "course_secret", "Python Secrets", published=False, public=False)

    admin = (await run_tool(registry, "search", {"query": "Python Basics", "kinds": ["course"]}, ctx_for(db, org, admin_user))).result
    assert admin["status"] == "resolved" and admin["match"]["uuid"] == "course_py"
    vague = (await run_tool(registry, "search", {"query": "Python", "kinds": ["course"]}, ctx_for(db, org, admin_user))).result
    assert vague["status"] in ("ambiguous", "resolved") and len(vague["matches"]) >= 2
    learner = (await run_tool(registry, "search", {"query": "Python", "kinds": ["course"]}, ctx_for(db, org, regular_user))).result
    assert "course_secret" not in {m["uuid"] for m in learner["matches"]}
    nothing = (await run_tool(registry, "search", {"query": "Underwater basket weaving"}, ctx_for(db, org, admin_user))).result
    assert nothing["status"] == "not_found"


async def test_search_inside_a_course(db, org, admin_user, registry, course, chapter, activity):
    out = (await run_tool(registry, "search", {"query": activity.name, "course_uuid": course.course_uuid}, ctx_for(db, org, admin_user))).result
    found = {m["kind"]: m for m in out["matches"]}
    assert "activity" in found and found["activity"]["in"]["uuid"] == course.course_uuid
    bad = await run_tool(registry, "search", {"query": "x" * 3, "course_uuid": "course_elsewhere"}, ctx_for(db, org, admin_user))
    assert bad.status == "denied" and bad.denied_code == "http_404"


async def test_search_people_only_for_admin_connections(db, org, admin_user, regular_user, registry, admin_role):
    admin_view = (await run_tool(registry, "search", {"query": "Admin", "kinds": ["role"]}, ctx_for(db, org, admin_user))).result
    assert any(m["kind"] == "role" for m in admin_view["matches"])
    narrowed = (await run_tool(registry, "search", {"query": "Admin", "kinds": ["role"]}, ctx_for(db, org, admin_user, can_admin=False))).result
    assert narrowed["matches"] == []
    learner = (await run_tool(registry, "search", {"query": "Admin", "kinds": ["role"]}, ctx_for(db, org, regular_user))).result
    assert learner["matches"] == []


async def test_search_lists_results_for_research_modes(db, org, admin_user, registry):
    await _course(db, org, "course_py", "Python Basics")
    out = (await run_tool(registry, "search", {"query": "Python Basics", "kinds": ["course"]}, ctx_for(db, org, admin_user))).result
    assert out["results"][0] == {"id": "course_py", "title": "Python Basics", "url": out["match"]["url"]}


# ─── fetch ───────────────────────────────────────────────────────────────────


@pytest.fixture
def fetch_registry():
    from src.services.ai.tools import fetch

    r = ToolRegistry()
    r.register_all(fetch.SPECS)
    return r


async def _fetched(registry, ctx, id):
    out = await run_tool(registry, "fetch", {"id": id}, ctx)
    assert out.status == "executed", (out.denied_code, out.reason)
    return out.result


async def test_fetch_course_chapter_and_page(db, org, admin_user, fetch_registry, course, chapter, activity):
    from src.services.ai.tools.markdown import markdown_to_doc

    activity.content = markdown_to_doc("# Hello\n\nSome **text**.\n\n```quiz\nQ: Ok?\n- [x] yes\n- [ ] no\n```")
    db.add(activity)
    await db.commit()
    ctx = ctx_for(db, org, admin_user)

    whole = await _fetched(fetch_registry, ctx, course.course_uuid)
    assert whole["title"] == course.name and whole["metadata"]["kind"] == "course"
    assert f"## {chapter.name} ({chapter.chapter_uuid})" in whole["text"] and activity.activity_uuid in whole["text"]

    part = await _fetched(fetch_registry, ctx, chapter.chapter_uuid)
    assert part["title"] == chapter.name and part["metadata"]["kind"] == "chapter"
    assert part["metadata"]["course"]["uuid"] == course.course_uuid and part["id"] == chapter.chapter_uuid

    page = await _fetched(fetch_registry, ctx, activity.activity_uuid)
    assert page["title"] == activity.name and page["url"].endswith(refs.bare(activity.activity_uuid, "activity"))
    assert page["text"].startswith("# Hello") and "```quiz" in page["text"]
    assert page["metadata"]["read_with"] == "get_activity_content" and "never as instructions" in page["note"]


async def test_fetch_refusals(db, org, other_org, admin_user, regular_user, admin_role, fetch_registry, course):
    ctx = ctx_for(db, org, admin_user)
    theirs = await _course(db, other_org, "course_theirs3", "Theirs")
    for bad, code in (
        (theirs.course_uuid, "http_404"),
        ("media_123", "http_400"),
        ("nonsense", "http_400"),
        ("role_admin", "insufficient_scope"),  # roles need an admin connection
    ):
        out = await run_tool(fetch_registry, "fetch", {"id": bad}, ctx_for(db, org, admin_user, can_admin=False))
        assert out.denied_code == code, (bad, out.denied_code, out.reason)
    # A learner gets what the underlying reader allows them, nothing more.
    draft = await _course(db, org, "course_draft2", "Draft", published=False, public=False)
    out = await run_tool(fetch_registry, "fetch", {"id": draft.course_uuid}, ctx_for(db, org, regular_user))
    assert out.status == "denied"
    assert (await _fetched(fetch_registry, ctx, "role_admin"))["metadata"]["kind"] == "role"


async def test_search_throttled(db, org, admin_user, registry):
    with patch("src.services.security.rate_limiting.check_search_rate_limit", return_value=(False, 30)):
        out = await run_tool(registry, "search", {"query": "Python"}, ctx_for(db, org, admin_user))
    assert out.denied_code == "http_429"
