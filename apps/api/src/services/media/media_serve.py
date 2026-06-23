"""
Authenticated serving of Library media file bytes.

The client never receives a direct storage URL — media bytes are streamed
through the API after an access check (see the /media/{uuid}/file endpoint).
Handles both filesystem and s3/R2 delivery, with HTTP Range support.
"""

from pathlib import Path

from botocore.exceptions import ClientError
from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.media.media import Media, MediaTypeEnum
from src.db.organizations import Organization
from src.services.courses.transfer.storage_utils import (
    get_content_delivery_type,
    get_s3_bucket_name,
    get_storage_client,
)

CHUNK_SIZE = 1024 * 1024  # 1MB

_MIME_TYPES = {
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.doc': 'application/msword', '.xls': 'application/vnd.ms-excel',
    '.ppt': 'application/vnd.ms-powerpoint', '.zip': 'application/zip',
}


def _mime_for(key: str) -> str:
    return _MIME_TYPES.get(Path(key).suffix.lower(), 'application/octet-stream')


async def _resolve_storage_key(db_session: AsyncSession, media: Media) -> str:
    """Return the relative storage key (under `content/`), randomized for new
    uploads (`media.storage_key`), or reconstructed for legacy rows."""
    key = getattr(media, 'storage_key', None)
    if key:
        return key
    if not media.file_id:
        raise HTTPException(status_code=404, detail="File not found")
    org = (
        await db_session.execute(select(Organization).where(Organization.id == media.org_id))
    ).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="File not found")
    return f"orgs/{org.org_uuid}/media/{media.media_uuid}/{media.file_id}"


def _headers(mime: str, is_public: bool) -> dict:
    cache = "public, max-age=86400" if is_public else "private, no-store"
    return {
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
        "Cache-Control": cache,
        "X-Content-Type-Options": "nosniff",
    }


def _parse_range(range_header: str, file_size: int):
    spec = range_header.replace('bytes=', '')
    if spec.startswith('-'):
        start = max(0, file_size - int(spec[1:]))
        end = file_size - 1
    elif spec.endswith('-'):
        start = int(spec[:-1])
        end = file_size - 1
    else:
        a, _, b = spec.partition('-')
        start = int(a)
        end = int(b) if b else file_size - 1
    start = max(0, min(start, file_size - 1))
    end = max(start, min(end, file_size - 1))
    return start, end


async def serve_media_file(
    request: Request,
    media: Media,
    db_session: AsyncSession,
    *,
    is_public: bool,
    head: bool = False,
) -> Response:
    """Stream (or HEAD) a media file's bytes after the caller has already
    authorized access. `is_public` only controls caching headers."""
    if media.media_type != MediaTypeEnum.UPLOAD:
        raise HTTPException(status_code=404, detail="This media has no file")

    rel_key = await _resolve_storage_key(db_session, media)
    mime = media.file_mime or _mime_for(rel_key)
    headers = _headers(mime, is_public)
    range_header = request.headers.get("range")

    if get_content_delivery_type() == "s3api":
        return _serve_s3(rel_key, mime, headers, range_header, head)
    return _serve_fs(rel_key, mime, headers, range_header, head)


def _serve_fs(rel_key, mime, headers, range_header, head):
    path = Path("content") / rel_key
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    file_size = path.stat().st_size
    if head:
        return Response(status_code=200, headers={**headers, "Content-Length": str(file_size)})
    if range_header:
        start, end = _parse_range(range_header, file_size)
        length = end - start + 1

        def stream():
            with open(path, 'rb') as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    data = f.read(min(CHUNK_SIZE, remaining))
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        return StreamingResponse(
            stream(), status_code=206, media_type=mime,
            headers={**headers, "Content-Range": f"bytes {start}-{end}/{file_size}", "Content-Length": str(length)},
        )
    # Full file — FileResponse handles efficient sending.
    return FileResponse(path=str(path), media_type=mime, headers=headers)


def _serve_s3(rel_key, mime, headers, range_header, head):
    s3 = get_storage_client()
    bucket = get_s3_bucket_name()
    if not s3:
        raise HTTPException(status_code=500, detail="Storage not configured")
    s3_key = f"content/{rel_key}"
    try:
        meta = s3.head_object(Bucket=bucket, Key=s3_key)
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code in ("NoSuchKey", "404"):
            raise HTTPException(status_code=404, detail="File not found")
        if code in ("AccessDenied", "403"):
            raise HTTPException(status_code=403, detail="Access denied")
        raise HTTPException(status_code=502, detail="Storage service error")
    except Exception:
        raise HTTPException(status_code=502, detail="Storage service error")

    file_size = meta['ContentLength']
    if head:
        return Response(status_code=200, headers={**headers, "Content-Length": str(file_size)})

    start, end = (0, file_size - 1)
    status = 200
    if range_header:
        start, end = _parse_range(range_header, file_size)
        status = 206
        headers = {**headers, "Content-Range": f"bytes {start}-{end}/{file_size}"}
    length = end - start + 1
    headers = {**headers, "Content-Length": str(length)}

    def stream():
        pos, remaining = start, length
        while remaining > 0:
            chunk_end = min(pos + CHUNK_SIZE - 1, end)
            resp = s3.get_object(Bucket=bucket, Key=s3_key, Range=f"bytes={pos}-{chunk_end}")
            try:
                data = resp['Body'].read()
            finally:
                resp['Body'].close()
            if not data:
                break
            remaining -= len(data)
            pos += len(data)
            yield data

    return StreamingResponse(stream(), status_code=status, media_type=mime, headers=headers)
