"""The AI grading routes are thin wrappers over the service; check each passes
its arguments through, and the rubric validators on the assignment models."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from src.db.courses.assignment_ai_grades import AssignmentAIGradeAccept
from src.db.courses.assignments import (
    MAX_AI_GRADING_INSTRUCTIONS_CHARS,
    MAX_AI_GRADING_TASK_INSTRUCTION_CHARS,
    AssignmentCreate,
    AssignmentUpdate,
)
from src.routers.courses import assignments as router_mod

pytestmark = pytest.mark.asyncio


async def test_routes_delegate_to_the_service():
    req, user, db = MagicMock(), MagicMock(), MagicMock()
    body = AssignmentAIGradeAccept(overall_feedback="x")
    with patch.object(router_mod, "estimate_ai_grading", new=AsyncMock(return_value={"credits": 3})) as est, \
         patch.object(router_mod, "bulk_ai_grade", new=AsyncMock(return_value={"graded": 1})) as bulk, \
         patch.object(router_mod, "run_ai_grading", new=AsyncMock(return_value="run")) as run, \
         patch.object(router_mod, "get_ai_grade", new=AsyncMock(return_value=None)) as get, \
         patch.object(router_mod, "accept_ai_grade", new=AsyncMock(return_value={"ok": 1})) as acc, \
         patch.object(router_mod, "discard_ai_grade", new=AsyncMock(return_value={"detail": "discarded"})) as dis:
        assert await router_mod.api_estimate_ai_grading(req, "assignment_a", 5, user, db) == {"credits": 3}
        est.assert_awaited_once_with(req, "assignment_a", user, db, user_id=5)
        assert await router_mod.api_bulk_ai_grade(req, "assignment_a", 3, user, db) == {"graded": 1}
        bulk.assert_awaited_once_with(req, "assignment_a", user, db, limit=3)
        assert await router_mod.api_run_ai_grade(req, "assignment_a", 7, user, db) == "run"
        run.assert_awaited_once_with(req, "assignment_a", 7, user, db)
        assert await router_mod.api_read_ai_grade(req, "assignment_a", 7, user, db) is None
        get.assert_awaited_once_with(req, "assignment_a", 7, user, db)
        assert await router_mod.api_accept_ai_grade(req, "assignment_a", 7, body, user, db) == {"ok": 1}
        acc.assert_awaited_once_with(req, "assignment_a", 7, body, user, db)
        assert await router_mod.api_discard_ai_grade(req, "assignment_a", 7, user, db) == {"detail": "discarded"}
        dis.assert_awaited_once_with(req, "assignment_a", 7, user, db)


async def test_rubric_validators():
    assert AssignmentUpdate(ai_grading_instructions="ok").ai_grading_instructions == "ok"
    with pytest.raises(ValidationError):
        AssignmentUpdate(ai_grading_instructions="x" * (MAX_AI_GRADING_INSTRUCTIONS_CHARS + 1))
    cleaned = AssignmentUpdate(ai_grading_task_instructions={"t1": "needs TTL", "t2": "  "})
    assert cleaned.ai_grading_task_instructions == {"t1": "needs TTL"}
    assert AssignmentUpdate(ai_grading_task_instructions=None).ai_grading_task_instructions is None
    for bad in ({"t": 1}, {f"t{i}": "x" for i in range(201)}, {"t": "x" * (MAX_AI_GRADING_TASK_INSTRUCTION_CHARS + 1)}):
        with pytest.raises(ValidationError):
            AssignmentUpdate(ai_grading_task_instructions=bad)
    with pytest.raises(ValidationError):
        AssignmentUpdate(ai_grading_task_instructions=["not", "a", "dict"])
    created = AssignmentCreate(
        title="t", description="d", grading_type="NUMERIC", org_id=1, course_id=1, chapter_id=1, activity_id=1,
        ai_grading_task_instructions={"t": "x"},
    )
    assert created.ai_grading_mode.value == "SUGGEST" and created.ai_grading_task_instructions == {"t": "x"}
