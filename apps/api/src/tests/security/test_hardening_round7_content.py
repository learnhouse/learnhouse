"""Content, code-execution and assignment hardening (security sweep, round 7).

- /content: only course thumbnails and course-root files are public; other
  course subtrees (shared SCORM packages, unknown layouts) are refused.
- Upload validation can run without reading the whole body into memory.
- Deleting a chapter deletes its activities instead of orphaning them.
- /code/execute{,-batch} is tied to a readable activity in an org with
  courses enabled; SQL runs only mount a code block's SQLite database, and the
  SQL wrapper can't be hijacked by a user file shadowing a stdlib module.
- Block GETs apply the activity reader gate.
- Code submission saves are rate limited and the history is capped.
- Assignment and activity published flags are kept in step on write.
"""

import os
import sqlite3
import subprocess
import sys
from datetime import datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.code_submissions import CodeSubmission
from src.db.courses.activities import (
    Activity,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
    ActivityUpdate,
)
from src.db.courses.assignments import Assignment, AssignmentUpdate, GradingTypeEnum
from src.db.courses.blocks import Block, BlockTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.routers import code_execution, code_submissions, content_files, local_content
from src.security.auth import get_current_user
from src.security.file_validation import validate_upload, validate_upload_stream
from src.services.blocks.block_types.audioBlock.audioBlock import get_audio_block
from src.services.blocks.block_types.imageBlock.imageBlock import get_image_block
from src.services.blocks.block_types.pdfBlock.pdfBlock import get_pdf_block
from src.services.blocks.block_types.videoBlock.videoBlock import get_video_block
from src.services.courses.activities.activities import update_activity
from src.services.courses.activities.assignments import update_assignment
from src.services.courses.chapters import delete_chapter


def _now() -> str:
    return str(datetime.now())


# ---------------------------------------------------------------------------
# /content course subpaths
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("module", [content_files, local_content])
class TestCourseSubpathAccess:
    async def test_scorm_package_files_are_refused(self, module, db, admin_user, anonymous_user):
        path = "orgs/org_test/courses/course_test/scorm/pkg_1/extracted/index.html"
        for user in (admin_user, anonymous_user):
            with pytest.raises(HTTPException) as exc:
                await module._check_content_access(path, user, db)
            assert exc.value.status_code == 403

    async def test_unknown_course_subtree_is_refused(self, module, db, anonymous_user):
        with pytest.raises(HTTPException) as exc:
            await module._check_content_access(
                "orgs/org_test/courses/course_test/exports/dump.zip", anonymous_user, db
            )
        assert exc.value.status_code == 403

    async def test_thumbnails_and_root_files_stay_public(self, module, db, anonymous_user):
        assert await module._check_content_access(
            "orgs/org_test/courses/course_test/thumbnails/thumb.png", anonymous_user, db
        ) is True
        assert await module._check_content_access(
            "orgs/org_test/courses/course_test/thumb.png", anonymous_user, db
        ) is True


# ---------------------------------------------------------------------------
# Streaming upload validation
# ---------------------------------------------------------------------------


_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 1024


class _TrackedStream(BytesIO):
    """Records every read so a test can assert none of them was unbounded."""

    def __init__(self, data: bytes):
        super().__init__(data)
        self.read_sizes: list = []

    def read(self, size=-1):
        self.read_sizes.append(size)
        return super().read(size)


class _UnseekableStream:
    def __init__(self, data: bytes):
        self._buf = BytesIO(data)

    def read(self, size=-1):
        return self._buf.read(size)

    def seek(self, *args):
        raise OSError("not seekable")


class TestValidateUploadStream:
    def test_validates_without_reading_the_body(self):
        stream = _TrackedStream(_PNG * 64)
        upload = SimpleNamespace(filename="a.png", content_type="image/png", file=stream)

        assert validate_upload_stream(upload, ["image"]) == "image/png"
        assert stream.tell() == 0
        assert stream.read_sizes and all(
            size is not None and 0 < size < len(_PNG * 64) for size in stream.read_sizes
        )

    def test_rejects_invalid_content(self):
        upload = SimpleNamespace(
            filename="a.png", content_type="image/png", file=BytesIO(b"not an image at all")
        )
        with pytest.raises(HTTPException) as exc:
            validate_upload_stream(upload, ["image"])
        assert exc.value.status_code == 415

    def test_unseekable_stream_is_refused(self):
        upload = SimpleNamespace(
            filename="a.png", content_type="image/png", file=_UnseekableStream(_PNG)
        )
        with pytest.raises(HTTPException) as exc:
            validate_upload_stream(upload, ["image"])
        assert exc.value.status_code == 400

    def test_validate_upload_still_returns_bytes(self):
        upload = SimpleNamespace(filename="a.png", content_type="image/png", file=BytesIO(_PNG))
        assert validate_upload(upload, ["image"]) == ("image/png", _PNG)
        unseekable = SimpleNamespace(
            filename="a.png", content_type="image/png", file=_UnseekableStream(_PNG)
        )
        assert validate_upload(unseekable, ["image"]) == ("image/png", _PNG)


