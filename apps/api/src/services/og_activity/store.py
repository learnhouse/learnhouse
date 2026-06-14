from typing import Optional, Protocol

from fastapi import Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity, ActivityRead, ActivityCreate, ActivityUpdate
from src.db.users import AnonymousUser, PublicUser
from src.services.courses.activities.activities import create_activity, update_activity
from src.services.og_activity.spec import LearnHouseActivitySpec


class ActivityStore(Protocol):
    """Persistence port for the activity adapter. Default impl: ServiceActivityStore (Task 9)."""

    async def find_by_kb_id(
        self, course_id: int, kb_id: str, org_id: Optional[int] = None
    ) -> Optional[Activity]:
        ...

    async def create(
        self, spec: LearnHouseActivitySpec, title: str, chapter_id: int, provenance: dict
    ) -> ActivityRead:
        ...

    async def update(
        self, activity_uuid: str, spec: LearnHouseActivitySpec, title: str, provenance: dict
    ) -> ActivityRead:
        ...


class ServiceActivityStore:
    """Default ActivityStore backed by LearnHouse's activity service layer."""

    def __init__(self, request: Request, current_user: "PublicUser | AnonymousUser", db_session: AsyncSession):
        self._request = request
        self._user = current_user
        self._db = db_session

    async def find_by_kb_id(
        self, course_id: int, kb_id: str, org_id: Optional[int] = None
    ) -> Optional[Activity]:
        # Filter on extra_metadata->>'kb_id' in the database rather than loading
        # every activity in the course and scanning in Python. as_string() is the
        # dialect-portable JSON text accessor (renders ->> on Postgres JSONB and
        # JSON_EXTRACT on SQLite), unlike the Postgres-only .astext.
        statement = select(Activity).where(
            Activity.course_id == course_id,
            Activity.extra_metadata["kb_id"].as_string() == kb_id,
        )
        if org_id is not None:
            statement = statement.where(Activity.org_id == org_id)
        return (await self._db.execute(statement)).scalars().first()

    async def create(self, spec: LearnHouseActivitySpec, title: str, chapter_id: int, provenance: dict) -> ActivityRead:
        activity_object = ActivityCreate(
            name=title,
            activity_type=spec.activity_type,
            activity_sub_type=spec.activity_sub_type,
            content=spec.content,
            details=spec.details or {},
            chapter_id=chapter_id,
            extra_metadata=provenance,
        )
        return await create_activity(self._request, activity_object, self._user, self._db)

    async def update(self, activity_uuid: str, spec: LearnHouseActivitySpec, title: str, provenance: dict) -> ActivityRead:
        # update_activity uses model_dump(exclude_unset=True), so any field set
        # here is persisted. Only pass details when the spec actually carries
        # them, otherwise we'd clobber the row's existing details with None.
        fields: dict = {
            "name": title,
            "content": spec.content,
            "extra_metadata": provenance,
        }
        if spec.details is not None:
            fields["details"] = spec.details
        activity_object = ActivityUpdate(**fields)
        return await update_activity(self._request, activity_object, activity_uuid, self._user, self._db)
