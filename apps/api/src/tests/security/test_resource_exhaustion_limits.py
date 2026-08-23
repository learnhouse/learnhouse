"""Resource-exhaustion guards on the upload, outbound-fetch and response paths.

Covers:
  * F17 — ``validate_upload`` enforces its cap by measuring, not by buffering.
  * F26 — the link preview streams an attacker's response under a byte cap.
  * F41 — webhook delivery reads a capped, uncompressed response body.
  * F39 — gzip is applied to compressible payloads only, never to media.
"""

import asyncio
import io
import zipfile
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import JSONResponse, StreamingResponse
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.db.webhooks import WebhookDeliveryLog
from src.security import file_validation
from src.security.file_validation import (
    FILE_TYPES,
    _MAGIC_PREFIX_BYTES,
    validate_upload,
    validate_zip_stream,
)
from src.services.utils import link_preview
from src.services.utils.link_preview import fetch_link_preview
from src.services.webhooks import dispatch

_PNG_HEADER = b"\x89PNG\r\n\x1a\n"
_WEBM_HEADER = b"\x1a\x45\xdf\xa3"
_PEER_IP = "93.184.216.34"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _CountingStream(io.BytesIO):
    """BytesIO that records how much of itself was actually read."""

    def __init__(self, data: bytes):
        super().__init__(data)
        self.read_sizes: list = []
        self.bytes_read = 0

    def read(self, size=-1):
        chunk = super().read(size)
        self.read_sizes.append(size)
        self.bytes_read += len(chunk)
        return chunk


class _UnseekableStream:
    """A stream whose length cannot be measured without reading it."""

    def __init__(self, data: bytes):
        self._data = data
        self._pos = 0
        self.max_requested = 0

    def read(self, size=-1):
        self.max_requested = max(self.max_requested, size)
        end = len(self._data) if size is None or size < 0 else self._pos + size
        chunk = self._data[self._pos:end]
        self._pos = end
        return chunk

    def seek(self, *_args):
        raise OSError("stream is not seekable")

    def tell(self):
        raise OSError("stream is not seekable")


def _upload(filename: str, stream, content_type: str = "application/octet-stream"):
    return SimpleNamespace(filename=filename, content_type=content_type, file=stream)


def _zip_bytes(name: str = "hello.txt", payload: bytes = b"hi") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(name, payload)
    return buf.getvalue()


class _ChunkedStream(httpx.AsyncByteStream):
    """Emits chunks until the reader stops, recording how much it handed over."""

    def __init__(self, chunk: bytes, max_chunks: int):
        self.chunk = chunk
        self.max_chunks = max_chunks
        self.emitted = 0

    async def __aiter__(self):
        for _ in range(self.max_chunks):
            self.emitted += len(self.chunk)
            yield self.chunk


# Captured before any patching: `link_preview` does `import httpx`, so patching
# "src.services.utils.link_preview.httpx.AsyncClient" replaces the attribute on
# the httpx module itself — the factory below would otherwise recurse into itself.
_REAL_ASYNC_CLIENT = httpx.AsyncClient


def _mock_transport_client_factory(handler):
    """Replacement for ``httpx.AsyncClient`` that routes through a mock transport."""

    def _factory(**kwargs):
        return _REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler), **kwargs)

    return _factory


# ---------------------------------------------------------------------------
# F17 — validate_upload
# ---------------------------------------------------------------------------


