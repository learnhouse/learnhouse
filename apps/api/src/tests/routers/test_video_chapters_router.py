"""Router tests for the video chapter endpoints in src/routers/courses/activities/activities.py."""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.routers.courses.activities import activities as activities_mod
from src.security.auth import get_current_user


@pytest.fixture
async def client(db, admin_user):
    app = FastAPI()
    app.include_router(activities_mod.router)
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    c = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    yield c
    await c.aclose()


async def test_generate_chapters_queues_background_job(client, monkeypatch):
    calls = []

    async def _request(request, activity_uuid, current_user, db_session):
        calls.append(("request", activity_uuid))
        return {"status": "queued"}

    async def _job(activity_uuid, force=False):
        calls.append(("job", activity_uuid, force))
        return True

    import src.services.utils.chapter_jobs as chapter_jobs

    monkeypatch.setattr(activities_mod, "request_chapters_generation", _request)
    monkeypatch.setattr(chapter_jobs, "generate_activity_chapters", _job)
    r = await client.post("/video/act_1/chapters")
    assert r.status_code == 200
    assert r.json() == {"status": "queued"}
    assert calls == [("request", "act_1"), ("job", "act_1", True)]


async def test_save_chapters_passes_payload(client, monkeypatch):
    seen = {}

    async def _save(request, activity_uuid, current_user, db_session, payload):
        seen["uuid"] = activity_uuid
        seen["items"] = [c.model_dump() for c in payload.items]
        return {"status": "ready", "items": seen["items"]}

    monkeypatch.setattr(activities_mod, "save_chapters", _save)
    body = {"items": [{"start": 0, "title": "Intro"}, {"start": 30, "title": "Setup"}]}
    r = await client.put("/video/act_2/chapters", json=body)
    assert r.status_code == 200
    assert seen == {"uuid": "act_2", "items": [{"start": 0.0, "title": "Intro"}, {"start": 30.0, "title": "Setup"}]}
