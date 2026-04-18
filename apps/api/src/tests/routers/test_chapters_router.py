"""Router tests for src/routers/courses/chapters.py."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.courses.activities import ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapters import ChapterRead
from src.routers.courses.chapters import router as chapters_router
from src.security.auth import get_current_user


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(chapters_router, prefix="/api/v1/chapters")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


def _mock_chapter_read(**overrides) -> ChapterRead:
    data = dict(
        id=1,
        name="Test Chapter",
        description="A chapter",
        thumbnail_image="",
        org_id=1,
        course_id=1,
        chapter_uuid="chapter_test",
        creation_date="2024-01-01",
        update_date="2024-01-01",
        activities=[
            {
                "id": 1,
                "org_id": 1,
                "course_id": 1,
                "name": "Activity",
                "activity_type": ActivityTypeEnum.TYPE_DYNAMIC,
                "activity_sub_type": ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
                "content": {},
                "details": None,
                "published": True,
                "activity_uuid": "activity_test",
                "creation_date": "2024-01-01",
                "update_date": "2024-01-01",
                "current_version": 1,
                "last_modified_by_id": None,
            }
        ],
    )
    data.update(overrides)
    return ChapterRead(**data)


class TestChaptersRouter:
    async def test_create_chapter(self, client):
        with patch(
            "src.routers.courses.chapters.create_chapter",
            new_callable=AsyncMock,
            return_value=_mock_chapter_read(),
        ):
            response = await client.post(
                "/api/v1/chapters/",
                json={
                    "name": "Test Chapter",
                    "description": "A chapter",
                    "thumbnail_image": "",
                    "org_id": 1,
                    "course_id": 1,
                },
            )

        assert response.status_code == 200
        assert response.json()["chapter_uuid"] == "chapter_test"

    async def test_get_chapter(self, client):
        with patch(
            "src.routers.courses.chapters.get_chapter",
            new_callable=AsyncMock,
            return_value=_mock_chapter_read(),
        ):
            response = await client.get("/api/v1/chapters/1")

        assert response.status_code == 200
        assert response.json()["id"] == 1

    async def test_get_legacy_chapter_meta(self, client):
        with patch(
            "src.routers.courses.chapters.DEPRECEATED_get_course_chapters",
            new_callable=AsyncMock,
            return_value={"chapters": {}, "chapterOrder": [], "activities": {}},
        ):
            response = await client.get("/api/v1/chapters/course/course_test/meta")

        assert response.status_code == 200
        assert response.json()["chapterOrder"] == []

    async def test_update_chapter_order(self, client):
        with patch(
            "src.routers.courses.chapters.reorder_chapters_and_activities",
            new_callable=AsyncMock,
            return_value={"detail": "reordered"},
        ):
            response = await client.put(
                "/api/v1/chapters/course/course_test/order",
                json={
                    "chapter_order_by_ids": [
                        {"chapter_id": 1, "activities_order_by_ids": [{"activity_id": 1}]}
                    ]
                },
            )

        assert response.status_code == 200
        assert response.json()["detail"] == "reordered"

    async def test_get_course_chapters(self, client):
        with patch(
            "src.routers.courses.chapters.get_course_chapters",
            new_callable=AsyncMock,
            return_value=[_mock_chapter_read()],
        ):
            response = await client.get("/api/v1/chapters/course/1/page/1/limit/10")

        assert response.status_code == 200
        assert response.json()[0]["chapter_uuid"] == "chapter_test"

    async def test_update_chapter(self, client):
        with patch(
            "src.routers.courses.chapters.update_chapter",
            new_callable=AsyncMock,
            return_value=_mock_chapter_read(name="Updated Chapter"),
        ):
            response = await client.put(
                "/api/v1/chapters/1",
                json={"name": "Updated Chapter"},
            )

        assert response.status_code == 200
        assert response.json()["name"] == "Updated Chapter"

    async def test_delete_chapter(self, client):
        with patch(
            "src.routers.courses.chapters.delete_chapter",
            new_callable=AsyncMock,
            return_value={"detail": "chapter deleted"},
        ):
            response = await client.delete("/api/v1/chapters/1")

        assert response.status_code == 200
        assert response.json()["detail"] == "chapter deleted"

    async def test_chapter_usergroup_endpoints(self, client):
        with patch(
            "src.routers.courses.chapters.get_chapter_usergroups",
            new_callable=AsyncMock,
            return_value=[{"usergroup_uuid": "ug1"}],
        ):
            list_response = await client.get("/api/v1/chapters/chapter_test/usergroups")

        with patch(
            "src.routers.courses.chapters.add_usergroup_to_chapter",
            new_callable=AsyncMock,
            return_value={"detail": "Usergroup added"},
        ):
            add_response = await client.post(
                "/api/v1/chapters/chapter_test/usergroups/ug1"
            )

        with patch(
            "src.routers.courses.chapters.remove_usergroup_from_chapter",
            new_callable=AsyncMock,
            return_value={"detail": "Usergroup removed"},
        ):
            remove_response = await client.delete(
                "/api/v1/chapters/chapter_test/usergroups/ug1"
            )

        assert list_response.status_code == 200
        assert add_response.status_code == 200
        assert remove_response.status_code == 200
