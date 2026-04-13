"""Focused tests for src/services/courses/migration/migration_service.py."""

import json
import os
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import patch

import pytest
from sqlmodel import select

from src.db.courses.activities import Activity, ActivityTypeEnum
from src.db.courses.blocks import Block
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.db.resource_authors import ResourceAuthor
from src.services.courses.migration import migration_service as migrations
from src.services.courses.migration.models import (
    MigrationActivityNode,
    MigrationChapterNode,
    MigrationTreeStructure,
)


class _FakeUploadFile:
    def __init__(self, filename, content_type, data: bytes):
        self.filename = filename
        self.content_type = content_type
        self._data = data
        self._read = False
        self.closed = False

    async def read(self, size=-1):
        if self._read:
            return b""
        self._read = True
        return self._data

    async def close(self):
        self.closed = True


def _write_manifest(base_dir: Path, temp_id: str, files: list[dict]) -> Path:
    temp_dir = base_dir / temp_id
    temp_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = temp_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "temp_id": temp_id,
                "created_at": "2024-01-01T00:00:00+00:00",
                "files": files,
            }
        ),
        encoding="utf-8",
    )
    return temp_dir


def test_cleanup_old_temp_migrations_branches(monkeypatch, tmp_path):
    base = tmp_path / "content" / "temp" / "migrations"
    monkeypatch.setattr(migrations, "TEMP_MIGRATION_DIR", str(base))
    # Early return when the migration directory does not exist.
    migrations.cleanup_old_temp_migrations()

    old_entry = base / "old-temp"
    fresh_entry = base / "fresh-temp"
    broken_entry = base / "broken-temp"
    base.mkdir(parents=True)
    old_entry.mkdir()
    fresh_entry.mkdir()
    broken_entry.mkdir()
    os.utime(old_entry, (0, 0))
    os.utime(fresh_entry, None)

    monkeypatch.setattr(
        migrations.os.path,
        "getmtime",
        lambda path: 0 if path.endswith("old-temp") else (_ for _ in ()).throw(OSError("broken")),
    )

    migrations.cleanup_old_temp_migrations(max_age_minutes=30)

    assert not old_entry.exists()
    assert fresh_entry.exists()
    assert broken_entry.exists()


def test_uuid_and_path_helpers_and_fallback_structure():
    migrations._require_uuid(str(uuid4()), "temp_id")

    with pytest.raises(ValueError):
        migrations._require_uuid("not-a-uuid", "temp_id")

    base = os.path.realpath("/tmp/base")
    assert migrations._resolve_within(base, "child") == os.path.realpath(
        os.path.join(base, "child")
    )

    with pytest.raises(ValueError):
        migrations._resolve_within(base, "..", "escape")

    fallback = migrations._fallback_structure(
        "Course Name",
        "Course Description",
        [
            {"file_id": "file-1", "filename": "video-intro.mp4", "extension": "mp4"},
            {"file_id": "file-2", "filename": "notes.md", "extension": "md"},
        ],
    )

    assert fallback.course_name == "Course Name"
    assert fallback.chapters[0].name == "Content"
    assert fallback.chapters[0].activities[0].activity_type == ActivityTypeEnum.TYPE_VIDEO.value
    assert fallback.chapters[0].activities[1].activity_type == ActivityTypeEnum.TYPE_DYNAMIC.value


