"""Media blocks from a URL: fetch a picture, video, audio file or PDF, store
it through the block upload services, and insert its block in a page.

Fetching an address a caller names is the risky part, so in order:
1. the caller's right to edit the page is checked before anything is fetched;
2. only http(s) on ports 80 and 443, no credentials in the URL; video pages
   (YouTube, Vimeo, ...) are pointed at embed blocks instead;
3. the host is resolved off the event loop and every address must be public
   (src/services/utils/ssrf_guard.py); the connection then goes to that
   checked address only (Host header and TLS name kept), so DNS cannot change
   between the check and the connect;
4. at most MAX_REDIRECTS redirects, each checked again from step 2;
5. a declared size over the cap is refused before reading; the body streams
   to a temporary file and stops at the cap; the whole fetch has a deadline;
6. the first bytes must match the kind asked for (the upload service checks
   the file again before storing it).

attach_media does the same for the images and media fences of page Markdown
(markdown.Media): the page is written first with links standing in, then the
files are fetched (a few at a time) and each link becomes its block.
"""

from __future__ import annotations

import ipaddress
import tempfile
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import parse_qs, urlsplit

import anyio
import httpx
from fastapi import HTTPException
from pydantic import BaseModel, Field
from starlette.datastructures import Headers, UploadFile

from src.security.rbac import AccessAction
from src.services.ai.tools import doc_ops as d
from src.services.ai.tools import markdown as md
from src.services.ai.tools import results
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
from src.services.ai.tools.content_edit import Path, load_editable, save
from src.services.blocks.block_types.audioBlock.audioBlock import create_audio_block
from src.services.blocks.block_types.imageBlock.imageBlock import create_image_block
from src.services.blocks.block_types.pdfBlock.pdfBlock import create_pdf_block
from src.services.blocks.block_types.videoBlock.videoBlock import create_video_block
from src.services.utils.ssrf_guard import (
    SSRFBlockedError,
    assert_connected_peer_allowed,
    resolve_and_validate_url,
)

MB = 1024 * 1024
MAX_MEDIA_PER_CALL = 20
FETCHES_AT_ONCE = 4
MAX_REDIRECTS = 3
DEADLINE_SECONDS = 60
ALLOWED_PORTS = (80, 443)
_USER_AGENT = "Mozilla/5.0 (compatible; LearnHouse/1.0; +https://www.learnhouse.app)"


@dataclass(frozen=True)
class MediaKind:
    node: str
    cap: int
    accept: str
    create: Any


KINDS: dict[str, MediaKind] = {
    "image": MediaKind("blockImage", 15 * MB, "image/*", create_image_block),
    "video": MediaKind("blockVideo", 200 * MB, "video/*", create_video_block),
    "audio": MediaKind("blockAudio", 30 * MB, "audio/*", create_audio_block),
    "pdf": MediaKind("blockPDF", 50 * MB, "application/pdf", create_pdf_block),
}

_EMBED_HOSTS = {
    "youtube.com": "youtube", "youtu.be": "youtube", "youtube-nocookie.com": "youtube",
    "vimeo.com": "vimeo", "loom.com": "loom", "dailymotion.com": "dailymotion",
    "figma.com": "figma", "codepen.io": "codepen", "canva.com": "canva",
}


# ─── URL checks ──────────────────────────────────────────────────────────────


def _embed_hint(url: str, host: str) -> str | None:
    base = host.removeprefix("www.").removeprefix("m.").removeprefix("player.")
    provider = _EMBED_HOSTS.get(base)
    if provider is None:
        return None
    embed = None
    if provider == "youtube":
        parts = urlsplit(url)
        video = parse_qs(parts.query).get("v", [None])[0] if base != "youtu.be" else parts.path.strip("/")
        if video:
            embed = f"https://www.youtube.com/embed/{video}"
    example = embed or "<the provider's embed URL>"
    return (
        f"That is a {provider} page, not a {'video file' if provider != 'figma' else 'file'}. Add it as an embed "
        f"instead: edit_activity_content with insert {{node: {{type: blockEmbed, attrs: "
        f"{{embedUrl: '{example}', embedType: '{provider}'}}}}}}."
    )


