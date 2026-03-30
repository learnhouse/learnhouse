"""
Storage utilities for course transfer operations.
Handles file operations for both local filesystem and S3/R2 cloud storage.

Follows the same pattern as upload_content.py and frontend media.ts:
- When content_delivery is "filesystem", files are on local filesystem
- When content_delivery is "s3api", files are on S3/R2 (and may also be local)
"""

import logging
import os
import threading
from typing import Optional
import boto3
from botocore.exceptions import ClientError, NoCredentialsError
from config.config import get_learnhouse_config

logger = logging.getLogger(__name__)

# Cached S3 client (thread-safe)
_s3_client = None
_s3_client_lock = threading.Lock()


def get_content_delivery_type() -> str:
    """Get the configured content delivery type."""
    learnhouse_config = get_learnhouse_config()
    return learnhouse_config.hosting_config.content_delivery.type


def get_storage_client():
    """
    Get boto3 S3 client if S3 is configured, otherwise return None.
    Caches the client for reuse across calls.
    """
    global _s3_client
    learnhouse_config = get_learnhouse_config()
    content_delivery = learnhouse_config.hosting_config.content_delivery.type

    if content_delivery != "s3api":
        return None

    if _s3_client is not None:
        return _s3_client

    with _s3_client_lock:
        if _s3_client is not None:
            return _s3_client
        _s3_client = boto3.client(
            "s3",
            endpoint_url=learnhouse_config.hosting_config.content_delivery.s3api.endpoint_url,
        )
        return _s3_client


def get_s3_bucket_name() -> str:
    """Get the S3 bucket name from config."""
    learnhouse_config = get_learnhouse_config()
    return learnhouse_config.hosting_config.content_delivery.s3api.bucket_name or "learnhouse-media"


def is_s3_enabled() -> bool:
    """Check if S3 storage is enabled."""
    return get_content_delivery_type() == "s3api"


def read_file_content(file_path: str) -> Optional[bytes]:
    """
    Read file content based on configured content delivery type.

    - If content_delivery is "filesystem", reads from local filesystem
    - If content_delivery is "s3api", reads from S3

    Args:
        file_path: Relative path to the file (e.g., "content/orgs/org_xxx/courses/...")

    Returns:
        File content as bytes, or None if not found
    """
    content_delivery = get_content_delivery_type()

    if content_delivery == "s3api":
        # Read from S3
        s3_client = get_storage_client()
        if s3_client:
            try:
                response = s3_client.get_object(
                    Bucket=get_s3_bucket_name(),
                    Key=file_path,
                )
                return response['Body'].read()
            except ClientError as e:
                error_code = e.response.get('Error', {}).get('Code', '')
                if error_code == 'NoSuchKey':
                    return None
                logger.error("S3 error reading %s: %s", file_path, e)
                return None
            except NoCredentialsError:
                logger.error("S3 credentials not configured")
                return None
            except Exception as e:
                logger.error("Error reading from S3: %s", e)
                return None
        return None
    else:
        # Read from local filesystem
        if os.path.exists(file_path):
            with open(file_path, 'rb') as f:
                return f.read()
        return None


def file_exists(file_path: str) -> bool:
    """
    Check if file exists based on configured content delivery type.

    Args:
        file_path: Relative path to the file

    Returns:
        True if file exists, False otherwise
    """
    content_delivery = get_content_delivery_type()

    if content_delivery == "s3api":
        # Check S3
        s3_client = get_storage_client()
        if s3_client:
            try:
                s3_client.head_object(
                    Bucket=get_s3_bucket_name(),
                    Key=file_path,
                )
                return True
            except ClientError:
                return False
            except Exception:
                return False
        return False
    else:
        # Check local filesystem
        return os.path.exists(file_path)


