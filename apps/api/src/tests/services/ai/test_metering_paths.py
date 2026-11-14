"""Failure paths of the metered AI endpoints and jobs: a charge opened before
the stream / background reply starts is refunded when setup fails, and a
failing settlement never breaks the stream or reply."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.ai import metering

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _gates():
    with patch("src.services.security.rate_limiting.enforce_ai_rate_limit"):
        yield


async def test_caption_charge_key_without_redis(monkeypatch):
    from src.services.utils import caption_jobs as cj

    monkeypatch.setattr(cj, "get_redis_client", MagicMock(side_effect=ConnectionError))
    assert cj._charge_key("act_1").startswith("captions:act_1:")


async def test_caption_charge_key_reuses_the_enqueue_token(monkeypatch):
    from src.services.utils import caption_jobs as cj

    client = MagicMock()
    client.get.return_value = b"tok123"
    monkeypatch.setattr(cj, "get_redis_client", lambda: client)
    assert cj._charge_key("act_1") == "captions:act_1:tok123"


async def test_agent_reply_refunds_when_launch_fails(ai_credit_spy):
    from src.services.messaging import agents

    conv = SimpleNamespace(org_id=5, kind="agent", id=1)
    agent = SimpleNamespace(course_uuids=[], is_default=True)
    with patch.object(agents, "_ai_gate", new=AsyncMock()), \
         patch("src.services.ai.rag.access.build_rag_access_scope", new=AsyncMock(return_value=SimpleNamespace(courses={}))), \
         patch.object(agents, "_launch_reply", new=AsyncMock(side_effect=RuntimeError("db down"))):
        with pytest.raises(RuntimeError):
            await agents.trigger_agent_reply(MagicMock(), conv, agent, SimpleNamespace(id=1), SimpleNamespace(id=2), AsyncMock())
    assert ai_credit_spy.last.feature == "messaging_agent" and ai_credit_spy.last.status == "refunded"


async def test_agent_reply_survives_a_failing_settlement(monkeypatch):
    from src.services.messaging import agents

    meter = metering.Meter(feature="messaging_agent", org_id=5, reserved=2)
    meter.settle = AsyncMock(side_effect=RuntimeError("redis"))
    factory = MagicMock(side_effect=RuntimeError("db down"))
    monkeypatch.setattr("src.core.events.database._async_session_factory", factory)
    with pytest.raises(RuntimeError):
        await agents._stream_reply(conv_id=1, conversation_uuid="c", org_id=5, agent_id=1, placeholder_id=1,
                                   question="q", scope=SimpleNamespace(course_ids=[]), recipients=[], meter=meter)
    meter.settle.assert_awaited()


async def test_role_change_skips_orgs_without_config():
    from src.security.features_utils import usage

    role = SimpleNamespace(rights={"dashboard": {"action_access": True}}, role_type=None)
    with patch.object(usage, "_role_grants_dashboard_access", return_value=True), \
         patch.object(usage, "_get_org_config", new=AsyncMock(return_value=None)), \
         patch.object(usage, "check_admin_seat_limit", new=AsyncMock()) as check:
        await usage.enforce_admin_seat_limit_for_role_change(1, 2, role, AsyncMock())
    check.assert_not_awaited()
