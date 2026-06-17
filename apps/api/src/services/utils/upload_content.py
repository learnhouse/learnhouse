import logging
from typing import Literal, Optional
import boto3
import botocore.config
from botocore.exceptions import ClientError
import os
from fastapi import HTTPException, UploadFile
from config.config import get_learnhouse_config
from src.security.file_validation import validate_upload

logger = logging.getLogger(__name__)


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

    object_path = f"content/{type_of_dir}/{uuid}/{directory}/{file_and_format}"

    if content_delivery == "filesystem":
        # Local/self-hosted only. This writes under the working directory, which
        # is read-only on serverless runtimes (Vercel) — deploy with s3api there.
        ensure_directory_exists(f"content/{type_of_dir}/{uuid}/{directory}")
        with open(object_path, "wb") as f:
            f.write(file_binary)
            f.close()

    elif content_delivery == "s3api":
        s3 = boto3.client(
            "s3",
            endpoint_url=learnhouse_config.hosting_config.content_delivery.s3api.endpoint_url,
            config=botocore.config.Config(connect_timeout=10, read_timeout=60, retries={"max_attempts": 2}),
        )

        bucket_name = learnhouse_config.hosting_config.content_delivery.s3api.bucket_name or "learnhouse-media"
        s3_key = object_path

        # Upload the bytes straight to S3 — never stage a local file. The
        # serverless filesystem (Vercel) is read-only except /tmp, so the
        # previous local-staging write raised OSError and 500'd every block-media
        # upload (images/video/pdf/audio). put_object keeps the whole operation
        # in memory and writes nothing to disk.
        try:
            s3.put_object(Bucket=bucket_name, Key=s3_key, Body=file_binary)
            s3.head_object(Bucket=bucket_name, Key=s3_key)
            logger.debug("S3 upload successful: %s", s3_key)
        except ClientError as e:
            logger.error("S3 upload failed: %s", e)
            raise HTTPException(status_code=500, detail="File upload to storage failed")
