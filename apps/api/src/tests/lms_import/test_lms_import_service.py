"""Tests for the background LMS conversion job and its routes."""

from __future__ import annotations

import asyncio
import json
import os
from io import BytesIO
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, UploadFile
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.routers.courses.courses import router as courses_router
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_courses_feature
from src.services.courses.lms_import import ConversionError, ConversionResult, PackageWriter, ir
from src.services.courses.lms_import.report import ConversionReport
from src.services.courses.transfer import lms_import_service as svc

SVC = "src.services.courses.transfer.lms_import_service"


def _fake_convert(input_path, package_dir, *, source, options, work_dir):
    """Stand-in for the real converter: a one-page course."""
    assert os.path.isfile(input_path)
    course = ir.Course(title="Converted", source="canvas", id="c1",
                       sections=[ir.Section("Module 1", items=[ir.Page("Welcome", [ir.HeadingPart("Hi")])])])
    report = ConversionReport(source="canvas", course_title="Converted")
    report.warn("something odd")
    PackageWriter(course, package_dir, options, report).write()
    return ConversionResult(course=course, report=report, package_dir=package_dir)


@pytest.fixture
def lms_env(monkeypatch, tmp_path):
    imports = tmp_path / "imports"
    imports.mkdir()
    monkeypatch.setattr(f"{SVC}.TEMP_IMPORT_DIR", str(imports))
    patches = [
        patch(f"{SVC}.check_resource_access", new_callable=AsyncMock),
        patch(f"{SVC}.require_org_create_permission", new_callable=AsyncMock),
    ]
    for p in patches:
        p.start()
    yield imports
    for p in patches:
        p.stop()


async def _wait_all():
    while svc._running:
        await asyncio.gather(*list(svc._running))


def _upload(data: bytes = b"PK\x03\x04 export") -> UploadFile:
    return UploadFile(filename="export.imscc", file=BytesIO(data))


@pytest.mark.asyncio
async def test_conversion_runs_in_background_and_reports(db, org, admin_user, mock_request, lms_env):
    with patch(f"{SVC}.convert_to_directory", side_effect=_fake_convert):
        started = await svc.start_lms_import(mock_request, _upload(), org.id, "auto", "assignment", admin_user, db)
        assert started.status == "processing"
        await _wait_all()
    status = await svc.get_lms_import_status(mock_request, started.temp_id, org.id, admin_user, db)
    assert status.status == "ready"
    assert status.source == "canvas" and status.source_label == "Canvas"
    assert [c.name for c in status.courses] == ["Converted"]
    assert status.courses[0].activities_count == 1
    assert status.report.warnings == ["something odd"]
    temp_dir = lms_env / started.temp_id
    # The package is where the regular import looks for it, the upload is gone
    assert (temp_dir / "extracted" / "manifest.json").is_file()
    assert not (temp_dir / "upload.bin").exists()
    assert not (temp_dir / "work").exists()


@pytest.mark.asyncio
async def test_conversion_failure_is_reported(db, org, admin_user, mock_request, lms_env):
    with patch(f"{SVC}.convert_to_directory", side_effect=ConversionError("Unrecognized export")):
        started = await svc.start_lms_import(mock_request, _upload(), org.id, "auto", "page", admin_user, db)
        await _wait_all()
    status = await svc.get_lms_import_status(mock_request, started.temp_id, org.id, admin_user, db)
    assert status.status == "failed"
    assert status.error == "Unrecognized export"
    assert not (lms_env / started.temp_id / "extracted").exists()


@pytest.mark.asyncio
@pytest.mark.parametrize("error, message", [
    (RuntimeError("secret internal detail"), "The export could not be converted."),
    (HTTPException(status_code=400, detail="Invalid package: manifest.json not found"),
     "Invalid package: manifest.json not found"),
])
async def test_unexpected_errors_are_not_leaked(db, org, admin_user, mock_request, lms_env, error, message):
    with patch(f"{SVC}.convert_to_directory", side_effect=error):
        started = await svc.start_lms_import(mock_request, _upload(), org.id, "moodle", "assignment", admin_user, db)
        await _wait_all()
    status = await svc.get_lms_import_status(mock_request, started.temp_id, org.id, admin_user, db)
    assert status.error == message


