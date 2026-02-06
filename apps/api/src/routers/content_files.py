"""
Content Files Router

Serves static content files from S3 storage when S3 is enabled.
Replaces the StaticFiles mount for S3 deployments.
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse, Response
from pathlib import Path

from src.services.courses.transfer.storage_utils import (
    get_storage_client,
    get_s3_bucket_name,
)

router = APIRouter()

# MIME type mapping
MIME_TYPES = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.zip': 'application/zip',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.txt': 'text/plain',
}

CHUNK_SIZE = 1024 * 1024  # 1MB


def _get_mime_type(file_path: str) -> str:
    ext = Path(file_path).suffix.lower()
    return MIME_TYPES.get(ext, 'application/octet-stream')


def _validate_content_path(file_path: str) -> bool:
    """Prevent directory traversal."""
    if '..' in file_path or file_path.startswith('/'):
        return False
    return True


@router.get("/content/{file_path:path}")
async def serve_content_file(request: Request, file_path: str):
    """
    Serve content files from S3 storage.

    Supports HTTP Range requests for video/audio seeking.
    """
    s3_key = f"content/{file_path}"

    if not _validate_content_path(file_path):
        raise HTTPException(status_code=400, detail="Invalid path")

    s3_client = get_storage_client()
    bucket = get_s3_bucket_name()

    if not s3_client:
        raise HTTPException(status_code=500, detail="Storage not configured")

    # Get file metadata
    try:
        head = s3_client.head_object(Bucket=bucket, Key=s3_key)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")

    file_size = head['ContentLength']
    mime_type = _get_mime_type(file_path)

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": mime_type,
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
    }

    range_header = request.headers.get("range")

    if range_header:
        # Parse range
        try:
            range_spec = range_header.replace('bytes=', '')
            if range_spec.startswith('-'):
                suffix_length = int(range_spec[1:])
                start = max(0, file_size - suffix_length)
                end = file_size - 1
            elif range_spec.endswith('-'):
                start = int(range_spec[:-1])
                end = file_size - 1
            else:
                parts = range_spec.split('-')
                start = int(parts[0])
                end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1

            start = max(0, min(start, file_size - 1))
            end = max(start, min(end, file_size - 1))
        except (ValueError, IndexError):
            start, end = 0, file_size - 1

        content_length = end - start + 1
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
        headers["Content-Length"] = str(content_length)

        def stream_range():
            remaining = content_length
            pos = start
            while remaining > 0:
                chunk_end = min(pos + CHUNK_SIZE - 1, end)
                resp = s3_client.get_object(
                    Bucket=bucket, Key=s3_key,
                    Range=f"bytes={pos}-{chunk_end}",
                )
                data = resp['Body'].read()
                if not data:
                    break
                remaining -= len(data)
                pos += len(data)
                yield data

        return StreamingResponse(
            stream_range(),
            status_code=206,
            headers=headers,
            media_type=mime_type,
        )
    else:
        headers["Content-Length"] = str(file_size)

        def stream_full():
            remaining = file_size
            pos = 0
            while remaining > 0:
                chunk_end = min(pos + CHUNK_SIZE - 1, file_size - 1)
                resp = s3_client.get_object(
                    Bucket=bucket, Key=s3_key,
                    Range=f"bytes={pos}-{chunk_end}",
                )
                data = resp['Body'].read()
                if not data:
                    break
                remaining -= len(data)
                pos += len(data)
                yield data

        return StreamingResponse(
            stream_full(),
            status_code=200,
            headers=headers,
            media_type=mime_type,
        )


@router.head("/content/{file_path:path}")
async def head_content_file(file_path: str):
    """HEAD request for content files - returns metadata without body."""
    s3_key = f"content/{file_path}"

    if not _validate_content_path(file_path):
        raise HTTPException(status_code=400, detail="Invalid path")

    s3_client = get_storage_client()
    bucket = get_s3_bucket_name()

    if not s3_client:
        raise HTTPException(status_code=500, detail="Storage not configured")

    try:
        head = s3_client.head_object(Bucket=bucket, Key=s3_key)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")

    file_size = head['ContentLength']
    mime_type = _get_mime_type(file_path)

    return Response(
        status_code=200,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": mime_type,
            "Cache-Control": "public, max-age=86400",
        },
    )
