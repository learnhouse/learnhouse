from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from src.db.courses.activities import ActivityTypeEnum, ActivitySubTypeEnum
from src.services.og_activity.contract import ActivityContract, ContractType
from src.services.og_activity.spec import LearnHouseActivitySpec
from src.services.og_activity.registry import ActivityTypeModule, register, _REGISTRY
from src.services.og_activity.adapter import upsert_activity


class _StubPayload(BaseModel):
    blocks: list = []


class _StubModule(ActivityTypeModule):
    contract_type = ContractType.DYNAMIC_PAGE
    payload_model = _StubPayload

    def to_learnhouse(self, payload: _StubPayload) -> LearnHouseActivitySpec:
        return LearnHouseActivitySpec(
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            content={"type": "doc", "content": payload.blocks},
        )

    def from_learnhouse(self, activity) -> dict:
        return {"blocks": activity.content.get("content", [])}


class FakeActivityStore:
    def __init__(self):
        self.rows: list[SimpleNamespace] = []
        self._uuid = 0

    async def find_by_kb_id(self, course_id: int, kb_id: str):
        for r in self.rows:
            if r.course_id == course_id and (r.extra_metadata or {}).get("kb_id") == kb_id:
                return r
        return None

    async def create(self, spec, title, chapter_id, provenance):
        self._uuid += 1
        row = SimpleNamespace(
            activity_uuid=f"a{self._uuid}",
            name=title,
            content=spec.content,
            extra_metadata=provenance,
            course_id=100,
            chapter_id=chapter_id,
        )
        self.rows.append(row)
        return row

    async def update(self, activity_uuid, spec, title, provenance):
        for r in self.rows:
            if r.activity_uuid == activity_uuid:
                r.name, r.content, r.extra_metadata = title, spec.content, provenance
                return r
        raise AssertionError("update target missing")


@pytest.fixture(autouse=True)
def _register_stub():
    _REGISTRY.clear()
    register(_StubModule())
    yield
    _REGISTRY.clear()


def _contract(kb_sha="sha-1", blocks=None):
    return ActivityContract.model_validate(
        {
            "type": "dynamic_page",
            "title": "Lesson",
            "source": {"origin": "kb", "kb_id": "kb-1", "kb_sha": kb_sha},
            "payload": {"blocks": blocks or []},
        }
    )


@pytest.mark.asyncio
async def test_creates_when_new():
    store = FakeActivityStore()
    result = await upsert_activity(_contract(), chapter_id=5, course_id=100, org_id=1, store=store)
    assert result.action == "created"
    assert result.activity.extra_metadata == {"source": "kb", "kb_id": "kb-1", "kb_sha": "sha-1"}
    assert len(store.rows) == 1


@pytest.mark.asyncio
async def test_skips_when_kb_sha_unchanged():
    store = FakeActivityStore()
    await upsert_activity(_contract(), chapter_id=5, course_id=100, org_id=1, store=store)
    result = await upsert_activity(_contract(), chapter_id=5, course_id=100, org_id=1, store=store)
    assert result.action == "skipped"
    assert len(store.rows) == 1


@pytest.mark.asyncio
async def test_updates_when_kb_sha_changed():
    store = FakeActivityStore()
    await upsert_activity(_contract(kb_sha="sha-1"), chapter_id=5, course_id=100, org_id=1, store=store)
    result = await upsert_activity(
        _contract(kb_sha="sha-2", blocks=[{"x": 1}]), chapter_id=5, course_id=100, org_id=1, store=store
    )
    assert result.action == "updated"
    assert len(store.rows) == 1
    assert result.activity.content == {"type": "doc", "content": [{"x": 1}]}


@pytest.mark.asyncio
async def test_invalid_payload_raises():
    from pydantic import ValidationError

    bad = ActivityContract.model_validate(
        {"type": "dynamic_page", "title": "x", "source": {"origin": "manual"}, "payload": {"blocks": "notalist"}}
    )
    with pytest.raises(ValidationError):
        await upsert_activity(bad, chapter_id=5, course_id=100, org_id=1, store=FakeActivityStore())
