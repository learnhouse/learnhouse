"""Router tests for src/routers/calendar.py (per-user calendar)."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.calendar_events import CalendarEventRead, CalendarEventType
from src.routers.calendar import router as calendar_router
from src.security.auth import get_current_user


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(calendar_router, prefix="/api/v1/calendar")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _mock_event(**overrides) -> CalendarEventRead:
    data = dict(
        id=1,
        event_uuid="calevent_test",
        user_id=1,
        name="Study session",
        description=None,
        start_date="2026-06-30",
        end_date=None,
        event_type=CalendarEventType.REMINDER,
        color=None,
        creation_date="2026-04-28",
        update_date="2026-04-28",
    )
    data.update(overrides)
    return CalendarEventRead(**data)


class TestCreateMyCalendarEvent:
    async def test_create_event(self, client):
        payload = {
            "name": "Study session",
            "start_date": "2026-06-30",
            "event_type": "reminder",
        }
        with patch(
            "src.routers.calendar.create_calendar_event",
            new_callable=AsyncMock,
            return_value=_mock_event(),
        ):
            response = await client.post("/api/v1/calendar/me/events", json=payload)

        assert response.status_code == 200
        body = response.json()
        assert body["event_uuid"] == "calevent_test"
        assert body["event_type"] == "reminder"
        assert body["user_id"] == 1


class TestListMyCalendarEvents:
    async def test_list_events(self, client):
        with patch(
            "src.routers.calendar.list_my_calendar_events",
            new_callable=AsyncMock,
            return_value=[_mock_event()],
        ):
            response = await client.get("/api/v1/calendar/me/events")

        assert response.status_code == 200
        body = response.json()
        assert isinstance(body, list)
        assert len(body) == 1
        assert body[0]["user_id"] == 1

    async def test_list_events_with_filters(self, client):
        with patch(
            "src.routers.calendar.list_my_calendar_events",
            new_callable=AsyncMock,
            return_value=[],
        ) as mock_list:
            response = await client.get(
                "/api/v1/calendar/me/events?from_date=2026-01-01&to_date=2026-12-31&event_type=meeting"
            )

        assert response.status_code == 200
        all_args = list(mock_list.call_args.args) + list(mock_list.call_args.kwargs.values())
        assert "2026-01-01" in all_args
        assert "2026-12-31" in all_args


class TestGetMyCalendarEvent:
    async def test_get_event(self, client):
        with patch(
            "src.routers.calendar.get_calendar_event",
            new_callable=AsyncMock,
            return_value=_mock_event(),
        ):
            response = await client.get("/api/v1/calendar/me/events/calevent_test")

        assert response.status_code == 200
        assert response.json()["event_uuid"] == "calevent_test"

    async def test_get_event_not_found_for_other_user(self, client):
        # Service returns 404 (not 403) when event belongs to another user —
        # don't leak existence across users.
        with patch(
            "src.routers.calendar.get_calendar_event",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=404, detail="Calendar event not found"),
        ):
            response = await client.get("/api/v1/calendar/me/events/someone_elses")

        assert response.status_code == 404


class TestUpdateAndDeleteMyCalendarEvent:
    async def test_update_event(self, client):
        with patch(
            "src.routers.calendar.update_calendar_event",
            new_callable=AsyncMock,
            return_value=_mock_event(name="Updated"),
        ):
            response = await client.put(
                "/api/v1/calendar/me/events/calevent_test",
                json={"name": "Updated"},
            )

        assert response.status_code == 200
        assert response.json()["name"] == "Updated"

    async def test_delete_event(self, client):
        with patch(
            "src.routers.calendar.delete_calendar_event",
            new_callable=AsyncMock,
            return_value={"detail": "Calendar event deleted"},
        ):
            response = await client.delete("/api/v1/calendar/me/events/calevent_test")

        assert response.status_code == 200
        assert response.json()["detail"] == "Calendar event deleted"