@pytest.mark.asyncio
async def test_upload_migration_files_rejects_bad_paths_and_write_errors(monkeypatch, tmp_path):
    base = tmp_path / "migrations"
    monkeypatch.setattr(migrations, "_TEMP_BASE_REAL", str(base))
    original_realpath = os.path.realpath

    bad_temp_id = str(uuid4())
    monkeypatch.setattr(
        migrations.os.path,
        "realpath",
        lambda path: str(tmp_path / "outside")
        if path.endswith(bad_temp_id)
        else original_realpath(path),
    )
    with pytest.raises(ValueError):
        await migrations.upload_migration_files([], existing_temp_id=bad_temp_id)

    existing_temp_id = str(uuid4())
    existing_temp_dir = _write_manifest(
        base,
        existing_temp_id,
        [
            {
                "file_id": "11111111-1111-1111-1111-111111111111",
                "filename": "intro.mp4",
                "file_type": "video/mp4",
                "size": 4,
                "extension": "mp4",
            }
        ],
    )
    monkeypatch.setattr(
        migrations.os.path,
        "realpath",
        lambda path: str(tmp_path / "outside")
        if path.endswith("manifest.json") and existing_temp_id in path
        else original_realpath(path),
    )
    with pytest.raises(ValueError, match="Invalid path"):
        await migrations.upload_migration_files([], existing_temp_id=existing_temp_id)

    monkeypatch.setattr(migrations.os.path, "realpath", original_realpath)
    good_file = _FakeUploadFile("intro.mp4", "video/mp4", b"video-bytes")
    blank_file = _FakeUploadFile("", "text/plain", b"")

    real_open = open

    class _FailingWriter:
        def __init__(self, handle):
            self._handle = handle

        def write(self, data):
            raise OSError("disk full")

        def __getattr__(self, name):
            return getattr(self._handle, name)

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            self._handle.close()
            return False

    def fake_open(path, mode="r", *args, **kwargs):
        if mode == "wb":
            return _FailingWriter(real_open(path, mode, *args, **kwargs))
        return real_open(path, mode, *args, **kwargs)

    with patch("builtins.open", side_effect=fake_open):
        with pytest.raises(ValueError) as exc_info:
            await migrations.upload_migration_files([blank_file, good_file])

    assert "Disk write failed" in str(exc_info.value)
    assert good_file.closed is True
    assert blank_file.closed is False
    assert existing_temp_dir.exists()


@pytest.mark.asyncio
async def test_suggest_structure_rejects_missing_manifest_and_traversal(monkeypatch, tmp_path):
    base = tmp_path / "migrations"
    monkeypatch.setattr(migrations, "_TEMP_BASE_REAL", str(base))
    original_realpath = os.path.realpath

    temp_id = str(uuid4())
    temp_dir = base / temp_id
    temp_dir.mkdir(parents=True)

    monkeypatch.setattr(
        migrations.os.path,
        "realpath",
        lambda path: str(tmp_path / "outside")
        if path.endswith(temp_id)
        else original_realpath(path),
    )
    with pytest.raises(ValueError) as exc_info:
        await migrations.suggest_structure(temp_id, "Course", None)
    assert "Invalid temp_id" in str(exc_info.value)

    monkeypatch.setattr(
        migrations.os.path,
        "realpath",
        lambda path: str(tmp_path / "outside")
        if path.endswith("manifest.json")
        else original_realpath(path),
    )
    with pytest.raises(ValueError) as exc_info:
        await migrations.suggest_structure(temp_id, "Course", None)
    assert "Invalid path" in str(exc_info.value)

    monkeypatch.setattr(migrations.os.path, "realpath", original_realpath)
    with pytest.raises(ValueError) as exc_info:
        await migrations.suggest_structure(temp_id, "Course", None)
    assert "Migration package not found" in str(exc_info.value)


