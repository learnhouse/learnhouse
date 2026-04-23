"""
Course Import Service
Handles importing courses from ZIP packages
Supports both local filesystem and S3/R2 cloud storage
"""

import json
import os
import shutil
import time
import zipfile
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import HTTPException, Request, UploadFile
from sqlmodel import Session, select

from src.db.courses.activities import Activity, ActivityTypeEnum, ActivitySubTypeEnum
from src.db.courses.blocks import Block, BlockTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course, ThumbnailType
from src.db.organizations import Organization
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.users import PublicUser, AnonymousUser, APITokenUser
from src.security.rbac import check_resource_access, AccessAction
from src.security.features_utils.usage import check_limits_with_usage, increase_feature_usage

from .models import (
    ImportAnalysisResponse,
    ImportCourseInfo,
    ImportOptions,
    ImportResult,
    ImportCourseResult,
)
from .storage_utils import upload_directory_to_s3, upload_file_to_s3, is_s3_enabled, delete_storage_file, delete_storage_directory


# Temp storage for analyzed packages
TEMP_IMPORT_DIR = "content/temp/imports"

# Max package size: 500MB
MAX_PACKAGE_SIZE = 500 * 1024 * 1024

# Max compression ratio to prevent zip bombs
MAX_COMPRESSION_RATIO = 20

# Max individual entry size inside the archive (250MB).
MAX_ENTRY_SIZE = 250 * 1024 * 1024

# Max entry count inside the archive. Prevents inode exhaustion / "zip of zero-
# byte files" attacks even when the compression ratio looks innocent.
MAX_ENTRY_COUNT = 20000

# Zip central-directory external-attribute mask for symbolic links, in the
# upper 16 bits (Unix mode). 0xA000 is S_IFLNK. Matching the convention used
# by zipfile authors, we bail out on any entry whose mode includes this flag.
_ZIP_SYMLINK_MODE = 0xA000 << 16


def validate_zip(content: bytes) -> bool:
    """Validate that content is a valid ZIP file"""
    return content[:4] == b'PK\x03\x04' or content[:4] == b'PK\x05\x06'


def sanitize_path(path: str) -> str:
    """Sanitize file path to prevent directory traversal attacks"""
    from urllib.parse import unquote
    from pathlib import PurePosixPath
    # Decode URL-encoded characters to catch %2e%2e etc.
    path = unquote(unquote(path))
    # Strip null bytes
    path = path.replace('\x00', '')
    # Remove leading slashes and normalize
    path = path.lstrip('/\\')
    # Remove any .. components
    parts = path.replace('\\', '/').split('/')
    safe_parts = [p for p in parts if p and p != '..']
    sanitized = '/'.join(safe_parts)
    # Final check: resolve and verify no traversal remains
    resolved = PurePosixPath(sanitized)
    if '..' in resolved.parts:
        return ''
    return sanitized


