import pytest

from src.jobs import kb_sync


class _Resp:
    def __init__(self, data):
        self._data = data

    def json(self):
        return self._data

    def raise_for_status(self):
        return None


class _PagingClient:
    """Honors `offset`: serves page N from `pages[N]`, empty past the end."""

    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    async def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(params)
        idx = params["offset"] // params["limit"]
        return _Resp(self.pages[idx] if idx < len(self.pages) else [])


class _StaticClient:
    """Ignores `offset`: always serves the same full page (worst case)."""

    def __init__(self, page):
        self.page = page
        self.calls = []

    async def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(params)
        return _Resp(self.page)


@pytest.mark.asyncio
async def test_fetch_all_artifacts_paginates_past_first_page():
    page1 = [{"id": str(i)} for i in range(kb_sync._PAGE_SIZE)]
    page2 = [{"id": str(i)} for i in range(kb_sync._PAGE_SIZE, kb_sync._PAGE_SIZE + 50)]
    client = _PagingClient([page1, page2])

    rows = await kb_sync._fetch_all_artifacts(client, "https://kb", "tok")

    assert len(rows) == kb_sync._PAGE_SIZE + 50  # not truncated at the first page


@pytest.mark.asyncio
async def test_fetch_all_artifacts_terminates_when_offset_ignored():
    page = [{"id": str(i)} for i in range(kb_sync._PAGE_SIZE)]
    client = _StaticClient(page)

    rows = await kb_sync._fetch_all_artifacts(client, "https://kb", "tok")

    # Deduped by id and stopped — no infinite loop against an offset-ignoring API.
    assert len(rows) == kb_sync._PAGE_SIZE
    assert len(client.calls) == 2  # page 0 consumed; page 1 had no new ids → stop


class FakeLH:
    def __init__(self):
        self.upserts = []

    async def upsert_course(self, **kwargs):
        self.upserts.append(kwargs)


@pytest.mark.asyncio
async def test_only_approved_artifacts_sync():
    rows = [
        {"id": "a", "name": "A", "summary": "s", "bodyMd": "b",
         "status": "approved", "artifactType": "release_notes", "sourceSha": "sha1"},
        {"id": "b", "name": "B", "summary": "s", "bodyMd": "b",
         "status": "in_review", "artifactType": "messaging", "sourceSha": "sha2"},
    ]
    lh = FakeLH()
    await kb_sync.sync_rows(rows, lh, org_id=1)

    assert len(lh.upserts) == 1
    up = lh.upserts[0]
    assert up["course"]["name"] == "A"
    assert up["course"]["tags"] == "source:kb,type:release_notes"
    assert up["match"] == {"extra_metadata.kb_id": "a"}
    assert up["course"]["extra_metadata"]["kb_sha"] == "sha1"
    assert up["course"]["published"] is True
    assert up["course"]["public"] is False


@pytest.mark.asyncio
async def test_empty_when_none_approved():
    rows = [{"id": "x", "name": "X", "status": "generating",
             "artifactType": "messaging", "sourceSha": "s"}]
    lh = FakeLH()
    await kb_sync.sync_rows(rows, lh, org_id=1)
    assert lh.upserts == []
