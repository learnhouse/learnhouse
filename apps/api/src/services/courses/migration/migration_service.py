"""
Service for migrating content from other LMS platforms.
Handles: bulk file upload to temp storage, AI structure suggestion, course creation from tree.
"""

import os
import re
import json
import shutil
import asyncio
import logging
from uuid import uuid4
from datetime import datetime, timezone

from fastapi import UploadFile
from sqlmodel import Session, select

from src.db.organizations import Organization
from src.db.courses.courses import Course, ThumbnailType
from src.db.courses.chapters import Chapter
from src.db.courses.activities import (
    Activity,
    ActivityTypeEnum,
    ActivitySubTypeEnum,
)
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.blocks import Block, BlockTypeEnum
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.services.courses.transfer.storage_utils import (
    upload_file_to_s3,
    is_s3_enabled,
)
from src.services.courses.migration.models import (
    UploadedFileInfo,
    MigrationUploadResponse,
    MigrationTreeStructure,
    MigrationChapterNode,
    MigrationActivityNode,
    MigrationCreateResult,
)

import time

logger = logging.getLogger(__name__)

TEMP_MIGRATION_DIR = "content/temp/migrations"
_TEMP_BASE_REAL = os.path.realpath(TEMP_MIGRATION_DIR)
MAX_TOTAL_UPLOAD_SIZE = 20 * 1024 * 1024 * 1024  # 20GB total across all files
MAX_SINGLE_FILE_SIZE = 5 * 1024 * 1024 * 1024  # 5GB per file
STREAM_CHUNK_SIZE = 8 * 1024 * 1024  # 8MB read/write chunks
MAX_CONCURRENT_UPLOADS = 3  # Max simultaneous upload requests

# Semaphore to limit concurrent upload processing
_upload_semaphore = asyncio.Semaphore(MAX_CONCURRENT_UPLOADS)

# Regex for validating UUID strings (used in temp_id and file_id)
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)

ALLOWED_EXTENSIONS = {
    "mp4", "webm", "mov",
    "pdf",
    "png", "jpg", "jpeg", "webp",
    "mp3", "wav",
}

EXTENSION_TO_ACTIVITY_TYPE = {
    "mp4": (ActivityTypeEnum.TYPE_VIDEO, ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED),
    "webm": (ActivityTypeEnum.TYPE_VIDEO, ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED),
    "mov": (ActivityTypeEnum.TYPE_VIDEO, ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED),
    "pdf": (ActivityTypeEnum.TYPE_DOCUMENT, ActivitySubTypeEnum.SUBTYPE_DOCUMENT_PDF),
    "png": (ActivityTypeEnum.TYPE_DYNAMIC, ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE),
    "jpg": (ActivityTypeEnum.TYPE_DYNAMIC, ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE),
    "jpeg": (ActivityTypeEnum.TYPE_DYNAMIC, ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE),
    "webp": (ActivityTypeEnum.TYPE_DYNAMIC, ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE),
    "mp3": (ActivityTypeEnum.TYPE_DYNAMIC, ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE),
    "wav": (ActivityTypeEnum.TYPE_DYNAMIC, ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE),
}

EXTENSION_TO_BLOCK_TYPE = {
    "png": ("imageBlock", BlockTypeEnum.BLOCK_IMAGE),
    "jpg": ("imageBlock", BlockTypeEnum.BLOCK_IMAGE),
    "jpeg": ("imageBlock", BlockTypeEnum.BLOCK_IMAGE),
    "webp": ("imageBlock", BlockTypeEnum.BLOCK_IMAGE),
    "mp3": ("audioBlock", BlockTypeEnum.BLOCK_AUDIO),
    "wav": ("audioBlock", BlockTypeEnum.BLOCK_AUDIO),
}


def cleanup_old_temp_migrations(max_age_minutes: int = 60) -> None:
    """Remove migration temp directories older than max_age_minutes."""
    if not os.path.exists(TEMP_MIGRATION_DIR):
        return
    current_time = time.time()
    max_age_seconds = max_age_minutes * 60
    for entry in os.listdir(TEMP_MIGRATION_DIR):
        entry_path = os.path.join(TEMP_MIGRATION_DIR, entry)
        if os.path.isdir(entry_path):
            try:
                mtime = os.path.getmtime(entry_path)
                if current_time - mtime > max_age_seconds:
                    shutil.rmtree(entry_path, ignore_errors=True)
                    logger.info("Cleaned up stale migration: %s", entry)
            except OSError:
                pass


