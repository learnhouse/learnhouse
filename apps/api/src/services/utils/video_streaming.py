"""
Video Streaming Service

This module provides efficient video streaming with proper HTTP Range request handling
for seamless playback of long video files.

Supports both local filesystem and S3/R2 cloud storage.
"""

import os
from pathlib import Path
from typing import Generator, Tuple, Optional

from src.services.courses.transfer.storage_utils import (
    is_s3_enabled,
    get_storage_client,
    get_s3_bucket_name,
)


# Chunk size for streaming (1MB chunks for optimal performance)
CHUNK_SIZE = 1024 * 1024  # 1MB


def get_video_mime_type(file_path: str) -> str:
    """
    Get the MIME type for a video file based on its extension.

    Args:
        file_path: Path to the video file

    Returns:
        MIME type string (e.g., 'video/mp4')
    """
    extension = Path(file_path).suffix.lower()
    mime_types = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.ogg': 'video/ogg',
        '.ogv': 'video/ogg',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.aac': 'audio/aac',
        '.flac': 'audio/flac',
        '.m4a': 'audio/mp4',
    }
    return mime_types.get(extension, 'video/mp4')


def parse_range_header(range_header: Optional[str], file_size: int) -> Tuple[int, int]:
    """
    Parse the HTTP Range header to determine byte range.

    Args:
        range_header: The value of the Range header (e.g., 'bytes=0-1023')
        file_size: Total size of the file in bytes

    Returns:
        Tuple of (start_byte, end_byte)
    """
    if not range_header:
        return 0, file_size - 1

    try:
        # Parse "bytes=start-end" format
        range_spec = range_header.replace('bytes=', '')

        if range_spec.startswith('-'):
            # Suffix range: -500 means last 500 bytes
            suffix_length = int(range_spec[1:])
            start = max(0, file_size - suffix_length)
            end = file_size - 1
        elif range_spec.endswith('-'):
            # Open-ended range: 500- means from byte 500 to end
            start = int(range_spec[:-1])
            end = file_size - 1
        else:
            # Full range: 0-1023
            parts = range_spec.split('-')
            start = int(parts[0])
            end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1

        # Ensure valid range
        start = max(0, min(start, file_size - 1))
        end = max(start, min(end, file_size - 1))

        return start, end
    except (ValueError, IndexError):
        return 0, file_size - 1


def stream_video_file(
    file_path: str,
    start: int = 0,
    end: Optional[int] = None,
    chunk_size: int = CHUNK_SIZE
) -> Generator[bytes, None, None]:
    """
    Generator that yields chunks of a video file for streaming.
    Supports both local filesystem and S3 storage.

    Args:
        file_path: Path to the video file (local path or S3 key)
        start: Starting byte position
        end: Ending byte position (inclusive). If None, stream to end of file.
        chunk_size: Size of each chunk to yield

    Yields:
        Bytes chunks of the video file
    """
    if is_s3_enabled():
        yield from _stream_from_s3(file_path, start, end, chunk_size)
    else:
        yield from _stream_from_local(file_path, start, end, chunk_size)


def _stream_from_local(
    file_path: str,
    start: int = 0,
    end: Optional[int] = None,
    chunk_size: int = CHUNK_SIZE
) -> Generator[bytes, None, None]:
    """Stream from local filesystem."""
    file_size = os.path.getsize(file_path)

    if end is None:
        end = file_size - 1

    # Ensure end doesn't exceed file size
    end = min(end, file_size - 1)

    bytes_remaining = end - start + 1

    with open(file_path, 'rb') as video_file:
        video_file.seek(start)

        while bytes_remaining > 0:
            bytes_to_read = min(chunk_size, bytes_remaining)
            data = video_file.read(bytes_to_read)

            if not data:
                break

            bytes_remaining -= len(data)
            yield data


def _stream_from_s3(
    file_path: str,
    start: int = 0,
    end: Optional[int] = None,
    chunk_size: int = CHUNK_SIZE
) -> Generator[bytes, None, None]:
    """Stream from S3 using Range requests for efficient chunked delivery."""
    s3_client = get_storage_client()
    bucket = get_s3_bucket_name()

    if end is None:
        # Get file size first
        file_size, _, exists = get_file_info(file_path)
        if not exists:
            return
        end = file_size - 1

    bytes_remaining = end - start + 1
    current_pos = start

    while bytes_remaining > 0:
        chunk_end = min(current_pos + chunk_size - 1, end)
        range_str = f"bytes={current_pos}-{chunk_end}"

        response = s3_client.get_object(
            Bucket=bucket,
            Key=file_path,
            Range=range_str,
        )
        data = response['Body'].read()

        if not data:
            break

        bytes_remaining -= len(data)
        current_pos += len(data)
        yield data


def get_file_info(file_path: str) -> Tuple[int, str, bool]:
    """
    Get information about a video/audio file.
    Supports both local filesystem and S3 storage.

    Args:
        file_path: Path to the file (local path or S3 key)

    Returns:
        Tuple of (file_size, mime_type, exists)
    """
    mime_type = get_video_mime_type(file_path)

    if is_s3_enabled():
        return _get_file_info_s3(file_path, mime_type)
    else:
        return _get_file_info_local(file_path, mime_type)


def _get_file_info_local(file_path: str, mime_type: str) -> Tuple[int, str, bool]:
    """Get file info from local filesystem."""
    path = Path(file_path)

    if not path.exists() or not path.is_file():
        return 0, '', False

    file_size = path.stat().st_size
    return file_size, mime_type, True


def _get_file_info_s3(file_path: str, mime_type: str) -> Tuple[int, str, bool]:
    """Get file info from S3."""
    from botocore.exceptions import ClientError

    s3_client = get_storage_client()
    if not s3_client:
        return 0, '', False

    try:
        response = s3_client.head_object(
            Bucket=get_s3_bucket_name(),
            Key=file_path,
        )
        file_size = response['ContentLength']
        return file_size, mime_type, True
    except ClientError:
        return 0, '', False
    except Exception:
        return 0, '', False


def validate_video_path(base_content_dir: str, *path_parts: str) -> Optional[str]:
    """
    Validate and construct a safe file path within the content directory.

    This prevents directory traversal attacks.

    Args:
        base_content_dir: The base content directory
        path_parts: Path components to join

    Returns:
        Full validated path if safe, None otherwise
    """
    # Validate each path part to prevent directory traversal
    for part in path_parts:
        if '..' in part or part.startswith('/'):
            return None

    if is_s3_enabled():
        # For S3, return the relative key path (S3 keys use forward slashes)
        return '/'.join([base_content_dir] + list(path_parts))
    else:
        # For local filesystem, resolve to absolute path
        full_path = os.path.join(base_content_dir, *path_parts)

        try:
            resolved_path = os.path.realpath(full_path)
            base_resolved = os.path.realpath(base_content_dir)

            if not resolved_path.startswith(base_resolved):
                return None

            return resolved_path
        except (OSError, ValueError):
            return None
