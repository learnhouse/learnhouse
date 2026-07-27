"""Turn a stored assignment submission into something a human can read.

An ``AssignmentTaskSubmission.task_submission`` row is a bag of UUIDs — a quiz answer
is literally ``{"questionUUID": "question_3700…", "optionUUID": "option_f9ae…",
"answer": true}``. On its own it tells an admin nothing. The question and option text
live on the *task* (``AssignmentTask.contents``), so readability is a join, and this
module is where that join happens.

Every task type collapses into one normalized shape (see :func:`humanize_task_answer`)
so the dossier UI, the CSV export and the PDF export all render from a single
structure instead of each re-deriving per-type logic. Pure functions only: no DB, no
HTTP, no I/O.

The verdict logic deliberately mirrors the graders in
``src.services.courses.activities.assignments`` — where a check is subtle
(short-answer regex matching, numeric comma handling) this module *calls* the grader's
helper rather than reimplementing it, so a rendered verdict can never disagree with
the stored grade.

**Answer keys.** The output includes the teacher's correct answers. The only caller is
the per-student audit dossier, which is org-admin + Pro gated (``_require_admin`` /
``_enforce_plan`` in ``src.routers.audit``); ``_strip_answer_key`` in the assignments
service guards the *student* read paths and is not applicable here. Two things are
still withheld because an export gets forwarded by email: the task's reference
``solution_code``, and the stdin/expected output of test cases the teacher marked
hidden.
"""
import hashlib
import json
import logging
from typing import Any

from src.db.courses.assignments import AssignmentTaskTypeEnum
from src.services.courses.activities.assignments import (
    _check_number_answer,
    _check_short_answer,
)

logger = logging.getLogger(__name__)

# Bounds. A dossier can span years of submissions across dozens of assignments, and
# every value here ends up in a CSV cell and a PDF line — one pathological task must
# not be able to produce a 100k-row export.
MAX_TEXT = 2000
MAX_ITEMS = 200
MAX_SOURCE = 20000

_TYPE_LABELS = {
    "QUIZ": "Quiz",
    "FORM": "Fill in the blanks",
    "SHORT_ANSWER": "Short answer",
    "NUMBER_ANSWER": "Numeric answer",
    "FILE_SUBMISSION": "File upload",
    "CODE": "Code exercise",
    "CUSTOM": "Custom task",
    "OTHER": "Other",
}

# Judge0 language ids, mirroring PLAYGROUND_LANGUAGES in
# apps/web/components/Objects/Editor/Extensions/CodePlayground/languages.ts.
_JUDGE0_LANGUAGES = {
    45: "Assembly (NASM)",
    46: "Bash",
    50: "C",
    51: "C#",
    54: "C++",
    55: "Common Lisp",
    57: "Elixir",
    59: "Fortran",
    60: "Go",
    61: "Haskell",
    62: "Java",
    63: "JavaScript (Node)",
    64: "Lua",
    68: "PHP",
    69: "Prolog",
    71: "Python 3",
    72: "Ruby",
    73: "Rust",
    74: "TypeScript",
    77: "Pascal",
    78: "Kotlin",
    79: "Objective-C",
    80: "R",
    81: "Scala",
    82: "SQL",
    83: "Swift",
    85: "Perl",
    86: "Clojure",
    90: "Dart",
    91: "PowerShell",
}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def _type_value(assignment_type: Any) -> str:
    if isinstance(assignment_type, AssignmentTaskTypeEnum):
        return assignment_type.value
    return str(assignment_type or "OTHER")


def task_type_label(assignment_type: Any) -> str:
    """``QUIZ`` -> ``"Quiz"``. Falls back to the raw value for unknown types."""
    value = _type_value(assignment_type)
    return _TYPE_LABELS.get(value, value.replace("_", " ").title())