def check_url(url: str) -> tuple[str, int, str]:
    """(host, port, scheme) of a URL the fetcher may open, or HTTP 400."""
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        raise HTTPException(status_code=400, detail="That URL is not valid.")
    scheme = (parts.scheme or "").lower()
    if scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only http and https URLs can be fetched.")
    if parts.username or parts.password:
        raise HTTPException(status_code=400, detail="URLs with a user name or password are not fetched.")
    host = (parts.hostname or "").lower().rstrip(".")
    if not host:
        raise HTTPException(status_code=400, detail="That URL has no host.")
    port = port or (443 if scheme == "https" else 80)
    if port not in ALLOWED_PORTS:
        raise HTTPException(status_code=400, detail="Only the standard web ports (80 and 443) can be fetched.")
    hint = _embed_hint(url, host)
    if hint:
        raise HTTPException(status_code=400, detail=hint)
    return host, port, scheme


def _resolve(url: str) -> list[str]:
    """Public addresses for the URL's host (blocking: run in a thread)."""
    ips = resolve_and_validate_url(url)
    return sorted(ips, key=lambda ip: (ipaddress.ip_address(ip).version, ip))


# Test seams: the network transport and the connected-peer check.
def _transport() -> httpx.AsyncBaseTransport | None:
    return None


def _check_peer(response: httpx.Response, ip: str) -> None:
    assert_connected_peer_allowed(response, {ip})


# ─── content sniffing ────────────────────────────────────────────────────────


def sniff(head: bytes) -> tuple[str, str, str] | None:
    """(kind, mime, extension) from a file's first bytes."""
    if head.startswith(b"\xff\xd8\xff"):
        return "image", "image/jpeg", "jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image", "image/png", "png"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image", "image/gif", "gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image", "image/webp", "webp"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "audio", "audio/wav", "wav"
    if head.startswith(b"%PDF-"):
        return "pdf", "application/pdf", "pdf"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "video", "video/webm", "webm"
    if head.startswith(b"OggS"):
        return "audio", "audio/ogg", "ogg"
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in (b"M4A ", b"M4B "):
            return "audio", "audio/mp4", "m4a"
        return "video", "video/mp4", "mp4"
    if head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0):
        return "audio", "audio/mpeg", "mp3"
    return None


# ─── fetching ────────────────────────────────────────────────────────────────


@dataclass
class Fetched:
    file: Any          # SpooledTemporaryFile, rewound
    size: int
    mime: str
    ext: str
    url: str           # final URL after redirects


async def fetch(url: str, kind: str) -> Fetched:
    media = KINDS[kind]
    try:
        with anyio.fail_after(DEADLINE_SECONDS):
            return await _fetch(url, kind, media)
    except TimeoutError:
        raise HTTPException(status_code=400, detail=f"Fetching took longer than {DEADLINE_SECONDS} seconds.")
    except SSRFBlockedError:
        raise HTTPException(
            status_code=400,
            detail="That address is not allowed: it resolves to a private, local or reserved network.",
        )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch the URL ({type(e).__name__}).")


PAGE_CAP = 3 * MB


async def fetch_page(url: str) -> tuple[str, str, bool]:
    """(text, final URL, is_markdown) of a public web page or plain-text /
    Markdown file, through the same guarded
    fetcher as files (public addresses only, checked redirects, size cap)."""
    page = MediaKind("page", PAGE_CAP, "text/html,application/xhtml+xml", None)
    try:
        with anyio.fail_after(DEADLINE_SECONDS):
            return await _fetch(url, "page", page, read=_read_page)
    except TimeoutError:
        raise HTTPException(status_code=400, detail=f"Fetching took longer than {DEADLINE_SECONDS} seconds.")
    except SSRFBlockedError:
        raise HTTPException(
            status_code=400,
            detail="That address is not allowed: it resolves to a private, local or reserved network.",
        )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch the URL ({type(e).__name__}).")


