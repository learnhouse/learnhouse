"""Regression tests: session ownership and API-token scoping (round 3).

- AI refine/editor sessions are bound to their creator and checked before
  any credit is reserved; a session with history but no owner fails closed.
- Boards playground sessions are bound to their creator.
- API tokens cannot upload media into, or edit discussions of, another org.
- Zapier subscription list/delete take the same admin gate as subscribe.
- API tokens stop authenticating once the org's plan drops below API access.
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.db.users import APITokenUser
from src.routers.ai import assignment_gen as ag_router
from src.routers.ai import quiz as quiz_router
from src.routers.ai import scenario as scenario_router
from src.routers.boards import boards_playground as pg_router
from src.routers.integrations import zapier
from src.services.ai import base
from src.services.ai import editor as editor_service
from src.services.ai.schemas.assignment import GenerateAssignmentRequest
from src.services.ai.schemas.editor import SendEditorAIChatMessage
from src.services.ai.schemas.quiz import GenerateQuizRequest
from src.services.ai.schemas.scenario import GenerateScenarioRequest
from src.services.api_tokens import api_tokens as api_tokens_service
from src.services.boards import boards_playground as pg_service
from src.services.boards.schemas.boards_playground import (
    BoardsPlaygroundContext,
    SendBoardsPlaygroundMessage,
)
from src.services.communities import discussions
from src.services.media import media as media_service

pytestmark = pytest.mark.asyncio

RATE_LIMIT_PATH = "src.services.security.rate_limiting.enforce_ai_rate_limit"


class FakeRedis:
    """Just enough of redis-py for the session helpers."""

    def __init__(self):
        self.store: dict = {}
        self.zsets: dict = {}

    def get(self, key):
        return self.store.get(key)

    def setex(self, key, ttl, value):
        self.store[key] = value if isinstance(value, bytes) else str(value).encode()

    def exists(self, key):
        return 1 if key in self.store else 0

    def expire(self, key, ttl):
        return key in self.store

    def zadd(self, key, mapping):
        self.zsets.setdefault(key, {}).update(mapping)

    def ttl(self, key):
        return -1


@pytest.fixture
def ai_redis(monkeypatch):
    r = FakeRedis()
    monkeypatch.setattr(base, "_get_redis", lambda: r)
    return r


def _seed_session(r: FakeRedis, uuid: str, owner: int | None):
    r.setex(f"chat_history:{uuid}", 1, json.dumps([{"role": "user", "content": "secret"}]))
    if owner is not None:
        r.setex(f"chat_meta:{uuid}", 1, json.dumps({"aichat_uuid": uuid, "user_id": owner}))


# ---------------------------------------------------------------------------
# 1. AI chat/session ownership
# ---------------------------------------------------------------------------


class TestChatSessionOwnership:
    def test_history_without_meta_fails_closed(self, ai_redis):
        _seed_session(ai_redis, "legacy", owner=None)
        assert base.chat_session_belongs_to_user("legacy", 1) is False

    def test_brand_new_uuid_is_claimable(self, ai_redis):
        assert base.chat_session_belongs_to_user("never-seen", 1) is True

    def test_owner_and_stranger(self, ai_redis):
        _seed_session(ai_redis, "s1", owner=1)
        assert base.chat_session_belongs_to_user("s1", 1) is True
        assert base.chat_session_belongs_to_user("s1", 2) is False

    def test_unlisted_save_records_owner_without_sidebar_entry(self, ai_redis, monkeypatch):
        monkeypatch.setattr(
            base,
            "get_learnhouse_config",
            lambda: SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="redis://x")
            ),
        )
        monkeypatch.setattr(base.redis, "from_url", lambda *a, **k: ai_redis)
        base.save_message_to_history("q1", "make a quiz", "[]", user_id=7, org_id=3, listed=False)
        meta = json.loads(ai_redis.store["chat_meta:q1"])
        assert meta["user_id"] == 7 and meta["org_id"] == 3
        assert "user_chats:7" not in ai_redis.zsets
        assert base.chat_session_belongs_to_user("q1", 7) is True
        assert base.chat_session_belongs_to_user("q1", 8) is False


def _result(value):
    scalars = MagicMock()
    scalars.first.return_value = value
    res = MagicMock()
    res.scalars.return_value = scalars
    return res


def _db_returning(*values):
    db = AsyncMock()
    db.execute.side_effect = [_result(v) for v in values]
    return db


class TestGenerationRoutersCheckOwnership:
    async def test_quiz_foreign_session_404_before_credit(self, ai_redis):
        _seed_session(ai_redis, "victim", owner=99)
        reserve = AsyncMock()
        body = GenerateQuizRequest(org_id=5, prompt="p", session_uuid="victim")
        with patch.object(quiz_router, "is_org_member", new=AsyncMock(return_value=True)), \
             patch.object(quiz_router, "enforce_org_mfa", new=AsyncMock()), \
             patch.object(quiz_router, "require_org_create_permission", new=AsyncMock()), \
             patch.object(quiz_router, "reserve_ai_credit", new=reserve):
            with pytest.raises(HTTPException) as exc:
                await quiz_router.api_generate_quiz(
                    body, MagicMock(), SimpleNamespace(id=1), _db_returning(SimpleNamespace(id=5))
                )
        assert exc.value.status_code == 404
        reserve.assert_not_called()

    async def test_quiz_unowned_legacy_session_404(self, ai_redis):
        _seed_session(ai_redis, "legacy", owner=None)
        reserve = AsyncMock()
        body = GenerateQuizRequest(org_id=5, prompt="p", session_uuid="legacy")
        with patch.object(quiz_router, "is_org_member", new=AsyncMock(return_value=True)), \
             patch.object(quiz_router, "enforce_org_mfa", new=AsyncMock()), \
             patch.object(quiz_router, "require_org_create_permission", new=AsyncMock()), \
             patch.object(quiz_router, "reserve_ai_credit", new=reserve):
            with pytest.raises(HTTPException) as exc:
                await quiz_router.api_generate_quiz(
                    body, MagicMock(), SimpleNamespace(id=1), _db_returning(SimpleNamespace(id=5))
                )
        assert exc.value.status_code == 404
        reserve.assert_not_called()

    async def test_quiz_passes_owner_to_service(self, ai_redis):
        _seed_session(ai_redis, "mine", owner=1)
        gen = AsyncMock(return_value=({"questions": [{"q": 1}]}, "mine"))
        body = GenerateQuizRequest(org_id=5, prompt="p", session_uuid="mine")
        with patch.object(quiz_router, "is_org_member", new=AsyncMock(return_value=True)), \
             patch.object(quiz_router, "enforce_org_mfa", new=AsyncMock()), \
             patch.object(quiz_router, "require_org_create_permission", new=AsyncMock()), \
             patch.object(quiz_router, "enforce_ai_rate_limit"), \
             patch.object(quiz_router, "reserve_ai_credit", new=AsyncMock()), \
             patch.object(quiz_router, "resolve_model_for_org", new=AsyncMock(return_value="m")), \
             patch.object(quiz_router, "generate_quiz", new=gen), \
             patch.object(quiz_router, "record_generation",
                          new=AsyncMock(return_value=SimpleNamespace(ai_generation_uuid="g"))):
            await quiz_router.api_generate_quiz(
                body, MagicMock(), SimpleNamespace(id=1), _db_returning(SimpleNamespace(id=5))
            )
        assert gen.await_args.kwargs["user_id"] == 1

    async def test_scenario_foreign_session_404_before_credit(self, ai_redis):
        _seed_session(ai_redis, "victim", owner=99)
        reserve = AsyncMock()
        body = GenerateScenarioRequest(org_id=5, prompt="p", session_uuid="victim")
        with patch.object(scenario_router, "is_org_member", new=AsyncMock(return_value=True)), \
             patch.object(scenario_router, "enforce_org_mfa", new=AsyncMock()), \
             patch.object(scenario_router, "require_org_create_permission", new=AsyncMock()), \
             patch.object(scenario_router, "reserve_ai_credit", new=reserve):
            with pytest.raises(HTTPException) as exc:
                await scenario_router.api_generate_scenario(
                    MagicMock(), body, SimpleNamespace(id=1), _db_returning(SimpleNamespace(id=5))
                )
        assert exc.value.status_code == 404
        reserve.assert_not_called()

    async def test_assignment_foreign_session_404_before_credit(self, ai_redis):
        _seed_session(ai_redis, "victim", owner=99)
        reserve = AsyncMock()
        body = GenerateAssignmentRequest(
            org_id=5, course_uuid="course_1", prompt="p", session_uuid="victim"
        )
        course = SimpleNamespace(id=3, org_id=5, course_uuid="course_1")
        with patch.object(ag_router, "is_org_member", new=AsyncMock(return_value=True)), \
             patch.object(ag_router, "enforce_org_mfa", new=AsyncMock()), \
             patch.object(ag_router, "check_resource_access", new=AsyncMock()), \
             patch.object(ag_router, "reserve_ai_credit", new=reserve):
            with pytest.raises(HTTPException) as exc:
                await ag_router.api_generate_assignment(
                    body, MagicMock(), SimpleNamespace(id=1),
                    _db_returning(SimpleNamespace(id=5), course),
                )
        assert exc.value.status_code == 404
        reserve.assert_not_called()

    async def test_editor_send_foreign_session_404_before_credit(
        self, ai_redis, db, org, course, activity, mock_request, admin_user
    ):
        _seed_session(ai_redis, "victim", owner=admin_user.id + 1000)
        chat_obj = SendEditorAIChatMessage(
            aichat_uuid="victim",
            activity_uuid="activity_test",
            message="rewrite this",
            current_content={"type": "doc", "content": []},
        )
        with patch.object(
            editor_service, "reserve_ai_credit", new_callable=AsyncMock
        ) as reserve, patch(RATE_LIMIT_PATH), patch.object(
            editor_service, "check_resource_access", new_callable=AsyncMock
        ):
            with pytest.raises(HTTPException) as exc:
                await editor_service.editor_ai_send_message_stream(
                    chat_obj, admin_user, db, mock_request
                )
        assert exc.value.status_code == 404
        reserve.assert_not_called()

    async def test_editor_stream_saves_history_with_owner(self):
        from src.routers.ai import ai as ai_router

        async def _stream():
            yield "hello"

        save = MagicMock()
        with patch.object(ai_router, "save_message_to_history", new=save), \
             patch.object(ai_router, "generate_follow_up_suggestions", new=AsyncMock(return_value=[])):
            gen = ai_router.editor_chat_event_generator(
                _stream(), "chat_1", "act_1", "msg", "ctx", "m", org_id=3, user_id=42
            )
            async for _ in gen:
                pass
        assert save.call_args.kwargs["user_id"] == 42
        assert save.call_args.kwargs["org_id"] == 3


# ---------------------------------------------------------------------------
# 2. Boards playground sessions
# ---------------------------------------------------------------------------


@pytest.fixture
def pg_redis(monkeypatch):
    r = FakeRedis()
    monkeypatch.setattr(pg_service, "get_redis_connection", lambda: r)
    return r


def _pg_session():
    return pg_service.create_boards_playground_session(
        block_uuid="block_1",
        board_uuid="board_1",
        context=BoardsPlaygroundContext(board_name="b", board_description="d"),
        user_id=1,
    )


class TestBoardsPlaygroundOwnership:
    def test_creator_recorded(self, pg_redis):
        session = _pg_session()
        assert pg_service.get_boards_playground_session_owner(session.session_uuid) == 1

    async def test_iterate_by_other_user_404_before_credit(self, pg_redis):
        session = _pg_session()
        reserve = AsyncMock()
        msg = SendBoardsPlaygroundMessage(
            session_uuid=session.session_uuid,
            board_uuid="board_1",
            block_uuid="block_1",
            message="hi",
        )
        with patch.object(pg_router, "reserve_ai_credit", new=reserve):
            with pytest.raises(HTTPException) as exc:
                await pg_router.iterate_boards_playground_session(
                    MagicMock(), msg, SimpleNamespace(id=2), AsyncMock()
                )
        assert exc.value.status_code == 404
        reserve.assert_not_called()

    async def test_session_read_by_non_owner_needs_board_update(self, pg_redis):
        session = _pg_session()
        board = SimpleNamespace(board_uuid="board_1", org_id=5)
        org = SimpleNamespace(id=5)
        denied = AsyncMock(side_effect=HTTPException(status_code=403, detail="no"))
        with patch.object(pg_router, "is_org_member", new=AsyncMock(return_value=True)), \
             patch.object(pg_router, "enforce_org_mfa", new=AsyncMock()), \
             patch.object(pg_router, "check_resource_access", new=denied):
            with pytest.raises(HTTPException) as exc:
                await pg_router.get_session_state(
                    MagicMock(), session.session_uuid, SimpleNamespace(id=2),
                    _db_returning(board, org),
                )
        assert exc.value.status_code == 403

    async def test_session_read_by_owner_skips_board_check(self, pg_redis):
        session = _pg_session()
        board = SimpleNamespace(board_uuid="board_1", org_id=5)
        org = SimpleNamespace(id=5)
        rbac = AsyncMock()
        with patch.object(pg_router, "is_org_member", new=AsyncMock(return_value=True)), \
             patch.object(pg_router, "enforce_org_mfa", new=AsyncMock()), \
             patch.object(pg_router, "check_resource_access", new=rbac):
            resp = await pg_router.get_session_state(
                MagicMock(), session.session_uuid, SimpleNamespace(id=1),
                _db_returning(board, org),
            )
        assert resp.session_uuid == session.session_uuid
        rbac.assert_not_called()


# ---------------------------------------------------------------------------
# 3. Media upload pinned to the token's org
# ---------------------------------------------------------------------------


async def test_media_create_rejects_token_for_other_org():
    token = APITokenUser(org_id=2, created_by_user_id=1, rights={})
    obj = media_service.MediaCreate(
        name="x", media_type=media_service.MediaTypeEnum.EMBED, url="https://e", org_id=1
    )
    role_check = AsyncMock()
    with patch.object(media_service, "_get_org_uuid", new=AsyncMock(return_value="org_1")), \
         patch.object(media_service, "require_org_role_permission", new=role_check):
        with pytest.raises(HTTPException) as exc:
            await media_service.create_media(MagicMock(), obj, token, AsyncMock())
    assert exc.value.status_code == 403
    role_check.assert_not_called()


# ---------------------------------------------------------------------------
# 4. Discussion edits by API tokens of another org
# ---------------------------------------------------------------------------


def _discussion_db():
    discussion = SimpleNamespace(
        discussion_uuid="d1", community_id=10, author_id=1, edit_count=0
    )
    community = SimpleNamespace(id=10, org_id=1, community_uuid="community_1")
    return _db_returning(discussion, community)


@pytest.mark.parametrize(
    "call",
    [
        lambda tok, db: discussions.update_discussion(
            MagicMock(), "d1", discussions.DiscussionUpdate(title="t"), tok, db
        ),
        lambda tok, db: discussions.pin_discussion(MagicMock(), "d1", True, tok, db),
        lambda tok, db: discussions.lock_discussion(MagicMock(), "d1", True, tok, db),
        lambda tok, db: discussions.delete_discussion(MagicMock(), "d1", tok, db),
    ],
    ids=["update", "pin", "lock", "delete"],
)
async def test_discussion_writes_reject_token_from_other_org(call):
    token = APITokenUser(org_id=2, created_by_user_id=1, rights={})
    admin = AsyncMock(return_value=True)
    with patch.object(discussions, "authorization_verify_if_user_is_anon", new=AsyncMock()), \
         patch.object(discussions, "authorization_verify_based_on_org_admin_status", new=admin):
        with pytest.raises(HTTPException) as exc:
            await call(token, _discussion_db())
    assert exc.value.status_code == 403
    admin.assert_not_called()


# ---------------------------------------------------------------------------
# 5. Zapier subscription list/delete admin gate
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("op", ["list", "delete"])
async def test_zapier_subscription_ops_require_org_admin(op):
    token = APITokenUser(org_id=1, created_by_user_id=7, rights={})
    db = AsyncMock()
    gate = AsyncMock(side_effect=HTTPException(status_code=403, detail="admin only"))
    with patch.object(zapier, "require_org_admin", new=gate):
        with pytest.raises(HTTPException) as exc:
            if op == "list":
                await zapier.zapier_list_subscriptions(ctx=(token, db))
            else:
                await zapier.zapier_delete_subscription(1, ctx=(token, db))
    assert exc.value.status_code == 403
    gate.assert_awaited_once_with(7, 1, db)
    db.execute.assert_not_called()


# ---------------------------------------------------------------------------
# 6. API tokens after a plan downgrade
# ---------------------------------------------------------------------------


def _saas():
    """Both the router-dependency bypass and the plan comparison read the mode."""
    from contextlib import ExitStack

    stack = ExitStack()
    stack.enter_context(
        patch("src.security.features_utils.plan_check.get_deployment_mode", return_value="saas")
    )
    stack.enter_context(
        patch("src.core.deployment_mode.get_deployment_mode", return_value="saas")
    )
    return stack


def _token_db(token_row):
    scalars = MagicMock()
    scalars.all.return_value = [token_row]
    res = MagicMock()
    res.scalars.return_value = scalars
    db = AsyncMock()
    db.execute.return_value = res
    return db


def _token_row():
    return SimpleNamespace(
        org_id=1, token_hash="h", expires_at=None, last_used_at=None, is_active=True
    )


async def test_token_rejected_after_downgrade_in_saas():
    with _saas(), \
         patch("src.security.features_utils.plan_check.get_org_plan",
               new=AsyncMock(return_value="free")), \
         patch.object(api_tokens_service, "security_verify_token", return_value=True):
        with pytest.raises(HTTPException) as exc:
            await api_tokens_service.validate_api_token_for_auth(
                "lh_abcdefghijklmnop", _token_db(_token_row())
            )
    assert exc.value.status_code == 403
    assert "API Access" in exc.value.detail


async def test_token_accepted_on_pro_in_saas():
    row = _token_row()
    with _saas(), \
         patch("src.security.features_utils.plan_check.get_org_plan",
               new=AsyncMock(return_value="pro")), \
         patch.object(api_tokens_service, "security_verify_token", return_value=True), \
         patch.object(api_tokens_service, "security_token_needs_rehash", return_value=False):
        result = await api_tokens_service.validate_api_token_for_auth(
            "lh_abcdefghijklmnop", _token_db(row)
        )
    assert result is row


async def test_token_rejected_when_org_has_no_plan_record():
    missing = AsyncMock(side_effect=HTTPException(status_code=404, detail="no config"))
    with _saas(), \
         patch("src.security.features_utils.plan_check.get_org_plan", new=missing), \
         patch.object(api_tokens_service, "security_verify_token", return_value=True):
        with pytest.raises(HTTPException) as exc:
            await api_tokens_service.validate_api_token_for_auth(
                "lh_abcdefghijklmnop", _token_db(_token_row())
            )
    assert exc.value.status_code == 403


async def test_token_plan_check_bypassed_self_hosted():
    row = _token_row()
    with patch("src.security.features_utils.plan_check.get_deployment_mode", return_value="oss"), \
         patch.object(api_tokens_service, "security_verify_token", return_value=True), \
         patch.object(api_tokens_service, "security_token_needs_rehash", return_value=False):
        result = await api_tokens_service.validate_api_token_for_auth(
            "lh_abcdefghijklmnop", _token_db(row)
        )
    assert result is row
