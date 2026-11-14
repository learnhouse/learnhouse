"""Check whether external links still work, for the course audits.

Each URL is requested from the server the way the link preview does it:
every hop (redirects are followed by hand) is resolved and refused when it
points inside the network, and the connected peer is checked against the
resolved addresses. Bodies are never read. Results are kept for a while so
auditing several courses that share links checks each link once.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from src.services.utils.ssrf_guard import (
    SSRFBlockedError,
    assert_connected_peer_allowed,
    resolve_and_validate_url,
)

MAX_URLS = 150
CONCURRENCY = 8
TIMEOUT_SECONDS = 8.0
MAX_REDIRECTS = 4
CACHE_SECONDS = 600
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; LearnHouse link checker)"}
# The site answered but would not let a checker in: not proof it is broken.
_UNVERIFIED = {401, 403, 405, 429, 999}

_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _verdict(status: int | None, reason: str) -> dict[str, Any]:
    if status is not None and status < 400:
        return {"state": "ok", "status": status}
    if status in _UNVERIFIED:
        return {"state": "unverified", "status": status, "reason": reason}
    return {"state": "broken", "status": status, "reason": reason}


async def _request(client: httpx.AsyncClient, method: str, url: str) -> tuple[int | None, str]:
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        try:
            allowed = await asyncio.to_thread(resolve_and_validate_url, current)
        except SSRFBlockedError as e:
            if "resolve" in str(e).lower():
                return None, "the domain does not exist"
            return None, "skipped:internal address"
        try:
            async with client.stream(method, current) as response:
                try:
                    assert_connected_peer_allowed(response, allowed)
                except SSRFBlockedError:
                    return None, "skipped:internal address"
                if response.is_redirect and response.next_request is not None:
                    current = str(response.next_request.url)
                    continue
                return response.status_code, f"HTTP {response.status_code}"
        except httpx.TimeoutException:
            return None, "no answer (timed out)"
        except httpx.HTTPError as e:
            return None, f"could not connect ({type(e).__name__})"
    return None, "too many redirects"


async def _check_one(client: httpx.AsyncClient, url: str) -> dict[str, Any]:
    hit = _cache.get(url)
    if hit is not None and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    status, reason = await _request(client, "HEAD", url)
    if status in (403, 404, 405, 501) or (status is None and not reason.startswith(("skipped", "the domain"))):
        # Many servers refuse HEAD; ask again the normal way before judging.
        status, reason = await _request(client, "GET", url)
    result = {"state": "skipped", "reason": reason.split(":", 1)[1]} if reason.startswith("skipped:") else _verdict(status, reason)
    _cache[url] = (time.monotonic(), result)
    return result


async def check_links(urls: list[str]) -> dict[str, dict[str, Any]]:
    """{url: {state: ok|broken|unverified|skipped, status?, reason?}} for
    up to MAX_URLS distinct http(s) URLs (the rest are left out)."""
    wanted: list[str] = []
    for url in urls:
        if isinstance(url, str) and url.startswith(("http://", "https://")) and url not in wanted:
            wanted.append(url)
    wanted = wanted[:MAX_URLS]
    if not wanted:
        return {}
    gate = asyncio.Semaphore(CONCURRENCY)
    async with httpx.AsyncClient(
        follow_redirects=False, timeout=TIMEOUT_SECONDS, max_redirects=0, headers=_HEADERS
    ) as client:

        async def one(url: str) -> tuple[str, dict[str, Any]]:
            async with gate:
                return url, await _check_one(client, url)

        return dict(await asyncio.gather(*(one(u) for u in wanted)))
