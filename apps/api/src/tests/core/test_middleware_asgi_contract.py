"""Every response must leave the production middleware stack as valid ASGI.

uvicorn refuses a response whose messages arrive out of order (a body before
its ``http.response.start``) and the browser gets a bare "Internal Server
Error" page. httpx's ASGITransport does not check that order, so a test client
alone never notices. These tests send every kind of response through the
middleware the real app installs, behind a ``send`` that enforces the same
rules uvicorn does.

A Starlette upgrade once changed when its GZip responder forwards the start
message, and the app's selective-gzip subclass started dropping it for every
response it chose not to compress: redirects (the legacy magic-link URL),
octet-stream video segments. A dependency bump that breaks the contract again
fails here.
"""

import gzip
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import FastAPI, Response
from fastapi.responses import (
    FileResponse,
    JSONResponse,
    RedirectResponse,
    StreamingResponse,
)
from httpx import ASGITransport, AsyncClient

import app as app_module
from app import SelectiveGZipMiddleware
from src.core.events.database import get_db_session

LARGE_JSON = {"items": ["compress me" for _ in range(500)]}
BINARY = bytes(range(256)) * 40


def _strict_asgi(application):
    """Wrap an ASGI app so ``send`` enforces uvicorn's response ordering."""

    async def wrapped(scope, receive, send):
        if scope["type"] != "http":
            await application(scope, receive, send)
            return
        started = False
        finished = False

        async def checked_send(message):
            nonlocal started, finished
            kind = message["type"]
            assert not finished, f"{kind} sent after the response completed"
            if kind == "http.response.start":
                assert not started, "http.response.start sent twice"
                started = True
            else:
                assert started, f"Expected 'http.response.start', got {kind!r} first"
                if kind == "http.response.body" and not message.get("more_body", False):
                    finished = True
            await send(message)

        await application(scope, receive, checked_send)
        assert finished, "response never completed"

    return wrapped


def _stack_app(tmp_path) -> FastAPI:
    """Test routes behind exactly the middleware the real app installs."""
    application = FastAPI()
    application.user_middleware = list(app_module.app.user_middleware)

    video = tmp_path / "segment.ts"
    video.write_bytes(BINARY)

    async def chunks(content: bytes, size: int = 1024):
        for i in range(0, len(content), size):
            yield content[i : i + size]

    @application.get("/redirect")
    async def _redirect():
        return RedirectResponse("/auth/magic?token=t", status_code=302)

    @application.get("/no-content")
    async def _no_content():
        return Response(status_code=204)

    @application.get("/octet-stream")
    async def _octet_stream():
        return Response(BINARY, media_type="application/octet-stream")

    @application.get("/pdf")
    async def _pdf():
        return Response(BINARY, media_type="application/pdf")

    @application.get("/jpeg")
    async def _jpeg():
        return Response(BINARY, media_type="image/jpeg")

    @application.get("/json-small")
    async def _json_small():
        return JSONResponse({"ok": True})

    @application.get("/json-large")
    async def _json_large():
        return JSONResponse(LARGE_JSON)

    @application.get("/stream/octet-stream")
    async def _stream_octet():
        return StreamingResponse(chunks(BINARY), media_type="application/octet-stream")

    @application.get("/stream/json")
    async def _stream_json():
        body = JSONResponse(LARGE_JSON).body
        return StreamingResponse(chunks(body), media_type="application/json")

    @application.get("/stream/sse")
    async def _stream_sse():
        async def events():
            for i in range(5):
                yield f"data: chunk-{i} {'x' * 400}\n\n".encode()

        return StreamingResponse(events(), media_type="text/event-stream")

    @application.get("/file")
    async def _file():
        return FileResponse(video, media_type="video/mp2t")

    return application


# (path, expected status, expected body, compressed when the client accepts
# gzip). None leaves it open: the CSRF middleware re-streams every body, so
# gzip's minimum size does not decide for a small one.
CASES = [
    ("/redirect", 302, b"", False),
    ("/no-content", 204, b"", False),
    ("/octet-stream", 200, BINARY, False),
    ("/pdf", 200, BINARY, False),
    ("/jpeg", 200, BINARY, False),
    ("/json-small", 200, b'{"ok":true}', None),
    ("/json-large", 200, JSONResponse(LARGE_JSON).body, True),
    ("/stream/octet-stream", 200, BINARY, False),
    ("/stream/json", 200, JSONResponse(LARGE_JSON).body, True),
    ("/stream/sse", 200, b"".join(f"data: chunk-{i} {'x' * 400}\n\n".encode() for i in range(5)), False),
    ("/file", 200, BINARY, False),
]


def test_selective_gzip_is_part_of_the_production_stack():
    # Otherwise the contract below would pass without exercising it.
    assert any(m.cls is SelectiveGZipMiddleware for m in app_module.app.user_middleware)


@pytest.mark.parametrize("accept_encoding", ["gzip", "identity"])
@pytest.mark.parametrize(
    ("path", "status", "body", "compressible"), CASES, ids=[case[0] for case in CASES]
)
async def test_every_response_kind_is_valid_asgi(
    tmp_path, path, status, body, compressible, accept_encoding
):
    transport = ASGITransport(app=_strict_asgi(_stack_app(tmp_path)))
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(
            path, headers={"Accept-Encoding": accept_encoding}, follow_redirects=False
        )

    assert resp.status_code == status
    assert resp.content == body
    if accept_encoding != "gzip":
        assert resp.headers.get("content-encoding") is None
    elif compressible is not None:
        assert (resp.headers.get("content-encoding") == "gzip") is compressible


async def test_range_request_is_valid_asgi(tmp_path):
    transport = ASGITransport(app=_strict_asgi(_stack_app(tmp_path)))
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(
            "/file", headers={"Accept-Encoding": "gzip", "Range": "bytes=0-99"}
        )

    assert resp.status_code == 206
    assert resp.content == BINARY[:100]
    assert resp.headers.get("content-encoding") is None


async def test_compressed_body_is_real_gzip(tmp_path):
    """The gzip path still compresses: guards against "fixing" ordering by
    turning compression off altogether."""
    transport = ASGITransport(app=_strict_asgi(_stack_app(tmp_path)))
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with client.stream(
            "GET", "/json-large", headers={"Accept-Encoding": "gzip"}
        ) as resp:
            raw = b"".join([chunk async for chunk in resp.aiter_raw()])

    assert gzip.decompress(raw) == JSONResponse(LARGE_JSON).body


async def test_legacy_magic_link_url_redirects_through_the_real_app():
    """The incident itself: an old-form magic link opened in a browser."""
    landing = "https://acme.example.com/auth/magic?token=t&next=%2Fcourse%2Fabc"
    application = app_module.app
    application.dependency_overrides[get_db_session] = lambda: Mock()
    try:
        with patch(
            "src.routers.admin.magic_link_landing_url_for_token",
            new_callable=AsyncMock,
            return_value=landing,
        ):
            transport = ASGITransport(app=_strict_asgi(application))
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get(
                    "/api/v1/admin/acme/auth/magic-consume",
                    params={"token": "t"},
                    headers={"Accept-Encoding": "gzip, deflate, br"},
                    follow_redirects=False,
                )
    finally:
        application.dependency_overrides.pop(get_db_session, None)

    assert resp.status_code == 302
    assert resp.headers["location"] == landing