async def _read_page(response: httpx.Response, url: str) -> tuple[str, str, bool]:
    declared = response.headers.get("content-type", "").split(";")[0].strip().lower()
    if declared not in ("text/html", "application/xhtml+xml", "text/plain", "text/markdown", ""):
        raise HTTPException(status_code=400, detail=f"That URL is not a web page ({declared}).")
    body = bytearray()
    async for chunk in response.aiter_bytes(64 * 1024):
        body += chunk
        if len(body) > PAGE_CAP:
            raise HTTPException(status_code=400, detail=f"The page is over the {PAGE_CAP // MB} MB limit.")
    encoding = response.encoding or "utf-8"
    text = bytes(body).decode(encoding, errors="replace")
    markdown = declared in ("text/plain", "text/markdown") or url.lower().endswith((".md", ".markdown", ".txt"))
    return text, url, markdown


async def _fetch(url: str, kind: str, media: MediaKind, read=None) -> Any:
    current = url
    async with httpx.AsyncClient(
        transport=_transport(), follow_redirects=False, timeout=httpx.Timeout(20.0), trust_env=False
    ) as client:
        for _hop in range(MAX_REDIRECTS + 1):
            host, port, scheme = check_url(current)
            ips = await anyio.to_thread.run_sync(_resolve, current)
            ip = ips[0]
            target = httpx.URL(current).copy_with(host=ip)
            default_port = 443 if scheme == "https" else 80
            headers = {
                "Host": host if port == default_port else f"{host}:{port}",
                "User-Agent": _USER_AGENT,
                "Accept": media.accept,
            }
            extensions = {"sni_hostname": host} if scheme == "https" else {}
            request = client.build_request("GET", target, headers=headers, extensions=extensions)
            response = await client.send(request, stream=True)
            try:
                _check_peer(response, ip)
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise HTTPException(status_code=400, detail="The server redirected without a location.")
                    current = str(httpx.URL(current).join(location))
                    continue
                if response.status_code >= 400:
                    raise HTTPException(
                        status_code=400, detail=f"The server answered {response.status_code} for that URL."
                    )
                if read is not None:
                    return await read(response, current)
                return await _read_body(response, kind, media, current)
            finally:
                await response.aclose()
        raise HTTPException(status_code=400, detail=f"More than {MAX_REDIRECTS} redirects; use the final URL.")


async def _read_body(response: httpx.Response, kind: str, media: MediaKind, url: str) -> Fetched:
    declared_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
    if declared_type in ("text/html", "application/xhtml+xml"):
        raise HTTPException(
            status_code=400,
            detail=(
                "That URL is a web page, not a file. Link the file itself, or for a video page "
                "insert a blockEmbed with edit_activity_content."
            ),
        )
    length = response.headers.get("content-length")
    if length and length.isdigit() and int(length) > media.cap:
        raise HTTPException(status_code=400, detail=f"The file is over the {media.cap // MB} MB limit for {kind}.")
    spool = tempfile.SpooledTemporaryFile(max_size=2 * MB)
    size = 0
    head = b""
    found = None
    try:
        async for chunk in response.aiter_bytes(64 * 1024):
            size += len(chunk)
            if size > media.cap:
                raise HTTPException(status_code=400, detail=f"The file is over the {media.cap // MB} MB limit for {kind}.")
            if found is None:
                head += chunk[: 64 - len(head)]
                if len(head) >= 16:
                    found = _expect(head, kind)
            spool.write(chunk)
        if found is None:
            found = _expect(head, kind)
    except BaseException:
        spool.close()
        raise
    spool.seek(0)
    _kind, mime, ext = found
    return Fetched(spool, size, mime, ext, url)


def _expect(head: bytes, kind: str) -> tuple[str, str, str]:
    found = sniff(head)
    if found is None or found[0] != kind:
        what = f"a {found[0]} file" if found else "not a supported file"
        raise HTTPException(
            status_code=400,
            detail=(
                f"The URL does not hold a {kind} file (it looks like {what}). Supported: "
                "images jpg/png/gif/webp, video mp4/webm, audio mp3/wav/ogg/m4a, pdf."
            ),
        )
    return found


