"""Behavioral tests for src/services/ai/ai.py streaming refund-on-failure.

Covers the try/except blocks in:
- ai_start_activity_chat_session_stream  (lines 445-458)
- ai_send_activity_chat_message_stream   (lines 494-507)

Both reserve a credit, then build the system prompt inside a try; if anything
inside raises, refund_ai_credit(org.id) is called and the exception re-raises.

We force the failure by making get_chat_session_history raise, and mock
_get_activity_and_course_info / reserve / rate-limit so no real I/O happens.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.ai import ai as ai_service
from src.services.ai.schemas.ai import (
    SendActivityAIChatMessage,
    StartActivityAIChatSession,
)


def _activity_course_org(org_id=10):
    activity = SimpleNamespace(activity_uuid="act_1", name="Lesson")
    course = SimpleNamespace(org_id=org_id, name="Course")
    org = SimpleNamespace(id=org_id)
    return activity, course, org, "gemini-2.5-flash", "friendly text"


class TestStartStreamRefund:
    async def test_refund_on_failure_and_reraise(self):
        chat_obj = StartActivityAIChatSession(activity_uuid="act_1", message="hi")
        current_user = MagicMock()
        db_session = AsyncMock()

        with patch.object(
            ai_service,
            "_get_activity_and_course_info",
            new_callable=AsyncMock,
            return_value=_activity_course_org(org_id=10),
        ), patch.object(
            ai_service, "reserve_ai_credit", new_callable=AsyncMock
        ), patch.object(
            ai_service, "resolve_acting_user_id", return_value=1
        ), patch(
            "src.services.security.rate_limiting.enforce_ai_rate_limit"
        ), patch.object(
            ai_service,
            "get_chat_session_history",
            side_effect=RuntimeError("session store down"),
        ), patch.object(
            ai_service, "refund_ai_credit"
        ) as refund:
            with pytest.raises(RuntimeError, match="session store down"):
                await ai_service.ai_start_activity_chat_session_stream(
                    MagicMock(), chat_obj, current_user, db_session
                )

        refund.assert_called_once_with(10)

    async def test_no_refund_on_success(self):
        chat_obj = StartActivityAIChatSession(activity_uuid="act_1", message="hi")
        with patch.object(
            ai_service,
            "_get_activity_and_course_info",
            new_callable=AsyncMock,
            return_value=_activity_course_org(org_id=10),
        ), patch.object(
            ai_service, "reserve_ai_credit", new_callable=AsyncMock
        ), patch.object(
            ai_service, "resolve_acting_user_id", return_value=1
        ), patch(
            "src.services.security.rate_limiting.enforce_ai_rate_limit"
        ), patch.object(
            ai_service,
            "get_chat_session_history",
            return_value={"aichat_uuid": "c1", "message_history": []},
        ), patch.object(
            ai_service, "refund_ai_credit"
        ) as refund:
            context = await ai_service.ai_start_activity_chat_session_stream(
                MagicMock(), chat_obj, MagicMock(), AsyncMock()
            )

        refund.assert_not_called()
        assert context["chat_session"]["aichat_uuid"] == "c1"
        assert context["user_message"] == "hi"


class TestSendStreamRefund:
    async def test_refund_on_failure_and_reraise(self):
        chat_obj = SendActivityAIChatMessage(
            aichat_uuid="c1", activity_uuid="act_1", message="hi"
        )
        with patch.object(
            ai_service,
            "_get_activity_and_course_info",
            new_callable=AsyncMock,
            return_value=_activity_course_org(org_id=20),
        ), patch.object(
            ai_service, "reserve_ai_credit", new_callable=AsyncMock
        ), patch.object(
            ai_service, "resolve_acting_user_id", return_value=1
        ), patch(
            "src.services.security.rate_limiting.enforce_ai_rate_limit"
        ), patch.object(
            ai_service,
            "get_chat_session_history",
            side_effect=RuntimeError("session store down"),
        ), patch.object(
            ai_service, "refund_ai_credit"
        ) as refund:
            with pytest.raises(RuntimeError, match="session store down"):
                await ai_service.ai_send_activity_chat_message_stream(
                    MagicMock(), chat_obj, MagicMock(), AsyncMock()
                )

        refund.assert_called_once_with(20)

    async def test_no_refund_on_success(self):
        chat_obj = SendActivityAIChatMessage(
            aichat_uuid="c1", activity_uuid="act_1", message="hi"
        )
        with patch.object(
            ai_service,
            "_get_activity_and_course_info",
            new_callable=AsyncMock,
            return_value=_activity_course_org(org_id=20),
        ), patch.object(
            ai_service, "reserve_ai_credit", new_callable=AsyncMock
        ), patch.object(
            ai_service, "resolve_acting_user_id", return_value=1
        ), patch(
            "src.services.security.rate_limiting.enforce_ai_rate_limit"
        ), patch.object(
            ai_service,
            "get_chat_session_history",
            return_value={"aichat_uuid": "c1", "message_history": []},
        ), patch.object(
            ai_service, "refund_ai_credit"
        ) as refund:
            context = await ai_service.ai_send_activity_chat_message_stream(
                MagicMock(), chat_obj, MagicMock(), AsyncMock()
            )

        refund.assert_not_called()
        assert context["chat_session"]["aichat_uuid"] == "c1"
