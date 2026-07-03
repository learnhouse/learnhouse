"""Tests for src/services/ai/scenario.py (AI interactive scenario generation)."""

from unittest.mock import AsyncMock, patch

import pytest

import src.services.ai.scenario as scensvc
from src.services.ai.schemas.scenario import (
    GeneratedScenarioSet,
    GenScenario,
    GenScenarioOption,
)

pytestmark = pytest.mark.asyncio


def _generated():
    return GeneratedScenarioSet(
        title="Fire Safety",
        scenarios=[
            GenScenario(ref="start", text="Alarm rings.", options=[
                GenScenarioOption(text="Evacuate", next_ref="evac"),
                GenScenarioOption(text="Investigate", next_ref="invest"),
            ]),
            GenScenario(ref="evac", text="You evacuate.", options=[
                GenScenarioOption(text="Finish", next_ref=None),
            ]),
            GenScenario(ref="invest", text="You find smoke.", options=[
                GenScenarioOption(text="Now evacuate", next_ref="evac"),
            ]),
        ],
    )


def test_to_block_resolves_refs_and_entry():
    b = scensvc._to_block_scenario(_generated())
    assert b["title"] == "Fire Safety"
    assert b["currentScenarioId"] == "1"  # 'start' -> id 1
    assert [o["nextScenarioId"] for o in b["scenarios"][0]["options"]] == ["2", "3"]
    assert b["scenarios"][1]["options"][0]["nextScenarioId"] is None  # ending
    # every option carries an id + the block shape fields
    opt = b["scenarios"][0]["options"][0]
    assert set(opt) == {"id", "text", "nextScenarioId"}
    assert all("imageUrl" in s for s in b["scenarios"])


def test_to_block_empty():
    b = scensvc._to_block_scenario(GeneratedScenarioSet(title="X", scenarios=[]))
    assert b["scenarios"] == [] and b["currentScenarioId"] == ""


def test_to_block_unknown_next_ref_becomes_none():
    g = GeneratedScenarioSet(title="T", scenarios=[
        GenScenario(ref="start", text="hi", options=[GenScenarioOption(text="go", next_ref="missing")]),
    ])
    b = scensvc._to_block_scenario(g)
    assert b["scenarios"][0]["options"][0]["nextScenarioId"] is None


async def test_generate_scenario_happy_path():
    with patch.object(scensvc, "get_chat_session_history", return_value={"aichat_uuid": "s1", "message_history": []}), \
         patch.object(scensvc, "extract_text_from_prosemirror", return_value="ground"), \
         patch.object(scensvc, "generate", new=AsyncMock(return_value=_generated())), \
         patch.object(scensvc, "save_message_to_history") as save:
        block, session_uuid = await scensvc.generate_scenario(
            org_id=1, prompt="fire drill", model_name="m", activity_content={"type": "doc"}, num_scenarios=5,
        )
    assert session_uuid == "s1"
    assert len(block["scenarios"]) == 3
    save.assert_called_once()


async def test_generate_scenario_clamps_and_tolerates_extract_failure():
    with patch.object(scensvc, "get_chat_session_history", return_value={"aichat_uuid": "s1", "message_history": []}), \
         patch.object(scensvc, "extract_text_from_prosemirror", side_effect=Exception("bad")), \
         patch.object(scensvc, "generate", new=AsyncMock(return_value=_generated())), \
         patch.object(scensvc, "save_message_to_history"):
        block, _ = await scensvc.generate_scenario(
            org_id=1, prompt="p", model_name="m", activity_content={"x": 1}, num_scenarios=999,
        )
    assert block["scenarios"]
