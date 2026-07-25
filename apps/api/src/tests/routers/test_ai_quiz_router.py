"""Behavioral tests for src/routers/ai/quiz.py."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.routers.ai import quiz as qz
from src.services.ai.llm import AINotConfiguredError
from src.services.ai.schemas.quiz import GenerateQuizRequest

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


def _http_req():
    return MagicMock()


@pytest.fixture(autouse=True)
def _allow_rbac():
    with patch.object(qz, "check_resource_access", new=AsyncMock()):
        yield


_QUIZ = {"quizId": "quiz_1", "questions": [{"question_id": "q1", "question": "?", "type": "multiple_choice", "answers": []}]}


async def test_empty_prompt_400():
    with pytest.raises(HTTPException) as exc:
        await qz.api_generate_quiz(GenerateQuizRequest(org_id=5, prompt=" "), _http_req(), _user(), _db_returning(_org()))
    assert exc.value.status_code == 400


async def test_org_not_found_404():
    with pytest.raises(HTTPException) as exc:
        await qz.api_generate_quiz(GenerateQuizRequest(org_id=5, prompt="p"), _http_req(), _user(), _db_returning(None))
    assert exc.value.status_code == 404


async def test_non_member_403():
    with patch.object(qz, "is_org_member", new=AsyncMock(return_value=False)):
        with pytest.raises(HTTPException) as exc:
            await qz.api_generate_quiz(GenerateQuizRequest(org_id=5, prompt="p"), _http_req(), _user(), _db_returning(_org()))
    assert exc.value.status_code == 403


async def test_happy_path_no_activity():
    body = GenerateQuizRequest(org_id=5, prompt="make a quiz")
    record = SimpleNamespace(ai_generation_uuid="aigen_1")
    with patch.object(qz, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(qz, "enforce_ai_rate_limit"), \
         patch.object(qz, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(qz, "resolve_model_for_org", new=AsyncMock(return_value="m")), \
         patch.object(qz, "generate_quiz", new=AsyncMock(return_value=(_QUIZ, "s1"))), \
         patch.object(qz, "record_generation", new=AsyncMock(return_value=record)):
        resp = await qz.api_generate_quiz(body, _http_req(), _user(), _db_returning(_org()))
    assert resp.session_uuid == "s1"
    assert resp.quiz["quizId"] == "quiz_1"
    assert resp.ai_generation_uuid == "aigen_1"


async def test_happy_path_with_activity_grounding():
    body = GenerateQuizRequest(org_id=5, prompt="p", activity_uuid="act_1")
    activity = SimpleNamespace(content={"type": "doc"}, id=9, course_id=3)
    course = SimpleNamespace(id=3, org_id=5, course_uuid="course_1")
    record = SimpleNamespace(ai_generation_uuid="aigen_2")
    rec = AsyncMock(return_value=record)
    with patch.object(qz, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(qz, "enforce_ai_rate_limit"), \
         patch.object(qz, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(qz, "resolve_model_for_org", new=AsyncMock(return_value="m")), \
         patch.object(qz, "generate_quiz", new=AsyncMock(return_value=(_QUIZ, "s1"))), \
         patch.object(qz, "record_generation", new=rec):
        await qz.api_generate_quiz(body, _http_req(), _user(), _db_returning(_org(), activity, course))
    assert rec.await_args.kwargs["activity_id"] == 9


async def test_activity_grounding_denied_by_rbac():
    # Grounding on an activity the user has no author rights on must be blocked
    # (check_resource_access raises 403) before any credits are spent.
    body = GenerateQuizRequest(org_id=5, prompt="p", activity_uuid="act_1")
    activity = SimpleNamespace(content={"type": "doc"}, id=9, course_id=3)
    course = SimpleNamespace(id=3, org_id=5, course_uuid="course_1")
    reserve = AsyncMock()
    with patch.object(qz, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(qz, "check_resource_access",
                      new=AsyncMock(side_effect=HTTPException(status_code=403, detail="denied"))), \
         patch.object(qz, "reserve_ai_credit", new=reserve):
        with pytest.raises(HTTPException) as exc:
            await qz.api_generate_quiz(body, _http_req(), _user(), _db_returning(_org(), activity, course))
    assert exc.value.status_code == 403
    reserve.assert_not_called()


async def test_activity_missing_grounding_skipped():
    body = GenerateQuizRequest(org_id=5, prompt="p", activity_uuid="act_missing")
    record = SimpleNamespace(ai_generation_uuid="aigen_3")
    with patch.object(qz, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(qz, "enforce_ai_rate_limit"), \
         patch.object(qz, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(qz, "resolve_model_for_org", new=AsyncMock(return_value="m")), \
         patch.object(qz, "generate_quiz", new=AsyncMock(return_value=(_QUIZ, "s1"))), \
         patch.object(qz, "record_generation", new=AsyncMock(return_value=record)):
        # org, then activity None
        resp = await qz.api_generate_quiz(body, _http_req(), _user(), _db_returning(_org(), None))
    assert resp.quiz["quizId"] == "quiz_1"


async def test_empty_quiz_refunds_and_502():
    body = GenerateQuizRequest(org_id=5, prompt="p")
    with patch.object(qz, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(qz, "enforce_ai_rate_limit"), \
         patch.object(qz, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(qz, "resolve_model_for_org", new=AsyncMock(return_value="m")), \
         patch.object(qz, "generate_quiz", new=AsyncMock(return_value=({"quizId": "q", "questions": []}, "s1"))), \
         patch.object(qz, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as exc:
            await qz.api_generate_quiz(body, _http_req(), _user(), _db_returning(_org()))
    assert exc.value.status_code == 502
    refund.assert_called_once()


async def test_not_configured_refunds_and_403():
    body = GenerateQuizRequest(org_id=5, prompt="p")
    with patch.object(qz, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(qz, "enforce_ai_rate_limit"), \
         patch.object(qz, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(qz, "resolve_model_for_org", new=AsyncMock(return_value="m")), \
         patch.object(qz, "generate_quiz", new=AsyncMock(side_effect=AINotConfiguredError("no key"))), \
         patch.object(qz, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as exc:
            await qz.api_generate_quiz(body, _http_req(), _user(), _db_returning(_org()))
    assert exc.value.status_code == 403
    refund.assert_called_once()


async def test_generation_error_refunds_and_502():
    body = GenerateQuizRequest(org_id=5, prompt="p")
    with patch.object(qz, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(qz, "enforce_ai_rate_limit"), \
         patch.object(qz, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(qz, "resolve_model_for_org", new=AsyncMock(return_value="m")), \
         patch.object(qz, "generate_quiz", new=AsyncMock(side_effect=RuntimeError("boom"))), \
         patch.object(qz, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as exc:
            await qz.api_generate_quiz(body, _http_req(), _user(), _db_returning(_org()))
    assert exc.value.status_code == 502
    refund.assert_called_once()


async def test_history_and_delete():
    row = SimpleNamespace(ai_generation_uuid="aigen_1", session_uuid="s1", prompt="p", result=_QUIZ, creation_date="d")
    with patch.object(qz, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(qz, "list_generations", new=AsyncMock(return_value=[row])):
        items = await qz.api_list_quiz_history(5, 30, 0, _user(), _db_returning(_org()))
    assert items[0].quiz["quizId"] == "quiz_1"

    with patch.object(qz, "delete_generation", new=AsyncMock(return_value=True)):
        assert (await qz.api_delete_quiz_history("aigen_1", _user(), AsyncMock()))["detail"] == "deleted"
    with patch.object(qz, "delete_generation", new=AsyncMock(return_value=False)):
        with pytest.raises(HTTPException) as exc:
            await qz.api_delete_quiz_history("x", _user(), AsyncMock())
    assert exc.value.status_code == 404


@pytest.fixture(autouse=True)
def _skip_org_mfa_policy():
    """No-op the org two-factor policy for this module.

    These tests drive the router with a hand-rolled session whose `execute`
    returns a fixed, ordered list of results. The policy check issues its own
    queries, which would consume entries from that list and desynchronise every
    subsequent lookup. The policy itself is covered directly in
    src/tests/security/test_mfa_org_policy.py.
    """
    with patch.object(qz, "enforce_org_mfa", new=AsyncMock(return_value=None)):
        yield
