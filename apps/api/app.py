#   _                          _   _
#  | |    ___  __ _ _ __ _ __ | | | | ___  _   _ ___  ___
#  | |   / _ \/ _` | '__| '_ \| |_| |/ _ \| | | / __|/ _ \
#  | |__|  __/ (_| | |  | | | |  _  | (_) | |_| \__ \  __/
#  |_____\___|\__,_|_|  |_| |_|_| |_|\___/ \__,_|___/\___|
#
#  LearnHouse · open-source learning platform · FastAPI entrypoint
#
#  ↳ learnhouse.app · github.com/learnhouse/learnhouse
#  ↳ Created and maintained by @swve © 2022–present

import logging

import uvicorn
import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration, ignore_logger
from fastapi import FastAPI
from starlette.datastructures import Headers
from starlette.middleware.gzip import GZipMiddleware, GZipResponder, IdentityResponder
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from config.config import LearnHouseConfig, get_learnhouse_config
from src.core.ee_hooks import register_ee_middlewares
from src.core.events.events import shutdown_app, startup_app
from src.core.middleware.cors import configure_cors
from src.router import v1_router
from src.routers.content_files import router as content_files_router
from src.routers.local_content import router as local_content_router


learnhouse_config: LearnHouseConfig = get_learnhouse_config()

# Health probes fail loudly on purpose — a 503 from /health is how Kubernetes
# learns to take the pod out of rotation. It is not a second, separate incident
# to report, and during an outage every probe on every pod files one.
_HEALTH_TRANSACTIONS = ("/api/v1/health", "/health")


# Content types worth compressing. Everything else — video, audio, images,
# PDFs, zips — is already compressed, so gzipping it burns CPU for ~0 bytes
# saved. That matters here because Starlette compresses inline in the ASGI
# `send` coroutine, on the event loop: a few concurrent range-less GETs of a
# course video would otherwise pin the workers for the whole transfer.
_COMPRESSIBLE_PREFIXES = (
    "text/",
    "application/json",
    "application/ld+json",
    "application/manifest+json",
    "application/javascript",
    "application/xml",
    "application/xhtml+xml",
    "image/svg+xml",
)


def _is_compressible(content_type: str) -> bool:
    media_type = content_type.split(";", 1)[0].strip().lower()
    return media_type.startswith(_COMPRESSIBLE_PREFIXES)


class _SelectiveGZipResponder(GZipResponder):
    """GZipResponder that opts out once the response's Content-Type is known.

    Starlette picks the responder from the request's Accept-Encoding alone, so
    the content type is only visible on `http.response.start`. Marking the
    response excluded there routes it down Starlette's own pass-through path,
    which forwards every body chunk untouched.
    """

    async def send_with_compression(self, message: Message) -> None:
        if message["type"] == "http.response.start":
            await super().send_with_compression(message)
            if not self.content_type_is_excluded:
                content_type = Headers(raw=message["headers"]).get("content-type", "")
                self.content_type_is_excluded = not _is_compressible(content_type)
            return
        await super().send_with_compression(message)


class SelectiveGZipMiddleware(GZipMiddleware):
    """GZipMiddleware that only compresses compressible content types."""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        responder: ASGIApp
        if "gzip" in Headers(scope=scope).get("Accept-Encoding", ""):
            responder = _SelectiveGZipResponder(
                self.app, self.minimum_size, compresslevel=self.compresslevel
            )
        else:
            responder = IdentityResponder(self.app, self.minimum_size)

        await responder(scope, receive, send)


def _before_send(event, hint):
    transaction = event.get("transaction") or ""
    if transaction in _HEALTH_TRANSACTIONS:
        return None
    return event


if learnhouse_config.general_config.sentry_config.dsn:
    # OpenTelemetry logs "Failed to detach context" at ERROR when a span's
    # context token is reset from a different asyncio context than the one that
    # created it — which is exactly what streaming AI endpoints do. It is
    # instrumentation bookkeeping, not an application fault, and the request it
    # is attached to succeeds.
    ignore_logger("opentelemetry.context")

    sentry_sdk.init(
        dsn=learnhouse_config.general_config.sentry_config.dsn,
        environment=learnhouse_config.general_config.env,
        send_default_pii=False,
        enable_logs=True,
        traces_sample_rate=1.0 if learnhouse_config.general_config.development_mode else 0.3,
        profile_session_sample_rate=1.0 if learnhouse_config.general_config.development_mode else 0.1,
        profile_lifecycle="trace",
        before_send=_before_send,
        integrations=[
            LoggingIntegration(
                level=logging.INFO,
                event_level=logging.ERROR,
            ),
        ],
    )

app = FastAPI(
    title=learnhouse_config.site_name,
    description=learnhouse_config.site_description,
    docs_url="/docs" if learnhouse_config.general_config.development_mode else None,
    redoc_url="/redoc" if learnhouse_config.general_config.development_mode else None,
    version="1.3.5",
)

# Middleware
configure_cors(app)
# compresslevel 9 costs several times the CPU of 6 for a couple of percent on
# JSON; 6 is gzip's own default.
app.add_middleware(SelectiveGZipMiddleware, minimum_size=1000, compresslevel=6)
register_ee_middlewares(app)

# Lifecycle
app.add_event_handler("startup", startup_app(app))
app.add_event_handler("shutdown", shutdown_app(app))

# Content delivery — S3-aware router when S3 is enabled, local otherwise.
# Both paths enforce access control; neither serves raw StaticFiles.
if learnhouse_config.hosting_config.content_delivery.type == "s3api":
    app.include_router(content_files_router)
else:
    app.include_router(local_content_router)

app.include_router(v1_router)


@app.get("/")
async def root():
    return {"Message": "Welcome to LearnHouse ✨"}


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=learnhouse_config.hosting_config.port,
        reload=learnhouse_config.general_config.development_mode,
    )
