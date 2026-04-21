"""Tests for src/services/courses/transfer/import_service.py."""

from __future__ import annotations

import json
import os
import zipfile
from io import BytesIO
from itertools import count
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from fastapi import HTTPException, UploadFile
from sqlmodel import select

from src.db.courses.activities import ActivityTypeEnum
from src.db.courses.courses import Course, ThumbnailType
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum
from src.db.users import APITokenUser
from src.services.courses.transfer.import_service import (
    _get_block_type_folder,
    _import_activity,
    _import_block,
    _import_chapter,
    _import_single_course,
    analyze_import_package,
    cleanup_old_temp_imports,
    import_courses,
    sanitize_path,
    validate_zip,
)
from src.services.courses.transfer.models import ImportOptions


def _zip_bytes(files: dict[str, bytes]) -> bytes:
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        for name, content in files.items():
            zip_file.writestr(name, content)
    return buffer.getvalue()


def _upload_file(content: bytes) -> UploadFile:
    return UploadFile(filename="package.zip", file=BytesIO(content))


def _uuid_factory():
    values = count(1)
    return lambda: UUID(int=next(values))


def _set_import_temp_dir(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "src.services.courses.transfer.import_service.TEMP_IMPORT_DIR",
        str(tmp_path),
    )


class TestImportHelpers:
    def test_validate_zip_and_sanitize_path(self):
        assert validate_zip(b"PK\x03\x04hello")
        assert not validate_zip(b"nope")
        assert sanitize_path("/%2e%2e/course//chapters/../activity/file.txt") == "course/chapters/activity/file.txt"
        assert sanitize_path("../..//evil\x00/path") == "evil/path"
        assert sanitize_path("..") == ""

    def test_sanitize_path_returns_empty_when_purepath_contains_dotdot(self):
        """Cover line 77: return '' when '..' is in PurePosixPath.parts after sanitisation."""
        from unittest.mock import patch

        class _FakePurePosixPath:
            def __init__(self, path):
                self._path = path

            @property
            def parts(self):
                # Simulate PurePosixPath unexpectedly returning '..' in parts
                return ("..", "evil")

        # PurePosixPath is imported locally inside sanitize_path via
        # "from pathlib import PurePosixPath", so we patch pathlib.PurePosixPath
        with patch("pathlib.PurePosixPath", _FakePurePosixPath):
            result = sanitize_path("course/file.txt")

        assert result == ""

    @pytest.mark.asyncio
    async def test_analyze_import_package_rejects_oversized_package(
        self, db, org, admin_user, mock_request, tmp_path, monkeypatch
    ):
        """Cover line 122: HTTPException 413 when upload exceeds MAX_PACKAGE_SIZE."""
        _set_import_temp_dir(monkeypatch, tmp_path)

        # Patch MAX_PACKAGE_SIZE to 0 so any content triggers the size limit
        monkeypatch.setattr(
            "src.services.courses.transfer.import_service.MAX_PACKAGE_SIZE", 0
        )

        # Use valid ZIP bytes (PK magic) but they'll exceed the patched limit immediately
        package_bytes = _zip_bytes({"manifest.json": b"test"})

        with patch(
            "src.services.courses.transfer.import_service.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await analyze_import_package(
                    mock_request,
                    _upload_file(package_bytes),
                    org.id,
                    admin_user,
                    db,
                )

        assert exc_info.value.status_code == 413
        assert "too large" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_analyze_import_package_skips_path_traversal_and_extracts_dirs(
        self, db, org, admin_user, mock_request, tmp_path, monkeypatch
    ):
        """Cover lines 153 (empty safe_path skip), 159 (abspath traversal skip), 162 (is_dir makedirs)."""
        import zipfile as zf
        from io import BytesIO

        _set_import_temp_dir(monkeypatch, tmp_path)

        manifest = {
            "version": "2.0.0",
            "format": "learnhouse-course-export",
            "courses": [{"course_uuid": "c1", "path": "c1"}],
        }
        course_data = {"course_uuid": "c1", "name": "Test"}

        buf = BytesIO()
        with zf.ZipFile(buf, "w", compression=zf.ZIP_STORED) as z:
            # directory entry → covers line 162 (call 1)
            dir_info = zf.ZipInfo("c1/subdir/")
            dir_info.external_attr = 0o40755 << 16
            z.writestr(dir_info, "")
            # pure dot-dot entry → sanitize_path returns '' → covers line 153 (call 2)
            z.writestr("..", b"evil")
            # valid files (calls 3 and 4)
            z.writestr("manifest.json", json.dumps(manifest))
            z.writestr("c1/course.json", json.dumps(course_data))
            # extra entry whose path will be made to escape extract_dir → covers line 159 (call 5)
            z.writestr("c1/extra.txt", b"extra")

        package_bytes = buf.getvalue()

        # Patch sanitize_path so that:
        # - call #2 (the ".." entry) returns "" → covers line 153
        # - call #3 (manifest.json) returns "../../escape" → covers line 159
        import src.services.courses.transfer.import_service as _imp

        original_sanitize = _imp.sanitize_path
        call_count = {"n": 0}

        def _patched_sanitize(path):
            call_count["n"] += 1
            if call_count["n"] == 2:
                return ""              # empty → line 153 fires
            if call_count["n"] == 5:
                return "../../escape"  # escapes extract_dir → line 159 fires
            return original_sanitize(path)

        with patch(
            "src.services.courses.transfer.import_service.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.transfer.import_service.sanitize_path",
            side_effect=_patched_sanitize,
        ):
            result = await analyze_import_package(
                mock_request,
                _upload_file(package_bytes),
                org.id,
                admin_user,
                db,
            )

        assert result.temp_id
        extract_dir = tmp_path / result.temp_id / "extracted"
        # The directory entry should have been created
        assert (extract_dir / "c1" / "subdir").is_dir()

    @pytest.mark.asyncio
    async def test_analyze_import_package_success(self, db, org, admin_user, mock_request, tmp_path, monkeypatch):
        manifest = {
            "version": "2.0.0",
            "format": "learnhouse-course-export",
            "courses": [
                {"course_uuid": "course-1", "path": "course-1"},
            ],
        }
        package_bytes = _zip_bytes(
            {
                "manifest.json": json.dumps(manifest).encode(),
                "course-1/course.json": json.dumps(
                    {
                        "course_uuid": "course-1",
                        "name": "Imported Course",
                        "description": "Course description",
                        "thumbnail_image": "thumb.png",
                    }
                ).encode(),
                "course-1/thumbnails/thumb.png": b"thumb",
                "course-1/chapters/chapter-a/activity.txt": b"ignored",
                "course-1/chapters/chapter-a/activities/activity-a/file.txt": b"file",
            }
        )
        _set_import_temp_dir(monkeypatch, tmp_path)

        with patch(
            "src.services.courses.transfer.import_service.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await analyze_import_package(
                mock_request,
                _upload_file(package_bytes),
                org.id,
                admin_user,
                db,
            )

        assert result.temp_id
        assert result.version == "2.0.0"
        assert len(result.courses) == 1
        course_info = result.courses[0]
        assert course_info.course_uuid == "course-1"
        assert course_info.name == "Imported Course"
        assert course_info.chapters_count == 1
        assert course_info.activities_count == 1
        assert course_info.has_thumbnail is True
        assert os.path.exists(tmp_path / result.temp_id / "extracted" / "manifest.json")

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "files, expected_status, expected_detail",
        [
            (
                {"manifest.json": json.dumps({"format": "wrong", "courses": []}).encode()},
                400,
                "Invalid package: Not a LearnHouse course export",
            ),
            (
                {
                    "manifest.json": json.dumps(
                        {
                            "format": "learnhouse-course-export",
                            "courses": [{"course_uuid": "course-1", "path": "missing"}],
                        }
                    ).encode(),
                },
                400,
                "Invalid package: No valid courses found",
            ),
            (
                {"manifest.json": b"{not-json"},
                400,
                "Invalid package: Could not parse JSON",
            ),
        ],
    )
    async def test_analyze_import_package_rejects_bad_manifests(
        self,
        db,
        org,
        admin_user,
        mock_request,
        tmp_path,
        monkeypatch,
        files,
        expected_status,
        expected_detail,
    ):
        _set_import_temp_dir(monkeypatch, tmp_path)
        package_bytes = _zip_bytes(files)

        with patch(
            "src.services.courses.transfer.import_service.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await analyze_import_package(
                    mock_request,
                    _upload_file(package_bytes),
                    org.id,
                    admin_user,
                    db,
                )

        assert exc_info.value.status_code == expected_status
        assert expected_detail in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_analyze_import_package_rejects_invalid_zip_and_compression_ratio(
        self,
        db,
        org,
        admin_user,
        mock_request,
        tmp_path,
        monkeypatch,
    ):
        _set_import_temp_dir(monkeypatch, tmp_path)
        big_package = _zip_bytes(
            {
                "manifest.json": json.dumps(
                    {
                        "format": "learnhouse-course-export",
                        "courses": [{"course_uuid": "course-1", "path": "course-1"}],
                    }
                ).encode(),
                "course-1/course.json": b"A" * 200_000,
            }
        )

        with patch(
            "src.services.courses.transfer.import_service.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as invalid_zip_exc:
                await analyze_import_package(
                    mock_request,
                    _upload_file(b"not-a-zip"),
                    org.id,
                    admin_user,
                    db,
                )

            with pytest.raises(HTTPException) as compression_exc:
                await analyze_import_package(
                    mock_request,
                    _upload_file(big_package),
                    org.id,
                    admin_user,
                    db,
                )

        assert invalid_zip_exc.value.status_code == 415
        assert "ZIP file" in invalid_zip_exc.value.detail
        assert compression_exc.value.status_code == 400
        assert "Suspicious compression ratio" in compression_exc.value.detail

    @pytest.mark.asyncio
    async def test_analyze_import_package_rejects_entry_count_overflow(
        self, db, org, admin_user, mock_request, tmp_path, monkeypatch
    ):
        """F-10: archives with > MAX_ENTRY_COUNT entries are refused up-front."""
        _set_import_temp_dir(monkeypatch, tmp_path)
        monkeypatch.setattr(
            "src.services.courses.transfer.import_service.MAX_ENTRY_COUNT", 2
        )
        package = _zip_bytes({"a": b"1", "b": b"2", "c": b"3"})
        with patch(
            "src.services.courses.transfer.import_service.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await analyze_import_package(
                    mock_request, _upload_file(package), org.id, admin_user, db
                )
        assert exc.value.status_code == 400
        assert "too many entries" in exc.value.detail.lower()

    @pytest.mark.asyncio
    async def test_analyze_import_package_rejects_oversized_entry(
        self, db, org, admin_user, mock_request, tmp_path, monkeypatch
    ):
        """F-10: single entry exceeding MAX_ENTRY_SIZE is refused before extraction."""
        _set_import_temp_dir(monkeypatch, tmp_path)
        monkeypatch.setattr(
            "src.services.courses.transfer.import_service.MAX_ENTRY_SIZE", 10
        )
        package = _zip_bytes({"manifest.json": b"A" * 100})
        with patch(
            "src.services.courses.transfer.import_service.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await analyze_import_package(
                    mock_request, _upload_file(package), org.id, admin_user, db
                )
        assert exc.value.status_code == 400
        assert "per-file size limit" in exc.value.detail

    @pytest.mark.asyncio
    async def test_analyze_import_package_rejects_symlink_entry(
        self, db, org, admin_user, mock_request, tmp_path, monkeypatch
    ):
        """
        F-10: zip entries with the S_IFLNK mode flag in external_attr are
        symbolic links — extracting them lets a malicious archive redirect
        later writes. We refuse the archive.
        """
        import zipfile as zf
        from io import BytesIO

        _set_import_temp_dir(monkeypatch, tmp_path)

        buf = BytesIO()
        with zf.ZipFile(buf, "w", compression=zf.ZIP_STORED) as z:
            # Minimum manifest + course.json so we pass every earlier gate.
            z.writestr(
                "manifest.json",
                json.dumps(
                    {
                        "format": "learnhouse-course-export",
                        "version": "2.0.0",
                        "courses": [{"course_uuid": "c1", "path": "c1"}],
                    }
                ),
            )
            z.writestr("c1/course.json", json.dumps({"course_uuid": "c1", "name": "x"}))
            # Symlink entry: 0xA1ED (S_IFLNK | 0o755) shifted into the upper
            # 16 bits of external_attr — matches the convention zipfile uses.
            sym_info = zf.ZipInfo("c1/evil_link")
            sym_info.external_attr = (0xA1ED) << 16
            z.writestr(sym_info, "/etc/passwd")

        with patch(
            "src.services.courses.transfer.import_service.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await analyze_import_package(
                    mock_request, _upload_file(buf.getvalue()), org.id, admin_user, db
                )
        assert exc.value.status_code == 400
        assert "symlink" in exc.value.detail.lower()

    @pytest.mark.asyncio
    async def test_analyze_import_package_handles_unexpected_errors(
        self,
        db,
        org,
        admin_user,
        mock_request,
        tmp_path,
        monkeypatch,
    ):
        _set_import_temp_dir(monkeypatch, tmp_path)
        manifest = {
            "format": "learnhouse-course-export",
            "courses": [{"course_uuid": "course-1", "path": "course-1"}],
        }
        package_bytes = _zip_bytes(
            {
                "manifest.json": json.dumps(manifest).encode(),
                "course-1/course.json": json.dumps({"course_uuid": "course-1"}).encode(),
            }
        )

        with patch(
            "src.services.courses.transfer.import_service.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.transfer.import_service.zipfile.ZipFile",
            side_effect=RuntimeError("zip exploded"),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await analyze_import_package(
                    mock_request,
                    _upload_file(package_bytes),
                    org.id,
                    admin_user,
                    db,
                )

        assert exc_info.value.status_code == 500
        assert "zip exploded" in exc_info.value.detail
        assert not any(tmp_path.iterdir())

    @pytest.mark.asyncio
    async def test_analyze_import_package_handles_missing_manifest_and_org_rbac_errors(
        self,
        db,
        org,
        admin_user,
        mock_request,
        tmp_path,
        monkeypatch,
    ):
        _set_import_temp_dir(monkeypatch, tmp_path)
        package_bytes = _zip_bytes({"course-1/course.json": b"{}"})

        with patch(
            "src.services.courses.transfer.import_service.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.transfer.import_service.os.unlink"
        ):
            with pytest.raises(HTTPException) as manifest_exc:
                await analyze_import_package(
                    mock_request,
                    _upload_file(package_bytes),
                    org.id,
                    admin_user,
                    db,
                )

        assert manifest_exc.value.status_code == 400
        assert "manifest.json not found" in manifest_exc.value.detail

        with pytest.raises(HTTPException) as org_exc:
            await analyze_import_package(
                mock_request,
                _upload_file(package_bytes),
                999,
                admin_user,
                db,
            )

        assert org_exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_analyze_import_package_missing_org(self, db, mock_request, tmp_path, monkeypatch):
        _set_import_temp_dir(monkeypatch, tmp_path)
        with pytest.raises(HTTPException) as exc_info:
            await analyze_import_package(
                mock_request,
                _upload_file(_zip_bytes({"manifest.json": b"{}"})),
                999,
                SimpleNamespace(id=1),
                db,
            )

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_import_courses_maps_results_and_cleans_workdir(
        self,
        db,
        org,
        admin_user,
        mock_request,
        tmp_path,
        monkeypatch,
    ):
        temp_id = "temp-course-package"
        temp_dir = tmp_path / temp_id / "extracted"
        temp_dir.mkdir(parents=True)
        manifest = {
            "format": "learnhouse-course-export",
            "courses": [
                {"course_uuid": "course-success", "path": "course-success"},
                {"course_uuid": "course-failure", "path": "course-failure"},
            ],
        }
        (temp_dir / "manifest.json").write_text(json.dumps(manifest))
        _set_import_temp_dir(monkeypatch, tmp_path)

        import_side_effect = [
            SimpleNamespace(course_uuid="course-new-1", name="Imported One"),
            RuntimeError("boom"),
        ]
        new_uuid_sequence = iter([UUID(int=1), UUID(int=2)])

        with patch(
            "src.services.courses.transfer.import_service.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.transfer.import_service.check_limits_with_usage"
        ) as check_limits, patch(
            "src.services.courses.transfer.import_service.increase_feature_usage"
        ) as increase_usage, patch(
            "src.services.courses.transfer.import_service.delete_storage_directory"
        ) as delete_storage_directory, patch(
            "src.services.courses.transfer.import_service._import_single_course",
            side_effect=import_side_effect,
        ), patch(
            "src.services.courses.transfer.import_service.uuid4",
            side_effect=lambda: next(new_uuid_sequence),
        ):
            result = await import_courses(
                mock_request,
                temp_id,
                org.id,
                ImportOptions(course_uuids=["course-success", "course-missing", "course-failure"]),
                admin_user,
                db,
            )

        assert result.total_courses == 3
        assert result.successful == 1
        assert result.failed == 2
        assert result.courses[0].success is True
        assert result.courses[0].new_uuid == "course-new-1"
        assert result.courses[1].success is False
        assert "Course not found in package" in result.courses[1].error
        assert result.courses[2].success is False
        assert "boom" in result.courses[2].error
        assert check_limits.call_count == 2
        increase_usage.assert_called_once_with("courses", org.id, db)
        delete_storage_directory.assert_called_once()
        assert not os.path.exists(tmp_path / f"{temp_id}-importing")

    @pytest.mark.asyncio
    async def test_import_courses_handles_missing_org_and_path_errors(
        self,
        db,
        org,
        admin_user,
        mock_request,
        tmp_path,
        monkeypatch,
    ):
        _set_import_temp_dir(monkeypatch, tmp_path)
        with pytest.raises(HTTPException) as org_exc:
            await import_courses(
                mock_request,
                "missing-temp",
                999,
                ImportOptions(course_uuids=["course-1"]),
                admin_user,
                db,
            )
        assert org_exc.value.status_code == 404

        temp_id = "temp-failed"
        work_dir = tmp_path / f"{temp_id}-importing"
        extracted_dir = work_dir / "extracted"
        extracted_dir.mkdir(parents=True)
        (extracted_dir / "manifest.json").write_text(
            json.dumps({"courses": [{"course_uuid": "course-1", "path": "course-1"}]})
        )
        (tmp_path / temp_id).mkdir()

        with patch(
            "src.services.courses.transfer.import_service.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.transfer.import_service.os.rename",
            side_effect=OSError("busy"),
        ):
            with pytest.raises(HTTPException) as locked_exc:
                await import_courses(
                    mock_request,
                    temp_id,
                    org.id,
                    ImportOptions(course_uuids=["course-1"]),
                    admin_user,
                    db,
                )

        assert locked_exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_import_single_course_handles_invalid_thumbnail_and_s3_block_copy(
        self,
        db,
        org,
        admin_user,
        tmp_path,
        monkeypatch,
    ):
        monkeypatch.chdir(tmp_path)
        course_path = tmp_path / "course-invalid"
        thumbnails_dir = course_path / "thumbnails"
        thumbnails_dir.mkdir(parents=True)
        (course_path / "course.json").write_text(
            json.dumps({"name": "Course", "thumbnail_type": "not-valid", "thumbnail_image": "thumb.png"})
        )
        (thumbnails_dir / "thumb.png").write_bytes(b"thumb")

        with patch(
            "src.services.courses.transfer.import_service.is_s3_enabled",
            return_value=True,
        ), patch(
            "src.services.courses.transfer.import_service.upload_file_to_s3",
            return_value=True,
        ), patch(
            "src.services.courses.transfer.import_service.uuid4",
            side_effect=_uuid_factory(),
        ):
            course = await _import_single_course(
                course_path=str(course_path),
                organization=org,
                current_user=admin_user,
                options=ImportOptions(course_uuids=["course-invalid"]),
                db_session=db,
                new_course_uuid="course-invalid-new",
            )

        assert course.thumbnail_type == ThumbnailType.IMAGE

        with patch(
            "src.services.courses.transfer.import_service.is_s3_enabled",
            return_value=True,
        ), patch(
            "src.services.courses.transfer.import_service.upload_directory_to_s3",
            return_value=False,
        ):
            activity_path = tmp_path / "activity-s3"
            files_dir = activity_path / "files"
            files_dir.mkdir(parents=True)
            (activity_path / "blocks").mkdir()
            (activity_path / "activity.json").write_text("{}")

            with pytest.raises(HTTPException) as upload_exc:
                await _import_activity(
                    activity_path=str(activity_path),
                    activity_data={
                        "name": "A",
                        "activity_type": "TYPE_DYNAMIC",
                        "activity_sub_type": "SUBTYPE_DYNAMIC_PAGE",
                    },
                    new_course=SimpleNamespace(id=1),
                    new_chapter=SimpleNamespace(id=1),
                    new_course_path="content/orgs/org_test/courses/course_new",
                    organization=org,
                    db_session=db,
                )

        assert upload_exc.value.status_code == 500
        assert "Failed to upload activity files" in upload_exc.value.detail

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "rename_side_effect, expected_status, expected_detail",
        [
            (FileNotFoundError(), 404, "Package not found"),
            (OSError("busy"), 409, "already being imported"),
        ],
    )
    async def test_import_courses_rejects_locking_errors(
        self,
        db,
        org,
        admin_user,
        mock_request,
        tmp_path,
        monkeypatch,
        rename_side_effect,
        expected_status,
        expected_detail,
    ):
        temp_id = "temp-locking"
        (tmp_path / temp_id / "extracted").mkdir(parents=True)
        (tmp_path / temp_id / "extracted" / "manifest.json").write_text("{}")
        monkeypatch.setattr("src.services.courses.transfer.import_service.TEMP_IMPORT_DIR", str(tmp_path))

        with patch(
            "src.services.courses.transfer.import_service.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.transfer.import_service.os.rename",
            side_effect=rename_side_effect,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await import_courses(
                    mock_request,
                    temp_id,
                    org.id,
                    ImportOptions(course_uuids=["course-1"]),
                    admin_user,
                    db,
                )

        assert exc_info.value.status_code == expected_status
        assert expected_detail in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_import_single_course_imports_thumbnail_and_author(self, db, org, admin_user, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        course_path = tmp_path / "course-import"
        thumbnails_dir = course_path / "thumbnails"
        thumbnails_dir.mkdir(parents=True)
        (course_path / "course.json").write_text(
            json.dumps(
                {
                    "name": "Original Course",
                    "description": "Description",
                    "about": "About",
                    "learnings": "Learn",
                    "tags": "tag",
                    "thumbnail_type": "not-a-real-type",
                    "thumbnail_image": "thumb.png",
                    "thumbnail_video": "video.mp4",
                    "seo": {"title": "SEO"},
                }
            )
        )
        (thumbnails_dir / "thumb.png").write_bytes(b"thumb")
        (thumbnails_dir / "video.mp4").write_bytes(b"video")

        new_course_uuid = "course-new"
        current_user = APITokenUser(
            org_id=org.id,
            created_by_user_id=admin_user.id,
            rights=None,
            token_name="api-token",
        )

        with patch(
            "src.services.courses.transfer.import_service.is_s3_enabled",
            return_value=False,
        ), patch(
            "src.services.courses.transfer.import_service.uuid4",
            side_effect=_uuid_factory(),
        ):
            new_course = await _import_single_course(
                course_path=str(course_path),
                organization=org,
                current_user=current_user,
                options=ImportOptions(course_uuids=["course-import"], name_prefix="Copy", set_private=True, set_unpublished=False),
                db_session=db,
                new_course_uuid=new_course_uuid,
            )

        persisted = db.exec(select(Course).where(Course.course_uuid == new_course_uuid)).first()
        authors = db.exec(select(ResourceAuthor).where(ResourceAuthor.resource_uuid == new_course_uuid)).all()

        assert new_course.name == "Copy Original Course"
        assert new_course.public is False
        assert new_course.published is True
        assert new_course.thumbnail_type == ThumbnailType.IMAGE
        assert new_course.thumbnail_image.startswith(new_course_uuid)
        assert new_course.thumbnail_video.startswith(new_course_uuid)
        assert new_course.thumbnail_image != "thumb.png"
        assert new_course.thumbnail_video != "video.mp4"
        assert persisted is not None
        assert persisted.seo == {"title": "SEO"}
        assert len(authors) == 1
        assert authors[0].user_id == admin_user.id
        assert authors[0].authorship == ResourceAuthorshipEnum.CREATOR

    @pytest.mark.asyncio
    async def test_import_single_course_raises_when_thumbnail_upload_fails(self, db, org, admin_user, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        course_path = tmp_path / "course-upload"
        thumbnails_dir = course_path / "thumbnails"
        thumbnails_dir.mkdir(parents=True)
        (course_path / "course.json").write_text(json.dumps({"name": "Course", "thumbnail_image": "thumb.png"}))
        (thumbnails_dir / "thumb.png").write_bytes(b"thumb")

        with patch(
            "src.services.courses.transfer.import_service.is_s3_enabled",
            return_value=True,
        ), patch(
            "src.services.courses.transfer.import_service.upload_file_to_s3",
            return_value=False,
        ), patch(
            "src.services.courses.transfer.import_service.uuid4",
            side_effect=_uuid_factory(),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await _import_single_course(
                    course_path=str(course_path),
                    organization=org,
                    current_user=admin_user,
                    options=ImportOptions(course_uuids=["course-upload"]),
                    db_session=db,
                    new_course_uuid="course-upload-new",
                )

        assert exc_info.value.status_code == 500
        assert "Failed to upload thumbnail" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_import_single_course_orders_chapters_before_importing(self, db, org, admin_user, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        course_path = tmp_path / "course-order"
        chapters_dir = course_path / "chapters"
        (chapters_dir / "chapter-b").mkdir(parents=True)
        (chapters_dir / "chapter-a").mkdir(parents=True)
        (course_path / "course.json").write_text(json.dumps({"name": "Order Test"}))
        (chapters_dir / "chapter-b" / "chapter.json").write_text(json.dumps({"name": "B", "order": 2}))
        (chapters_dir / "chapter-a" / "chapter.json").write_text(json.dumps({"name": "A", "order": 1}))

        chapter_calls = []

        async def _fake_import_chapter(**kwargs):
            chapter_calls.append(kwargs["chapter_data"]["name"])
            return SimpleNamespace()

        with patch(
            "src.services.courses.transfer.import_service._import_chapter",
            side_effect=_fake_import_chapter,
        ), patch(
            "src.services.courses.transfer.import_service.is_s3_enabled",
            return_value=False,
        ), patch(
            "src.services.courses.transfer.import_service.uuid4",
            side_effect=_uuid_factory(),
        ):
            await _import_single_course(
                course_path=str(course_path),
                organization=org,
                current_user=admin_user,
                options=ImportOptions(course_uuids=["course-order"]),
                db_session=db,
                new_course_uuid="course-order-new",
            )

        assert chapter_calls == ["A", "B"]

    @pytest.mark.asyncio
    async def test_import_chapter_orders_activities_and_calls_helper(self, db, org, course, tmp_path):
        chapter_path = tmp_path / "chapter"
        chapter_path.mkdir()
        activities_dir = chapter_path / "activities"
        (activities_dir / "activity-b").mkdir(parents=True)
        (activities_dir / "activity-a").mkdir(parents=True)
        (activities_dir / "activity-b" / "activity.json").write_text(json.dumps({"order": 2, "name": "B"}))
        (activities_dir / "activity-a" / "activity.json").write_text(json.dumps({"order": 1, "name": "A"}))

        new_course = SimpleNamespace(id=course.id)
        new_course_path = "content/orgs/org_test/courses/course_new"
        activity_calls = []

        async def _fake_import_activity(**kwargs):
            activity_calls.append(kwargs["activity_data"]["name"])
            return SimpleNamespace()

        with patch(
            "src.services.courses.transfer.import_service._import_activity",
            side_effect=_fake_import_activity,
        ):
            chapter = await _import_chapter(
                chapter_path=str(chapter_path),
                chapter_data={"name": "Chapter", "order": 2},
                new_course=new_course,
                new_course_path=new_course_path,
                organization=org,
                db_session=db,
            )

        assert chapter.name == "Chapter"
        assert activity_calls == ["A", "B"]

    @pytest.mark.asyncio
    async def test_import_activity_updates_content_and_block_references(
        self,
        db,
        org,
        course,
        chapter,
        tmp_path,
        monkeypatch,
    ):
        monkeypatch.chdir(tmp_path)
        activity_path = tmp_path / "activity"
        files_dir = activity_path / "files"
        blocks_dir = activity_path / "blocks" / "block-old"
        files_dir.mkdir(parents=True)
        blocks_dir.mkdir(parents=True)
        (blocks_dir / "block.json").write_text(
            json.dumps(
                {
                    "block_type": "BLOCK_VIDEO",
                    "content": {
                        "file_id": "old-file",
                        "activity_uuid": "old-activity",
                    },
                }
            )
        )
        (files_dir / "asset.txt").write_bytes(b"asset")

        new_course = SimpleNamespace(id=course.id)
        new_chapter = SimpleNamespace(id=chapter.id)
        new_course_path = "content/orgs/org_test/courses/course_new"
        block_updates = {
            "block_uuid": ("block-old", "block-new"),
            "activity_uuid": ("old-activity", "activity-new"),
            "file_id": ("old-file", "file-new"),
        }
        mock_db_session = MagicMock()

        with patch(
            "src.services.courses.transfer.import_service._import_block",
            new_callable=AsyncMock,
            return_value=("block-new", block_updates),
        ), patch(
            "src.services.courses.transfer.import_service.is_s3_enabled",
            return_value=False,
        ):
            activity = await _import_activity(
                activity_path=str(activity_path),
                activity_data={
                    "name": "Activity",
                    "activity_type": "invalid",
                    "activity_sub_type": "invalid",
                    "content": {
                        "block": "block-old",
                        "file_id": "old-file",
                        "activity_uuid": "old-activity",
                    },
                    "details": {"note": "keep"},
                    "published": False,
                    "order": 1,
                },
                new_course=new_course,
                new_chapter=new_chapter,
                new_course_path=new_course_path,
                organization=org,
                db_session=mock_db_session,
            )

        assert activity.activity_type == ActivityTypeEnum.TYPE_DYNAMIC
        assert activity.activity_sub_type is None
        assert activity.content == {
            "block": "block-new",
            "file_id": "file-new",
            "activity_uuid": "activity-new",
        }
        assert activity.details == {"note": "keep"}

    @pytest.mark.asyncio
    async def test_import_activity_creates_target_dir_without_source_files_and_keeps_bad_json_content(
        self,
        db,
        org,
        course,
        chapter,
        tmp_path,
        monkeypatch,
    ):
        monkeypatch.chdir(tmp_path)
        activity_path = tmp_path / "activity-empty"
        blocks_dir = activity_path / "blocks" / "block-old"
        blocks_dir.mkdir(parents=True)
        (blocks_dir / "block.json").write_text(
            json.dumps({"block_type": "BLOCK_VIDEO", "content": {"file_id": "old-file"}})
        )

        mock_db_session = MagicMock()
        original_json_loads = json.loads

        async def _fake_import_block(**kwargs):
            return "block-new", {
                "block_uuid": ("block-old", "block-new"),
                "activity_uuid": ("old-activity", "activity-new"),
                "file_id": ("old-file", "file-new"),
            }

        def _loads(text, *args, **kwargs):
            if '"block_type"' in text:
                return original_json_loads(text, *args, **kwargs)
            raise json.JSONDecodeError("boom", text, 0)

        with patch(
            "src.services.courses.transfer.import_service._import_block",
            side_effect=_fake_import_block,
        ), patch(
            "src.services.courses.transfer.import_service.json.loads",
            side_effect=_loads,
        ), patch(
            "src.services.courses.transfer.import_service.is_s3_enabled",
            return_value=False,
        ):
            activity = await _import_activity(
                activity_path=str(activity_path),
                activity_data={
                    "name": "Activity",
                    "activity_type": "TYPE_DYNAMIC",
                    "activity_sub_type": "SUBTYPE_DYNAMIC_PAGE",
                    "content": {
                        "block": "block-old",
                        "file_id": "old-file",
                        "activity_uuid": "old-activity",
                    },
                    "details": {"note": "keep"},
                    "published": False,
                    "order": 1,
                },
                new_course=SimpleNamespace(id=course.id),
                new_chapter=SimpleNamespace(id=chapter.id),
                new_course_path="content/orgs/org_test/courses/course_new",
                organization=org,
                db_session=mock_db_session,
            )

        assert activity.content == {
            "block": "block-old",
            "file_id": "old-file",
            "activity_uuid": "old-activity",
        }
        assert (tmp_path / "content/orgs/org_test/courses/course_new/activities").exists()

    @pytest.mark.asyncio
    async def test_import_block_renames_files_and_updates_references(
        self,
        db,
        org,
        course,
        chapter,
        tmp_path,
        monkeypatch,
    ):
        monkeypatch.chdir(tmp_path)
        new_activity_path = tmp_path / "content" / "orgs" / org.org_uuid / "courses" / "course_new" / "activities" / "activity_new"
        original_block_dir = new_activity_path / "dynamic" / "blocks" / "videoBlock" / "block-old"
        original_block_dir.mkdir(parents=True)
        (original_block_dir / "asset.txt").write_bytes(b"asset")

        new_activity = SimpleNamespace(id=1, activity_uuid="activity-new")
        new_course = SimpleNamespace(id=course.id)
        new_chapter = SimpleNamespace(id=chapter.id)

        with patch(
            "src.services.courses.transfer.import_service.is_s3_enabled",
            return_value=False,
        ), patch(
            "src.services.courses.transfer.import_service.uuid4",
            side_effect=_uuid_factory(),
        ):
            new_block_uuid, content_updates = await _import_block(
                block_data={
                    "block_type": "BLOCK_VIDEO",
                    "content": {
                        "file_id": "old-file",
                        "activity_uuid": "old-activity",
                    },
                },
                original_block_uuid="block-old",
                new_activity=new_activity,
                new_activity_path=str(new_activity_path),
                new_course=new_course,
                new_chapter=new_chapter,
                organization=org,
                db_session=db,
            )

        renamed_block_dir = new_activity_path / "dynamic" / "blocks" / "videoBlock" / new_block_uuid
        files = os.listdir(renamed_block_dir)
        assert content_updates["block_uuid"] == ("block-old", new_block_uuid)
        assert content_updates["activity_uuid"] == ("old-activity", "activity-new")
        assert content_updates["file_id"][0] == "old-file"
        assert renamed_block_dir.exists()
        assert not original_block_dir.exists()
        assert len(files) == 1
        assert files[0] != "asset.txt"

    @pytest.mark.asyncio
    async def test_import_block_uses_custom_type_for_invalid_block_type(
        self,
        db,
        org,
        course,
        chapter,
        tmp_path,
        monkeypatch,
    ):
        monkeypatch.chdir(tmp_path)
        new_block_uuid, content_updates = await _import_block(
            block_data={"block_type": "not-a-real-type", "content": {}},
            original_block_uuid="block-old",
            new_activity=SimpleNamespace(id=1, activity_uuid="activity-new"),
            new_activity_path=str(
                tmp_path
                / "content"
                / "orgs"
                / org.org_uuid
                / "courses"
                / "course_new"
                / "activities"
                / "activity_new"
            ),
            new_course=SimpleNamespace(id=course.id),
            new_chapter=SimpleNamespace(id=chapter.id),
            organization=org,
            db_session=db,
        )

        assert new_block_uuid.startswith("block_")
        assert content_updates["block_uuid"] == ("block-old", new_block_uuid)

    @pytest.mark.asyncio
    async def test_import_block_raises_when_uploading_renamed_file_fails(
        self,
        db,
        org,
        course,
        chapter,
        tmp_path,
        monkeypatch,
    ):
        monkeypatch.chdir(tmp_path)
        new_activity_path = tmp_path / "content" / "orgs" / org.org_uuid / "courses" / "course_new" / "activities" / "activity_new"
        original_block_dir = new_activity_path / "dynamic" / "blocks" / "videoBlock" / "block-old"
        original_block_dir.mkdir(parents=True)
        (original_block_dir / "asset.txt").write_bytes(b"asset")

        with patch(
            "src.services.courses.transfer.import_service.is_s3_enabled",
            return_value=True,
        ), patch(
            "src.services.courses.transfer.import_service.upload_file_to_s3",
            return_value=False,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await _import_block(
                    block_data={
                        "block_type": "BLOCK_VIDEO",
                        "content": {
                            "file_id": "old-file",
                            "activity_uuid": "old-activity",
                        },
                    },
                    original_block_uuid="block-old",
                    new_activity=SimpleNamespace(id=1, activity_uuid="activity-new"),
                    new_activity_path=str(new_activity_path),
                    new_course=SimpleNamespace(id=course.id),
                    new_chapter=SimpleNamespace(id=chapter.id),
                    organization=org,
                    db_session=db,
                )

        assert exc_info.value.status_code == 500
        assert "Failed to upload block file" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_import_block_deletes_old_s3_key_after_renaming_block_file(
        self,
        db,
        org,
        course,
        chapter,
        tmp_path,
        monkeypatch,
    ):
        monkeypatch.chdir(tmp_path)
        new_activity_path = tmp_path / "content" / "orgs" / org.org_uuid / "courses" / "course_new" / "activities" / "activity_new"
        original_block_dir = new_activity_path / "dynamic" / "blocks" / "videoBlock" / "block-old"
        original_block_dir.mkdir(parents=True)
        (original_block_dir / "asset.txt").write_bytes(b"asset")

        with patch(
            "src.services.courses.transfer.import_service.is_s3_enabled",
            return_value=True,
        ), patch(
            "src.services.courses.transfer.import_service.upload_file_to_s3",
            return_value=True,
        ), patch(
            "src.services.courses.transfer.import_service.delete_storage_file"
        ) as delete_storage_file, patch(
            "src.services.courses.transfer.import_service.uuid4",
            side_effect=_uuid_factory(),
        ):
            new_block_uuid, content_updates = await _import_block(
                block_data={
                    "block_type": "BLOCK_VIDEO",
                    "content": {
                        "file_id": "old-file",
                        "activity_uuid": "old-activity",
                    },
                },
                original_block_uuid="block-old",
                new_activity=SimpleNamespace(id=1, activity_uuid="activity-new"),
                new_activity_path=str(new_activity_path),
                new_course=SimpleNamespace(id=course.id),
                new_chapter=SimpleNamespace(id=chapter.id),
                organization=org,
                db_session=db,
            )

        assert content_updates["file_id"][0] == "old-file"
        delete_storage_file.assert_called_once_with(
            f"{new_activity_path}/dynamic/blocks/videoBlock/block-old/asset.txt"
        )
        assert (new_activity_path / "dynamic" / "blocks" / "videoBlock" / new_block_uuid).exists()

    @pytest.mark.parametrize(
        "block_type, expected_folder",
        [
            ("BLOCK_VIDEO", "videoBlock"),
            ("BLOCK_IMAGE", "imageBlock"),
            ("BLOCK_DOCUMENT_PDF", "pdfBlock"),
            ("BLOCK_AUDIO", None),
        ],
    )
    def test_get_block_type_folder(self, block_type, expected_folder):
        assert _get_block_type_folder(block_type) == expected_folder

    def test_cleanup_old_temp_imports_removes_stale_dirs(self, tmp_path, monkeypatch):
        stale_root = tmp_path / "stale"
        fresh_root = tmp_path / "fresh"
        stale_root.mkdir()
        fresh_root.mkdir()
        old_time = 1_000.0
        new_time = 2_000.0
        os.utime(stale_root, (old_time, old_time))
        os.utime(fresh_root, (new_time, new_time))

        _set_import_temp_dir(monkeypatch, tmp_path / "missing")
        cleanup_old_temp_imports()

        _set_import_temp_dir(monkeypatch, tmp_path)
        with patch("src.services.courses.transfer.import_service.time.time", return_value=old_time + 31 * 60):
            cleanup_old_temp_imports(max_age_minutes=30)

        assert not stale_root.exists()
        assert fresh_root.exists()
