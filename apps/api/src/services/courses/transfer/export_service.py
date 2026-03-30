"""
Course Export Service
Handles exporting courses as ZIP packages
Supports both local filesystem and S3/R2 cloud storage
"""

import asyncio
import copy
import json
import os
import tempfile
import zipfile
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, Request
from sqlmodel import Session, select

from src.db.courses.activities import Activity
from src.db.courses.blocks import Block
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.users import PublicUser, AnonymousUser, APITokenUser
from src.security.rbac import check_resource_access, AccessAction

from .models import ExportManifest, ExportCourseInfo
from .storage_utils import read_file_content, list_directory, walk_directory

# File extensions that are already compressed — use ZIP_STORED to skip
# re-compression, saving significant CPU on large media files.
_ALREADY_COMPRESSED = frozenset({
    '.mp4', '.webm', '.mov', '.avi', '.mkv',
    '.jpg', '.jpeg', '.png', '.webp', '.gif',
    '.mp3', '.aac', '.ogg', '.flac',
    '.pdf', '.zip', '.gz', '.bz2', '.xz', '.zst',
})


def _stored_zipinfo(entry_path: str) -> zipfile.ZipInfo:
    """Create a ZipInfo with ZIP_STORED and the current timestamp."""
    info = zipfile.ZipInfo(entry_path, date_time=datetime.now().timetuple()[:6])
    info.compress_type = zipfile.ZIP_STORED
    return info