class TestUploadSizeEnforcement:
    def test_oversized_upload_is_rejected_without_reading_the_body(self):
        payload = _PNG_HEADER + b"\x00" * (1024 * 1024)
        stream = _CountingStream(payload)

        with pytest.raises(HTTPException) as exc:
            validate_upload(
                _upload("big.png", stream, "image/png"), ["image"], max_size=1024
            )

        assert exc.value.status_code == 413
        # The cap is decided from the stream length, so nothing was buffered.
        assert stream.bytes_read == 0
        assert stream.tell() == 0

    def test_declared_part_size_is_rejected_before_the_stream_is_touched(self):
        # Empty stream: only the declared multipart part size can trip the cap.
        stream = _CountingStream(b"")
        upload = _upload("clip.mp4", stream, "video/mp4")
        upload.size = FILE_TYPES["video"]["max_size"] + 1

        with pytest.raises(HTTPException) as exc:
            validate_upload(upload, ["video"])

        assert exc.value.status_code == 413
        assert stream.bytes_read == 0

    def test_unmeasurable_stream_read_is_bounded_by_the_cap(self):
        stream = _UnseekableStream(_PNG_HEADER + b"\x00" * 4096)

        with pytest.raises(HTTPException) as exc:
            validate_upload(
                _upload("big.png", stream, "image/png"), ["image"], max_size=64
            )

        assert exc.value.status_code == 413
        # Never asked the stream for more than the cap plus the detection byte.
        assert stream.max_requested == 65

    def test_unmeasurable_stream_under_the_cap_is_validated_from_its_buffer(self):
        """The bounded read is the only read: that one buffer is both the
        validator's sample and the content handed back to the caller."""
        payload = _PNG_HEADER + b"\x00" * 32
        stream = _UnseekableStream(payload)

        mime, content = validate_upload(
            _upload("logo.png", stream, "image/png"), ["image"], max_size=1024
        )

        assert mime == "image/png"
        assert content == payload
        assert stream.max_requested == 1025

    def test_small_image_still_returns_mime_and_full_content(self):
        payload = _PNG_HEADER + b"\x00" * 64
        stream = _CountingStream(payload)

        mime, content = validate_upload(
            _upload("logo.png", stream, "image/png"), ["image"]
        )

        assert mime == "image/png"
        assert content == payload
        assert stream.tell() == 0

    def test_magic_validator_only_sees_a_bounded_prefix(self):
        payload = _WEBM_HEADER + b"\x00" * (_MAGIC_PREFIX_BYTES * 2)
        seen: list = []

        def _spy(content: bytes) -> bool:
            seen.append(len(content))
            return True

        patched = dict(FILE_TYPES)
        patched["video"] = {**FILE_TYPES["video"], "validator": _spy}

        with patch.object(file_validation, "FILE_TYPES", patched):
            _, content = validate_upload(
                _upload("clip.webm", _CountingStream(payload), "video/webm"), ["video"]
            )

        assert seen == [_MAGIC_PREFIX_BYTES]
        # The caller contract is unchanged: it still receives the whole file.
        assert content == payload

    def test_zip_upload_is_validated_off_the_stream_not_a_bytes_copy(self):
        data = _zip_bytes()
        buffered_calls: list = []

        patched = dict(FILE_TYPES)
        patched["archive"] = {
            **FILE_TYPES["archive"],
            "validator": lambda content: buffered_calls.append(len(content)) or True,
        }

        with patch.object(file_validation, "FILE_TYPES", patched):
            mime, content = validate_upload(
                _upload("pkg.zip", _CountingStream(data), "application/zip"),
                ["archive"],
            )

        assert buffered_calls == []
        assert mime == "application/zip"
        assert content == data

    def test_validate_zip_stream_accepts_a_real_zip_and_rewinds(self):
        stream = io.BytesIO(_zip_bytes())

        assert validate_zip_stream(stream) is True
        assert stream.tell() == 0

    def test_validate_zip_stream_rejects_non_zip_and_zip_bombs(self):
        assert validate_zip_stream(io.BytesIO(b"not a zip at all")) is False

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("big.bin", b"\x00" * 1024)
            zf.infolist()[0].file_size = 600 * 1024 * 1024  # declared 600 MB

        assert validate_zip_stream(io.BytesIO(buf.getvalue())) is False

    def test_every_type_declares_a_cap(self):
        # The caps themselves are a product decision, not a security control —
        # what matters here is that no type is unbounded, since the cap is what
        # the pre-read size check is measured against.
        for name, config in FILE_TYPES.items():
            assert config.get("max_size"), name


