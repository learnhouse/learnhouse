"""Router tests for src/routers/boards/*.py."""

import json
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.boards import Board, BoardMemberRead, BoardRead
from src.routers.boards.boards import internal_router, router as boards_router
from src.routers.boards.boards_playground import router as boards_playground_router
from src.routers.boards.boards_playground import (
    event_generator as boards_event_generator,
    get_org_ai_model as get_boards_org_ai_model,
)
from src.security.auth import get_authenticated_user, get_current_user
from src.security.features_utils.dependencies import require_boards_feature


async def _single_chunk_stream():
    yield "chunk"


async def _failing_stream():
    yield "chunk"
    raise RuntimeError("boom")


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(boards_router, prefix="/api/v1/boards")
    app.include_router(internal_router, prefix="/api/v1/internal/boards")
    app.include_router(boards_playground_router, prefix="/api/v1/boards")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    app.dependency_overrides[get_authenticated_user] = lambda: admin_user
    app.dependency_overrides[require_boards_feature] = lambda: True
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _mock_board(**overrides) -> BoardRead:
    data = {
        "id": 1,
        "org_id": 1,
        "name": "Board",
        "description": "Desc",
        "thumbnail_image": "",
        "public": True,
        "board_uuid": "board_test",
        "created_by": 1,
        "creation_date": "2024-01-01",
        "update_date": "2024-01-01",
        "member_count": 1,
    }
    data.update(overrides)
    return BoardRead(**data)


def _mock_member(**overrides) -> BoardMemberRead:
    data = {
        "id": 1,
        "board_id": 1,
        "user_id": 1,
        "role": "editor",
        "creation_date": "2024-01-01",
        "username": "user",
    }
    data.update(overrides)
    return BoardMemberRead(**data)


