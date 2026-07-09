"""
App package (zip) processing pipeline.

Mirrors the hardened extraction used by the course import service
(src/services/courses/transfer/import_service.py): streaming size caps,
entry-count / per-entry-size / compression-ratio ceilings, symlink
rejection and realpath+commonpath containment — plus, specific to apps,
a strict file-extension allowlist (apps are static UI bundles only).
"""

import os
import shutil
import zipfile
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status

from src.security.file_validation import validate_upload
from src.services.apps.manifest import (
    MANIFEST_FILENAME,
    AppManifest,
    parse_manifest,
)
from src.services.courses.transfer.import_service import sanitize_path
from src.services.courses.transfer.storage_utils import (
    delete_storage_directory,
    upload_directory_to_s3,
)

# Temp workspace for extraction before the bundle is moved into place.
TEMP_APPS_DIR = "content/temp/apps"

# App bundles are static UIs — the ceilings are deliberately far below the
# SCORM/import ones.
MAX_PACKAGE_SIZE = 200 * 1024 * 1024  # uncompressed
MAX_ENTRY_SIZE = 20 * 1024 * 1024
MAX_ENTRY_COUNT = 2000
MAX_COMPRESSION_RATIO = 20

# Zip central-directory external-attribute mask for symlinks (S_IFLNK in the
# upper 16 bits) — same convention as import_service.
_ZIP_SYMLINK_MODE = 0xA000 << 16

# Static-asset allowlist. Anything else rejects the whole package: an app
# bundle has no business containing executables, server code or archives.
ALLOWED_APP_FILE_EXTENSIONS = {
    ".html", ".htm", ".css", ".js", ".mjs", ".json", ".map",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
    ".woff", ".woff2", ".ttf", ".otf",
    ".txt", ".md",
}


def app_storage_prefix(org_uuid: str, app_uuid: str, version: str) -> str:
    return f"content/orgs/{org_uuid}/apps/{app_uuid}/{version}"


def extract_app_package(zip_file: UploadFile) -> tuple[AppManifest, str]:
    """Validate and extract an app package into a temp directory.

    Returns (manifest, extract_dir). The caller is responsible for moving the
    extracted tree into final storage and for cleaning up the temp directory
    (including on failure).
    """
    # Magic bytes + 50MB zipped cap + zip-bomb ceiling (app_package type).
    _, content = validate_upload(zip_file, ["app_package"])

    temp_dir = os.path.join(TEMP_APPS_DIR, str(uuid4()))
    extract_dir = os.path.join(temp_dir, "extracted")
    os.makedirs(extract_dir, exist_ok=True)

    zip_path = os.path.join(temp_dir, "package.zip")
    try:
        with open(zip_path, "wb") as f:
            f.write(content)

        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            infolist = zip_ref.infolist()

            if len(infolist) > MAX_ENTRY_COUNT:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid app package: too many entries (max {MAX_ENTRY_COUNT})",
                )

            compressed_size = os.path.getsize(zip_path)
            uncompressed_size = 0
            for info in infolist:
                if info.file_size > MAX_ENTRY_SIZE:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Invalid app package: entry '{info.filename}' exceeds the per-file size limit",
                    )
                uncompressed_size += info.file_size

                if not info.is_dir():
                    ext = os.path.splitext(info.filename)[1].lower()
                    if ext not in ALLOWED_APP_FILE_EXTENSIONS:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=(
                                f"Invalid app package: file type '{ext or info.filename}' is not "
                                "allowed. Apps may only contain static assets "
                                "(HTML, CSS, JS, JSON, images, fonts, text)."
                            ),
                        )

            if uncompressed_size > MAX_PACKAGE_SIZE:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid app package: uncompressed size exceeds limit",
                )
            if uncompressed_size > compressed_size * MAX_COMPRESSION_RATIO:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid app package: suspicious compression ratio",
                )

            abs_extract = os.path.realpath(extract_dir)
            for info in infolist:
                if info.external_attr & _ZIP_SYMLINK_MODE:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Invalid app package: symlink entry '{info.filename}' is not allowed",
                    )

                safe_path = sanitize_path(info.filename)
                if not safe_path:
                    continue

                target_path = os.path.join(extract_dir, safe_path)
                resolved = os.path.realpath(target_path)
                try:
                    contained = os.path.commonpath([abs_extract, resolved]) == abs_extract
                except ValueError:
                    contained = False
                if not contained:
                    continue

                if info.is_dir():
                    os.makedirs(target_path, exist_ok=True)
                else:
                    os.makedirs(os.path.dirname(target_path), exist_ok=True)
                    with zip_ref.open(info) as source, open(target_path, "wb") as target:
                        shutil.copyfileobj(source, target)

        os.unlink(zip_path)

        manifest_path = os.path.join(extract_dir, MANIFEST_FILENAME)
        if not os.path.isfile(manifest_path):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid app package: {MANIFEST_FILENAME} not found at the package root",
            )
        with open(manifest_path, "rb") as f:
            manifest = parse_manifest(f.read())

        entry_path = os.path.join(extract_dir, manifest.entry)
        if not os.path.isfile(entry_path):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid app package: entry file '{manifest.entry}' not found in the package",
            )
        if manifest.icon is not None and not os.path.isfile(os.path.join(extract_dir, manifest.icon)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid app package: icon file '{manifest.icon}' not found in the package",
            )

        return manifest, extract_dir
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise


def store_app_bundle(extract_dir: str, storage_prefix: str) -> None:
    """Move an extracted bundle into final storage (filesystem + S3 if enabled).

    The local copy always exists (it is the serving source in filesystem mode
    and harmless in s3 mode); S3 upload mirrors it when configured. Any
    previous content under the prefix is replaced.
    """
    delete_storage_directory(storage_prefix)
    os.makedirs(os.path.dirname(storage_prefix), exist_ok=True)
    shutil.copytree(extract_dir, storage_prefix, dirs_exist_ok=True)
    if not upload_directory_to_s3(storage_prefix, storage_prefix):
        # Storage must be consistent: a half-uploaded bundle would serve a
        # broken or stale app. Roll back the local copy and fail the install.
        delete_storage_directory(storage_prefix)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to store app bundle in cloud storage",
        )


def cleanup_extract_dir(extract_dir: str) -> None:
    """Remove the temp workspace created by extract_app_package."""
    # extract_dir is TEMP_APPS_DIR/{uuid}/extracted — remove the {uuid} parent.
    shutil.rmtree(os.path.dirname(extract_dir), ignore_errors=True)
