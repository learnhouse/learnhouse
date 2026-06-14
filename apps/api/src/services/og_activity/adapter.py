from dataclasses import dataclass
from typing import Literal

from src.services.og_activity.contract import ActivityContract, build_provenance
from src.services.og_activity.registry import get_module
from src.services.og_activity.store import ActivityStore


@dataclass
class UpsertResult:
    activity: object
    action: Literal["created", "updated", "skipped"]


async def upsert_activity(
    contract: ActivityContract,
    *,
    chapter_id: int,
    course_id: int,
    org_id: int,
    store: ActivityStore,
) -> UpsertResult:
    """Validate a contract and idempotently upsert it as a LearnHouse activity."""
    module = get_module(contract.type)
    payload = module.validate(contract.payload)  # raises pydantic.ValidationError on bad payload
    spec = module.to_learnhouse(payload)
    provenance = build_provenance(contract.source)

    existing = None
    if contract.source.kb_id:
        existing = await store.find_by_kb_id(course_id, contract.source.kb_id)

    if existing is not None:
        existing_meta = getattr(existing, "extra_metadata", None) or {}
        if contract.source.kb_sha and existing_meta.get("kb_sha") == contract.source.kb_sha:
            return UpsertResult(activity=existing, action="skipped")
        updated = await store.update(existing.activity_uuid, spec, contract.title, provenance)
        return UpsertResult(activity=updated, action="updated")

    created = await store.create(spec, contract.title, chapter_id, provenance)
    return UpsertResult(activity=created, action="created")