@pytest.mark.asyncio
async def test_create_course_from_migration_skips_bad_files_and_validates_inputs(
    monkeypatch, tmp_path, db, org, admin_user
):
    monkeypatch.chdir(tmp_path)
    base = tmp_path / "migrations"
    monkeypatch.setattr(migrations, "_TEMP_BASE_REAL", str(base))
    monkeypatch.setattr(migrations, "is_s3_enabled", lambda: False)
    original_realpath = os.path.realpath

    temp_id = str(uuid4())
    valid_id = str(uuid4())
    traversal_id = str(uuid4())
    missing_id = str(uuid4())
    unsupported_id = str(uuid4())
    temp_dir = _write_manifest(
        base,
        temp_id,
        [
            {"file_id": valid_id, "filename": "intro.mp4", "file_type": "video/mp4", "size": 4, "extension": "mp4"},
            {"file_id": traversal_id, "filename": "escape.mp4", "file_type": "video/mp4", "size": 4, "extension": "mp4"},
            {"file_id": missing_id, "filename": "missing.mp4", "file_type": "video/mp4", "size": 4, "extension": "mp4"},
            {"file_id": unsupported_id, "filename": "notes.txt", "file_type": "text/plain", "size": 4, "extension": "txt"},
        ],
    )
    (temp_dir / f"{valid_id}.mp4").write_bytes(b"video-bytes")

    structure = MigrationTreeStructure(
        course_name="Mixed Import",
        course_description=None,
        chapters=[
            MigrationChapterNode(
                name="Chapter 1",
                activities=[
                    MigrationActivityNode(
                        name="Intro Video",
                        activity_type=ActivityTypeEnum.TYPE_VIDEO.value,
                        activity_sub_type="SUBTYPE_VIDEO_HOSTED",
                        file_ids=[
                            "not-a-uuid",
                            "22222222-2222-2222-2222-222222222222",
                            traversal_id,
                            unsupported_id,
                            missing_id,
                            valid_id,
                        ],
                    )
                ],
            )
        ],
    )

    result = await migrations.create_course_from_migration(
        org.id,
        admin_user,
        db,
        temp_id,
        structure,
    )

    assert result.success is True
    assert result.activities_created == 1
    assert db.exec(select(Course).where(Course.course_uuid == result.course_uuid)).first() is not None

    invalid_course_response = None
    with pytest.raises(ValueError) as exc_info:
        await migrations.create_course_from_migration(
            org.id,
            admin_user,
            db,
            "not-a-uuid",
            structure,
        )
    invalid_course_response = str(exc_info.value)
    assert "Invalid temp_id" in invalid_course_response

    traversal_temp_id = str(uuid4())
    _write_manifest(
        base,
        traversal_temp_id,
        [
            {
                "file_id": traversal_id,
                "filename": "escape.mp4",
                "file_type": "video/mp4",
                "size": 4,
                "extension": "mp4",
            }
        ],
    )
    monkeypatch.setattr(
        migrations.os.path,
        "realpath",
        lambda path: str(tmp_path / "outside")
        if path.endswith(f"{traversal_id}.mp4")
        else original_realpath(path),
    )
    traversal_result = await migrations.create_course_from_migration(
        org.id,
        admin_user,
        db,
        traversal_temp_id,
        structure,
    )
    assert traversal_result.success is True

    monkeypatch.setattr(migrations.os.path, "realpath", original_realpath)
    orgless_temp_id = str(uuid4())
    _write_manifest(
        base,
        orgless_temp_id,
        [
            {
                "file_id": "33333333-3333-3333-3333-333333333333",
                "filename": "orphan.mp4",
                "file_type": "video/mp4",
                "size": 4,
                "extension": "mp4",
            }
        ],
    )
    with pytest.raises(ValueError) as exc_info:
        await migrations.create_course_from_migration(
            999999,
            admin_user,
            db,
            orgless_temp_id,
            structure,
        )
    assert "Organization not found" in str(exc_info.value)


@pytest.mark.asyncio
async def test_upload_migration_files_branches(monkeypatch, tmp_path):
    base = tmp_path / "migrations"
    monkeypatch.setattr(migrations, "_TEMP_BASE_REAL", str(base))
    monkeypatch.setattr(migrations, "MAX_SINGLE_FILE_SIZE", 1)
    monkeypatch.setattr(migrations, "MAX_TOTAL_UPLOAD_SIZE", 1)

    files = [
        _FakeUploadFile("intro.mp4", "video/mp4", b"a"),
        _FakeUploadFile("bad.txt", "text/plain", b"b"),
        _FakeUploadFile("overflow.png", "image/png", b"cc"),
        _FakeUploadFile("second.mp4", "video/mp4", b"d"),
    ]

    result = await migrations.upload_migration_files(files)

    assert result.skipped == [
        "bad.txt: unsupported format",
        "overflow.png: exceeds 0GB limit",
        "second.mp4: total upload size exceeded",
    ]
    assert len(result.files) == 1
    assert files[0].closed is True
    assert (base / result.temp_id / "manifest.json").exists()

    followup = await migrations.upload_migration_files([], existing_temp_id=result.temp_id)
    assert followup.temp_id == result.temp_id
    assert followup.files == []


