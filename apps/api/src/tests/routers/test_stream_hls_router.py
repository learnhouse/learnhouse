"""Router tests for the HLS endpoint in src/routers/stream.py."""

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


def _url(org, course, activity, path):
    return f"/hls/{org.org_uuid}/{course.course_uuid}/{activity.activity_uuid}/{path}"


async def test_master_playlist_served_with_rendition_refs(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv360p/index.m3u8\n"
    monkeypatch.setattr(stream_mod, "read_file_content", lambda key: master.encode())
    # Master has no .ts lines, so presign should not be needed; guard anyway.
    monkeypatch.setattr(stream_mod, "generate_presigned_get_url", lambda key: "https://r2/" + key)

    client = await client_factory(anonymous_user)
    r = await client.get(_url(org, course, activity, "master.m3u8"))
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.apple.mpegurl")
    assert "v360p/index.m3u8" in r.text  # rendition ref stays relative


async def test_rendition_playlist_segments_presigned(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    rendition = "#EXTM3U\n#EXTINF:6.0,\nseg_0000.ts\n#EXT-X-ENDLIST\n"
    monkeypatch.setattr(stream_mod, "read_file_content", lambda key: rendition.encode())
    monkeypatch.setattr(
        stream_mod, "generate_presigned_get_url",
        lambda key: f"https://r2.example/{key}?sig=abc",
    )

    client = await client_factory(anonymous_user)
    r = await client.get(_url(org, course, activity, "v360p/index.m3u8"))
    assert r.status_code == 200
    # The segment line was rewritten to the presigned URL (query param present),
    # and the bare relative segment name is gone.
    assert "seg_0000.ts?sig=abc" in r.text
    assert "\nseg_0000.ts\n" not in r.text
    # The rewritten line is an absolute URL to the storage host.
    seg_line = next(ln for ln in r.text.splitlines() if ln.strip().endswith("sig=abc"))
    assert seg_line.startswith("https://")


async def test_segment_request_redirects_to_presigned_in_s3_mode(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    monkeypatch.setattr(stream_mod, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(
        stream_mod, "generate_presigned_get_url",
        lambda key: f"https://r2.example/{key}?sig=abc",
    )

    client = await client_factory(anonymous_user)
    r = await client.get(
        _url(org, course, activity, "v360p/seg_0000.ts"), follow_redirects=False
    )
    assert r.status_code == 302
    assert r.headers["location"].startswith("https://r2.example/")


def test_safe_hls_relpath_accepts_expected_shapes():
    assert stream_mod._safe_hls_relpath("master.m3u8") == "master.m3u8"
    assert stream_mod._safe_hls_relpath("v720p/index.m3u8") == "v720p/index.m3u8"
    assert stream_mod._safe_hls_relpath("v720p/seg_0001.ts") == "v720p/seg_0001.ts"


def test_safe_hls_relpath_rejects_traversal_and_bad_types():
    for bad in [
        "../secret.m3u8",
        "v720p/../../etc.ts",
        "/abs/master.m3u8",
        "master.exe",
        "config.py",
        "",
        "a/\x00.ts",
    ]:
        assert stream_mod._safe_hls_relpath(bad) is None, bad


async def test_thumbnail_sprite_redirects_to_presigned(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    monkeypatch.setattr(stream_mod, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(
        stream_mod, "generate_presigned_get_url",
        lambda key: f"https://r2.example/{key}?sig=abc",
    )
    client = await client_factory(anonymous_user)
    r = await client.get(
        _url(org, course, activity, "thumbnails/sprite.jpg"), follow_redirects=False
    )
    assert r.status_code == 302
    assert r.headers["location"].endswith("thumbnails/sprite.jpg?sig=abc")


async def test_aes_key_served_inline_never_redirected(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    # Even with S3 enabled, the key must be returned inline (RBAC-gated), never
    # redirected to a presigned URL that would expose it publicly.
    monkeypatch.setattr(stream_mod, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(
        stream_mod, "generate_presigned_get_url",
        lambda key: "https://r2.example/LEAKED",
    )
    monkeypatch.setattr(stream_mod, "read_file_content", lambda key: b"0123456789abcdef")

    client = await client_factory(anonymous_user)
    r = await client.get(_url(org, course, activity, "enc.key"), follow_redirects=False)
    assert r.status_code == 200
    assert r.content == b"0123456789abcdef"
    assert "no-store" in r.headers["cache-control"]
    assert "location" not in r.headers


async def test_bad_extension_returns_404_without_reading(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    called = {"read": False}

    def _fail_read(key):
        called["read"] = True
        return b"#EXTM3U\n"

    monkeypatch.setattr(stream_mod, "read_file_content", _fail_read)
    client = await client_factory(anonymous_user)
    # Valid path shape, disallowed extension → 404, and content is never read.
    r = await client.get(_url(org, course, activity, "master.exe"))
    assert r.status_code == 404
    assert called["read"] is False


def test_redirect_to_storage_none_when_s3_disabled(monkeypatch):
    monkeypatch.setattr(stream_mod, "is_s3_enabled", lambda: False)
    assert stream_mod._redirect_to_storage("content/x.mp4") is None


def test_redirect_to_storage_sets_cacheable_header(monkeypatch):
    monkeypatch.setattr(stream_mod, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(stream_mod, "generate_presigned_get_url", lambda key: "https://r2/x")
    resp = stream_mod._redirect_to_storage("content/x.mp4")
    assert resp is not None
    assert resp.status_code == 302
    cc = resp.headers["cache-control"]
    # Must be cacheable (not no-store) so the browser stops re-resolving per range.
    assert "no-store" not in cc
    assert "max-age=21600" in cc and "private" in cc


async def test_activity_video_redirects_to_presigned_with_cache(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    monkeypatch.setattr(stream_mod, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(
        stream_mod, "generate_presigned_get_url",
        lambda key: f"https://r2.example/{key}?sig=abc",
    )
    # Object exists (head_object hit) so the handler proceeds to the redirect.
    monkeypatch.setattr(stream_mod, "get_file_info", lambda p: (1000, "video/mp4", True))
    client = await client_factory(anonymous_user)
    r = await client.get(
        f"/video/{org.org_uuid}/{course.course_uuid}/{activity.activity_uuid}/clip.mp4",
        follow_redirects=False,
    )
    assert r.status_code == 302
    assert r.headers["location"].startswith("https://r2.example/")
    assert "max-age=21600" in r.headers["cache-control"]


async def test_activity_video_missing_object_returns_404_in_s3_mode(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    # Missing object → 404 (consistent with HEAD), not a 302 to a dead URL.
    monkeypatch.setattr(stream_mod, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(stream_mod, "generate_presigned_get_url", lambda key: "https://r2/x")
    monkeypatch.setattr(stream_mod, "get_file_info", lambda p: (0, "", False))
    client = await client_factory(anonymous_user)
    r = await client.get(
        f"/video/{org.org_uuid}/{course.course_uuid}/{activity.activity_uuid}/missing.mp4",
        follow_redirects=False,
    )
    assert r.status_code == 404
    assert "location" not in r.headers


async def test_get_and_head_agree_for_missing_object(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    monkeypatch.setattr(stream_mod, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(stream_mod, "generate_presigned_get_url", lambda key: "https://r2/x")
    monkeypatch.setattr(stream_mod, "get_file_info", lambda p: (0, "", False))
    client = await client_factory(anonymous_user)
    url = f"/video/{org.org_uuid}/{course.course_uuid}/{activity.activity_uuid}/missing.mp4"
    head = await client.head(url, follow_redirects=False)
    get = await client.get(url, follow_redirects=False)
    assert head.status_code == 404
    assert get.status_code == 404


async def test_unsatisfiable_range_returns_416(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    # Local mode (no redirect); existing file of 10 bytes; ask for byte 999-.
    monkeypatch.setattr(stream_mod, "is_s3_enabled", lambda: False)
    monkeypatch.setattr(stream_mod, "get_file_info", lambda p: (10, "video/mp4", True))
    client = await client_factory(anonymous_user)
    r = await client.get(
        f"/video/{org.org_uuid}/{course.course_uuid}/{activity.activity_uuid}/clip.mp4",
        headers={"Range": "bytes=999-"},
        follow_redirects=False,
    )
    assert r.status_code == 416
    assert r.headers["content-range"] == "bytes */10"


async def test_private_course_denies_anonymous(
    client_factory, monkeypatch, db, org, course, chapter, activity, anonymous_user
):
    course.public = False
    db.add(course)
    await db.commit()
    monkeypatch.setattr(stream_mod, "read_file_content", lambda key: b"#EXTM3U\n")

    client = await client_factory(anonymous_user)
    r = await client.get(_url(org, course, activity, "master.m3u8"))
    assert r.status_code in (401, 403)


# --------------------------------------------------------------------------
# Block + podcast GET handlers (cover the duplicated existence-check/redirect)
# --------------------------------------------------------------------------

async def test_block_video_redirects_in_s3(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    monkeypatch.setattr(stream_mod, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(stream_mod, "get_file_info", lambda p: (1000, "video/mp4", True))
    monkeypatch.setattr(stream_mod, "generate_presigned_get_url", lambda k: f"https://r2/{k}")
    client = await client_factory(anonymous_user)
    r = await client.get(
        f"/block/{org.org_uuid}/{course.course_uuid}/{activity.activity_uuid}/blk1/v.mp4",
        follow_redirects=False,
    )
    assert r.status_code == 302
    assert "max-age=21600" in r.headers["cache-control"]


async def test_block_video_missing_returns_404(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    monkeypatch.setattr(stream_mod, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(stream_mod, "get_file_info", lambda p: (0, "", False))
    monkeypatch.setattr(stream_mod, "generate_presigned_get_url", lambda k: "https://r2/x")
    client = await client_factory(anonymous_user)
    r = await client.get(
        f"/block/{org.org_uuid}/{course.course_uuid}/{activity.activity_uuid}/blk1/v.mp4",
        follow_redirects=False,
    )
    assert r.status_code == 404


async def test_block_audio_redirects_in_s3(
    client_factory, monkeypatch, org, course, chapter, activity, anonymous_user
):
    monkeypatch.setattr(stream_mod, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(stream_mod, "get_file_info", lambda p: (1000, "audio/mpeg", True))
    monkeypatch.setattr(stream_mod, "generate_presigned_get_url", lambda k: f"https://r2/{k}")
    client = await client_factory(anonymous_user)
    r = await client.get(
        f"/block/audio/{org.org_uuid}/{course.course_uuid}/{activity.activity_uuid}/blk1/a.mp3",
        follow_redirects=False,
    )
    assert r.status_code == 302


async def test_podcast_audio_redirects_in_s3(
    client_factory, monkeypatch, org, anonymous_user
):
    # Focus on the redirect logic (the changed lines); podcast RBAC is exercised
    # by its own dedicated tests, so stub the access check here.
    async def _allow(*a, **k):
        return None

    monkeypatch.setattr(stream_mod, "_verify_podcast_episode_access", _allow)
    monkeypatch.setattr(stream_mod, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(stream_mod, "get_file_info", lambda p: (1000, "audio/mpeg", True))
    monkeypatch.setattr(stream_mod, "generate_presigned_get_url", lambda k: f"https://r2/{k}")
    client = await client_factory(anonymous_user)
    r = await client.get(
        f"/audio/{org.org_uuid}/pod_test/ep_test/a.mp3", follow_redirects=False
    )
    assert r.status_code == 302
