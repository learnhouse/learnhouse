"""Judge0 submissions travel base64-encoded.

Without ``base64_encoded=true`` Judge0 refuses any submission whose output is
not valid UTF-8 (a program printing raw bytes), and the run fails with an
error instead of showing the student their output.
"""

import base64
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

import src.routers.code_execution as code_execution


def _b64(text: str) -> str:
    return base64.b64encode(text.encode()).decode()


@pytest.fixture
def judge0(monkeypatch):
    """Route the module's httpx client through a mock Judge0."""
    calls = []
    reply = {}

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(reply.get("status", 201), json=reply.get("json", {}))

    real_client = httpx.AsyncClient

    def client(**kwargs):
        return real_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(code_execution.httpx, "AsyncClient", client)
    return SimpleNamespace(calls=calls, reply=reply)


CFG = SimpleNamespace(api_url="http://judge0", client_id=None, client_secret=None)


async def test_sends_and_reads_base64(judge0):
    judge0.reply["json"] = {
        # Ruby's base64 wraps lines; the decoder must tolerate it.
        "stdout": base64.encodebytes("héllo\n".encode()).decode(),
        # Not valid UTF-8: shown with replacement characters, not an error.
        "stderr": base64.b64encode(b"bad \xff byte").decode(),
        "compile_output": None,
        "status": {"id": 3, "description": "Accepted"},
        "time": "0.01",
    }

    result = await code_execution._submit_single(CFG, 71, "print('héllo')", "in")

    (request,) = judge0.calls
    assert request.url.params["base64_encoded"] == "true"
    assert request.url.params["wait"] == "true"
    payload = json.loads(request.content)
    assert payload["source_code"] == _b64("print('héllo')")
    assert payload["stdin"] == _b64("in")

    assert result["stdout"] == "héllo\n"
    assert result["stderr"] == "bad � byte"
    assert result["compile_output"] is None
    assert result["status"] == {"id": 3, "description": "Accepted"}
    assert result["time"] == "0.01"
    assert "message" not in result


async def test_judge0_error_still_raises(judge0):
    judge0.reply.update(status=422, json={"error": "language not found"})

    with pytest.raises(HTTPException) as exc:
        await code_execution._submit_single(CFG, 999, "x", "")
    assert exc.value.status_code == 422