@pytest.mark.asyncio
async def test_status_is_private_to_the_uploader(db, org, admin_user, regular_user, mock_request, lms_env):
    with patch(f"{SVC}.convert_to_directory", side_effect=_fake_convert):
        started = await svc.start_lms_import(mock_request, _upload(), org.id, "auto", "assignment", admin_user, db)
        await _wait_all()
    with pytest.raises(HTTPException) as exc:
        await svc.get_lms_import_status(mock_request, started.temp_id, org.id, regular_user, db)
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        await svc.get_lms_import_status(mock_request, str(uuid4()), org.id, admin_user, db)
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        await svc.get_lms_import_status(mock_request, "../../etc", org.id, admin_user, db)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_rejects_bad_parameters_and_files(db, org, admin_user, mock_request, lms_env, monkeypatch):
    with pytest.raises(HTTPException) as exc:
        await svc.start_lms_import(mock_request, _upload(), org.id, "sakai", "assignment", admin_user, db)
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException) as exc:
        await svc.start_lms_import(mock_request, _upload(), org.id, "auto", "graded", admin_user, db)
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException) as exc:
        await svc.start_lms_import(mock_request, _upload(b""), org.id, "auto", "assignment", admin_user, db)
    assert exc.value.status_code == 400
    monkeypatch.setattr(f"{SVC}.MAX_LMS_UPLOAD_SIZE", 10)
    monkeypatch.setattr(f"{SVC}.UPLOAD_CHUNK", 4)
    with pytest.raises(HTTPException) as exc:
        await svc.start_lms_import(mock_request, _upload(b"x" * 64), org.id, "auto", "assignment", admin_user, db)
    assert exc.value.status_code == 413
    # Nothing is left behind by refused uploads
    assert os.listdir(lms_env) == []
    with pytest.raises(HTTPException) as exc:
        await svc.start_lms_import(mock_request, _upload(), 999_999, "auto", "assignment", admin_user, db)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_status_write_failure_is_logged(db, org, admin_user, mock_request, lms_env):
    with patch(f"{SVC}.convert_to_directory", side_effect=_fake_convert):
        started = await svc.start_lms_import(mock_request, _upload(), org.id, "auto", "assignment", admin_user, db)
        with patch(f"{SVC}._write_status", side_effect=OSError("disk full")):
            await _wait_all()
    # The last recorded status is still "processing"
    data = json.loads((lms_env / started.temp_id / svc.STATUS_FILE).read_text())
    assert data["status"] == "processing"


def test_list_sources_and_principal(admin_user):
    listed = svc.list_sources()
    keys = [s.key for s in listed.sources]
    assert keys == ["moodle", "canvas", "blackboard", "brightspace", "openedx", "common_cartridge"]
    assert listed.max_upload_mb == svc.MAX_LMS_UPLOAD_SIZE // (1024 * 1024)
    assert svc.lms_principal(admin_user).startswith("PublicUser:")
    assert svc._read_status("/nonexistent") is None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(courses_router, prefix="/api/v1/courses")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    app.dependency_overrides[require_courses_feature] = lambda: True
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_routes(client):
    r = await client.get("/api/v1/courses/import/lms/sources")
    assert r.status_code == 200
    assert {"key": "moodle", "label": "Moodle"} in r.json()["sources"]
    assert r.json()["max_upload_mb"] > 0

    started = svc.LmsImportStatus(temp_id="t", status="processing")
    with patch("src.routers.courses.courses.start_lms_import_request", new_callable=AsyncMock,
               return_value=started) as start:
        r = await client.post("/api/v1/courses/import/lms/analyze?org_id=1&source=moodle&quiz_mode=page",
                              files={"package": ("backup.mbz", b"data", "application/octet-stream")})
    assert r.status_code == 200 and r.json()["status"] == "processing"
    args = start.await_args.args
    assert args[1:4] == (1, "moodle", "page")  # request, org_id, source, quiz_mode, ...

    ready = svc.LmsImportStatus(temp_id="t", status="ready", source="moodle", source_label="Moodle")
    with patch("src.routers.courses.courses.get_lms_import_status", new_callable=AsyncMock, return_value=ready):
        r = await client.get("/api/v1/courses/import/lms/analyze/t?org_id=1")
    assert r.status_code == 200 and r.json()["source_label"] == "Moodle"


def test_run_conversion_tolerates_an_already_removed_upload(tmp_path):
    temp_dir = tmp_path / "t"
    temp_dir.mkdir()
    upload = temp_dir / "upload.zip"
    upload.write_bytes(b"PK")

    def convert(*_args, **_kwargs):
        os.unlink(upload)
        raise ConversionError("bad export")

    with patch(f"{SVC}.convert_to_directory", side_effect=convert):
        assert svc._run_conversion(str(temp_dir), str(upload), "auto", "page") == {
            "status": "failed", "error": "bad export"}
    assert not (temp_dir / "work").exists() and not (temp_dir / "building").exists()


@pytest.mark.asyncio
async def test_queue_slot_is_held_while_the_upload_is_written(db, org, admin_user, mock_request, lms_env,
                                                               monkeypatch):
    monkeypatch.setattr(f"{SVC}.MAX_CONVERSIONS_PER_USER", 1)
    with patch(f"{SVC}.convert_to_directory", side_effect=_fake_convert):
        # Both requests pass the limit check before either conversion task
        # exists: the second must still be refused
        first, second = await asyncio.gather(
            svc.start_lms_import(mock_request, _upload(), org.id, "auto", "page", admin_user, db),
            svc.start_lms_import(mock_request, _upload(), org.id, "auto", "page", admin_user, db),
            return_exceptions=True,
        )
        await _wait_all()
    outcomes = sorted(type(r).__name__ for r in (first, second))
    assert outcomes == ["HTTPException", "LmsImportStatus"]
    refused = first if isinstance(first, HTTPException) else second
    assert refused.status_code == 429
    assert svc._pending == 0 and not svc._running_by_owner  # every slot released


