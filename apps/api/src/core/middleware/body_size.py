"""Request body size cap for non-multipart requests.

FastAPI reads and parses the whole body before any dependency (auth, rate
limits) runs, so without a cap a single anonymous request can make a worker
buffer gigabytes of JSON. Multipart uploads are left to the per-route upload
validation, which streams to disk and knows each file type's limit.
"""

from starlette.datastructures import Headers
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_DETAIL = "Request body too large"


class RequestBodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_body_bytes: int) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or self.max_body_bytes <= 0:
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        media_type = headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if media_type == "multipart/form-data":
            await self.app(scope, receive, send)
            return

        content_length = headers.get("content-length")
        if content_length and content_length.isdigit() and int(content_length) > self.max_body_bytes:
            await self._reject(scope, receive, send)
            return

        # A chunked body has no Content-Length, so count what actually arrives.
        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_bytes:
                    # FastAPI re-raises HTTPException from body parsing, so the
                    # client gets a 413 instead of a generic 400.
                    raise HTTPException(status_code=413, detail=_DETAIL)
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except HTTPException as exc:
            if exc.status_code != 413 or response_started:
                raise
            await self._reject(scope, receive, send)

    @staticmethod
    async def _reject(scope: Scope, receive: Receive, send: Send) -> None:
        response = JSONResponse({"detail": _DETAIL}, status_code=413, headers={"Connection": "close"})
        await response(scope, receive, send)
