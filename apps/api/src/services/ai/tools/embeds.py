"""Paste a link, get the right embed: the server twin of the editor's
apps/web/components/Objects/Editor/Blocks/embeds/embedProviders.ts.

`parse_embed` turns a share or watch URL from a known service into the URL its
iframe player expects plus a frame shape, exactly like the editor does when an
author pastes the link, so a blockEmbed written by a tool renders the same as
one an author made. Unknown links return None (callers iframe them as given).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, quote, urlsplit

PROVIDERS = (
    "youtube", "vimeo", "loom", "figma", "google-docs", "google-sheets", "google-slides",
    "google-forms", "google-drive", "google-maps", "codepen", "codesandbox", "spotify",
    "soundcloud", "miro", "canva", "desmos", "geogebra",
)

# One example per provider, for the block catalog and tests.
EXAMPLES = {
    "youtube": "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    "vimeo": "https://vimeo.com/76979871",
    "loom": "https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184",
    "figma": "https://www.figma.com/design/abc123/Wireframes",
    "google-docs": "https://docs.google.com/document/d/1AbC/edit",
    "google-sheets": "https://docs.google.com/spreadsheets/d/1AbC/edit",
    "google-slides": "https://docs.google.com/presentation/d/1AbC/edit",
    "google-forms": "https://docs.google.com/forms/d/1AbC/viewform",
    "google-drive": "https://drive.google.com/file/d/1AbC/view",
    "google-maps": "https://www.google.com/maps/embed?pb=!1m18",
    "codepen": "https://codepen.io/team/pen/abcXYZ",
    "codesandbox": "https://codesandbox.io/s/react-new",
    "spotify": "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
    "soundcloud": "https://soundcloud.com/artist/track",
    "miro": "https://miro.com/app/board/uXjVO123=/",
    "canva": "https://www.canva.com/design/DAF123/view",
    "desmos": "https://www.desmos.com/calculator/abc123",
    "geogebra": "https://www.geogebra.org/m/abc123",
}

_YT = re.compile(
    r"^(?:https?://)?(?:www\.|m\.)?(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|live/|v/)|youtu\.be/)"
    r"([A-Za-z0-9_-]{11})"
)
_VIMEO = re.compile(r"^https?://(?:www\.|player\.)?vimeo\.com/(?:video/)?(\d{6,12})")
_YT_TIME = re.compile(r"^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$")


@dataclass(frozen=True)
class ParsedEmbed:
    provider: str
    label: str
    embed_url: str
    # width / height; None means a fixed pixel height.
    aspect: float | None
    height: int | None
    source_url: str

    def attrs(self) -> dict:
        """blockEmbed attrs, as the editor's embedAttrsFor() stores them."""
        return {
            "embedType": "url",
            "embedUrl": self.embed_url,
            "embedSourceUrl": self.source_url,
            "embedProvider": self.provider,
            "embedAspectRatio": self.aspect,
            "embedHeight": self.height or 300,
        }


def normalize_url(value: str) -> str | None:
    raw = (value or "").strip()
    if not raw or any(c.isspace() for c in raw):
        return None
    if not re.match(r"^[a-z][a-z0-9+.-]*:", raw, re.I):
        raw = f"https://{raw}"
    try:
        u = urlsplit(raw)
    except ValueError:
        return None
    if u.scheme not in ("http", "https") or "." not in (u.hostname or ""):
        return None
    return raw


def youtube_seconds(value: str | None) -> int | None:
    """Seconds from YouTube's t / start params: 90, 90s, 1m30s, 1h2m3s."""
    if not value:
        return None
    if value.isdigit():
        return int(value)
    m = _YT_TIME.match(value)
    if not m or not any(m.groups()):
        return None
    h, mi, s = (int(x or 0) for x in m.groups())
    return h * 3600 + mi * 60 + s


