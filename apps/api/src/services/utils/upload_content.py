import asyncio
import logging
from typing import Literal, Optional
import boto3
import botocore.config
from botocore.exceptions import BotoCoreError, ClientError
import os
from fastapi import HTTPException, UploadFile
from config.config import get_learnhouse_config
from src.security.file_validation import validate_upload
from src.services.utils.video_processing import ensure_faststart

logger = logging.getLogger(__name__)


_CONTENT_ROOT = "content"


def _safe_content_path(*parts: str) -> str:
    """Build a path under the content root and confirm (via realpath +
    commonpath) that user-supplied parts can't escape it. Returns the
    canonicalized absolute path; raises HTTP 400 on any traversal attempt."""
    for part in parts:
        if part is None or "\x00" in part or ".." in str(part).replace("\\", "/").split("/"):
            raise HTTPException(status_code=400, detail="Invalid file path")
    base_real = os.path.realpath(_CONTENT_ROOT)
    full_real = os.path.realpath(os.path.join(_CONTENT_ROOT, *parts))
    try:
        contained = full_real == base_real or os.path.commonpath([base_real, full_real]) == base_real
    except ValueError:
        contained = False
    if not contained:
        raise HTTPException(status_code=400, detail="Invalid file path")
    return full_real


def ensure_directory_exists(directory: str):
    if not os.path.exists(directory):
        os.makedirs(directory)


async def upload_file(
    file: UploadFile,
    directory: str,
    type_of_dir: Literal["orgs", "users"],
    uuid: str,
    allowed_types: list[str],
    filename_prefix: str,
    max_size: Optional[int] = None,
) -> str:
    """
    Secure file upload with validation.
    
    Args:
        file: The uploaded file
        directory: Target directory (e.g., "logos", "avatars")
        type_of_dir: "orgs" or "users"
        uuid: Organization or user UUID
        allowed_types: List of allowed file types ('image', 'video', 'document')
        filename_prefix: Prefix for the generated filename
        max_size: Maximum file size in bytes (optional)
        
    Returns:
        The saved filename
    """
    from uuid import uuid4
    from src.security.file_validation import get_safe_filename
    
    # Validate the file
    content_type, content = validate_upload(file, allowed_types, max_size)

    filename = get_safe_filename(
        file.filename, f"{uuid4()}_{filename_prefix}", content_type=content_type
    )
    
    # Save the file
    await upload_content(
        directory=directory,
        type_of_dir=type_of_dir,
        uuid=uuid,
        file_binary=content,
        file_and_format=filename,
        allowed_formats=None,  # Already validated
    )
    
    return filename


async def upload_content(
    directory: str,
    type_of_dir: Literal["orgs", "users"],
    uuid: str,  # org_uuid or user_uuid
    file_binary: bytes,
    file_and_format: str,
    allowed_formats: Optional[list[str]] = None,
):
    # Get Learnhouse Config
    learnhouse_config = get_learnhouse_config()

    file_format = file_and_format.split(".")[-1].strip().lower()

    # Get content delivery method
    content_delivery = learnhouse_config.hosting_config.content_delivery.type

    # Check if format file is allowed
    if allowed_formats:
        if file_format not in allowed_formats:
            raise HTTPException(
                status_code=400,
                detail=f"File format {file_format} not allowed",
            )

    # Canonicalize + containment-check the destination so a crafted filename or
    # directory can't escape the content root (prevents path traversal).
    safe_dir = _safe_content_path(type_of_dir, uuid, directory)
    ensure_directory_exists(safe_dir)
    safe_path = _safe_content_path(type_of_dir, uuid, directory, file_and_format)

    if content_delivery == "filesystem":
        # upload file to server
        with open(safe_path, "wb") as f:
            f.write(file_binary)
            f.close()
        # Move the MP4 index atom to the front so long videos stream/seek
        # smoothly over HTTP (no-op for non-MP4 and when ffmpeg is absent).
        # Runs in a thread — the ffmpeg subprocess must not block the event loop.
        await asyncio.to_thread(ensure_faststart, safe_path)

    elif content_delivery == "s3api":
        s3 = boto3.client(
            "s3",
            endpoint_url=learnhouse_config.hosting_config.content_delivery.s3api.endpoint_url,
            config=botocore.config.Config(connect_timeout=10, read_timeout=60, retries={"max_attempts": 2}),
        )

        bucket_name = learnhouse_config.hosting_config.content_delivery.s3api.bucket_name or "learnhouse-media"
        local_path = safe_path
        # The S3 key stays a clean relative content path.
        s3_key = f"content/{type_of_dir}/{uuid}/{directory}/{file_and_format}"

        # Write to local temp file for S3 upload
        with open(local_path, "wb") as f:
            f.write(file_binary)

        # Move the MP4 index atom to the front before uploading so long videos
        # stream/seek smoothly from R2 (no-op for non-MP4 and when ffmpeg is
        # absent). Done on the temp file so the uploaded object is faststart.
        # Threaded — the ffmpeg subprocess must not block the event loop.
        await asyncio.to_thread(ensure_faststart, local_path)

        try:
            await asyncio.to_thread(s3.upload_file, local_path, bucket_name, s3_key)
            await asyncio.to_thread(s3.head_object, Bucket=bucket_name, Key=s3_key)
            logger.debug("S3 upload successful: %s", s3_key)
        except (ClientError, BotoCoreError) as e:
            logger.error("S3 upload failed: %s", e)
            raise HTTPException(status_code=500, detail="File upload to storage failed")
        finally:
            # Clean up local temp file after S3 upload
            try:
                os.remove(local_path)
            except OSError as cleanup_err:
                logger.error("Failed to clean up temp file %s: %s", local_path, cleanup_err)
