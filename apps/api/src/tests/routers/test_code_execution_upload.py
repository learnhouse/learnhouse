"""Behavioral tests for the new validation in upload_sqlite_db.

Targets the newly-added validation logic in
``src/routers/code_execution.py`` (the ``upload_sqlite_db`` handler):

- strict ``^[A-Za-z0-9_-]+$`` regex on org_uuid / activity_uuid / block_id
- the DB check that org_uuid matches the course's actual organization

We call ``upload_sqlite_db`` directly (it is an async function) with a real
in-memory DB session (so the org-match query actually runs against a seeded
course), patching out RBAC and the storage ``upload_file`` so the tests focus
purely on the new validation lines.
"""

from io import BytesIO
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException, UploadFile

import src.routers.code_execution as code_execution
from src.routers.code_execution import upload_sqlite_db


# Minimal valid SQLite header so the file "looks like" a real SQLite db.
SQLITE_MAGIC = b"SQLite format 3\x00" + b"\x00" * 16


def _make_upload(filename: str = "playground.sqlite3") -> UploadFile:
    return UploadFile(filename=filename, file=BytesIO(SQLITE_MAGIC))


@pytest.fixture
def patched_deps():
    """Patch RBAC + storage upload so only the new validation runs.

    Both names are imported into the code_execution module namespace, so we
    patch them there (matching how the handler resolves them at call time):

    - ``_require_course_access`` wraps the RBAC check
      (``authorization_verify_based_on_roles_and_authorship``).
    - ``upload_file`` is the storage write path.
    """
    with patch.object(
        code_execution, "_require_course_access", new_callable=AsyncMock
    ) as rbac, patch.object(
        code_execution, "upload_file", new_callable=AsyncMock
    ) as upload:
        upload.return_value = "sqlite_db_abc123.sqlite3"
        yield {"rbac": rbac, "upload": upload}


async def _call(db, current_user, *, org_uuid, activity_uuid, block_id,
                course_uuid="course_test", mock_request):
    return await upload_sqlite_db(
        request=mock_request,
        file_object=_make_upload(),
        activity_uuid=activity_uuid,
        block_id=block_id,
        org_uuid=org_uuid,
        course_uuid=course_uuid,
        current_user=current_user,
        db_session=db,
    )


# ---------------------------------------------------------------------------
# Malformed segment validation (regex ^[A-Za-z0-9_-]+$) — one test per field
# ---------------------------------------------------------------------------

BAD_VALUES = ["../x", "a/b", "x;y", "", "a b", "a.b"]


@pytest.mark.parametrize("bad", BAD_VALUES)
async def test_malformed_org_uuid_raises_400(
    bad, db, admin_user, mock_request, patched_deps
):
    with pytest.raises(HTTPException) as exc:
        await _call(
            db, admin_user,
            org_uuid=bad, activity_uuid="activity_test", block_id="block_1",
            mock_request=mock_request,
        )
    assert exc.value.status_code == 400
    assert "org_uuid" in exc.value.detail
    # validation happens before RBAC + storage are touched
    patched_deps["rbac"].assert_not_awaited()
    patched_deps["upload"].assert_not_awaited()


@pytest.mark.parametrize("bad", BAD_VALUES)
async def test_malformed_activity_uuid_raises_400(
    bad, db, admin_user, mock_request, patched_deps
):
    with pytest.raises(HTTPException) as exc:
        await _call(
            db, admin_user,
            org_uuid="org_test", activity_uuid=bad, block_id="block_1",
            mock_request=mock_request,
        )
    assert exc.value.status_code == 400
    assert "activity_uuid" in exc.value.detail
    patched_deps["rbac"].assert_not_awaited()
    patched_deps["upload"].assert_not_awaited()


@pytest.mark.parametrize("bad", BAD_VALUES)
async def test_malformed_block_id_raises_400(
    bad, db, admin_user, mock_request, patched_deps
):
    with pytest.raises(HTTPException) as exc:
        await _call(
            db, admin_user,
            org_uuid="org_test", activity_uuid="activity_test", block_id=bad,
            mock_request=mock_request,
        )
    assert exc.value.status_code == 400
    assert "block_id" in exc.value.detail
    patched_deps["rbac"].assert_not_awaited()
    patched_deps["upload"].assert_not_awaited()


# ---------------------------------------------------------------------------
# course_uuid prefix guard (pre-existing line 410-411, exercised here too)
# ---------------------------------------------------------------------------

async def test_bad_course_uuid_prefix_raises_400(
    db, admin_user, mock_request, patched_deps
):
    with pytest.raises(HTTPException) as exc:
        await _call(
            db, admin_user,
            org_uuid="org_test", activity_uuid="activity_test", block_id="block_1",
            course_uuid="not_a_course_uuid",
            mock_request=mock_request,
        )
    assert exc.value.status_code == 400
    assert exc.value.detail == "Invalid course_uuid"


# ---------------------------------------------------------------------------
# org-match DB logic
# ---------------------------------------------------------------------------

async def test_course_not_found_raises_404(
    db, admin_user, mock_request, patched_deps
):
    """Well-formed request but the course_uuid does not exist in the DB."""
    with pytest.raises(HTTPException) as exc:
        await _call(
            db, admin_user,
            org_uuid="org_test", activity_uuid="activity_test", block_id="block_1",
            course_uuid="course_does_not_exist",
            mock_request=mock_request,
        )
    assert exc.value.status_code == 404
    assert exc.value.detail == "Course not found"
    # RBAC ran (it's before the query); storage did not
    patched_deps["rbac"].assert_awaited_once()
    patched_deps["upload"].assert_not_awaited()


async def test_org_uuid_mismatch_raises_400(
    db, admin_user, course, mock_request, patched_deps
):
    """Course exists (org 'org_test') but a different org_uuid is supplied."""
    with pytest.raises(HTTPException) as exc:
        await _call(
            db, admin_user,
            org_uuid="org_other",  # course actually belongs to org_test
            activity_uuid="activity_test", block_id="block_1",
            course_uuid="course_test",
            mock_request=mock_request,
        )
    assert exc.value.status_code == 400
    assert exc.value.detail == "org_uuid does not match course organization"
    patched_deps["rbac"].assert_awaited_once()
    patched_deps["upload"].assert_not_awaited()


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------

async def test_valid_request_uploads_and_returns_path(
    db, admin_user, course, mock_request, patched_deps
):
    """Well-formed UUIDs, org matches the course, RBAC allows -> upload runs."""
    result = await _call(
        db, admin_user,
        org_uuid="org_test", activity_uuid="activity_test", block_id="block_1",
        course_uuid="course_test",
        mock_request=mock_request,
    )

    patched_deps["rbac"].assert_awaited_once()
    patched_deps["upload"].assert_awaited_once()

    # upload_file was called with the org-scoped directory layout
    _, kwargs = patched_deps["upload"].call_args
    assert kwargs["type_of_dir"] == "orgs"
    assert kwargs["uuid"] == "org_test"
    assert kwargs["allowed_types"] == ["database"]
    assert "course_test" in kwargs["directory"]
    assert "activity_test" in kwargs["directory"]
    assert "block_1" in kwargs["directory"]

    assert result["file_path"] == (
        "orgs/org_test/courses/course_test/activities/activity_test/"
        "dynamic/blocks/codePlayground/block_1/sqlite_db_abc123.sqlite3"
    )
    assert result["file_name"] == "playground.sqlite3"
