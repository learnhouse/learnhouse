"""Credential-less CORS for the API, for apps on other origins.

The embed components (@learnhouse/react, @learnhouse/vue) and browser apps
using @learnhouse/sdk run on the customer's own domain and call the API with a
bearer token (an embed session, or a user's access token). The API's own CORS
only admits LearnHouse's domains, with credentials, because it is what keeps
other sites from reading responses with the visitor's session cookie.

Origins that CORS does not trust get ``Access-Control-Allow-Origin: *`` here,
never with ``Access-Control-Allow-Credentials``. Browsers refuse to expose a
``*`` response to a request that carried cookies, so a cookie session stays
unreadable from those origins exactly as before; only requests that bring
their own ``Authorization`` header get a readable answer, and anyone holding
such a token can already call the API from a server. ``Set-Cookie`` is also
dropped on these responses so a session can never be planted from another
origin. State-changing requests that do carry a cookie are still stopped by
the CSRF origin check.

Set ``LEARNHOUSE_BEARER_CORS=false`` to turn this off and keep the API to its
own domains.
"""

import os
import re
from typing import Optional

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from src.core.middleware.cors import get_cors_origin_regex

_API_PREFIX = "/api/v1/"
# Server-to-server routes; never answered for browsers on other origins.
_EXCLUDED_PREFIXES = ("/api/v1/internal", "/api/v1/cloud_internal")

_ALLOW_METHODS = b"GET, POST, PUT, PATCH, DELETE, OPTIONS"
_DEFAULT_ALLOW_HEADERS = b"Authorization, Content-Type, Accept, Accept-Language"
_EXPOSE_HEADERS = b"Retry-After, Content-Disposition, Content-Length"
# Only header names (token characters and commas) are echoed back.
_HEADER_LIST = re.compile(rb"^[A-Za-z0-9!#$%&'*+.^_`|~\-, ]{1,1024}$")


def bearer_cors_enabled() -> bool:
    return os.environ.get("LEARNHOUSE_BEARER_CORS", "true").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def _applies_to(path: str) -> bool:
    return path.startswith(_API_PREFIX) and not path.startswith(_EXCLUDED_PREFIXES)


class BearerCORSMiddleware:
    def __init__(self, app: ASGIApp, trusted_origin_regex: Optional[str] = None) -> None:
        self.app = app
        self._trusted = re.compile(trusted_origin_regex or get_cors_origin_regex())

    def _is_trusted(self, origin: str) -> bool:
        return self._trusted.fullmatch(origin) is not None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not _applies_to(scope.get("path", "")):
            await self.app(scope, receive, send)
            return
        headers = {k.lower(): v for k, v in scope.get("headers") or []}
        raw_origin = headers.get(b"origin")
        if not raw_origin:
            await self.app(scope, receive, send)
            return
        origin = raw_origin.decode("latin-1")
        if self._is_trusted(origin):
            await self.app(scope, receive, send)
            return

        if scope.get("method") == "OPTIONS" and b"access-control-request-method" in headers:
            requested = headers.get(b"access-control-request-headers", b"").strip()
            allow_headers = requested if requested and _HEADER_LIST.match(requested) else _DEFAULT_ALLOW_HEADERS
            await send(
                {
                    "type": "http.response.start",
                    "status": 204,
                    "headers": [
                        (b"access-control-allow-origin", b"*"),
                        (b"access-control-allow-methods", _ALLOW_METHODS),
                        (b"access-control-allow-headers", allow_headers),
                        (b"access-control-max-age", b"600"),
                        (b"vary", b"Origin"),
                        (b"content-length", b"0"),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": b""})
            return

        async def send_open(message: Message) -> None:
            if message["type"] == "http.response.start":
                kept = [
                    (k, v)
                    for k, v in message.get("headers", [])
                    if not k.lower().startswith(b"access-control-") and k.lower() != b"set-cookie"
                ]
                kept += [
                    (b"access-control-allow-origin", b"*"),
                    (b"access-control-expose-headers", _EXPOSE_HEADERS),
                    (b"vary", b"Origin"),
                ]
                message = {**message, "headers": kept}
            await send(message)

        await self.app(scope, receive, send_open)
