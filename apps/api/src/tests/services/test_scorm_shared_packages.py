"""SCORM packages shared by a course's SCO activities survive every copy.

A SCORM import keeps each package once per course
(``<course>/scorm/<package_uuid>/extracted``) and the SCO activities name it
in their content. Export, import and clone used to copy only the activities'
own folders, so the copy of a SCORM course had nothing to play.
"""

import os
import zipfile
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.activities import ActivityTypeEnum
from src.services.courses import courses as courses_service
from src.services.courses.transfer.export_service import _build_export_zip
from src.services.courses.transfer.import_service import _import_activity
from src.services.courses.transfer.scorm_packages import scorm_package_dir, scorm_package_uuid

PKG = "scorm_package_0b6a3c1e-1d2f-4a5b-9c8d-7e6f5a4b3c2d"
OTHER_PKG = "scorm_package_1b6a3c1e-1d2f-4a5b-9c8d-7e6f5a4b3c2d"


def _write_package(course_path, package_uuid=PKG, body=b"<html>sco</html>"):
    root = os.path.join(scorm_package_dir(str(course_path), package_uuid))
    os.makedirs(os.path.join(root, "a"), exist_ok=True)
    with open(os.path.join(root, "imsmanifest.xml"), "wb") as f:
        f.write(b"<manifest/>")
    with open(os.path.join(root, "a", "index.html"), "wb") as f:
        f.write(body)
    return root


class TestPackageUuid:
    def test_only_scorm_activities_with_a_well_formed_id(self):
        assert scorm_package_uuid(ActivityTypeEnum.TYPE_SCORM, {"scorm_package_uuid": PKG}) == PKG
        assert scorm_package_uuid("TYPE_SCORM", {"scorm_package_uuid": PKG}) == PKG
        assert scorm_package_uuid("TYPE_DYNAMIC", {"scorm_package_uuid": PKG}) is None
        assert scorm_package_uuid("TYPE_SCORM", {"scorm_package_uuid": "../../etc"}) is None
        assert scorm_package_uuid("TYPE_SCORM", {"scorm_package_uuid": 5}) is None
        assert scorm_package_uuid("TYPE_SCORM", None) is None
        assert scorm_package_dir("content/c/", PKG) == f"content/c/scorm/{PKG}/extracted"


def _activity(uuid, activity_type="TYPE_SCORM", content=None):
    return (
        {
            "activity_uuid": uuid,
            "name": uuid,
            "activity_type": activity_type,
            "activity_sub_type": None,
            "content": content if content is not None else {"scorm_package_uuid": PKG, "entry_point": "a/index.html"},
            "details": None,
            "published": True,
            "order": 1,
            "_id": 1,
        },
        [],
    )


