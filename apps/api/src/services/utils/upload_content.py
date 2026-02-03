import asyncio
from typing import Literal, Optional
import boto3
from botocore.exceptions import ClientError
import os
from fastapi import HTTPException, UploadFile
from config.config import get_learnhouse_config
from src.security.file_validation import validate_upload
from concurrent.futures import ThreadPoolExecutor


CHUNK_SIZE = 5 * 1024 * 1024  # 5 MB
executor = ThreadPoolExecutor(max_workers=2)


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
    _, content = validate_upload(file, allowed_types, max_size)
    
    # Generate safe filename
    filename = get_safe_filename(file.filename, f"{uuid4()}_{filename_prefix}")
    
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
    file_obj: object,
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

    file_path = f"content/{type_of_dir}/{uuid}/{directory}/{file_and_format}"
    ensure_directory_exists(f"content/{type_of_dir}/{uuid}/{directory}")

    if content_delivery == "filesystem":
        # Upload to filesystem using async I/O
        await _upload_to_filesystem(file_obj, file_path)

    elif content_delivery == "s3api":
        # Upload to S3
        s3_key = f"content/{type_of_dir}/{uuid}/{directory}/{file_and_format}"
        endpoint_url=learnhouse_config.hosting_config.content_delivery.s3api.endpoint_url
        await _upload_to_s3(file_obj, s3_key, endpoint_url)


async def _upload_to_filesystem(file_obj, file_path: str):
    def _write_file():
        try:
            with open(file_path, "wb") as f:
                while True:
                    chunk = file_obj.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    f.write(chunk)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(executor, _write_file)
    
    if not result["success"]:
        raise HTTPException(
            status_code=500,
            detail=f"Filesystem upload failed: {result['error']}"
        )
    
    print(f"Filesystem upload successful: {file_path}")


async def _upload_to_s3(file_obj, s3_key: str, endpoint_url):
    def _upload():
        try:
            s3 = boto3.client(
                "s3",
                endpoint_url=endpoint_url,
            )

            if hasattr(file_obj, 'seek'):
                file_obj.seek(0)

            s3.upload_fileobj(
                file_obj,
                "learnhouse-media",
                s3_key,
                Config=boto3.s3.transfer.TransferConfig(
                    multipart_threshold=CHUNK_SIZE,
                    multipart_chunksize=CHUNK_SIZE,
                    max_concurrency=2,
                    max_io_queue_size=100,
                )
            )
            print(f"S3 upload successful: {s3_key}")
            return {"success": True}

        except ClientError as e:
            print(f"Error uploading to S3: {e}")
            return {"success": False, "error": str(e)}
    
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(executor, _upload)
    
    if not result["success"]:
        raise HTTPException(
            status_code=500,
            detail=f"S3 upload failed: {result['error']}"
        )