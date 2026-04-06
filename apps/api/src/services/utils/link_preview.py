import ipaddress
import socket
import httpx
from bs4 import BeautifulSoup, Tag
from typing import Optional, Dict
from urllib.parse import urljoin, urlparse
from fastapi import HTTPException


# Private/internal IP ranges that should never be accessed
_BLOCKED_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("::ffff:0:0/96"),  # IPv4-mapped IPv6
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]

_MAX_RESPONSE_SIZE = 5 * 1024 * 1024  # 5MB


def _validate_url(url: str) -> str:
    """Validate URL to prevent SSRF attacks."""
    parsed = urlparse(url)

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only http and https URLs are allowed")

    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="Invalid URL: no hostname")

    hostname = parsed.hostname

    # Block obvious internal hostnames
    if hostname in ("localhost", "metadata.google.internal"):
        raise HTTPException(status_code=400, detail="URL points to a blocked host")

    # Resolve hostname and check against blocked IP ranges
    try:
        addr_infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="Could not resolve hostname")

    for _, _, _, _, sockaddr in addr_infos:
        ip = ipaddress.ip_address(sockaddr[0])
        # Normalize IPv4-mapped IPv6 addresses to their IPv4 equivalent
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        for network in _BLOCKED_NETWORKS:
            if ip in network:
                raise HTTPException(
                    status_code=400,
                    detail="URL points to a blocked address range",
                )

    return url


async def fetch_link_preview(url: str) -> Dict[str, Optional[str]]:
    validated_url = _validate_url(url)

    async with httpx.AsyncClient(
        follow_redirects=False,
        timeout=10,
        max_redirects=0,
    ) as client:
        response = await client.get(validated_url)

        # Handle redirects manually to validate each hop
        redirect_count = 0
        while response.is_redirect and redirect_count < 5:
            redirect_count += 1
            redirect_url = str(response.next_request.url) if response.next_request else None
            if not redirect_url:
                break
            _validate_url(redirect_url)
            response = await client.get(redirect_url)

        response.raise_for_status()

        # Limit response size
        content_length = response.headers.get("content-length")
        if content_length and int(content_length) > _MAX_RESPONSE_SIZE:
            raise HTTPException(status_code=400, detail="Response too large")

        html = response.text[:_MAX_RESPONSE_SIZE]

    soup = BeautifulSoup(html, 'html.parser')

    def get_meta(property_name: str, attr: str = 'property') -> Optional[str]:
        tag = soup.find('meta', attrs={attr: property_name})
        if tag and isinstance(tag, Tag) and tag.has_attr('content'):
            content = tag['content']
            if isinstance(content, str):
                return content
        return None

    # Title
    title = soup.title.string.strip() if soup.title and soup.title.string else None
    # Description
    description = get_meta('og:description') or get_meta('description', 'name')
    # OG Image
    og_image = get_meta('og:image')
    if og_image and isinstance(og_image, str) and not og_image.startswith('http'):
        og_image = urljoin(url, og_image)
    # Favicon (robust)
    favicon = None
    icon_rels = [
        'icon',
        'shortcut icon',
        'apple-touch-icon',
        'apple-touch-icon-precomposed',
    ]
    for link in soup.find_all('link'):
        if not isinstance(link, Tag):
            continue
        rels = link.get('rel')
        href = link.get('href')
        if rels and href:
            rels_lower = [r.lower() for r in rels]
            if any(rel in rels_lower for rel in icon_rels):
                if isinstance(href, str):
                    favicon = href
                    break
    # Fallback to /favicon.ico if not found
    if not favicon:
        parsed = urlparse(url)
        favicon = f"{parsed.scheme}://{parsed.netloc}/favicon.ico"
    elif favicon and not favicon.startswith('http'):
        favicon = urljoin(url, favicon)
    # OG Title
    og_title = get_meta('og:title')
    # OG Type
    og_type = get_meta('og:type')
    # OG URL
    og_url = get_meta('og:url')

    return {
        'title': og_title or title,
        'description': description,
        'og_image': og_image,
        'favicon': favicon,
        'og_type': og_type,
        'og_url': og_url or url,
        'url': url,
    }