class TestExport:
    def test_package_is_exported_once_at_the_course_level(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        course_path = "content/orgs/org_x/courses/course_1"
        _write_package(course_path)
        _write_package(course_path, OTHER_PKG)  # not referenced: stays out
        chapter = {"chapter_uuid": "chapter_1", "name": "Ch", "_id": 1}
        data = [(
            "course_1",
            "Course",
            {"course_uuid": "course_1"},
            [(chapter, [
                _activity("activity_a"),
                _activity("activity_b"),
                _activity("activity_c", content={"scorm_package_uuid": "../../../secrets"}),
                _activity("activity_d", activity_type="TYPE_DYNAMIC", content={"scorm_package_uuid": OTHER_PKG}),
            ])],
            [],
        )]
        path = _build_export_zip(data, "org_x")
        try:
            names = zipfile.ZipFile(path).namelist()
        finally:
            os.unlink(path)
        prefix = f"courses/course_1/scorm/{PKG}/extracted/"
        assert sorted(n for n in names if "/scorm/" in n) == [prefix + "a/index.html", prefix + "imsmanifest.xml"]


async def _import(tmp_path, org, course, chapter, activity_data, *, entitled=True, s3=False, s3_ok=True):
    activity_path = tmp_path / "pkg" / "courses" / "course_1" / "chapters" / "chapter_1" / "activities" / "activity_a"
    activity_path.mkdir(parents=True, exist_ok=True)
    new_course_path = f"content/orgs/{org.org_uuid}/courses/course_new"
    with patch(
        "src.services.courses.transfer.import_service.is_s3_enabled", return_value=s3
    ), patch(
        "src.services.courses.transfer.import_service.upload_directory_to_s3", return_value=s3_ok
    ) as upload, patch(
        "src.services.courses.transfer.import_service._org_may_host_scorm",
        new_callable=AsyncMock,
        return_value=entitled,
    ):
        activity = await _import_activity(
            activity_path=str(activity_path),
            activity_data=activity_data,
            new_course=SimpleNamespace(id=course.id),
            new_chapter=SimpleNamespace(id=chapter.id),
            new_course_path=new_course_path,
            organization=org,
            db_session=MagicMock(flush=AsyncMock()),
        )
    return activity, tmp_path / new_course_path, activity_path, upload


SCO = {"name": "SCO", "activity_type": "TYPE_SCORM", "content": {"scorm_package_uuid": PKG, "entry_point": "a/index.html"}}


class TestImport:
    async def test_shared_package_is_put_back_once(self, db, org, course, chapter, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        _write_package(tmp_path / "pkg" / "courses" / "course_1")
        activity, new_course, _, _ = await _import(tmp_path, org, course, chapter, SCO)
        target = new_course / "scorm" / PKG / "extracted" / "a" / "index.html"
        assert target.read_bytes() == b"<html>sco</html>"
        assert activity.content["scorm_package_uuid"] == PKG
        # A second SCO of the same package finds it in place.
        target.write_bytes(b"kept")
        await _import(tmp_path, org, course, chapter, SCO)
        assert target.read_bytes() == b"kept"

    async def test_not_entitled_org_gets_no_package(self, db, org, course, chapter, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        _write_package(tmp_path / "pkg" / "courses" / "course_1")
        _, new_course, _, _ = await _import(tmp_path, org, course, chapter, SCO, entitled=False)
        assert not (new_course / "scorm").exists()

    async def test_per_activity_layout_drops_the_shared_id(self, db, org, course, chapter, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        legacy = tmp_path / "pkg" / "courses" / "course_1" / "chapters" / "chapter_1" / "activities" / "activity_a"
        (legacy / "files" / "scorm" / "extracted").mkdir(parents=True)
        (legacy / "files" / "scorm" / "extracted" / "index.html").write_bytes(b"<html/>")
        activity, _, _, _ = await _import(tmp_path, org, course, chapter, SCO)
        assert "scorm_package_uuid" not in activity.content
        assert activity.content["entry_point"] == "a/index.html"

    async def test_missing_package_leaves_the_activity_as_is(self, db, org, course, chapter, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        activity, new_course, _, _ = await _import(tmp_path, org, course, chapter, SCO)
        assert activity.content["scorm_package_uuid"] == PKG
        assert not (new_course / "scorm").exists()

    async def test_package_is_uploaded_to_s3(self, db, org, course, chapter, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        _write_package(tmp_path / "pkg" / "courses" / "course_1")
        _, _, _, upload = await _import(tmp_path, org, course, chapter, SCO, s3=True)
        target = f"content/orgs/{org.org_uuid}/courses/course_new/scorm/{PKG}/extracted"
        upload.assert_any_call(target, target)

    async def test_failed_s3_upload_fails_the_import(self, db, org, course, chapter, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        _write_package(tmp_path / "pkg" / "courses" / "course_1")
        with pytest.raises(HTTPException) as exc:
            await _import(tmp_path, org, course, chapter, SCO, s3=True, s3_ok=False)
        assert exc.value.status_code == 500


class TestClone:
    async def _clone(self, source, target, content=None, activity_type=ActivityTypeEnum.TYPE_SCORM):
        original = SimpleNamespace(
            activity_uuid="activity_orig",
            name="SCO",
            activity_type=activity_type,
            activity_sub_type=None,
            content=content if content is not None else {"scorm_package_uuid": PKG},
            details=None,
            published=True,
            extra_metadata=None,
        )
        db = MagicMock(flush=AsyncMock())
        await courses_service.clone_activity(
            db, original, [], org_uuid="org_x", org_id=1, source_course_path=source,
            new_course_uuid="course_new", new_course_path=target, new_course_id=2, new_chapter_id=3, order=1,
        )

    async def test_clone_into_another_course_copies_the_package_once(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        source, target = "content/orgs/org_x/courses/course_1", "content/orgs/org_x/courses/course_new"
        _write_package(source)
        await self._clone(source, target)
        copied = tmp_path / scorm_package_dir(target, PKG) / "a" / "index.html"
        assert copied.read_bytes() == b"<html>sco</html>"
        copied.write_bytes(b"kept")
        await self._clone(source, target)
        assert copied.read_bytes() == b"kept"

    async def test_same_course_and_other_types_copy_nothing(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        source = "content/orgs/org_x/courses/course_1"
        _write_package(source)
        with patch.object(courses_service, "_copy_storage_directory") as copy:
            await self._clone(source, source)
            await self._clone(source, "content/elsewhere", activity_type=ActivityTypeEnum.TYPE_DYNAMIC)
        # Only the activity folders themselves.
        assert all("/scorm/" not in call.args[0] for call in copy.call_args_list)

    def test_storage_directory_exists_on_s3(self):
        with patch(
            "src.services.courses.transfer.storage_utils.is_s3_enabled", return_value=True
        ), patch(
            "src.services.courses.transfer.storage_utils.list_directory", side_effect=[["imsmanifest.xml"], []]
        ):
            assert courses_service._storage_directory_exists("content/x") is True
            assert courses_service._storage_directory_exists("content/y") is False
