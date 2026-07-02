"""AI quiz generation service (in-editor `blockQuiz`).

Uses the provider-agnostic ``generate`` with a strict ``GeneratedQuiz`` output
type so the model result is always schema-valid, then stamps the ids the editor
expects. Multi-turn refinement is supported via the Redis chat session store
(the hybrid model's ephemeral half); durable kept quizzes are recorded via
``record_generation``.
"""

from __future__ import annotations

import json
import logging
from uuid import uuid4

from src.services.ai.base import get_chat_session_history, save_message_to_history
from src.services.ai.llm import generate, model_for_tier
from src.services.ai.rag.content_extraction import extract_text_from_prosemirror
from src.services.ai.schemas.quiz import GeneratedQuiz

logger = logging.getLogger(__name__)

MAX_QUESTIONS = 20
MAX_CONTEXT_CHARS = 6000

_SYSTEM_PROMPT = """You are an expert instructional designer creating quiz questions for a course.

Rules:
- Produce clear, unambiguous multiple-choice questions at the requested difficulty.
- Each question has 3-5 answer options; mark exactly the correct one(s) correct.
  At least one option MUST be correct.
- Write in the same language as the user's request/content.
- Base questions strictly on the provided course content when it is supplied;
  do not invent facts that contradict it.
- Return ONLY the structured quiz — no commentary."""


def _build_prompt(prompt: str, num_questions: int, difficulty: str | None, context: str) -> str:
    parts = [f"Create {num_questions} quiz question(s)."]
    if difficulty:
        parts.append(f"Difficulty: {difficulty}.")
    parts.append(f"Topic / instructions: {prompt.strip()}")
    if context:
        parts.append(f"\nCourse content to base the quiz on:\n{context[:MAX_CONTEXT_CHARS]}")
    return "\n".join(parts)


def _to_block_quiz(generated: GeneratedQuiz) -> dict:
    """Stamp the ids the editor `blockQuiz` node expects."""
    questions = []
    for q in generated.questions:
        answers = [
            {
                "answer_id": f"answer_{uuid4()}",
                "answer": a.answer,
                "correct": bool(a.correct),
            }
            for a in q.answers
        ]
        questions.append(
            {
                "question_id": f"question_{uuid4()}",
                "question": q.question,
                "type": q.type,
                "answers": answers,
            }
        )
    return {"quizId": f"quiz_{uuid4()}", "questions": questions}


async def generate_quiz(
    *,
    org_id: int,
    prompt: str,
    model_name: str,
    activity_content: dict | None = None,
    num_questions: int = 5,
    difficulty: str | None = None,
    session_uuid: str | None = None,
) -> tuple[dict, str]:
    """Generate a `blockQuiz` payload. Returns ``(block_quiz_attrs, session_uuid)``."""
    num_questions = max(1, min(num_questions, MAX_QUESTIONS))

    context = ""
    if activity_content:
        try:
            context = extract_text_from_prosemirror(activity_content) or ""
        except Exception:
            logger.warning("Failed to extract activity content for quiz grounding", exc_info=True)

    session = get_chat_session_history(session_uuid)
    resolved_session_uuid = session["aichat_uuid"]
    history = session["message_history"]

    user_prompt = _build_prompt(prompt, num_questions, difficulty, context)

    generated: GeneratedQuiz = await generate(
        model_name=model_name or model_for_tier("standard"),
        user_prompt=user_prompt,
        system_prompt=_SYSTEM_PROMPT,
        history=history,
        output_type=GeneratedQuiz,
    )

    block_quiz = _to_block_quiz(generated)

    # Record the exchange so a follow-up refine turn can amend the actual quiz
    # (persist the generated questions, not just a count).
    assistant_turn = json.dumps(block_quiz.get("questions", []))
    try:
        save_message_to_history(resolved_session_uuid, prompt.strip(), assistant_turn, org_id=org_id)
    except Exception:
        logger.debug("Failed to persist quiz refine history", exc_info=True)

    return block_quiz, resolved_session_uuid
