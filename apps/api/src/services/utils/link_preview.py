import asyncio

import httpx
from bs4 import BeautifulSoup, Tag
from typing import Optional, Dict
from urllib.parse import urljoin, urlparse
from fastapi import HTTPException

from src.services.utils.ssrf_guard import (
    SSRFBlockedError,
    assert_connected_peer_allowed,
    resolve_and_validate_url,
)

_MAX_RESPONSE_SIZE = 5 * 1024 * 1024  # 5MB
_MAX_REDIRECTS = 5
# httpx timeouts are per socket operation: a slow-drip chunked body satisfies
# them forever, so the whole fetch also gets a wall-clock budget.
_SOCKET_TIMEOUT = 10
_TOTAL_TIMEOUT = 20

# Many sites (Cloudflare, Akamai, WAFs) return 403 to non-browser UAs.
_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def _minimal_preview(url: str) -> Dict[str, Optional[str]]:
    parsed = urlparse(url)
    favicon = (
        f"{parsed.scheme}://{parsed.netloc}/favicon.ico"
        if parsed.scheme and parsed.netloc
        else None
    )
    return {
        "title": None,
        "description": None,
        "og_image": None,
        "favicon": favicon,
        "og_type": None,
        "og_url": url,
        "url": url,
    }


async def _read_capped_text(response: httpx.Response) -> str:
    """Read at most ``_MAX_RESPONSE_SIZE`` bytes of a streamed body.

    Leaving the iterator early aborts the transfer: the surrounding
    ``client.stream`` context closes the connection on exit, so an attacker
    serving an endless (or endlessly chunked) body is cut off at the cap
    instead of being buffered whole.
    """
    chunks = []
    total = 0
    async for chunk in response.aiter_bytes():
        chunks.append(chunk)
        total += len(chunk)
        if total >= _MAX_RESPONSE_SIZE:
            break

    body = b"".join(chunks)[:_MAX_RESPONSE_SIZE]
    encoding = response.charset_encoding or "utf-8"
    try:
        return body.decode(encoding, errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")


async def _fetch_html(url: str) -> Optional[str]:
    """Fetch ``url`` and return its HTML, or ``None`` when there is nothing to parse.

    Redirects are followed manually so every hop is SSRF-validated, and the body
    is streamed under a hard byte cap — status, Content-Type and Content-Length
    are all decided from the headers, before a single body byte is consumed.
    """
    async with httpx.AsyncClient(
        follow_redirects=False,
        timeout=_SOCKET_TIMEOUT,
        max_redirects=0,
        headers=_BROWSER_HEADERS,
    ) as client:
        current_url = url
        for _ in range(_MAX_REDIRECTS + 1):
            # Resolve and check the exact value about to be requested, on every
            # hop including the first. Validating the initial URL further up and
            # only re-checking redirects here left the guard a loop iteration
            # away from the request it protects.
            try:
                validated_ips = resolve_and_validate_url(current_url)
            except SSRFBlockedError as exc:
                raise HTTPException(status_code=400, detail=str(exc))

            try:
                async with client.stream("GET", current_url) as response:
                    try:
                        assert_connected_peer_allowed(response, validated_ips)
                    except SSRFBlockedError as exc:
                        raise HTTPException(status_code=400, detail=str(exc))

                    if response.is_redirect:
                        redirect_url = (
                            str(response.next_request.url)
                            if response.next_request
                            else None
                        )
                        if not redirect_url:
                            return None
                        current_url = redirect_url
                        continue

                    # Non-success upstream → no HTML; the caller renders a
                    # URL-only card instead of showing a hard error.
                    if response.status_code >= 400:
                        return None

                    # Reject anything that declares itself too large; a hint
                    # only, since servers may omit or lie about Content-Length.
                    content_length = response.headers.get("content-length")
                    if content_length:
                        try:
                            if int(content_length) > _MAX_RESPONSE_SIZE:
                                return None
                        except ValueError:
                            pass

                    # Skip non-HTML payloads (PDFs, images, JSON, …) unread.
                    content_type = response.headers.get("content-type", "").lower()
                    if content_type and not (
                        "html" in content_type or "xml" in content_type
                    ):
                        return None

                    try:
                        return await _read_capped_text(response)
                    except Exception:
                        return None
            except httpx.HTTPError:
                return None

    return None


async def fetch_link_preview(url: str) -> Dict[str, Optional[str]]:
    try:
        html = await asyncio.wait_for(_fetch_html(url), timeout=_TOTAL_TIMEOUT)
    except asyncio.TimeoutError:
        return _minimal_preview(url)

    if html is None:
        return _minimal_preview(url)

    try:
        soup = BeautifulSoup(html, "html.parser")
    except Exception:
        return _minimal_preview(url)

    def get_meta(property_name: str, attr: str = "property") -> Optional[str]:
        tag = soup.find("meta", attrs={attr: property_name})
        if tag and isinstance(tag, Tag) and tag.has_attr("content"):
            content = tag["content"]
            if isinstance(content, str):
                stripped = content.strip()
                return stripped or None
        return None

    raw_title = (
        soup.title.string.strip() if soup.title and soup.title.string else None
    )
    title = " ".join(raw_title.split()) if raw_title else None

    description = (
        get_meta("og:description")
        or get_meta("twitter:description", "name")
        or get_meta("twitter:description")
        or get_meta("description", "name")
    )

    og_image = (
        get_meta("og:image")
        or get_meta("og:image:url")
        or get_meta("twitter:image", "name")
        or get_meta("twitter:image")
    )
    if og_image and not og_image.startswith("http"):
        og_image = urljoin(url, og_image)

    favicon = None
    icon_rels = {
        "icon",
        "shortcut icon",
        "apple-touch-icon",
        "apple-touch-icon-precomposed",
    }
    for link in soup.find_all("link"):
        if not isinstance(link, Tag):
            continue
        rels = link.get("rel")
        href = link.get("href")
        if rels and href:
            rels_lower = [r.lower() for r in rels]
            if any(rel in rels_lower for rel in icon_rels):
                if isinstance(href, str):
                    favicon = href
                    break

    if not favicon:
        parsed = urlparse(url)
        favicon = f"{parsed.scheme}://{parsed.netloc}/favicon.ico"
    elif not favicon.startswith("http"):
        favicon = urljoin(url, favicon)

    og_title = get_meta("og:title") or get_meta("twitter:title", "name")
    og_type = get_meta("og:type")
    og_url = get_meta("og:url")

    return {
        "title": og_title or title,
        "description": description,
        "og_image": og_image,
        "favicon": favicon,
        "og_type": og_type,
        "og_url": og_url or url,
        "url": url,
    }
