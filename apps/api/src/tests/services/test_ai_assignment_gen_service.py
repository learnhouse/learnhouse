"""Tests for src/services/ai/assignment_gen.py (AI assignment generation)."""

from unittest.mock import AsyncMock, patch

import pytest

import src.services.ai.assignment_gen as ag
from src.services.ai.schemas.assignment import (
    AIAssignmentPlan,
    AIFormBlank,
    AIFormContents,
    AIFormQuestion,
    AINumberAnswerContents,
    AIQuizContents,
    AIQuizOption,
    AIQuizQuestion,
    AIShortAnswerContents,
    AITask,
)

pytestmark = pytest.mark.asyncio


# --- contents builders ---

def test_quiz_contents_shape():
    t = AITask(
        title="t", description="d", assignment_type="QUIZ",
        quiz=AIQuizContents(questions=[AIQuizQuestion(question_text="Q", options=[
            AIQuizOption(text="A", is_correct=True), AIQuizOption(text="B", is_correct=False)])]),
    )
    gt = ag._to_generated_task(t)
    opt = gt.contents["questions"][0]["options"][0]
    assert set(opt) == {"optionUUID", "text", "fileID", "type", "assigned_right_answer"}
    assert opt["assigned_right_answer"] is True and opt["type"] == "text"
    assert gt.max_grade_value == 100


def test_form_contents_shape():
    t = AITask(title="t", description="d", assignment_type="FORM",
               form=AIFormContents(questions=[AIFormQuestion(question_text="F", blanks=[
                   AIFormBlank(placeholder="__", correct_answer="x", hint="h")])]))
    b = ag._to_generated_task(t).contents["questions"][0]["blanks"][0]
    assert b["blankUUID"].startswith("blank_") and b["correctAnswer"] == "x" and b["hint"] == "h"


def test_short_answer_contents_shape():
    t = AITask(title="t", description="d", assignment_type="SHORT_ANSWER",
               short_answer=AIShortAnswerContents(prompt="P", correct_answers=["a"], match_mode="contains", explanation="e"))
    c = ag._to_generated_task(t).contents
    assert c == {"prompt": "P", "correct_answers": ["a"], "match_mode": "contains", "explanation": "e"}


def test_number_answer_contents_shape():
    t = AITask(title="t", description="d", assignment_type="NUMBER_ANSWER",
               number_answer=AINumberAnswerContents(prompt="P", correct_value=3.5, tolerance=0.1, unit="m"))
    c = ag._to_generated_task(t).contents
    assert c["correct_value"] == 3.5 and c["tolerance"] == 0.1 and c["unit"] == "m"


def test_file_submission_contents_empty():
    t = AITask(title="t", description="d", assignment_type="FILE_SUBMISSION")
    assert ag._to_generated_task(t).contents == {}


def test_builders_default_when_subobject_missing():
    # assignment_type says QUIZ but no quiz payload -> empty questions
    assert ag._quiz_contents(AITask(title="t", description="d", assignment_type="QUIZ")) == {"questions": []}
    assert ag._form_contents(AITask(title="t", description="d", assignment_type="FORM")) == {"questions": []}
    sa = ag._short_answer_contents(AITask(title="t", description="d", assignment_type="SHORT_ANSWER"))
    assert sa["correct_answers"] == []
    na = ag._number_answer_contents(AITask(title="t", description="d", assignment_type="NUMBER_ANSWER"))
    assert na["correct_value"] == 0


# --- _course_context ---

async def test_course_context_joins_chunks():
    chunks = [
        {"text": "content one", "chapter_name": "Ch1", "activity_name": "A1"},
        {"text": "", "chapter_name": "Ch1", "activity_name": "A2"},  # skipped
    ]
    with patch.object(ag, "extract_all_course_content", new=AsyncMock(return_value=chunks)):
        ctx = await ag._course_context(1, 1, AsyncMock())
    assert "content one" in ctx and "A1" in ctx


async def test_course_context_extraction_failure_returns_empty():
    with patch.object(ag, "extract_all_course_content", new=AsyncMock(side_effect=Exception("boom"))):
        ctx = await ag._course_context(1, 1, AsyncMock())
    assert ctx == ""


# --- generate_assignment_plan ---

def _plan():
    return AIAssignmentPlan(
        title="Quiz Assignment", description="desc", grading_type="PERCENTAGE",
        tasks=[
            AITask(title="t1", description="d1", assignment_type="SHORT_ANSWER",
                   short_answer=AIShortAnswerContents(prompt="P", correct_answers=["a"])),
            AITask(title="t2", description="d2", assignment_type="QUIZ",
                   quiz=AIQuizContents(questions=[AIQuizQuestion(question_text="Q", options=[
                       AIQuizOption(text="A", is_correct=True)])])),
        ],
    )


async def test_generate_assignment_plan_filters_disallowed_types():
    with patch.object(ag, "_course_context", new=AsyncMock(return_value="ctx")), \
         patch.object(ag, "get_chat_session_history", return_value={"aichat_uuid": "s1", "message_history": []}), \
         patch.object(ag, "generate", new=AsyncMock(return_value=_plan())), \
         patch.object(ag, "save_message_to_history") as save:
        # Only SHORT_ANSWER allowed -> the QUIZ task is filtered out.
        plan, session_uuid = await ag.generate_assignment_plan(
            org_id=1, course_id=2, prompt="p", model_name="m", db_session=AsyncMock(),
            num_tasks=2, allowed_task_types=["SHORT_ANSWER"],
        )
    assert session_uuid == "s1"
    assert [t.assignment_type for t in plan.tasks] == ["SHORT_ANSWER"]
    assert plan.title == "Quiz Assignment"
    save.assert_called_once()