def judge0_language_name(language_id: Any) -> str | None:
    if language_id is None:
        return None
    try:
        lid = int(language_id)
    except (TypeError, ValueError):
        return None
    return _JUDGE0_LANGUAGES.get(lid, f"Language {lid}")


def answer_digest(submission: Any) -> str | None:
    """Content hash of the stored submission, as ``sha256:<hex>``.

    The readable rendering is lossy, so an auditor who later disputes it needs a way
    to tie a given rendering back to one specific stored row. A digest does that in
    ~70 bytes instead of re-shipping the whole blob on every export (the raw payload
    is still retrievable via ``?include_raw=true``).
    """
    if submission is None:
        return None
    try:
        canonical = json.dumps(
            submission, sort_keys=True, separators=(",", ":"), default=str
        )
    except (TypeError, ValueError):
        canonical = repr(submission)
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _text(value: Any, limit: int = MAX_TEXT) -> str:
    if value is None:
        return ""
    text = value if isinstance(value, str) else str(value)
    text = text.strip()
    if len(text) > limit:
        return text[:limit] + "…"
    return text


def _dicts(value: Any) -> list[dict]:
    """Coerce to a list of dicts, dropping anything else. Stored JSON is untyped."""
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)][:MAX_ITEMS]


def _item(
    index: int,
    prompt: str,
    answer_text: str = "",
    expected_text: str | None = None,
    correct: bool | None = None,
    options: list | None = None,
) -> dict:
    return {
        "index": index,
        "prompt": prompt,
        "answer_text": answer_text,
        "expected_text": expected_text,
        "correct": correct,
        "options": options or [],
    }


def _envelope(kind: str, assignment_type: Any, **overrides) -> dict:
    envelope = {
        "kind": kind,
        "type_label": task_type_label(assignment_type),
        "summary": "",
        "correct_count": None,
        "total_count": None,
        "unreadable": False,
        "items": [],
        "explanation": None,
        "file": None,
        "code": None,
    }
    envelope.update(overrides)
    return envelope


def _score_summary(correct: int | None, total: int | None, noun: str) -> str:
    if not total:
        return ""
    return f"{correct}/{total} {noun} correct"


# ---------------------------------------------------------------------------
# Per-type builders
# ---------------------------------------------------------------------------
def _quiz(assignment_type: Any, contents: dict, submission: dict) -> dict:
    questions = _dicts(contents.get("questions"))
    if not questions:
        # The task row can be gone (deleted task, legacy submission). The submit path
        # stores a snapshot of the questions alongside the answers — worse than the
        # live contents (it may be stripped of the answer key) but far better than
        # showing the admin a wall of UUIDs.
        questions = _dicts(submission.get("questions"))

    # Same (questionUUID, optionUUID) indexing as _grade_quiz_task.
    answer_by_key: dict[tuple, bool] = {}
    for sub in _dicts(submission.get("submissions")):
        q_uuid = sub.get("questionUUID")
        o_uuid = sub.get("optionUUID")
        if q_uuid and o_uuid:
            answer_by_key[(q_uuid, o_uuid)] = bool(sub.get("answer"))

    items: list[dict] = []
    correct_count = 0
    total_count = 0
    for q_index, question in enumerate(questions):
        options = _dicts(question.get("options"))
        q_uuid = question.get("questionUUID")
        prompt = _text(question.get("questionText")) or f"Question {q_index + 1}"

        # An option set that carries no boolean `assigned_right_answer` at all means
        # the answer key was stripped or never authored. Rendering verdicts from that
        # would mark a 100%-correct submission as entirely wrong, so the whole
        # question goes verdict-free (mirrors `answerKeyPresent` in TaskQuizObject).
        key_present = any(
            isinstance(o.get("assigned_right_answer"), bool) for o in options
        )
        has_correct_option = any(
            bool(o.get("assigned_right_answer")) for o in options
        )

        rendered_options = []
        selected_labels = []
        expected_labels = []
        matches_key = True
        for o_index, option in enumerate(options):
            letter = chr(65 + o_index) if o_index < 26 else str(o_index + 1)
            selected = answer_by_key.get((q_uuid, option.get("optionUUID")), False)
            is_correct = bool(option.get("assigned_right_answer"))
            text = _text(option.get("text"))
            rendered_options.append(
                {
                    "letter": letter,
                    "text": text,
                    "selected": selected,
                    "is_correct": is_correct if key_present else None,
                }
            )
            label = f"{letter}. {text}" if text else letter
            if selected:
                selected_labels.append(label)
            if is_correct:
                expected_labels.append(label)
            if selected != is_correct:
                matches_key = False

        # A question with no correct option can't be auto-scored: under exact-set
        # matching a blank submission would "match" the all-false key and earn full
        # credit. _grade_quiz_task skips it; so do we.
        if key_present and has_correct_option and options:
            correct: bool | None = matches_key
            total_count += 1
            if matches_key:
                correct_count += 1
        else:
            correct = None

        items.append(
            _item(
                index=q_index + 1,
                prompt=prompt,
                answer_text=", ".join(selected_labels),
                expected_text=", ".join(expected_labels) if key_present else None,
                correct=correct,
                options=rendered_options,
            )
        )

    return _envelope(
        "quiz",
        assignment_type,
        items=items,
        correct_count=correct_count if total_count else None,
        total_count=total_count or None,
        summary=(
            _score_summary(correct_count, total_count, "questions")
            or f"{len(items)} questions"
        ),
    )