def parse_embed(url: str) -> ParsedEmbed | None:
    source = normalize_url(url)
    if source is None:
        return None
    u = urlsplit(source)
    host = (u.hostname or "").lower().removeprefix("www.")
    path = u.path or "/"
    query = parse_qs(u.query)

    def make(provider: str, label: str, embed: str, aspect: float | None, height: int | None = None) -> ParsedEmbed:
        return ParsedEmbed(provider, label, embed, aspect, height, source)

    yt = _YT.match(source)
    if yt:
        start = youtube_seconds((query.get("t") or query.get("start") or [None])[0])
        params = "rel=0" + (f"&start={start}" if start else "")
        aspect = 9 / 16 if path.startswith("/shorts/") else 16 / 9
        return make("youtube", "YouTube", f"https://www.youtube.com/embed/{yt.group(1)}?{params}", aspect)
    vimeo = _VIMEO.match(source)
    if vimeo:
        # An unlisted video's private hash must survive the rewrite.
        ident = vimeo.group(1)
        parts = [p for p in path.split("/") if p]
        after = parts[parts.index(ident) + 1] if ident in parts and parts.index(ident) + 1 < len(parts) else ""
        h = (query.get("h") or [""])[0] or (after if re.fullmatch(r"[a-f0-9]{6,}", after, re.I) else "")
        suffix = f"?h={h}" if h and re.fullmatch(r"[a-z0-9]+", h, re.I) else ""
        return make("vimeo", "Vimeo", f"https://player.vimeo.com/video/{ident}{suffix}", 16 / 9)
    if host == "loom.com" and re.match(r"^/(share|embed)/", path):
        parts = path.split("/")
        if len(parts) > 2 and parts[2]:
            return make("loom", "Loom", f"https://www.loom.com/embed/{parts[2]}", 16 / 9)
    if host == "figma.com" and re.match(r"^/(file|design|proto|board|slides)/", path):
        target = source.replace("http://", "https://", 1)
        return make("figma", "Figma", f"https://www.figma.com/embed?embed_host=learnhouse&url={quote(target, safe='')}", 16 / 9)
    if host == "docs.google.com":
        m = re.match(r"^/(document|spreadsheets|presentation|forms)/d/(e/)?([\w-]+)", path)
        if m:
            kind, published, ident = m.groups()
            base = f"https://docs.google.com/{kind}/d/{'e/' if published else ''}{ident}"
            if kind == "presentation":
                return make("google-slides", "Google Slides", f"{base}/{'embed' if published else 'preview'}", 16 / 9)
            if kind == "forms":
                return make("google-forms", "Google Forms", f"{base}/viewform?embedded=true", None, 800)
            if kind == "spreadsheets":
                return make("google-sheets", "Google Sheets", f"{base}/{'pubhtml?widget=true' if published else 'preview'}", None, 560)
            return make("google-docs", "Google Docs", f"{base}/{'pub?embedded=true' if published else 'preview'}", None, 720)
    if host == "drive.google.com":
        m = re.match(r"^/file/d/([\w-]+)", path)
        if m:
            return make("google-drive", "Google Drive", f"https://drive.google.com/file/d/{m.group(1)}/preview", 4 / 3)
    if (host == "google.com" or host.endswith(".google.com")) and path.startswith("/maps/embed"):
        return make("google-maps", "Google Maps", source, 4 / 3)
    if host == "codepen.io":
        m = re.match(r"^/([\w-]+)/(?:pen|embed|full|details)/(\w+)", path)
        if m:
            return make("codepen", "CodePen", f"https://codepen.io/{m.group(1)}/embed/{m.group(2)}?default-tab=result", None, 420)
    if host == "codesandbox.io":
        m = re.match(r"^/(?:s|embed|p/sandbox|p/devbox)/([\w-]+)", path)
        if m:
            return make("codesandbox", "CodeSandbox", f"https://codesandbox.io/embed/{m.group(1)}", None, 500)
    if host == "open.spotify.com":
        m = re.match(r"^/(?:intl-[\w-]+/)?(track|album|playlist|episode|show|artist)/(\w+)", path)
        if m:
            compact = m.group(1) in ("track", "episode")
            return make("spotify", "Spotify", f"https://open.spotify.com/embed/{m.group(1)}/{m.group(2)}", None, 152 if compact else 352)
    if host == "soundcloud.com" and len([p for p in path.split("/") if p]) >= 2:
        return make(
            "soundcloud", "SoundCloud",
            f"https://w.soundcloud.com/player/?url={quote(source, safe='')}&visual=false", None, 166,
        )
    if host == "miro.com" and path.startswith("/app/board/"):
        rest = source.split("/app/board/", 1)[1]
        return make("miro", "Miro", f"https://miro.com/app/live-embed/{rest}", 4 / 3)
    if host == "canva.com" and "/design/" in path:
        return make("canva", "Canva", f"{source}{'&' if '?' in source else '?'}embed", 16 / 9)
    if host == "desmos.com" and path.startswith("/calculator"):
        return make("desmos", "Desmos", f"https://www.desmos.com{path}{'?' + u.query + '&' if u.query else '?'}embed", 4 / 3)
    if host == "geogebra.org":
        m = re.match(r"^/(?:m|material/show/id|classic)/(\w+)", path)
        if m:
            return make("geogebra", "GeoGebra", f"https://www.geogebra.org/material/iframe/id/{m.group(1)}", 4 / 3)
    return None