def list_directory(dir_path: str) -> list[str]:
    """
    List files in a directory based on configured content delivery type.

    Args:
        dir_path: Relative path to the directory

    Returns:
        List of file names (not full paths)
    """
    content_delivery = get_content_delivery_type()

    if content_delivery == "s3api":
        # List from S3
        files = []
        s3_client = get_storage_client()
        if s3_client:
            try:
                # Ensure path ends with /
                prefix = dir_path if dir_path.endswith('/') else dir_path + '/'

                paginator = s3_client.get_paginator('list_objects_v2')
                for page in paginator.paginate(Bucket=get_s3_bucket_name(), Prefix=prefix, Delimiter='/'):
                    # Get files (not subdirectories)
                    for obj in page.get('Contents', []):
                        key = obj['Key']
                        # Extract filename from path
                        if key.startswith(prefix):
                            filename = key[len(prefix):]
                            if '/' not in filename and filename:  # Only direct files, not in subdirs
                                files.append(filename)
            except ClientError:
                pass
            except Exception as e:
                logger.error("Error listing S3 directory: %s", e)
        return files
    else:
        # List from local filesystem
        if os.path.exists(dir_path) and os.path.isdir(dir_path):
            return os.listdir(dir_path)
        return []


def walk_directory(base_path: str):
    """
    Walk through a directory tree based on configured content delivery type.
    Yields (root, dirs, files) tuples similar to os.walk.

    Args:
        base_path: Relative path to the base directory

    Yields:
        (root, dirs, files) tuples
    """
    content_delivery = get_content_delivery_type()

    if content_delivery == "s3api":
        # Walk S3
        all_paths = set()
        s3_client = get_storage_client()

        if s3_client:
            try:
                prefix = base_path if base_path.endswith('/') else base_path + '/'

                paginator = s3_client.get_paginator('list_objects_v2')
                for page in paginator.paginate(Bucket=get_s3_bucket_name(), Prefix=prefix):
                    for obj in page.get('Contents', []):
                        key = obj['Key']
                        if key.startswith(prefix):
                            rel_path = key[len(prefix):]
                            if rel_path:
                                all_paths.add(rel_path)
            except ClientError:
                pass
            except Exception as e:
                logger.error("Error walking S3 directory: %s", e)

        if not all_paths:
            return

        # Build directory structure from all paths
        dir_files = {}  # dir_path -> set of filenames
        all_dirs = set()

        for rel_path in all_paths:
            parts = rel_path.split('/')
            filename = parts[-1]
            dir_rel_path = '/'.join(parts[:-1]) if len(parts) > 1 else ''

            # Add all parent directories
            for i in range(len(parts) - 1):
                parent = '/'.join(parts[:i+1])
                all_dirs.add(parent)

            # Add file to its directory
            if dir_rel_path not in dir_files:
                dir_files[dir_rel_path] = set()
            dir_files[dir_rel_path].add(filename)

        # Yield root first
        root_files = dir_files.get('', set())
        root_subdirs = sorted([d for d in all_dirs if '/' not in d and d])
        if root_files or root_subdirs:
            yield base_path, root_subdirs, sorted(root_files)

        # Yield subdirectories
        for dir_rel in sorted(all_dirs):
            dir_path = os.path.join(base_path, dir_rel)
            files = sorted(dir_files.get(dir_rel, set()))
            # Find immediate subdirs
            subdirs = sorted([
                d.split('/')[len(dir_rel.split('/'))]
                for d in all_dirs
                if d.startswith(dir_rel + '/') and d.count('/') == dir_rel.count('/') + 1
            ])
            yield dir_path, subdirs, files
    else:
        # Walk local filesystem
        if os.path.exists(base_path):
            for root, dirs, files in os.walk(base_path):
                yield root, dirs, files


def upload_to_s3(file_path: str, content: bytes) -> bool:
    """
    Upload file content to S3 if configured.

    Args:
        file_path: Relative path for the file
        content: File content as bytes

    Returns:
        True if uploaded successfully, False otherwise
    """
    s3_client = get_storage_client()
    if not s3_client:
        return False

    try:
        s3_client.put_object(
            Bucket=get_s3_bucket_name(),
            Key=file_path,
            Body=content,
        )
        return True
    except ClientError as e:
        logger.error("S3 upload error for %s: %s", file_path, e)
        return False
    except Exception as e:
        logger.error("Error uploading to S3: %s", e)
        return False