def _form(assignment_type: Any, contents: dict, submission: dict) -> dict:
    questions = _dicts(contents.get("questions")) or _dicts(submission.get("questions"))

    answer_by_key: dict[tuple, Any] = {}
    for sub in _dicts(submission.get("submissions")):
        q_uuid = sub.get("questionUUID")
        b_uuid = sub.get("blankUUID")
        if q_uuid and b_uuid:
            answer_by_key[(q_uuid, b_uuid)] = sub.get("answer")

    items: list[dict] = []
    correct_count = 0
    total_count = 0
    index = 0
    for q_index, question in enumerate(questions):
        q_uuid = question.get("questionUUID")
        question_text = _text(question.get("questionText"))
        for b_index, blank in enumerate(_dicts(question.get("blanks"))):
            if len(items) >= MAX_ITEMS:
                break
            index += 1
            placeholder = _text(blank.get("placeholder")) or f"Blank {b_index + 1}"
            prompt = f"{question_text} — {placeholder}" if question_text else placeholder
            given = answer_by_key.get((q_uuid, blank.get("blankUUID")))
            expected_raw = blank.get("correctAnswer")
            expected = _text(expected_raw)

            # A blank with no configured answer isn't auto-scorable — same skip as
            # _grade_form_task, which would otherwise credit an empty answer.
            if not expected:
                correct: bool | None = None
            else:
                total_count += 1
                correct = _text(given).lower() == expected.lower()
                if correct:
                    correct_count += 1

            items.append(
                _item(
                    index=index,
                    prompt=prompt,
                    answer_text=_text(given),
                    expected_text=expected or None,
                    correct=correct,
                )
            )

    return _envelope(
        "form",
        assignment_type,
        items=items,
        correct_count=correct_count if total_count else None,
        total_count=total_count or None,
        summary=(
            _score_summary(correct_count, total_count, "blanks")
            or f"{len(items)} blanks"
        ),
    )


