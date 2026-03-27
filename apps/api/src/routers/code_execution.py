import asyncio
import base64
import io
import logging
import os
import zipfile

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, Form
from pydantic import BaseModel
from typing import Optional
import httpx

from config.config import get_learnhouse_config
from src.security.auth import get_current_user
from src.services.utils.upload_content import upload_file

logger = logging.getLogger(__name__)


router = APIRouter()

JUDGE0_TIMEOUT = 30.0

# SQL language ID (Judge0)
SQL_LANGUAGE_ID = 82
# We run SQL via Python's sqlite3 module
PYTHON3_LANGUAGE_ID = 71


class AdditionalFile(BaseModel):
    name: str
    content: str


class ExecuteRequest(BaseModel):
    language_id: int
    source_code: str
    stdin: str = ""
    sqlite_db_path: Optional[str] = None
    additional_files: Optional[list[AdditionalFile]] = None


class TestCase(BaseModel):
    id: str
    label: str
    stdin: str
    expected_stdout: str


class ExecuteBatchRequest(BaseModel):
    language_id: int
    source_code: str
    test_cases: list[TestCase]
    sqlite_db_path: Optional[str] = None
    additional_files: Optional[list[AdditionalFile]] = None


def _get_judge0_config():
    config = get_learnhouse_config()
    if not config.judge0_config:
        raise HTTPException(
            status_code=503,
            detail="Code execution is not configured. Set LEARNHOUSE_JUDGE0_API_URL.",
        )
    return config.judge0_config


def _judge0_headers(judge0_cfg) -> dict:
    headers = {"Content-Type": "application/json"}
    if judge0_cfg.client_id:
        headers["X-Judge0-Client-ID"] = judge0_cfg.client_id
    if judge0_cfg.client_secret:
        headers["X-Judge0-Client-Secret"] = judge0_cfg.client_secret
    return headers


def _wrap_sql_in_python(sql: str) -> str:
    """Wrap raw SQL in a Python script that executes it against db.sqlite3."""
    escaped = sql.replace("\\", "\\\\").replace("'", "\\'")
    return f"""import sqlite3, sys

conn = sqlite3.connect('db.sqlite3')
cursor = conn.cursor()
sql = '''{escaped}'''

for statement in sql.strip().split(';'):
    statement = statement.strip()
    if not statement:
        continue
    cursor.execute(statement)
    if cursor.description:
        cols = [d[0] for d in cursor.description]
        print('|'.join(cols))
        for row in cursor.fetchall():
            print('|'.join(str(v) for v in row))

conn.close()
"""


def _validate_storage_path(file_path: str) -> str:
    """Validate and sanitize a storage file path to prevent path traversal."""
    if '..' in file_path or file_path.startswith('/') or '\x00' in file_path:
        raise HTTPException(status_code=400, detail="Invalid file path")
    normalized = file_path.replace('\\', '/')
    if '..' in normalized:
        raise HTTPException(status_code=400, detail="Invalid file path")
    full_path = f"content/{normalized}"
    # Resolve to absolute and verify containment within content/
    base_real = os.path.realpath("content")
    full_real = os.path.realpath(full_path)
    if not full_real.startswith(base_real + os.sep) and full_real != base_real:
        raise HTTPException(status_code=400, detail="Invalid file path")
    return full_path


def _read_storage_file(file_path: str) -> bytes:
    """Read a file from storage (filesystem or S3)."""
    config = get_learnhouse_config()
    content_delivery = config.hosting_config.content_delivery.type
    safe_path = _validate_storage_path(file_path)

    if content_delivery == "filesystem":
        # Resolve to canonical absolute path and re-verify containment (CodeQL requires
        # the realpath check to be visible immediately before the file operation).
        base_real = os.path.realpath("content")
        resolved = os.path.realpath(safe_path)  # noqa: S108
        if not resolved.startswith(base_real + os.sep):
            raise HTTPException(status_code=400, detail="Invalid file path")
        if not os.path.isfile(resolved):
            raise HTTPException(status_code=404, detail="SQLite database file not found")
        with open(resolved, "rb") as f:
            return f.read()
    elif content_delivery == "s3api":
        import boto3
        from botocore.exceptions import ClientError

        s3 = boto3.client(
            "s3",
            endpoint_url=config.hosting_config.content_delivery.s3api.endpoint_url,
        )
        bucket = config.hosting_config.content_delivery.s3api.bucket_name or "learnhouse-media"
        try:
            response = s3.get_object(Bucket=bucket, Key=safe_path)
            return response["Body"].read()
        except ClientError:
            raise HTTPException(status_code=404, detail="SQLite database file not found")
    else:
        raise HTTPException(status_code=500, detail="Unknown storage backend")