def _require_uuid(value: str, name: str = "value") -> None:
    """Raise if value is not a valid UUID."""
    if not _UUID_RE.match(value):
        raise ValueError(f"Invalid {name}: must be a UUID")


def _resolve_within(base_real: str, *parts: str) -> str:
    """Join parts under base_real, resolve with realpath, and verify containment.

    Returns the resolved (realpath) string so callers use only the sanitized path.
    """
    joined = os.path.join(base_real, *parts)
    resolved = os.path.realpath(joined)
    if not resolved.startswith(base_real + os.sep) and resolved != base_real:
        raise ValueError("Path traversal detected")
    return resolved


async def upload_migration_files(
    files: list[UploadFile],
    existing_temp_id: str | None = None,
) -> MigrationUploadResponse:
    """Upload files to temporary storage for migration.

    Supports chunked uploads: pass existing_temp_id to append to a previous batch.
    Limited to MAX_CONCURRENT_UPLOADS simultaneous requests to prevent disk exhaustion.
    """
    async with _upload_semaphore:
        return await _upload_migration_files_inner(files, existing_temp_id)


async def _upload_migration_files_inner(
    files: list[UploadFile],
    existing_temp_id: str | None = None,
) -> MigrationUploadResponse:
    existing_files: list[dict] = []

    if existing_temp_id:
        # Append to existing upload
        _require_uuid(existing_temp_id, "temp_id")
        temp_id = existing_temp_id
        temp_real = os.path.realpath(os.path.join(_TEMP_BASE_REAL, temp_id))
        if not temp_real.startswith(_TEMP_BASE_REAL + os.sep):
            raise ValueError("Invalid temp_id")
        manifest_real = os.path.realpath(os.path.join(temp_real, "manifest.json"))
        if not manifest_real.startswith(temp_real + os.sep):
            raise ValueError("Invalid path")
        if os.path.exists(manifest_real):
            with open(manifest_real, "r") as f:
                existing_manifest = json.load(f)
            existing_files = existing_manifest.get("files", [])
    else:
        temp_id = str(uuid4())
        temp_real = _resolve_within(_TEMP_BASE_REAL, temp_id)

    os.makedirs(temp_real, exist_ok=True)

    uploaded_files: list[UploadedFileInfo] = []
    skipped_files: list[str] = []
    # Count existing file sizes toward the limit
    total_size = sum(fi.get("size", 0) for fi in existing_files)

    for file in files:
        if not file.filename:
            continue

        ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
        if ext not in ALLOWED_EXTENSIONS:
            skipped_files.append(f"{file.filename}: unsupported format")
            continue

        file_id = str(uuid4())
        safe_filename = f"{file_id}.{ext}"
        file_real = _resolve_within(temp_real, safe_filename)

        # Stream file to disk in chunks to avoid loading into memory
        file_size = 0
        size_exceeded = False
        try:
            with open(file_real, "wb") as f:
                while True:
                    chunk = await file.read(STREAM_CHUNK_SIZE)
                    if not chunk:
                        break
                    file_size += len(chunk)
                    if file_size > MAX_SINGLE_FILE_SIZE:
                        size_exceeded = True
                        break
                    f.write(chunk)
        except OSError as e:
            # Disk full or I/O error — clean up partial file
            if os.path.exists(file_real):
                os.remove(file_real)
            raise ValueError(f"Disk write failed: {e}") from e
        finally:
            # Release python-multipart's SpooledTemporaryFile in /tmp
            await file.close()

        if size_exceeded:
            os.remove(file_real)
            skipped_files.append(f"{file.filename}: exceeds {MAX_SINGLE_FILE_SIZE // (1024**3)}GB limit")
            continue

        total_size += file_size
        if total_size > MAX_TOTAL_UPLOAD_SIZE:
            os.remove(file_real)
            skipped_files.append(f"{file.filename}: total upload size exceeded")
            break

        uploaded_files.append(
            UploadedFileInfo(
                file_id=file_id,
                filename=file.filename,
                file_type=file.content_type or "",
                size=file_size,
                extension=ext,
            )
        )

    # Save manifest (merge with existing files)
    all_files = existing_files + [f.model_dump() for f in uploaded_files]
    manifest = {
        "temp_id": temp_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "files": all_files,
    }
    manifest_real = _resolve_within(temp_real, "manifest.json")
    with open(manifest_real, "w") as f:
        json.dump(manifest, f)

    return MigrationUploadResponse(
        temp_id=temp_id, files=uploaded_files, skipped=skipped_files
    )


