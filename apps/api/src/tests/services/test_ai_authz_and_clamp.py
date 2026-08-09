"""Authorization + input-hardening tests for the AI services.

Covers:
- F5/F6: activity AI chat (streaming + non-streaming) must authorize the
  client-supplied activity_uuid *before* rate limiting / credit reservation.
- F32: editor AI must authorize against the org owning the activity before
  spending that org's credits.
- F19/F40: heading `level` is a client/stored-JSON value used as a string
  repeat count and must be clamped.

No real LLM calls: every AI entry point is patched.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.organization_config import OrganizationConfig
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User
from src.services.ai import ai as ai_service
from src.services.ai import editor as editor_service
from src.services.ai.rag import content_extraction
from src.services.ai.schemas.ai import (
    SendActivityAIChatMessage,
    StartActivityAIChatSession,
)
from src.services.ai.schemas.editor import (
    SendEditorAIChatMessage,
    StartEditorAIChatSession,
)
from src.security.rbac import AccessAction


RATE_LIMIT_PATH = "src.services.security.rate_limiting.enforce_ai_rate_limit"


@pytest.fixture
async def org_config(db, org):
    """Minimal org config row — the AI services validate one before answering."""
    cfg = OrganizationConfig(org_id=org.id, config={"config_version": "1.0"})
    db.add(cfg)
    await db.commit()
    return cfg


@pytest.fixture
async def outsider_user(db, other_org):
    """A user registered in another org — no membership in the test org."""
    u = User(
        id=99,
        username="outsider",
        first_name="Out",
        last_name="Sider",
        email="outsider@other.com",
        password="hashed_password",
        user_uuid="user_outsider",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    db.add(
        UserOrganization(
            user_id=u.id,
            org_id=other_org.id,
            role_id=4,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()
    return PublicUser(
        id=u.id,
        username=u.username,
        first_name=u.first_name,
        last_name=u.last_name,
        email=u.email,
        user_uuid=u.user_uuid,
    )


# ---------------------------------------------------------------------------
# F5 / F6 — activity AI chat authorization
# ---------------------------------------------------------------------------


class TestActivityChatAuthorization:
    async def test_outsider_blocked_and_no_credit_reserved(
        self, db, org, course, activity, org_config, mock_request, outsider_user
    ):
        chat_obj = StartActivityAIChatSession(
            activity_uuid="activity_test", message="dump the course content"
        )

        with patch.object(
            ai_service, "reserve_ai_credit", new_callable=AsyncMock
        ) as reserve, patch.object(
            ai_service, "check_resource_access", new_callable=AsyncMock
        ), patch(
            RATE_LIMIT_PATH
        ) as rate_limit, patch.object(
            ai_service, "ask_ai", new_callable=AsyncMock
        ) as ask:
            with pytest.raises(HTTPException) as exc:
                await ai_service.ai_start_activity_chat_session(
                    mock_request, chat_obj, outsider_user, db
                )

        assert exc.value.status_code == 403
        # The victim org must not be billed for a request we refused.
        reserve.assert_not_called()
        rate_limit.assert_not_called()
        ask.assert_not_called()

    async def test_outsider_blocked_on_send_path(
        self, db, org, course, activity, org_config, mock_request, outsider_user
    ):
        chat_obj = SendActivityAIChatMessage(
            aichat_uuid="chat_1", activity_uuid="activity_test", message="hi"
        )

        with patch.object(
            ai_service, "reserve_ai_credit", new_callable=AsyncMock
        ) as reserve, patch.object(
            ai_service, "check_resource_access", new_callable=AsyncMock
        ), patch(
            RATE_LIMIT_PATH
        ), patch.object(
            ai_service, "ask_ai", new_callable=AsyncMock
        ):
            with pytest.raises(HTTPException) as exc:
                await ai_service.ai_send_activity_chat_message(
                    mock_request, chat_obj, outsider_user, db
                )

        assert exc.value.status_code == 403
        reserve.assert_not_called()

    async def test_outsider_blocked_on_streaming_path(
        self, db, org, course, activity, org_config, mock_request, outsider_user
    ):
        with patch.object(
            ai_service, "reserve_ai_credit", new_callable=AsyncMock
        ) as reserve, patch.object(
            ai_service, "check_resource_access", new_callable=AsyncMock
        ), patch(
            RATE_LIMIT_PATH
        ):
            with pytest.raises(HTTPException) as exc:
                await ai_service._get_activity_and_course_info(
                    "activity_test", db, mock_request, outsider_user
                )

        assert exc.value.status_code == 403
        reserve.assert_not_called()

    async def test_member_denied_by_rbac_spends_nothing(
        self, db, org, course, activity, org_config, mock_request, regular_user
    ):
        """RBAC denial must land before the credit reservation."""
        with patch.object(
            ai_service, "reserve_ai_credit", new_callable=AsyncMock
        ) as reserve, patch.object(
            ai_service,
            "check_resource_access",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=403, detail="no access"),
        ), patch(
            RATE_LIMIT_PATH
        ) as rate_limit:
            with pytest.raises(HTTPException) as exc:
                await ai_service._get_activity_and_course_info(
                    "activity_test", db, mock_request, regular_user
                )

        assert exc.value.status_code == 403
        reserve.assert_not_called()
        rate_limit.assert_not_called()

    async def test_member_streaming_path_succeeds(
        self, db, org, course, activity, org_config, mock_request, regular_user
    ):
        with patch.object(
            ai_service, "check_resource_access", new_callable=AsyncMock
        ) as rbac, patch.object(
            ai_service, "model_for_tier", return_value="test-model"
        ), patch.object(
            ai_service, "structure_activity_content_by_type", return_value=[]
        ), patch.object(
            ai_service,
            "serialize_activity_text_to_ai_comprehensible_text",
            return_value="course context",
        ):
            (
                got_activity,
                got_course,
                got_org,
                ai_model,
                ai_friendly_text,
            ) = await ai_service._get_activity_and_course_info(
                "activity_test", db, mock_request, regular_user
            )

        assert got_activity.activity_uuid == "activity_test"
        assert got_course.course_uuid == "course_test"
        assert got_org.id == org.id
        assert ai_model == "test-model"
        assert ai_friendly_text == "course context"
        # READ access on the owning course, not the activity.
        assert rbac.await_args.args[3] == "course_test"
        assert rbac.await_args.args[4] == AccessAction.READ

    async def test_member_non_streaming_start_succeeds(
        self, db, org, course, activity, org_config, mock_request, regular_user
    ):
        chat_obj = StartActivityAIChatSession(
            activity_uuid="activity_test", message="explain this"
        )

        with patch.object(
            ai_service, "check_resource_access", new_callable=AsyncMock
        ), patch(
            RATE_LIMIT_PATH
        ) as rate_limit, patch.object(
            ai_service, "reserve_ai_credit", new_callable=AsyncMock
        ) as reserve, patch.object(
            ai_service, "structure_activity_content_by_type", return_value=[]
        ), patch.object(
            ai_service,
            "serialize_activity_text_to_ai_comprehensible_text",
            return_value="course context",
        ), patch.object(
            ai_service, "model_for_tier", return_value="test-model"
        ), patch.object(
            ai_service,
            "get_chat_session_history",
            return_value={"aichat_uuid": "chat_1", "message_history": []},
        ), patch.object(
            ai_service,
            "ask_ai",
            new_callable=AsyncMock,
            return_value={"output": "here you go"},
        ), patch.object(
            ai_service, "save_message_to_history"
        ):
            response = await ai_service.ai_start_activity_chat_session(
                mock_request, chat_obj, regular_user, db
            )

        assert response.message == "here you go"
        assert response.activity_uuid == "activity_test"
        rate_limit.assert_called_once()
        reserve.assert_awaited_once()

    async def test_member_non_streaming_send_succeeds(
        self, db, org, course, activity, org_config, mock_request, regular_user
    ):
        chat_obj = SendActivityAIChatMessage(
            aichat_uuid="chat_1", activity_uuid="activity_test", message="more"
        )

        with patch.object(
            ai_service, "check_resource_access", new_callable=AsyncMock
        ), patch(
            RATE_LIMIT_PATH
        ), patch.object(
            ai_service, "reserve_ai_credit", new_callable=AsyncMock
        ) as reserve, patch.object(
            ai_service, "structure_activity_content_by_type", return_value=[]
        ), patch.object(
            ai_service,
            "serialize_activity_text_to_ai_comprehensible_text",
            return_value="course context",
        ), patch.object(
            ai_service, "model_for_tier", return_value="test-model"
        ), patch.object(
            ai_service,
            "get_chat_session_history",
            return_value={"aichat_uuid": "chat_1", "message_history": []},
        ), patch.object(
            ai_service,
            "ask_ai",
            new_callable=AsyncMock,
            return_value={"output": "sure"},
        ), patch.object(
            ai_service, "save_message_to_history"
        ):
            response = await ai_service.ai_send_activity_chat_message(
                mock_request, chat_obj, regular_user, db
            )

        assert response.message == "sure"
        reserve.assert_awaited_once()


# ---------------------------------------------------------------------------
# F32 — editor AI authorization
# ---------------------------------------------------------------------------


class TestEditorAIAuthorization:
    async def test_outsider_cannot_spend_org_credits(
        self, db, org, course, activity, mock_request, outsider_user
    ):
        chat_obj = StartEditorAIChatSession(
            activity_uuid="activity_test",
            message="rewrite this",
            current_content={"type": "doc", "content": []},
        )

        with patch.object(
            editor_service, "reserve_ai_credit", new_callable=AsyncMock
        ) as reserve, patch(
            RATE_LIMIT_PATH
        ) as rate_limit, patch.object(
            editor_service, "check_resource_access", new_callable=AsyncMock
        ):
            with pytest.raises(HTTPException) as exc:
                await editor_service.editor_ai_start_chat_session_stream(
                    chat_obj, outsider_user, db, mock_request
                )

        assert exc.value.status_code == 403
        reserve.assert_not_called()
        rate_limit.assert_not_called()

    async def test_outsider_blocked_on_editor_send(
        self, db, org, course, activity, mock_request, outsider_user
    ):
        chat_obj = SendEditorAIChatMessage(
            aichat_uuid="chat_1",
            activity_uuid="activity_test",
            message="rewrite this",
            current_content={"type": "doc", "content": []},
        )

        with patch.object(
            editor_service, "reserve_ai_credit", new_callable=AsyncMock
        ) as reserve, patch(
            RATE_LIMIT_PATH
        ), patch.object(
            editor_service, "check_resource_access", new_callable=AsyncMock
        ):
            with pytest.raises(HTTPException) as exc:
                await editor_service.editor_ai_send_message_stream(
                    chat_obj, outsider_user, db, mock_request
                )

        assert exc.value.status_code == 403
        reserve.assert_not_called()

    async def test_member_editor_session_succeeds_and_checks_update_rights(
        self, db, org, course, activity, mock_request, admin_user
    ):
        chat_obj = StartEditorAIChatSession(
            activity_uuid="activity_test",
            message="rewrite this",
            current_content={
                "type": "doc",
                "content": [
                    {
                        "type": "heading",
                        "attrs": {"level": 2},
                        "content": [{"type": "text", "text": "Intro"}],
                    }
                ],
            },
        )

        with patch.object(
            editor_service, "reserve_ai_credit", new_callable=AsyncMock
        ) as reserve, patch(
            RATE_LIMIT_PATH
        ), patch.object(
            editor_service, "check_resource_access", new_callable=AsyncMock
        ) as rbac, patch.object(
            editor_service, "model_for_tier", return_value="test-model"
        ), patch.object(
            editor_service,
            "get_chat_session_history",
            return_value={"aichat_uuid": "chat_1", "message_history": []},
        ):
            context = await editor_service.editor_ai_start_chat_session_stream(
                chat_obj, admin_user, db, mock_request
            )

        assert context["ai_model"] == "test-model"
        assert "## Intro" in context["ai_friendly_text"]
        reserve.assert_awaited_once()
        # Editing is an authoring action -> UPDATE on the owning course.
        assert rbac.await_args.args[3] == "course_test"
        assert rbac.await_args.args[4] == AccessAction.UPDATE

    async def test_member_editor_send_without_request_skips_resource_check(
        self, db, org, course, activity, admin_user
    ):
        """The router does not forward the Request yet; the org gate still runs."""
        chat_obj = SendEditorAIChatMessage(
            aichat_uuid="chat_1",
            activity_uuid="activity_test",
            message="rewrite this",
            current_content={"type": "doc", "content": []},
            selected_text="some selection",
        )

        with patch.object(
            editor_service, "reserve_ai_credit", new_callable=AsyncMock
        ) as reserve, patch(
            RATE_LIMIT_PATH
        ), patch.object(
            editor_service, "check_resource_access", new_callable=AsyncMock
        ) as rbac, patch.object(
            editor_service, "model_for_tier", return_value="test-model"
        ), patch.object(
            editor_service,
            "get_chat_session_history",
            return_value={"aichat_uuid": "chat_1", "message_history": []},
        ):
            context = await editor_service.editor_ai_send_message_stream(
                chat_obj, admin_user, db
            )

        assert context["selected_text"] == "some selection"
        reserve.assert_awaited_once()
        rbac.assert_not_called()


# ---------------------------------------------------------------------------
# F19 — editor TipTap serialization clamp
# ---------------------------------------------------------------------------


def _heading_doc(attrs) -> dict:
    node: dict = {"type": "heading", "content": [{"type": "text", "text": "Title"}]}
    if attrs is not ...:
        node["attrs"] = attrs
    return {"type": "doc", "content": [node]}


class TestEditorHeadingClamp:
    @pytest.mark.parametrize(
        "attrs",
        [
            {"level": 5_000_000_000},
            {"level": -1},
            {"level": 0},
            {"level": "3"},
            {"level": None},
            {"level": True},
            {},
            None,
            "not-a-dict",
            ...,
        ],
    )
    def test_malformed_level_is_bounded(self, attrs):
        out = editor_service._serialize_tiptap_content_to_text(_heading_doc(attrs))
        assert out.endswith("Title")
        assert out.count("#") <= editor_service.MAX_HEADING_LEVEL

    @pytest.mark.parametrize("level", [1, 2, 3, 4, 5, 6])
    def test_valid_levels_render_exact_markers(self, level):
        out = editor_service._serialize_tiptap_content_to_text(
            _heading_doc({"level": level})
        )
        assert out == "#" * level + " Title"

    def test_huge_level_does_not_allocate(self):
        out = editor_service._serialize_tiptap_content_to_text(
            _heading_doc({"level": 5_000_000_000})
        )
        assert len(out) < 100

    def test_malformed_blocks_do_not_raise(self):
        doc = {
            "type": "doc",
            "content": [
                {"type": "codeBlock", "attrs": None, "content": [{"type": "text", "text": "x"}]},
                {"type": "blockQuiz", "attrs": {"questions": "not-a-list"}},
                {"type": "blockQuiz", "attrs": {"questions": ["nope", {"answers": "x"}]}},
                {
                    "type": "blockQuiz",
                    "attrs": {
                        "questions": [
                            {"question": "Q1", "answers": [None, {"answer": "A1", "correct": True}]}
                        ]
                    },
                },
                {"type": "flipcard", "attrs": ["bad"]},
                {"type": "blockLibrary", "attrs": {"snapshot": "bad"}},
            ],
        }
        out = editor_service._serialize_tiptap_content_to_text(doc)
        assert "[QUIZ] Q1" in out
        assert "A1 (correct)" in out
        assert "[LIBRARY RESOURCE]" in out


# ---------------------------------------------------------------------------
# F40 — stored ProseMirror content clamp (RAG indexing)
# ---------------------------------------------------------------------------


class TestRagHeadingClamp:
    @pytest.mark.parametrize(
        "attrs",
        [
            {"level": 5_000_000_000},
            {"level": -1},
            {"level": "3"},
            {"level": None},
            {"level": False},
            {},
            None,
            ...,
        ],
    )
    def test_malformed_level_is_bounded(self, attrs):
        out = content_extraction.extract_text_from_prosemirror(_heading_doc(attrs))
        assert out.endswith("Title")
        assert out.count("#") <= content_extraction.MAX_HEADING_LEVEL

    @pytest.mark.parametrize("level", [1, 2, 3, 4, 5, 6])
    def test_valid_levels_render_exact_markers(self, level):
        out = content_extraction.extract_text_from_prosemirror(
            _heading_doc({"level": level})
        )
        assert out == "#" * level + " Title"

    def test_poisoned_document_does_not_crash_the_indexer(self):
        doc = {
            "type": "doc",
            "content": [
                "a stray string",
                {"type": "paragraph", "content": "not-a-list"},
                {"type": "text", "text": 12345},
                {"type": "bulletList", "content": [None, {"type": "listItem", "content": ["x"]}]},
                {"type": "blockquote", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "quoted"}]}]},
                {"type": "table", "content": ["bad-row", {"type": "row", "content": ["bad-cell"]}]},
                {
                    "type": "listItem",
                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "item"}]}],
                },
                {"type": "unknown", "content": [{"type": "text", "text": "deep"}]},
            ],
        }
        out = content_extraction.extract_text_from_prosemirror(doc)
        assert "> quoted" in out
        assert "- item" in out
        assert "deep" in out
