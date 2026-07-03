"""Tests for src/services/ai/quiz.py (AI editor quiz generation)."""

from unittest.mock import AsyncMock, patch

import pytest

import src.services.ai.quiz as quizsvc
from src.services.ai.schemas.quiz import GeneratedQuiz, GenQuizAnswer, GenQuizQuestion

pytestmark = pytest.mark.asyncio


def _generated():
    return GeneratedQuiz(
        questions=[
            GenQuizQuestion(
                question="2+2?",
                type="multiple_choice",
                answers=[GenQuizAnswer(answer="3", correct=False), GenQuizAnswer(answer="4", correct=True)],
            )
        ]
    )


def test_to_block_quiz_stamps_ids():
    bq = quizsvc._to_block_quiz(_generated())
    assert bq["quizId"].startswith("quiz_")
    q = bq["questions"][0]
    assert q["question_id"].startswith("question_")
    assert q["answers"][1]["answer_id"].startswith("answer_")
    assert q["answers"][1]["correct"] is True


def test_build_prompt_includes_difficulty_and_context():
    p = quizsvc._build_prompt("photosynthesis", 3, "hard", "leaf content")
    assert "3 quiz question" in p and "hard" in p and "leaf content" in p


async def test_generate_quiz_happy_path_with_grounding():
    with patch.object(quizsvc, "get_chat_session_history", return_value={"aichat_uuid": "s1", "message_history": []}), \
         patch.object(quizsvc, "extract_text_from_prosemirror", return_value="grounded text"), \
         patch.object(quizsvc, "generate", new=AsyncMock(return_value=_generated())), \
         patch.object(quizsvc, "save_message_to_history") as save:
        block_quiz, session_uuid = await quizsvc.generate_quiz(
            org_id=1,
            prompt="make a quiz",
            model_name="m",
            activity_content={"type": "doc"},
            num_questions=5,
        )
    assert session_uuid == "s1"
    assert len(block_quiz["questions"]) == 1
    save.assert_called_once()


async def test_generate_quiz_clamps_question_count():
    captured = {}

    async def fake_generate(**kwargs):
        captured["prompt"] = kwargs["user_prompt"]
        return _generated()

    with patch.object(quizsvc, "get_chat_session_history", return_value={"aichat_uuid": "s1", "message_history": []}), \
         patch.object(quizsvc, "generate", new=fake_generate), \
         patch.object(quizsvc, "save_message_to_history"):
        await quizsvc.generate_quiz(org_id=1, prompt="p", model_name="m", num_questions=999)
    assert f"{quizsvc.MAX_QUESTIONS} quiz question" in captured["prompt"]


async def test_generate_quiz_extraction_failure_is_tolerated():
    with patch.object(quizsvc, "get_chat_session_history", return_value={"aichat_uuid": "s1", "message_history": []}), \
         patch.object(quizsvc, "extract_text_from_prosemirror", side_effect=Exception("bad content")), \
         patch.object(quizsvc, "generate", new=AsyncMock(return_value=_generated())), \
         patch.object(quizsvc, "save_message_to_history"):
        block_quiz, _ = await quizsvc.generate_quiz(
            org_id=1, prompt="p", model_name="m", activity_content={"x": 1}
        )
    assert block_quiz["questions"]


async def test_generate_quiz_save_failure_is_swallowed():
    with patch.object(quizsvc, "get_chat_session_history", return_value={"aichat_uuid": "s1", "message_history": []}), \
         patch.object(quizsvc, "generate", new=AsyncMock(return_value=_generated())), \
         patch.object(quizsvc, "save_message_to_history", side_effect=Exception("redis down")):
        block_quiz, _ = await quizsvc.generate_quiz(org_id=1, prompt="p", model_name="m")
    assert block_quiz["questions"]
