"""Router tests for src/routers/playgrounds/*.py."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.playground_reactions import PlaygroundReactionSummary, ReactionUser
from src.db.playgrounds import Playground, PlaygroundRead
from src.routers.playgrounds.playgrounds import router as playgrounds_router
from src.routers.playgrounds.playgrounds_generator import router as playgrounds_generator_router
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_playgrounds_feature


async def _single_chunk_stream():
    yield "chunk"


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(playgrounds_router, prefix="/api/v1/playgrounds")
    app.include_router(playgrounds_generator_router, prefix="/api/v1/playgrounds")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    app.dependency_overrides[require_playgrounds_feature] = lambda: True
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _mock_playground(**overrides) -> PlaygroundRead:
    data = {
        "id": 1,
        "org_id": 1,
        "org_uuid": "org_test",
        "org_slug": "test-org",
        "name": "Playground",
        "description": "Desc",
        "thumbnail_image": "",
        "access_type": "authenticated",
        "published": False,
        "course_uuid": None,
        "html_content": "<div></div>",
        "playground_uuid": "playground_test",
        "course_id": None,
        "created_by": 1,
        "author_username": "admin",
        "author_first_name": "Admin",
        "author_last_name": "User",
        "author_user_uuid": "user_admin",
        "author_avatar_image": "",
        "creation_date": "2024-01-01",
        "update_date": "2024-01-01",
    }
    data.update(overrides)
    return PlaygroundRead(**data)


def _mock_reaction_summary() -> PlaygroundReactionSummary:
    return PlaygroundReactionSummary(
        emoji="👍",
        count=1,
        users=[
            ReactionUser(
                id=1,
                user_uuid="user_admin",
                username="admin",
                first_name="Admin",
                last_name="User",
                avatar_image="",
            )
        ],
        has_reacted=True,
    )


class TestPlaygroundsRouter:
    async def test_playground_crud_and_reaction_endpoints(self, client):
        with patch(
            "src.routers.playgrounds.playgrounds.create_playground",
            new_callable=AsyncMock,
            return_value=_mock_playground(),
        ):
            response = await client.post(
                "/api/v1/playgrounds/?org_id=1",
                json={"name": "Playground", "description": "Desc"},
            )
        assert response.status_code == 200

        with patch(
            "src.routers.playgrounds.playgrounds.list_org_playgrounds",
            new_callable=AsyncMock,
            return_value=[_mock_playground()],
        ):
            response = await client.get("/api/v1/playgrounds/org/1")
        assert response.status_code == 200

        with patch(
            "src.routers.playgrounds.playgrounds.get_playground",
            new_callable=AsyncMock,
            return_value=_mock_playground(),
        ):
            response = await client.get("/api/v1/playgrounds/playground_test")
        assert response.status_code == 200

        with patch(
            "src.routers.playgrounds.playgrounds.update_playground",
            new_callable=AsyncMock,
            return_value=_mock_playground(name="Updated"),
        ):
            response = await client.put(
                "/api/v1/playgrounds/playground_test",
                json={"name": "Updated"},
            )
        assert response.status_code == 200

        with patch(
            "src.routers.playgrounds.playgrounds.delete_playground",
            new_callable=AsyncMock,
            return_value={"deleted": True},
        ):
            response = await client.delete("/api/v1/playgrounds/playground_test")
        assert response.status_code == 200

        with patch(
            "src.routers.playgrounds.playgrounds.duplicate_playground",
            new_callable=AsyncMock,
            return_value=_mock_playground(playground_uuid="playground_copy"),
        ):
            response = await client.post("/api/v1/playgrounds/playground_test/duplicate")
        assert response.status_code == 200

        with patch(
            "src.routers.playgrounds.playgrounds.update_playground_thumbnail",
            new_callable=AsyncMock,
            return_value=_mock_playground(thumbnail_image="thumb.png"),
        ):
            response = await client.post(
                "/api/v1/playgrounds/playground_test/thumbnail",
                files={"thumbnail": ("t.png", b"img", "image/png")},
            )
        assert response.status_code == 200

        with patch(
            "src.routers.playgrounds.playgrounds.add_usergroup_to_playground",
            new_callable=AsyncMock,
            return_value={"ok": True},
        ):
            response = await client.post(
                "/api/v1/playgrounds/playground_test/usergroups/usergroup_test"
            )
        assert response.status_code == 200

        with patch(
            "src.routers.playgrounds.playgrounds.remove_usergroup_from_playground",
            new_callable=AsyncMock,
            return_value={"ok": True},
        ):
            response = await client.delete(
                "/api/v1/playgrounds/playground_test/usergroups/usergroup_test"
            )
        assert response.status_code == 200

        with patch(
            "src.routers.playgrounds.playgrounds.get_playground_usergroups",
            new_callable=AsyncMock,
            return_value=[{"usergroup_uuid": "usergroup_test"}],
        ):
            response = await client.get("/api/v1/playgrounds/playground_test/usergroups")
        assert response.status_code == 200

        with patch(
            "src.routers.playgrounds.playgrounds.get_playground_reactions",
            new_callable=AsyncMock,
            return_value=[_mock_reaction_summary()],
        ):
            response = await client.get("/api/v1/playgrounds/playground_test/reactions")
        assert response.status_code == 200

        with patch(
            "src.routers.playgrounds.playgrounds.toggle_playground_reaction",
            new_callable=AsyncMock,
            return_value={"emoji": "👍", "has_reacted": True},
        ):
            response = await client.post(
                "/api/v1/playgrounds/playground_test/reactions",
                json={"emoji": "👍"},
            )
        assert response.status_code == 200

    async def test_playground_generator_endpoints(self, client, db, org, admin_user):
        playground = Playground(
            id=1,
            org_id=org.id,
            name="Playground",
            description="Desc",
            thumbnail_image="",
            access_type="authenticated",
            published=False,
            course_uuid=None,
            html_content="<div>seed</div>",
            playground_uuid="playground_test",
            course_id=None,
            created_by=admin_user.id,
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(playground)
        db.commit()

        fake_session = SimpleNamespace(
            session_uuid="session1",
            iteration_count=0,
            max_iterations=3,
            current_html="<div></div>",
            context=SimpleNamespace(course_uuid=None),
            message_history=[],
        )

        with patch("src.routers.playgrounds.playgrounds_generator.check_ai_credits"), patch(
            "src.routers.playgrounds.playgrounds_generator.deduct_ai_credit"
        ), patch(
            "src.routers.playgrounds.playgrounds_generator.get_org_ai_model",
            return_value="gemini-test",
        ), patch(
            "src.services.playgrounds.playgrounds._get_user_rights",
            return_value={"playgrounds": {"action_update": True}},
        ), patch(
            "src.routers.playgrounds.playgrounds_generator._get_course_context",
            return_value=(None, None),
        ), patch(
            "src.routers.playgrounds.playgrounds_generator.create_playground_session",
            return_value=fake_session,
        ), patch(
            "src.routers.playgrounds.playgrounds_generator.generate_playground_stream",
            return_value=_single_chunk_stream(),
        ):
            response = await client.post(
                "/api/v1/playgrounds/generate/start",
                json={
                    "playground_uuid": "playground_test",
                    "prompt": "Build it",
                    "context": {
                        "playground_name": "Playground",
                        "playground_description": "Desc",
                    },
                },
            )
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

        iterate_session = SimpleNamespace(
            session_uuid="session1",
            iteration_count=0,
            max_iterations=3,
            current_html="<div></div>",
            playground_uuid="playground_test",
            context=SimpleNamespace(course_uuid=None),
            message_history=[],
        )
        with patch(
            "src.routers.playgrounds.playgrounds_generator.get_playground_session",
            return_value=iterate_session,
        ), patch("src.routers.playgrounds.playgrounds_generator.check_ai_credits"), patch(
            "src.routers.playgrounds.playgrounds_generator.deduct_ai_credit"
        ), patch(
            "src.routers.playgrounds.playgrounds_generator.get_org_ai_model",
            return_value="gemini-test",
        ), patch(
            "src.services.playgrounds.playgrounds._get_user_rights",
            return_value={"playgrounds": {"action_update": True}},
        ), patch(
            "src.routers.playgrounds.playgrounds_generator._get_course_context",
            return_value=(None, None),
        ), patch(
            "src.routers.playgrounds.playgrounds_generator.generate_playground_stream",
            return_value=_single_chunk_stream(),
        ):
            response = await client.post(
                "/api/v1/playgrounds/generate/iterate",
                json={
                    "session_uuid": "session1",
                    "playground_uuid": "playground_test",
                    "message": "Refine it",
                },
            )
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

        response_session = SimpleNamespace(
            session_uuid="session1",
            iteration_count=1,
            max_iterations=3,
            current_html="<div>done</div>",
            message_history=[SimpleNamespace(role="user", content="Build it")],
        )
        with patch(
            "src.routers.playgrounds.playgrounds_generator.get_playground_session",
            return_value=response_session,
        ):
            response = await client.get("/api/v1/playgrounds/generate/session/session1")
        assert response.status_code == 200
        assert response.json()["session_uuid"] == "session1"

    async def test_playground_generator_rejects_missing_session(self, client):
        with patch(
            "src.routers.playgrounds.playgrounds_generator.get_playground_session",
            return_value=None,
        ):
            response = await client.post(
                "/api/v1/playgrounds/generate/iterate",
                json={
                    "session_uuid": "missing",
                    "playground_uuid": "playground_test",
                    "message": "Refine it",
                },
            )

        assert response.status_code == 404
