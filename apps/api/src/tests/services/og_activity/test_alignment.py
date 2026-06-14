import pytest

from src.services.og_activity.alignment import (
    AlignmentRef,
    alignment_metadata,
    alignment_tags,
    resolve_alignment,
)


class FakeKb:
    def __init__(self, rows, entities=None, raise_on_traverse=False):
        self._rows = rows
        self._entities = entities or {}
        self._raise = raise_on_traverse
        self.traverse_calls = []

    async def traverse(self, from_id, from_type, target_types, *, max_depth=3):
        self.traverse_calls.append((from_id, from_type, tuple(target_types), max_depth))
        if self._raise:
            raise RuntimeError("kb down")
        return self._rows

    async def get_entity(self, entity_type, entity_id):
        return self._entities.get((entity_type, entity_id), {})


@pytest.mark.asyncio
async def test_resolves_and_dedupes_and_names():
    kb = FakeKb(
        rows=[
            {"id": "p1", "type": "product", "relType": "for_product"},
            {"id": "m1", "type": "market", "relType": "serves_market"},
            {"id": "p1", "type": "product", "relType": "for_product"},  # dup
        ],
        entities={
            ("product", "p1"): {"name": "Procurement"},
            ("market", "m1"): {"name": "State & Local"},
        },
    )
    refs = await resolve_alignment("L1", kb)
    assert refs == [
        AlignmentRef(type="product", id="p1", name="Procurement", rel_type="for_product"),
        AlignmentRef(type="market", id="m1", name="State & Local", rel_type="serves_market"),
    ]
    assert kb.traverse_calls[0][0] == "L1"
    assert kb.traverse_calls[0][1] == "launch"


@pytest.mark.asyncio
async def test_degrades_to_empty_on_traverse_error():
    kb = FakeKb(rows=[], raise_on_traverse=True)
    assert await resolve_alignment("L1", kb) == []


@pytest.mark.asyncio
async def test_falls_back_to_id_when_name_missing():
    kb = FakeKb(rows=[{"id": "c9", "type": "capability", "relType": "addresses_capability"}], entities={})
    refs = await resolve_alignment("L1", kb)
    assert refs == [AlignmentRef(type="capability", id="c9", name="c9", rel_type="addresses_capability")]


class FakeKbGetEntityRaises:
    def __init__(self, rows):
        self._rows = rows

    async def traverse(self, from_id, from_type, target_types, *, max_depth=3):
        return self._rows

    async def get_entity(self, entity_type, entity_id):
        raise RuntimeError("entity fetch down")


@pytest.mark.asyncio
async def test_name_falls_back_to_id_when_get_entity_raises():
    kb = FakeKbGetEntityRaises(rows=[{"id": "p1", "type": "product", "relType": "for_product"}])
    refs = await resolve_alignment("L1", kb)
    assert refs == [AlignmentRef(type="product", id="p1", name="p1", rel_type="for_product")]


def test_alignment_tags_and_metadata():
    refs = [
        AlignmentRef(type="product", id="p1", name="Procurement", rel_type="for_product"),
        AlignmentRef(type="market", id="m1", name="State & Local", rel_type="serves_market"),
    ]
    assert alignment_tags(refs) == "product:procurement,market:state-local"
    assert alignment_metadata(refs) == [
        {"type": "product", "id": "p1", "name": "Procurement", "rel_type": "for_product"},
        {"type": "market", "id": "m1", "name": "State & Local", "rel_type": "serves_market"},
    ]
    assert alignment_tags([]) == ""
