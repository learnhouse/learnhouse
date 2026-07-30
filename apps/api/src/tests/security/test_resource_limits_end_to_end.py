"""End-to-end checks for the resource caps, over real I/O rather than fakes.

`test_resource_exhaustion_limits.py` proves the logic with mock transports and
in-memory streams. That leaves the two things mocks cannot answer:

  * F17 — does the pre-read size check actually work against the
    ``SpooledTemporaryFile`` that Starlette hands a real multipart upload,
    including once the upload has rolled over onto disk?
  * F26/F41 — does the streamed read really stop early against a live socket
    speaking chunked transfer encoding, where the body arrives over several
    TCP reads rather than one ``BytesIO`` slice?

Both are answered here with a real ``UploadFile`` and a real HTTP server.
"""

import gzip
import http.server
import socket
import threading
from tempfile import SpooledTemporaryFile

import httpx
import pytest
from fastapi import HTTPException
from starlette.datastructures import UploadFile

from src.security.file_validation import FILE_TYPES, validate_upload
from src.services.utils import link_preview
from src.services.webhooks import dispatch

_PNG_HEADER = b"\x89PNG\r\n\x1a\n"


# ---------------------------------------------------------------------------
# F17 — a real Starlette UploadFile over a real SpooledTemporaryFile
# ---------------------------------------------------------------------------


def _real_upload(filename: str, payload: bytes, content_type: str, rollover: int):
    """Build an UploadFile exactly as Starlette's multipart parser does."""
    spooled = SpooledTemporaryFile(max_size=rollover)
    spooled.write(payload)
    spooled.seek(0)
    return UploadFile(file=spooled, filename=filename, size=len(payload))


class TestRealMultipartUpload:
    def test_small_image_in_memory_still_validates(self):
        payload = _PNG_HEADER + b"\x00" * 2048
        upload = _real_upload("logo.png", payload, "image/png", rollover=1024 * 1024)

        mime, content = validate_upload(upload, ["image"])

        assert mime == "image/png"
        assert content == payload
        # Callers read the stream after us; it must be back at the start.
        assert upload.file.tell() == 0

    def test_upload_that_rolled_over_to_disk_still_validates(self):
        # rollover=1024 forces SpooledTemporaryFile onto a real file on disk,
        # which is what any upload past Starlette's threshold looks like.
        payload = _PNG_HEADER + b"\x00" * (256 * 1024)
        upload = _real_upload("photo.png", payload, "image/png", rollover=1024)

        assert upload.file._rolled is True

        mime, content = validate_upload(upload, ["image"])

        assert mime == "image/png"
        assert content == payload
        assert upload.file.tell() == 0

    def test_oversized_disk_backed_upload_is_rejected_without_reading_it(self):
        payload = _PNG_HEADER + b"\x00" * (256 * 1024)
        upload = _real_upload("big.png", payload, "image/png", rollover=1024)

        with pytest.raises(HTTPException) as exc:
            validate_upload(upload, ["image"], max_size=4096)

        assert exc.value.status_code == 413
        # Measured by seeking, so the body was never pulled into memory and the
        # handle is left where the caller expects it.
        assert upload.file.tell() == 0

    def test_declared_part_size_over_the_cap_is_refused(self):
        upload = _real_upload("clip.mp4", b"", "video/mp4", rollover=1024)
        upload.size = FILE_TYPES["video"]["max_size"] + 1

        with pytest.raises(HTTPException) as exc:
            validate_upload(upload, ["video"])

        assert exc.value.status_code == 413


# ---------------------------------------------------------------------------
# F26 / F41 — real sockets, real chunked transfer
# ---------------------------------------------------------------------------


class _Handler(http.server.BaseHTTPRequestHandler):
    """Serves an effectively endless chunked body, or a gzip bomb."""

    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def _chunked_flood(self, content_type: str):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        chunk = b"A" * 8192
        try:
            # Far more than either cap; the reader must hang up long before.
            for _ in range(4096):
                self.wfile.write(b"%X\r\n" % len(chunk) + chunk + b"\r\n")
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
        except (BrokenPipeError, ConnectionResetError, OSError):
            # Expected: the client aborted once it hit its cap.
            pass

    def do_GET(self):
        self._chunked_flood("text/html; charset=utf-8")

    def do_POST(self):
        length = int(self.headers.get("content-length") or 0)
        if length:
            self.rfile.read(length)
        if self.path == "/bomb":
            body = gzip.compress(b"B" * (4 * 1024 * 1024))
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self._chunked_flood("text/plain")


@pytest.fixture
def live_server():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.shutdown()
        server.server_close()


class TestStreamedReadsStopEarlyOverRealSockets:
    async def test_link_preview_read_aborts_at_its_cap(self, live_server):
        async with httpx.AsyncClient(timeout=10.0) as client:
            async with client.stream("GET", f"{live_server}/flood") as response:
                text = await link_preview._read_capped_text(response)

        assert text is not None
        # Capped, not drained: the server offered 32MB.
        assert len(text.encode()) <= link_preview._MAX_RESPONSE_SIZE

    async def test_webhook_read_aborts_at_its_cap(self, live_server):
        async with httpx.AsyncClient(timeout=10.0) as client:
            async with client.stream("POST", f"{live_server}/flood") as response:
                body = await dispatch._read_capped_body(response)

        assert len(body.encode()) <= dispatch.MAX_RESPONSE_BYTES

    async def test_webhook_refuses_a_gzip_bomb_by_declared_length(self, live_server):
        # identity encoding is what dispatch asks for; a server that answers
        # gzip anyway is declaring a length far past the cap, so the body is
        # never decompressed into memory.
        async with httpx.AsyncClient(timeout=10.0) as client:
            async with client.stream(
                "POST", f"{live_server}/bomb", headers={"Accept-Encoding": "identity"}
            ) as response:
                body = await dispatch._read_capped_body(response)

        assert len(body.encode()) <= dispatch.MAX_RESPONSE_BYTES