# ---------------------------------------------------------------------------
# Chapter deletion
# ---------------------------------------------------------------------------


async def _add_activity(db, *, aid, uuid, org, course, chapter_id, published=True):
    a = Activity(
        id=aid,
        name=uuid,
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={},
        published=published,
        org_id=org.id,
        course_id=course.id,
        activity_uuid=uuid,
        creation_date=_now(),
        update_date=_now(),
    )
    db.add(a)
    await db.commit()
    if chapter_id is not None:
        db.add(ChapterActivity(
            order=aid, chapter_id=chapter_id, activity_id=aid, course_id=course.id,
            org_id=org.id, creation_date=_now(), update_date=_now(),
        ))
        await db.commit()
    return a


class TestDeleteChapterRemovesActivities:
    async def test_activities_and_files_go_with_the_chapter(
        self, db, org, course, chapter, activity, admin_user, mock_request
    ):
        other = Chapter(
            id=2, name="Other", description="", org_id=org.id, course_id=course.id,
            chapter_uuid="chapter_other", creation_date=_now(), update_date=_now(),
        )
        db.add(other)
        await db.commit()
        # Linked from both chapters: must survive.
        await _add_activity(db, aid=2, uuid="activity_shared", org=org, course=course, chapter_id=chapter.id)
        db.add(ChapterActivity(
            order=1, chapter_id=other.id, activity_id=2, course_id=course.id,
            org_id=org.id, creation_date=_now(), update_date=_now(),
        ))
        await db.commit()

        with patch(
            "src.services.courses.chapters.check_resource_access", new_callable=AsyncMock
        ), patch(
            "src.services.courses.transfer.storage_utils.delete_storage_directory"
        ) as delete_dir:
            result = await delete_chapter(mock_request, chapter.id, admin_user, db)

        assert result == {"detail": "chapter deleted"}
        remaining = {a.activity_uuid for a in (await db.execute(select(Activity))).scalars().all()}
        assert remaining == {"activity_shared"}
        delete_dir.assert_called_once_with(
            "content/orgs/org_test/courses/course_test/activities/activity_test"
        )

    async def test_empty_chapter_deletes_cleanly(self, db, chapter, admin_user, mock_request):
        with patch(
            "src.services.courses.chapters.check_resource_access", new_callable=AsyncMock
        ), patch(
            "src.services.courses.transfer.storage_utils.delete_storage_directory"
        ) as delete_dir:
            await delete_chapter(mock_request, chapter.id, admin_user, db)
        delete_dir.assert_not_called()


# ---------------------------------------------------------------------------
# Code execution
# ---------------------------------------------------------------------------


_PLAYGROUND_DB = (
    "orgs/org_test/courses/course_test/activities/activity_test"
    "/dynamic/blocks/codePlayground/block_1/x_sqlite_db.sqlite3"
)


@pytest.fixture
def exec_env(monkeypatch):
    """Judge0, rate limit and storage stubbed; reader gate and plan gate mocked."""
    submit = AsyncMock(return_value={"status": {"id": 3}, "stdout": "1\n"})
    reader = AsyncMock(
        return_value=(SimpleNamespace(activity_uuid="activity_test", org_id=1), object())
    )
    feature = AsyncMock(return_value=True)
    read_file = Mock(return_value=b"SQLite format 3\x00rest")
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


def _call(batch: bool, **payload):
    if batch:
        body = code_execution.ExecuteBatchRequest(
            test_cases=[{"id": "t", "label": "t", "stdin": "", "expected_stdout": "1"}],
            **payload,
        )
        handler = code_execution.execute_batch
    else:
        body = code_execution.ExecuteRequest(**payload)
        handler = code_execution.execute_code
    return handler(request=None, body=body, current_user=SimpleNamespace(id=7), db_session="db")


