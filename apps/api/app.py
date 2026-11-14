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
from contextlib import asynccontextmanager

import uvicorn
import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration, ignore_logger
from fastapi import FastAPI
from starlette.datastructures import Headers
from starlette.middleware.gzip import GZipMiddleware, GZipResponder, IdentityResponder
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from config.config import LearnHouseConfig, get_learnhouse_config
from src.core.version import get_learnhouse_version
from src.core.ee_hooks import register_ee_middlewares
from src.core.events.events import shutdown_app, startup_app
from src.core.middleware.body_size import RequestBodySizeLimitMiddleware
from src.core.middleware.bearer_cors import BearerCORSMiddleware, bearer_cors_enabled
from src.core.middleware.cors import configure_cors
from src.core.routing_perf import install_router_prefix_short_circuit
from src.security.csrf import CSRFProtectionMiddleware
from src.router import v1_router
from src.services.ai.llm.errors import is_quota_error
from src.routers.content_files import router as content_files_router
from src.routers.local_content import router as local_content_router


learnhouse_config: LearnHouseConfig = get_learnhouse_config()

# Route matching skips whole routers whose prefix can't match (see module).
install_router_prefix_short_circuit()

# Health probes fail loudly on purpose: a 503 from /health is how Kubernetes
# learns to take the pod out of rotation. It is not a second, separate incident
# to report, and during an outage every probe on every pod files one.
_HEALTH_TRANSACTIONS = ("/api/v1/health", "/health")


# Content types worth compressing. Everything else (video, audio, images,
# PDFs, zips) is already compressed, so gzipping it burns CPU for ~0 bytes
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
    the content type is only visible on `http.response.start`. Adding it to
    the exclude list before Starlette sees that message routes the response
    down Starlette's own pass-through path. Flipping `content_type_is_excluded`
    afterwards is not enough: since Starlette 1.9 the pass-through path forwards
    the start message while handling it, so a response excluded late (any
    redirect, application/octet-stream) sent its body with no start and uvicorn
    answered a bare 500.
    """

    async def send_with_compression(self, message: Message) -> None:
        if message["type"] == "http.response.start":
            content_type = Headers(raw=message["headers"]).get("content-type", "")
            if not _is_compressible(content_type):
                media_type = content_type.partition(";")[0].strip().lower()
                self.exclude_content_types = (*self.exclude_content_types, media_type)
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
    # An AI provider refusing work over a rate limit, quota or spending cap is
    # an operational state, logged as a warning where we handle it. The SDK
    # integrations capture it on their own as well, once per attempt.
    exc_info = hint.get("exc_info")
    if exc_info and is_quota_error(exc_info[1]):
        return None
    return event


if learnhouse_config.general_config.sentry_config.dsn:
    # OpenTelemetry logs "Failed to detach context" at ERROR when a span's
    # context token is reset from a different asyncio context than the one that
    # created it, which is exactly what streaming AI endpoints do. It is
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

@asynccontextmanager
async def lifespan(application: FastAPI):
    await startup_app(application)()
    try:
        yield
    finally:
        await shutdown_app(application)()


app = FastAPI(
    title=learnhouse_config.site_name,
    description=learnhouse_config.site_description,
    docs_url="/docs" if learnhouse_config.general_config.development_mode else None,
    redoc_url="/redoc" if learnhouse_config.general_config.development_mode else None,
    # The schema lists every internal route; publish it only where the docs are.
    openapi_url="/openapi.json" if learnhouse_config.general_config.development_mode else None,
    version=get_learnhouse_version(),
    lifespan=lifespan,
)

# Middleware
# Starlette runs the last-added middleware first. CSRF is added before CORS so
# CORS wraps it: preflights are answered by CORS, and a CSRF 403 still carries
# CORS headers so the frontend can read it. The body cap sits inside both, so
# its 413 carries CORS headers too.
app.add_middleware(
    RequestBodySizeLimitMiddleware,
    max_body_bytes=learnhouse_config.hosting_config.max_request_body_mb * 1024 * 1024,
)
app.add_middleware(CSRFProtectionMiddleware)
# Inside CORS: adds X-AI-Credits-Used to AI responses (credits that request charged).
from src.core.middleware.ai_credits import AICreditsHeaderMiddleware  # noqa: E402

app.add_middleware(AICreditsHeaderMiddleware)
# Platform support sessions (impersonation): refuses what an impersonated
# request may never do before any route runs, inside CORS so the 403 is readable.
from src.security.impersonation import ImpersonationGateMiddleware, install_orm_scope  # noqa: E402

app.add_middleware(ImpersonationGateMiddleware)
install_orm_scope()
configure_cors(app)
# Wraps the API's CORS: origins it doesn't trust get credential-less CORS, so
# apps on other domains can call the API with a bearer token (embed sessions).
if bearer_cors_enabled():
    app.add_middleware(BearerCORSMiddleware)
# compresslevel 9 costs several times the CPU of 6 for a couple of percent on
# JSON; 6 is gzip's own default.
app.add_middleware(SelectiveGZipMiddleware, minimum_size=1000, compresslevel=6)
register_ee_middlewares(app)

# MCP server for external AI apps, plus the OAuth server MCP clients sign in
# through. Mounted on the root app so v1 router dependencies don't interfere.
# The session manager's lifecycle is driven from startup_app/shutdown_app via
# app.state.mcp_session_manager (mounted sub-apps get no lifespan).
if learnhouse_config.mcp_config.enabled:
    from src.core.middleware.mcp_cors import PublicCORSMiddleware
    from src.routers.mcp_oauth import public_router as mcp_oauth_public_router
    from src.security.mcp_auth import MCPAuthMiddleware
    from src.services.mcp.server import MCPASGIApp, build_mcp_session_manager

    _mcp_session_manager = build_mcp_session_manager()
    app.state.mcp_session_manager = _mcp_session_manager
    _mcp_app = MCPAuthMiddleware(MCPASGIApp(_mcp_session_manager))
    # A plain route on both spellings: a Mount would 307 "/mcp" to "/mcp/",
    # and not every client follows a redirect on POST.
    app.add_route("/mcp", _mcp_app, methods=["GET", "POST", "DELETE", "OPTIONS"])
    app.add_route("/mcp/", _mcp_app, methods=["GET", "POST", "DELETE", "OPTIONS"])
    app.include_router(mcp_oauth_public_router)
    # The platform (superadmin) MCP server at /mcp/platform, EE only.
    from src.core.ee_hooks import register_ee_platform_mcp

    register_ee_platform_mcp(app)
    # Outermost: answers CORS for these public paths before the API's own CORS.
    app.add_middleware(PublicCORSMiddleware)

# Content delivery: S3-aware router when S3 is enabled, local otherwise.
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
