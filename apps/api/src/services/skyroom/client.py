"""
Thin async client for the Skyroom web service.

Skyroom's API (https://data.skyroom.online/help/webservice.html) is a small
REST protocol where every request is a POST to

    {api_url}/skyroom/api/{api_key}

with a JSON body of the shape ``{"action": "<name>", "params": {...}}``. The
response is always HTTP 200 and a JSON body of either:

    {"ok": true,  "result": <value>}
    {"ok": false, "error_code": <int>, "error_message": "<fa text>"}

Because success and application errors both come back as HTTP 200, a non-200
status indicates a network/server (infrastructure) problem and is surfaced
separately from Skyroom "application" errors. The service enforces a 500
requests/minute rate limit which returns HTTP 503 — callers should treat that
as retryable/backoff.
"""

import logging
from typing import Any, Optional

import httpx

from config.config import get_learnhouse_config

logger = logging.getLogger(__name__)

# Generic Skyroom error codes (from the web-service docs).
SKYROOM_ERRORS = {
    10: "Web service is disabled.",
    11: "Web service key is invalid.",
    12: "Your request is not authorized.",
    13: "Your request is not valid.",
    14: "Your request failed.",
    15: "The requested data was not found.",
}


class SkyroomNotConfigured(Exception):
    """Raised when the Skyroom integration has no API key configured."""


class SkyroomError(Exception):
    """A Skyroom *application* error (ok: false). Carries the error_code so
    callers can distinguish e.g. 'not found' (15) from a generic failure."""

    def __init__(self, error_code: int, error_message: str):
        self.error_code = error_code
        self.error_message = error_message
        super().__init__(f"Skyroom error {error_code}: {error_message}")


class SkyroomTransportError(Exception):
    """A network/infrastructure error (DNS, timeout, SSL, non-200, rate limit).

    These are distinct from application errors and, per the Skyroom docs, must
    be logged and handled separately so they can be investigated.
    """


# Lazy singleton httpx client, configured from LearnHouse config.
_client: Optional[httpx.AsyncClient] = None
_client_key: Optional[str] = None
# The exact endpoint URL to POST to. Kept alongside the client because Skyroom
# rejects a trailing slash: posting to an httpx ``base_url`` with an empty path
# normalizes to ``.../{key}/`` (trailing slash) which Skyroom answers with 404.
# We therefore POST to this absolute URL directly instead of using base_url.
_endpoint: Optional[str] = None


def is_skyroom_enabled() -> bool:
    return get_learnhouse_config().skyroom_config is not None


def _get_client() -> tuple[httpx.AsyncClient, str]:
    global _client, _client_key, _endpoint

    cfg = get_learnhouse_config().skyroom_config
    if cfg is None or not cfg.api_key:
        raise SkyroomNotConfigured(
            "Skyroom integration is not configured. Set LEARNHOUSE_SKYROOM_API_KEY."
        )

    # The api key is part of the request path. If it (or the host) changed,
    # rebuild the client so we never POST to a stale endpoint. The previous
    # client is dropped here and closed by the shutdown hook / GC; we avoid
    # scheduling an aclose() task because _get_client may run outside a running
    # loop (e.g. first request setup).
    #
    # IMPORTANT: Skyroom returns 404 if the request path has a trailing slash.
    # We POST to this absolute endpoint directly (see ``call``) rather than
    # using it as an httpx ``base_url``, because a base_url + empty-path POST
    # normalizes to ``.../{key}/`` and breaks every call.
    endpoint = f"{cfg.api_url}/skyroom/api/{cfg.api_key}"
    if _client is not None and _client_key == endpoint:
        return _client, endpoint

    _client = httpx.AsyncClient(
        headers={
            "Content-Type": "application/json",
            "User-Agent": "LearnHouse-Skyroom/1.0",
        },
        timeout=15.0,
    )
    _client_key = endpoint
    _endpoint = endpoint
    return _client, endpoint