async def suggest_structure(
    temp_id: str,
    course_name: str,
    description: str | None = None,
) -> MigrationTreeStructure:
    """Use AI to propose a course structure from uploaded files."""
    _require_uuid(temp_id, "temp_id")
    temp_real = os.path.realpath(os.path.join(_TEMP_BASE_REAL, temp_id))
    if not temp_real.startswith(_TEMP_BASE_REAL + os.sep):
        raise ValueError("Invalid temp_id")

    manifest_real = os.path.realpath(os.path.join(temp_real, "manifest.json"))
    if not manifest_real.startswith(temp_real + os.sep):
        raise ValueError("Invalid path")

    if not os.path.exists(manifest_real):
        raise ValueError(f"Migration package not found: {temp_id}")

    with open(manifest_real, "r") as f:
        manifest = json.load(f)

    files = manifest["files"]

    # Build file list description for AI
    file_descriptions = []
    for fi in files:
        file_descriptions.append(
            f"- {fi['filename']} ({fi['extension']}, {fi['size']} bytes)"
        )
    file_list = "\n".join(file_descriptions)

    # Build file ID mapping
    file_id_mapping = "\n".join(
        f"{fi['filename']} -> {fi['file_id']}" for fi in files
    )

    prompt = (
        "You are organizing files into an online course structure.\n\n"
        f"Course name: {course_name}\n"
        + (f"Description: {description}\n" if description else "")
        + f"\nFiles available:\n{file_list}\n\n"
        "Create a JSON course structure. Group related files into chapters, "
        "and assign each file to an activity within a chapter. Use the original "
        "filenames to infer topic/order. Each activity should have a descriptive "
        "name (not the filename).\n\n"
        "Rules:\n"
        "- Every file must be assigned to exactly one activity\n"
        "- Each chapter should have a clear theme\n"
        "- Activity types based on extension: mp4/webm/mov = TYPE_VIDEO, "
        "pdf = TYPE_DOCUMENT, png/jpg/jpeg/webp = TYPE_DYNAMIC, mp3/wav = TYPE_DYNAMIC\n"
        "- Sub-types: video = SUBTYPE_VIDEO_HOSTED, pdf = SUBTYPE_DOCUMENT_PDF, "
        "images/audio = SUBTYPE_DYNAMIC_PAGE\n"
        "- Use the file_id values (not filenames) in file_ids arrays\n\n"
        'Return ONLY valid JSON, no markdown, no explanation:\n'
        '{"course_name": "...", "course_description": "...", '
        '"chapters": [{"name": "...", "activities": [{"name": "...", '
        '"activity_type": "TYPE_VIDEO", "activity_sub_type": "SUBTYPE_VIDEO_HOSTED", '
        '"file_ids": ["file-id-here"]}]}]}\n\n'
        f"File ID mapping:\n{file_id_mapping}"
    )

    try:
        from src.services.ai.base import get_gemini_client

        client = get_gemini_client()
        response = client.models.generate_content(
            model="gemini-2.0-flash-lite",
            contents=[{"role": "user", "parts": [{"text": prompt}]}],
            config={"temperature": 0.3, "max_output_tokens": 4096},
        )

        raw = response.text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1]
            if raw.endswith("```"):
                raw = raw[:-3]
            raw = raw.strip()

        structure = MigrationTreeStructure.model_validate_json(raw)
        return structure

    except Exception as e:
        logger.error("AI structure suggestion failed: %s", e, exc_info=True)
        return _fallback_structure(course_name, description, files)


def _fallback_structure(
    course_name: str,
    description: str | None,
    files: list[dict],
) -> MigrationTreeStructure:
    """Create a simple flat structure as fallback when AI is unavailable."""
    activities = []
    for fi in files:
        ext = fi["extension"]
        act_type, sub_type = EXTENSION_TO_ACTIVITY_TYPE.get(
            ext,
            (ActivityTypeEnum.TYPE_DYNAMIC, ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE),
        )
        name = (
            fi["filename"]
            .rsplit(".", 1)[0]
            .replace("_", " ")
            .replace("-", " ")
            .title()
        )
        activities.append(
            MigrationActivityNode(
                name=name,
                activity_type=act_type.value,
                activity_sub_type=sub_type.value,
                file_ids=[fi["file_id"]],
            )
        )

    return MigrationTreeStructure(
        course_name=course_name,
        course_description=description,
        chapters=[MigrationChapterNode(name="Content", activities=activities)],
    )


