"""
Import courses exported from another LMS (Moodle, Canvas, Blackboard,
Brightspace, Open edX, Common Cartridge).

The upload is converted into a LearnHouse course package by
``services.courses.lms_import`` and written straight into the course
importer's temp folder, so the regular ``POST /courses/import`` step imports
it. Conversion can take minutes on a large backup, so it runs in a worker
thread and the client polls for the result:

    POST /courses/import/lms/analyze      -> {temp_id, status: "processing"}
    GET  /courses/import/lms/analyze/{id} -> {status: "ready", courses, report} | {status: "failed", error}
    POST /courses/import                  -> the usual import with temp_id
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import time
from collections import Counter
from typing import Literal, Optional
from uuid import uuid4

from fastapi import HTTPException, Request, UploadFile
from starlette.datastructures import UploadFile as StarletteUploadFile
from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import Organization
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.security.org_auth import require_org_create_permission
from src.security.rbac import AccessAction, check_resource_access
from src.services.courses.lms_import import ConversionError, ConvertOptions, convert_to_directory
from src.services.courses.lms_import.convert import title_from_filename
from src.services.courses.lms_import.package import QUIZ_MODES
from src.services.courses.lms_import.sources import SOURCE_MODULES, get_source

from .import_service import (
    TEMP_IMPORT_DIR,
    _require_temp_id,
    _resolve_within,
    cleanup_old_temp_imports,
    lms_principal,
    summarize_extracted_package,
)
from .models import ImportCourseInfo

logger = logging.getLogger(__name__)

# LMS backups are much larger than LearnHouse packages (Moodle .mbz files ship
# every video). The nginx in the image accepts bodies up to 6 GB.
MAX_LMS_UPLOAD_SIZE = int(os.environ.get("LEARNHOUSE_LMS_IMPORT_MAX_MB", "4096")) * 1024 * 1024
UPLOAD_CHUNK = 1024 * 1024

# Conversions are disk and CPU heavy; a few at a time per API process, and
# a bounded queue behind them (each queued upload holds its file on disk)
MAX_CONCURRENT_CONVERSIONS = 2
MAX_QUEUED_CONVERSIONS = 8
MAX_CONVERSIONS_PER_USER = 2
_conversion_slots = asyncio.Semaphore(MAX_CONCURRENT_CONVERSIONS)

# A running conversion refreshes its status file; one that stopped
# refreshing (API restarted mid-conversion) is reported as failed
HEARTBEAT_SECONDS = 30
STALE_PROCESSING_SECONDS = 10 * 60

# Abandoned uploads and finished-but-never-imported packages
STALE_PACKAGE_MINUTES = 24 * 60

STATUS_FILE = "lms_status.json"

# Strong references so running conversions are not garbage collected
_running: set[asyncio.Task] = set()
_running_by_owner: Counter[str] = Counter()
# Uploads being written whose conversion has not started yet: they hold a
# queue slot, or parallel requests would all pass the limit check
_pending = 0


class SkippedItemModel(BaseModel):
    title: str
    kind: str
    reason: str


class LmsImportReport(BaseModel):
    counts: dict[str, int] = {}
    warnings: list[str] = []
    dropped_warnings: int = 0
    skipped: list[SkippedItemModel] = []
    dropped_skipped: int = 0


class LmsImportStatus(BaseModel):
    temp_id: str
    status: Literal["processing", "ready", "failed"]
    source: Optional[str] = None
    source_label: Optional[str] = None
    error: Optional[str] = None
    version: Optional[str] = None
    courses: list[ImportCourseInfo] = []
    report: Optional[LmsImportReport] = None


class LmsSource(BaseModel):
    key: str
    label: str


class LmsImportSources(BaseModel):
    sources: list[LmsSource]
    max_upload_mb: int


def list_sources() -> LmsImportSources:
    return LmsImportSources(
        sources=[LmsSource(key=k, label=get_source(k).LABEL) for k in SOURCE_MODULES],
        max_upload_mb=MAX_LMS_UPLOAD_SIZE // (1024 * 1024),
    )


def _write_status(temp_dir: str, data: dict) -> None:
    tmp = os.path.join(temp_dir, STATUS_FILE + ".part")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, os.path.join(temp_dir, STATUS_FILE))


def _read_status(temp_dir: str) -> Optional[dict]:
    try:
        with open(os.path.join(temp_dir, STATUS_FILE), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


async def _authorize(request: Request, org_id: int, current_user, db_session: AsyncSession) -> None:
    statement = select(Organization).where(Organization.id == org_id)
    organization = (await db_session.execute(statement)).scalars().first()
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")
    # Same gate as the LearnHouse package import: the result ends in courses
    await check_resource_access(request, db_session, current_user, "course_x", AccessAction.CREATE)
    await require_org_create_permission(current_user, org_id, db_session, "courses")


def _run_conversion(temp_dir: str, upload_path: str, source: str, quiz_mode: str, filename: str = "") -> dict:
    """Blocking part, run in a worker thread. Returns the status payload."""
    work_dir = os.path.join(temp_dir, "work")
    building = os.path.join(temp_dir, "building")
    extract_dir = os.path.join(temp_dir, "extracted")
    done = False
    try:
        result = convert_to_directory(
            upload_path, building, source=source, work_dir=work_dir,
            options=ConvertOptions(quiz_mode=quiz_mode, fallback_title=title_from_filename(filename)),
        )
        # The importer looks for extracted/manifest.json: only expose the
        # package once it is complete
        os.rename(building, extract_dir)
        temp_id = os.path.basename(temp_dir)
        summary = summarize_extracted_package(extract_dir, temp_id)
        payload = {
            "status": "ready",
            "source": result.course.source,
            "source_label": get_source(result.course.source).LABEL,
            "version": summary.version,
            "courses": [c.model_dump() for c in summary.courses],
            "report": result.report.to_dict(),
        }
        done = True
        return payload
    except ConversionError as e:
        return {"status": "failed", "error": str(e)}
    except HTTPException as e:
        return {"status": "failed", "error": str(e.detail)}
    except Exception:
        logger.exception("LMS conversion failed")
        return {"status": "failed", "error": "The export could not be converted."}
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
        shutil.rmtree(building, ignore_errors=True)
        if not done:
            shutil.rmtree(extract_dir, ignore_errors=True)
        try:
            os.unlink(upload_path)
        except OSError:
            pass


def _processing(owner: str) -> dict:
    return {"status": "processing", "owner": owner, "updated_at": time.time()}


async def _heartbeat(temp_dir: str, owner: str) -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_SECONDS)
        try:
            _write_status(temp_dir, _processing(owner))
        except OSError:
            pass


async def _convert_in_background(temp_dir: str, upload_path: str, source: str, quiz_mode: str,
                                 owner: str, filename: str = "") -> None:
    heartbeat = asyncio.create_task(_heartbeat(temp_dir, owner))
    try:
        async with _conversion_slots:
            payload = await asyncio.to_thread(_run_conversion, temp_dir, upload_path, source, quiz_mode, filename)
    finally:
        heartbeat.cancel()
        try:
            await heartbeat
        except asyncio.CancelledError:
            pass
        _release(owner)
    payload["owner"] = owner
    try:
        _write_status(temp_dir, payload)
    except OSError:
        logger.exception("Could not record LMS conversion status")


# Multipart framing and the other form fields, on top of the file itself
_MULTIPART_OVERHEAD = 64 * 1024


async def start_lms_import_request(
    request: Request,
    org_id: int,
    source: str,
    quiz_mode: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
) -> LmsImportStatus:
    """The upload endpoint: the request body is read only after the caller is
    authorized and its declared size fits, so an oversized or anonymous upload
    is refused before anything is spooled to disk."""
    await _authorize(request, org_id, current_user, db_session)
    _check_options(source, quiz_mode)
    upload = await _read_upload(request)
    return await _begin(upload, source, quiz_mode, current_user)


async def start_lms_import(
    request: Request,
    upload: UploadFile,
    org_id: int,
    source: str,
    quiz_mode: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
) -> LmsImportStatus:
    await _authorize(request, org_id, current_user, db_session)
    _check_options(source, quiz_mode)
    return await _begin(upload, source, quiz_mode, current_user)


def _check_options(source: str, quiz_mode: str) -> None:
    if source != "auto" and source not in SOURCE_MODULES:
        raise HTTPException(status_code=400, detail=f"Unknown source '{source}'")
    if quiz_mode not in QUIZ_MODES:
        raise HTTPException(status_code=400, detail=f"quiz_mode must be one of: {', '.join(QUIZ_MODES)}")


async def _read_upload(request: Request) -> StarletteUploadFile:
    """The ``package`` file of a multipart request whose declared size is within the limit."""
    length = request.headers.get("content-length")
    if length is None or not length.isdigit():
        raise HTTPException(status_code=411, detail="Content-Length is required for uploads")
    if int(length) > MAX_LMS_UPLOAD_SIZE + _MULTIPART_OVERHEAD:
        raise HTTPException(
            status_code=413,
            detail=f"Export too large. Maximum size is {MAX_LMS_UPLOAD_SIZE // (1024 * 1024)}MB",
        )
    form = await request.form()
    upload = form.get("package")
    # request.form() yields Starlette's UploadFile, the base of FastAPI's
    if not isinstance(upload, StarletteUploadFile):
        raise HTTPException(status_code=400, detail="A 'package' file is required")
    return upload


async def _begin(
    upload: StarletteUploadFile,
    source: str,
    quiz_mode: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
) -> LmsImportStatus:
    global _pending
    owner = lms_principal(current_user)
    if len(_running) + _pending >= MAX_QUEUED_CONVERSIONS or _running_by_owner[owner] >= MAX_CONVERSIONS_PER_USER:
        raise HTTPException(
            status_code=429,
            detail="Too many course conversions are running. Please try again in a few minutes.",
        )
    # Take the slot now: writing the upload yields to other requests
    _pending += 1
    _running_by_owner[owner] += 1
    try:
        temp_dir, upload_path = await _store_upload(upload, owner)
    except BaseException:
        _release(owner)
        raise
    finally:
        _pending -= 1

    task = asyncio.create_task(
        _convert_in_background(temp_dir, upload_path, source, quiz_mode, owner, upload.filename or "")
    )
    _running.add(task)
    task.add_done_callback(_running.discard)
    return LmsImportStatus(temp_id=os.path.basename(temp_dir), status="processing")


def _release(owner: str) -> None:
    _running_by_owner[owner] -= 1
    if _running_by_owner[owner] <= 0:
        del _running_by_owner[owner]


async def _store_upload(upload: StarletteUploadFile, owner: str) -> tuple[str, str]:
    """Write the upload into a fresh temp folder; returns ``(temp_dir, upload_path)``."""
    await asyncio.to_thread(cleanup_old_temp_imports, max_age_minutes=STALE_PACKAGE_MINUTES)

    temp_id = str(uuid4())
    temp_base_real = os.path.realpath(TEMP_IMPORT_DIR)
    os.makedirs(temp_base_real, exist_ok=True)
    temp_dir = _resolve_within(temp_base_real, temp_id)
    os.makedirs(temp_dir)
    upload_path = os.path.join(temp_dir, "upload.bin")
    try:
        total = 0
        with open(upload_path, "wb") as f:
            while True:
                chunk = await upload.read(UPLOAD_CHUNK)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_LMS_UPLOAD_SIZE:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Export too large. Maximum size is {MAX_LMS_UPLOAD_SIZE // (1024 * 1024)}MB",
                    )
                f.write(chunk)
        if total == 0:
            raise HTTPException(status_code=400, detail="The uploaded file is empty")
        _write_status(temp_dir, _processing(owner))
    except BaseException:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    return temp_dir, upload_path


async def get_lms_import_status(
    request: Request,
    temp_id: str,
    org_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: AsyncSession,
) -> LmsImportStatus:
    await _authorize(request, org_id, current_user, db_session)
    _require_temp_id(temp_id)
    temp_dir = _resolve_within(os.path.realpath(TEMP_IMPORT_DIR), temp_id)
    data = _read_status(temp_dir) if os.path.isdir(temp_dir) else None
    # A conversion is only visible to whoever uploaded it; a foreign or
    # unknown id reads the same as a missing one
    if data is None or data.get("owner") != lms_principal(current_user):
        raise HTTPException(status_code=404, detail="Import not found. Please upload the export again.")
    if data.get("status") == "processing" and time.time() - data.get("updated_at", 0) > STALE_PROCESSING_SECONDS:
        data = {"status": "failed", "error": "The conversion was interrupted. Please upload the export again."}
    report = data.get("report")
    return LmsImportStatus(
        temp_id=temp_id,
        status=data.get("status", "failed"),
        source=data.get("source"),
        source_label=data.get("source_label"),
        error=data.get("error"),
        version=data.get("version"),
        courses=[ImportCourseInfo(**c) for c in data.get("courses", [])],
        report=LmsImportReport(**report) if report else None,
    )
