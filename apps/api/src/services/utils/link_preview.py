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


async def fetch_link_preview(url: str) -> Dict[str, Optional[str]]:
    try:
        validated_ips = resolve_and_validate_url(url)
    except SSRFBlockedError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    async with httpx.AsyncClient(
        follow_redirects=False,
        timeout=10,
        max_redirects=0,
        headers=_BROWSER_HEADERS,
    ) as client:
        try:
            response = await client.get(url)
        except httpx.HTTPError:
            return _minimal_preview(url)

        try:
            assert_connected_peer_allowed(response, validated_ips)
        except SSRFBlockedError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        # Handle redirects manually to validate each hop
        redirect_count = 0
        while response.is_redirect and redirect_count < 5:
            redirect_count += 1
            redirect_url = (
                str(response.next_request.url) if response.next_request else None
            )
            if not redirect_url:
                break
            try:
                validated_ips = resolve_and_validate_url(redirect_url)
            except SSRFBlockedError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            try:
                response = await client.get(redirect_url)
            except httpx.HTTPError:
                return _minimal_preview(url)
            try:
                assert_connected_peer_allowed(response, validated_ips)
            except SSRFBlockedError as exc:
                raise HTTPException(status_code=400, detail=str(exc))

        # Non-success upstream → return a URL-only preview so the editor can
        # still render a basic card instead of showing a hard error.
        if response.status_code >= 400:
            return _minimal_preview(url)

        # Reject anything that is clearly too large; this is a hint only,
        # since servers may omit Content-Length.
        content_length = response.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > _MAX_RESPONSE_SIZE:
                    return _minimal_preview(url)
            except ValueError:
                pass

        # Skip parsing non-HTML payloads (PDFs, images, JSON, …).
        content_type = response.headers.get("content-type", "").lower()
        if content_type and not (
            "html" in content_type or "xml" in content_type
        ):
            return _minimal_preview(url)

        try:
            html = response.text[:_MAX_RESPONSE_SIZE]
        except Exception:
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
