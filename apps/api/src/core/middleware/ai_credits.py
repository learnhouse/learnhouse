"""``X-AI-Credits-Used``: how many AI credits a request charged.

A pure ASGI middleware puts a fresh collector in a context variable before the
endpoint runs; every AI charge that settles inside the request adds its credits
to it (``metering.Meter.settle``), and the response start gets the total as a
header. Streaming endpoints settle after their headers went out, so they report
credits in their own final event instead.
"""

from __future__ import annotations

from src.services.ai.metering import request_credits_collector


class AICreditsHeaderMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        collector: list[int] = []
        token = request_credits_collector.set(collector)

        async def _send(message):
            if message.get("type") == "http.response.start" and collector:
                headers = list(message.get("headers") or [])
                headers.append((b"x-ai-credits-used", str(sum(collector)).encode()))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, _send)
        finally:
            request_credits_collector.reset(token)
