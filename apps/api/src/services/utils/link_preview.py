import httpx
from bs4 import BeautifulSoup, Tag
from typing import Optional, Dict
from urllib.parse import urljoin, urlparse

async def fetch_link_preview(url: str) -> Dict[str, Optional[str]]:
    async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
        response = await client.get(url)
        response.raise_for_status()
        html = response.text

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