def _make_additional_files_zip(
    db_bytes: bytes | None = None,
    text_files: list[dict] | None = None,
) -> str:
    """Create a base64-encoded zip containing optional SQLite db and/or text files."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        if db_bytes:
            zf.writestr("db.sqlite3", db_bytes)
        if text_files:
            for f in text_files:
                zf.writestr(f["name"], f["content"])
    return base64.b64encode(buf.getvalue()).decode("ascii")


async def _submit_single(
    judge0_cfg,
    language_id: int,
    source_code: str,
    stdin: str,
    additional_files: Optional[str] = None,
) -> dict:
    """Single submission with wait=true."""
    url = f"{judge0_cfg.api_url}/submissions?wait=true"
    payload = {
        "language_id": language_id,
        "source_code": source_code,
        "stdin": stdin,
    }
    if additional_files:
        payload["additional_files"] = additional_files
    headers = _judge0_headers(judge0_cfg)
    logger.info(f"Judge0 POST {url} headers={list(headers.keys())}")
    async with httpx.AsyncClient(timeout=JUDGE0_TIMEOUT) as client:
        resp = await client.post(url, json=payload, headers=headers)
        logger.info(f"Judge0 response: status={resp.status_code}")
        if resp.status_code not in (200, 201):
            logger.error(f"Judge0 error: {resp.text}")
            raise HTTPException(status_code=resp.status_code, detail=f"Judge0 error: {resp.text}")
        return resp.json()


@router.post("/execute")
async def execute_code(
    body: ExecuteRequest,
    _current_user=Depends(get_current_user),
):
    judge0_cfg = _get_judge0_config()

    language_id = body.language_id
    source_code = body.source_code
    additional_files_b64 = None

    zip_files = None
    if body.additional_files:
        zip_files = [{"name": f.name, "content": f.content} for f in body.additional_files]

    if language_id == SQL_LANGUAGE_ID and body.sqlite_db_path:
        db_bytes = _read_storage_file(body.sqlite_db_path)
        language_id = PYTHON3_LANGUAGE_ID
        source_code = _wrap_sql_in_python(body.source_code)
        additional_files_b64 = _make_additional_files_zip(db_bytes=db_bytes, text_files=zip_files)
    elif zip_files:
        additional_files_b64 = _make_additional_files_zip(text_files=zip_files)

    result = await _submit_single(
        judge0_cfg, language_id, source_code, body.stdin, additional_files_b64
    )
    return result


@router.post("/execute-batch")
async def execute_batch(
    body: ExecuteBatchRequest,
    _current_user=Depends(get_current_user),
):
    judge0_cfg = _get_judge0_config()

    language_id = body.language_id
    source_code = body.source_code
    additional_files_b64 = None

    zip_files = None
    if body.additional_files:
        zip_files = [{"name": f.name, "content": f.content} for f in body.additional_files]

    if language_id == SQL_LANGUAGE_ID and body.sqlite_db_path:
        db_bytes = _read_storage_file(body.sqlite_db_path)
        language_id = PYTHON3_LANGUAGE_ID
        source_code = _wrap_sql_in_python(body.source_code)
        additional_files_b64 = _make_additional_files_zip(db_bytes=db_bytes, text_files=zip_files)
    elif zip_files:
        additional_files_b64 = _make_additional_files_zip(text_files=zip_files)

    async def run_test(tc: TestCase) -> dict:
        r = await _submit_single(
            judge0_cfg, language_id, source_code, tc.stdin, additional_files_b64
        )
        status = r.get("status", {})
        actual = (r.get("stdout") or "").rstrip("\n")
        expected = tc.expected_stdout.rstrip("\n")
        passed = status.get("id") == 3 and actual == expected
        return {
            "id": tc.id,
            "label": tc.label,
            "passed": passed,
            "actual_stdout": r.get("stdout"),
            "expected_stdout": tc.expected_stdout,
            "stderr": r.get("stderr"),
            "compile_output": r.get("compile_output"),
            "status": status,
            "time": r.get("time"),
            "memory": r.get("memory"),
        }

    results = await asyncio.gather(*[run_test(tc) for tc in body.test_cases])
    return {"results": list(results)}


@router.post("/upload-sqlite")
async def upload_sqlite_db(
    request: Request,
    file_object: UploadFile,
    activity_uuid: str = Form(),
    block_id: str = Form(),
    org_uuid: str = Form(),
    course_uuid: str = Form(),
    _current_user=Depends(get_current_user),
):
    """Upload a SQLite database file for a code playground block."""
    directory = f"courses/{course_uuid}/activities/{activity_uuid}/dynamic/blocks/codePlayground/{block_id}"

    filename = await upload_file(
        file=file_object,
        directory=directory,
        type_of_dir="orgs",
        uuid=org_uuid,
        allowed_types=["database"],
        filename_prefix="sqlite_db",
    )

    file_path = f"orgs/{org_uuid}/{directory}/{filename}"

    return {
        "file_path": file_path,
        "file_name": file_object.filename,
    }
