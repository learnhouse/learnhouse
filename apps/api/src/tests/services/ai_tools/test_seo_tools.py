"""SEO tools through the run_tool pipeline: the audit (admins only, public
published pages only, this org only) and page fixes (edit rights, org scope,
approval for slug changes, undo back to the old values)."""

# ruff: noqa: F811

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.courses import Course
from src.services.ai.tools import ToolRegistry, run_tool
from src.services.ai.tools import seo as seo_tools
from src.tests.services.ai_tools.test_people_org import (  # noqa: F401
    _ctx,
    environment,
    fake_redis,
    setup,
)


@pytest.fixture(autouse=True)
def no_cache():
    with patch("src.services.courses.cache.invalidate_course_meta_cache"):
        yield


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all(seo_tools.SPECS)
    return r


def ok(out):
    assert out.status == "executed", (out.denied_code, out.reason)
    return out.result


def test_issue_rules():
    assert seo_tools._issues({"name": "x" * 61, "description": "", "thumbnail_image": ""}) == [
        "title_too_long", "no_description", "no_image"]
    assert seo_tools._issues({"name": "A", "description": "short", "thumbnail_image": "t.png"}) == [
        "description_too_short", "no_image_alt"]
    assert seo_tools._issues({"name": "A", "description": "d" * 200, "seo": {"og_image": "o.png", "image_alt": "x",
                                                                            "robots_noindex": True}}) == [
        "description_too_long", "hidden_from_search"]
    assert seo_tools._issues({"name": "A", "seo": {"description": "d" * 100, "og_image": "o", "image_alt": "a"}}) == []


async def test_audit_lists_public_pages_with_issues(db, org, other_org, admin_user, regular_user, course, setup, registry):
    now = str(datetime.now())
    db.add(Course(id=5, name="Draft", description="", public=True, published=False, open_to_contributors=False,
                  org_id=org.id, course_uuid="course_draft", creation_date=now, update_date=now))
    await db.commit()
    out = ok(await run_tool(registry, "audit_seo", {}, _ctx(db, org, admin_user)))
    uuids = [i["uuid"] for i in out["items"]]
    assert uuids == ["course_test"]  # the draft is not in search, another org's course never shows
    assert "description_too_short" in out["items"][0]["issues"] and out["total"] == 1
    assert ok(await run_tool(registry, "audit_seo", {"resource_type": "path"}, _ctx(db, org, admin_user)))["items"] == []
    with patch.object(seo_tools, "MAX_ITEMS", 0):
        assert ok(await run_tool(registry, "audit_seo", {}, _ctx(db, org, admin_user)))["truncated"] is True
    learner = await run_tool(registry, "audit_seo", {}, _ctx(db, org, regular_user))
    assert learner.status == "denied"


async def test_update_seo_and_undo(db, org, admin_user, regular_user, course, setup, registry):
    ctx = _ctx(db, org, admin_user)
    args = {"resource_type": "course", "resource_uuid": "course_test", "title": "Learn it",
            "description": "A practical course that teaches the basics in five short lessons."}
    out = ok(await run_tool(registry, "update_seo", args, ctx))
    assert out["seo"]["title"] == "Learn it" and out["course"]["uuid"] == "course_test"
    assert out["undo"] == {"tool": "update_seo", "args": {
        "resource_type": "course", "resource_uuid": "course_test", "title": "", "description": ""}}
    assert "title, description" in out["summary"]

    # A new slug changes the address: it waits for approval, then records the old one.
    slug = {"resource_type": "course", "resource_uuid": "course_test", "slug": "learn-it", "image_alt": "Cover"}
    assert (await run_tool(registry, "update_seo", slug, ctx)).denied_code == "approval_required"
    done = ok(await run_tool(registry, "update_seo", slug, _ctx(db, org, admin_user, approved=True)))
    assert done["slug"] == "learn-it" and done["undo"]["args"]["image_alt"] == ""
    assert "slug" in done["undo"]["args"]

    assert (await run_tool(registry, "update_seo", {"resource_type": "course", "resource_uuid": "course_test"}, ctx)
            ).denied_code == "invalid_args"
    learner = await run_tool(registry, "update_seo", args, _ctx(db, org, regular_user))
    assert learner.status == "denied"


async def test_update_seo_is_org_scoped(db, org, other_org, admin_user, course, setup, registry):
    # course_other belongs to other_org (setup); a path- type id skips the course pre-flight.
    out = await run_tool(registry, "update_seo", {"resource_type": "course", "resource_uuid": "course_other",
                                                   "title": "x"}, _ctx(db, org, admin_user))
    assert out.status == "denied"
    foreign = Course(org_id=other_org.id, name="x", course_uuid="course_other")
    with patch.object(seo_tools, "_load_by_uuid", AsyncMock(return_value=foreign)), pytest.raises(HTTPException) as e:
        await seo_tools._update_seo(
            _ctx(db, org, admin_user),
            seo_tools.UpdateSeoParams(resource_type="course", resource_uuid="course_other", title="x"),
        )
    assert e.value.status_code == 404
