"""Learning path tools (src/services/ai/tools/paths.py), through run_tool.

The security cases come first: ids from another organization, members
without the courses rights, API tokens without them, and the calls that must
wait for a person's approval (publishing, changing a live path, deleting).
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import select

from src.db.courses.courses import Course
from src.db.organization_config import OrganizationConfig
from src.db.paths import Path, PathCertificate, PathCourse, PathEnrollment
from src.db.users import APITokenUser
from src.services.ai.tools import ToolContext, ToolRegistry, make_synthetic_request, run_tool
from src.services.ai.tools import discovery, fetch
from src.services.ai.tools import paths as path_tools

NOW = str(datetime(2026, 1, 1, 12, 0, 0))
BASE = "https://test-org.example"


@pytest.fixture(autouse=True)
def environment():
    with (
        patch("src.services.ai.tools.refs.web_base", new=AsyncMock(return_value=BASE)),
        patch("src.services.security.rate_limiting.check_search_rate_limit", return_value=(True, 0)),
    ):
        yield


@pytest.fixture
def registry():
    r = ToolRegistry()
    for module in (path_tools, discovery, fetch):
        r.register_all(module.SPECS)
    return r


def ctx_for(db, org, user, *, approved=False, can_admin=True):
    return ToolContext(
        request=make_synthetic_request(), db_session=db, user=user, org=org, org_slug=org.slug,
        mode="execute", scope_key="mcp:test", surface="mcp", approved=approved, can_admin=can_admin,
    )


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


async def _course(db, org, id, uuid, name, published=True):
    return await add(db, Course(
        id=id, name=name, description="", public=True, published=published, open_to_contributors=False,
        org_id=org.id, course_uuid=uuid, creation_date=NOW, update_date=NOW,
    ))


@pytest.fixture
async def courses(db, org):
    return [
        await _course(db, org, 11, "course_python", "Python Basics"),
        await _course(db, org, 12, "course_data", "Data Analysis"),
        await _course(db, org, 13, "course_viz", "Charts and Dashboards"),
    ]


async def _path(db, org, uuid="path_main", name="Data Career", published=False, public=True, courses=()):
    path = await add(db, Path(
        name=name, org_id=org.id, path_uuid=uuid, published=published, public=public,
        creation_date=NOW, update_date=NOW,
    ))
    for position, course in enumerate(courses):
        await add(db, PathCourse(path_id=path.id, course_id=course.id, position=position, required=True))
    return path


async def call(registry, ctx, tool, /, **args):
    return await run_tool(registry, tool, args, ctx)


# ─── security ────────────────────────────────────────────────────────────────


async def test_foreign_paths_and_courses_are_not_found(registry, db, org, other_org, admin_user, courses):
    theirs = await _path(db, other_org, uuid="path_theirs", name="Theirs")
    foreign_course = await _course(db, other_org, 20, "course_theirs", "Theirs")
    ctx = ctx_for(db, org, admin_user, approved=True)
    for name, args in (
        ("get_path", {"path_uuid": theirs.path_uuid}),
        ("update_path", {"path_uuid": theirs.path_uuid, "name": "Mine now"}),
        ("set_path_courses", {"path_uuid": theirs.path_uuid, "courses": []}),
        ("list_path_learners", {"path_uuid": theirs.path_uuid}),
        ("delete_path", {"path_uuid": theirs.path_uuid}),
    ):
        assert "this organization" in denied(await call(registry, ctx, name, **args), "http_404")
    # A course of another organization cannot be put in a path either.
    reason = denied(await call(
        registry, ctx, "create_path", name="Mixed", courses=[{"course": foreign_course.course_uuid}]
    ), "http_404")
    assert "course_theirs" in reason
    assert (await db.execute(select(Path).where(Path.name == "Mixed"))).first() is None
    assert (await db.get(Path, theirs.id)).name == "Theirs"


async def test_learners_cannot_author_or_see_drafts(registry, db, org, regular_user, courses):
    draft = await _path(db, org)
    live = await _path(db, org, uuid="path_live", name="Live path", published=True)
    ctx = ctx_for(db, org, regular_user)
    denied(await call(registry, ctx, "create_path", name="Nope"), "http_403")
    denied(await call(registry, ctx, "update_path", path_uuid=live.path_uuid, name="x"), "http_403")
    denied(await call(registry, ctx, "list_path_learners", path_uuid=live.path_uuid), "http_403")
    listed = ok(await call(registry, ctx, "list_paths"))
    assert [p["uuid"] for p in listed["items"]] == ["path_live"]
    denied(await call(registry, ctx, "get_path", path_uuid=draft.path_uuid), "http_404")
    found = ok(await call(registry, ctx, "search", query="Data Career", kinds=["path"]))
    assert found["status"] == "not_found"


async def test_api_token_needs_courses_rights(registry, db, org, courses):
    reader = APITokenUser(
        id=7, user_uuid="apitoken_x", username="token", org_id=org.id, token_name="t",
        rights={"courses": {"action_read": True}}, created_by_user_id=1,
    )
    ctx = ctx_for(db, org, reader)
    ok(await call(registry, ctx, "list_paths"))
    assert "courses.action_create" in denied(await call(registry, ctx, "create_path", name="x"), "missing_right")
    nothing = APITokenUser(
        id=8, user_uuid="apitoken_y", username="token", org_id=org.id, token_name="t", rights={},
        created_by_user_id=1,
    )
    found = ok(await call(registry, ctx_for(db, org, nothing), "search", query="Data", kinds=["path"]))
    assert found["matches"] == []


async def test_turned_off_feature_hides_paths(registry, db, org, admin_user):
    await _path(db, org, published=True)
    db.add(OrganizationConfig(
        org_id=org.id, config={"config_version": "2.0", "admin_toggles": {"paths": {"disabled": True}}},
        creation_date=NOW, update_date=NOW,
    ))
    await db.commit()
    found = ok(await call(registry, ctx_for(db, org, admin_user), "search", query="Data Career", kinds=["path"]))
    assert found["matches"] == []


# ─── create, read, list ──────────────────────────────────────────────────────


async def test_create_path_as_draft_with_courses_by_id_and_name(registry, db, org, admin_user, courses):
    ctx = ctx_for(db, org, admin_user)
    out = ok(await call(
        registry, ctx, "create_path", name="Data Career", description="From zero to dashboards",
        level="beginner", certificate_enabled=True, electives_required=1,
        courses=[
            {"course": "course_python"},
            {"course": "Data Analysis"},
            {"course": "course_viz", "required": False},
        ],
    ))
    assert out["ok"] and "draft" in out["summary"]
    assert out["path"]["status"] == "draft"
    uuid = out["path"]["uuid"]
    assert out["path"]["url"] == f"{BASE}/path/{uuid.removeprefix('path_')}"
    assert out["editor_url"].endswith(f"/dash/paths/path/{uuid.removeprefix('path_')}/general")
    assert [(c["uuid"], c["required"]) for c in out["courses"]] == [
        ("course_python", True), ("course_data", True), ("course_viz", False),
    ]
    row = (await db.execute(select(Path).where(Path.path_uuid == uuid))).scalars().one()
    assert row.published is False and row.certificate_enabled and row.level == "beginner"

    got = ok(await call(registry, ctx, "get_path", path_uuid=uuid))
    assert got["certificate"]["enabled"] and got["electives_required"] == 1
    assert [c["position"] for c in got["courses"]] == [0, 1, 2]

    # The path is found by name, and a name works where an id goes.
    found = ok(await call(registry, ctx, "search", query="Data Career", kinds=["path"]))
    assert found["status"] == "resolved" and found["match"]["uuid"] == uuid
    renamed = ok(await call(registry, ctx, "update_path", path_uuid="Data Career", name="Data Analyst"))
    assert renamed["resolved"]["path_uuid"]["uuid"] == uuid
    opened = ok(await call(registry, ctx, "fetch", id=uuid))
    assert opened["title"] == "Data Analyst" and opened["metadata"]["read_with"] == "get_path"


async def test_create_path_refuses_bad_course_lists(registry, db, org, admin_user, courses):
    ctx = ctx_for(db, org, admin_user)
    assert "listed twice" in denied(await call(
        registry, ctx, "create_path", name="Twice", courses=[{"course": "course_python"}, {"course": "Python Basics"}]
    ), "http_400")
    assert "only 0 electives" in denied(await call(
        registry, ctx, "create_path", name="No electives", electives_required=2, courses=[{"course": "course_python"}]
    ), "invalid_args")
    assert "No course" in denied(await call(
        registry, ctx, "create_path", name="Unknown", courses=[{"course": "Quantum Basket Weaving"}]
    ), "http_404")
    assert (await db.execute(select(Path))).first() is None


async def test_list_paths_filters_by_status(registry, db, org, admin_user, courses):
    await _path(db, org, courses=courses[:2])
    await _path(db, org, uuid="path_live", name="Live", published=True, public=False)
    ctx = ctx_for(db, org, admin_user)
    every = ok(await call(registry, ctx, "list_paths"))
    assert every["total"] == 2
    drafts = ok(await call(registry, ctx, "list_paths", status="draft"))
    assert [(p["uuid"], p["status"], p["courses"]) for p in drafts["items"]] == [("path_main", "draft", 2)]
    live = ok(await call(registry, ctx, "list_paths", status="published"))
    assert [p["status"] for p in live["items"]] == ["published_members_only"]
    paged = ok(await call(registry, ctx, "list_paths", limit=1))
    assert paged["has_more"] and paged["next_cursor"]


# ─── update and approvals ────────────────────────────────────────────────────


async def test_update_path_asks_before_learners_see_a_change(registry, db, org, admin_user, courses):
    path = await _path(db, org, courses=courses[:1])
    ctx = ctx_for(db, org, admin_user)
    # Draft edits need no approval, even the audience.
    ok(await call(registry, ctx, "update_path", path_uuid=path.path_uuid, about="Long text", members_only=True))
    # Publishing does.
    denied(await call(registry, ctx, "update_path", path_uuid=path.path_uuid, published=True), "approval_required")
    assert (await db.get(Path, path.id)).published is False
    out = ok(await call(registry, ctx_for(db, org, admin_user, approved=True), "update_path", path_uuid=path.path_uuid, published=True))
    assert out["path"]["status"] == "published_members_only"
    # Republishing a published path changes nothing visible.
    ok(await call(registry, ctx, "update_path", path_uuid=path.path_uuid, published=True, sequential=True))
    # Opening a live path to everyone, or unpublishing it, does.
    denied(await call(registry, ctx, "update_path", path_uuid=path.path_uuid, members_only=False), "approval_required")
    denied(await call(registry, ctx, "update_path", path_uuid=path.path_uuid, published=False), "approval_required")
    ok(await call(registry, ctx, "update_path", path_uuid=path.path_uuid, members_only=True))


async def test_update_path_certificate_and_empty_patch(registry, db, org, admin_user):
    path = await _path(db, org)
    ctx = ctx_for(db, org, admin_user)
    out = ok(await call(
        registry, ctx, "update_path", path_uuid=path.path_uuid, certificate_enabled=True,
        certificate_name="Data Analyst", certificate_description="Awarded for finishing",
    ))
    assert "certificate_config" in out["summary"]
    row = await db.get(Path, path.id)
    assert row.certificate_config["certification_name"] == "Data Analyst"
    assert row.certificate_config["certification_description"] == "Awarded for finishing"
    assert "Nothing to change" in denied(await call(registry, ctx, "update_path", path_uuid=path.path_uuid), "http_400")


async def test_set_path_courses(registry, db, org, admin_user, courses):
    path = await _path(db, org, courses=courses[:1])
    ctx = ctx_for(db, org, admin_user)
    out = ok(await call(registry, ctx, "set_path_courses", path_uuid=path.path_uuid, courses=[
        {"course": "Charts and Dashboards"}, {"course": "course_python", "required": False},
    ]))
    assert [(c["uuid"], c["required"]) for c in out["courses"]] == [("course_viz", True), ("course_python", False)]
    # Not enough electives for what the path asks.
    path_row = await db.get(Path, path.id)
    path_row.electives_required = 2
    await add(db, path_row)
    assert "asks learners for 2 electives" in denied(await call(
        registry, ctx, "set_path_courses", path_uuid=path.path_uuid, courses=[{"course": "course_python"}]
    ), "http_400")
    path_row.electives_required = 0
    path_row.published = True
    await add(db, path_row)
    # A live path's courses change only with approval.
    denied(await call(registry, ctx, "set_path_courses", path_uuid=path.path_uuid, courses=[]), "approval_required")
    cleared = ok(await call(registry, ctx_for(db, org, admin_user, approved=True), "set_path_courses", path_uuid=path.path_uuid, courses=[]))
    assert cleared["courses"] == [] and "0 courses" in cleared["summary"]


# ─── learners and deletion ───────────────────────────────────────────────────


async def test_list_path_learners(registry, db, org, admin_user, regular_user, courses):
    path = await _path(db, org, published=True, courses=courses[:1])
    await add(db, PathEnrollment(path_id=path.id, user_id=regular_user.id, enrolled_at=NOW))
    await add(db, PathEnrollment(path_id=path.id, user_id=admin_user.id, enrolled_at=NOW, completed_at=NOW))
    await add(db, PathCertificate(path_id=path.id, user_id=admin_user.id, certificate_uuid="PATH-1", created_at=NOW))
    ctx = ctx_for(db, org, admin_user)
    out = ok(await call(registry, ctx, "list_path_learners", path_uuid=path.path_uuid))
    assert out["total"] == 2 and out["path"]["uuid"] == path.path_uuid
    by_user = {x["user"]["uuid"]: x for x in out["items"]}
    assert by_user["user_admin"]["certificate_uuid"] == "PATH-1"
    assert by_user["user_regular"]["user"]["email"] == "regular@test.com"
    assert by_user["user_regular"]["required_done"] == "0/1"
    done = ok(await call(registry, ctx, "list_path_learners", path_uuid=path.path_uuid, status="completed"))
    assert [x["user"]["uuid"] for x in done["items"]] == ["user_admin"]
    going = ok(await call(registry, ctx, "list_path_learners", path_uuid=path.path_uuid, status="in_progress"))
    assert [x["user"]["uuid"] for x in going["items"]] == ["user_regular"]
    # Emails stay with admin connections.
    hidden = ok(await call(registry, ctx_for(db, org, admin_user, can_admin=False), "list_path_learners", path_uuid=path.path_uuid))
    assert all("email" not in x["user"] for x in hidden["items"])


async def test_delete_path(registry, db, org, admin_user, courses):
    path = await _path(db, org, courses=courses)
    ctx = ctx_for(db, org, admin_user)
    denied(await call(registry, ctx, "delete_path", path_uuid=path.path_uuid), "approval_required")
    approved = ctx_for(db, org, admin_user, approved=True)
    out = ok(await call(registry, approved, "delete_path", path_uuid=path.path_uuid))
    assert "Data Career" in out["summary"]
    assert await db.get(Path, path.id) is None
    # Courses stay.
    assert len((await db.execute(select(Course))).scalars().all()) == 3

    awarded = await _path(db, org, uuid="path_awarded", name="Awarded")
    await add(db, PathCertificate(path_id=awarded.id, user_id=admin_user.id, certificate_uuid="PATH-2", created_at=NOW))
    assert "awarded certificate" in denied(await call(registry, approved, "delete_path", path_uuid=awarded.path_uuid), "http_409")


def test_spec_shapes():
    specs = {s.name: s for s in path_tools.SPECS}
    assert specs["delete_path"].approval_for(None)
    assert specs["update_path"].may_need_approval and not specs["update_path"].approval_for(None)
    assert specs["list_path_learners"].required_access == "read"
    summary = specs["create_path"].summarize(path_tools.CreatePathParams(
        name="P", courses=[{"course": f"c{i}"} for i in range(8)]
    ))
    assert "and 2 more" in summary
    publish = specs["update_path"].summarize(path_tools.UpdatePathParams(path_uuid="path_x", published=True, name="N"))
    assert publish.startswith("Publish path path_x") and "name" in publish
    assert specs["update_path"].summarize(path_tools.UpdatePathParams(path_uuid="path_x")) == "Update path path_x"
