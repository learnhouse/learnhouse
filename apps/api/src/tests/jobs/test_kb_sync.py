import pytest

from src.jobs import kb_sync


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