# ---------------------------------------------------------------------------
# F26 — link preview
# ---------------------------------------------------------------------------


def _patch_preview_ssrf():
    return (
        patch(
            "src.services.utils.link_preview.resolve_and_validate_url",
            return_value={_PEER_IP},
        ),
        patch("src.services.utils.link_preview.assert_connected_peer_allowed"),
    )


class TestLinkPreviewResponseCap:
    async def test_stops_reading_once_the_cap_is_reached(self):
        chunk = b"<p>" + b"a" * 509
        stream = _ChunkedStream(chunk, max_chunks=1000)

        def handler(request):
            return httpx.Response(
                200, headers={"content-type": "text/html"}, stream=stream
            )

        resolve, peer = _patch_preview_ssrf()
        with resolve, peer, patch.object(
            link_preview, "_MAX_RESPONSE_SIZE", 4096
        ), patch(
            "src.services.utils.link_preview.httpx.AsyncClient",
            _mock_transport_client_factory(handler),
        ):
            result = await fetch_link_preview("https://example.com/page")

        # Aborted at the cap instead of draining the full 512 KB on offer.
        assert stream.emitted <= 4096 + len(chunk)
        assert stream.emitted < 1000 * len(chunk)
        assert result["url"] == "https://example.com/page"

    async def test_oversized_content_length_is_rejected_before_the_body(self):
        stream = _ChunkedStream(b"x" * 1024, max_chunks=100)

        def handler(request):
            return httpx.Response(
                200,
                headers={
                    "content-type": "text/html",
                    "content-length": str(link_preview._MAX_RESPONSE_SIZE + 1),
                },
                stream=stream,
            )

        resolve, peer = _patch_preview_ssrf()
        with resolve, peer, patch(
            "src.services.utils.link_preview.httpx.AsyncClient",
            _mock_transport_client_factory(handler),
        ):
            result = await fetch_link_preview("https://example.com/page")

        assert stream.emitted == 0
        assert result["title"] is None
        assert result["favicon"] == "https://example.com/favicon.ico"

    async def test_non_html_content_type_is_skipped_unread(self):
        stream = _ChunkedStream(b"%PDF-1.4 payload", max_chunks=100)

        def handler(request):
            return httpx.Response(
                200, headers={"content-type": "application/pdf"}, stream=stream
            )

        resolve, peer = _patch_preview_ssrf()
        with resolve, peer, patch(
            "src.services.utils.link_preview.httpx.AsyncClient",
            _mock_transport_client_factory(handler),
        ):
            result = await fetch_link_preview("https://example.com/page")

        assert stream.emitted == 0
        assert result["title"] is None

    async def test_normal_small_page_still_yields_a_full_preview(self):
        html = (
            "<html><head><title>  Example Title </title>"
            '<meta property="og:description" content="A description">'
            '<link rel="icon" href="/static/fav.ico">'
            "</head><body>hi</body></html>"
        )

        def handler(request):
            return httpx.Response(
                200,
                headers={"content-type": "text/html; charset=utf-8"},
                content=html.encode(),
            )

        resolve, peer = _patch_preview_ssrf()
        with resolve, peer, patch(
            "src.services.utils.link_preview.httpx.AsyncClient",
            _mock_transport_client_factory(handler),
        ):
            result = await fetch_link_preview("https://example.com/page")

        assert result["title"] == "Example Title"
        assert result["description"] == "A description"
        assert result["favicon"] == "https://example.com/static/fav.ico"

    async def test_redirect_hops_are_still_validated_individually(self):
        def handler(request):
            if request.url.path == "/start":
                return httpx.Response(
                    301, headers={"location": "https://example.com/final"}
                )
            return httpx.Response(
                200,
                headers={"content-type": "text/html"},
                content=b"<html><head><title>Final</title></head></html>",
            )

        with patch(
            "src.services.utils.link_preview.resolve_and_validate_url",
            return_value={_PEER_IP},
        ) as mock_resolve, patch(
            "src.services.utils.link_preview.assert_connected_peer_allowed"
        ), patch(
            "src.services.utils.link_preview.httpx.AsyncClient",
            _mock_transport_client_factory(handler),
        ):
            result = await fetch_link_preview("https://example.com/start")

        assert result["title"] == "Final"
        # Once for the original URL, once for the redirect target.
        assert mock_resolve.call_count == 2

    async def test_overall_timeout_falls_back_to_a_minimal_preview(self):
        async def _never_finishes(*_args, **_kwargs):
            await asyncio.sleep(5)

        with patch(
            "src.services.utils.link_preview.resolve_and_validate_url",
            return_value={_PEER_IP},
        ), patch.object(link_preview, "_fetch_html", _never_finishes), patch.object(
            link_preview, "_TOTAL_TIMEOUT", 0.01
        ):
            result = await fetch_link_preview("https://example.com/page")

        assert result["title"] is None
        assert result["url"] == "https://example.com/page"