async def call(action: str, params: Optional[dict] = None) -> Any:
    """Invoke a Skyroom action and return its ``result``.

    Raises:
        SkyroomNotConfigured: integration disabled.
        SkyroomTransportError: network/infrastructure failure (non-200,
            timeout, DNS, SSL, rate limit).
        SkyroomError: Skyroom application error (ok: false).
    """
    client, endpoint = _get_client()
    payload: dict = {"action": action}
    if params:
        payload["params"] = params

    try:
        response = await client.post(endpoint, json=payload)
    except httpx.HTTPError as exc:
        # DNS, timeout, SSL, connection errors. Log for later investigation as
        # the Skyroom docs recommend.
        logger.warning("Skyroom transport error on action '%s': %s", action, exc)
        raise SkyroomTransportError(str(exc)) from exc

    if response.status_code != 200:
        # 503 = rate limit (500 req/min); any other non-200 is server/network.
        logger.warning(
            "Skyroom returned HTTP %s on action '%s'", response.status_code, action
        )
        raise SkyroomTransportError(
            f"Skyroom returned HTTP {response.status_code}"
        )

    try:
        data = response.json()
    except ValueError as exc:
        raise SkyroomTransportError("Skyroom returned a non-JSON response") from exc

    if not isinstance(data, dict) or "ok" not in data:
        raise SkyroomTransportError("Skyroom returned an unexpected response shape")

    if data.get("ok"):
        return data.get("result")

    error_code = int(data.get("error_code", 14))
    error_message = data.get("error_message") or SKYROOM_ERRORS.get(
        error_code, "Unknown Skyroom error."
    )
    raise SkyroomError(error_code, error_message)


async def close_skyroom_client() -> None:
    """Shutdown hook: close the singleton client if open."""
    global _client, _client_key, _endpoint
    if _client is not None:
        await _client.aclose()
        _client = None
        _client_key = None
        _endpoint = None


# ---------------------------------------------------------------------------
# Typed convenience wrappers around the raw actions used by the service layer.
# ---------------------------------------------------------------------------


async def get_services() -> list:
    return await call("getServices")


async def get_rooms() -> list:
    """List every room that exists on the configured Skyroom account.

    Returns the raw Skyroom room objects (id, service_id, name, title, status).
    Used to surface rooms that were created directly in Skyroom so they can be
    imported/adopted as local live classes.
    """
    result = await call("getRooms")
    return result if isinstance(result, list) else []


async def create_room(
    name: str,
    title: str,
    *,
    guest_login: bool = False,
    op_login_first: bool = True,
    max_users: Optional[int] = None,
) -> int:
    """Create a room and return its numeric Skyroom room id."""
    params: dict = {
        "name": name,
        "title": title,
        "guest_login": guest_login,
        "op_login_first": op_login_first,
    }
    if max_users is not None:
        params["max_users"] = max_users
    return int(await call("createRoom", params))


async def update_room(room_id: int, **fields) -> None:
    params = {"room_id": room_id, **{k: v for k, v in fields.items() if v is not None}}
    await call("updateRoom", params)


async def delete_room(room_id: int) -> None:
    await call("deleteRoom", {"room_id": room_id})


async def get_room(room_id: int) -> dict:
    return await call("getRoom", {"room_id": room_id})


async def get_room_url(room_id: int, language: str = "fa") -> str:
    return str(await call("getRoomUrl", {"room_id": room_id, "language": language}))


async def create_login_url(
    room_id: int,
    user_id: str,
    nickname: str,
    *,
    access: int = 1,
    concurrent: int = 1,
    language: str = "fa",
    ttl: int = 3600,
) -> str:
    """Build a direct, login-free join URL for a participant."""
    params = {
        "room_id": room_id,
        "user_id": user_id,
        "nickname": nickname,
        "access": access,
        "concurrent": concurrent,
        "language": language,
        "ttl": ttl,
    }
    return str(await call("createLoginUrl", params))
