"""Asset-block tools — add image / video / PDF / audio blocks to an activity.

Unlike prose blocks, media blocks reference an uploaded file via a
`blockObject`, so they can't be authored as plain JSON. These tools fetch a
file from a URL (SSRF-guarded, size-capped), upload it through the existing
block services, then append the corresponding node to the activity's
content document.
"""

from __future__ import annotations

import io
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, Field
from starlette.datastructures import Headers, UploadFile

from src.security.rbac import AccessAction
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
from src.services.blocks.block_types.audioBlock.audioBlock import create_audio_block
from src.services.blocks.block_types.imageBlock.imageBlock import create_image_block
from src.services.blocks.block_types.pdfBlock.pdfBlock import create_pdf_block
from src.services.blocks.block_types.videoBlock.videoBlock import create_video_block
from src.services.courses.activities.activities import get_activity, update_activity
from src.services.utils.ssrf_guard import SSRFBlockedError, resolve_and_validate_url
from src.db.courses.activities import ActivityUpdate

# (allowed extensions, content-type prefix, byte cap) per asset kind.
_IMAGE = (("jpg", "jpeg", "png", "gif", "webp"), "image/", 15 * 1024 * 1024)
_VIDEO = (("mp4", "webm"), "video/", 200 * 1024 * 1024)
_PDF = (("pdf",), "application/pdf", 50 * 1024 * 1024)
_AUDIO = (("mp3", "wav", "ogg", "m4a"), "audio/", 30 * 1024 * 1024)


async def _fetch(url: str, allowed_exts, ctype_prefix, cap) -> tuple[bytes, str]:
    """SSRF-guarded download; returns (bytes, extension). Enforces size cap
    and that the extension/content-type matches the asset kind."""
    try:
        resolve_and_validate_url(url)
    except SSRFBlockedError as e:
        raise HTTPException(status_code=400, detail=f"Blocked URL: {e}")

    path = urlparse(url).path
    ext = path.rsplit(".", 1)[-1].lower() if "." in path.rsplit("/", 1)[-1] else ""

    # Browser-like UA so hosts that block bare clients (Wikimedia, some CDNs)
    # still serve the asset.
    ua = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
        "Accept": "*/*",
    }
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=60, headers=ua) as client:
            async with client.stream("GET", url) as resp:
                if resp.status_code >= 400:
                    raise HTTPException(status_code=400, detail=f"Could not fetch URL ({resp.status_code})")
                ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()
                if not ext:
                    # derive extension from content-type when the URL has none
                    ext = {"image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
                           "image/webp": "webp", "application/pdf": "pdf", "video/mp4": "mp4",
                           "video/webm": "webm", "audio/mpeg": "mp3", "audio/wav": "wav",
                           "audio/ogg": "ogg"}.get(ctype, "")
                if ext not in allowed_exts:
                    raise HTTPException(status_code=400, detail=f"Unsupported file type '.{ext or ctype}'. Allowed: {', '.join(allowed_exts)}")
                if ctype and not ctype.startswith(ctype_prefix):
                    raise HTTPException(status_code=400, detail=f"URL content-type '{ctype}' does not match the expected asset kind")
                buf = bytearray()
                async for chunk in resp.aiter_bytes():
                    buf.extend(chunk)
                    if len(buf) > cap:
                        raise HTTPException(status_code=400, detail=f"File exceeds the {cap // (1024*1024)}MB limit")
    except httpx.HTTPError as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch URL: {e}")
    return bytes(buf), ext


def _upload_file(data: bytes, ext: str, ctype: str) -> UploadFile:
    return UploadFile(
        file=io.BytesIO(data),
        size=len(data),
        filename=f"asset.{ext}",
        headers=Headers({"content-type": ctype}),
    )


async def _append_node(ctx: ToolContext, activity_uuid: str, node: dict) -> dict:
    """Append a block node to the activity's content doc and persist it."""
    activity = await get_activity(ctx.request, activity_uuid, ctx.user, ctx.db_session)
    data = jsonable(activity)
    content = data.get("content") or {}
    if not isinstance(content, dict) or content.get("type") != "doc":
        content = {"type": "doc", "content": []}
    content.setdefault("content", []).append(node)
    updated = await update_activity(
        ctx.request, ActivityUpdate(content=content), activity_uuid, ctx.user, ctx.db_session
    )
    return jsonable(updated)


