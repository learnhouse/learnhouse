"""Follow-ups to the round 7 content/code-execution hardening.

- Course editors pass the reader gate's paywall and lock checks, so the editor,
  test runs and grading work on paid or locked activities they manage.
- A SQL run may use a code block database owned by another activity (copied
  blocks); it is authorized against that owner. Clone and import re-root a
  code block's ``sqliteDbPath`` under the new activity.
- /code/upload-sqlite only writes under an activity of the course in the path.
- Activity creates drop client-supplied caption/HLS pipeline state.
- Course import and migration uploads apply the upload content validators.
- ffmpeg/ffprobe only open local files when reading stored media.
"""

import json
import os
import shutil
import subprocess
from datetime import datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException, Request, UploadFile
from sqlmodel import select

from src.db.courses.activities import (
    Activity,
    ActivityCreate,
    ActivityRead,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.courses import Course
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.routers import code_execution
from src.services.ai import captions
from src.services.courses.activities import access
from src.services.courses.activities.activities import (
    create_activity,
    keep_server_owned_metadata,
)
from src.services.courses.activities.pdf import create_documentpdf_activity
from src.services.courses.activities.video import (
    ExternalVideo,
    create_external_video_activity,
    create_video_activity,
)
from src.services.courses.courses import clone_course
from src.services.courses.migration import migration_service as migrations
from src.services.courses.transfer import import_service
from src.services.courses.transfer.models import ImportOptions
from src.services.courses.transfer.storage_utils import rewrite_sqlite_db_paths
from src.services.utils import hls_transcode as ht
from src.services.utils import video_processing as vp

ACTIVITIES_MOD = "src.services.courses.activities.activities"
VIDEO_MOD = "src.services.courses.activities.video"
PDF_MOD = "src.services.courses.activities.pdf"
COURSES_MOD = "src.services.courses.courses"

_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
_MP4 = b"\x00\x00\x00\x18ftypisom" + b"\x00" * 64
_SQLITE = b"SQLite format 3\x00" + b"\x00" * 64


def _now() -> str:
    return str(datetime.now())


async def _make_author(db, course, user):
    db.add(ResourceAuthor(
        resource_uuid=course.course_uuid,
        user_id=user.id,
        authorship=ResourceAuthorshipEnum.CREATOR,
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date=_now(),
        update_date=_now(),
    ))
    await db.commit()


async def _lock(db, activity):
    activity.lock_type = "restricted"
    db.add(activity)
    await db.commit()


def _fresh_request():
    # Access decisions are cached per request; a new grant needs a new one.
    return Request({"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b""})


def _unpaid():
    return patch(
        "src.services.courses.activities.access.check_ee_activity_paid_access",
        new_callable=AsyncMock, return_value=False,
    )


# ---------------------------------------------------------------------------
# Reader gate: editors pass paywall and locks
# ---------------------------------------------------------------------------


class TestReaderGateEditors:
    async def test_author_reads_a_locked_activity(
        self, db, org, course, chapter, activity, regular_user, mock_request
    ):
        await _lock(db, activity)
        with pytest.raises(HTTPException) as exc:
            await access.verify_activity_reader_access(mock_request, activity, course, regular_user, db)
        assert exc.value.status_code == 403

        await _make_author(db, course, regular_user)
        await access.verify_activity_reader_access(_fresh_request(), activity, course, regular_user, db)
        read = await access.redact_activity_for_reader(
            _fresh_request(), ActivityRead.model_validate(activity), activity, course, regular_user, db
        )
        assert read.is_locked is False
        assert read.content == {"type": "doc", "content": []}

    async def test_author_reads_an_unpaid_activity(
        self, db, org, course, chapter, activity, regular_user, mock_request
    ):
        with _unpaid():
            with pytest.raises(HTTPException) as exc:
                await access.verify_activity_reader_access(mock_request, activity, course, regular_user, db)
            assert exc.value.status_code == 402

            await _make_author(db, course, regular_user)
            await access.verify_activity_reader_access(_fresh_request(), activity, course, regular_user, db)

    async def test_admin_editor_bootstrap_keeps_paid_content(
        self, db, org, course, chapter, activity, admin_user, mock_request
    ):
        with _unpaid():
            read = await access.redact_activity_for_reader(
                mock_request, ActivityRead.model_validate(activity), activity, course, admin_user, db
            )
        assert read.content == {"type": "doc", "content": []}

    async def test_ungated_read_skips_the_editor_check(
        self, db, org, course, chapter, activity, regular_user, mock_request
    ):
        with patch.object(access, "can_edit_course", new_callable=AsyncMock) as can_edit:
            await access.verify_activity_reader_access(mock_request, activity, course, regular_user, db)
        can_edit.assert_not_awaited()


# ---------------------------------------------------------------------------
# Code execution
# ---------------------------------------------------------------------------


_OWNER_DB = (
    "orgs/org_test/courses/course_test/activities/activity_owner"
    "/dynamic/blocks/codePlayground/block_1/x_sqlite_db.sqlite3"
)


@pytest.fixture
def exec_env(monkeypatch):
    submit = AsyncMock(return_value={"status": {"id": 3}, "stdout": "1\n"})
    reader = AsyncMock(
        return_value=(SimpleNamespace(activity_uuid="activity_owner", org_id=9), object())
    )
    feature = AsyncMock(return_value=True)
    read_file = Mock(return_value=_SQLITE)
    config = SimpleNamespace(
        hosting_config=SimpleNamespace(content_delivery=SimpleNamespace(type="s3api"))
    )
    monkeypatch.setattr(code_execution, "_get_judge0_config", lambda: object())
    monkeypatch.setattr(code_execution, "check_rate_limit", lambda **_: (True, 1, 60))
    monkeypatch.setattr(code_execution, "_submit_single", submit)
    monkeypatch.setattr(code_execution, "verify_activity_reader_access_by_uuid", reader)
    monkeypatch.setattr(code_execution, "check_feature_enabled", feature)
    monkeypatch.setattr(code_execution, "_read_storage_file", read_file)
    monkeypatch.setattr(code_execution, "get_learnhouse_config", lambda: config)
    return SimpleNamespace(submit=submit, reader=reader, feature=feature, read_file=read_file)


@pytest.mark.parametrize("batch", [False, True])
async def test_sql_runs_against_a_database_owned_by_another_activity(exec_env, batch):
    if batch:
        body = code_execution.ExecuteBatchRequest(
            language_id=code_execution.SQL_LANGUAGE_ID, source_code="select 1",
            activity_uuid="activity_copy", sqlite_db_path=_OWNER_DB,
            test_cases=[{"id": "t", "label": "t", "stdin": "", "expected_stdout": "1"}],
        )
        handler = code_execution.execute_batch
    else:
        body = code_execution.ExecuteRequest(
            language_id=code_execution.SQL_LANGUAGE_ID, source_code="select 1",
            activity_uuid="activity_copy", sqlite_db_path=_OWNER_DB,
        )
        handler = code_execution.execute_code

    await handler(request=None, body=body, current_user=SimpleNamespace(id=7), db_session="db")

    # Authorized against the file's owner, and its org's plan applies.
    assert exec_env.reader.await_args.args[1] == "activity_owner"
    assert exec_env.reader.await_args.kwargs["course_uuid"] == "course_test"
    exec_env.feature.assert_awaited_once_with("courses", 9, "db")
    exec_env.read_file.assert_called_once_with(_OWNER_DB)
    exec_env.submit.assert_awaited()


async def _run_real_gate(db, request, user, activity, monkeypatch):
    submit = AsyncMock(return_value={"status": {"id": 3}, "stdout": ""})
    monkeypatch.setattr(code_execution, "_get_judge0_config", lambda: object())
    monkeypatch.setattr(code_execution, "check_rate_limit", lambda **_: (True, 1, 60))
    monkeypatch.setattr(code_execution, "_submit_single", submit)
    monkeypatch.setattr(code_execution, "check_feature_enabled", AsyncMock(return_value=True))
    body = code_execution.ExecuteRequest(
        language_id=71, source_code="print(1)", activity_uuid=activity.activity_uuid
    )
    await code_execution.execute_code(request=request, body=body, current_user=user, db_session=db)
    return submit


async def test_author_runs_code_in_a_locked_activity(
    db, org, course, chapter, activity, regular_user, mock_request, monkeypatch
):
    await _lock(db, activity)
    await _make_author(db, course, regular_user)
    submit = await _run_real_gate(db, mock_request, regular_user, activity, monkeypatch)
    submit.assert_awaited_once()


async def test_admin_runs_code_on_an_unpaid_activity(
    db, org, course, chapter, activity, admin_user, mock_request, monkeypatch
):
    with _unpaid():
        submit = await _run_real_gate(db, mock_request, admin_user, activity, monkeypatch)
    submit.assert_awaited_once()


async def test_learner_still_blocked_on_a_locked_activity(
    db, org, course, chapter, activity, regular_user, mock_request, monkeypatch
):
    await _lock(db, activity)
    with pytest.raises(HTTPException) as exc:
        await _run_real_gate(db, mock_request, regular_user, activity, monkeypatch)
    assert exc.value.status_code == 403


class TestUploadSqliteActivityScope:
    async def _upload(self, db, user, activity_uuid, monkeypatch):
        monkeypatch.setattr(code_execution, "_require_course_access", AsyncMock())
        upload = AsyncMock(return_value="sqlite_db_x.sqlite3")
        monkeypatch.setattr(code_execution, "upload_file", upload)
        result = await code_execution.upload_sqlite_db(
            request=None,
            file_object=UploadFile(filename="x.sqlite3", file=BytesIO(_SQLITE)),
            activity_uuid=activity_uuid,
            block_id="block_1",
            org_uuid="org_test",
            course_uuid="course_test",
            current_user=user,
            db_session=db,
        )
        return result, upload

    async def test_activity_of_another_course_is_refused(
        self, db, org, course, chapter, admin_user, monkeypatch
    ):
        other = Course(
            id=2, name="Other", description="", public=True, published=True,
            open_to_contributors=False, org_id=org.id, course_uuid="course_other",
            creation_date=_now(), update_date=_now(),
        )
        db.add(other)
        await db.commit()
        db.add(Activity(
            id=3, name="x", activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE, content={},
            published=True, org_id=org.id, course_id=other.id,
            activity_uuid="activity_elsewhere", creation_date=_now(), update_date=_now(),
        ))
        await db.commit()

        for activity_uuid in ("activity_elsewhere", "activity_missing"):
            with pytest.raises(HTTPException) as exc:
                await self._upload(db, admin_user, activity_uuid, monkeypatch)
            assert exc.value.status_code == 404

    async def test_activity_of_the_course_uploads(
        self, db, org, course, chapter, activity, admin_user, monkeypatch
    ):
        result, upload = await self._upload(db, admin_user, activity.activity_uuid, monkeypatch)
        upload.assert_awaited_once()
        assert result["file_path"] == (
            "orgs/org_test/courses/course_test/activities/activity_test"
            "/dynamic/blocks/codePlayground/block_1/sqlite_db_x.sqlite3"
        )


# ---------------------------------------------------------------------------
# Server-owned metadata on create
# ---------------------------------------------------------------------------


_FORGED = {"captions": {"status": "ready"}, "hls": {"status": "ready"}, "note": "kept"}


def test_keep_server_owned_metadata():
    assert keep_server_owned_metadata(_FORGED, None) == {"note": "kept"}
    assert keep_server_owned_metadata(None, {"hls": {"s": 1}}) == {"hls": {"s": 1}}
    assert keep_server_owned_metadata(_FORGED, {"captions": {"s": 1}}) == {
        "captions": {"s": 1}, "note": "kept",
    }


class TestCreateDropsPipelineState:
    async def _stored(self, db, uuid):
        return (await db.execute(
            select(Activity).where(Activity.activity_uuid == uuid)
        )).scalars().first()

    async def test_create_activity(self, db, org, course, chapter, admin_user, mock_request):
        with patch(f"{ACTIVITIES_MOD}.check_resource_access", new_callable=AsyncMock), \
                patch(f"{ACTIVITIES_MOD}.index_activity"):
            created = await create_activity(
                mock_request,
                ActivityCreate(name="A", chapter_id=chapter.id, content={}, extra_metadata=dict(_FORGED)),
                admin_user, db,
            )
            plain = await create_activity(
                mock_request, ActivityCreate(name="B", chapter_id=chapter.id, content={}),
                admin_user, db,
            )
        assert (await self._stored(db, created.activity_uuid)).extra_metadata == {"note": "kept"}
        assert (await self._stored(db, plain.activity_uuid)).extra_metadata is None

    async def test_create_external_video(self, db, org, course, chapter, admin_user, mock_request):
        with patch(f"{VIDEO_MOD}.check_resource_access", new_callable=AsyncMock), \
                patch(f"{VIDEO_MOD}.index_activity"):
            created = await create_external_video_activity(
                mock_request, admin_user,
                ExternalVideo(name="V", uri="https://youtu.be/x", type="youtube",
                              chapter_id=chapter.id, extra_metadata=dict(_FORGED)),
                db,
            )
        assert (await self._stored(db, created.activity_uuid)).extra_metadata == {"note": "kept"}

    async def test_create_hosted_video(self, db, org, course, chapter, admin_user, mock_request):
        video = UploadFile(
            filename="v.mp4", file=BytesIO(_MP4), headers={"content-type": "video/mp4"}
        )
        with patch(f"{VIDEO_MOD}.check_resource_access", new_callable=AsyncMock), \
                patch(f"{VIDEO_MOD}.index_activity"), \
                patch(f"{VIDEO_MOD}.upload_video", new_callable=AsyncMock, return_value="v.mp4"), \
                patch("src.services.utils.hls_jobs.enqueue"):
            created = await create_video_activity(
                mock_request, "V", chapter.id, admin_user, db,
                video_file=video, extra_metadata=dict(_FORGED),
            )
        assert (await self._stored(db, created.activity_uuid)).extra_metadata == {"note": "kept"}

    async def test_create_pdf(self, db, org, course, chapter, admin_user, mock_request):
        pdf = UploadFile(
            filename="d.pdf", file=BytesIO(b"%PDF-1.4"), headers={"content-type": "application/pdf"}
        )
        with patch(f"{PDF_MOD}.check_resource_access", new_callable=AsyncMock), \
                patch(f"{PDF_MOD}.index_activity"), \
                patch(f"{PDF_MOD}.upload_pdf", new_callable=AsyncMock, return_value="d.pdf"):
            created = await create_documentpdf_activity(
                mock_request, "D", chapter.id, admin_user, db,
                pdf_file=pdf, extra_metadata=dict(_FORGED),
            )
        assert (await self._stored(db, created.activity_uuid)).extra_metadata == {"note": "kept"}


# ---------------------------------------------------------------------------
# sqliteDbPath on clone / import
# ---------------------------------------------------------------------------


_OLD_ROOT = "orgs/org_a/courses/course_a/activities/activity_old"
_NEW_ROOT = "orgs/org_b/courses/course_b/activities/activity_new"


def _code_doc(path):
    return {"type": "doc", "content": [
        {"type": "paragraph"},
        {"type": "codePlayground", "attrs": {"sqliteDbPath": path, "languageId": 82}},
    ]}


def test_rewrite_sqlite_db_paths():
    own = f"{_OLD_ROOT}/dynamic/blocks/codePlayground/b/db.sqlite3"
    other = "orgs/org_a/courses/course_a/activities/activity_other/dynamic/blocks/codePlayground/b/db.sqlite3"
    doc = _code_doc(own)
    rewritten = rewrite_sqlite_db_paths(doc, "activity_old", _NEW_ROOT)

    assert rewritten["content"][1]["attrs"]["sqliteDbPath"] == (
        f"{_NEW_ROOT}/dynamic/blocks/codePlayground/b/db.sqlite3"
    )
    assert doc["content"][1]["attrs"]["sqliteDbPath"] == own  # input untouched
    for value in (other, "db.sqlite3", "", None, f"{_OLD_ROOT}"):
        assert rewrite_sqlite_db_paths(_code_doc(value), "activity_old", _NEW_ROOT) == _code_doc(value)


async def test_clone_rewrites_code_block_database_paths(db, org, course, chapter, activity, admin_user, mock_request):
    own = "orgs/org_test/courses/course_test/activities/activity_test/dynamic/blocks/codePlayground/b/db.sqlite3"
    activity.content = _code_doc(own)
    db.add(activity)
    await db.commit()

    with patch(f"{COURSES_MOD}.check_limits_with_usage"), \
            patch(f"{COURSES_MOD}.increase_feature_usage"), \
            patch("src.services.courses.transfer.storage_utils.is_s3_enabled", return_value=False), \
            patch("src.services.courses.transfer.storage_utils.file_exists", return_value=False), \
            patch("src.services.courses.transfer.storage_utils.list_directory", return_value=[]), \
            patch(f"{COURSES_MOD}._copy_storage_file"), \
            patch(f"{COURSES_MOD}._copy_storage_directory"), \
            patch("os.makedirs"):
        cloned = await clone_course(mock_request, course.course_uuid, admin_user, db)

    copy = (await db.execute(
        select(Activity).join(Course, Course.id == Activity.course_id)
        .where(Course.course_uuid == cloned.course_uuid)
    )).scalars().one()
    assert copy.content["content"][1]["attrs"]["sqliteDbPath"] == (
        f"orgs/org_test/courses/{cloned.course_uuid}/activities/{copy.activity_uuid}"
        "/dynamic/blocks/codePlayground/b/db.sqlite3"
    )


async def test_import_rewrites_code_block_database_and_validates_files(
    db, org, course, chapter, tmp_path, monkeypatch
):
    monkeypatch.chdir(tmp_path)
    activity_path = tmp_path / "pkg" / "activity_old"
    block_dir = activity_path / "files" / "dynamic" / "blocks" / "codePlayground" / "b"
    block_dir.mkdir(parents=True)
    (block_dir / "db.sqlite3").write_bytes(_SQLITE)
    (block_dir / "fake.sqlite3").write_bytes(b"#EXTM3U\n")
    (activity_path / "files" / "clip.mp4").write_bytes(b"#EXTM3U\nfile:///etc/passwd\n")
    (activity_path / "files" / "real.mp4").write_bytes(_MP4)
    new_course_path = f"content/orgs/{org.org_uuid}/courses/course_new"

    with patch.object(import_service, "is_s3_enabled", return_value=False):
        imported = await import_service._import_activity(
            activity_path=str(activity_path),
            activity_data={
                "name": "A", "activity_type": "TYPE_DYNAMIC",
                "content": _code_doc(f"{_OLD_ROOT}/dynamic/blocks/codePlayground/b/db.sqlite3"),
            },
            new_course=SimpleNamespace(id=course.id),
            new_chapter=SimpleNamespace(id=chapter.id),
            new_course_path=new_course_path,
            organization=org,
            db_session=AsyncMock(),
        )

    new_root = f"orgs/{org.org_uuid}/courses/course_new/activities/{imported.activity_uuid}"
    db_path = f"{new_root}/dynamic/blocks/codePlayground/b/db.sqlite3"
    assert imported.content["content"][1]["attrs"]["sqliteDbPath"] == db_path
    dest = tmp_path / "content" / new_root
    assert (tmp_path / "content" / db_path).read_bytes() == _SQLITE
    assert (dest / "real.mp4").exists()
    assert not (dest / "clip.mp4").exists()
    assert not (dest / "dynamic" / "blocks" / "codePlayground" / "b" / "fake.sqlite3").exists()


async def test_import_drops_thumbnail_with_wrong_content(db, org, admin_user, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    course_path = tmp_path / "course-pkg"
    thumbnails = course_path / "thumbnails"
    thumbnails.mkdir(parents=True)
    (course_path / "course.json").write_text(json.dumps({"name": "C", "thumbnail_image": "fake.png"}))
    (thumbnails / "fake.png").write_bytes(b"<html>")
    (thumbnails / "real.png").write_bytes(_PNG)

    with patch.object(import_service, "is_s3_enabled", return_value=False):
        imported = await import_service._import_single_course(
            course_path=str(course_path), organization=org, current_user=admin_user,
            options=ImportOptions(course_uuids=["course-pkg"]), db_session=db,
            new_course_uuid="course_pkg_new",
        )

    stored = os.listdir(tmp_path / "content" / "orgs" / org.org_uuid / "courses" / "course_pkg_new" / "thumbnails")
    assert len(stored) == 1
    assert imported.thumbnail_image == ""


def test_file_content_matches_extension(tmp_path):
    check = import_service.file_content_matches_extension
    (tmp_path / "captions.vtt").write_text("WEBVTT")
    assert check(str(tmp_path / "captions.vtt"))  # no upload type: not checked
    (tmp_path / "bad.zip").write_bytes(b"PK\x03\x04garbage")
    assert not check(str(tmp_path / "bad.zip"))  # stream validator
    good = tmp_path / "good.zip"
    import zipfile
    with zipfile.ZipFile(good, "w") as zf:
        zf.writestr("a.txt", "a")
    assert check(str(good))
    assert not check(str(tmp_path / "missing.png"))  # unreadable


# ---------------------------------------------------------------------------
# Migration uploads
# ---------------------------------------------------------------------------


class _Upload:
    def __init__(self, filename: str, data: bytes):
        self.filename = filename
        self.content_type = "application/octet-stream"
        self._buf = BytesIO(data)

    async def read(self, size=-1):
        return self._buf.read(size)

    async def close(self):
        pass


async def test_migration_upload_validates_content(tmp_path, monkeypatch):
    base = tmp_path / "migrations"
    base.mkdir()
    monkeypatch.setattr(migrations, "_TEMP_BASE_REAL", os.path.realpath(base))

    result = await migrations._upload_migration_files_inner([
        _Upload("intro.mp4", _MP4),
        _Upload("fake.mp4", b"#EXTM3U\n"),
        _Upload("slides.png", b"not an image"),
        _Upload("lecture.mov", b"\x00\x00\x00\x14ftypqt  " + b"\x00" * 16),
        _Upload("playlist.mov", b"#EXTM3U\nhttp://x/a.ts\n"),
    ])

    assert [f.filename for f in result.files] == ["intro.mp4", "lecture.mov"]
    assert result.skipped == [
        "fake.mp4: content does not match its file type",
        "slides.png: content does not match its file type",
        "playlist.mov: content does not match its file type",
    ]
    stored = os.listdir(base / result.temp_id)
    assert sorted(stored) == sorted(
        ["manifest.json"] + [f"{f.file_id}.{f.extension}" for f in result.files]
    )


def test_migration_mov_unreadable_is_invalid(tmp_path):
    assert migrations._migration_file_is_valid(str(tmp_path / "missing.mov"), "mov") is False


# ---------------------------------------------------------------------------
# ffmpeg input protocols
# ---------------------------------------------------------------------------


def _assert_safe_input(args, src):
    i = args.index(src)
    whitelist = args.index("-protocol_whitelist")
    assert args[whitelist + 1] == "file,pipe"
    assert whitelist < i


def test_hls_args_whitelist_input():
    args = ht.build_ffmpeg_args("in.mp4", "/out", ht.select_ladder(360), has_audio=True)
    _assert_safe_input(args, "in.mp4")
    assert args.index("-protocol_whitelist") < args.index("-i")


async def test_hls_probe_and_sprite_whitelist_input(tmp_path, monkeypatch):
    calls = []

    async def fake_run(args, timeout):
        calls.append(args)
        return 0, b"{}", b""

    monkeypatch.setattr(ht, "_run_subprocess", fake_run)
    monkeypatch.setattr(ht, "_ffprobe", lambda: "ffprobe")
    monkeypatch.setattr(ht, "_ffmpeg", lambda: "ffmpeg")
    await ht._probe("in.mp4")
    await ht.generate_sprite_thumbnails("in.mp4", str(tmp_path), 10.0)
    assert len(calls) == 2
    for args in calls:
        _assert_safe_input(args, "in.mp4")


async def test_caption_ffmpeg_whitelists_input(tmp_path, monkeypatch):
    calls = []

    def fake_run(args, timeout):
        calls.append(args)
        return 0, b"1.0", b""

    monkeypatch.setattr(captions, "_run", fake_run)
    await captions.probe_duration("in.mp4")
    await captions.extract_audio_chunks("in.mp4", str(tmp_path))
    assert len(calls) == 2
    for args in calls:
        _assert_safe_input(args, "in.mp4")


def test_faststart_whitelists_input(tmp_path, monkeypatch):
    p = tmp_path / "v.mp4"
    p.write_bytes(b"\x00\x00ftyp....mdat....moov....")
    seen = {}

    def fake_run(args, **kwargs):
        seen["args"] = args
        return subprocess.CompletedProcess(args, 1, "", "")

    monkeypatch.setattr(vp.shutil, "which", lambda name: "/usr/bin/ffmpeg")
    monkeypatch.setattr(vp.subprocess, "run", fake_run)
    vp.ensure_faststart(str(p))
    _assert_safe_input(seen["args"], str(p))


@pytest.mark.skipif(not shutil.which("ffprobe"), reason="ffprobe not installed")
def test_playlist_cannot_reach_a_url(tmp_path):
    playlist = tmp_path / "evil.m3u8"
    playlist.write_text(
        "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:9/a.ts\n#EXT-X-ENDLIST\n"
    )
    out = subprocess.run(
        ["ffprobe", "-v", "error", *vp.SAFE_INPUT_ARGS, "-show_format", str(playlist)],
        capture_output=True, text=True, timeout=30,
    )
    assert out.returncode != 0
    assert "not on whitelist" in out.stderr



async def test_update_keeps_pipeline_state(db, org, course, chapter, activity, admin_user, mock_request):
    from src.db.courses.activities import ActivityUpdate
    from src.services.courses.activities.activities import update_activity

    activity.extra_metadata = {"hls": {"status": "ready"}}
    db.add(activity)
    await db.commit()
    with patch(f"{ACTIVITIES_MOD}.check_resource_access", new_callable=AsyncMock), \
            patch(f"{ACTIVITIES_MOD}.index_activity", create=True):
        await update_activity(
            mock_request, ActivityUpdate(extra_metadata=dict(_FORGED)),
            activity.activity_uuid, admin_user, db,
        )
    stored = (await db.execute(select(Activity).where(Activity.id == activity.id))).scalars().one()
    assert stored.extra_metadata == {"hls": {"status": "ready"}, "note": "kept"}
