import httpx
import pytest

from src.services.og_activity import kb_client
from src.services.og_activity.kb_client import KbClient, approved


class _Resp:
    def __init__(self, data, status=200):
        self._data = data
        self.status_code = status

    def json(self):
        return self._data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("err", request=None, response=None)


def test_approved_filters_by_status():
    rows = [
        {"id": "1", "status": "approved"},
        {"id": "2", "status": "in_review"},
        {"id": "3", "status": "approved"},
        {"id": "4"},  # missing status
    ]
    assert [r["id"] for r in approved(rows)] == ["1", "3"]


@pytest.mark.asyncio
async def test_list_artifacts_hits_entities_path(monkeypatch):
    seen = {}

    async def fake_get(self, url, params=None, headers=None, timeout=None):
        seen["url"] = url
        seen["params"] = params
        seen["auth"] = headers["Authorization"]
        return _Resp([{"id": "a", "status": "approved", "launchId": "L1"}])

    monkeypatch.setattr(kb_client.httpx.AsyncClient, "get", fake_get)

    client = KbClient("https://kb/api", "tok")
    rows = await client.list_artifacts(limit=50)

    assert rows == [{"id": "a", "status": "approved", "launchId": "L1"}]
    assert seen["url"] == "https://kb/api/entities/launch_artifact"
    assert seen["params"] == {"limit": 50, "offset": 0}
    assert seen["auth"] == "Bearer tok"


@pytest.mark.asyncio
async def test_get_entity_path(monkeypatch):
    async def fake_get(self, url, params=None, headers=None, timeout=None):
        return _Resp({"id": "x", "bodyMd": "# Hi"})

    monkeypatch.setattr(kb_client.httpx.AsyncClient, "get", fake_get)
    client = KbClient("https://kb/api/", "tok")
    entity = await client.get_entity("launch", "x")
    assert entity == {"id": "x", "bodyMd": "# Hi"}


@pytest.mark.asyncio
async def test_get_propagates_http_error(monkeypatch):
    async def fake_get(self, url, params=None, headers=None, timeout=None):
        return _Resp({}, status=404)

    monkeypatch.setattr(kb_client.httpx.AsyncClient, "get", fake_get)
    with pytest.raises(httpx.HTTPStatusError):
        await KbClient("https://kb/api", "tok").get_entity("launch", "x")


@pytest.mark.asyncio
async def test_traverse_unwraps_rows_envelope(monkeypatch):
    seen = {}

    async def fake_get(self, url, params=None, headers=None, timeout=None):
        seen["url"] = url
        seen["params"] = params
        return _Resp({"rows": [{"id": "p", "type": "product", "relType": "for_product"}], "meta": {}})

    monkeypatch.setattr(kb_client.httpx.AsyncClient, "get", fake_get)
    client = KbClient("https://kb/api", "tok")
    rows = await client.traverse("L1", "launch", ["product", "market"], max_depth=3)
    assert rows == [{"id": "p", "type": "product", "relType": "for_product"}]
    assert seen["url"] == "https://kb/api/entities/launch/L1/traverse"
    assert seen["params"] == {"targetTypes": "product,market", "maxDepth": 3}


@pytest.mark.asyncio
async def test_traverse_accepts_bare_list(monkeypatch):
    async def fake_get(self, url, params=None, headers=None, timeout=None):
        return _Resp([{"id": "p", "type": "product"}])

    monkeypatch.setattr(kb_client.httpx.AsyncClient, "get", fake_get)
    client = KbClient("https://kb/api", "tok")
    rows = await client.traverse("L1", "launch", ["product"])
    assert rows == [{"id": "p", "type": "product"}]


@pytest.mark.asyncio
async def test_list_all_artifacts_paginates(monkeypatch):
    # Two full pages of size 2, then a short page -> stop.
    pages = {0: [{"id": "1"}, {"id": "2"}], 2: [{"id": "3"}, {"id": "4"}], 4: [{"id": "5"}]}

    async def fake_get(self, url, params=None, headers=None, timeout=None):
        return _Resp(pages[params["offset"]])

    monkeypatch.setattr(kb_client.httpx.AsyncClient, "get", fake_get)
    client = KbClient("https://kb/api", "tok")
    rows = await client.list_all_artifacts(page_size=2)
    assert [r["id"] for r in rows] == ["1", "2", "3", "4", "5"]
