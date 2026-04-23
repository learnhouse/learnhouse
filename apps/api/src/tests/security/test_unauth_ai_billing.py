"""Regression: anonymous callers cannot trigger AI-billed or migration endpoints.

See C-02. Without these guards, anyone on the internet can drain any
organisation's AI credits or trigger disk/LLM work on its behalf by hitting
these routes with a plausible UUID and no auth header.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.routers.ai import ai as ai_router_module
from src.routers.ai import magicblocks as magicblocks_router_module
from src.routers.ai import rag as rag_router_module
from src.routers.boards import boards_playground as boards_playground_router_module
from src.routers.courses import migration as migration_router_module


UNAUTH_BILLING_ROUTES = [
    (
        "POST",
        "/api/v1/ai/magicblocks/start",
        {
            "activity_uuid": "x",
            "block_uuid": "x",
            "prompt": "x",
            "context": {
                "course_title": "",
                "course_description": "",
                "activity_name": "",
                "activity_content_summary": "",
            },
        },
    ),
    (
        "POST",
        "/api/v1/ai/magicblocks/iterate",
        {
            "session_uuid": "x",
            "activity_uuid": "x",
            "block_uuid": "x",
            "message": "x",
        },
    ),
    (
        "POST",
        "/api/v1/boards/playground/start",
        {
            "board_uuid": "x",
            "block_uuid": "x",
            "prompt": "x",
            "context": {},
        },
    ),
    (
        "POST",
        "/api/v1/boards/playground/iterate",
        {
            "session_uuid": "x",
            "board_uuid": "x",
            "block_uuid": "x",
            "message": "x",
        },
    ),
    (
        "POST",
        "/api/v1/ai/rag/chat",
        {"message": "x", "org_slug": "x"},
    ),
    (
        "POST",
        "/api/v1/ai/start/activity_chat_session",
        {"activity_uuid": "x", "message": "x"},
    ),
    (
        "POST",
        "/api/v1/ai/send/activity_chat_message",
        {"aichat_uuid": "x", "activity_uuid": "x", "message": "x"},
    ),
    (
        "POST",
        "/api/v1/ai/stream/start/activity_chat_session",
        {"activity_uuid": "x", "message": "x"},
    ),
    (
        "POST",
        "/api/v1/ai/stream/send/activity_chat_message",
        {"aichat_uuid": "x", "activity_uuid": "x", "message": "x"},
    ),
    (
        "POST",
        "/api/v1/ai/stream/editor/start",
        {
            "activity_uuid": "x",
            "message": "x",
            "current_content": {"type": "doc", "content": []},
        },
    ),
    (
        "POST",
        "/api/v1/ai/stream/editor/message",
        {
            "aichat_uuid": "x",
            "activity_uuid": "x",
            "message": "x",
            "current_content": {"type": "doc", "content": []},
        },
    ),
    (
        "POST",
        "/api/v1/courses/migrate/suggest?org_id=1",
        {"temp_id": "x", "course_name": "x", "description": "x"},
    ),
]


@pytest.fixture
def app(db):
    app = FastAPI()
    app.include_router(ai_router_module.router, prefix="/api/v1/ai")
    app.include_router(magicblocks_router_module.router, prefix="/api/v1/ai")
    app.include_router(rag_router_module.router, prefix="/api/v1/ai")
    app.include_router(
        boards_playground_router_module.router, prefix="/api/v1/boards"
    )
    app.include_router(
        migration_router_module.router, prefix="/api/v1/courses"
    )
    app.dependency_overrides[get_db_session] = lambda: db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.mark.parametrize("method,path,body", UNAUTH_BILLING_ROUTES)
async def test_unauth_billing_rejected(client, method, path, body):
    resp = await client.request(method, path, json=body)
    assert resp.status_code == 401, (
        f"{method} {path} returned {resp.status_code}; expected 401 for anon caller"
    )


async def test_unauth_migrate_upload_rejected(client):
    # Multipart request, not JSON — exercised separately so FastAPI does not
    # 422 on the missing file body before the auth dep runs.
    resp = await client.post(
        "/api/v1/courses/migrate/upload?org_id=1",
        files={"files": ("poc.txt", b"poc", "text/plain")},
    )
    assert resp.status_code == 401, (
        f"/api/v1/courses/migrate/upload returned {resp.status_code}; "
        "expected 401 for anon caller"
    )