@pytest.mark.parametrize("batch", [False, True])
class TestCodeExecutionGate:
    async def test_activity_is_required(self, exec_env, batch):
        with pytest.raises(HTTPException) as exc:
            await _call(batch, language_id=71, source_code="print(1)")
        assert exc.value.status_code == 400
        exec_env.submit.assert_not_awaited()

    async def test_runs_inside_a_readable_activity(self, exec_env, batch):
        await _call(batch, language_id=71, source_code="print(1)", activity_uuid="activity_test")
        assert exec_env.reader.await_args.args[1] == "activity_test"
        exec_env.feature.assert_awaited_once_with("courses", 1, "db")
        exec_env.submit.assert_awaited()

    async def test_unreadable_activity_never_reaches_judge0(self, exec_env, batch):
        exec_env.reader.side_effect = HTTPException(status_code=404, detail="Activity not found")
        with pytest.raises(HTTPException) as exc:
            await _call(batch, language_id=71, source_code="print(1)", activity_uuid="activity_x")
        assert exc.value.status_code == 404
        exec_env.submit.assert_not_awaited()

    async def test_plan_gate_applies(self, exec_env, batch):
        exec_env.feature.side_effect = HTTPException(status_code=403, detail="disabled")
        with pytest.raises(HTTPException) as exc:
            await _call(batch, language_id=71, source_code="print(1)", activity_uuid="activity_test")
        assert exc.value.status_code == 403
        exec_env.submit.assert_not_awaited()

    async def test_sql_mounts_the_code_block_database(self, exec_env, batch):
        await _call(
            batch, language_id=code_execution.SQL_LANGUAGE_ID, source_code="select 1",
            sqlite_db_path=_PLAYGROUND_DB,
        )
        exec_env.read_file.assert_called_once_with(_PLAYGROUND_DB)
        exec_env.feature.assert_awaited_once_with("courses", 1, "db")
        args = exec_env.submit.await_args.args
        assert args[1] == code_execution.PYTHON3_LANGUAGE_ID
        assert args[2].startswith("import sys\nsys.path[:]")

    @pytest.mark.parametrize(
        "path",
        [
            # Another learner's submission / the model answer under the activity
            "orgs/org_test/courses/course_test/activities/activity_test/assignments/a/tasks/t/subs/f.sqlite3",
            "orgs/org_test/courses/course_test/activities/activity_test/assignments/a/solution/s.sqlite3",
            # Right directory, wrong file type
            "orgs/org_test/courses/course_test/activities/activity_test/dynamic/blocks/codePlayground/b/notes.txt",
            "orgs/org_test/courses/course_test/activities/activity_test/dynamic/blocks/imageBlock/b/x.sqlite3",
        ],
    )
    async def test_sql_refuses_other_activity_files(self, exec_env, batch, path):
        with pytest.raises(HTTPException) as exc:
            await _call(
                batch, language_id=code_execution.SQL_LANGUAGE_ID, source_code="select 1",
                sqlite_db_path=path,
            )
        assert exc.value.status_code == 400
        exec_env.read_file.assert_not_called()
        exec_env.submit.assert_not_awaited()

    async def test_sql_database_authorizes_against_its_owning_activity(self, exec_env, batch):
        """A block copied from another activity mounts that activity's file, so
        the gate (and the plan check) run against the owner, not activity_uuid."""
        exec_env.reader.return_value = (
            SimpleNamespace(activity_uuid="activity_test", org_id=2), object()
        )
        await _call(
            batch, language_id=code_execution.SQL_LANGUAGE_ID, source_code="select 1",
            sqlite_db_path=_PLAYGROUND_DB, activity_uuid="activity_other",
        )
        exec_env.reader.assert_awaited_once()
        assert exec_env.reader.await_args.args[1] == "activity_test"
        assert exec_env.reader.await_args.kwargs["course_uuid"] == "course_test"
        exec_env.feature.assert_awaited_once_with("courses", 2, "db")
        exec_env.read_file.assert_called_once_with(_PLAYGROUND_DB)
        exec_env.submit.assert_awaited()

    async def test_sql_database_owner_must_be_readable(self, exec_env, batch):
        exec_env.reader.side_effect = HTTPException(status_code=404, detail="Activity not found")
        with pytest.raises(HTTPException) as exc:
            await _call(
                batch, language_id=code_execution.SQL_LANGUAGE_ID, source_code="select 1",
                sqlite_db_path=_PLAYGROUND_DB, activity_uuid="activity_other",
            )
        assert exc.value.status_code == 404
        assert exec_env.reader.await_args.args[1] == "activity_test"
        exec_env.read_file.assert_not_called()
        exec_env.submit.assert_not_awaited()

    async def test_sql_file_must_be_a_sqlite_database(self, exec_env, batch):
        exec_env.read_file.return_value = b"print('model answer')"
        with pytest.raises(HTTPException) as exc:
            await _call(
                batch, language_id=code_execution.SQL_LANGUAGE_ID, source_code="select 1",
                sqlite_db_path=_PLAYGROUND_DB, activity_uuid="activity_test",
            )
        assert exc.value.status_code == 400
        exec_env.submit.assert_not_awaited()


