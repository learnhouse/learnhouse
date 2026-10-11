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
    monkeypatch.setattr(code_execution, "check_rate_limit", lambda **_: (True, 1, 60))
    monkeypatch.setattr(code_execution, "verify_activity_reader_access_by_uuid", authorize)
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
        await handler(request=None, body=body, current_user=SimpleNamespace(id=1), db_session=None)

    assert error.value.status_code == 403
    assert authorize.await_args.args[1] == "activity_1"
    assert authorize.await_args.kwargs["course_uuid"] == "course_private"
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
    assert code_execution._sqlite_path_owner(canonical) == ("course_owned", "activity_1")
    assert code_execution._read_storage_file(canonical) == b"SQLite format 3\x00"


def test_sqlite_s3_key_keeps_storage_identity(monkeypatch):
    config = SimpleNamespace(
        hosting_config=SimpleNamespace(content_delivery=SimpleNamespace(type="s3api"))
    )
    monkeypatch.setattr(code_execution, "get_learnhouse_config", lambda: config)
    relative = "orgs/org_own/courses/course_owned/activities/activity_1/db.sqlite3"
    assert code_execution._canonical_sqlite_path(relative) == relative


def test_sqlite_path_without_activity_is_rejected():
    with pytest.raises(HTTPException) as error:
        code_execution._sqlite_path_owner("orgs/org_own/courses/course_owned/db.sqlite3")
    assert error.value.status_code == 400


@pytest.mark.parametrize("batch", [False, True])
async def test_code_execution_is_rate_limited_per_user(monkeypatch, batch):
    submit = AsyncMock()
    calls = {}

    def limited(**kwargs):
        calls.update(kwargs)
        return (False, 999, 42)

    monkeypatch.setattr(code_execution, "_get_judge0_config", lambda: object())
    monkeypatch.setattr(code_execution, "check_rate_limit", limited)
    monkeypatch.setattr(code_execution, "_submit_single", submit)
    user = SimpleNamespace(id=7, user_uuid="user_7")
    if batch:
        body = code_execution.ExecuteBatchRequest(language_id=71, source_code="print(1)", test_cases=[])
        handler = code_execution.execute_batch
    else:
        body = code_execution.ExecuteRequest(language_id=71, source_code="print(1)")
        handler = code_execution.execute_code

    with pytest.raises(HTTPException) as error:
        await handler(request=None, body=body, current_user=user, db_session=None)

    assert error.value.status_code == 429
    assert error.value.headers["Retry-After"] == "42"
    assert calls["key"].endswith(":7")
    submit.assert_not_awaited()


@pytest.mark.parametrize("batch", [False, True])
async def test_code_execution_rejects_api_tokens(monkeypatch, batch):
    from src.db.users import APITokenUser

    submit = AsyncMock()
    monkeypatch.setattr(code_execution, "_get_judge0_config", lambda: object())
    monkeypatch.setattr(code_execution, "check_rate_limit", lambda **_: (True, 1, 60))
    monkeypatch.setattr(code_execution, "_submit_single", submit)
    if batch:
        body = code_execution.ExecuteBatchRequest(language_id=71, source_code="print(1)", test_cases=[])
        handler = code_execution.execute_batch
    else:
        body = code_execution.ExecuteRequest(language_id=71, source_code="print(1)")
        handler = code_execution.execute_code

    with pytest.raises(HTTPException) as error:
        await handler(
            request=None, body=body,
            current_user=APITokenUser(org_id=1, created_by_user_id=1), db_session=None,
        )

    assert error.value.status_code == 403
    submit.assert_not_awaited()


def test_code_execution_payload_caps():
    from pydantic import ValidationError

    too_big = "x" * (code_execution.MAX_SOURCE_CODE_CHARS + 1)
    with pytest.raises(ValidationError):
        code_execution.ExecuteRequest(language_id=71, source_code=too_big)
    with pytest.raises(ValidationError):
        code_execution.ExecuteRequest(language_id=71, source_code="", stdin=too_big)
    with pytest.raises(ValidationError):
        code_execution.ExecuteBatchRequest(
            language_id=71, source_code="", test_cases=[],
            additional_files=[{"name": f"f{i}", "content": ""} for i in range(21)],
        )
    # A normal exercise still fits
    code_execution.ExecuteRequest(
        language_id=71, source_code="print(input())" * 100, stdin="1\n" * 1000,
        additional_files=[{"name": "data.txt", "content": "a,b\n" * 5000}],
    )
