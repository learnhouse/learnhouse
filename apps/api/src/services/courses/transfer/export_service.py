"""
Course Export Service
Handles exporting courses as ZIP packages
Supports both local filesystem and S3/R2 cloud storage
"""

import io
import json
import os
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
from src.security.courses_security import courses_rbac_check

from .models import ExportManifest, ExportCourseInfo
from .storage_utils import read_file_content, list_directory, walk_directory


async def export_course(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> bytes:
    """
    Export a single course as a ZIP file.

    Returns ZIP file contents as bytes.
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
) -> bytes:
    """
    Export multiple courses as a single ZIP file.

    Returns ZIP file contents as bytes.
    """
    if not course_uuids:
        raise HTTPException(status_code=400, detail="No courses specified for export")

    # Verify all courses exist and user has read access
    courses_to_export = []
    org: Optional[Organization] = None

    for course_uuid in course_uuids:
        # Get course
        statement = select(Course).where(Course.course_uuid == course_uuid)
        course = db_session.exec(statement).first()

        if not course:
            raise HTTPException(
                status_code=404,
                detail=f"Course not found: {course_uuid}",
            )

        # RBAC check - user needs read access to export
        await courses_rbac_check(request, course.course_uuid, current_user, "read", db_session)

        # Get organization (should be same for all courses in batch)
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

    # Create ZIP in memory
    zip_buffer = io.BytesIO()

    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        manifest_courses = []

        for course in courses_to_export:
            course_path = f"courses/{course.course_uuid}"

            # Export course data
            _export_course_to_zip(
                zip_file=zip_file,
                course=course,
                course_path=course_path,
                org=org,
                db_session=db_session,
            )

            manifest_courses.append(ExportCourseInfo(
                course_uuid=course.course_uuid,
                name=course.name,
                path=course_path,
            ))

        # Create manifest
        manifest = ExportManifest(
            version="1.0.0",
            format="learnhouse-course-export",
            created_at=datetime.now().isoformat(),
            courses=manifest_courses,
        )

        # Write manifest to ZIP
        zip_file.writestr(
            "manifest.json",
            json.dumps(manifest.model_dump(), indent=2),
        )

    zip_buffer.seek(0)
    return zip_buffer.getvalue()


def _export_course_to_zip(
    zip_file: zipfile.ZipFile,
    course: Course,
    course_path: str,
    org: Organization,
    db_session: Session,
) -> None:
    """
    Export a single course's data and files to the ZIP archive.
    """
    content_base = "content/orgs"
    course_content_path = f"{content_base}/{org.org_uuid}/courses/{course.course_uuid}"

    # Course data (excluding internal IDs)
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
        "seo": course.seo,
        "creation_date": course.creation_date,
        "update_date": course.update_date,
    }

    zip_file.writestr(
        f"{course_path}/course.json",
        json.dumps(course_data, indent=2),
    )

    # Export thumbnail files (from configured storage: filesystem or S3)
    thumbnails_path = f"{course_content_path}/thumbnails"
    for filename in list_directory(thumbnails_path):
        file_full_path = f"{thumbnails_path}/{filename}"
        content = read_file_content(file_full_path)
        if content:
            zip_file.writestr(f"{course_path}/thumbnails/{filename}", content)

    # Get chapters with order
    statement = (
        select(Chapter, CourseChapter)
        .join(CourseChapter, Chapter.id == CourseChapter.chapter_id)
        .where(CourseChapter.course_id == course.id)
        .order_by(CourseChapter.order)
    )
    chapter_results = db_session.exec(statement).all()

    for chapter, course_chapter in chapter_results:
        chapter_path = f"{course_path}/chapters/{chapter.chapter_uuid}"

        # Export chapter data
        chapter_data = {
            "chapter_uuid": chapter.chapter_uuid,
            "name": chapter.name,
            "description": chapter.description,
            "thumbnail_image": chapter.thumbnail_image,
            "order": course_chapter.order,
            "creation_date": chapter.creation_date,
            "update_date": chapter.update_date,
        }

        zip_file.writestr(
            f"{chapter_path}/chapter.json",
            json.dumps(chapter_data, indent=2),
        )

        # Get activities for this chapter with order
        statement = (
            select(Activity, ChapterActivity)
            .join(ChapterActivity, Activity.id == ChapterActivity.activity_id)
            .where(ChapterActivity.chapter_id == chapter.id)
            .order_by(ChapterActivity.order)
        )
        activity_results = db_session.exec(statement).all()

        for activity, chapter_activity in activity_results:
            activity_path = f"{chapter_path}/activities/{activity.activity_uuid}"

            # Export activity data
            activity_data = {
                "activity_uuid": activity.activity_uuid,
                "name": activity.name,
                "activity_type": activity.activity_type.value,
                "activity_sub_type": activity.activity_sub_type.value if activity.activity_sub_type else None,
                "content": activity.content,
                "details": activity.details,
                "published": activity.published,
                "order": chapter_activity.order,
                "creation_date": activity.creation_date,
                "update_date": activity.update_date,
            }

            zip_file.writestr(
                f"{activity_path}/activity.json",
                json.dumps(activity_data, indent=2),
            )

            # Export entire activity directory (videos, documents, SCORM, dynamic blocks, etc.)
            activity_content_path = f"{course_content_path}/activities/{activity.activity_uuid}"
            _export_directory_to_zip(
                zip_file=zip_file,
                source_path=activity_content_path,
                zip_path=f"{activity_path}/files",
            )

            # Export block metadata for dynamic activities
            if activity.activity_type.value == "TYPE_DYNAMIC":
                statement = select(Block).where(Block.activity_id == activity.id)
                blocks = db_session.exec(statement).all()

                for block in blocks:
                    block_path = f"{activity_path}/blocks/{block.block_uuid}"

                    # Export block data
                    block_data = {
                        "block_uuid": block.block_uuid,
                        "block_type": block.block_type.value,
                        "content": block.content,
                        "creation_date": block.creation_date,
                        "update_date": block.update_date,
                    }

                    zip_file.writestr(
                        f"{block_path}/block.json",
                        json.dumps(block_data, indent=2),
                    )


def _export_directory_to_zip(
    zip_file: zipfile.ZipFile,
    source_path: str,
    zip_path: str,
) -> None:
    """
    Recursively export a directory to the ZIP archive.
    Reads from configured storage (filesystem or S3) based on content_delivery setting.
    """
    for root, dirs, files in walk_directory(source_path):
        for filename in files:
            file_path = os.path.join(root, filename)
            # Calculate relative path from source
            rel_path = os.path.relpath(file_path, source_path)
            # Read content from configured storage
            content = read_file_content(file_path)
            if content:
                zip_file.writestr(f"{zip_path}/{rel_path}", content)
