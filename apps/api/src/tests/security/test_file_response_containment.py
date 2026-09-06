"""Regression coverage for file response containment and symlink handling."""

import tempfile
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from src.routers import local_content
from src.routers.courses.courses import _validated_export_path


def test_export_path_rejects_symlink_outside_temp_directory(tmp_path, monkeypatch):
    export_root = tmp_path / "exports"
    export_root.mkdir()
    private = tmp_path / "private.zip"
    private.write_bytes(b"private")
    export = export_root / "learnhouse-export-example.zip"
    export.symlink_to(private)
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(export_root))

    with pytest.raises(HTTPException) as error:
        _validated_export_path(str(export))

    assert error.value.status_code == 400


def test_server_created_export_path_is_accepted(tmp_path, monkeypatch):
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))
    export = tmp_path / "learnhouse-export-example.zip"
    export.write_bytes(b"archive")
    assert _validated_export_path(str(export)) == str(export.resolve())


@pytest.mark.parametrize("handler", [local_content.serve_local_content, local_content.head_local_content])
async def test_local_content_symlink_escape_rejected_before_access_check(tmp_path, monkeypatch, handler):
    root = tmp_path / "content"
    root.mkdir()
    private = tmp_path / "private.txt"
    private.write_text("secret")
    link = root / "users/user_public/avatar.txt"
    link.parent.mkdir(parents=True)
    link.symlink_to(private)
    access = AsyncMock()
    monkeypatch.setattr(local_content, "CONTENT_DIR", root)
    monkeypatch.setattr(local_content, "_check_content_access", access)

    with pytest.raises(HTTPException) as error:
        await handler(None, "users/user_public/avatar.txt", current_user=object(), db_session=None)

    assert error.value.status_code == 400
    access.assert_not_awaited()


@pytest.mark.parametrize("handler", [local_content.serve_local_content, local_content.head_local_content])
async def test_local_content_symlink_uses_target_authorization(tmp_path, monkeypatch, handler):
    root = tmp_path / "content"
    relative = "orgs/org_private/courses/course_private/activities/activity_1/secret.txt"
    private = root / relative
    private.parent.mkdir(parents=True)
    private.write_text("secret")
    link = root / "users/user_public/avatar.txt"
    link.parent.mkdir(parents=True)
    link.symlink_to(private)
    access = AsyncMock(side_effect=HTTPException(status_code=403, detail="Access denied"))
    monkeypatch.setattr(local_content, "CONTENT_DIR", root)
    monkeypatch.setattr(local_content, "_check_content_access", access)

    with pytest.raises(HTTPException) as error:
        await handler(None, "users/user_public/avatar.txt", current_user=object(), db_session=None)

    assert error.value.status_code == 403
    assert access.await_args.args[0] == relative