async def test_code_execution_uses_the_real_reader_gate(
    db, org, course, chapter, regular_user, mock_request, monkeypatch
):
    """A learner can't run code against a draft activity of a public course."""
    await _add_activity(db, aid=5, uuid="activity_draft", org=org, course=course,
                        chapter_id=chapter.id, published=False)
    submit = AsyncMock()
    monkeypatch.setattr(code_execution, "_get_judge0_config", lambda: object())
    monkeypatch.setattr(code_execution, "check_rate_limit", lambda **_: (True, 1, 60))
    monkeypatch.setattr(code_execution, "_submit_single", submit)
    monkeypatch.setattr(code_execution, "check_feature_enabled", AsyncMock(return_value=True))

    body = code_execution.ExecuteRequest(
        language_id=71, source_code="print(1)", activity_uuid="activity_draft"
    )
    with pytest.raises(HTTPException) as exc:
        await code_execution.execute_code(
            request=mock_request, body=body, current_user=regular_user, db_session=db
        )
    assert exc.value.status_code == 404
    submit.assert_not_awaited()


def test_sql_wrapper_ignores_a_shadowing_sqlite3_module(tmp_path):
    """User files sit next to the wrapper; a fake sqlite3.py must not load."""
    box = tmp_path / "box"
    box.mkdir()
    conn = sqlite3.connect(box / "db.sqlite3")
    conn.execute("create table t (v text)")
    conn.execute("insert into t values ('real')")
    conn.commit()
    conn.close()
    (box / "sqlite3.py").write_text("print('HIJACKED')\nraise SystemExit(0)\n")
    (box / "base64.py").write_text("print('HIJACKED')\nraise SystemExit(0)\n")
    script = box / "script.py"
    script.write_text(code_execution._wrap_sql_in_python("select v from t"))

    out = subprocess.run(
        [sys.executable, str(script)], cwd=box, capture_output=True, text=True,
        env={k: v for k, v in os.environ.items() if k != "PYTHONPATH"}, timeout=30,
    )

    assert "HIJACKED" not in out.stdout
    assert out.stdout.splitlines() == ["v", "real"]


# ---------------------------------------------------------------------------
# Block GETs
# ---------------------------------------------------------------------------


_GETTERS = [
    (get_image_block, BlockTypeEnum.BLOCK_IMAGE),
    (get_video_block, BlockTypeEnum.BLOCK_VIDEO),
    (get_pdf_block, BlockTypeEnum.BLOCK_DOCUMENT_PDF),
    (get_audio_block, BlockTypeEnum.BLOCK_AUDIO),
]


@pytest.mark.parametrize(("getter", "block_type"), _GETTERS)
class TestBlockReaderGate:
    async def _block(self, db, org, course, activity_id):
        b = Block(
            block_type=self._type, content={"file_id": "x"}, org_id=org.id,
            course_id=course.id, activity_id=activity_id, block_uuid="block_sweep7",
            creation_date=_now(), update_date=_now(),
        )
        db.add(b)
        await db.commit()
        return b

    async def test_draft_activity_block_hidden_from_learner(
        self, getter, block_type, db, org, course, chapter, regular_user, admin_user, mock_request
    ):
        self._type = block_type
        await _add_activity(db, aid=6, uuid="activity_draft", org=org, course=course,
                            chapter_id=chapter.id, published=False)
        await self._block(db, org, course, 6)

        with pytest.raises(HTTPException) as exc:
            await getter(mock_request, "block_sweep7", regular_user, db)
        assert exc.value.status_code == 404

        read = await getter(mock_request, "block_sweep7", admin_user, db)
        assert read.block_uuid == "block_sweep7"

    async def test_published_activity_block_still_readable(
        self, getter, block_type, db, org, course, activity, regular_user, mock_request
    ):
        self._type = block_type
        await self._block(db, org, course, activity.id)
        read = await getter(mock_request, "block_sweep7", regular_user, db)
        assert read.block_uuid == "block_sweep7"


