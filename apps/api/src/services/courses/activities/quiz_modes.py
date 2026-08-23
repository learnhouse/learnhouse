"""Response-mode and grading-mode resolution for QUIZ assignment tasks.

A quiz question is either a *single response* (pick exactly one) or a *multiple
response* (select all that apply). The mode lives on the question itself, as
``question["response_type"]``, and the grading mode lives on the task contents
as ``contents["grading_mode"]``. Both are plain keys inside the opaque
``AssignmentTask.contents`` JSON — no column, no migration.

Neither field exists on content authored before this shipped, so everything
here has to work on questions that carry no mode at all. ``resolve_response_type``
is the ONE place that inference lives: a question with 2+ correct options was
always a de-facto select-all-that-apply, one with a single correct option was a
pick-one. Stored data is never rewritten to backfill the field.

The client mirror of this module is ``apps/web/lib/quiz/modes.ts``. Keep the two
in sync: ``TaskQuizObject.tsx``'s ``gradeFC`` shows the learner a preview grade
and the server stores the real one, so any divergence is a visible bug.
"""

from __future__ import annotations

from typing import Iterable, Sequence

RESPONSE_TYPE_SINGLE = "single"
RESPONSE_TYPE_MULTIPLE = "multiple"
RESPONSE_TYPES = (RESPONSE_TYPE_SINGLE, RESPONSE_TYPE_MULTIPLE)

GRADING_MODE_ALL_OR_NOTHING = "all_or_nothing"
GRADING_MODE_PARTIAL_CREDIT = "partial_credit"
GRADING_MODES = (GRADING_MODE_ALL_OR_NOTHING, GRADING_MODE_PARTIAL_CREDIT)


def count_correct_options(options: Iterable) -> int:
    """How many options the answer key marks correct (non-dicts ignored)."""
    return sum(
        1
        for o in options or []
        if isinstance(o, dict) and bool(o.get("assigned_right_answer"))
    )


def infer_response_type(correct_option_count: int) -> str:
    """Mode for a question that carries no explicit ``response_type``."""
    return (
        RESPONSE_TYPE_MULTIPLE
        if correct_option_count >= 2
        else RESPONSE_TYPE_SINGLE
    )


def resolve_response_type(question: dict) -> str:
    """The response mode of one question: explicit when set, inferred otherwise.

    Anything that isn't one of the two known values (a typo, a stale field, a
    non-string) falls back to inference rather than being trusted, so a bad
    value can never make a 3-correct-option question grade as a pick-one.
    """
    if not isinstance(question, dict):
        return RESPONSE_TYPE_SINGLE
    raw = question.get("response_type")
    if isinstance(raw, str) and raw.strip().lower() in RESPONSE_TYPES:
        return raw.strip().lower()
    return infer_response_type(count_correct_options(question.get("options")))


def resolve_grading_mode(contents: dict) -> str:
    """The grading mode of a quiz task. Defaults to all-or-nothing.

    All-or-nothing is the pre-existing behaviour, so it stays the default: a
    task that was authored before this shipped keeps grading exactly as it did.
    """
    if not isinstance(contents, dict):
        return GRADING_MODE_ALL_OR_NOTHING
    raw = contents.get("grading_mode")
    if isinstance(raw, str) and raw.strip().lower() == GRADING_MODE_PARTIAL_CREDIT:
        return GRADING_MODE_PARTIAL_CREDIT
    return GRADING_MODE_ALL_OR_NOTHING


def score_question(
    answers: Sequence[tuple],
    response_type: str,
    grading_mode: str,
) -> float:
    """Score one question in [0, 1].

    ``answers`` is one ``(is_correct, is_selected)`` pair per option.

    * all-or-nothing (either response type): 1.0 only when the learner's
      selected set exactly matches the key, else 0.0.
    * partial credit, single response: still 1.0 or 0.0 — there is no partial
      state to award when only one option can be right.
    * partial credit, multiple response:
      ``(correct_selected - incorrect_selected) / total_correct``, clamped to
      [0, 1]. Wrong picks cancel right ones, so blanket-selecting everything
      scores 0 instead of full marks.

    A question whose key marks no option correct scores 0 and is expected to be
    excluded from the denominator by the caller.
    """
    pairs = [(bool(c), bool(s)) for c, s in answers]
    total_correct = sum(1 for is_correct, _ in pairs if is_correct)
    if total_correct == 0:
        return 0.0

    exact_match = all(is_correct == is_selected for is_correct, is_selected in pairs)
    if (
        grading_mode != GRADING_MODE_PARTIAL_CREDIT
        or response_type != RESPONSE_TYPE_MULTIPLE
    ):
        return 1.0 if exact_match else 0.0

    correct_selected = sum(1 for is_correct, is_selected in pairs if is_correct and is_selected)
    incorrect_selected = sum(
        1 for is_correct, is_selected in pairs if not is_correct and is_selected
    )
    raw = (correct_selected - incorrect_selected) / total_correct
    return max(0.0, min(1.0, raw))