async def test_generate_assignment_plan_caps_tasks_to_requested_count():
    # An over-producing model must not create more tasks than requested.
    def _two():
        return AIAssignmentPlan(
            title="A", description="d", grading_type="PERCENTAGE",
            tasks=[
                AITask(title="t1", description="d1", assignment_type="SHORT_ANSWER",
                       short_answer=AIShortAnswerContents(prompt="P", correct_answers=["a"])),
                AITask(title="t2", description="d2", assignment_type="SHORT_ANSWER",
                       short_answer=AIShortAnswerContents(prompt="P2", correct_answers=["b"])),
            ],
        )
    with patch.object(ag, "_course_context", new=AsyncMock(return_value="ctx")), \
         patch.object(ag, "get_chat_session_history", return_value={"aichat_uuid": "s1", "message_history": []}), \
         patch.object(ag, "generate", new=AsyncMock(return_value=_two())), \
         patch.object(ag, "save_message_to_history"):
        plan, _ = await ag.generate_assignment_plan(
            org_id=1, course_id=2, prompt="p", model_name="m", db_session=AsyncMock(),
            num_tasks=1, allowed_task_types=["SHORT_ANSWER"],
        )
    assert len(plan.tasks) == 1


async def test_generate_assignment_plan_clamps_num_tasks():
    captured = {}

    async def fake_generate(**kwargs):
        captured["prompt"] = kwargs["user_prompt"]
        return _plan()

    with patch.object(ag, "_course_context", new=AsyncMock(return_value="ctx")), \
         patch.object(ag, "get_chat_session_history", return_value={"aichat_uuid": "s1", "message_history": []}), \
         patch.object(ag, "generate", new=fake_generate), \
         patch.object(ag, "save_message_to_history"):
        await ag.generate_assignment_plan(
            org_id=1, course_id=2, prompt="p", model_name="m", db_session=AsyncMock(), num_tasks=999,
        )
    assert f"exactly {ag.MAX_TASKS} task" in captured["prompt"]


# --- answer-key validation (M13) ---

def _quiz_task(*correct_flags):
    return ag._to_generated_task(
        AITask(title="t", description="d", assignment_type="QUIZ",
               quiz=AIQuizContents(questions=[AIQuizQuestion(
                   question_text="Q",
                   options=[AIQuizOption(text=f"o{i}", is_correct=c) for i, c in enumerate(correct_flags)])])))


def test_valid_answer_key_quiz_needs_a_correct_option():
    assert ag._has_valid_answer_key(_quiz_task(True, False)) is True
    # No correct option -> not auto-scorable.
    assert ag._has_valid_answer_key(_quiz_task(False, False)) is False


def test_valid_answer_key_short_answer_needs_nonempty():
    good = ag._to_generated_task(AITask(title="t", description="d", assignment_type="SHORT_ANSWER",
        short_answer=AIShortAnswerContents(prompt="P", correct_answers=["a"])))
    empty = ag._to_generated_task(AITask(title="t", description="d", assignment_type="SHORT_ANSWER",
        short_answer=AIShortAnswerContents(prompt="P", correct_answers=["   "])))
    assert ag._has_valid_answer_key(good) is True
    assert ag._has_valid_answer_key(empty) is False


def test_valid_answer_key_form_needs_a_filled_blank():
    good = ag._to_generated_task(AITask(title="t", description="d", assignment_type="FORM",
        form=AIFormContents(questions=[AIFormQuestion(question_text="F",
            blanks=[AIFormBlank(placeholder="_", correct_answer="x")])])))
    empty = ag._to_generated_task(AITask(title="t", description="d", assignment_type="FORM",
        form=AIFormContents(questions=[AIFormQuestion(question_text="F",
            blanks=[AIFormBlank(placeholder="_", correct_answer=" ")])])))
    assert ag._has_valid_answer_key(good) is True
    assert ag._has_valid_answer_key(empty) is False


def test_valid_answer_key_file_submission_always_kept():
    assert ag._has_valid_answer_key(
        ag._to_generated_task(AITask(title="t", description="d", assignment_type="FILE_SUBMISSION"))
    ) is True


async def test_generate_assignment_plan_drops_quiz_without_correct_option():
    bad_plan = AIAssignmentPlan(
        title="A", description="d", grading_type="PERCENTAGE",
        tasks=[
            AITask(title="ok", description="d", assignment_type="SHORT_ANSWER",
                   short_answer=AIShortAnswerContents(prompt="P", correct_answers=["a"])),
            AITask(title="bad", description="d", assignment_type="QUIZ",
                   quiz=AIQuizContents(questions=[AIQuizQuestion(question_text="Q", options=[
                       AIQuizOption(text="A", is_correct=False),
                       AIQuizOption(text="B", is_correct=False)])])),
        ],
    )
    with patch.object(ag, "_course_context", new=AsyncMock(return_value="ctx")), \
         patch.object(ag, "get_chat_session_history", return_value={"aichat_uuid": "s1", "message_history": []}), \
         patch.object(ag, "generate", new=AsyncMock(return_value=bad_plan)), \
         patch.object(ag, "save_message_to_history"):
        plan, _ = await ag.generate_assignment_plan(
            org_id=1, course_id=2, prompt="p", model_name="m", db_session=AsyncMock(),
        )
    # The keyless QUIZ is dropped; the valid SHORT_ANSWER survives.
    assert [t.assignment_type for t in plan.tasks] == ["SHORT_ANSWER"]
