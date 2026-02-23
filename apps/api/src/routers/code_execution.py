import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import httpx

from config.config import get_learnhouse_config
from src.security.auth import get_current_user

logger = logging.getLogger(__name__)


router = APIRouter()

JUDGE0_TIMEOUT = 30.0


class ExecuteRequest(BaseModel):
    language_id: int
    source_code: str
    stdin: str = ""


class TestCase(BaseModel):
    id: str
    label: str
    stdin: str
    expected_stdout: str


class ExecuteBatchRequest(BaseModel):
    language_id: int
    source_code: str
    test_cases: list[TestCase]


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


async def _submit_single(judge0_cfg, language_id: int, source_code: str, stdin: str) -> dict:
    """Single submission with wait=true."""
    url = f"{judge0_cfg.api_url}/submissions?wait=true"
    payload = {
        "language_id": language_id,
        "source_code": source_code,
        "stdin": stdin,
    }
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
    result = await _submit_single(judge0_cfg, body.language_id, body.source_code, body.stdin)
    return result


@router.post("/execute-batch")
async def execute_batch(
    body: ExecuteBatchRequest,
    _current_user=Depends(get_current_user),
):
    judge0_cfg = _get_judge0_config()

    # Run all test cases concurrently using single submissions
    async def run_test(tc: TestCase) -> dict:
        r = await _submit_single(
            judge0_cfg, body.language_id, body.source_code, tc.stdin
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