async def analyze_import_package(
    request: Request,
    zip_file: UploadFile,
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> ImportAnalysisResponse:
    """
    Analyze a LearnHouse course export package.
    Returns list of courses and stores package temporarily.
    """
    # Verify organization exists
    statement = select(Organization).where(Organization.id == org_id)
    organization = db_session.exec(statement).first()
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    # RBAC check - user needs create permission for courses
    await check_resource_access(request, db_session, current_user, "course_x", AccessAction.CREATE)

    # Create temp directory for extraction
    temp_id = str(uuid4())
    temp_dir = os.path.join(TEMP_IMPORT_DIR, temp_id)

    try:
        os.makedirs(temp_dir, exist_ok=True)

        # Stream uploaded file to disk instead of reading it all into memory
        zip_path = os.path.join(temp_dir, "package.zip")
        total_size = 0
        header_bytes = b""

        with open(zip_path, 'wb') as f:
            while True:
                chunk = await zip_file.read(64 * 1024)  # 64KB chunks
                if not chunk:
                    break
                if not header_bytes:
                    header_bytes = chunk[:4]
                total_size += len(chunk)
                if total_size > MAX_PACKAGE_SIZE:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Package too large. Maximum size is {MAX_PACKAGE_SIZE / 1024 / 1024:.0f}MB"
                    )
                f.write(chunk)

        # Validate ZIP format from the bytes we already have
        if not validate_zip(header_bytes):
            raise HTTPException(
                status_code=415,
                detail="Invalid file format. Package must be a ZIP file."
            )

        # Extract ZIP with security checks
        extract_dir = os.path.join(temp_dir, "extracted")
        os.makedirs(extract_dir, exist_ok=True)

        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            infolist = zip_ref.infolist()

            # SECURITY: cap the number of entries so an archive with millions
            # of tiny files cannot exhaust inodes even when the aggregate
            # compression ratio looks reasonable.
            if len(infolist) > MAX_ENTRY_COUNT:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid package: too many entries (max {MAX_ENTRY_COUNT})"
                )

            # SECURITY: enforce per-entry size and aggregate-size caps before
            # touching disk.
            compressed_size = os.path.getsize(zip_path)
            uncompressed_size = 0
            for info in infolist:
                if info.file_size > MAX_ENTRY_SIZE:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Invalid package: entry '{info.filename}' exceeds the "
                            f"per-file size limit"
                        ),
                    )
                uncompressed_size += info.file_size

            if uncompressed_size > MAX_PACKAGE_SIZE:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid package: uncompressed size exceeds limit"
                )
            if uncompressed_size > compressed_size * MAX_COMPRESSION_RATIO:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid package: Suspicious compression ratio"
                )

            # Extract with path sanitization
            abs_extract = os.path.realpath(extract_dir)
            for info in infolist:
                # SECURITY: reject symlink entries outright — even a contained
                # symlink can be followed by later entries to write outside
                # the extract directory.
                if info.external_attr & _ZIP_SYMLINK_MODE:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Invalid package: symlink entry '{info.filename}' is not allowed"
                        ),
                    )

                safe_path = sanitize_path(info.filename)
                if not safe_path:
                    continue

                target_path = os.path.join(extract_dir, safe_path)

                # SECURITY: use realpath so any symlink already sitting inside
                # extract_dir (shouldn't happen with a fresh uuid4 tempdir but
                # defense in depth) cannot redirect the write.
                resolved = os.path.realpath(target_path)
                if not (resolved == abs_extract or resolved.startswith(abs_extract + os.sep)):
                    continue

                if info.is_dir():
                    os.makedirs(target_path, exist_ok=True)
                else:
                    os.makedirs(os.path.dirname(target_path), exist_ok=True)
                    with zip_ref.open(info) as source, open(target_path, 'wb') as target:
                        shutil.copyfileobj(source, target)

        # Delete the original ZIP now that extraction is done — free disk space
        os.unlink(zip_path)

        # Find and parse manifest.json
        manifest_path = os.path.join(extract_dir, "manifest.json")
        if not os.path.exists(manifest_path):
            raise HTTPException(
                status_code=400,
                detail="Invalid package: manifest.json not found"
            )

        with open(manifest_path, 'r') as f:
            manifest = json.load(f)

        # Validate manifest format
        if manifest.get("format") != "learnhouse-course-export":
            raise HTTPException(
                status_code=400,
                detail="Invalid package: Not a LearnHouse course export"
            )

        version = manifest.get("version", "1.0.0")

        # Analyze courses in the package
        courses_info = []
        for course_entry in manifest.get("courses", []):
            course_path = os.path.join(extract_dir, course_entry.get("path", ""))
            course_json_path = os.path.join(course_path, "course.json")

            if not os.path.exists(course_json_path):
                continue

            with open(course_json_path, 'r') as f:
                course_data = json.load(f)

            # Count chapters and activities
            chapters_count = 0
            activities_count = 0

            chapters_dir = os.path.join(course_path, "chapters")
            if os.path.exists(chapters_dir):
                for chapter_uuid in os.listdir(chapters_dir):
                    chapter_dir = os.path.join(chapters_dir, chapter_uuid)
                    if os.path.isdir(chapter_dir):
                        chapters_count += 1
                        activities_dir = os.path.join(chapter_dir, "activities")
                        if os.path.exists(activities_dir):
                            activities_count += len([
                                d for d in os.listdir(activities_dir)
                                if os.path.isdir(os.path.join(activities_dir, d))
                            ])

            # Check for thumbnail
            has_thumbnail = bool(course_data.get("thumbnail_image") or course_data.get("thumbnail_video"))

            courses_info.append(ImportCourseInfo(
                course_uuid=course_data.get("course_uuid"),
                name=course_data.get("name", "Untitled Course"),
                description=course_data.get("description"),
                chapters_count=chapters_count,
                activities_count=activities_count,
                has_thumbnail=has_thumbnail,
            ))

        if not courses_info:
            raise HTTPException(
                status_code=400,
                detail="Invalid package: No valid courses found"
            )

        return ImportAnalysisResponse(
            temp_id=temp_id,
            version=version,
            courses=courses_info,
        )

    except HTTPException:
        # Clean up on error
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    except json.JSONDecodeError as e:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(
            status_code=400,
            detail=f"Invalid package: Could not parse JSON - {str(e)}"
        )
    except Exception as e:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(
            status_code=500,
            detail=f"Error analyzing package: {str(e)}"
        )