def _short_answer(assignment_type: Any, contents: dict, submission: dict) -> dict:
    accepted = contents.get("correct_answers")
    match_mode = contents.get("match_mode") or "case_insensitive"
    given = submission.get("answer")

    if isinstance(accepted, list) and any(
        isinstance(a, str) and a.strip() for a in accepted
    ):
        correct: bool | None = _check_short_answer(given, accepted, match_mode)
        joined = ", ".join(_text(a) for a in accepted if isinstance(a, str) and a.strip())
        expected = f"matches /{joined}/" if match_mode == "regex" else joined
    else:
        correct = None
        expected = None

    return _envelope(
        "short_answer",
        assignment_type,
        items=[
            _item(
                index=1,
                prompt=_text(contents.get("prompt")) or "Short answer",
                answer_text=_text(given),
                expected_text=expected,
                correct=correct,
            )
        ],
        correct_count=(1 if correct else 0) if correct is not None else None,
        total_count=1 if correct is not None else None,
        explanation=_text(contents.get("explanation")) or None,
        summary=_text(given) or "No answer given",
    )


def _number_answer(assignment_type: Any, contents: dict, submission: dict) -> dict:
    correct_value = contents.get("correct_value")
    tolerance = contents.get("tolerance")
    unit = _text(contents.get("unit"))
    given = submission.get("answer")

    if correct_value is None:
        correct: bool | None = None
        expected = None
    else:
        correct = _check_number_answer(given, correct_value, tolerance)
        expected = f"{correct_value}"
        if tolerance:
            expected += f" ± {tolerance}"
        if unit:
            expected += f" {unit}"

    answer_text = _text(given)
    if answer_text and unit:
        answer_text = f"{answer_text} {unit}"

    return _envelope(
        "number_answer",
        assignment_type,
        items=[
            _item(
                index=1,
                prompt=_text(contents.get("prompt")) or "Numeric answer",
                answer_text=answer_text,
                expected_text=expected,
                correct=correct,
            )
        ],
        correct_count=(1 if correct else 0) if correct is not None else None,
        total_count=1 if correct is not None else None,
        explanation=_text(contents.get("explanation")) or None,
        summary=answer_text or "No answer given",
    )


def _file(assignment_type: Any, contents: dict, submission: dict, fallback_prompt: str) -> dict:
    # The submit path has used several spellings over time; accept all of them the
    # same way src/security/submission_file_access.py does.
    file_uuid = (
        submission.get("fileUUID")
        or submission.get("file_uuid")
        or ""
    )
    file_name = _text(submission.get("file_name") or submission.get("fileName"))

    if file_name:
        answer_text = file_name
    elif file_uuid:
        short = file_uuid if len(file_uuid) <= 16 else f"{file_uuid[:8]}…{file_uuid[-4:]}"
        answer_text = f"Uploaded file ({short})"
    else:
        answer_text = ""

    return _envelope(
        "file",
        assignment_type,
        items=[
            _item(
                index=1,
                prompt=fallback_prompt or "File upload",
                answer_text=answer_text,
            )
        ],
        file=(
            {"file_uuid": file_uuid or None, "file_name": file_name or None}
            if (file_uuid or file_name)
            else None
        ),
        summary=answer_text or "No file uploaded",
    )


def _code(assignment_type: Any, contents: dict, submission: dict) -> dict:
    test_cases = _dicts(contents.get("test_cases"))
    results = submission.get("results")
    results = results if isinstance(results, list) else []

    language_id = submission.get("language_id") or contents.get("language_id")

    test_results = []
    passed_tests = 0
    total_tests = 0
    for index, tc in enumerate(test_cases):
        result = results[index] if index < len(results) and isinstance(results[index], dict) else {}
        hidden = bool(tc.get("hidden"))
        passed = result.get("passed")
        passed = bool(passed) if passed is not None else None
        total_tests += 1
        if passed:
            passed_tests += 1
        test_results.append(
            {
                "name": f"Hidden test {index + 1}" if hidden else f"Test {index + 1}",
                "hidden": hidden,
                "passed": passed,
                # Hidden cases stay hidden even for an admin export — the whole point
                # of marking one hidden is that its inputs never leak to a learner,
                # and exports get forwarded.
                "stdin": None if hidden else _text(tc.get("stdin")),
                "expected": None if hidden else _text(
                    tc.get("expectedStdout") or tc.get("expected_stdout")
                ),
                "actual": None if hidden else _text(
                    result.get("actual") or result.get("stdout")
                ),
            }
        )

    return _envelope(
        "code",
        assignment_type,
        code={
            "language": judge0_language_name(language_id),
            "language_id": language_id,
            # `solution_code` from contents is deliberately never copied here.
            "source_code": _text(submission.get("source_code"), MAX_SOURCE),
            "grading_mode": contents.get("grading_mode") or "equal_weight",
            "passed_tests": passed_tests,
            "total_tests": total_tests,
            "test_results": test_results,
        },
        correct_count=passed_tests if total_tests else None,
        total_count=total_tests or None,
        summary=(
            f"{passed_tests}/{total_tests} tests passed"
            if total_tests
            else "No test cases configured"
        ),
    )


