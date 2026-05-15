"""Unit tests for the Atlas tier guard + ToolSpec parsing.

Pure tests — verify the two invariants the rest of the pipeline depends
on:
  1. apply_* tools are unreachable via the LLM call path.
  2. DESTRUCTIVE propose_* cannot run after another tool in the same turn.
"""

from __future__ import annotations

from src.services.ai.atlas.tiers import (
    ConfirmationChallenge,
    ToolError,
    ToolSpec,
    TurnState,
    classify_error,
    evaluate_guard,
)


def test_tool_spec_from_mcp_meta_defaults():
    spec = ToolSpec.from_mcp_meta("propose_chapter_edit", "", {})
    # Empty meta → conservative defaults (EDIT, requires preview)
    assert spec.tier == "EDIT"
    assert spec.requires_preview is True
    assert spec.is_apply is False


def test_tool_spec_from_mcp_meta_destructive():
    spec = ToolSpec.from_mcp_meta(
        "propose_chapter_delete",
        "",
        {
            "atlas.tier": "DESTRUCTIVE",
            "atlas.is_apply": False,
            "atlas.requires_preview": True,
            "atlas.requires_challenge": True,
        },
    )
    assert spec.tier == "DESTRUCTIVE"
    assert spec.requires_challenge is True


def test_tool_spec_apply_default_from_name():
    spec = ToolSpec.from_mcp_meta("apply_activity_rename", "", {})
    assert spec.is_apply is True


def test_guard_blocks_apply_from_llm():
    spec = ToolSpec(name="apply_activity_rename", tier="EDIT", is_apply=True)
    decision = evaluate_guard(spec, TurnState())
    assert decision.allowed is False
    assert "apply" in (decision.reason or "").lower()


def test_guard_allows_read_first():
    spec = ToolSpec(name="atlas_list_courses", tier="READ")
    state = TurnState()
    decision = evaluate_guard(spec, state)
    assert decision.allowed is True


def test_guard_blocks_destructive_after_any_tool():
    state = TurnState(has_emitted_tools=True, emitted_tool_names=["atlas_list_courses"])
    destr = ToolSpec(name="propose_chapter_delete", tier="DESTRUCTIVE")
    decision = evaluate_guard(destr, state)
    assert decision.allowed is False
    assert "fresh user message" in (decision.reason or "").lower()


def test_guard_allows_destructive_as_first_tool():
    state = TurnState()
    destr = ToolSpec(name="propose_chapter_delete", tier="DESTRUCTIVE")
    decision = evaluate_guard(destr, state)
    assert decision.allowed is True


def test_classify_error_retriable():
    err = ToolError(code="rate_limited", message="slow down", retriable=True)
    assert classify_error(err) == "retriable"


def test_classify_error_user_input():
    err = ToolError(code="not_found", message="missing")
    assert classify_error(err) == "user_input"


def test_classify_error_permission():
    err = ToolError(code="forbidden", message="nope")
    assert classify_error(err) == "permission"


def test_classify_error_fatal_default():
    err = ToolError(code="weird_thing", message="explode")
    assert classify_error(err) == "fatal"


def test_confirmation_challenge_round_trip():
    ch = ConfirmationChallenge(
        pending_id="pend_x",
        action_label="Delete chapter 'Foo'",
        blast_radius_summary="Removes 3 activities.",
        challenge_phrase="Foo",
        challenge_kind="type_name",
    )
    dumped = ch.model_dump()
    re_inflated = ConfirmationChallenge.model_validate(dumped)
    assert re_inflated.challenge_phrase == "Foo"
