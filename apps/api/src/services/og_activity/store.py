from typing import Optional, Protocol

from src.db.courses.activities import Activity, ActivityRead
from src.services.og_activity.spec import LearnHouseActivitySpec


class ActivityStore(Protocol):
    """Persistence port for the activity adapter. Default impl: ServiceActivityStore (Task 9)."""

    async def find_by_kb_id(self, course_id: int, kb_id: str) -> Optional[Activity]:
        ...

    async def create(
        self, spec: LearnHouseActivitySpec, title: str, chapter_id: int, provenance: dict
    ) -> ActivityRead:
        ...

    async def update(
        self, activity_uuid: str, spec: LearnHouseActivitySpec, title: str, provenance: dict
    ) -> ActivityRead:
        ...