# ─── params ────────────────────────────────────────────────────────────────


class AddImageParams(BaseModel):
    activity_uuid: str
    image_url: str = Field(..., description="Public URL of a jpg/png/gif/webp image")
    alignment: str = Field("center", description="left | center | right")
    size: str = Field("medium", description="small | medium | large")
    confirm: bool | None = None


class AddVideoParams(BaseModel):
    activity_uuid: str
    video_url: str = Field(..., description="Public URL of an mp4/webm video")
    confirm: bool | None = None


class AddPdfParams(BaseModel):
    activity_uuid: str
    pdf_url: str = Field(..., description="Public URL of a PDF file")
    confirm: bool | None = None


class AddAudioParams(BaseModel):
    activity_uuid: str
    audio_url: str = Field(..., description="Public URL of an mp3/wav/ogg/m4a audio file")
    confirm: bool | None = None


# ─── executors ─────────────────────────────────────────────────────────────


async def _add_image(ctx: ToolContext, p: AddImageParams):
    data, ext = await _fetch(p.image_url, *_IMAGE)
    block = await create_image_block(
        ctx.request, _upload_file(data, ext, f"image/{ext}"), p.activity_uuid,
        ctx.db_session, ctx.user,
    )
    node = {"type": "blockImage", "attrs": {"blockObject": jsonable(block),
            "size": p.size, "alignment": p.alignment}}
    return {"block_uuid": jsonable(block).get("block_uuid"),
            "activity": await _append_node(ctx, p.activity_uuid, node)}


async def _add_video(ctx: ToolContext, p: AddVideoParams):
    data, ext = await _fetch(p.video_url, *_VIDEO)
    block = await create_video_block(
        ctx.request, _upload_file(data, ext, f"video/{ext}"), p.activity_uuid,
        ctx.db_session, ctx.user,
    )
    node = {"type": "blockVideo", "attrs": {"blockObject": jsonable(block)}}
    return {"block_uuid": jsonable(block).get("block_uuid"),
            "activity": await _append_node(ctx, p.activity_uuid, node)}


async def _add_pdf(ctx: ToolContext, p: AddPdfParams):
    data, ext = await _fetch(p.pdf_url, *_PDF)
    block = await create_pdf_block(
        ctx.request, _upload_file(data, ext, "application/pdf"), p.activity_uuid,
        ctx.db_session, ctx.user,
    )
    node = {"type": "blockPDF", "attrs": {"blockObject": jsonable(block)}}
    return {"block_uuid": jsonable(block).get("block_uuid"),
            "activity": await _append_node(ctx, p.activity_uuid, node)}


async def _add_audio(ctx: ToolContext, p: AddAudioParams):
    data, ext = await _fetch(p.audio_url, *_AUDIO)
    block = await create_audio_block(
        ctx.request, _upload_file(data, ext, f"audio/{ext}"), p.activity_uuid,
        ctx.db_session, ctx.user,
    )
    node = {"type": "blockAudio", "attrs": {"blockObject": jsonable(block)}}
    return {"block_uuid": jsonable(block).get("block_uuid"),
            "activity": await _append_node(ctx, p.activity_uuid, node)}


def _spec(name, desc, model, execute):
    return ToolSpec(
        name=name, description=desc, params_model=model, tier=ActionTier.EDIT,
        rights_bucket="activities", access_action=AccessAction.UPDATE,
        execute=execute, target_param="activity_uuid", target_kind="activity",
    )


SPECS: list[ToolSpec] = [
    _spec("add_image_block",
          "Fetch an image from a public URL and append an image block to an activity.",
          AddImageParams, _add_image),
    _spec("add_video_block",
          "Fetch an mp4/webm video from a public URL and append a video block to an activity.",
          AddVideoParams, _add_video),
    _spec("add_pdf_block",
          "Fetch a PDF from a public URL and append a PDF block to an activity.",
          AddPdfParams, _add_pdf),
    _spec("add_audio_block",
          "Fetch an audio file from a public URL and append an audio block to an activity.",
          AddAudioParams, _add_audio),
]
