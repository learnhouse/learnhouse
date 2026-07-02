"""Behavioral tests for src/routers/ai/assignment_gen.py."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.routers.ai import assignment_gen as ag
from src.services.ai.llm import AINotConfiguredError
from src.services.ai.schemas.assignment import (
    GeneratedAssignmentPlan,
    GeneratedTask,
    GenerateAssignmentRequest,
)

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


def _course(id=7, org_id=5):
    return SimpleNamespace(id=id, org_id=org_id, course_uuid="course_1")


def _user(id=1):
    return SimpleNamespace(id=id)


def _plan():
    return GeneratedAssignmentPlan(
        title="A", description="d", grading_type="PERCENTAGE",
        tasks=[GeneratedTask(title="t", description="d", assignment_type="SHORT_ANSWER",
                             contents={"prompt": "p", "correct_answers": ["a"], "match_mode": "case_insensitive"})],
    )


def _req():
    return GenerateAssignmentRequest(org_id=5, course_uuid="course_1", prompt="make it")


async def test_empty_prompt_400():
    body = GenerateAssignmentRequest(org_id=5, course_uuid="course_1", prompt="  ")
    with pytest.raises(HTTPException) as exc:
        await ag.api_generate_assignment(body, _user(), _db_returning(_org()))
    assert exc.value.status_code == 400


async def test_org_not_found_404():
    with pytest.raises(HTTPException) as exc:
        await ag.api_generate_assignment(_req(), _user(), _db_returning(None))
    assert exc.value.status_code == 404


async def test_non_member_403():
    with patch.object(ag, "is_org_member", new=AsyncMock(return_value=False)):
        with pytest.raises(HTTPException) as exc:
            await ag.api_generate_assignment(_req(), _user(), _db_returning(_org()))
    assert exc.value.status_code == 403


async def test_course_not_found_404():
    with patch.object(ag, "is_org_member", new=AsyncMock(return_value=True)):
        with pytest.raises(HTTPException) as exc:
            await ag.api_generate_assignment(_req(), _user(), _db_returning(_org(), None))
    assert exc.value.status_code == 404


async def test_course_wrong_org_404():
    with patch.object(ag, "is_org_member", new=AsyncMock(return_value=True)):
        with pytest.raises(HTTPException) as exc:
            await ag.api_generate_assignment(_req(), _user(), _db_returning(_org(), _course(org_id=999)))
    assert exc.value.status_code == 404


async def test_happy_path():
    record = SimpleNamespace(ai_generation_uuid="aigen_1")
    rec = AsyncMock(return_value=record)
    with patch.object(ag, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(ag, "enforce_ai_rate_limit"), \
         patch.object(ag, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(ag, "resolve_model_for_org", new=AsyncMock(return_value="m")), \
         patch.object(ag, "generate_assignment_plan", new=AsyncMock(return_value=(_plan(), "s1"))), \
         patch.object(ag, "record_generation", new=rec):
        resp = await ag.api_generate_assignment(_req(), _user(), _db_returning(_org(), _course()))
    assert resp.session_uuid == "s1"
    assert resp.plan.tasks[0].assignment_type == "SHORT_ANSWER"
    assert rec.await_args.kwargs["course_id"] == 7


async def test_no_tasks_refunds_and_502():
    empty = GeneratedAssignmentPlan(title="A", description="d", grading_type="PERCENTAGE", tasks=[])
    with patch.object(ag, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(ag, "enforce_ai_rate_limit"), \
         patch.object(ag, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(ag, "resolve_model_for_org", new=AsyncMock(return_value="m")), \
         patch.object(ag, "generate_assignment_plan", new=AsyncMock(return_value=(empty, "s1"))), \
         patch.object(ag, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as exc:
            await ag.api_generate_assignment(_req(), _user(), _db_returning(_org(), _course()))
    assert exc.value.status_code == 502
    refund.assert_called_once()


async def test_not_configured_refunds_and_403():
    with patch.object(ag, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(ag, "enforce_ai_rate_limit"), \
         patch.object(ag, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(ag, "resolve_model_for_org", new=AsyncMock(return_value="m")), \
         patch.object(ag, "generate_assignment_plan", new=AsyncMock(side_effect=AINotConfiguredError("no key"))), \
         patch.object(ag, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as exc:
            await ag.api_generate_assignment(_req(), _user(), _db_returning(_org(), _course()))
    assert exc.value.status_code == 403
    refund.assert_called_once()


async def test_generation_error_refunds_and_502():
    with patch.object(ag, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(ag, "enforce_ai_rate_limit"), \
         patch.object(ag, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(ag, "resolve_model_for_org", new=AsyncMock(return_value="m")), \
         patch.object(ag, "generate_assignment_plan", new=AsyncMock(side_effect=RuntimeError("boom"))), \
         patch.object(ag, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as exc:
            await ag.api_generate_assignment(_req(), _user(), _db_returning(_org(), _course()))
    assert exc.value.status_code == 502
    refund.assert_called_once()


async def test_history_and_delete():
    row = SimpleNamespace(ai_generation_uuid="aigen_1", session_uuid="s1", prompt="p",
                          result={"title": "A", "tasks": []}, creation_date="d")
    with patch.object(ag, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(ag, "list_generations", new=AsyncMock(return_value=[row])):
        items = await ag.api_list_assignment_history(5, 30, 0, _user(), _db_returning(_org()))
    assert items[0].plan["title"] == "A"

    with patch.object(ag, "delete_generation", new=AsyncMock(return_value=True)):
        assert (await ag.api_delete_assignment_history("aigen_1", _user(), AsyncMock()))["detail"] == "deleted"
    with patch.object(ag, "delete_generation", new=AsyncMock(return_value=False)):
        with pytest.raises(HTTPException) as exc:
            await ag.api_delete_assignment_history("x", _user(), AsyncMock())
    assert exc.value.status_code == 404
