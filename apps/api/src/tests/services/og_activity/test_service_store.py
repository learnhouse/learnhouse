from unittest.mock import AsyncMock, patch

import pytest

from src.db.courses.activities import ActivityTypeEnum, ActivitySubTypeEnum
from src.services.og_activity.spec import LearnHouseActivitySpec
from src.services.og_activity.store import ServiceActivityStore
from src.services.og_activity.registry import _REGISTRY
from src.services.og_activity.types import register_builtin_types

_PATCH_RBAC = "src.services.courses.activities.activities.check_resource_access"


@pytest.fixture(autouse=True)
def _register_builtins():
    # The Task 8 end-to-end test drives the adapter through the registry;
    # register here so a registry-clearing test file run earlier can't break it.
    _REGISTRY.clear()
    register_builtin_types()
    yield


def _spec(blocks=None):
    return LearnHouseActivitySpec(
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={"type": "doc", "content": blocks or []},
    )


@pytest.mark.asyncio
async def test_create_persists_with_provenance(mock_request, db, org, course, chapter, admin_user):
    store = ServiceActivityStore(mock_request, admin_user, db)
    with patch(_PATCH_RBAC, new_callable=AsyncMock):
        created = await store.create(
            _spec(), "Lesson", chapter.id, {"source": "kb", "kb_id": "kb-1", "kb_sha": "sha-1"}
        )
    assert created.name == "Lesson"
    assert created.extra_metadata == {"source": "kb", "kb_id": "kb-1", "kb_sha": "sha-1"}


@pytest.mark.asyncio
async def test_find_by_kb_id_returns_match(mock_request, db, org, course, chapter, admin_user):
    store = ServiceActivityStore(mock_request, admin_user, db)
    with patch(_PATCH_RBAC, new_callable=AsyncMock):
        await store.create(_spec(), "Lesson", chapter.id, {"source": "kb", "kb_id": "kb-7"})
    found = await store.find_by_kb_id(course.id, "kb-7")
    assert found is not None and (found.extra_metadata or {}).get("kb_id") == "kb-7"
    assert await store.find_by_kb_id(course.id, "kb-missing") is None


@pytest.mark.asyncio
async def test_update_changes_content(mock_request, db, org, course, chapter, admin_user):
    store = ServiceActivityStore(mock_request, admin_user, db)
    with patch(_PATCH_RBAC, new_callable=AsyncMock):
        created = await store.create(_spec(), "Lesson", chapter.id, {"source": "kb", "kb_id": "kb-1"})
        updated = await store.update(
            created.activity_uuid, _spec(blocks=[{"x": 1}]), "Lesson v2", {"source": "kb", "kb_id": "kb-1", "kb_sha": "sha-2"}
        )
    assert updated.content == {"type": "doc", "content": [{"x": 1}]}
    assert updated.extra_metadata.get("kb_sha") == "sha-2"