async def create_course_from_migration(
    org_id: int,
    current_user,
    db_session: Session,
    temp_id: str,
    structure: MigrationTreeStructure,
) -> MigrationCreateResult:
    """Create a full course from the migration tree structure."""
    _require_uuid(temp_id, "temp_id")
    temp_real = os.path.realpath(os.path.join(_TEMP_BASE_REAL, temp_id))
    if not temp_real.startswith(_TEMP_BASE_REAL + os.sep):
        raise ValueError("Invalid temp_id")

    manifest_real = os.path.realpath(os.path.join(temp_real, "manifest.json"))
    if not manifest_real.startswith(temp_real + os.sep):
        raise ValueError("Invalid path")

    if not os.path.exists(manifest_real):
        raise ValueError(f"Migration package not found: {temp_id}")

    with open(manifest_real, "r") as f:
        manifest = json.load(f)

    file_lookup = {fi["file_id"]: fi for fi in manifest["files"]}

    # Get org
    statement = select(Organization).where(Organization.id == org_id)
    organization = db_session.exec(statement).first()
    if not organization:
        raise ValueError("Organization not found")

    org_uuid = organization.org_uuid

    try:
        now = str(datetime.now())
        course_uuid = f"course_{uuid4()}"

        # Create course
        course = Course(
            org_id=org_id,
            name=structure.course_name,
            description=structure.course_description or "",
            about="",
            learnings="",
            tags="",
            thumbnail_type=ThumbnailType.IMAGE,
            thumbnail_image="",
            thumbnail_video="",
            public=False,
            published=False,
            open_to_contributors=False,
            course_uuid=course_uuid,
            creation_date=now,
            update_date=now,
        )
        db_session.add(course)
        db_session.flush()

        # Create resource author
        author = ResourceAuthor(
            resource_uuid=course_uuid,
            user_id=current_user.id,
            authorship=ResourceAuthorshipEnum.CREATOR,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
            creation_date=now,
            update_date=now,
        )
        db_session.add(author)

        # Create course content directory (only needed for local filesystem storage)
        course_dir = os.path.join(
            "content", "orgs", org_uuid, "courses", course_uuid
        )
        if not is_s3_enabled():
            os.makedirs(course_dir, exist_ok=True)

        chapters_created = 0
        activities_created = 0

        for chapter_order, chapter_node in enumerate(structure.chapters):
            chapter_uuid = f"chapter_{uuid4()}"
            chapter = Chapter(
                name=chapter_node.name,
                description="",
                thumbnail_image="",
                chapter_uuid=chapter_uuid,
                org_id=org_id,
                course_id=course.id,
                creation_date=now,
                update_date=now,
            )
            db_session.add(chapter)
            db_session.flush()

            course_chapter = CourseChapter(
                course_id=course.id,
                chapter_id=chapter.id,
                org_id=org_id,
                order=chapter_order,
                creation_date=now,
                update_date=now,
            )
            db_session.add(course_chapter)
            chapters_created += 1

            for act_order, act_node in enumerate(chapter_node.activities):
                activity_uuid = f"activity_{uuid4()}"
                activity_type = ActivityTypeEnum(act_node.activity_type)
                activity_sub_type = ActivitySubTypeEnum(act_node.activity_sub_type)

                content = {}
                activity_dir = os.path.join(
                    course_dir, "activities", activity_uuid
                )
                if not is_s3_enabled():
                    os.makedirs(activity_dir, exist_ok=True)

                block_to_add = None

                for file_id in act_node.file_ids:
                    # Validate file_id is a UUID to prevent path traversal
                    if not _UUID_RE.match(file_id):
                        continue

                    fi = file_lookup.get(file_id)
                    if not fi:
                        continue

                    ext = fi["extension"]
                    if ext not in ALLOWED_EXTENSIONS:
                        continue

                    # Resolve source path with realpath and verify containment
                    src_real = os.path.realpath(
                        os.path.join(temp_real, f"{file_id}.{ext}")
                    )
                    if not src_real.startswith(temp_real + os.sep):
                        continue
                    if not os.path.exists(src_real):
                        continue

                    new_file_id = str(uuid4())

                    if activity_type in (
                        ActivityTypeEnum.TYPE_VIDEO,
                        ActivityTypeEnum.TYPE_DOCUMENT,
                    ):
                        content = {
                            "file_id": new_file_id,
                            "file_format": ext,
                        }

                        if is_s3_enabled():
                            s3_key = f"orgs/{org_uuid}/courses/{course_uuid}/activities/{activity_uuid}/files/{new_file_id}.{ext}"
                            ok = await asyncio.to_thread(upload_file_to_s3, s3_key, src_real)
                            if not ok:
                                raise RuntimeError(f"S3 upload failed for {s3_key}")
                        else:
                            files_dir = os.path.join(activity_dir, "files")
                            os.makedirs(files_dir, exist_ok=True)
                            dst_real = os.path.realpath(
                                os.path.join(files_dir, f"{new_file_id}.{ext}")
                            )
                            if not dst_real.startswith(
                                os.path.realpath(files_dir) + os.sep
                            ):
                                continue
                            await asyncio.to_thread(shutil.copy2, src_real, dst_real)

                    elif activity_type == ActivityTypeEnum.TYPE_DYNAMIC:
                        block_uuid = f"block_{uuid4()}"
                        block_type_folder, block_type_enum = (
                            EXTENSION_TO_BLOCK_TYPE.get(
                                ext, ("imageBlock", BlockTypeEnum.BLOCK_IMAGE)
                            )
                        )

                        block_content = {
                            "file_id": new_file_id,
                            "file_format": ext,
                        }
                        content = {
                            "blocks": [
                                {
                                    "block_uuid": block_uuid,
                                    "block_type": block_type_enum.value,
                                    "content": block_content,
                                }
                            ]
                        }

                        block_to_add = Block(
                            block_type=block_type_enum,
                            content=block_content,
                            org_id=org_id,
                            course_id=course.id,
                            activity_id=0,
                            block_uuid=block_uuid,
                            creation_date=now,
                            update_date=now,
                        )

                        if is_s3_enabled():
                            s3_key = (
                                f"orgs/{org_uuid}/courses/{course_uuid}"
                                f"/activities/{activity_uuid}/dynamic/blocks"
                                f"/{block_type_folder}/{block_uuid}"
                                f"/{new_file_id}.{ext}"
                            )
                            ok = await asyncio.to_thread(upload_file_to_s3, s3_key, src_real)
                            if not ok:
                                raise RuntimeError(f"S3 upload failed for {s3_key}")
                        else:
                            block_dir = os.path.join(
                                activity_dir,
                                "dynamic",
                                "blocks",
                                block_type_folder,
                                block_uuid,
                            )
                            os.makedirs(block_dir, exist_ok=True)
                            dst_real = os.path.realpath(
                                os.path.join(block_dir, f"{new_file_id}.{ext}")
                            )
                            if not dst_real.startswith(
                                os.path.realpath(block_dir) + os.sep
                            ):
                                continue
                            await asyncio.to_thread(shutil.copy2, src_real, dst_real)

                activity = Activity(
                    name=act_node.name,
                    activity_type=activity_type,
                    activity_sub_type=activity_sub_type,
                    content=content,
                    details={},
                    published=False,
                    activity_uuid=activity_uuid,
                    org_id=org_id,
                    course_id=course.id,
                    creation_date=now,
                    update_date=now,
                    current_version=1,
                )
                db_session.add(activity)
                db_session.flush()

                chapter_activity = ChapterActivity(
                    chapter_id=chapter.id,
                    activity_id=activity.id,
                    course_id=course.id,
                    org_id=org_id,
                    order=act_order,
                    creation_date=now,
                    update_date=now,
                )
                db_session.add(chapter_activity)

                if block_to_add:
                    block_to_add.activity_id = activity.id
                    db_session.add(block_to_add)

                activities_created += 1

        db_session.commit()

        # Clean up temp directory — temp_real already validated above
        shutil.rmtree(temp_real, ignore_errors=True)

        return MigrationCreateResult(
            course_uuid=course_uuid,
            course_name=structure.course_name,
            chapters_created=chapters_created,
            activities_created=activities_created,
            success=True,
        )

    except Exception as e:
        db_session.rollback()
        logger.error("Migration course creation failed: %s", e, exc_info=True)
        # Clean up temp files on failure so they don't accumulate
        shutil.rmtree(temp_real, ignore_errors=True)
        return MigrationCreateResult(
            course_uuid="",
            course_name=structure.course_name,
            chapters_created=0,
            activities_created=0,
            success=False,
            error=str(e),
        )