@pytest.mark.asyncio
async def test_suggest_structure_success_and_fallback(monkeypatch, tmp_path):
    base = tmp_path / "migrations"
    monkeypatch.setattr(migrations, "_TEMP_BASE_REAL", str(base))

    temp_id = str(uuid4())
    files = [
        {
            "file_id": "11111111-1111-1111-1111-111111111111",
            "filename": "intro.mp4",
            "file_type": "video/mp4",
            "size": 12,
            "extension": "mp4",
        }
    ]
    temp_dir = _write_manifest(base, temp_id, files)

    class _FakeModels:
        @staticmethod
        def generate_content(**kwargs):
            payload = {
                "course_name": "Suggested Course",
                "course_description": "Generated",
                "chapters": [
                    {
                        "name": "Chapter 1",
                        "activities": [
                            {
                                "name": "Intro",
                                "activity_type": "TYPE_VIDEO",
                                "activity_sub_type": "SUBTYPE_VIDEO_HOSTED",
                                "file_ids": [files[0]["file_id"]],
                            }
                        ],
                    }
                ],
            }
            return SimpleNamespace(text=f"```json\n{json.dumps(payload)}\n```")

    fake_client = SimpleNamespace(models=_FakeModels())
    monkeypatch.setattr("src.services.ai.base.get_gemini_client", lambda: fake_client)

    suggested = await migrations.suggest_structure(temp_id, "Suggested Course", "Generated")
    assert suggested.course_name == "Suggested Course"
    assert suggested.chapters[0].activities[0].name == "Intro"

    monkeypatch.setattr(
        "src.services.ai.base.get_gemini_client",
        lambda: (_ for _ in ()).throw(RuntimeError("AI unavailable")),
    )
    fallback = await migrations.suggest_structure(temp_id, "Fallback Course", None)
    assert fallback.course_name == "Fallback Course"
    assert fallback.chapters[0].name == "Content"
    assert temp_dir.exists()

    with pytest.raises(ValueError):
        await migrations.suggest_structure("not-a-uuid", "Bad", None)