MIME_TYPES_BY_EXT = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
}


def _mime_type_for_key(key: str) -> str:
    """Guess MIME type from an S3 key's extension."""
    import os
    ext = os.path.splitext(key)[1].lower()
    return MIME_TYPES_BY_EXT.get(ext, "application/octet-stream")


def upload_file_to_s3(s3_key: str, local_path: str) -> bool:
    """
    Upload a local file to S3 using multipart upload (streams from disk,
    no full-file memory load). Boto3 automatically uses multipart for
    files above its threshold (~8MB). Sets Content-Type from extension.
    """
    s3_client = get_storage_client()
    if not s3_client:
        return False

    try:
        s3_client.upload_file(
            Filename=local_path,
            Bucket=get_s3_bucket_name(),
            Key=s3_key,
            ExtraArgs={"ContentType": _mime_type_for_key(s3_key)},
        )
        return True
    except ClientError as e:
        logger.error("S3 upload error for %s: %s", s3_key, e)
        return False
    except Exception as e:
        logger.error("Error uploading to S3: %s", e)
        return False


def delete_storage_directory(dir_path: str) -> bool:
    """
    Delete an entire directory from storage (S3 or local filesystem).

    Args:
        dir_path: Relative path to the directory

    Returns:
        True if deleted successfully, False otherwise
    """
    import shutil

    content_delivery = get_content_delivery_type()
    success = True

    if content_delivery == "s3api":
        s3_client = get_storage_client()
        if s3_client:
            bucket = get_s3_bucket_name()
            prefix = dir_path if dir_path.endswith('/') else dir_path + '/'
            try:
                paginator = s3_client.get_paginator('list_objects_v2')
                for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
                    objects = page.get('Contents', [])
                    if objects:
                        delete_keys = [{'Key': obj['Key']} for obj in objects]
                        s3_client.delete_objects(
                            Bucket=bucket,
                            Delete={'Objects': delete_keys},
                        )
            except Exception as e:
                logger.error("Error deleting S3 directory %s: %s", dir_path, e)
                success = False

    # Also clean up local directory if it exists
    if os.path.exists(dir_path):
        try:
            shutil.rmtree(dir_path, ignore_errors=True)
        except Exception:
            pass

    return success


def delete_storage_file(file_path: str) -> bool:
    """
    Delete a single file from storage (S3 or local filesystem).

    Args:
        file_path: Relative path to the file

    Returns:
        True if deleted successfully, False otherwise
    """
    content_delivery = get_content_delivery_type()

    if content_delivery == "s3api":
        s3_client = get_storage_client()
        if s3_client:
            try:
                s3_client.delete_object(
                    Bucket=get_s3_bucket_name(),
                    Key=file_path,
                )
            except Exception as e:
                logger.error("Error deleting S3 file %s: %s", file_path, e)
                return False

    # Also clean up local file if it exists
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception:
            pass

    return True


def upload_directory_to_s3(local_dir: str, s3_prefix: str) -> bool:
    """
    Upload an entire directory to S3 if configured.
    Uses multipart streaming uploads to avoid loading large files into memory.

    Args:
        local_dir: Local directory path
        s3_prefix: S3 prefix path

    Returns:
        True if all uploads successful, False if any failed
    """
    if not is_s3_enabled():
        return True  # Not an error, just not configured

    if not os.path.exists(local_dir):
        return True

    success = True
    for root, dirs, files in os.walk(local_dir):
        for filename in files:
            local_path = os.path.join(root, filename)
            rel_path = os.path.relpath(local_path, local_dir)
            s3_path = f"{s3_prefix}/{rel_path}".replace('\\', '/')

            if not upload_file_to_s3(s3_path, local_path):
                success = False

    return success
