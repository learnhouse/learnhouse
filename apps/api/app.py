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
import threading
import time

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


# When a lifespan handler raises, uvicorn logs the formatted traceback and then
# a constant line — both at ERROR on uvicorn.error, both promoted to Sentry
# events by LoggingIntegration below. Neither carries an exception interface, so
# Sentry groups every distinct cause into one constant-string issue with no
# stack trace, while the real exception is already captured on the same trace
# with mechanism=starlette. 2424 events of pure echo.
#
# uvicorn logs the bare traceback from BOTH lifespan paths (lifespan/on.py:121
# startup.failed and :134 shutdown.failed), so both constants are listed here:
# dropping the traceback but keeping "Application shutdown failed. Exiting."
# would just move the causeless constant-string issue onto the shutdown path.
_STARTUP_FAILURE_LOG = "Application startup failed. Exiting."
_SHUTDOWN_FAILURE_LOG = "Application shutdown failed. Exiting."
_LIFESPAN_FAILURE_LOGS = (_STARTUP_FAILURE_LOG, _SHUTDOWN_FAILURE_LOG)
_TRACEBACK_PREFIX = "Traceback (most recent call last):"

# The google-genai and pydantic-ai integrations capture at the SDK boundary, so
# a provider call that raises is reported as handled: no even when the app
# catches it, logs it first-party and returns a clean error — once per retry.
#
# Only DEPLETION is deduplicated here, not rate limiting. Google returns
# RESOURCE_EXHAUSTED (and the words "quota exceeded") for a per-minute RPM limit
# as well as for a spent balance, and an RPM limit is actionable — backoff,
# concurrency cap, quota increase — so those markers are deliberately NOT in
# this list. Depletion is the one class no code change resolves.
#
# And depletion is not silenced either: this org has already had a full AI
# outage from a depleted key, so it must keep an alerting surface. The rule
# THROTTLES rather than drops — the first capture in each window still reaches
# Sentry, later duplicates (the SDK captures once per call, and streaming
# endpoints call repeatedly) do not. The issue therefore still exists, still
# alerts, and stops being 3 events per request.
_FIRST_PARTY_HANDLED_MECHANISMS = ("google_genai", "pydantic_ai")
# Kept in step with src/services/ai/llm/provider.py's QUOTA_DEPLETION_MARKERS,
# which is what the app itself treats as a terminal refusal — the two lists are
# pinned together by a test rather than by an import, because an AI import error
# at app.py module scope would be a total API outage.
#
# It is the SAME list, element for element, not a subset: provider.py already
# excludes per-day/longer-window quota wording ("it is not a spent balance"),
# so there is nothing here for a subset to narrow. The test below asserts
# equality in both directions — a one-way subset check would let provider.py
# grow a marker that this file then failed to throttle on, which is the drift
# the pairing exists to catch.
_QUOTA_DEPLETED_MARKERS = (
    "credits are depleted",
    "insufficient_quota",
    "insufficient quota",
    "billing account",
    "billing limit",
)
_QUOTA_REPORT_INTERVAL_SECONDS = 900.0
_quota_report_lock = threading.Lock()
# The window is keyed, not global. Depletion is not one Sentry issue: in prod it
# is four (image generation, two on the activities endpoint, playground
# generation), and a single shared timestamp meant the first depletion of a
# window suppressed the first event of every OTHER issue — so a newly-opening
# issue could be delayed 15 minutes, or never open at all if the depletion
# cleared inside the window. That defeats the "depletion keeps an alerting
# surface" justification the whole rule rests on.
#
# The key is (transaction, exception type, mechanism). Be honest about what that
# is: before_send cannot see Sentry's server-side grouping, so this is an
# APPROXIMATION of it, deliberately on the coarse side. Two issues on the same
# endpoint with the same exception type (prod's 8C and 8D, which differ only by
# model) still share a bucket. What it does fix is the cross-endpoint case,
# which is three of the four.
#
# Cardinality is bounded by (routed transactions x exception types), but the map
# is capped anyway: a 404-ish transaction is whatever the router matched, and an
# unbounded dict on a before_send path is not worth the risk.
_QUOTA_REPORT_MAX_KEYS = 256
# Values are time.monotonic() stamps. Absence, not 0.0, means "never reported":
# monotonic() is uptime-based on Linux, so a 0.0 seed would suppress the FIRST
# depletion of every boot in the first 15 minutes.
_quota_last_reported_at: dict = {}


def _is_lifespan_failure_log_echo(event) -> bool:
    if event.get("exception"):
        return False
    if event.get("logger") != "uvicorn.error":
        return False
    message = (event.get("logentry") or {}).get("formatted") or event.get("message") or ""
    return message in _LIFESPAN_FAILURE_LOGS or message.startswith(_TRACEBACK_PREFIX)


def _is_provider_quota_depletion(event) -> bool:
    values = (event.get("exception") or {}).get("values") or []
    if not values:
        return False
    captured = values[-1]
    mechanism = (captured.get("mechanism") or {}).get("type")
    if mechanism not in _FIRST_PARTY_HANDLED_MECHANISMS:
        return False
    message = (captured.get("value") or "").lower()
    return any(marker in message for marker in _QUOTA_DEPLETED_MARKERS)


def _quota_throttle_key(event):
    """The bucket a depletion capture is throttled in. See the note above."""
    captured = ((event.get("exception") or {}).get("values") or [{}])[-1]
    return (
        event.get("transaction") or "",
        captured.get("type") or "",
        (captured.get("mechanism") or {}).get("type") or "",
    )


def _quota_report_is_due(key, now: float) -> bool:
    """One provider-depletion capture per window PER KEY reaches Sentry."""
    with _quota_report_lock:
        last = _quota_last_reported_at.get(key)
        if last is not None and now - last < _QUOTA_REPORT_INTERVAL_SECONDS:
            return False
        if (
            key not in _quota_last_reported_at
            and len(_quota_last_reported_at) >= _QUOTA_REPORT_MAX_KEYS
        ):
            # Drop the whole map rather than evict one entry: the only cost is
            # that the next capture of each key reports, which is the safe
            # direction — this rule must never be the reason an issue goes dark.
            _quota_last_reported_at.clear()
        _quota_last_reported_at[key] = now
        return True


def _before_send(event, hint):
    transaction = event.get("transaction") or ""
    if transaction in _HEALTH_TRANSACTIONS:
        return None
    if _is_lifespan_failure_log_echo(event):
        return None
    if _is_provider_quota_depletion(event) and not _quota_report_is_due(
        _quota_throttle_key(event), time.monotonic()
    ):
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
