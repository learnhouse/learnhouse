from unittest.mock import AsyncMock, patch

import pytest

from src.db.courses.activities import ActivityTypeEnum, ActivitySubTypeEnum
from src.services.og_activity.contract import ActivityContract
from src.services.og_activity.adapter import upsert_activity
from src.services.og_activity.spec import LearnHouseActivitySpec
from src.services.og_activity.store import ServiceActivityStore
from src.services.og_activity.types import register_builtin_types

_PATCH_RBAC = "src.services.courses.activities.activities.check_resource_access"


@pytest.fixture(autouse=True)
def _register_builtins():
    # The end-to-end test drives the adapter through the default registry.
    # register_builtin_types() is idempotent and the _isolate_registry fixture
    # (conftest) restores the registry afterwards.
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


@pytest.mark.asyncio
async def test_update_preserves_details_when_spec_has_none(mock_request, db, org, course, chapter, admin_user):
    # _spec() carries details=None; update must not clobber the row's existing details.
    store = ServiceActivityStore(mock_request, admin_user, db)
    spec_with_details = LearnHouseActivitySpec(
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={"type": "doc", "content": []},
        details={"keep": "me"},
    )
    with patch(_PATCH_RBAC, new_callable=AsyncMock):
        created = await store.create(spec_with_details, "Lesson", chapter.id, {"source": "kb", "kb_id": "kb-d"})
        assert created.details == {"keep": "me"}
        updated = await store.update(
            created.activity_uuid, _spec(blocks=[{"x": 1}]), "Lesson v2", {"source": "kb", "kb_id": "kb-d"}
        )
    assert updated.details == {"keep": "me"}
    assert updated.content == {"type": "doc", "content": [{"x": 1}]}


# (built-in types are registered by the autouse _register_builtins fixture above)


def _dyn_contract(kb_sha="sha-1", blocks=None):
    return ActivityContract.model_validate(
        {
            "type": "dynamic_page",
            "title": "Permitting 101",
            "source": {"origin": "kb", "kb_id": "kb-e2e", "kb_sha": kb_sha},
            "payload": {"blocks": blocks or []},
        }
    )


@pytest.mark.asyncio
async def test_e2e_create_skip_update(mock_request, db, org, course, chapter, admin_user):
    store = ServiceActivityStore(mock_request, admin_user, db)
    with patch(_PATCH_RBAC, new_callable=AsyncMock):
        first = await upsert_activity(
            _dyn_contract(), chapter_id=chapter.id, course_id=course.id, org_id=org.id, store=store
        )
        assert first.action == "created"

        again = await upsert_activity(
            _dyn_contract(), chapter_id=chapter.id, course_id=course.id, org_id=org.id, store=store
        )
        assert again.action == "skipped"

        changed = await upsert_activity(
            _dyn_contract(kb_sha="sha-2", blocks=[{"type": "paragraph"}]),
            chapter_id=chapter.id, course_id=course.id, org_id=org.id, store=store,
        )
        assert changed.action == "updated"
        assert changed.activity.content == {"type": "doc", "content": [{"type": "paragraph"}]}

    found = await store.find_by_kb_id(course.id, "kb-e2e")
    assert found is not None
