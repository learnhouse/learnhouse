import pytest
import httpx

from src.services.ai.rag import kb_context


class _Resp:
    def __init__(self, data, status=200):
        self._data = data
        self.status_code = status

    def json(self):
        return self._data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("err", request=None, response=None)


@pytest.mark.asyncio
async def test_only_approved_hits_contribute(monkeypatch):
    async def fake_get(url, params=None, headers=None, timeout=None):
        if url.endswith("/search/hybrid"):
            return _Resp([
                {"id": "1", "type": "launch_artifact", "snippet": "approved text"},
                {"id": "2", "type": "launch_artifact", "snippet": "draft text"},
            ])
        if url.endswith("/entities/launch_artifact/1"):
            return _Resp({"status": "approved"})
        return _Resp({"status": "in_review"})

    monkeypatch.setattr(kb_context.httpx.AsyncClient, "get", lambda self, *a, **k: fake_get(*a, **k))

    out = await kb_context.fetch_kb_context("q", "https://kb", "tok")
    assert "approved text" in out
    assert "draft text" not in out


@pytest.mark.asyncio
async def test_network_failure_returns_empty(monkeypatch):
    async def boom(self, *a, **k):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(kb_context.httpx.AsyncClient, "get", boom)
    assert await kb_context.fetch_kb_context("q", "https://kb", "tok") == ""