@pytest.mark.asyncio
async def test_create_course_from_migration_success_and_failure(monkeypatch, tmp_path, db, org, admin_user):
    monkeypatch.chdir(tmp_path)
    base = tmp_path / "migrations"
    monkeypatch.setattr(migrations, "_TEMP_BASE_REAL", str(base))
    monkeypatch.setattr(migrations, "is_s3_enabled", lambda: False)

    temp_id = str(uuid4())
    video_id = str(uuid4())
    image_id = str(uuid4())
    temp_dir = _write_manifest(
        base,
        temp_id,
        [
            {
                "file_id": video_id,
                "filename": "intro.mp4",
                "file_type": "video/mp4",
                "size": 4,
                "extension": "mp4",
            },
            {
                "file_id": image_id,
                "filename": "cover.png",
                "file_type": "image/png",
                "size": 4,
                "extension": "png",
            },
        ],
    )
    (temp_dir / f"{video_id}.mp4").write_bytes(b"video-bytes")
    (temp_dir / f"{image_id}.png").write_bytes(b"image-bytes")

    structure = MigrationTreeStructure(
        course_name="Migrated Course",
        course_description="Imported",
        chapters=[
            MigrationChapterNode(
                name="Chapter 1",
                activities=[
                    MigrationActivityNode(
                        name="Intro Video",
                        activity_type=ActivityTypeEnum.TYPE_VIDEO.value,
                        activity_sub_type="SUBTYPE_VIDEO_HOSTED",
                        file_ids=[video_id],
                    ),
                    MigrationActivityNode(
                        name="Cover Page",
                        activity_type=ActivityTypeEnum.TYPE_DYNAMIC.value,
                        activity_sub_type="SUBTYPE_DYNAMIC_PAGE",
                        file_ids=[image_id],
                    ),
                ],
            )
        ],
    )

    result = await migrations.create_course_from_migration(
        org.id,
        admin_user,
        db,
        temp_id,
        structure,
    )

    assert result.success is True
    assert result.course_name == "Migrated Course"
    assert result.chapters_created == 1
    assert result.activities_created == 2

    course = db.exec(select(Course).where(Course.course_uuid == result.course_uuid)).first()
    assert course is not None

    chapter = db.exec(select(Chapter).where(Chapter.course_id == course.id)).first()
    assert chapter is not None
    activity_rows = db.exec(select(Activity).where(Activity.course_id == course.id)).all()
    assert len(activity_rows) == 2
    assert {activity.activity_type for activity in activity_rows} == {
        ActivityTypeEnum.TYPE_VIDEO,
        ActivityTypeEnum.TYPE_DYNAMIC,
    }

    assert db.exec(select(CourseChapter).where(CourseChapter.course_id == course.id)).first() is not None
    assert db.exec(select(ChapterActivity).where(ChapterActivity.course_id == course.id)).all()
    assert db.exec(select(Block).where(Block.course_id == course.id)).first() is not None
    assert db.exec(
        select(ResourceAuthor).where(ResourceAuthor.resource_uuid == result.course_uuid)
    ).first() is not None
    assert not temp_dir.exists()

    org_id = org.id
    failure_temp_id = str(uuid4())
    failure_file_id = str(uuid4())
    _write_manifest(
        base,
        failure_temp_id,
        [
            {
                "file_id": failure_file_id,
                "filename": "placeholder.mp4",
                "file_type": "video/mp4",
                "size": 1,
                "extension": "mp4",
            }
        ],
    )

    failure_structure = MigrationTreeStructure(
        course_name="Broken Course",
        course_description=None,
        chapters=[
            MigrationChapterNode(
                name="Chapter 1",
                activities=[
                    MigrationActivityNode(
                        name="Intro Video",
                        activity_type=ActivityTypeEnum.TYPE_VIDEO.value,
                        activity_sub_type="SUBTYPE_VIDEO_HOSTED",
                        file_ids=[failure_file_id],
                    )
                ],
            )
        ],
    )

    flush_calls = {"count": 0}

    def fake_flush():
        flush_calls["count"] += 1
        if flush_calls["count"] == 2:
            raise RuntimeError("flush failed")
        return None

    with patch.object(db, "flush", side_effect=fake_flush):
        failure = await migrations.create_course_from_migration(
            org_id,
            admin_user,
            db,
            failure_temp_id,
            failure_structure,
        )
    assert failure.success is False
    assert "flush failed" in failure.error


@pytest.mark.asyncio
async def test_create_course_from_migration_rejects_path_traversal_and_missing_manifest(
    monkeypatch, tmp_path, db, org, admin_user
):
    monkeypatch.chdir(tmp_path)
    base = tmp_path / "migrations"
    monkeypatch.setattr(migrations, "_TEMP_BASE_REAL", str(base))
    original_realpath = os.path.realpath

    structure = MigrationTreeStructure(
        course_name="Guarded Course",
        course_description=None,
        chapters=[],
    )

    temp_id = str(uuid4())
    monkeypatch.setattr(
        migrations.os.path,
        "realpath",
        lambda path: str(tmp_path / "outside")
        if path.endswith(temp_id)
        else original_realpath(path),
    )
    with pytest.raises(ValueError, match="Invalid temp_id"):
        await migrations.create_course_from_migration(
            org.id,
            admin_user,
            db,
            temp_id,
            structure,
        )

    monkeypatch.setattr(
        migrations.os.path,
        "realpath",
        lambda path: str(tmp_path / "outside")
        if path.endswith("manifest.json")
        else original_realpath(path),
    )
    with pytest.raises(ValueError, match="Invalid path"):
        await migrations.create_course_from_migration(
            org.id,
            admin_user,
            db,
            str(uuid4()),
            structure,
        )

    monkeypatch.setattr(migrations.os.path, "realpath", original_realpath)
    with pytest.raises(ValueError, match="Migration package not found"):
        await migrations.create_course_from_migration(
            org.id,
            admin_user,
            db,
            str(uuid4()),
            structure,
        )


