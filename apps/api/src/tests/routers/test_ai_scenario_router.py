"""Behavioral tests for src/routers/ai/scenario.py."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.routers.ai import scenario as sc
from src.services.ai.llm import AINotConfiguredError
from src.services.ai.schemas.scenario import GenerateScenarioRequest

pytestmark = pytest.mark.asyncio


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


def _org(id=5):
    return SimpleNamespace(id=id, org_uuid="org_x")


def _user(id=1):
    return SimpleNamespace(id=id)


_BLOCK = {
    "title": "T",
    "currentScenarioId": "1",
    "scenarios": [{"id": "1", "text": "hi", "imageUrl": "", "options": []}],
}


async def test_empty_prompt_400():
    with pytest.raises(HTTPException) as exc:
        await sc.api_generate_scenario(GenerateScenarioRequest(org_id=5, prompt=" "), _user(), _db_returning(_org()))
    assert exc.value.status_code == 400


async def test_non_member_403():
    with patch.object(sc, "is_org_member", new=AsyncMock(return_value=False)):
        with pytest.raises(HTTPException) as exc:
            await sc.api_generate_scenario(GenerateScenarioRequest(org_id=5, prompt="p"), _user(), _db_returning(_org()))
    assert exc.value.status_code == 403


async def test_happy_path():
    body = GenerateScenarioRequest(org_id=5, prompt="make a scenario")
    record = SimpleNamespace(ai_generation_uuid="aigen_1")
    with patch.object(sc, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(sc, "enforce_ai_rate_limit"), \
         patch.object(sc, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(sc, "resolve_model_for_org", new=AsyncMock(return_value="m")), \
         patch.object(sc, "generate_scenario", new=AsyncMock(return_value=(_BLOCK, "s1"))), \
         patch.object(sc, "record_generation", new=AsyncMock(return_value=record)):
        resp = await sc.api_generate_scenario(body, _user(), _db_returning(_org()))
    assert resp.session_uuid == "s1"
    assert resp.scenario["currentScenarioId"] == "1"
    assert resp.ai_generation_uuid == "aigen_1"


async def test_empty_scenarios_refunds_502():
    body = GenerateScenarioRequest(org_id=5, prompt="p")
    empty = {"title": "T", "currentScenarioId": "", "scenarios": []}
    with patch.object(sc, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(sc, "enforce_ai_rate_limit"), \
         patch.object(sc, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(sc, "resolve_model_for_org", new=AsyncMock(return_value="m")), \
         patch.object(sc, "generate_scenario", new=AsyncMock(return_value=(empty, "s1"))), \
         patch.object(sc, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as exc:
            await sc.api_generate_scenario(body, _user(), _db_returning(_org()))
    assert exc.value.status_code == 502
    refund.assert_called_once()


async def test_not_configured_refunds_403():
    body = GenerateScenarioRequest(org_id=5, prompt="p")
    with patch.object(sc, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(sc, "enforce_ai_rate_limit"), \
         patch.object(sc, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(sc, "resolve_model_for_org", new=AsyncMock(return_value="m")), \
         patch.object(sc, "generate_scenario", new=AsyncMock(side_effect=AINotConfiguredError("no key"))), \
         patch.object(sc, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as exc:
            await sc.api_generate_scenario(body, _user(), _db_returning(_org()))
    assert exc.value.status_code == 403
    refund.assert_called_once()


async def test_history_and_delete():
    row = SimpleNamespace(ai_generation_uuid="aigen_1", session_uuid="s1", prompt="p", result=_BLOCK, creation_date="d")
    with patch.object(sc, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(sc, "list_generations", new=AsyncMock(return_value=[row])):
        items = await sc.api_list_scenario_history(5, 30, 0, _user(), _db_returning(_org()))
    assert items[0].scenario["title"] == "T"

    with patch.object(sc, "delete_generation", new=AsyncMock(return_value=True)):
        assert (await sc.api_delete_scenario_history("aigen_1", _user(), AsyncMock()))["detail"] == "deleted"
    with patch.object(sc, "delete_generation", new=AsyncMock(return_value=False)):
        with pytest.raises(HTTPException) as exc:
            await sc.api_delete_scenario_history("x", _user(), AsyncMock())
    assert exc.value.status_code == 404
