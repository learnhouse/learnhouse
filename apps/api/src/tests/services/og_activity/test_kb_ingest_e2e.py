from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import select

from src.db.courses.activities import Activity, ActivitySubTypeEnum
from src.db.courses.courses import Course
from src.services.og_activity.kb_ingest import ingest_from_kb
from src.services.og_activity.store import ServiceActivityStore
from src.services.og_activity.types import register_builtin_types

_PATCH_RBAC = "src.services.courses.activities.activities.check_resource_access"


@pytest.fixture(autouse=True)
def _register_builtins():
    register_builtin_types()
    yield


class FakeKb:
    """Two launches; one artifact each. Only L1's artifact is approved."""

    def __init__(self, body="# Permitting\n\nText.", sha="sha-1"):
        self._body = body
        self._sha = sha
        self.artifacts = [
            {"id": "art-1", "name": "Permitting 101", "launchId": "L1", "status": "approved", "sourceSha": sha},
            {"id": "art-2", "name": "Draft", "launchId": "L2", "status": "in_review", "sourceSha": "x"},
        ]

    async def list_artifacts(self, *, limit=200, offset=0):
        return self.artifacts

    async def list_all_artifacts(self, *, page_size=200):
        return self.artifacts

    async def get_entity(self, entity_type, entity_id):
        if entity_type == "launch":
            return {"id": entity_id, "name": "Q3 Release", "summary": "s", "sourceSha": "lsha"}
        # launch_artifact full row
        return {"id": entity_id, "name": "Permitting 101", "bodyMd": self._body, "sourceSha": self._sha}

    async def traverse(self, from_id, from_type, target_types, *, max_depth=3):
        return [{"id": "p1", "type": "product", "relType": "for_product", "name": "Procurement"}]


async def _run(db, request, user, kb, org_id=1):
    store = ServiceActivityStore(request, user, db)
    with patch(_PATCH_RBAC, new_callable=AsyncMock):
        return await ingest_from_kb(kb, session=db, org_id=org_id, store=store)


@pytest.mark.asyncio
async def test_only_approved_launch_synced_with_markdown_activity(db, org, mock_request, admin_user):
    kb = FakeKb()
    report = await _run(db, mock_request, admin_user, kb)

    assert report.created == 1
    courses = (await db.execute(select(Course).where(Course.org_id == org.id))).scalars().all()
    assert len(courses) == 1  # only L1 (L2's artifact was not approved)
    assert courses[0].extra_metadata["kb_id"] == "L1"
    assert "product:procurement" in courses[0].tags

    activities = (await db.execute(select(Activity))).scalars().all()
    assert len(activities) == 1
    assert activities[0].activity_sub_type is ActivitySubTypeEnum.SUBTYPE_DYNAMIC_MARKDOWN
    assert activities[0].content == {"markdown": "# Permitting\n\nText."}
    assert activities[0].extra_metadata["kb_id"] == "art-1"


@pytest.mark.asyncio
async def test_rerun_is_idempotent_then_updates_on_sha_change(db, org, mock_request, admin_user):
    await _run(db, mock_request, admin_user, FakeKb())

    # Unchanged re-run: skipped, no duplicate.
    report2 = await _run(db, mock_request, admin_user, FakeKb())
    assert report2.skipped == 1 and report2.created == 0
    assert len((await db.execute(select(Activity))).scalars().all()) == 1

    # Changed body + sha: update in place.
    report3 = await _run(db, mock_request, admin_user, FakeKb(body="# Permitting v2", sha="sha-2"))
    assert report3.updated == 1
    activities = (await db.execute(select(Activity))).scalars().all()
    assert len(activities) == 1
    assert activities[0].content == {"markdown": "# Permitting v2"}


class FakeKbOneLaunchFails(FakeKb):
    """L1 succeeds; fetching launch entity for L2 raises."""

    def __init__(self):
        super().__init__()
        # Make BOTH artifacts approved but in different launches.
        self.artifacts = [
            {"id": "art-1", "name": "Good", "launchId": "L1", "status": "approved", "sourceSha": "s1"},
            {"id": "art-2", "name": "Bad", "launchId": "L2", "status": "approved", "sourceSha": "s2"},
        ]

    async def get_entity(self, entity_type, entity_id):
        if entity_type == "launch" and entity_id == "L2":
            raise RuntimeError("KB launch fetch failed")
        return await super().get_entity(entity_type, entity_id)


@pytest.mark.asyncio
async def test_one_launch_failure_does_not_abort_others(db, org, mock_request, admin_user):
    org_id = org.id  # capture before rollback expires the ORM object
    report = await _run(db, mock_request, admin_user, FakeKbOneLaunchFails(), org_id=org_id)
    assert report.errors == 1
    assert report.created == 1  # L1's artifact still ingested
    courses = (await db.execute(select(Course).where(Course.org_id == org_id))).scalars().all()
    kb_ids = {c.extra_metadata["kb_id"] for c in courses}
    assert "L1" in kb_ids and "L2" not in kb_ids