@pytest.mark.asyncio
async def test_create_course_from_migration_covers_local_copy_and_s3_failure_branches(
    monkeypatch, tmp_path, db, org, admin_user
):
    monkeypatch.chdir(tmp_path)
    base = tmp_path / "migrations"
    monkeypatch.setattr(migrations, "_TEMP_BASE_REAL", str(base))
    original_realpath = os.path.realpath

    temp_id = str(uuid4())
    video_id = str(uuid4())
    dynamic_id = str(uuid4())
    temp_dir = _write_manifest(
        base,
        temp_id,
        [
            {
                "file_id": video_id,
                "filename": "intro.mp4",
                "file_type": "video/mp4",
                "size": 4,
                "extension": "mp4",
            },
            {
                "file_id": dynamic_id,
                "filename": "slide.webp",
                "file_type": "image/webp",
                "size": 4,
                "extension": "webp",
            },
        ],
    )
    (temp_dir / f"{video_id}.mp4").write_bytes(b"video-bytes")
    (temp_dir / f"{dynamic_id}.webp").write_bytes(b"dynamic-bytes")

    structure = MigrationTreeStructure(
        course_name="Storage Branches",
        course_description=None,
        chapters=[
            MigrationChapterNode(
                name="Chapter 1",
                activities=[
                    MigrationActivityNode(
                        name="Intro Video",
                        activity_type=ActivityTypeEnum.TYPE_VIDEO.value,
                        activity_sub_type="SUBTYPE_VIDEO_HOSTED",
                        file_ids=[video_id],
                    ),
                    MigrationActivityNode(
                        name="Dynamic Slide",
                        activity_type=ActivityTypeEnum.TYPE_DYNAMIC.value,
                        activity_sub_type="SUBTYPE_DYNAMIC_PAGE",
                        file_ids=[dynamic_id],
                    ),
                ],
            )
        ],
    )

    def dst_escape_realpath(path):
        if "/files/" in path and path.endswith(".mp4"):
            return str(tmp_path / "outside" / Path(path).name)
        if "/dynamic/blocks/" in path and path.endswith(".webp"):
            return str(tmp_path / "outside" / Path(path).name)
        return original_realpath(path)

    monkeypatch.setattr(migrations, "is_s3_enabled", lambda: False)
    monkeypatch.setattr(migrations.os.path, "realpath", dst_escape_realpath)
    result = await migrations.create_course_from_migration(
        org.id,
        admin_user,
        db,
        temp_id,
        structure,
    )
    assert result.success is True
    assert result.activities_created == 2

    failure_temp_id = str(uuid4())
    failure_video_id = str(uuid4())
    failure_dynamic_id = str(uuid4())
    failure_temp_dir = _write_manifest(
        base,
        failure_temp_id,
        [
            {
                "file_id": failure_video_id,
                "filename": "intro.mp4",
                "file_type": "video/mp4",
                "size": 4,
                "extension": "mp4",
            },
            {
                "file_id": failure_dynamic_id,
                "filename": "slide.webp",
                "file_type": "image/webp",
                "size": 4,
                "extension": "webp",
            },
        ],
    )
    (failure_temp_dir / f"{failure_video_id}.mp4").write_bytes(b"video-bytes")
    (failure_temp_dir / f"{failure_dynamic_id}.webp").write_bytes(b"dynamic-bytes")

    monkeypatch.setattr(migrations, "is_s3_enabled", lambda: True)
    monkeypatch.setattr(migrations, "upload_file_to_s3", lambda *args, **kwargs: False)
    monkeypatch.setattr(migrations.os.path, "realpath", original_realpath)
    failure_structure = MigrationTreeStructure(
        course_name="Storage Branches",
        course_description=None,
        chapters=[
            MigrationChapterNode(
                name="Chapter 1",
                activities=[
                    MigrationActivityNode(
                        name="Intro Video",
                        activity_type=ActivityTypeEnum.TYPE_VIDEO.value,
                        activity_sub_type="SUBTYPE_VIDEO_HOSTED",
                        file_ids=[failure_video_id],
                    ),
                    MigrationActivityNode(
                        name="Dynamic Slide",
                        activity_type=ActivityTypeEnum.TYPE_DYNAMIC.value,
                        activity_sub_type="SUBTYPE_DYNAMIC_PAGE",
                        file_ids=[failure_dynamic_id],
                    ),
                ],
            )
        ],
    )
    failure = await migrations.create_course_from_migration(
            org.id,
            admin_user,
            db,
            failure_temp_id,
            failure_structure,
        )
    assert failure.success is False
    assert "S3 upload failed" in failure.error


