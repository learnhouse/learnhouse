from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import httpx

from config.config import get_learnhouse_config
from src.security.auth import get_current_user


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
        headers["X-Auth-Token"] = judge0_cfg.client_id
    if judge0_cfg.client_secret:
        headers["X-Auth-User"] = judge0_cfg.client_secret
    return headers


async def _submit_single(judge0_cfg, language_id: int, source_code: str, stdin: str) -> dict:
    """Single submission with wait=true."""
    url = f"{judge0_cfg.api_url}/submissions?base64_encoded=false&wait=true"
    payload = {
        "language_id": language_id,
        "source_code": source_code,
        "stdin": stdin,
    }
    async with httpx.AsyncClient(timeout=JUDGE0_TIMEOUT) as client:
        resp = await client.post(url, json=payload, headers=_judge0_headers(judge0_cfg))
        if resp.status_code not in (200, 201):
            raise HTTPException(status_code=resp.status_code, detail=f"Judge0 error: {resp.text}")
        return resp.json()


async def _submit_batch(judge0_cfg, submissions: list[dict]) -> list[dict]:
    """Batch submission via POST /submissions/batch, then poll GET /submissions/batch."""
    headers = _judge0_headers(judge0_cfg)

    # Create batch
    create_url = f"{judge0_cfg.api_url}/submissions/batch?base64_encoded=false"
    async with httpx.AsyncClient(timeout=JUDGE0_TIMEOUT) as client:
        resp = await client.post(create_url, json={"submissions": submissions}, headers=headers)
        if resp.status_code not in (200, 201):
            raise HTTPException(status_code=resp.status_code, detail=f"Judge0 batch error: {resp.text}")
        tokens = [s["token"] for s in resp.json()]

    # Poll until all are done (status.id >= 3)
    tokens_csv = ",".join(tokens)
    get_url = f"{judge0_cfg.api_url}/submissions/batch?tokens={tokens_csv}&base64_encoded=false"
    import asyncio
    async with httpx.AsyncClient(timeout=JUDGE0_TIMEOUT) as client:
        for _ in range(30):  # max ~15s of polling
            resp = await client.get(get_url, headers=headers)
            if resp.status_code not in (200, 201):
                raise HTTPException(status_code=resp.status_code, detail=f"Judge0 poll error: {resp.text}")
            results = resp.json()["submissions"]
            if all((r.get("status", {}).get("id", 0) or 0) >= 3 for r in results):
                return results
            await asyncio.sleep(0.5)

    # Return whatever we have after timeout
    return results


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

    # Build batch submissions using Judge0's native expected_output
    submissions = []
    tc_order = []
    for tc in body.test_cases:
        submissions.append({
            "language_id": body.language_id,
            "source_code": body.source_code,
            "stdin": tc.stdin,
            "expected_output": tc.expected_stdout,
        })
        tc_order.append(tc)

    raw_results = await _submit_batch(judge0_cfg, submissions)

    results = []
    for tc, r in zip(tc_order, raw_results):
        status = r.get("status", {})
        # Judge0 status 3 = Accepted (output matches expected_output)
        passed = status.get("id") == 3
        results.append({
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
        })
    return {"results": results}
