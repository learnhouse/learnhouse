"""The API platform works on a community install, with no EE package.

Boards (like Plays) are an Enterprise feature: without EE their toolset is
simply not registered. Everything else on the platform keeps working: the
shared tool registry, the tools API for org API tokens (listing, a course
tool, a user group tool, the approval gate), the org API token OpenAPI spec,
and the org MCP server's tools/list, search_tools and invoke_tool. This suite
pins EE off (src/tests/conftest.py), and these run against the real registry.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import APIRouter, FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.ee_hooks import get_ee_hooks, get_ee_module
from src.core.events.database import get_db_session
from src.db.users import APITokenUser
from src.routers import tools_api
from src.security.auth import get_current_user
from src.services.ai.tools import get_mcp_registry, get_registry, known_toolsets
from src.services.api_tokens.openapi_spec import build_api_token_openapi_spec
from src.services.mcp import handlers as h
from src.tests.services.test_mcp_server import body, call, ctx_for, member, sessions  # noqa: F401

FULL = {"action_create": True, "action_read": True, "action_update": True, "action_delete": True}


def _boardless(names) -> bool:
    # "onboarding" (the org setup routes) is not a board.
    return not any("board" in str(n).lower().replace("onboarding", "") for n in names)


def test_no_ee_package_and_no_board_tools():
    assert get_ee_hooks() is None and get_ee_module("ee.db.boards") is None
    for registry in (get_registry(), get_mcp_registry()):
        specs = registry.specs()
        assert specs, "the built-in tools are registered"
        assert _boardless(s.name for s in specs)
        assert not any(s.feature == "boards" or s.toolset == "boards" for s in specs)
    assert "boards" not in known_toolsets() and "courses" in known_toolsets()


@pytest.fixture
def approvals():
    m = MagicMock()
    m.ApprovalUnavailable = type("ApprovalUnavailable", (Exception,), {})
    m.APPROVAL_TTL = 600
    m.create.return_value = SimpleNamespace(id="apr_1")
    m.approval_url.return_value = "https://acme.test/oauth/approve?id=apr_1"
    with patch("src.services.mcp.approvals", m), patch("src.services.mcp.audit.record"):
        yield m


@pytest.fixture
async def client(db, org, admin_user, course, approvals):
    token = APITokenUser(
        id=9, user_uuid="apitoken_t", username="t", org_id=org.id, token_name="CI",
        rights={"courses": FULL, "usergroups": FULL}, created_by_user_id=1,
    )
    app = FastAPI()
    router = APIRouter()
    assert tools_api.register_tool_routes(router) > 0
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: token
    with patch("src.services.mcp.handlers._describe", new=AsyncMock(return_value={"kind": "x", "name": "X"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            c.app = app
            yield c


async def test_tools_api_works_without_ee(client, course):
    listed = (await client.get("/api/v1/tools")).json()
    names = {t["name"] for t in listed}
    assert {"list_courses", "list_usergroups", "delete_course"} <= names and _boardless(names)

    courses = await client.post("/api/v1/tools/list_courses", json={})
    assert courses.status_code == 200, courses.text
    assert course.course_uuid in courses.text

    groups = await client.post("/api/v1/tools/list_usergroups", json={})
    assert groups.status_code == 200, groups.text

    held = await client.post("/api/v1/tools/delete_course", json={"course_uuid": course.course_uuid})
    assert held.status_code == 409 and held.json()["error"]["code"] == "approval_required"

    assert (await client.post("/api/v1/tools/list_boards", json={})).status_code == 404


async def test_openapi_spec_has_no_board_tags_without_ee(client):
    spec = build_api_token_openapi_spec(client.app.openapi())
    assert "/api/v1/tools/list_courses" in spec["paths"]
    tags = {t for ops in spec["paths"].values() for op in ops.values() for t in op.get("tags", [])}
    assert "tools/courses" in tags and _boardless(tags) and _boardless(spec["paths"])


async def test_org_api_token_spec_from_the_app_has_no_board_routes():
    from app import app

    spec = app.openapi()
    assert _boardless(p for p in spec["paths"] if "/config/" not in p)
    tags = {t for ops in spec["paths"].values() for op in ops.values() if isinstance(op, dict) for t in op.get("tags", [])}
    assert _boardless(tags)
    assert _boardless(build_api_token_openapi_spec(spec)["paths"])


async def test_mcp_lists_searches_and_invokes_without_ee(db, org, admin_user, course, sessions):  # noqa: F811
    org = SimpleNamespace(id=org.id)  # rollbacks expire the ORM row
    handlers = h.Handlers(get_mcp_registry())
    who = ctx_for(member(admin_user, org), query={"toolsets": "all"})

    names = {t.name for t in (await handlers.list_tools(who, None)).tools}
    assert {"search_tools", "invoke_tool", "list_courses", "delete_course"} <= names and _boardless(names)

    found = body(await handlers.call_tool(who, call("search_tools", {"query": "board whiteboard"})))
    assert _boardless(i["name"] for i in found["items"])
    assert _boardless(t["name"] for t in found["toolsets"])

    ran = body(await handlers.call_tool(who, call("invoke_tool", {"name": "list_courses", "arguments": {}})))
    assert "error" not in ran and course.course_uuid in str(ran)
    missing = body(await handlers.call_tool(who, call("invoke_tool", {"name": "list_boards", "arguments": {}})))
    assert missing["error"]["code"] == "unknown_tool"
