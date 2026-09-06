"""SQLite execution must authorize the file it actually sends to Judge0."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from src.routers import code_execution


@pytest.fixture
def filesystem_storage(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "content").mkdir()
    config = SimpleNamespace(
        hosting_config=SimpleNamespace(
            content_delivery=SimpleNamespace(type="filesystem")
        )
    )
    monkeypatch.setattr(code_execution, "get_learnhouse_config", lambda: config)
    return tmp_path / "content"


@pytest.mark.parametrize("batch", [False, True])
async def test_sqlite_symlink_requires_access_to_target_course(
    filesystem_storage, monkeypatch, batch
):
    root = filesystem_storage
    target = root / "orgs/org_other/courses/course_private/activities/activity_1/db.sqlite3"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"private database")
    link = root / "orgs/org_own/courses/course_owned/activities/activity_1/db.sqlite3"
    link.parent.mkdir(parents=True)
    link.symlink_to(target)

    authorize = AsyncMock(side_effect=HTTPException(status_code=403, detail="Access denied"))
    read_file = Mock()
    submit = AsyncMock()
    monkeypatch.setattr(code_execution, "_get_judge0_config", lambda: object())
    monkeypatch.setattr(code_execution, "_require_course_access", authorize)
    monkeypatch.setattr(code_execution, "_read_storage_file", read_file)
    monkeypatch.setattr(code_execution, "_submit_single", submit)
    payload = dict(
        language_id=code_execution.SQL_LANGUAGE_ID,
        source_code="select 1",
        sqlite_db_path=str(link.relative_to(root)),
    )
    if batch:
        body = code_execution.ExecuteBatchRequest(**payload, test_cases=[])
        handler = code_execution.execute_batch
    else:
        body = code_execution.ExecuteRequest(**payload)
        handler = code_execution.execute_code

    with pytest.raises(HTTPException) as error:
        await handler(request=None, body=body, current_user=object(), db_session=None)

    assert error.value.status_code == 403
    assert authorize.await_args.args[2] == "course_private"
    read_file.assert_not_called()
    submit.assert_not_awaited()


def test_sqlite_symlink_outside_content_is_rejected(filesystem_storage):
    outside = filesystem_storage.parent / "private.sqlite3"
    outside.write_bytes(b"private")
    link = filesystem_storage / "orgs/org_own/courses/course_owned/db.sqlite3"
    link.parent.mkdir(parents=True)
    link.symlink_to(outside)

    with pytest.raises(HTTPException) as error:
        code_execution._canonical_sqlite_path(str(link.relative_to(filesystem_storage)))

    assert error.value.status_code == 400


def test_sqlite_normal_path_still_reads_database(filesystem_storage):
    relative = "orgs/org_own/courses/course_owned/activities/activity_1/db.sqlite3"
    database = filesystem_storage / relative
    database.parent.mkdir(parents=True)
    database.write_bytes(b"SQLite format 3\x00")

    canonical = code_execution._canonical_sqlite_path(relative)

    assert canonical == relative
    assert code_execution._course_uuid_from_sqlite_path(canonical) == "course_owned"
    assert code_execution._read_storage_file(canonical) == b"SQLite format 3\x00"


def test_sqlite_s3_key_keeps_storage_identity(monkeypatch):
    config = SimpleNamespace(
        hosting_config=SimpleNamespace(content_delivery=SimpleNamespace(type="s3api"))
    )
    monkeypatch.setattr(code_execution, "get_learnhouse_config", lambda: config)
    relative = "orgs/org_own/courses/course_owned/activities/activity_1/db.sqlite3"
    assert code_execution._canonical_sqlite_path(relative) == relative