@pytest.mark.asyncio
async def test_rejected_upload_releases_its_slot(db, org, admin_user, mock_request, lms_env):
    with pytest.raises(HTTPException) as exc:
        await svc.start_lms_import(mock_request, _upload(b""), org.id, "auto", "page", admin_user, db)
    assert exc.value.status_code == 400
    assert svc._pending == 0 and not svc._running_by_owner
    assert not list(lms_env.iterdir())


def test_run_conversion_removes_a_package_it_could_not_summarize(tmp_path):
    temp_dir = tmp_path / "t"
    temp_dir.mkdir()
    upload = temp_dir / "upload.bin"
    upload.write_bytes(b"PK")

    # The converter wrote a package, but the importer's summary rejects it
    rejected = HTTPException(status_code=400, detail="Invalid package: manifest.json not found")
    with patch(f"{SVC}.convert_to_directory", side_effect=_fake_convert), \
            patch(f"{SVC}.summarize_extracted_package", side_effect=rejected):
        payload = svc._run_conversion(str(temp_dir), str(upload), "auto", "page")
    assert payload == {"status": "failed", "error": "Invalid package: manifest.json not found"}
    assert sorted(p.name for p in temp_dir.iterdir()) == []  # no half-published extracted/ left


def _multipart_request(body: bytes | None, *, field: str = "package", content_length: str | None = "auto"):
    """A Starlette Request whose body is one multipart part; a None body must never be read."""
    from starlette.requests import Request

    boundary = b"xyz"
    if body is not None:
        payload = (b"--" + boundary + b"\r\nContent-Disposition: form-data; name=\"" + field.encode()
                   + b"\"; filename=\"export.imscc\"\r\nContent-Type: application/octet-stream\r\n\r\n"
                   + body + b"\r\n--" + boundary + b"--\r\n")
    else:
        payload = b""
    headers = [(b"content-type", b"multipart/form-data; boundary=" + boundary)]
    if content_length == "auto":
        headers.append((b"content-length", str(len(payload)).encode()))
    elif content_length is not None:
        headers.append((b"content-length", content_length.encode()))

    async def receive():
        assert body is not None, "the body was read although the request should have been refused first"
        return {"type": "http.request", "body": payload, "more_body": False}

    return Request({"type": "http", "method": "POST", "path": "/", "headers": headers, "query_string": b""}, receive)


@pytest.mark.asyncio
async def test_read_upload_refuses_before_reading_the_body(monkeypatch):
    monkeypatch.setattr(f"{SVC}.MAX_LMS_UPLOAD_SIZE", 1024 * 1024)
    with pytest.raises(HTTPException) as exc:
        await svc._read_upload(_multipart_request(None, content_length=None))
    assert exc.value.status_code == 411
    with pytest.raises(HTTPException) as exc:
        await svc._read_upload(_multipart_request(None, content_length=str(10 * 1024 * 1024)))
    assert exc.value.status_code == 413 and "1MB" in exc.value.detail
    with pytest.raises(HTTPException) as exc:
        await svc._read_upload(_multipart_request(b"PK", field="other"))
    assert exc.value.status_code == 400
    upload = await svc._read_upload(_multipart_request(b"PK\x03\x04"))
    assert upload.filename == "export.imscc" and await upload.read() == b"PK\x03\x04"


@pytest.mark.asyncio
async def test_start_lms_import_request_authorizes_before_reading(db, org, admin_user, lms_env):
    # A caller without rights is refused with the body untouched
    with patch(f"{SVC}.check_resource_access", side_effect=HTTPException(status_code=403, detail="no")):
        with pytest.raises(HTTPException) as exc:
            await svc.start_lms_import_request(_multipart_request(None), org.id, "auto", "page", admin_user, db)
    assert exc.value.status_code == 403
    with patch(f"{SVC}.convert_to_directory", side_effect=_fake_convert):
        started = await svc.start_lms_import_request(_multipart_request(b"PK\x03\x04 export"), org.id, "auto",
                                                     "page", admin_user, db)
        await _wait_all()
    assert started.status == "processing"
    assert (lms_env / started.temp_id / "extracted" / "manifest.json").is_file()


@pytest.mark.asyncio
async def test_route_reads_a_real_multipart_upload(client, lms_env):
    with patch(f"{SVC}.convert_to_directory", side_effect=_fake_convert):
        r = await client.post("/api/v1/courses/import/lms/analyze?org_id=1&source=auto&quiz_mode=page",
                              files={"package": ("backup.mbz", b"PK\x03\x04 export", "application/octet-stream")})
        await _wait_all()
    assert r.status_code == 200 and r.json()["status"] == "processing", r.text
    assert (lms_env / r.json()["temp_id"] / "extracted" / "manifest.json").is_file()
    # No file part: refused before any conversion starts
    r = await client.post("/api/v1/courses/import/lms/analyze?org_id=1", data={"note": "x"})
    assert r.status_code == 400