async def import_courses(
    request: Request,
    temp_id: str,
    org_id: int,
    options: ImportOptions,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> ImportResult:
    """
    Import courses from an analyzed package.
    """
    # Verify organization exists
    statement = select(Organization).where(Organization.id == org_id)
    organization = db_session.exec(statement).first()
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    # RBAC check - user needs create permission for courses
    await check_resource_access(request, db_session, current_user, "course_x", AccessAction.CREATE)

    # Atomically claim the temp package by renaming it — prevents race if
    # two requests try to import the same temp_id simultaneously
    temp_dir = os.path.join(TEMP_IMPORT_DIR, temp_id)
    work_dir = os.path.join(TEMP_IMPORT_DIR, f"{temp_id}-importing")
    try:
        os.rename(temp_dir, work_dir)
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="Package not found. Please upload and analyze again."
        )
    except OSError:
        raise HTTPException(
            status_code=409,
            detail="This package is already being imported."
        )

    extract_dir = os.path.join(work_dir, "extracted")
    manifest_path = os.path.join(extract_dir, "manifest.json")

    with open(manifest_path, 'r') as f:
        manifest = json.load(f)

    # Build a map of course_uuid to path
    course_paths = {}
    for entry in manifest.get("courses", []):
        cid = entry.get("course_uuid")
        cpath = entry.get("path")
        if cid and cpath:
            course_paths[cid] = os.path.join(extract_dir, cpath)

    results = []
    successful = 0
    failed = 0

    for course_uuid in options.course_uuids:
        if course_uuid not in course_paths:
            results.append(ImportCourseResult(
                original_uuid=course_uuid,
                new_uuid="",
                name="",
                success=False,
                error=f"Course not found in package: {course_uuid}",
            ))
            failed += 1
            continue

        try:
            # Check usage limits
            check_limits_with_usage("courses", org_id, db_session)

            # Pre-generate the course UUID so we can clean up files on failure
            new_course_uuid = f"course_{uuid4()}"
            content_base = "content/orgs"
            new_course_content_path = f"{content_base}/{organization.org_uuid}/courses/{new_course_uuid}"

            # Use a savepoint so we can rollback just this course on failure
            # without losing previously imported courses in the batch
            nested = db_session.begin_nested()
            try:
                new_course = await _import_single_course(
                    course_path=course_paths[course_uuid],
                    organization=organization,
                    current_user=current_user,
                    options=options,
                    db_session=db_session,
                    new_course_uuid=new_course_uuid,
                )
                nested.commit()
            except Exception:
                nested.rollback()
                # Clean up any files/S3 objects written for the failed course
                delete_storage_directory(new_course_content_path)
                raise

            # Commit the outer transaction so the course is persisted
            db_session.commit()

            # Track usage AFTER commit — increase_feature_usage calls commit()
            # internally, so it must not run inside the savepoint
            increase_feature_usage("courses", organization.id, db_session)

            results.append(ImportCourseResult(
                original_uuid=course_uuid,
                new_uuid=new_course.course_uuid,
                name=new_course.name,
                success=True,
            ))
            successful += 1

        except Exception as e:
            # Reset session to a clean state so the next iteration can work
            db_session.rollback()
            results.append(ImportCourseResult(
                original_uuid=course_uuid,
                new_uuid="",
                name="",
                success=False,
                error=str(e),
            ))
            failed += 1

    # Clean up working directory after import
    shutil.rmtree(work_dir, ignore_errors=True)

    return ImportResult(
        total_courses=len(options.course_uuids),
        successful=successful,
        failed=failed,
        courses=results,
    )