# ─── tool ────────────────────────────────────────────────────────────────────


class AddMediaParams(BaseModel):
    activity_uuid: str = Field(..., min_length=1, max_length=100, description="The page (activity_...).")
    kind: Literal["image", "video", "pdf", "audio"] = Field(..., description="What the URL holds.")
    url: str = Field(
        ..., min_length=8, max_length=2048,
        description="Public http(s) URL of the file itself (jpg/png/gif/webp, mp4/webm, mp3/wav/ogg/m4a, pdf).",
    )
    caption: str | None = Field(None, max_length=500, description="Optional caption, added as a line under the block.")
    at: Literal["start", "end", "after"] = Field("end", description="Where to put the block.")
    path: Path | None = Field(None, description="With at=after: the block to put it after.")


def _node(kind: str, block: dict, extra: dict | None = None) -> dict:
    node_type = KINDS[kind].node
    attrs: dict[str, Any] = {"blockObject": block}
    if node_type == "blockImage":
        attrs.update({"size": {"width": 600}, "alignment": "center"})
    attrs.update(extra or {})
    return {"type": node_type, "attrs": attrs}


async def _store(ctx: ToolContext, kind: str, fetched: Fetched, activity_uuid: str) -> dict:
    try:
        upload = UploadFile(
            file=fetched.file,
            size=fetched.size,
            filename=f"{kind}.{fetched.ext}",
            headers=Headers({"content-type": fetched.mime}),
        )
        return jsonable(await KINDS[kind].create(ctx.request, upload, activity_uuid, ctx.db_session, ctx.user))
    finally:
        fetched.file.close()


def _caption(text: str) -> dict:
    return d.paragraph([d.text_node(text, [{"type": "italic"}])])


# ─── media from page Markdown ────────────────────────────────────────────────


def check_media(media: list[md.Media]) -> None:
    """Refuse the call before anything is written when a file cannot be
    fetched by its URL alone (wrong scheme or port, a video page, too many)."""
    if len(media) > MAX_MEDIA_PER_CALL:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{len(media)} images and media files in one call; the limit is {MAX_MEDIA_PER_CALL}. "
                "Write the rest in another call (mode=append) or with add_media_block."
            ),
        )
    for item in media:
        try:
            check_url(item.url)
        except HTTPException as e:
            raise HTTPException(status_code=400, detail=f"{item.kind.capitalize()} {item.url[:120]}: {e.detail}")


def media_reason(media: list[md.Media]) -> str | None:
    """Why the call needs approval for its files, or None without any."""
    if not media:
        return None
    hosts = sorted({urlsplit(item.url).hostname or "" for item in media})
    shown = ", ".join(hosts[:5]) + (f" and {len(hosts) - 5} more" if len(hosts) > 5 else "")
    n = len(media)
    return f"Fetches {n} file{'s' if n != 1 else ''} from outside links ({shown})."


