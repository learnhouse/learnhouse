"""Second sweep: AI authoring gates, session ownership, listings, CORS default.

Members could spend an org's AI credits on authoring tools (scenario, images,
audio, magic blocks, planning) and read or continue each other's AI sessions;
private boards were listed to every member; comments skipped the rich-content
validator; and a catch-all ``allowed_regexp`` opened CORS with credentials.
"""

import re
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.db.boards import Board
from src.core.middleware.cors import effective_allowed_regexp, get_cors_origin_regex


def _hosting(allowed_regexp, tenancy="multi"):
    return SimpleNamespace(hosting_config=SimpleNamespace(
        tenancy=tenancy, allowed_regexp=allowed_regexp,
        frontend_domain="app.example.com", domain="example.com",
    ))


class TestCatchAllAllowedRegexpIsIgnored:
    def test_shipped_default_does_not_open_every_origin(self):
        default = r"\b((?:https?://)[^\s/$.?#].[^\s]*)\b"
        with patch("src.core.middleware.cors.get_learnhouse_config", return_value=_hosting(default)):
            assert effective_allowed_regexp() is None
            regex = get_cors_origin_regex()
        assert re.match(regex, "https://tenant.example.com")
        assert not re.match(regex, "https://attacker.invalid")

    def test_scoped_pattern_is_kept(self):
        scoped = r"^https://(?:[a-z0-9-]+\.)*acme\.test$"
        with patch("src.core.middleware.cors.get_learnhouse_config", return_value=_hosting(scoped)):
            assert effective_allowed_regexp() == scoped


class TestAIAuthoringToolsNeedAuthorRights:
    async def test_scenario_without_create_right_spends_nothing(self):
        from src.routers.ai import scenario as sc
        from src.services.ai.schemas.scenario import GenerateScenarioRequest

        db = AsyncMock()
        with patch.object(sc, "_authorize_org", new=AsyncMock(return_value=SimpleNamespace(id=5))), \
             patch.object(sc, "require_org_create_permission",
                          new=AsyncMock(side_effect=HTTPException(status_code=403, detail="no"))), \
             patch.object(sc, "reserve_ai_credit", new=AsyncMock()) as reserve:
            with pytest.raises(HTTPException) as exc:
                await sc.api_generate_scenario(
                    SimpleNamespace(), GenerateScenarioRequest(org_id=5, prompt="p"),
                    SimpleNamespace(id=1), db,
                )
        assert exc.value.status_code == 403
        reserve.assert_not_awaited()

    async def test_scenario_grounded_on_activity_needs_course_edit(self):
        from src.routers.ai import scenario as sc
        from src.services.ai.schemas.scenario import GenerateScenarioRequest

        with patch.object(sc, "_authorize_org", new=AsyncMock(return_value=SimpleNamespace(id=5))), \
             patch.object(sc, "_load_activity_content", new=AsyncMock(return_value=({}, 9, "course_x"))), \
             patch.object(sc, "check_resource_access",
                          new=AsyncMock(side_effect=HTTPException(status_code=403, detail="no"))) as rbac, \
             patch.object(sc, "reserve_ai_credit", new=AsyncMock()) as reserve:
            with pytest.raises(HTTPException) as exc:
                await sc.api_generate_scenario(
                    SimpleNamespace(), GenerateScenarioRequest(org_id=5, prompt="p", activity_uuid="act"),
                    SimpleNamespace(id=1), AsyncMock(),
                )
        assert exc.value.status_code == 403
        assert rbac.await_args.args[3] == "course_x"
        reserve.assert_not_awaited()


class TestAISessionsBelongToTheirStarter:
    async def test_activity_chat_refuses_someone_elses_session(self, db, course, activity, regular_user, mock_request):
        from src.services.ai import ai as ai_service
        from src.services.ai.schemas.ai import SendActivityAIChatMessage

        body = SendActivityAIChatMessage(
            aichat_uuid="aichat_theirs", activity_uuid=activity.activity_uuid, message="hi"
        )
        info = (activity, course, SimpleNamespace(id=course.org_id), "model", "text")
        with patch.object(ai_service, "_get_activity_and_course_info", new=AsyncMock(return_value=info)), \
             patch.object(ai_service, "reserve_ai_credit", new=AsyncMock()) as reserve, \
             patch.object(ai_service, "chat_session_belongs_to_user", return_value=False), \
             patch("src.services.security.rate_limiting.enforce_ai_rate_limit"):
            with pytest.raises(HTTPException) as exc:
                await ai_service.ai_send_activity_chat_message_stream(
                    mock_request, body, regular_user, db
                )
        assert exc.value.status_code == 404
        # Rejected before any credit is taken, so there is nothing to refund.
        reserve.assert_not_awaited()

    async def test_course_planning_session_is_user_bound(self, db, org, admin_user):
        from src.routers.ai import courseplanning as cp
        from src.services.ai.schemas.courseplanning import CoursePlanningSessionData

        session = CoursePlanningSessionData(session_uuid="cp_x", org_id=org.id, user_id=999)
        with patch.object(cp, "get_course_planning_session", return_value=session):
            with pytest.raises(HTTPException) as exc:
                await cp.get_session_state("cp_x", admin_user, db)
        assert exc.value.status_code == 404


class TestBoardListingHonoursEachBoard:
    async def test_private_boards_are_hidden_from_plain_members(self, db, org, admin_user, regular_user, mock_request):
        from src.services.boards.boards import get_boards_by_org

        for id, uuid, public in ((1, "board_pub", True), (2, "board_priv", False)):
            db.add(Board(
                id=id, name=uuid, public=public, org_id=org.id, board_uuid=uuid,
                created_by=admin_user.id,
                creation_date=str(datetime.now()), update_date=str(datetime.now()),
            ))
        await db.commit()

        # The listing shows exactly the boards the caller could open directly.
        from src.security.rbac.resource_access import AccessDecision
        from src.services.boards import boards as boards_module

        async def per_board(request, db_session, user, uuid, action, *a, **kw):
            return AccessDecision(allowed=(uuid != "board_priv"), reason="")

        with patch.object(boards_module, "check_resource_access", side_effect=per_board):
            seen = {b.board_uuid for b in await get_boards_by_org(mock_request, org.id, regular_user, db)}
        assert seen == {"board_pub"}


class TestCommentsGoThroughTheRichContentValidator:
    async def test_validate_comment_content_calls_rich_validator(self):
        from src.services.communities import moderation

        fake_db = MagicMock()
        fake_db.execute = AsyncMock(return_value=MagicMock())
        with patch.object(moderation, "get_community_settings", return_value={}), \
             patch.object(moderation, "validate_rich_content") as rich, \
             patch.object(moderation, "validate_content_for_community", new=AsyncMock()):
            await moderation.validate_comment_content('{"type":"doc"}', 1, fake_db)
        rich.assert_called_once()
        assert rich.call_args.kwargs.get("content_type") == "reply"