async def _import_single_course(
    course_path: str,
    organization: Organization,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    options: ImportOptions,
    db_session: Session,
    new_course_uuid: str,
) -> Course:
    """
    Import a single course from the extracted package.
    """
    # Load course data
    with open(os.path.join(course_path, "course.json"), 'r') as f:
        course_data = json.load(f)

    # Apply name prefix if specified
    course_name = course_data.get("name", "Untitled Course")
    if options.name_prefix:
        course_name = f"{options.name_prefix} {course_name}"

    # Parse thumbnail type
    thumbnail_type = ThumbnailType.IMAGE
    if course_data.get("thumbnail_type"):
        try:
            thumbnail_type = ThumbnailType(course_data["thumbnail_type"])
        except ValueError:
            pass

    # Create new course
    new_course = Course(
        org_id=organization.id,
        name=course_name,
        description=course_data.get("description", ""),
        about=course_data.get("about", ""),
        learnings=course_data.get("learnings", ""),
        tags=course_data.get("tags", ""),
        thumbnail_type=thumbnail_type,
        thumbnail_image="",
        thumbnail_video="",
        public=not options.set_private,
        published=not options.set_unpublished,
        open_to_contributors=False,
        course_uuid=new_course_uuid,
        seo=course_data.get("seo"),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    # Content paths
    content_base = "content/orgs"
    new_course_path = f"{content_base}/{organization.org_uuid}/courses/{new_course_uuid}"

    # Create course directory
    os.makedirs(f"{new_course_path}/thumbnails", exist_ok=True)

    # Copy thumbnail files
    source_thumbnails = os.path.join(course_path, "thumbnails")
    if os.path.exists(source_thumbnails):
        for filename in os.listdir(source_thumbnails):
            source_file = os.path.join(source_thumbnails, filename)
            if os.path.isfile(source_file):
                # Generate new filename
                ext = filename.split('.')[-1] if '.' in filename else ''
                new_filename = f"{new_course_uuid}_thumbnail_{uuid4()}.{ext}" if ext else f"{new_course_uuid}_thumbnail_{uuid4()}"
                dest_file = os.path.join(f"{new_course_path}/thumbnails", new_filename)
                shutil.copy2(source_file, dest_file)

                # Upload to S3 if configured
                if is_s3_enabled():
                    if not upload_file_to_s3(f"{new_course_path}/thumbnails/{new_filename}", dest_file):
                        raise HTTPException(status_code=500, detail="Failed to upload thumbnail to storage")

                # Update course reference
                if course_data.get("thumbnail_image") and filename == course_data["thumbnail_image"]:
                    new_course.thumbnail_image = new_filename
                if course_data.get("thumbnail_video") and filename == course_data["thumbnail_video"]:
                    new_course.thumbnail_video = new_filename

    # Use flush (not commit) for intermediate entities — the caller manages the transaction
    db_session.add(new_course)
    db_session.flush()

    # Create resource author
    if isinstance(current_user, APITokenUser):
        author_user_id = current_user.created_by_user_id
    else:
        author_user_id = current_user.id

    resource_author = ResourceAuthor(
        resource_uuid=new_course.course_uuid,
        user_id=author_user_id,
        authorship=ResourceAuthorshipEnum.CREATOR,
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db_session.add(resource_author)
    db_session.flush()

    # Import chapters
    chapters_dir = os.path.join(course_path, "chapters")
    if os.path.exists(chapters_dir):
        # Get chapter order from JSON files
        chapter_items = []
        for chapter_uuid_dir in os.listdir(chapters_dir):
            chapter_dir_path = os.path.join(chapters_dir, chapter_uuid_dir)
            chapter_json_path = os.path.join(chapter_dir_path, "chapter.json")
            if os.path.isdir(chapter_dir_path) and os.path.exists(chapter_json_path):
                with open(chapter_json_path, 'r') as f:
                    chapter_data = json.load(f)
                chapter_items.append((chapter_uuid_dir, chapter_data))

        # Sort by order
        chapter_items.sort(key=lambda x: x[1].get("order", 0))

        for original_chapter_uuid, chapter_data in chapter_items:
            await _import_chapter(
                chapter_path=os.path.join(chapters_dir, original_chapter_uuid),
                chapter_data=chapter_data,
                new_course=new_course,
                new_course_path=new_course_path,
                organization=organization,
                db_session=db_session,
            )

    return new_course


async def _import_chapter(
    chapter_path: str,
    chapter_data: dict,
    new_course: Course,
    new_course_path: str,
    organization: Organization,
    db_session: Session,
) -> Chapter:
    """
    Import a chapter and its activities.
    """
    new_chapter_uuid = f"chapter_{uuid4()}"

    new_chapter = Chapter(
        name=chapter_data.get("name", "Untitled Chapter"),
        description=chapter_data.get("description", ""),
        thumbnail_image=chapter_data.get("thumbnail_image", ""),
        chapter_uuid=new_chapter_uuid,
        org_id=organization.id,
        course_id=new_course.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(new_chapter)
    db_session.flush()

    # Create CourseChapter link
    new_course_chapter = CourseChapter(
        course_id=new_course.id,
        chapter_id=new_chapter.id,
        org_id=organization.id,
        order=chapter_data.get("order", 0),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db_session.add(new_course_chapter)
    db_session.flush()

    # Import activities
    activities_dir = os.path.join(chapter_path, "activities")
    if os.path.exists(activities_dir):
        activity_items = []
        for activity_uuid_dir in os.listdir(activities_dir):
            activity_dir_path = os.path.join(activities_dir, activity_uuid_dir)
            activity_json_path = os.path.join(activity_dir_path, "activity.json")
            if os.path.isdir(activity_dir_path) and os.path.exists(activity_json_path):
                with open(activity_json_path, 'r') as f:
                    activity_data = json.load(f)
                activity_items.append((activity_uuid_dir, activity_data))

        # Sort by order
        activity_items.sort(key=lambda x: x[1].get("order", 0))

        for original_activity_uuid, activity_data in activity_items:
            await _import_activity(
                activity_path=os.path.join(activities_dir, original_activity_uuid),
                activity_data=activity_data,
                new_course=new_course,
                new_chapter=new_chapter,
                new_course_path=new_course_path,
                organization=organization,
                db_session=db_session,
            )

    return new_chapter


async def _import_activity(
    activity_path: str,
    activity_data: dict,
    new_course: Course,
    new_chapter: Chapter,
    new_course_path: str,
    organization: Organization,
    db_session: Session,
) -> Activity:
    """
    Import an activity and its blocks/files.
    """
    new_activity_uuid = f"activity_{uuid4()}"

    # Parse activity type
    activity_type = ActivityTypeEnum.TYPE_DYNAMIC
    if activity_data.get("activity_type"):
        try:
            activity_type = ActivityTypeEnum(activity_data["activity_type"])
        except ValueError:
            pass

    # Parse activity sub type
    activity_sub_type = None
    if activity_data.get("activity_sub_type"):
        try:
            activity_sub_type = ActivitySubTypeEnum(activity_data["activity_sub_type"])
        except ValueError:
            pass

    # Clone content (will update block references)
    new_content = dict(activity_data.get("content", {})) if activity_data.get("content") else {}
    new_details = dict(activity_data.get("details", {})) if activity_data.get("details") else {}

    new_activity = Activity(
        name=activity_data.get("name", "Untitled Activity"),
        activity_type=activity_type,
        activity_sub_type=activity_sub_type,
        content=new_content,
        details=new_details,
        published=activity_data.get("published", True),
        org_id=organization.id,
        course_id=new_course.id,
        activity_uuid=new_activity_uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(new_activity)
    db_session.flush()

    # Create ChapterActivity link
    new_chapter_activity = ChapterActivity(
        chapter_id=new_chapter.id,
        activity_id=new_activity.id,
        course_id=new_course.id,
        org_id=organization.id,
        order=activity_data.get("order", 0),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db_session.add(new_chapter_activity)
    db_session.flush()

    # Copy entire activity files directory (videos, documents, SCORM, dynamic blocks, etc.)
    new_activity_path = f"{new_course_path}/activities/{new_activity_uuid}"
    source_files_dir = os.path.join(activity_path, "files")

    if os.path.exists(source_files_dir):
        shutil.copytree(source_files_dir, new_activity_path, dirs_exist_ok=True)
        # Upload to S3 if configured
        if is_s3_enabled():
            if not upload_directory_to_s3(new_activity_path, new_activity_path):
                raise HTTPException(status_code=500, detail="Failed to upload activity files to storage")
    else:
        os.makedirs(new_activity_path, exist_ok=True)

    # Import blocks for dynamic activities
    block_uuid_map = {}
    all_content_updates = []
    blocks_dir = os.path.join(activity_path, "blocks")

    if activity_type == ActivityTypeEnum.TYPE_DYNAMIC and os.path.exists(blocks_dir):
        for original_block_uuid in os.listdir(blocks_dir):
            block_dir_path = os.path.join(blocks_dir, original_block_uuid)
            block_json_path = os.path.join(block_dir_path, "block.json")

            if os.path.isdir(block_dir_path) and os.path.exists(block_json_path):
                with open(block_json_path, 'r') as f:
                    block_data = json.load(f)

                new_block_uuid, content_updates = await _import_block(
                    block_data=block_data,
                    original_block_uuid=original_block_uuid,
                    new_activity=new_activity,
                    new_activity_path=new_activity_path,
                    new_course=new_course,
                    new_chapter=new_chapter,
                    organization=organization,
                    db_session=db_session,
                )

                block_uuid_map[original_block_uuid] = new_block_uuid
                all_content_updates.append(content_updates)

        # Update activity content to reference new block UUIDs, file_ids, and activity_uuids
        if new_content and (block_uuid_map or all_content_updates):
            content_str = json.dumps(new_content)

            # Replace block UUIDs
            for old_uuid, new_uuid in block_uuid_map.items():
                content_str = content_str.replace(f'"{old_uuid}"', f'"{new_uuid}"')

            # Replace file_ids and activity_uuids from content_updates
            for updates in all_content_updates:
                if updates.get('file_id'):
                    old_file_id, new_file_id = updates['file_id']
                    if old_file_id:
                        content_str = content_str.replace(f'"{old_file_id}"', f'"{new_file_id}"')

                if updates.get('activity_uuid'):
                    old_activity_uuid, new_activity_uuid = updates['activity_uuid']
                    if old_activity_uuid:
                        content_str = content_str.replace(f'"{old_activity_uuid}"', f'"{new_activity_uuid}"')

            try:
                new_activity.content = json.loads(content_str)
                db_session.add(new_activity)
                db_session.flush()
            except json.JSONDecodeError:
                pass  # Keep original content if parsing fails

    return new_activity


async def _import_block(
    block_data: dict,
    original_block_uuid: str,
    new_activity: Activity,
    new_activity_path: str,
    new_course: Course,
    new_chapter: Chapter,
    organization: Organization,
    db_session: Session,
) -> tuple[str, dict]:
    """
    Import a block and rename its files.
    Returns tuple of (new_block_uuid, content_updates) where content_updates contains
    the old and new values for updating activity content.
    """
    new_block_uuid = f"block_{uuid4()}"

    # Parse block type
    block_type = BlockTypeEnum.BLOCK_CUSTOM
    if block_data.get("block_type"):
        try:
            block_type = BlockTypeEnum(block_data["block_type"])
        except ValueError:
            pass

    # Clone block content
    new_block_content = dict(block_data.get("content", {})) if block_data.get("content") else {}

    # Track what needs to be updated in activity content
    content_updates = {
        'block_uuid': (original_block_uuid, new_block_uuid),
        'activity_uuid': None,
        'file_id': None,
    }

    # Get old activity_uuid before updating
    old_activity_uuid = new_block_content.get('activity_uuid')

    # Update activity_uuid reference
    if 'activity_uuid' in new_block_content:
        content_updates['activity_uuid'] = (old_activity_uuid, new_activity.activity_uuid)
        new_block_content['activity_uuid'] = new_activity.activity_uuid

    # Determine block type folder and rename copied folder from old UUID to new UUID
    block_type_folder = _get_block_type_folder(block_type.value)

    if block_type_folder:
        # The copytree already copied files with old UUIDs, we need to rename folders
        old_copied_block_path = f"{new_activity_path}/dynamic/blocks/{block_type_folder}/{original_block_uuid}"
        new_block_path = f"{new_activity_path}/dynamic/blocks/{block_type_folder}/{new_block_uuid}"

        if os.path.exists(old_copied_block_path):
            # Rename the folder to use new block UUID
            os.rename(old_copied_block_path, new_block_path)

            # Rename files inside the folder and update file references
            if os.path.exists(new_block_path):
                for filename in os.listdir(new_block_path):
                    old_file_path = f"{new_block_path}/{filename}"
                    if os.path.isfile(old_file_path):
                        # Get old file_id before renaming
                        old_file_id = new_block_content.get('file_id')

                        # Generate new file ID (UUID without prefix, matching URL structure)
                        new_file_id = str(uuid4())
                        file_ext = filename.split('.')[-1] if '.' in filename else ''
                        new_filename = f"{new_file_id}.{file_ext}" if file_ext else new_file_id
                        new_file_path = f"{new_block_path}/{new_filename}"
                        os.rename(old_file_path, new_file_path)

                        # Upload renamed file to S3 and clean up old key
                        if is_s3_enabled():
                            if not upload_file_to_s3(new_file_path, new_file_path):
                                raise HTTPException(status_code=500, detail="Failed to upload block file to storage")
                            # Delete the old S3 key (uploaded with old UUID before rename)
                            old_s3_key = f"{new_activity_path}/dynamic/blocks/{block_type_folder}/{original_block_uuid}/{filename}"
                            delete_storage_file(old_s3_key)

                        # Update file reference in block content
                        if 'file_id' in new_block_content:
                            content_updates['file_id'] = (old_file_id, new_file_id)
                            new_block_content['file_id'] = new_file_id

    new_block = Block(
        block_type=block_type,
        content=new_block_content,
        org_id=organization.id,
        course_id=new_course.id,
        chapter_id=new_chapter.id,
        activity_id=new_activity.id,
        block_uuid=new_block_uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(new_block)
    db_session.flush()

    return new_block_uuid, content_updates


def _get_block_type_folder(block_type: str) -> Optional[str]:
    """
    Get the folder name for a block type.
    """
    block_type_folders = {
        "BLOCK_VIDEO": "videoBlock",
        "BLOCK_IMAGE": "imageBlock",
        "BLOCK_DOCUMENT_PDF": "pdfBlock",
    }
    return block_type_folders.get(block_type)


def cleanup_old_temp_imports(max_age_minutes: int = 30):
    """Clean up temporary import packages older than max_age_minutes"""
    if not os.path.exists(TEMP_IMPORT_DIR):
        return

    current_time = time.time()
    max_age_seconds = max_age_minutes * 60

    for package_id in os.listdir(TEMP_IMPORT_DIR):
        package_dir = os.path.join(TEMP_IMPORT_DIR, package_id)
        if os.path.isdir(package_dir):
            # Check modification time
            mtime = os.path.getmtime(package_dir)
            if current_time - mtime > max_age_seconds:
                shutil.rmtree(package_dir, ignore_errors=True)