async def attach_media(ctx: ToolContext, activity_uuid: str, media: list[md.Media]) -> dict | None:
    """Fetch and store each file, then swap its stand-in link in the page for
    the block (one new version). A file that fails keeps its link and is
    reported; the rest still go in."""
    if not media:
        return None
    fetched: list[Fetched | str | None] = [None] * len(media)
    limiter = anyio.Semaphore(FETCHES_AT_ONCE)

    async def one(k: int) -> None:
        async with limiter:
            try:
                fetched[k] = await fetch(media[k].url, media[k].kind)
            except HTTPException as e:
                fetched[k] = str(e.detail)

    try:
        async with anyio.create_task_group() as group:
            for k in range(len(media)):
                group.start_soon(one, k)
        page, doc = await load_editable(ctx, activity_uuid)
        top = doc.get("content") or []
        used: set[int] = set()
        swaps: list[tuple[int, list[dict], md.Media]] = []
        failed: list[dict] = []
        for k, item in enumerate(media):
            got = fetched[k]
            if isinstance(got, str):
                failed.append({"url": item.url, "kind": item.kind, "error": got})
                continue
            at = next((i for i, node in enumerate(top) if i not in used and node == item.node), None)
            if at is None:
                got.file.close()
                failed.append({"url": item.url, "kind": item.kind, "error": "its link was no longer on the page"})
                continue
            try:
                block = await _store(ctx, item.kind, got, page.uuid)
            except HTTPException as e:
                failed.append({"url": item.url, "kind": item.kind, "error": str(e.detail)})
                continue
            used.add(at)
            nodes = [_node(item.kind, block, item.attrs)]
            if item.caption:
                nodes.append(_caption(item.caption))
            swaps.append((at, nodes, item))
    finally:
        for got in fetched:
            if isinstance(got, Fetched):
                got.file.close()
    added: list[dict] = []
    if swaps:
        for at, nodes, _item in sorted(swaps, key=lambda s: s[0], reverse=True):
            top[at: at + 1] = nodes
        doc["content"] = top
        _before, version, _undo = await save(ctx, page, doc)
        for _at, nodes, item in swaps:
            added.append({"kind": item.kind, "url": item.url, "path": d.find_path(doc, nodes[0])})
    out: dict[str, Any] = {"added": added}
    if swaps:
        out["version_after"] = version
    if failed:
        out["failed"] = failed
        out["note"] = "Files that failed stay as links; add them later with add_media_block."
    return out


async def _add_media(ctx: ToolContext, p: AddMediaParams):
    if p.at == "after" and not p.path:
        raise HTTPException(status_code=400, detail="at=after needs the path of the block to follow.")
    page, doc = await load_editable(ctx, p.activity_uuid)
    if p.path:
        try:
            d.locate(doc, p.path)
        except d.PathError as e:
            raise HTTPException(status_code=400, detail=str(e))
    check_url(p.url)
    fetched = await fetch(p.url, p.kind)
    block = await _store(ctx, p.kind, fetched, page.uuid)

    # The fetch can take a while: insert into the page as it is now.
    await ctx.db_session.refresh(page.activity)
    page, doc = await load_editable(ctx, p.activity_uuid)
    node = _node(p.kind, block)
    nodes = [node]
    if p.caption:
        nodes.append(_caption(p.caption))
    editor = d.Editor(doc)
    try:
        # The media node points at the file just stored, so only the caption
        # goes through the strict check for new content.
        editor.insert(p.at, p.path if p.at == "after" else None, nodes, checked=nodes[1:])
        editor.check()
    except (d.PathError, d.DocError) as e:
        raise HTTPException(status_code=400, detail=f"The file was stored but the block could not be placed: {e}")
    before, after, undo = await save(ctx, page, doc)
    content = block.get("content") or {}
    out = results.changed(
        f"Added a {p.kind} block to '{page.activity.name}'.",
        activity=await page.ref(ctx),
        block={"type": node["type"], "path": d.find_path(doc, node)},
        media={
            "kind": "block",
            "uuid": block.get("block_uuid"),
            "file": content.get("file_name"),
            "bytes": fetched.size,
            "content_type": fetched.mime,
        },
        version_before=before,
        version_after=after,
    )
    if undo:
        out["undo"] = undo
    return out


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="add_media_block",
        title="Add media from URL",
        description=(
            "Fetch an image, video, audio file or PDF from a public URL, store it, and insert its "
            "block in a page (end, start, or after a path). Returns the new block's path. For "
            "YouTube or Vimeo pages use an embed block (edit_activity_content). Size caps: image "
            "15 MB, audio 30 MB, pdf 50 MB, video 200 MB."
        ),
        params_model=AddMediaParams,
        tier=ActionTier.EDIT,
        rights_bucket="activities",
        access_action=AccessAction.UPDATE,
        execute=_add_media,
        target_param="activity_uuid",
        target_kind="activity",
        open_world=True,
        approval=True,
        summarize=lambda p: f"Fetch the {p.kind} at {p.url} and add it to the page",
    ),
]