def _raw(assignment_type: Any, submission: Any, fallback_prompt: str = "") -> dict:
    """Last resort: flatten arbitrary JSON into labelled key/value rows.

    Used for CUSTOM/OTHER tasks (whose payload the platform never interprets) and as
    the catch-all when a built-in type's stored data is malformed. Even here the
    caller gets labelled rows rather than a JSON blob, so nothing in the UI ever has
    to fall back to ``JSON.stringify``.
    """
    items: list[dict] = []

    def walk(value: Any, path: str, depth: int) -> None:
        if len(items) >= MAX_ITEMS:
            return
        if isinstance(value, dict) and depth < 3:
            for key, child in value.items():
                walk(child, f"{path}.{key}" if path else str(key), depth + 1)
        elif isinstance(value, list) and depth < 3:
            for index, child in enumerate(value):
                walk(child, f"{path}.{index}" if path else str(index), depth + 1)
        else:
            items.append(
                _item(
                    index=len(items) + 1,
                    prompt=path or fallback_prompt or "Value",
                    answer_text=_text(value),
                )
            )

    walk(submission, "", 0)
    return _envelope(
        "raw",
        assignment_type,
        unreadable=True,
        items=items,
        summary=f"Custom submission ({len(items)} fields)" if items else "No data",
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def humanize_task_answer(
    assignment_type: Any,
    contents: dict | None,
    submission: dict | None,
    fallback_prompt: str = "",
) -> dict:
    """Render one stored submission as questions, answers and verdicts.

    ``contents`` is ``AssignmentTask.contents`` (the question bank) and ``submission``
    is ``AssignmentTaskSubmission.task_submission`` (what the learner sent). Returns
    the normalized envelope described in the module docstring; every type produces the
    same top-level keys so a single renderer handles all of them.

    ``correct`` is tri-state on purpose: ``None`` means "not auto-verifiable" (no
    answer key configured, or a question the grader itself skips) and must render as
    *no verdict* rather than as a failure.
    """
    contents = contents if isinstance(contents, dict) else {}
    submission = submission if isinstance(submission, dict) else {}
    type_value = _type_value(assignment_type)

    try:
        if type_value == "QUIZ":
            return _quiz(assignment_type, contents, submission)
        if type_value == "FORM":
            return _form(assignment_type, contents, submission)
        if type_value == "SHORT_ANSWER":
            return _short_answer(assignment_type, contents, submission)
        if type_value == "NUMBER_ANSWER":
            return _number_answer(assignment_type, contents, submission)
        if type_value == "FILE_SUBMISSION":
            return _file(assignment_type, contents, submission, fallback_prompt)
        if type_value == "CODE":
            return _code(assignment_type, contents, submission)
    except Exception:
        # Stored JSON is schemaless and years old in places. One malformed task must
        # degrade to raw key/value rows, never 500 the whole dossier.
        logger.warning(
            "Could not humanize a %s submission; falling back to raw fields",
            type_value,
            exc_info=True,
        )

    return _raw(assignment_type, submission, fallback_prompt)
