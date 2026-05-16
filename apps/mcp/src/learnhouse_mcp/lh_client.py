"""Thin async wrapper around the LearnHouse REST API.

Reads the per-request Bearer token from `auth.get_token()` (ContextVar set
by the auth middleware) and attaches it as `Authorization` on every call.
All routes are relative to `/api/v1`.

Tools should raise `AtlasToolError` rather than let HTTP errors bubble; the
helpers here translate common failure modes (404/403/401/422) into typed
codes the API can render to the user.
"""

from typing import Any

import httpx

from . import auth
from .config import Settings
from .errors import AtlasToolError

_client: httpx.AsyncClient | None = None


def _get_client(settings: Settings) -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=f"{settings.lh_api_url}/api/v1",
            timeout=settings.request_timeout,
        )
    return _client


async def close() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _translate_status(resp: httpx.Response) -> AtlasToolError:
    code_map = {
        401: "UNAUTHENTICATED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "VALIDATION_ERROR",
        422: "VALIDATION_ERROR",
    }
    code = code_map.get(resp.status_code, "LH_API_ERROR")
    try:
        body = resp.json()
        detail = body.get("detail") if isinstance(body, dict) else str(body)
    except Exception:
        detail = resp.text or f"HTTP {resp.status_code}"
    return AtlasToolError(
        code=code,
        message=str(detail) if detail else f"LH API returned {resp.status_code}",
        retriable=resp.status_code >= 500,
        details={"status": resp.status_code, "url": str(resp.request.url)},
    )


class LHClient:
    """Per-call helper. Authenticates via the ContextVar token."""

    def __init__(self, settings: Settings):
        self._settings = settings

    @property
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {auth.get_token()}"}

    async def get(self, path: str, *, params: dict[str, Any] | None = None) -> Any:
        client = _get_client(self._settings)
        resp = await client.get(path, params=params, headers=self._headers)
        if resp.is_error:
            raise _translate_status(resp)
        return resp.json()

    async def post(
        self,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        client = _get_client(self._settings)
        resp = await client.post(
            path, json=json, data=data, params=params, headers=self._headers
        )
        if resp.is_error:
            raise _translate_status(resp)
        return resp.json() if resp.content else None

    async def put(self, path: str, *, json: dict[str, Any] | None = None) -> Any:
        client = _get_client(self._settings)
        resp = await client.put(path, json=json, headers=self._headers)
        if resp.is_error:
            raise _translate_status(resp)
        return resp.json() if resp.content else None

    async def delete(self, path: str) -> Any:
        client = _get_client(self._settings)
        resp = await client.delete(path, headers=self._headers)
        if resp.is_error:
            raise _translate_status(resp)
        return resp.json() if resp.content else None
