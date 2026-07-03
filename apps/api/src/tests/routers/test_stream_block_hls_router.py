"""Router tests for the video-BLOCK HLS endpoint in src/routers/stream.py."""

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
        app = _make_app(db, user)
        c = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
        clients.append(c)
        return c

    yield _factory
    for c in clients:
        await c.aclose()


def _url(org, course, activity, block_uuid, path):
    return f"/block-hls/{org.org_uuid}/{course.course_uuid}/{activity.activity_uuid}/{block_uuid}/{path}"


async def test_block_master_playlist_served(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv360p/index.m3u8\n"
    monkeypatch.setattr(stream_mod, "read_file_content", lambda key: master.encode())
    monkeypatch.setattr(stream_mod, "generate_presigned_get_url", lambda key: "https://r2/" + key)

    client = await client_factory(anonymous_user)
    r = await client.get(_url(org, course, activity, "block_1", "master.m3u8"))
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.apple.mpegurl")
    assert "v360p/index.m3u8" in r.text


async def test_block_segment_redirects_in_s3_mode(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    monkeypatch.setattr(stream_mod, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(stream_mod, "generate_presigned_get_url", lambda key: "https://r2/" + key)

    client = await client_factory(anonymous_user)
    r = await client.get(
        _url(org, course, activity, "block_1", "v360p/seg_0001.ts"),
        follow_redirects=False,
    )
    assert r.status_code == 302
    assert r.headers["location"].startswith("https://r2/")


async def test_block_key_served_inline(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    monkeypatch.setattr(stream_mod, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(stream_mod, "read_file_content", lambda key: b"0123456789abcdef")

    client = await client_factory(anonymous_user)
    r = await client.get(_url(org, course, activity, "block_1", "enc.key"), follow_redirects=False)
    assert r.status_code == 200
    assert r.content == b"0123456789abcdef"
    assert "no-store" in r.headers.get("cache-control", "")


async def test_block_hls_rejects_bad_path(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    def _fail_read(key):
        raise AssertionError("should not read for a rejected path")
    monkeypatch.setattr(stream_mod, "read_file_content", _fail_read)

    client = await client_factory(anonymous_user)
    r = await client.get(_url(org, course, activity, "block_1", "master.txt"))
    assert r.status_code == 404


async def test_block_missing_playlist_404(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    monkeypatch.setattr(stream_mod, "read_file_content", lambda key: None)
    client = await client_factory(anonymous_user)
    r = await client.get(_url(org, course, activity, "block_1", "master.m3u8"))
    assert r.status_code == 404


async def test_block_segment_served_inline_local_mode(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    monkeypatch.setattr(stream_mod, "is_s3_enabled", lambda: False)
    monkeypatch.setattr(stream_mod, "read_file_content", lambda key: b"SEGMENTBYTES")
    client = await client_factory(anonymous_user)
    r = await client.get(_url(org, course, activity, "block_1", "v360p/seg_0001.ts"), follow_redirects=False)
    assert r.status_code == 200
    assert r.content == b"SEGMENTBYTES"


async def test_block_hls_rejects_traversal_block_uuid(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    # ".." in the block_uuid segment must be rejected before any read.
    def _fail_read(key):
        raise AssertionError("should not read on traversal")
    monkeypatch.setattr(stream_mod, "read_file_content", _fail_read)
    client = await client_factory(anonymous_user)
    r = await client.get(_url(org, course, activity, "..", "master.m3u8"))
    assert r.status_code == 404
