"""The DemoEntity registry: which database rows the bundle owns.

Every row the demo creates is registered here against the stable
``(kind, bundle_key)`` identity the manifest declares. That makes two
otherwise-hard questions cheap:

* *Does this bundle entry already exist?* — so the sync can update in place
  instead of creating a duplicate.
* *Was this row created by a visitor?* — anything in the demo org with no
  registry entry was, and gets deleted as drift.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import delete, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.demo_entities import DemoEntity


class Registry:
    """In-memory view of the registry for one sync run.

    Loaded once at the start rather than queried per lookup: a sync touches
    several hundred entries, and the whole table is a few hundred short rows.
    """

    def __init__(self, org_id: Optional[int], rows: list[DemoEntity]):
        self.org_id = org_id
        self._by_identity: dict[tuple[str, str], DemoEntity] = {
            (row.kind, row.bundle_key): row for row in rows
        }
        self._pending: list[DemoEntity] = []
        # Identities this run has claimed, used by prune_removed_from_bundle.
        self._touched: set[tuple[str, str]] = set()

    @classmethod
    async def load(cls, org_id: Optional[int], db_session: AsyncSession) -> "Registry":
        if org_id is None:
            return cls(None, [])
        rows = (
            await db_session.execute(
                select(DemoEntity).where(DemoEntity.org_id == org_id)
            )
        ).scalars().all()
        return cls(org_id, list(rows))

    def get(self, kind: str, bundle_key: str) -> Optional[DemoEntity]:
        return self._by_identity.get((kind, bundle_key))

    def uuid_for(self, kind: str, bundle_key: str) -> Optional[str]:
        entry = self.get(kind, bundle_key)
        return entry.entity_uuid if entry else None

    def uuids_of_kind(self, kind: str) -> set[str]:
        return {
            row.entity_uuid
            for (row_kind, _), row in self._by_identity.items()
            if row_kind == kind
        }

    def ids_of_kind(self, kind: str) -> set[int]:
        return {
            row.entity_id
            for (row_kind, _), row in self._by_identity.items()
            if row_kind == kind
        }

    def register(
        self,
        db_session: AsyncSession,
        *,
        kind: str,
        bundle_key: str,
        entity_id: int,
        entity_uuid: str,
        org_id: int,
    ) -> DemoEntity:
        """Record a row as bundle-owned, or update where an existing one points.

        The update path matters after a visitor deletes something: the sync
        re-creates it, and the registry entry has to follow it to its new
        primary key while keeping the same uuid so its media still resolves.
        """
        now = str(datetime.now())
        self._touched.add((kind, bundle_key))
        existing = self.get(kind, bundle_key)
        if existing is not None:
            if existing.entity_id != entity_id or existing.entity_uuid != entity_uuid:
                existing.entity_id = entity_id
                existing.entity_uuid = entity_uuid
                existing.update_date = now
                db_session.add(existing)
            return existing

        entry = DemoEntity(
            kind=kind,
            bundle_key=bundle_key,
            entity_id=entity_id,
            entity_uuid=entity_uuid,
            org_id=org_id,
            creation_date=now,
            update_date=now,
        )
        db_session.add(entry)
        self._by_identity[(kind, bundle_key)] = entry
        self._pending.append(entry)
        return entry

    async def prune_removed_from_bundle(self, db_session: AsyncSession) -> int:
        """Forget entries for bundle entries that no longer exist.

        Deleting a course from the bundle would otherwise leave it in the demo
        forever: nothing recreates it, but its registry entry still claims its
        uuid as bundle-owned, so drift deletion skips it too. Forgetting the
        entry hands the row to the drift pass, which removes it along with its
        stored media — so this must run *before* drift deletion.

        Restricted to kinds this run actually claimed something in. Several
        phases are conditional (the storefront needs the Enterprise Edition,
        for one), and a phase that was skipped rather than emptied must not
        have its whole kind swept: the rows would survive with nothing left
        tracking them.
        """
        claimed_kinds = {kind for kind, _ in self._touched}

        stale = [
            row
            for identity, row in self._by_identity.items()
            if identity[0] in claimed_kinds and identity not in self._touched
        ]
        for row in stale:
            self._by_identity.pop((row.kind, row.bundle_key), None)
        if stale:
            await db_session.execute(
                delete(DemoEntity).where(
                    DemoEntity.id.in_([row.id for row in stale if row.id])
                )
            )
        return len(stale)