# ---------------------------------------------------------------------------
# Code submission saves
# ---------------------------------------------------------------------------


@pytest.fixture
async def submissions_client(db, admin_user):
    app = FastAPI()
    app.include_router(code_submissions.router, prefix="/code/submissions")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _submission(block_id: str = "block_1", code: str = "print(1)") -> dict:
    return {
        "activity_uuid": "activity_test", "block_id": block_id, "language_id": 71,
        "source_code": code, "results": {}, "total_tests": 1, "passed_tests": 1,
    }


class TestCodeSubmissionSave:
    async def test_save_is_rate_limited(self, submissions_client, activity, db):
        with patch.object(code_submissions, "check_rate_limit", return_value=(False, 61, 30)) as limit:
            response = await submissions_client.post("/code/submissions/save", json=_submission())
        assert response.status_code == 429
        assert response.headers["retry-after"] == "30"
        assert limit.call_args.kwargs["key"].startswith("code_submission_save:")
        assert (await db.execute(select(CodeSubmission))).scalars().all() == []

    async def test_history_is_capped_per_activity(self, submissions_client, activity, db, monkeypatch):
        monkeypatch.setattr(code_submissions, "MAX_SUBMISSIONS_PER_ACTIVITY", 2)
        with patch.object(code_submissions, "check_rate_limit", return_value=(True, 1, 60)):
            # Varying block_id doesn't get around the cap
            for i, block_id in enumerate(["block_1", "block_2", "block_3"]):
                response = await submissions_client.post(
                    "/code/submissions/save", json=_submission(block_id, f"print({i})")
                )
                assert response.status_code == 200

        rows = (await db.execute(select(CodeSubmission))).scalars().all()
        assert sorted(r.source_code for r in rows) == ["print(1)", "print(2)"]


# ---------------------------------------------------------------------------
# Assignment / activity published flags
# ---------------------------------------------------------------------------


@pytest.fixture
async def assignment(db, org, course, chapter, activity):
    a = Assignment(
        title="A", description="", published=False, grading_type=GradingTypeEnum.NUMERIC,
        org_id=org.id, course_id=course.id, chapter_id=chapter.id, activity_id=activity.id,
        assignment_uuid="assignment_sweep7", creation_date=_now(), update_date=_now(),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


class TestPublishedFlagsStayInSync:
    async def test_unpublishing_the_assignment_unpublishes_its_activity(
        self, db, activity, assignment, admin_user, mock_request
    ):
        assignment.published = True
        db.add(assignment)
        await db.commit()

        with patch(
            "src.services.courses.activities.assignments.check_resource_access",
            new_callable=AsyncMock,
        ):
            await update_assignment(
                mock_request, "assignment_sweep7", AssignmentUpdate(published=False), admin_user, db
            )

        await db.refresh(activity)
        assert activity.published is False

    async def test_other_assignment_edits_leave_the_activity_alone(
        self, db, activity, assignment, admin_user, mock_request
    ):
        with patch(
            "src.services.courses.activities.assignments.check_resource_access",
            new_callable=AsyncMock,
        ):
            await update_assignment(
                mock_request, "assignment_sweep7", AssignmentUpdate(title="B"), admin_user, db
            )
        await db.refresh(activity)
        assert activity.published is True

    async def test_publishing_the_activity_publishes_its_assignment(
        self, db, activity, assignment, admin_user, mock_request
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            await update_activity(
                mock_request, ActivityUpdate(published=False), "activity_test", admin_user, db
            )
            await db.refresh(assignment)
            assert assignment.published is False

            await update_activity(
                mock_request, ActivityUpdate(published=True), "activity_test", admin_user, db
            )
        await db.refresh(assignment)
        assert assignment.published is True
