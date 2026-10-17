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
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

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
from src.db.courses.blocks import Block, BlockRead, BlockTypeEnum
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.security.auth import resolve_acting_user_id
from src.services.ai.rag.queue import index_activity
from src.services.blocks.schemas.files import BlockFile
from src.services.courses.transfer.import_service import file_content_matches_extension
from src.services.courses.transfer.storage_utils import (
    upload_file_to_s3,
    is_s3_enabled,
)
from src.services.utils.video_processing import ensure_faststart
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


# QuickTime has no upload type to borrow a validator from: accept files whose
# first atom is one a .mov starts with.
_MOV_LEADING_ATOMS = {b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip", b"pnot"}


def _migration_file_is_valid(path: str, ext: str) -> bool:
    """Same magic-byte check upload_file applies, before anything is stored."""
    if ext == "mov":
        try:
            with open(path, "rb") as f:
                return f.read(8)[4:8] in _MOV_LEADING_ATOMS
        except OSError:
            return False
    return file_content_matches_extension(path)


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
            with open(manifest_real, "r", encoding="utf-8") as f:
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
            # Disk full or I/O error: clean up the partial file
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

        if not await asyncio.to_thread(_migration_file_is_valid, file_real, ext):
            os.remove(file_real)
            skipped_files.append(f"{file.filename}: content does not match its file type")
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
    with open(manifest_real, "w", encoding="utf-8") as f:
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

    with open(manifest_real, "r", encoding="utf-8") as f:
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
        "- A video or PDF activity holds exactly one file; images and audio "
        "can share one activity\n"
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
        from src.services.ai.llm import generate, model_for_tier

        raw = await generate(
            model_name=model_for_tier("fast"),
            user_prompt=prompt,
            temperature=0.3,
            max_tokens=4096,
        )
        raw = raw.strip()
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


# Activity types that play a single file, and the folder their player reads it
# from (the same layout upload_video and upload_pdf write).
_MEDIA_FOLDERS = {
    ActivityTypeEnum.TYPE_VIDEO: "video",
    ActivityTypeEnum.TYPE_DOCUMENT: "documentpdf",
}

_BLOCK_EDITOR_NODES = {
    BlockTypeEnum.BLOCK_IMAGE: "blockImage",
    BlockTypeEnum.BLOCK_AUDIO: "blockAudio",
}


def _resolve_source_file(
    file_id: str, file_lookup: dict, temp_real: str
) -> tuple[dict, str] | None:
    """Return (manifest entry, real path) for an uploaded file, or None if unusable."""
    # Validate file_id is a UUID to prevent path traversal
    if not _UUID_RE.match(file_id):
        return None

    fi = file_lookup.get(file_id)
    if not fi or fi["extension"] not in EXTENSION_TO_ACTIVITY_TYPE:
        return None

    # Resolve source path with realpath and verify containment
    src_real = os.path.realpath(
        os.path.join(temp_real, f"{file_id}.{fi['extension']}")
    )
    if not src_real.startswith(temp_real + os.sep):
        return None
    if not os.path.exists(src_real):
        return None
    return fi, src_real


def _plan_activities(
    act_node: MigrationActivityNode, file_lookup: dict, temp_real: str
) -> list[tuple[str, ActivityTypeEnum, ActivitySubTypeEnum, list[tuple[dict, str]]]]:
    """Split one tree node into the activities it becomes.

    A video or PDF activity plays a single file, so each such file gets its own
    activity, typed from its extension rather than the node (the tree editor
    retypes a node after the last file dropped on it). Images and audio share
    one page. A node with no usable file stays a single empty activity.
    """
    planned: list[tuple[ActivityTypeEnum, ActivitySubTypeEnum, list]] = []
    page_files: list[tuple[dict, str]] = []
    for file_id in act_node.file_ids:
        resolved = _resolve_source_file(file_id, file_lookup, temp_real)
        if not resolved:
            continue
        activity_type, sub_type = EXTENSION_TO_ACTIVITY_TYPE[resolved[0]["extension"]]
        if activity_type == ActivityTypeEnum.TYPE_DYNAMIC:
            if not page_files:
                planned.append((activity_type, sub_type, page_files))
            page_files.append(resolved)
        else:
            planned.append((activity_type, sub_type, [resolved]))

    if not planned:
        return [(
            act_node.name,
            ActivityTypeEnum(act_node.activity_type),
            ActivitySubTypeEnum(act_node.activity_sub_type),
            [],
        )]
    return [
        (act_node.name if i == 0 else f"{act_node.name} ({i + 1})", t, s, files)
        for i, (t, s, files) in enumerate(planned)
    ]


async def _store_activity_file(
    src_real: str,
    org_uuid: str,
    course_uuid: str,
    activity_uuid: str,
    folders: list[str],
    filename: str,
) -> bool:
    """Copy a file to the content path the stream and media routes serve.

    The path is the same on disk and as an S3 key. Returns False if the local
    destination would escape its folder.
    """
    parts = [
        "content", "orgs", org_uuid, "courses", course_uuid,
        "activities", activity_uuid, *folders,
    ]
    if is_s3_enabled():
        s3_key = "/".join([*parts, filename])
        ok = await asyncio.to_thread(upload_file_to_s3, s3_key, src_real)
        if not ok:
            raise RuntimeError(f"S3 upload failed for {s3_key}")
        return True

    dir_real = os.path.realpath(os.path.join(*parts))
    os.makedirs(dir_real, exist_ok=True)
    dst_real = os.path.realpath(os.path.join(dir_real, filename))
    if not dst_real.startswith(dir_real + os.sep):
        return False
    await asyncio.to_thread(shutil.copy2, src_real, dst_real)
    return True


async def _build_page_from_files(
    db_session: AsyncSession,
    files: list[tuple[dict, str]],
    *,
    org_id: int,
    org_uuid: str,
    course_id: int,
    course_uuid: str,
    activity_id: int,
    activity_uuid: str,
    now: str,
) -> dict:
    """Store image/audio files as blocks and return the page document showing them.

    The document matches what the editor saves after an upload, so the page
    renders and stays editable.
    """
    nodes = []
    for fi, src_real in files:
        ext = fi["extension"]
        block_type_folder, block_type = EXTENSION_TO_BLOCK_TYPE[ext]
        block_uuid = f"block_{uuid4()}"
        file_id = str(uuid4())
        if not await _store_activity_file(
            src_real,
            org_uuid,
            course_uuid,
            activity_uuid,
            ["dynamic", "blocks", block_type_folder, block_uuid],
            f"{file_id}.{ext}",
        ):
            continue

        block = Block(
            block_type=block_type,
            content=BlockFile(
                file_id=file_id,
                file_format=ext,
                file_name=fi["filename"],
                file_size=fi["size"],
                file_type=fi["file_type"],
                activity_uuid=activity_uuid,
            ).model_dump(),
            org_id=org_id,
            course_id=course_id,
            activity_id=activity_id,
            block_uuid=block_uuid,
            creation_date=now,
            update_date=now,
        )
        db_session.add(block)
        await db_session.flush()

        block_object = BlockRead.model_validate(block).model_dump(mode="json")
        if block_type == BlockTypeEnum.BLOCK_AUDIO:
            block_object.update(source_type="upload", size="medium")
            attrs = {"blockObject": block_object}
        else:
            attrs = {
                "blockObject": block_object,
                "size": {"width": 300},
                "alignment": "center",
            }
        nodes.append({"type": _BLOCK_EDITOR_NODES[block_type], "attrs": attrs})

    return {"type": "doc", "content": nodes}


async def create_course_from_migration(
    org_id: int,
    current_user,
    db_session: AsyncSession,
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

    with open(manifest_real, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    file_lookup = {fi["file_id"]: fi for fi in manifest["files"]}

    # Get org
    statement = select(Organization).where(Organization.id == org_id)
    organization = (await db_session.execute(statement)).scalars().first()
    if not organization:
        raise ValueError("Organization not found")

    org_uuid = organization.org_uuid

    # Enforce the course plan limit on the migration path too. This creates a
    # real course and previously bypassed the cap other create paths enforce.
    # Skip only if the org has no config (a prod impossibility) so a config
    # anomaly can't hard-fail a migration.
    from src.security.features_utils.usage import (
        _get_org_config,
        check_limits_with_usage,
        increase_feature_usage,
    )
    if await _get_org_config(org_id, db_session) is not None:
        await check_limits_with_usage("courses", org_id, db_session)

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
        await db_session.flush()

        # Create resource author. Resolve through the helper so API-token
        # callers record their creator as the author instead of user_id=0.
        author = ResourceAuthor(
            resource_uuid=course_uuid,
            user_id=resolve_acting_user_id(current_user),
            authorship=ResourceAuthorshipEnum.CREATOR,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
            creation_date=now,
            update_date=now,
        )
        db_session.add(author)

        chapters_created = 0
        activities_created = 0
        # (activity id, activity uuid, type) of activities that got a file,
        # indexed and transcoded once the course is committed.
        stored_activities: list[tuple[int, str, ActivityTypeEnum]] = []

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
            await db_session.flush()

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

            act_order = 0
            for act_node in chapter_node.activities:
                planned = _plan_activities(act_node, file_lookup, temp_real)
                for name, activity_type, activity_sub_type, files in planned:
                    activity_uuid = f"activity_{uuid4()}"
                    activity = Activity(
                        name=name,
                        activity_type=activity_type,
                        activity_sub_type=activity_sub_type,
                        content={},
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
                    await db_session.flush()

                    if files and activity_type in _MEDIA_FOLDERS:
                        fi, src_real = files[0]
                        ext = fi["extension"]
                        saved_filename = f"{uuid4()}.{ext}"
                        if activity_type == ActivityTypeEnum.TYPE_VIDEO:
                            # Same remux upload_file applies, so long videos seek.
                            await asyncio.to_thread(ensure_faststart, src_real)
                        if await _store_activity_file(
                            src_real,
                            org_uuid,
                            course_uuid,
                            activity_uuid,
                            [_MEDIA_FOLDERS[activity_type]],
                            saved_filename,
                        ):
                            activity.content = {
                                "filename": saved_filename,
                                "activity_uuid": activity_uuid,
                            }
                            stored_activities.append(
                                (activity.id, activity_uuid, activity_type)
                            )
                    elif files:
                        activity.content = await _build_page_from_files(
                            db_session,
                            files,
                            org_id=org_id,
                            org_uuid=org_uuid,
                            course_id=course.id,
                            course_uuid=course_uuid,
                            activity_id=activity.id,
                            activity_uuid=activity_uuid,
                            now=now,
                        )
                        stored_activities.append(
                            (activity.id, activity_uuid, activity_type)
                        )

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
                    act_order += 1
                    activities_created += 1

        await db_session.commit()

        # Same follow-up work the single-file upload paths queue.
        for activity_id, activity_uuid, activity_type in stored_activities:
            if activity_type == ActivityTypeEnum.TYPE_VIDEO:
                index_activity(activity_id, transcribe=True)
                try:
                    from src.services.utils.hls_jobs import enqueue as enqueue_hls
                    enqueue_hls(activity_uuid)
                except Exception:
                    logger.exception("Failed to enqueue HLS transcode for %s", activity_uuid)
            else:
                index_activity(activity_id)

        # Track course usage for billing, consistent with the other create paths.
        await increase_feature_usage("courses", org_id, db_session)

        # Clean up temp directory (temp_real already validated above)
        shutil.rmtree(temp_real, ignore_errors=True)

        return MigrationCreateResult(
            course_uuid=course_uuid,
            course_name=structure.course_name,
            chapters_created=chapters_created,
            activities_created=activities_created,
            success=True,
        )

    except Exception as e:
        await db_session.rollback()
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