# ---------------------------------------------------------------------------
# F41 — webhook delivery
# ---------------------------------------------------------------------------


def _fake_session_factory(db):
    @asynccontextmanager
    async def _factory():
        yield db

    return _factory


def _endpoint(webhook_id: int):
    return dispatch._EndpointInfo(
        id=webhook_id,
        webhook_uuid=f"wh_{webhook_id}",
        url="https://example.com/hook",
        secret_encrypted="encrypted-secret",
        events=["course_created"],
    )


@asynccontextmanager
async def _delivery_harness(db, handler):
    client = _REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler))
    with patch(
        "src.services.webhooks.dispatch._async_session_factory",
        _fake_session_factory(db),
    ), patch(
        "src.services.webhooks.dispatch.decrypt_secret", return_value="plaintext"
    ), patch(
        "src.services.webhooks.dispatch.compute_signature", return_value="sha256=test"
    ), patch(
        "src.services.webhooks.dispatch.resolve_and_validate_url",
        return_value={_PEER_IP},
    ), patch(
        "src.services.webhooks.dispatch.assert_connected_peer_allowed"
    ), patch(
        "src.services.webhooks.dispatch._get_webhook_client", return_value=client
    ), patch(
        "src.services.webhooks.dispatch._prune_delivery_logs", new_callable=AsyncMock
    ):
        yield
    await client.aclose()


async def _logs_for(db, webhook_id: int):
    rows = await db.execute(
        select(WebhookDeliveryLog)
        .where(WebhookDeliveryLog.webhook_id == webhook_id)
        .order_by(WebhookDeliveryLog.attempt)
    )
    return rows.scalars().all()


class TestWebhookResponseCap:
    async def test_oversized_response_is_capped_and_delivery_still_succeeds(self, db):
        stream = _ChunkedStream(b"A" * 4096, max_chunks=512)  # 2 MB on offer
        seen_headers: dict = {}

        def handler(request):
            seen_headers.update(request.headers)
            return httpx.Response(200, stream=stream)

        async with _delivery_harness(db, handler):
            await dispatch._deliver_to_endpoint(
                _endpoint(901), "course_created", 42, {"course_uuid": "c1"}
            )

        # Compression is refused outright, so a gzip bomb cannot amplify.
        assert seen_headers["accept-encoding"] == "identity"
        assert stream.emitted <= dispatch.MAX_RESPONSE_BYTES + 4096

        logs = await _logs_for(db, 901)
        assert len(logs) == 1
        assert logs[0].success is True
        assert logs[0].response_status == 200
        # Only the first 500 bytes are persisted, exactly as before.
        assert logs[0].response_body == "A" * 500

    async def test_declared_oversized_content_length_skips_the_body(self, db):
        stream = _ChunkedStream(b"B" * 1024, max_chunks=100)

        def handler(request):
            return httpx.Response(
                200,
                headers={"content-length": str(dispatch.MAX_RESPONSE_BYTES + 1)},
                stream=stream,
            )

        async with _delivery_harness(db, handler):
            await dispatch._deliver_to_endpoint(
                _endpoint(902), "course_created", 42, {"course_uuid": "c1"}
            )

        assert stream.emitted == 0
        logs = await _logs_for(db, 902)
        assert len(logs) == 1
        assert logs[0].success is True
        assert logs[0].response_body is None

    async def test_small_response_is_recorded_unchanged(self, db):
        def handler(request):
            return httpx.Response(200, content=b"ok")

        async with _delivery_harness(db, handler):
            await dispatch._deliver_to_endpoint(
                _endpoint(903), "course_created", 42, {"course_uuid": "c1"}
            )

        logs = await _logs_for(db, 903)
        assert len(logs) == 1
        assert logs[0].success is True
        assert logs[0].response_status == 200
        assert logs[0].response_body == "ok"