class TestBoardsRouter:
    @pytest.fixture(autouse=True)
    def _bypass_ai_rate_limit(self):
        with patch("src.services.security.rate_limiting.enforce_ai_rate_limit"):
            yield

    async def test_boards_playground_helpers_and_error_paths(
        self, client, db, org, other_org, admin_user
    ):
        board = Board(
            id=2,
            org_id=org.id,
            name="Board",
            description="Desc",
            thumbnail_image="",
            public=True,
            board_uuid="board_test",
            created_by=admin_user.id,
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(board)
        db.commit()

        orphan_board = Board(
            id=3,
            org_id=999,
            name="Orphan",
            description="Desc",
            thumbnail_image="",
            public=True,
            board_uuid="board_orphan",
            created_by=admin_user.id,
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(orphan_board)
        db.commit()

        events = []
        async for item in boards_event_generator(_failing_stream(), "session-error"):
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
            "src.routers.boards.boards_playground.get_org_plan",
            return_value="pro",
        ), patch(
            "src.routers.boards.boards_playground.plan_meets_requirement",
            return_value=True,
        ):
            assert get_boards_org_ai_model(org.id, db) == "gemini-3-flash-preview"

        with patch(
            "src.routers.boards.boards_playground.get_org_plan",
            side_effect=RuntimeError("boom"),
        ):
            assert get_boards_org_ai_model(org.id, db) == "gemini-2.5-flash-lite"

        with patch(
            "src.routers.boards.boards_playground.get_org_plan",
            return_value="basic",
        ), patch(
            "src.routers.boards.boards_playground.plan_meets_requirement",
            return_value=False,
        ):
            assert get_boards_org_ai_model(org.id, db) == "gemini-2.5-flash-lite"

        with patch("src.routers.boards.boards_playground.reserve_ai_credit"), patch(
            "src.routers.boards.boards_playground.get_org_ai_model",
            return_value="gemini-test",
        ), patch(
            "src.routers.boards.boards_playground.create_boards_playground_session",
            return_value=SimpleNamespace(
                session_uuid="session1",
                iteration_count=0,
                max_iterations=3,
                current_html="<div></div>",
                message_history=[],
            ),
        ), patch(
            "src.routers.boards.boards_playground.generate_boards_playground_stream",
            return_value=_single_chunk_stream(),
        ):
            response = await client.post(
                "/api/v1/boards/playground/start",
                json={
                    "board_uuid": "missing",
                    "block_uuid": "block1",
                    "prompt": "Prompt",
                    "context": {
                        "board_name": "Board",
                        "board_description": "Desc",
                    },
                },
            )
        assert response.status_code == 404

        with patch("src.routers.boards.boards_playground.reserve_ai_credit"), patch(
            "src.routers.boards.boards_playground.get_org_ai_model",
            return_value="gemini-test",
        ), patch(
            "src.routers.boards.boards_playground.create_boards_playground_session",
            return_value=SimpleNamespace(
                session_uuid="session1",
                iteration_count=0,
                max_iterations=3,
                current_html="<div></div>",
                message_history=[],
            ),
        ), patch(
            "src.routers.boards.boards_playground.generate_boards_playground_stream",
            return_value=_single_chunk_stream(),
        ):
            response = await client.post(
                "/api/v1/boards/playground/start",
                json={
                    "board_uuid": "board_orphan",
                    "block_uuid": "block1",
                    "prompt": "Prompt",
                    "context": {
                        "board_name": "Board",
                        "board_description": "Desc",
                    },
                },
            )
        assert response.status_code == 404

        with patch("src.routers.boards.boards_playground.reserve_ai_credit"), patch(
            "src.routers.boards.boards_playground.get_org_ai_model",
            return_value="gemini-test",
        ), patch(
            "src.routers.boards.boards_playground.create_boards_playground_session",
            return_value=SimpleNamespace(
                session_uuid="session1",
                iteration_count=0,
                max_iterations=3,
                current_html="<div></div>",
                message_history=[],
            ),
        ), patch(
            "src.routers.boards.boards_playground.generate_boards_playground_stream",
            return_value=_single_chunk_stream(),
        ):
            response = await client.post(
                "/api/v1/boards/playground/start",
                json={
                    "board_uuid": "board_test",
                    "block_uuid": "block1",
                    "prompt": "Prompt",
                    "context": {
                        "board_name": "Board",
                        "board_description": "Desc",
                    },
                },
            )
        assert response.status_code == 200

        with patch(
            "src.routers.boards.boards_playground.get_boards_playground_session",
            return_value=None,
        ):
            response = await client.post(
                "/api/v1/boards/playground/iterate",
                json={
                    "session_uuid": "missing",
                    "board_uuid": "board_test",
                    "block_uuid": "block1",
                    "message": "More",
                },
            )
        assert response.status_code == 404

        with patch(
            "src.routers.boards.boards_playground.get_boards_playground_session",
            return_value=SimpleNamespace(
                session_uuid="session1",
                iteration_count=3,
                max_iterations=3,
                current_html="<div></div>",
                board_uuid="board_test",
                block_uuid="block1",
                message_history=[],
            ),
        ):
            response = await client.post(
                "/api/v1/boards/playground/iterate",
                json={
                    "session_uuid": "session1",
                    "board_uuid": "board_test",
                    "block_uuid": "block1",
                    "message": "More",
                },
            )
        assert response.status_code == 400

        with patch(
            "src.routers.boards.boards_playground.get_boards_playground_session",
            return_value=SimpleNamespace(
                session_uuid="session1",
                iteration_count=0,
                max_iterations=3,
                current_html="<div></div>",
                board_uuid="different",
                block_uuid="block1",
                message_history=[],
            ),
        ):
            response = await client.post(
                "/api/v1/boards/playground/iterate",
                json={
                    "session_uuid": "session1",
                    "board_uuid": "board_test",
                    "block_uuid": "block1",
                    "message": "More",
                },
            )
        assert response.status_code == 400

        with patch(
            "src.routers.boards.boards_playground.get_boards_playground_session",
            return_value=SimpleNamespace(
                session_uuid="session1",
                iteration_count=0,
                max_iterations=3,
                current_html="<div></div>",
                board_uuid="board_missing",
                block_uuid="block1",
                message_history=[],
            ),
        ), patch("src.routers.boards.boards_playground.reserve_ai_credit"), patch(
            "src.routers.boards.boards_playground.get_org_ai_model",
            return_value="gemini-test",
        ):
            response = await client.post(
                "/api/v1/boards/playground/iterate",
                json={
                    "session_uuid": "session1",
                    "board_uuid": "board_missing",
                    "block_uuid": "block1",
                    "message": "More",
                },
            )
        assert response.status_code == 404

        missing_org_board = Board(
            id=4,
            org_id=999,
            name="MissingOrg",
            description="Desc",
            thumbnail_image="",
            public=True,
            board_uuid="board_missing_org",
            created_by=admin_user.id,
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(missing_org_board)
        db.commit()

        with patch(
            "src.routers.boards.boards_playground.get_boards_playground_session",
            return_value=SimpleNamespace(
                session_uuid="session1",
                iteration_count=0,
                max_iterations=3,
                current_html="<div></div>",
                board_uuid="board_missing_org",
                block_uuid="block1",
                message_history=[],
            ),
        ), patch("src.routers.boards.boards_playground.reserve_ai_credit"), patch(
            "src.routers.boards.boards_playground.get_org_ai_model",
            return_value="gemini-test",
        ):
            response = await client.post(
                "/api/v1/boards/playground/iterate",
                json={
                    "session_uuid": "session1",
                    "board_uuid": "board_missing_org",
                    "block_uuid": "block1",
                    "message": "More",
                },
            )
        assert response.status_code == 404

        with patch(
            "src.routers.boards.boards_playground.get_boards_playground_session",
            return_value=SimpleNamespace(
                session_uuid="session1",
                iteration_count=0,
                max_iterations=3,
                current_html="<div></div>",
                board_uuid="board_test",
                block_uuid="different",
                message_history=[],
            ),
        ):
            response = await client.post(
                "/api/v1/boards/playground/iterate",
                json={
                    "session_uuid": "session1",
                    "board_uuid": "board_test",
                    "block_uuid": "block1",
                    "message": "More",
                },
            )
        assert response.status_code == 400

        with patch(
            "src.routers.boards.boards_playground.get_boards_playground_session",
            return_value=SimpleNamespace(
                session_uuid="session1",
                iteration_count=0,
                max_iterations=3,
                current_html="<div></div>",
                board_uuid="board_test",
                block_uuid="block1",
                message_history=[],
            ),
        ), patch(
            "src.routers.boards.boards_playground.reserve_ai_credit"
        ), patch(
            "src.routers.boards.boards_playground.get_org_ai_model",
            return_value="gemini-test",
        ), patch(
            "src.routers.boards.boards_playground.generate_boards_playground_stream",
            return_value=_single_chunk_stream(),
        ):
            response = await client.post(
                "/api/v1/boards/playground/iterate",
                json={
                    "session_uuid": "session1",
                    "board_uuid": "board_test",
                    "block_uuid": "block1",
                    "message": "More",
                },
            )
        assert response.status_code == 200

        with patch(
            "src.routers.boards.boards_playground.get_boards_playground_session",
            return_value=None,
        ):
            response = await client.get("/api/v1/boards/playground/session/missing")
        assert response.status_code == 404

    async def test_board_crud_and_membership_endpoints(self, client):
        with patch(
            "src.routers.boards.boards.create_board",
            new_callable=AsyncMock,
            return_value=_mock_board(),
        ):
            response = await client.post("/api/v1/boards/?org_id=1", json={"name": "Board"})
        assert response.status_code == 200

        with patch(
            "src.routers.boards.boards.get_boards_by_org",
            new_callable=AsyncMock,
            return_value=[_mock_board()],
        ):
            response = await client.get("/api/v1/boards/org/1")
        assert response.status_code == 200

        with patch(
            "src.routers.boards.boards.get_board",
            new_callable=AsyncMock,
            return_value=_mock_board(),
        ):
            response = await client.get("/api/v1/boards/board_test")
        assert response.status_code == 200

        with patch(
            "src.routers.boards.boards.update_board",
            new_callable=AsyncMock,
            return_value=_mock_board(name="Updated"),
        ):
            response = await client.put("/api/v1/boards/board_test", json={"name": "Updated"})
        assert response.status_code == 200

        with patch(
            "src.routers.boards.boards.duplicate_board",
            new_callable=AsyncMock,
            return_value=_mock_board(board_uuid="board_copy"),
        ):
            response = await client.post("/api/v1/boards/board_test/duplicate")
        assert response.status_code == 200

        with patch(
            "src.routers.boards.boards.delete_board",
            new_callable=AsyncMock,
            return_value={"deleted": True},
        ):
            response = await client.delete("/api/v1/boards/board_test")
        assert response.status_code == 200

        with patch(
            "src.routers.boards.boards.get_board_members",
            new_callable=AsyncMock,
            return_value=[_mock_member()],
        ):
            response = await client.get("/api/v1/boards/board_test/members")
        assert response.status_code == 200

        with patch(
            "src.routers.boards.boards.update_board_thumbnail",
            new_callable=AsyncMock,
            return_value=_mock_board(thumbnail_image="thumb.png"),
        ):
            response = await client.post(
                "/api/v1/boards/board_test/thumbnail",
                files={"thumbnail": ("t.png", b"img", "image/png")},
            )
        assert response.status_code == 200

        with patch(
            "src.routers.boards.boards.add_board_member",
            new_callable=AsyncMock,
            return_value=_mock_member(user_id=2),
        ):
            response = await client.post(
                "/api/v1/boards/board_test/members",
                json={"user_id": 2, "role": "editor"},
            )
        assert response.status_code == 200

        with patch(
            "src.routers.boards.boards.add_board_members_batch",
            new_callable=AsyncMock,
            return_value=[_mock_member(user_id=2)],
        ):
            response = await client.post(
                "/api/v1/boards/board_test/members/batch",
                json={"members": [{"user_id": 2, "role": "editor"}]},
            )
        assert response.status_code == 200

        with patch(
            "src.routers.boards.boards.remove_board_member",
            new_callable=AsyncMock,
            return_value={"removed": True},
        ):
            response = await client.delete("/api/v1/boards/board_test/members/2")
        assert response.status_code == 200

        with patch(
            "src.routers.boards.boards.check_board_membership",
            new_callable=AsyncMock,
            return_value=_mock_member(),
        ):
            response = await client.get("/api/v1/boards/board_test/membership")
        assert response.status_code == 200

    async def test_internal_ydoc_endpoints(self, client):
        old = os.environ.get("COLLAB_INTERNAL_KEY")
        os.environ["COLLAB_INTERNAL_KEY"] = "collab-secret"
        try:
            with patch(
                "src.routers.boards.boards.get_ydoc_state",
                new_callable=AsyncMock,
                return_value=b"state",
            ):
                response = await client.get(
                    "/api/v1/internal/boards/board_test/ydoc",
                    headers={"x-internal-key": "collab-secret"},
                )
            assert response.status_code == 200
            assert response.content == b"state"

            with patch(
                "src.routers.boards.boards.get_ydoc_state",
                new_callable=AsyncMock,
                return_value=None,
            ):
                response = await client.get(
                    "/api/v1/internal/boards/board_test/ydoc",
                    headers={"x-internal-key": "collab-secret"},
                )
            assert response.status_code == 200
            assert response.content == b""

            with patch(
                "src.routers.boards.boards.store_ydoc_state",
                new_callable=AsyncMock,
                return_value={"stored": True},
            ):
                response = await client.put(
                    "/api/v1/internal/boards/board_test/ydoc",
                    headers={"x-internal-key": "collab-secret"},
                    content=b"state",
                )
            assert response.status_code == 200
        finally:
            if old is None:
                os.environ.pop("COLLAB_INTERNAL_KEY", None)
            else:
                os.environ["COLLAB_INTERNAL_KEY"] = old

    async def test_internal_ydoc_rejects_invalid_key(self, client):
        old = os.environ.get("COLLAB_INTERNAL_KEY")
        os.environ["COLLAB_INTERNAL_KEY"] = "collab-secret"
        try:
            response = await client.get(
                "/api/v1/internal/boards/board_test/ydoc",
                headers={"x-internal-key": "wrong-key"},
            )
        finally:
            if old is None:
                os.environ.pop("COLLAB_INTERNAL_KEY", None)
            else:
                os.environ["COLLAB_INTERNAL_KEY"] = old

        assert response.status_code == 403

    async def test_boards_playground_endpoints(self, client, db, org, admin_user):
        board = Board(
            id=1,
            org_id=org.id,
            name="Board",
            description="Desc",
            thumbnail_image="",
            public=True,
            board_uuid="board_test",
            created_by=admin_user.id,
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(board)
        db.commit()

        fake_session = SimpleNamespace(
            session_uuid="session1",
            iteration_count=0,
            max_iterations=3,
            current_html="<div></div>",
            message_history=[],
        )

        with patch("src.routers.boards.boards_playground.reserve_ai_credit"), patch(
            "src.routers.boards.boards_playground.get_org_ai_model",
            return_value="gemini-test",
        ), patch(
            "src.routers.boards.boards_playground.create_boards_playground_session",
            return_value=fake_session,
        ), patch(
            "src.routers.boards.boards_playground.generate_boards_playground_stream",
            return_value=_single_chunk_stream(),
        ):
            response = await client.post(
                "/api/v1/boards/playground/start",
                json={
                    "board_uuid": "board_test",
                    "block_uuid": "block1",
                    "prompt": "Prompt",
                    "context": {
                        "board_name": "Board",
                        "board_description": "Desc",
                    },
                },
            )
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

        fake_iter_session = SimpleNamespace(
            session_uuid="session1",
            iteration_count=0,
            max_iterations=3,
            current_html="<div></div>",
            board_uuid="board_test",
            block_uuid="block1",
            message_history=[],
        )
        with patch(
            "src.routers.boards.boards_playground.get_boards_playground_session",
            return_value=fake_iter_session,
        ), patch("src.routers.boards.boards_playground.reserve_ai_credit"), patch(
            "src.routers.boards.boards_playground.get_org_ai_model",
            return_value="gemini-test",
        ), patch(
            "src.routers.boards.boards_playground.generate_boards_playground_stream",
            return_value=_single_chunk_stream(),
        ):
            response = await client.post(
                "/api/v1/boards/playground/iterate",
                json={
                    "session_uuid": "session1",
                    "board_uuid": "board_test",
                    "block_uuid": "block1",
                    "message": "More",
                },
            )
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]

        response_session = SimpleNamespace(
            session_uuid="session1",
            iteration_count=1,
            max_iterations=3,
            current_html="<div>done</div>",
            message_history=[SimpleNamespace(role="user", content="Prompt")],
        )
        with patch(
            "src.routers.boards.boards_playground.get_boards_playground_session",
            return_value=response_session,
        ):
            response = await client.get("/api/v1/boards/playground/session/session1")
        assert response.status_code == 200
        assert response.json()["session_uuid"] == "session1"

    async def test_boards_playground_iterate_session_not_found(self, client):
        with patch(
            "src.routers.boards.boards_playground.get_boards_playground_session",
            return_value=None,
        ):
            response = await client.post(
                "/api/v1/boards/playground/iterate",
                json={
                    "session_uuid": "missing",
                    "board_uuid": "board_test",
                    "block_uuid": "block1",
                    "message": "More",
                },
            )

        assert response.status_code == 404
