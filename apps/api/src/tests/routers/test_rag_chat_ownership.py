"""Behavioral tests for src/routers/ai/rag.py chat-session ownership (lines 227-230).

When `aichat_uuid` is supplied and `chat_session_belongs_to_user` returns False,
api_rag_chat raises 404. When it returns True the handler proceeds to build the
streaming response.

DB + external services are mocked; the handler is called directly.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.routers.ai import rag as rag_router
from src.routers.ai.rag import RAGChatRequest


def _result(value):
    scalars = MagicMock()
    scalars.first.return_value = value
    res = MagicMock()
    res.scalars.return_value = scalars
    return res


def _db_with_course(course, org_config=None):
    """db.execute returns the course first, then org_config (for copilot check)."""
    db = AsyncMock()
    db.execute.side_effect = [_result(course), _result(org_config)]
    return db


class TestRagChatOwnership:
    def _req(self, aichat_uuid):
        return RAGChatRequest(
            message="hello",
            course_uuid="course_1",
            aichat_uuid=aichat_uuid,
            mode="course_only",
        )

    async def test_foreign_chat_session_raises_404(self):
        course = SimpleNamespace(id=1, org_id=10)
        db = _db_with_course(course, org_config=None)
        current_user = MagicMock()

        with patch.object(
            rag_router, "resolve_acting_user_id", return_value=1
        ), patch.object(
            rag_router, "is_org_member", new_callable=AsyncMock, return_value=True
        ), patch(
            "src.services.security.rate_limiting.enforce_ai_rate_limit"
        ), patch.object(
            rag_router, "reserve_ai_credit", new_callable=AsyncMock
        ), patch.object(
            rag_router, "chat_session_belongs_to_user", return_value=False
        ) as belongs:
            with pytest.raises(HTTPException) as exc:
                await rag_router.api_rag_chat(
                    MagicMock(), self._req("chat_foreign"), current_user, db
                )

        assert exc.value.status_code == 404
        belongs.assert_called_once_with("chat_foreign", 1)

    async def test_owned_chat_session_proceeds(self):
        course = SimpleNamespace(id=1, org_id=10)
        db = _db_with_course(course, org_config=None)
        current_user = MagicMock()

        async def fake_stream():
            yield "answer"

        with patch.object(
            rag_router, "resolve_acting_user_id", return_value=1
        ), patch.object(
            rag_router, "is_org_member", new_callable=AsyncMock, return_value=True
        ), patch(
            "src.services.security.rate_limiting.enforce_ai_rate_limit"
        ), patch.object(
            rag_router, "reserve_ai_credit", new_callable=AsyncMock
        ), patch.object(
            rag_router, "chat_session_belongs_to_user", return_value=True
        ) as belongs, patch.object(
            rag_router,
            "get_chat_session_history",
            return_value={"aichat_uuid": "chat_owned", "message_history": []},
        ), patch.object(
            rag_router,
            "query_course_rag_stream",
            new_callable=AsyncMock,
            return_value=(fake_stream(), []),
        ):
            resp = await rag_router.api_rag_chat(
                MagicMock(), self._req("chat_owned"), current_user, db
            )

        assert resp.media_type == "text/event-stream"
        belongs.assert_called_once_with("chat_owned", 1)

    async def test_new_session_skips_ownership_check(self):
        """aichat_uuid None -> is_new_session True -> ownership check skipped."""
        course = SimpleNamespace(id=1, org_id=10)
        db = _db_with_course(course, org_config=None)
        current_user = MagicMock()

        async def fake_stream():
            yield "answer"

        with patch.object(
            rag_router, "resolve_acting_user_id", return_value=1
        ), patch.object(
            rag_router, "is_org_member", new_callable=AsyncMock, return_value=True
        ), patch(
            "src.services.security.rate_limiting.enforce_ai_rate_limit"
        ), patch.object(
            rag_router, "reserve_ai_credit", new_callable=AsyncMock
        ), patch.object(
            rag_router, "chat_session_belongs_to_user", return_value=False
        ) as belongs, patch.object(
            rag_router,
            "get_chat_session_history",
            return_value={"aichat_uuid": "new_chat", "message_history": []},
        ), patch.object(
            rag_router,
            "query_course_rag_stream",
            new_callable=AsyncMock,
            return_value=(fake_stream(), []),
        ):
            resp = await rag_router.api_rag_chat(
                MagicMock(), self._req(None), current_user, db
            )

        assert resp.media_type == "text/event-stream"
        belongs.assert_not_called()