# ---------------------------------------------------------------------------
# F39 — content-type-aware gzip
# ---------------------------------------------------------------------------


def _gzip_test_app() -> FastAPI:
    from app import SelectiveGZipMiddleware

    application = FastAPI()
    application.add_middleware(
        SelectiveGZipMiddleware, minimum_size=100, compresslevel=6
    )

    @application.get("/json")
    async def _json():
        return JSONResponse({"items": ["compress me" for _ in range(200)]})

    @application.get("/video")
    async def _video():
        return Response(content=b"\x00" * 5000, media_type="video/mp4")

    @application.get("/video-stream")
    async def _video_stream():
        async def _chunks():
            for _ in range(5):
                yield b"\x00" * 2000

        return StreamingResponse(_chunks(), media_type="video/mp4")

    @application.get("/sse")
    async def _sse():
        async def _events():
            for i in range(5):
                yield f"data: chunk-{i} {'x' * 400}\n\n".encode()

        return StreamingResponse(_events(), media_type="text/event-stream")

    return application


class TestSelectiveGZip:
    async def test_sse_stream_is_passed_through_intact(self):
        """AI chat streams over SSE — compressing or half-compressing one
        would break every live token as it arrives."""
        application = _gzip_test_app()
        transport = ASGITransport(app=application)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/sse", headers={"Accept-Encoding": "gzip"})

        assert resp.status_code == 200
        assert resp.headers.get("content-encoding") is None
        # Bodies must arrive verbatim, not as a gzip frame served under an
        # identity header (or vice versa).
        assert resp.text.startswith("data: chunk-0 ")
        assert resp.text.count("data: chunk-") == 5

    async def test_json_is_compressed_but_media_is_not(self):
        application = _gzip_test_app()
        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="http://test"
        ) as client:
            json_resp = await client.get("/json", headers={"Accept-Encoding": "gzip"})
            video_resp = await client.get("/video", headers={"Accept-Encoding": "gzip"})
            stream_resp = await client.get(
                "/video-stream", headers={"Accept-Encoding": "gzip"}
            )

        assert json_resp.headers.get("content-encoding") == "gzip"
        assert len(json_resp.json()["items"]) == 200

        assert video_resp.headers.get("content-encoding") is None
        assert video_resp.content == b"\x00" * 5000

        assert stream_resp.headers.get("content-encoding") is None
        assert stream_resp.content == b"\x00" * 10000

    async def test_identity_path_is_untouched_without_accept_encoding(self):
        application = _gzip_test_app()
        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="http://test"
        ) as client:
            resp = await client.get("/json", headers={"Accept-Encoding": "identity"})

        assert resp.headers.get("content-encoding") is None
        assert len(resp.json()["items"]) == 200

    def test_compressible_content_type_matching(self):
        from app import _is_compressible

        assert _is_compressible("application/json") is True
        assert _is_compressible("text/html; charset=utf-8") is True
        assert _is_compressible("image/svg+xml") is True
        assert _is_compressible("video/mp4") is False
        assert _is_compressible("application/octet-stream") is False
        assert _is_compressible("") is False
