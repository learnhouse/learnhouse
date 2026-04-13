"""Tests for src/services/courses/transfer/export_service.py."""

import json
import os
import zipfile
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.blocks import Block, BlockTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course, ThumbnailType
from src.db.organizations import Organization
from src.security.rbac import AccessAction
from src.services.courses.transfer.export_service import (
    _build_export_zip,
    _load_course_export_data,
    _stored_zipinfo,
    export_course,
    export_courses_batch,
)


def _make_course(
    db,
    org,
    *,
    id: int,
    course_uuid: str,
    name: str,
    thumbnail_type=None,
    public: bool = True,
    published: bool = True,
):
    course = Course(
        id=id,
        name=name,
        description=f"Description for {name}",
        about=f"About {name}",
        learnings=f"Learnings for {name}",
        tags="tag-one,tag-two",
        thumbnail_type=thumbnail_type,
        thumbnail_image=f"{course_uuid}.png",
        thumbnail_video=f"{course_uuid}.mp4",
        public=public,
        published=published,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid=course_uuid,
        seo={"nested": {"course_uuid": course_uuid}},
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


def _make_chapter(db, org, course, *, id: int, chapter_uuid: str, order: int, name: str):
    chapter = Chapter(
        id=id,
        name=name,
        description=f"Description for {name}",
        org_id=org.id,
        course_id=course.id,
        chapter_uuid=chapter_uuid,
        thumbnail_image=f"{chapter_uuid}.png",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(chapter)
    db.commit()
    db.refresh(chapter)
    db.add(
        CourseChapter(
            chapter_id=chapter.id,
            course_id=course.id,
            org_id=org.id,
            order=order,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    db.commit()
    return chapter


def _make_activity(
    db,
    org,
    course,
    chapter,
    *,
    id: int,
    activity_uuid: str,
    order: int,
    name: str,
    activity_type: ActivityTypeEnum,
    activity_sub_type: ActivitySubTypeEnum,
    published: bool,
    content: dict,
    details: dict | None,
):
    activity = Activity(
        id=id,
        name=name,
        activity_type=activity_type,
        activity_sub_type=activity_sub_type,
        content=content,
        details=details,
        published=published,
        org_id=org.id,
        course_id=course.id,
        activity_uuid=activity_uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)
    db.add(
        ChapterActivity(
            order=order,
            chapter_id=chapter.id,
            activity_id=activity.id,
            course_id=course.id,
            org_id=org.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    db.commit()
    return activity


def _make_block(db, org, course, chapter, activity, *, id: int, block_uuid: str, block_type: BlockTypeEnum):
    block = Block(
        id=id,
        block_type=block_type,
        content={"nested": {"block_uuid": block_uuid}},
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        block_uuid=block_uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(block)
    db.commit()
    db.refresh(block)
    return block


class TestExportCourseWrappers:
    @pytest.mark.asyncio
    async def test_export_course_delegates_to_batch(self, mock_request, db, admin_user):
        with patch(
            "src.services.courses.transfer.export_service.export_courses_batch",
            new_callable=AsyncMock,
            return_value="/tmp/export.zip",
        ) as mock_batch:
            result = await export_course(mock_request, "course_test", admin_user, db)

        assert result == "/tmp/export.zip"
        mock_batch.assert_awaited_once_with(
            request=mock_request,
            course_uuids=["course_test"],
            current_user=admin_user,
            db_session=db,
        )


class TestExportCoursesBatchValidation:
    @pytest.mark.asyncio
    async def test_export_courses_batch_rejects_empty_list(self, mock_request, db, admin_user):
        with pytest.raises(HTTPException) as exc_info:
            await export_courses_batch(mock_request, [], admin_user, db)

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail == "No courses specified for export"

    @pytest.mark.asyncio
    async def test_export_courses_batch_rejects_missing_course(self, mock_request, db, admin_user):
        with pytest.raises(HTTPException) as exc_info:
            await export_courses_batch(mock_request, ["missing-course"], admin_user, db)

        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_export_courses_batch_rejects_missing_organization(
        self, mock_request, db, admin_user
    ):
        course = _make_course(
            db,
            Organization(
                id=99,
                name="Ghost Org",
                slug="ghost-org",
                email="ghost@org.com",
                org_uuid="org_missing",
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            ),
            id=99,
            course_uuid="course_missing_org",
            name="Missing Org Course",
        )

        with patch(
            "src.services.courses.transfer.export_service.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await export_courses_batch(mock_request, [course.course_uuid], admin_user, db)

        assert exc_info.value.status_code == 404
        assert exc_info.value.detail == "Organization not found"

    @pytest.mark.asyncio
    async def test_export_courses_batch_rejects_cross_org_exports(
        self, mock_request, db, org, other_org, course, admin_user
    ):
        other_course = _make_course(
            db,
            other_org,
            id=2,
            course_uuid="course_other",
            name="Other Org Course",
        )

        with patch(
            "src.services.courses.transfer.export_service.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await export_courses_batch(
                    mock_request,
                    [course.course_uuid, other_course.course_uuid],
                    admin_user,
                    db,
                )

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail == "All courses must belong to the same organization"

    @pytest.mark.asyncio
    async def test_export_courses_batch_passes_preloaded_data_to_zip_builder(
        self, mock_request, db, course, admin_user
    ):
        with patch(
            "src.services.courses.transfer.export_service.check_resource_access",
            new_callable=AsyncMock,
        ) as mock_access, patch(
            "src.services.courses.transfer.export_service._load_course_export_data",
            return_value=({"course_uuid": course.course_uuid}, []),
        ) as mock_loader, patch(
            "src.services.courses.transfer.export_service.asyncio.to_thread",
            new_callable=AsyncMock,
            return_value="/tmp/built-export.zip",
        ) as mock_to_thread:
            result = await export_courses_batch(mock_request, [course.course_uuid], admin_user, db)

        assert result == "/tmp/built-export.zip"
        mock_access.assert_awaited_once_with(
            mock_request,
            db,
            admin_user,
            course.course_uuid,
            AccessAction.READ,
        )
        mock_loader.assert_called_once_with(course, db)
        mock_to_thread.assert_awaited_once()
        build_args = mock_to_thread.await_args.args
        assert build_args[0] == _build_export_zip
        assert build_args[1] == [("course_test", "Test Course", {"course_uuid": "course_test"}, [])]
        assert build_args[2] == "org_test"


class TestLoadCourseExportData:
    def test_load_course_export_data_serializes_chapters_activities_and_blocks(
        self, db, org, course, chapter, activity
    ):
        course.thumbnail_type = ThumbnailType.BOTH
        course.seo = {"nested": {"title": "course-title"}}
        db.add(course)
        db.commit()
        db.refresh(course)

        second_chapter = _make_chapter(
            db,
            org,
            course,
            id=2,
            chapter_uuid="chapter_second",
            order=2,
            name="Second Chapter",
        )
        dynamic_activity = _make_activity(
            db,
            org,
            course,
            chapter,
            id=2,
            activity_uuid="activity_dynamic",
            order=2,
            name="Dynamic Activity",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            published=True,
            content={"content": {"nested": ["a"]}},
            details={"details": {"nested": ["b"]}},
        )
        _make_block(
            db,
            org,
            course,
            chapter,
            dynamic_activity,
            id=1,
            block_uuid="block_dynamic",
            block_type=BlockTypeEnum.BLOCK_DOCUMENT_PDF,
        )
        _make_activity(
            db,
            org,
            course,
            second_chapter,
            id=3,
            activity_uuid="activity_video",
            order=1,
            name="Video Activity",
            activity_type=ActivityTypeEnum.TYPE_VIDEO,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
            published=False,
            content={"content": "video"},
            details=None,
        )

        course_data, chapters = _load_course_export_data(course, db)

        assert course_data["course_uuid"] == "course_test"
        assert course_data["thumbnail_type"] == ThumbnailType.BOTH.value
        assert course_data["seo"] == {"nested": {"title": "course-title"}}
        assert len(chapters) == 2

        first_chapter, first_activities = chapters[0]
        assert first_chapter["chapter_uuid"] == "chapter_test"
        assert first_chapter["_id"] == chapter.id
        assert len(first_activities) == 2

        activity_dict, blocks = first_activities[0]
        assert activity_dict["activity_uuid"] == "activity_test"
        assert activity_dict["activity_type"] == ActivityTypeEnum.TYPE_DYNAMIC.value
        assert blocks == []

        second_activity_dict, second_blocks = first_activities[1]
        assert second_activity_dict["activity_uuid"] == "activity_dynamic"
        assert second_blocks == [
            {
                "block_uuid": "block_dynamic",
                "block_type": BlockTypeEnum.BLOCK_DOCUMENT_PDF.value,
                "content": {"nested": {"block_uuid": "block_dynamic"}},
                "creation_date": second_blocks[0]["creation_date"],
                "update_date": second_blocks[0]["update_date"],
            }
        ]

    def test_load_course_export_data_handles_course_without_thumbnail_or_chapters(
        self, db, org
    ):
        empty_course = _make_course(
            db,
            org,
            id=99,
            course_uuid="course_empty",
            name="Empty Course",
        )
        empty_course.thumbnail_type = None
        db.add(empty_course)
        db.commit()
        db.refresh(empty_course)

        course_data, chapters = _load_course_export_data(empty_course, db)

        assert course_data["thumbnail_type"] is None
        assert chapters == []


class TestBuildExportZip:
    def test_build_export_zip_writes_manifest_courses_and_files(self, tmp_path):
        zip_path = tmp_path / "export.zip"
        fd = os.open(os.devnull, os.O_RDONLY)

        course_export_data = [
            (
                "course-1",
                "Course 1",
                {
                    "course_uuid": "course-1",
                    "name": "Course 1",
                    "public": True,
                },
                [
                    (
                        {
                            "chapter_uuid": "chapter-1",
                            "name": "Chapter 1",
                            "description": "Chapter 1 description",
                            "thumbnail_image": "chapter-1.png",
                            "order": 1,
                            "creation_date": "2024-01-01",
                            "update_date": "2024-01-01",
                            "_id": 11,
                        },
                        [
                            (
                                {
                                    "activity_uuid": "activity-1",
                                    "name": "Activity 1",
                                    "activity_type": ActivityTypeEnum.TYPE_DYNAMIC.value,
                                    "activity_sub_type": ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE.value,
                                    "content": {"nested": {"value": 1}},
                                    "details": {"nested": {"value": 2}},
                                    "published": True,
                                    "order": 1,
                                    "creation_date": "2024-01-01",
                                    "update_date": "2024-01-01",
                                    "_id": 21,
                                },
                                [
                                    {
                                        "block_uuid": "block-1",
                                        "block_type": BlockTypeEnum.BLOCK_DOCUMENT_PDF.value,
                                        "content": {"nested": {"block_uuid": "block-1"}},
                                        "creation_date": "2024-01-01",
                                        "update_date": "2024-01-01",
                                    }
                                ],
                            ),
                            (
                                {
                                    "activity_uuid": "activity-2",
                                    "name": "Activity 2",
                                    "activity_type": ActivityTypeEnum.TYPE_VIDEO.value,
                                    "activity_sub_type": ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED.value,
                                    "content": {"type": "video"},
                                    "details": None,
                                    "published": False,
                                    "order": 2,
                                    "creation_date": "2024-01-02",
                                    "update_date": "2024-01-02",
                                    "_id": 22,
                                },
                                [],
                            ),
                        ],
                    ),
                ],
            )
        ]

        def _read_file_content(path: str):
            mapping = {
                "content/orgs/org-1/courses/course-1/thumbnails/thumb.jpg": b"thumb-jpg",
                "content/orgs/org-1/courses/course-1/thumbnails/thumb.txt": b"thumb-txt",
                "content/orgs/org-1/courses/course-1/thumbnails/skip.bin": b"",
                "content/orgs/org-1/courses/course-1/activities/activity-1/video.mp4": b"video-bytes",
                "content/orgs/org-1/courses/course-1/activities/activity-1/doc.txt": b"doc-bytes",
            }
            return mapping.get(path, b"")

        def _walk_directory(path: str):
            if path.endswith("/activities/activity-1"):
                return [(
                    path,
                    [],
                    ["video.mp4", "doc.txt"],
                )]
            if path.endswith("/activities/activity-2"):
                return []
            return []

        with patch(
            "src.services.courses.transfer.export_service.tempfile.mkstemp",
            return_value=(fd, str(zip_path)),
        ), patch(
            "src.services.courses.transfer.export_service.list_directory",
            return_value=["thumb.jpg", "thumb.txt", "skip.bin"],
        ), patch(
            "src.services.courses.transfer.export_service.read_file_content",
            side_effect=_read_file_content,
        ), patch(
            "src.services.courses.transfer.export_service.walk_directory",
            side_effect=_walk_directory,
            ):
            result = _build_export_zip(course_export_data, "org-1")

        assert result == str(zip_path)
        with zipfile.ZipFile(result) as zf:
            names = set(zf.namelist())
            assert "manifest.json" in names
            assert "courses/course-1/course.json" in names
            assert "courses/course-1/thumbnails/thumb.jpg" in names
            assert "courses/course-1/thumbnails/thumb.txt" in names
            assert "courses/course-1/chapters/chapter-1/chapter.json" in names
            assert "courses/course-1/chapters/chapter-1/activities/activity-1/activity.json" in names
            assert "courses/course-1/chapters/chapter-1/activities/activity-1/files/video.mp4" in names
            assert "courses/course-1/chapters/chapter-1/activities/activity-1/files/doc.txt" in names
            assert "courses/course-1/chapters/chapter-1/activities/activity-1/blocks/block-1/block.json" in names

            thumb_jpg = zf.getinfo("courses/course-1/thumbnails/thumb.jpg")
            thumb_txt = zf.getinfo("courses/course-1/thumbnails/thumb.txt")
            video_mp4 = zf.getinfo(
                "courses/course-1/chapters/chapter-1/activities/activity-1/files/video.mp4"
            )
            doc_txt = zf.getinfo(
                "courses/course-1/chapters/chapter-1/activities/activity-1/files/doc.txt"
            )

            assert thumb_jpg.compress_type == zipfile.ZIP_STORED
            assert thumb_txt.compress_type == zipfile.ZIP_DEFLATED
            assert video_mp4.compress_type == zipfile.ZIP_STORED
            assert doc_txt.compress_type == zipfile.ZIP_DEFLATED

            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["format"] == "learnhouse-course-export"
            assert manifest["courses"] == [
                {
                    "course_uuid": "course-1",
                    "name": "Course 1",
                    "path": "courses/course-1",
                }
            ]

    def test_build_export_zip_cleans_up_tempfile_on_error(self, tmp_path):
        zip_path = tmp_path / "broken-export.zip"
        fd = os.open(os.devnull, os.O_RDONLY)

        with patch(
            "src.services.courses.transfer.export_service.tempfile.mkstemp",
            return_value=(fd, str(zip_path)),
        ), patch(
            "src.services.courses.transfer.export_service.list_directory",
            side_effect=RuntimeError("boom"),
        ):
            with pytest.raises(RuntimeError, match="boom"):
                _build_export_zip([("course-1", "Course 1", {}, [])], "org-1")

        assert not zip_path.exists()


class TestStoredZipInfo:
    def test_stored_zipinfo_sets_filename_and_compression_mode(self):
        info = _stored_zipinfo("courses/course-1/thumbnails/thumb.jpg")

        assert info.filename == "courses/course-1/thumbnails/thumb.jpg"
        assert info.compress_type == zipfile.ZIP_STORED
