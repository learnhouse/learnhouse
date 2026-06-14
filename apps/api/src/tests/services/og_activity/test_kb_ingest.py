import pytest
from types import SimpleNamespace

from src.services.og_activity.contract import ContractType
from src.services.og_activity.kb_ingest import artifact_to_contracts, IngestReport, ingest_artifact
from src.services.og_activity.types import register_builtin_types


def test_body_md_maps_to_markdown_dynamic_page():
    artifact = {
        "id": "art-1",
        "name": "Permitting 101",
        "summary": "intro",
        "sourceSha": "sha-1",
        "skillUsed": "cs-enablement",
        "bodyMd": "# Heading\n\nBody text.",
    }
    contracts = artifact_to_contracts(artifact)
    assert len(contracts) == 1
    c = contracts[0]
    assert c.type is ContractType.DYNAMIC_PAGE
    assert c.title == "Permitting 101"
    assert c.summary == "intro"
    assert c.payload == {"markdown": "# Heading\n\nBody text."}
    assert c.source.origin == "kb"
    assert c.source.kb_id == "art-1"
    assert c.source.kb_sha == "sha-1"
    assert c.source.skill_used == "cs-enablement"


def test_attachments_are_ignored():
    artifact = {"id": "a", "name": "n", "bodyMd": "b", "attachments": [{"fileRef": "f.pdf", "mime": "application/pdf"}]}
    contracts = artifact_to_contracts(artifact)
    assert [c.type for c in contracts] == [ContractType.DYNAMIC_PAGE]


def test_blank_body_md_produces_no_page():
    artifact = {"id": "art-3", "name": "Empty", "bodyMd": "   ", "sourceSha": "s"}
    assert artifact_to_contracts(artifact) == []


def test_artifact_without_id_returns_empty():
    assert artifact_to_contracts({"name": "no id", "bodyMd": "body"}) == []


@pytest.fixture(autouse=True)
def _register_builtins():
    # Idempotent; the og_activity conftest restores the registry afterwards.
    register_builtin_types()
    yield


class FakeActivityStore:
    def __init__(self):
        self.rows = []
        self._uuid = 0

    async def find_by_kb_id(self, course_id, kb_id, org_id=None):
        for r in self.rows:
            if r.course_id == course_id and (r.extra_metadata or {}).get("kb_id") == kb_id:
                return r
        return None

    async def create(self, spec, title, chapter_id, provenance):
        self._uuid += 1
        row = SimpleNamespace(
            activity_uuid=f"a{self._uuid}", name=title, content=spec.content,
            extra_metadata=provenance, course_id=100, chapter_id=chapter_id,
        )
        self.rows.append(row)
        return row

    async def update(self, activity_uuid, spec, title, provenance):
        for r in self.rows:
            if r.activity_uuid == activity_uuid:
                r.name, r.content, r.extra_metadata = title, spec.content, provenance
                return r
        raise AssertionError("update target missing")


def _artifact(sha="sha-1"):
    return {"id": "art-1", "name": "Lesson", "bodyMd": "# Body", "sourceSha": sha}


@pytest.mark.asyncio
async def test_ingest_creates_then_skips_then_updates():
    store = FakeActivityStore()
    report = IngestReport()

    await ingest_artifact(_artifact(), course_id=100, chapter_id=5, org_id=1, store=store, report=report)
    assert (report.created, report.skipped, report.updated) == (1, 0, 0)
    assert len(store.rows) == 1
    assert store.rows[0].content == {"markdown": "# Body"}

    await ingest_artifact(_artifact(), course_id=100, chapter_id=5, org_id=1, store=store, report=report)
    assert report.skipped == 1
    assert len(store.rows) == 1  # no duplicate

    await ingest_artifact(_artifact(sha="sha-2"), course_id=100, chapter_id=5, org_id=1, store=store, report=report)
    assert report.updated == 1
    assert len(store.rows) == 1


@pytest.mark.asyncio
async def test_ingest_writes_single_page_activity():
    store = FakeActivityStore()
    report = IngestReport()
    await ingest_artifact(_artifact(), course_id=100, chapter_id=5, org_id=1, store=store, report=report)
    assert report.created == 1
    assert [(r.extra_metadata or {}).get("kb_id") for r in store.rows] == ["art-1"]
    assert store.rows[0].content == {"markdown": "# Body"}
