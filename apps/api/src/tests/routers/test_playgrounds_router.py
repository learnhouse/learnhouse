"""Router tests for src/routers/playgrounds/*.py."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.playground_reactions import PlaygroundReactionSummary, ReactionUser
from src.db.playgrounds import Playground, PlaygroundRead
from src.routers.playgrounds.playgrounds import router as playgrounds_router
from src.routers.playgrounds.playgrounds_generator import router as playgrounds_generator_router
from src.routers.playgrounds.playgrounds_generator import (
    _get_course_context,
    event_generator as playground_event_generator,
    get_org_ai_model as get_playground_org_ai_model,
)
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_playgrounds_feature


async def _single_chunk_stream():
    yield "chunk"


async def _failing_stream():
    yield "chunk"
    raise RuntimeError("boom")


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
    @pytest.mark.asyncio
    async def test_playground_generator_helpers_and_error_paths(
        self, client, db, org, other_org, admin_user
    ):
        board = Playground(
            id=2,
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
        db.add(board)
        db.commit()

        orphan_playground = Playground(
            id=3,
            org_id=999,
            name="Orphan",
            description="Desc",
            thumbnail_image="",
            access_type="authenticated",
            published=False,
            course_uuid=None,
            html_content="",
            playground_uuid="playground_orphan",
            course_id=None,
            created_by=admin_user.id,
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(orphan_playground)
        db.commit()

        events = []
        async for item in playground_event_generator(_failing_stream(), "session-error"):
            events.append(item)
        assert json.loads(events[0].removeprefix("data: ").strip()) == {
            "type": "chunk",
            "content": "chunk",
        }
        assert json.loads(events[-1].removeprefix("data: ").strip()) == {
            "type": "error",
            "message": "An internal error occurred.",
        }

        with patch(
            "src.routers.playgrounds.playgrounds_generator.get_org_plan",
            return_value="pro",
        ), patch(
            "src.routers.playgrounds.playgrounds_generator.plan_meets_requirement",
            return_value=True,
        ):
            assert get_playground_org_ai_model(org.id, db) == "gemini-3-flash-preview"

        with patch(
            "src.routers.playgrounds.playgrounds_generator.get_org_plan",
            side_effect=RuntimeError("boom"),
        ):
            assert get_playground_org_ai_model(org.id, db) == "gemini-2.5-flash-lite"

        with patch(
            "src.routers.playgrounds.playgrounds_generator.get_org_plan",
            return_value="basic",
        ), patch(
            "src.routers.playgrounds.playgrounds_generator.plan_meets_requirement",
            return_value=False,
        ):
            assert get_playground_org_ai_model(org.id, db) == "gemini-2.5-flash-lite"

        course = Course(
            id=10,
            name="Course",
            description="Desc",
            public=True,
            published=True,
            open_to_contributors=False,
            org_id=org.id,
            course_uuid="course_test",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(course)
        db.commit()

        assert await _get_course_context(None, org.id, db, "Prompt") == (None, None)
        assert await _get_course_context("missing-course", org.id, db, "Prompt") == (None, None)
        other_org_course = Course(
            id=11,
            name="Other",
            description="Desc",
            public=True,
            published=True,
            open_to_contributors=False,
            org_id=other_org.id,
            course_uuid="course_other",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(other_org_course)
        db.commit()
        assert await _get_course_context("course_other", org.id, db, "Prompt") == (None, None)

        with patch(
            "src.services.ai.rag.query_service.query_course_rag",
            new_callable=AsyncMock,
            return_value={"context": "rag-context"},
        ):
            assert await _get_course_context("course_test", org.id, db, "Prompt") == (
                "rag-context",
                course.id,
            )

        with patch(
            "src.services.ai.rag.query_service.query_course_rag",
            new_callable=AsyncMock,
            side_effect=RuntimeError("rag boom"),
        ):
            assert await _get_course_context("course_test", org.id, db, "Prompt") == (
                None,
                course.id,
            )

        with patch(
            "src.routers.playgrounds.playgrounds_generator.get_playground_session",
            return_value=None,
        ):
            response = await client.get("/api/v1/playgrounds/generate/session/missing")
        assert response.status_code == 404

        with patch(
            "src.routers.playgrounds.playgrounds_generator.check_ai_credits"
        ), patch(
            "src.routers.playgrounds.playgrounds_generator.deduct_ai_credit"
        ), patch(
            "src.routers.playgrounds.playgrounds_generator.get_org_ai_model",
            return_value="gemini-test",
        ), patch(
            "src.services.playgrounds.playgrounds._get_user_rights",
            return_value={"playgrounds": {"action_update": False, "action_update_own": False}},
        ):
            response = await client.post(
                "/api/v1/playgrounds/generate/start",
                json={
                    "playground_uuid": "missing",
                    "prompt": "Build it",
                    "context": {
                        "playground_name": "Playground",
                        "playground_description": "Desc",
                    },
                },
            )
        assert response.status_code == 404

        with patch(
            "src.routers.playgrounds.playgrounds_generator.check_ai_credits"
        ), patch(
            "src.routers.playgrounds.playgrounds_generator.deduct_ai_credit"
        ), patch(
            "src.routers.playgrounds.playgrounds_generator.get_org_ai_model",
            return_value="gemini-test",
        ), patch(
            "src.services.playgrounds.playgrounds._get_user_rights",
            return_value={"playgrounds": {"action_update": False, "action_update_own": False}},
        ):
            response = await client.post(
                "/api/v1/playgrounds/generate/start",
                json={
                    "playground_uuid": "playground_orphan",
                    "prompt": "Build it",
                    "context": {
                        "playground_name": "Playground",
                        "playground_description": "Desc",
                    },
                },
            )
        assert response.status_code == 404

        with patch(
            "src.routers.playgrounds.playgrounds_generator.check_ai_credits"
        ), patch(
            "src.routers.playgrounds.playgrounds_generator.deduct_ai_credit"
        ), patch(
            "src.routers.playgrounds.playgrounds_generator.get_org_ai_model",
            return_value="gemini-test",
        ), patch(
            "src.services.playgrounds.playgrounds._get_user_rights",
            return_value={"playgrounds": {}},
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
        assert response.status_code == 403

        with patch(
            "src.routers.playgrounds.playgrounds_generator.get_playground_session",
            return_value=SimpleNamespace(
                session_uuid="session1",
                iteration_count=3,
                max_iterations=3,
                current_html="<div></div>",
                playground_uuid="playground_test",
                context=SimpleNamespace(course_uuid=None),
                message_history=[],
            ),
        ):
            response = await client.post(
                "/api/v1/playgrounds/generate/iterate",
                json={
                    "session_uuid": "session1",
                    "playground_uuid": "playground_test",
                    "message": "Refine it",
                },
            )
        assert response.status_code == 400

        with patch(
            "src.routers.playgrounds.playgrounds_generator.get_playground_session",
            return_value=SimpleNamespace(
                session_uuid="session1",
                iteration_count=0,
                max_iterations=3,
                current_html="<div></div>",
                playground_uuid="different",
                context=SimpleNamespace(course_uuid=None),
                message_history=[],
            ),
        ):
            response = await client.post(
                "/api/v1/playgrounds/generate/iterate",
                json={
                    "session_uuid": "session1",
                    "playground_uuid": "playground_test",
                    "message": "Refine it",
                },
            )
        assert response.status_code == 400

        with patch(
            "src.routers.playgrounds.playgrounds_generator.get_playground_session",
            return_value=SimpleNamespace(
                session_uuid="session1",
                iteration_count=0,
                max_iterations=3,
                current_html="<div></div>",
                playground_uuid="playground_test",
                context=SimpleNamespace(course_uuid=None),
                message_history=[],
            ),
        ), patch(
            "src.routers.playgrounds.playgrounds_generator.check_ai_credits"
        ), patch(
            "src.routers.playgrounds.playgrounds_generator.deduct_ai_credit"
        ), patch(
            "src.routers.playgrounds.playgrounds_generator.get_org_ai_model",
            return_value="gemini-test",
        ), patch(
            "src.services.playgrounds.playgrounds._get_user_rights",
            return_value={"playgrounds": {"action_update": False, "action_update_own": False}},
        ):
            response = await client.post(
                "/api/v1/playgrounds/generate/iterate",
                json={
                    "session_uuid": "session1",
                    "playground_uuid": "playground_test",
                    "message": "Refine it",
                },
            )
        assert response.status_code == 403

        with patch(
            "src.routers.playgrounds.playgrounds_generator.get_playground_session",
            return_value=SimpleNamespace(
                session_uuid="session1",
                iteration_count=0,
                max_iterations=3,
                current_html="<div></div>",
                playground_uuid="playground_missing",
                context=SimpleNamespace(course_uuid=None),
                message_history=[],
            ),
        ):
            response = await client.post(
                "/api/v1/playgrounds/generate/iterate",
                json={
                    "session_uuid": "session1",
                    "playground_uuid": "playground_missing",
                    "message": "Refine it",
                },
            )
        assert response.status_code == 404

        with patch(
            "src.routers.playgrounds.playgrounds_generator.get_playground_session",
            return_value=SimpleNamespace(
                session_uuid="session1",
                iteration_count=0,
                max_iterations=3,
                current_html="<div></div>",
                playground_uuid="playground_orphan",
                context=SimpleNamespace(course_uuid=None),
                message_history=[],
            ),
        ):
            response = await client.post(
                "/api/v1/playgrounds/generate/iterate",
                json={
                    "session_uuid": "session1",
                    "playground_uuid": "playground_orphan",
                    "message": "Refine it",
                },
            )
        assert response.status_code == 404

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
