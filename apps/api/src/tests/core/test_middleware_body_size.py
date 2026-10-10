"""RequestBodySizeLimitMiddleware: non-multipart bodies are capped before
FastAPI buffers and parses them; multipart is left to per-route validation."""

import pytest
from fastapi import FastAPI, File, Request, UploadFile
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel

from src.core.middleware.body_size import RequestBodySizeLimitMiddleware

_CAP = 1024


class _Payload(BaseModel):
    data: str


def _app(cap: int = _CAP) -> FastAPI:
    app = FastAPI()

    @app.post("/json")
    async def json_route(payload: _Payload):
        return {"size": len(payload.data)}

    @app.put("/raw")
    async def raw_route(request: Request):
        return {"size": len(await request.body())}

    @app.post("/upload")
    async def upload_route(file: UploadFile = File(...)):
        return {"size": len(await file.read())}

    app.add_middleware(RequestBodySizeLimitMiddleware, max_body_bytes=cap)
    return app


async def _client(app: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_small_json_passes():
    async with await _client(_app()) as client:
        resp = await client.post("/json", json={"data": "x" * 100})
    assert resp.status_code == 200
    assert resp.json() == {"size": 100}


@pytest.mark.asyncio
async def test_oversized_json_rejected_by_content_length():
    async with await _client(_app()) as client:
        resp = await client.post("/json", json={"data": "x" * (_CAP * 2)})
    assert resp.status_code == 413
    assert resp.json() == {"detail": "Request body too large"}


@pytest.mark.asyncio
async def test_oversized_form_urlencoded_rejected():
    async with await _client(_app()) as client:
        resp = await client.post("/json", data={"data": "x" * (_CAP * 2)})
    assert resp.status_code == 413


@pytest.mark.asyncio
async def test_oversized_raw_body_rejected():
    async with await _client(_app()) as client:
        resp = await client.put(
            "/raw",
            content=b"x" * (_CAP + 1),
            headers={"Content-Type": "application/octet-stream"},
        )
    assert resp.status_code == 413


@pytest.mark.parametrize("path", ["/json", "/raw"])
@pytest.mark.asyncio
async def test_streamed_body_without_content_length_is_counted(path):
    async def chunks():
        for _ in range(4):
            yield b"x" * (_CAP // 2)

    async with await _client(_app()) as client:
        resp = await client.request(
            "POST" if path == "/json" else "PUT",
            path,
            content=chunks(),
            headers={"Content-Type": "application/json"},
        )
    assert "content-length" not in resp.request.headers
    assert resp.status_code == 413


@pytest.mark.asyncio
async def test_streamed_body_under_cap_passes():
    async def chunks():
        yield b"abc"
        yield b"def"

    async with await _client(_app()) as client:
        resp = await client.put("/raw", content=chunks())
    assert resp.status_code == 200
    assert resp.json() == {"size": 6}


@pytest.mark.asyncio
async def test_multipart_is_not_capped():
    async with await _client(_app()) as client:
        resp = await client.post(
            "/upload", files={"file": ("a.bin", b"x" * (_CAP * 4), "application/octet-stream")}
        )
    assert resp.status_code == 200
    assert resp.json() == {"size": _CAP * 4}


@pytest.mark.asyncio
async def test_zero_disables_the_cap():
    async with await _client(_app(cap=0)) as client:
        resp = await client.put("/raw", content=b"x" * (_CAP * 4))
    assert resp.status_code == 200


def test_default_cap_is_configured():
    from config.config import get_learnhouse_config

    assert get_learnhouse_config().hosting_config.max_request_body_mb == 25