async def export_course(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> str:
    """
    Export a single course as a ZIP file.

    Returns path to the temporary ZIP file on disk.
    """
    return await export_courses_batch(
        request=request,
        course_uuids=[course_uuid],
        current_user=current_user,
        db_session=db_session,
    )


async def export_courses_batch(
    request: Request,
    course_uuids: list[str],
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> str:
    """
    Export multiple courses as a single ZIP file.

    Returns path to the temporary ZIP file on disk (caller must delete after use).
    DB queries run on the main thread (sessions aren't thread-safe),
    then ZIP building + file I/O runs in a thread pool to avoid blocking the event loop.
    """
    if not course_uuids:
        raise HTTPException(status_code=400, detail="No courses specified for export")

    # Phase 1: Validate access and load all DB data on the main thread
    courses_to_export = []
    org: Optional[Organization] = None

    for course_uuid in course_uuids:
        statement = select(Course).where(Course.course_uuid == course_uuid)
        course = db_session.exec(statement).first()

        if not course:
            raise HTTPException(
                status_code=404,
                detail=f"Course not found: {course_uuid}",
            )

        await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

        if org is None:
            org_statement = select(Organization).where(Organization.id == course.org_id)
            org = db_session.exec(org_statement).first()
            if not org:
                raise HTTPException(status_code=404, detail="Organization not found")
        elif org.id != course.org_id:
            raise HTTPException(
                status_code=400,
                detail="All courses must belong to the same organization",
            )

        courses_to_export.append(course)

    # Pre-load all DB data needed for ZIP building (batch queries)
    course_export_data = []
    for course in courses_to_export:
        course_data, chapters = _load_course_export_data(course, db_session)
        # Extract plain values — can't access SQLModel objects from another thread
        course_export_data.append((course.course_uuid, course.name, course_data, chapters))

    # Phase 2: Build ZIP in a thread pool (file I/O — don't block event loop)
    org_uuid = org.org_uuid
    return await asyncio.to_thread(
        _build_export_zip, course_export_data, org_uuid,
    )


def _load_course_export_data(
    course: Course,
    db_session: Session,
) -> tuple[dict, list]:
    """
    Load all DB data needed to export a course. Runs on the main thread.
    Returns (course_data_dict, chapters_with_activities_and_blocks).
    """
    course_data = {
        "course_uuid": course.course_uuid,
        "name": course.name,
        "description": course.description,
        "about": course.about,
        "learnings": course.learnings,
        "tags": course.tags,
        "thumbnail_type": course.thumbnail_type.value if course.thumbnail_type else None,
        "thumbnail_image": course.thumbnail_image,
        "thumbnail_video": course.thumbnail_video,
        "public": course.public,
        "published": course.published,
        "open_to_contributors": course.open_to_contributors,
        "seo": copy.deepcopy(course.seo),
        "creation_date": course.creation_date,
        "update_date": course.update_date,
    }

    chapter_results = db_session.exec(
        select(Chapter, CourseChapter)
        .join(CourseChapter, Chapter.id == CourseChapter.chapter_id)
        .where(CourseChapter.course_id == course.id)
        .order_by(CourseChapter.order)
    ).all()

    chapter_ids = [ch.id for ch, _ in chapter_results]

    activities_by_chapter: dict[int, list] = {}
    if chapter_ids:
        all_activities = db_session.exec(
            select(Activity, ChapterActivity)
            .join(ChapterActivity, Activity.id == ChapterActivity.activity_id)
            .where(ChapterActivity.chapter_id.in_(chapter_ids))
            .order_by(ChapterActivity.order)
        ).all()
        for activity, ca in all_activities:
            activities_by_chapter.setdefault(ca.chapter_id, []).append((activity, ca))

    dynamic_activity_ids = [
        a.id for acts in activities_by_chapter.values()
        for a, _ in acts
        if a.activity_type.value == "TYPE_DYNAMIC"
    ]
    blocks_by_activity: dict[int, list[Block]] = {}
    if dynamic_activity_ids:
        all_blocks = db_session.exec(
            select(Block).where(Block.activity_id.in_(dynamic_activity_ids))
        ).all()
        for block in all_blocks:
            blocks_by_activity.setdefault(block.activity_id, []).append(block)

    # Serialize to plain dicts so the data is safe to use from another thread
    chapters = []
    for chapter, course_chapter in chapter_results:
        chapter_dict = {
            "chapter_uuid": chapter.chapter_uuid,
            "name": chapter.name,
            "description": chapter.description,
            "thumbnail_image": chapter.thumbnail_image,
            "order": course_chapter.order,
            "creation_date": chapter.creation_date,
            "update_date": chapter.update_date,
            "_id": chapter.id,
        }
        activities = []
        for activity, ca in activities_by_chapter.get(chapter.id, []):
            activity_dict = {
                "activity_uuid": activity.activity_uuid,
                "name": activity.name,
                "activity_type": activity.activity_type.value,
                "activity_sub_type": activity.activity_sub_type.value if activity.activity_sub_type else None,
                "content": copy.deepcopy(activity.content),
                "details": copy.deepcopy(activity.details),
                "published": activity.published,
                "order": ca.order,
                "creation_date": activity.creation_date,
                "update_date": activity.update_date,
                "_id": activity.id,
            }
            blocks = []
            for block in blocks_by_activity.get(activity.id, []):
                blocks.append({
                    "block_uuid": block.block_uuid,
                    "block_type": block.block_type.value,
                    "content": copy.deepcopy(block.content),
                    "creation_date": block.creation_date,
                    "update_date": block.update_date,
                })
            activities.append((activity_dict, blocks))
        chapters.append((chapter_dict, activities))

    return course_data, chapters


def _build_export_zip(
    course_export_data: list,
    org_uuid: str,
) -> str:
    """
    Build the export ZIP file on disk. Runs in a thread pool so file I/O
    (reading from filesystem/S3, writing ZIP) doesn't block the event loop.
    Only uses plain Python data — no SQLModel objects (not thread-safe).
    """
    content_base = "content/orgs"

    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".zip", prefix="learnhouse-export-")
    os.close(tmp_fd)

    try:
        with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            manifest_courses = []

            for course_uuid, course_name, course_data, chapters in course_export_data:
                course_path = f"courses/{course_uuid}"
                course_content_path = f"{content_base}/{org_uuid}/courses/{course_uuid}"

                # Write course metadata
                zip_file.writestr(
                    f"{course_path}/course.json",
                    json.dumps(course_data, indent=2),
                )

                # Export thumbnail files
                thumbnails_path = f"{course_content_path}/thumbnails"
                for filename in list_directory(thumbnails_path):
                    file_full_path = f"{thumbnails_path}/{filename}"
                    file_content = read_file_content(file_full_path)
                    if file_content:
                        entry_path = f"{course_path}/thumbnails/{filename}"
                        ext = os.path.splitext(filename)[1].lower()
                        if ext in _ALREADY_COMPRESSED:
                            zip_file.writestr(_stored_zipinfo(entry_path), file_content)
                        else:
                            zip_file.writestr(entry_path, file_content)

                # Write chapters, activities, blocks from pre-loaded data
                for chapter_dict, activities in chapters:
                    chapter_path = f"{course_path}/chapters/{chapter_dict['chapter_uuid']}"

                    # Strip internal _id before writing
                    chapter_json = {k: v for k, v in chapter_dict.items() if not k.startswith('_')}
                    zip_file.writestr(
                        f"{chapter_path}/chapter.json",
                        json.dumps(chapter_json, indent=2),
                    )

                    for activity_dict, blocks in activities:
                        activity_uuid = activity_dict["activity_uuid"]
                        activity_path = f"{chapter_path}/activities/{activity_uuid}"

                        activity_json = {k: v for k, v in activity_dict.items() if not k.startswith('_')}
                        zip_file.writestr(
                            f"{activity_path}/activity.json",
                            json.dumps(activity_json, indent=2),
                        )

                        # Export activity files (videos, documents, etc.)
                        activity_content_path = f"{course_content_path}/activities/{activity_uuid}"
                        _export_directory_to_zip(
                            zip_file=zip_file,
                            source_path=activity_content_path,
                            zip_path=f"{activity_path}/files",
                        )

                        # Export block metadata
                        for block_data in blocks:
                            block_path = f"{activity_path}/blocks/{block_data['block_uuid']}"
                            zip_file.writestr(
                                f"{block_path}/block.json",
                                json.dumps(block_data, indent=2),
                            )

                manifest_courses.append(ExportCourseInfo(
                    course_uuid=course_uuid,
                    name=course_name,
                    path=course_path,
                ))

            manifest = ExportManifest(
                version="1.0.0",
                format="learnhouse-course-export",
                created_at=datetime.now().isoformat(),
                courses=manifest_courses,
            )

            zip_file.writestr(
                "manifest.json",
                json.dumps(manifest.model_dump(), indent=2),
            )

        return tmp_path
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


def _export_directory_to_zip(
    zip_file: zipfile.ZipFile,
    source_path: str,
    zip_path: str,
) -> None:
    """
    Recursively export a directory to the ZIP archive.
    Reads from configured storage (filesystem or S3) based on content_delivery setting.
    Skips re-compression for already-compressed media files to save CPU.
    """
    for root, dirs, files in walk_directory(source_path):
        for filename in files:
            file_path = os.path.join(root, filename)
            rel_path = os.path.relpath(file_path, source_path)
            content = read_file_content(file_path)
            if content:
                entry_path = f"{zip_path}/{rel_path}"
                ext = os.path.splitext(filename)[1].lower()
                if ext in _ALREADY_COMPRESSED:
                    zip_file.writestr(_stored_zipinfo(entry_path), content)
                else:
                    zip_file.writestr(entry_path, content)
