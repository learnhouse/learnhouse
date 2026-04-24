from __future__ import annotations

import logging
from typing import Any

import httpx

from .cache import TokenCache, TokenEntry
from .config import Settings
from .runtime import get_current_ctx

logger = logging.getLogger("learnhouse_mcp.client")


class LearnHouseAPIError(RuntimeError):
    """Raised for non-2xx responses. Carries status and a safe message for the LLM."""

    def __init__(self, status_code: int, message: str, body: Any = None):
        super().__init__(f"LearnHouse API {status_code}: {message}")
        self.status_code = status_code
        self.body = body


def _format_error(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except Exception:
        return response.text[:400] or f"HTTP {response.status_code}"

    if isinstance(payload, dict):
        detail = payload.get("detail") or payload.get("message") or payload
        if isinstance(detail, list):
            return "; ".join(str(d) for d in detail)[:600]
        return str(detail)[:600]
    return str(payload)[:600]


class LearnHouseClient:
    """Multi-tenant async client for the LearnHouse REST API.

    One instance per server process. The bearer token and org scope are pulled
    from a contextvar set by the auth middleware, so each inbound MCP request
    uses its own caller's credentials — the connection pool is shared, the
    identity is not.
    """

    def __init__(self, settings: Settings, token_cache: TokenCache):
        self._settings = settings
        self._cache = token_cache
        self._client = httpx.AsyncClient(
            base_url=f"{settings.api_url}/api/v1",
            headers={
                "Accept": "application/json",
                "User-Agent": "learnhouse-mcp/0.2",
            },
            timeout=httpx.Timeout(30.0, connect=10.0),
        )

    @property
    def org_slug(self) -> str:
        return get_current_ctx().org_slug

    @property
    def org_id(self) -> int:
        return get_current_ctx().org_id

    async def aclose(self) -> None:
        await self._client.aclose()

    async def resolve_token(self, token: str) -> TokenEntry:
        """Resolve a bearer token to its org scope, caching the result.

        Calls ``GET /auth/me`` on behalf of the caller. Rejects non-API-token
        principals (JWT sessions are not permitted for MCP access, since they
        are not org-scoped).
        """
        cached = self._cache.get(token)
        if cached is not None:
            return cached

        try:
            response = await self._client.get(
                "/auth/me",
                headers={"Authorization": f"Bearer {token}"},
            )
        except httpx.RequestError as exc:
            raise LearnHouseAPIError(
                0, f"Could not reach LearnHouse at {self._settings.api_url}: {exc}"
            ) from exc

        if response.status_code == 401:
            raise LearnHouseAPIError(401, "Invalid or revoked LearnHouse API token.")
        if response.status_code >= 400:
            raise LearnHouseAPIError(response.status_code, _format_error(response))

        data = response.json() if response.content else {}
        if not isinstance(data, dict):
            raise LearnHouseAPIError(502, "Unexpected response shape from /auth/me.")

        if not data.get("is_api_token"):
            raise LearnHouseAPIError(
                403,
                "This MCP server only accepts LearnHouse API tokens (Bearer lh_...). "
                "User session tokens are not accepted because they are not scoped to a "
                "single organization.",
            )

        org_id = data.get("org_id")
        org_slug = data.get("org_slug")
        if org_id is None or not org_slug:
            raise LearnHouseAPIError(
                500, "LearnHouse /auth/me returned no org scope for this token."
            )

        return self._cache.set(
            token,
            org_id=int(org_id),
            org_slug=str(org_slug),
            user_uuid=str(data.get("user_uuid", "")),
            token_name=str(data.get("token_name", "") or ""),
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        data: Any = None,
    ) -> Any:
        ctx = get_current_ctx()
        headers = {"Authorization": f"Bearer {ctx.token}"}
        logger.debug("%s %s params=%s org=%s", method, path, params, ctx.org_slug)
        try:
            response = await self._client.request(
                method, path, params=params, json=json, data=data, headers=headers
            )
        except httpx.RequestError as exc:
            raise LearnHouseAPIError(
                0,
                f"Could not reach LearnHouse at {self._settings.api_url}: {exc}",
            ) from exc

        if response.status_code == 401:
            self._cache.invalidate(ctx.token)

        if response.status_code >= 400:
            raise LearnHouseAPIError(
                response.status_code, _format_error(response), body=response.text
            )

        if not response.content:
            return None
        try:
            return response.json()
        except ValueError:
            return response.text

    async def get(self, path: str, **kwargs) -> Any:
        return await self._request("GET", path, **kwargs)

    async def post(self, path: str, **kwargs) -> Any:
        return await self._request("POST", path, **kwargs)

    async def put(self, path: str, **kwargs) -> Any:
        return await self._request("PUT", path, **kwargs)

    async def delete(self, path: str, **kwargs) -> Any:
        return await self._request("DELETE", path, **kwargs)

    async def post_form(self, path: str, form: dict[str, Any]) -> Any:
        """POST application/x-www-form-urlencoded. FastAPI Form() fields accept this
        as long as no File() uploads are required on the route."""
        return await self._request("POST", path, data=form)

    async def post_sse_collect(
        self, path: str, *, json: Any = None
    ) -> tuple[list[dict[str, Any]], str]:
        """
        POST to an SSE endpoint, consume the entire stream, and return
        (events, aggregated_chunk_text). Used to turn a streaming agent
        response into a single MCP tool result.
        """
        import json as _json

        ctx = get_current_ctx()
        headers = {
            "Authorization": f"Bearer {ctx.token}",
            "Accept": "text/event-stream",
        }
        events: list[dict[str, Any]] = []
        chunks: list[str] = []

        try:
            async with self._client.stream(
                "POST", path, json=json, headers=headers, timeout=httpx.Timeout(120.0)
            ) as response:
                if response.status_code >= 400:
                    body = await response.aread()
                    raise LearnHouseAPIError(
                        response.status_code,
                        body.decode("utf-8", errors="replace")[:600]
                        or f"HTTP {response.status_code}",
                    )
                buffer = ""
                async for raw in response.aiter_text():
                    buffer += raw
                    while "\n\n" in buffer:
                        block, buffer = buffer.split("\n\n", 1)
                        data_lines = [
                            line[6:]
                            for line in block.splitlines()
                            if line.startswith("data: ")
                        ]
                        if not data_lines:
                            continue
                        payload = "\n".join(data_lines)
                        try:
                            event = _json.loads(payload)
                        except ValueError:
                            continue
                        events.append(event)
                        if event.get("type") == "chunk" and isinstance(
                            event.get("content"), str
                        ):
                            chunks.append(event["content"])
        except httpx.RequestError as exc:
            raise LearnHouseAPIError(
                0, f"Could not reach LearnHouse at {self._settings.api_url}: {exc}"
            ) from exc

        return events, "".join(chunks)
