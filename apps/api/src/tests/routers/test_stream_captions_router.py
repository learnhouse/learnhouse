"""Router tests for the captions endpoint in src/routers/stream.py."""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.routers import stream as stream_mod
from src.routers.stream import router as stream_router
from src.security.auth import get_current_user


def _make_app(db, user):
    app = FastAPI()
    app.include_router(stream_router)
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return app


@pytest.fixture
async def client_factory(db):
    clients = []

    async def _factory(user):
        c = AsyncClient(transport=ASGITransport(app=_make_app(db, user)), base_url="http://test")
        clients.append(c)
        return c

    yield _factory
    for c in clients:
        await c.aclose()


def _url(org, course, activity, lang):
    return f"/captions/{org.org_uuid}/{course.course_uuid}/{activity.activity_uuid}/{lang}.vtt"


async def test_caption_track_served(client_factory, monkeypatch, org, course, chapter, activity, anonymous_user):
    vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n"
    monkeypatch.setattr(stream_mod, "read_file_content", lambda key: vtt.encode())
    client = await client_factory(anonymous_user)
    r = await client.get(_url(org, course, activity, "fr"))
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/vtt")
    assert "Hello" in r.text


async def test_caption_track_not_found(client_factory, monkeypatch, org, course, chapter, activity, anonymous_user):
    monkeypatch.setattr(stream_mod, "read_file_content", lambda key: None)
    client = await client_factory(anonymous_user)
    r = await client.get(_url(org, course, activity, "es"))
    assert r.status_code == 404


async def test_caption_bad_lang_rejected(client_factory, monkeypatch, org, course, chapter, activity, anonymous_user):
    # Must not even read content for an over-long / malformed lang token.
    read = {"called": False}
    monkeypatch.setattr(stream_mod, "read_file_content", lambda key: read.__setitem__("called", True) or b"x")
    client = await client_factory(anonymous_user)
    r = await client.get(_url(org, course, activity, "x" * 40))
    assert r.status_code == 404
    assert read["called"] is False
