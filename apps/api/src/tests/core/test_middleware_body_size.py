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


# The except branch runs when the 413 escapes a raw ASGI app (one without
# FastAPI's exception handlers between it and this middleware).


def _raw_app(*, start_first: bool = False, error: int | None = None):
    async def app(scope, receive, send):
        if start_first:
            await send({"type": "http.response.start", "status": 200, "headers": []})
        if error is not None:
            from starlette.exceptions import HTTPException

            raise HTTPException(status_code=error)
        while True:
            message = await receive()
            if not message.get("more_body"):
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    return RequestBodySizeLimitMiddleware(app, max_body_bytes=_CAP)


async def _stream_oversized(app):
    async def chunks():
        for _ in range(4):
            yield b"x" * (_CAP // 2)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        return await client.put("/", content=chunks())


@pytest.mark.asyncio
async def test_raw_app_overflow_is_turned_into_413():
    resp = await _stream_oversized(_raw_app())
    assert resp.status_code == 413
    assert resp.json() == {"detail": "Request body too large"}
    assert resp.headers["connection"] == "close"


@pytest.mark.asyncio
async def test_overflow_after_response_started_is_reraised():
    from starlette.exceptions import HTTPException

    # Headers are already out, so a second response would corrupt the stream.
    with pytest.raises(HTTPException) as exc:
        await _stream_oversized(_raw_app(start_first=True, error=413))
    assert exc.value.status_code == 413


@pytest.mark.asyncio
async def test_other_http_errors_are_not_rewritten():
    from starlette.exceptions import HTTPException

    with pytest.raises(HTTPException) as exc:
        await _stream_oversized(_raw_app(error=400))
    assert exc.value.status_code == 400