@pytest.mark.asyncio
async def test_create_course_from_migration_reports_video_s3_failure(
    monkeypatch, tmp_path, db, org, admin_user
):
    monkeypatch.chdir(tmp_path)
    base = tmp_path / "migrations"
    monkeypatch.setattr(migrations, "_TEMP_BASE_REAL", str(base))
    monkeypatch.setattr(migrations, "is_s3_enabled", lambda: True)

    temp_id = str(uuid4())
    file_id = str(uuid4())
    temp_dir = _write_manifest(
        base,
        temp_id,
        [
            {
                "file_id": file_id,
                "filename": "intro.mp4",
                "file_type": "video/mp4",
                "size": 4,
                "extension": "mp4",
            }
        ],
    )
    (temp_dir / f"{file_id}.mp4").write_bytes(b"video-bytes")

    structure = MigrationTreeStructure(
        course_name="Video Failure",
        course_description=None,
        chapters=[
            MigrationChapterNode(
                name="Chapter 1",
                activities=[
                    MigrationActivityNode(
                        name="Intro Video",
                        activity_type=ActivityTypeEnum.TYPE_VIDEO.value,
                        activity_sub_type="SUBTYPE_VIDEO_HOSTED",
                        file_ids=[file_id],
                    )
                ],
            )
        ],
    )

    monkeypatch.setattr(migrations, "upload_file_to_s3", lambda *args, **kwargs: False)
    failure = await migrations.create_course_from_migration(
            org.id,
            admin_user,
            db,
            temp_id,
            structure,
        )
    assert failure.success is False
    assert "S3 upload failed" in failure.error


@pytest.mark.asyncio
async def test_create_course_from_migration_reports_dynamic_s3_failure(
    monkeypatch, tmp_path, db, org, admin_user
):
    monkeypatch.chdir(tmp_path)
    base = tmp_path / "migrations"
    monkeypatch.setattr(migrations, "_TEMP_BASE_REAL", str(base))
    monkeypatch.setattr(migrations, "is_s3_enabled", lambda: True)

    temp_id = str(uuid4())
    file_id = str(uuid4())
    temp_dir = _write_manifest(
        base,
        temp_id,
        [
            {
                "file_id": file_id,
                "filename": "slide.webp",
                "file_type": "image/webp",
                "size": 4,
                "extension": "webp",
            }
        ],
    )
    (temp_dir / f"{file_id}.webp").write_bytes(b"dynamic-bytes")

    structure = MigrationTreeStructure(
        course_name="Dynamic Failure",
        course_description=None,
        chapters=[
            MigrationChapterNode(
                name="Chapter 1",
                activities=[
                    MigrationActivityNode(
                        name="Dynamic Slide",
                        activity_type=ActivityTypeEnum.TYPE_DYNAMIC.value,
                        activity_sub_type="SUBTYPE_DYNAMIC_PAGE",
                        file_ids=[file_id],
                    )
                ],
            )
        ],
    )

    monkeypatch.setattr(migrations, "upload_file_to_s3", lambda *args, **kwargs: False)
    failure = await migrations.create_course_from_migration(
            org.id,
            admin_user,
            db,
            temp_id,
            structure,
        )
    assert failure.success is False
    assert "S3 upload failed" in failure.error
