"""
Edge-case tests for the CODE-task grading helpers in
``src.services.courses.activities.assignments``:

  * ``_normalize_code_output(s)`` — pure string normalization used to compare
    Judge0 stdout against the teacher's expected output. Strips trailing
    whitespace per line, drops trailing blank lines, joins with ``\\n``, and
    maps empty/None to ``""``.
  * ``_grade_code_task_async(task, task_submission)`` — re-grades a CODE task
    by running the student's stored source against the teacher's test cases via
    Judge0. Judge0 is reached through a *deferred* import inside the function
    (``from src.routers.code_execution import _get_judge0_config, _submit_single``),
    so we patch those names on the ``src.routers.code_execution`` module. No
    real Judge0 is ever contacted.

pytest-asyncio runs in ``auto`` mode (see pyproject.toml), so the async tests
are plain ``async def`` and ``await`` the call directly — no marker needed.

These are NET-NEW cases; ``test_server_verify_dispatch_edge.py`` deliberately
does NOT exercise CODE, and no other test touches ``_normalize_code_output``.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from src.services.courses.activities.assignments import (
    _grade_code_task_async,
    _normalize_code_output,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _task(contents, max_grade_value=100):
    """Minimal stand-in for a Task ORM row as used by the grader."""
    return SimpleNamespace(
        contents=contents,
        max_grade_value=max_grade_value,
        assignment_task_uuid="code_task_uuid",
    )


def _submission(data):
    """Minimal stand-in for a TaskSubmission row (``.task_submission`` dict)."""
    return SimpleNamespace(task_submission=data)


def _patch_judge0(submit_side_effect):
    """
    Patch the deferred-imported Judge0 helpers on their *source* module.

    ``_get_judge0_config`` returns a sentinel config; ``_submit_single`` is an
    AsyncMock whose ``side_effect`` (a callable or list) produces the fake
    Judge0 result dict(s). Returns a tuple of the two patch context managers'
    started mocks via a combined context manager is awkward, so callers use
    ``with _patch_judge0(...) as submit:``.
    """
    return patch.multiple(
        "src.routers.code_execution",
        _get_judge0_config=lambda: {"cfg": "fake"},
        _submit_single=AsyncMock(side_effect=submit_side_effect),
    )


def _ok(stdout):
    """A successful (Accepted, status id 3) Judge0 result with given stdout."""
    return {"status": {"id": 3}, "stdout": stdout}


# ===========================================================================
# _normalize_code_output  (pure)
# ===========================================================================


def test_normalize_strips_trailing_spaces_per_line():
    """Trailing spaces on each line are stripped."""
    assert _normalize_code_output("hello   \nworld  ") == "hello\nworld"


def test_normalize_strips_trailing_tabs_per_line():
    """Trailing tabs on each line are stripped just like spaces."""
    assert _normalize_code_output("a\t\t\nb\t") == "a\nb"


def test_normalize_handles_crlf_line_endings():
    """Windows CRLF endings normalize to the same value as LF endings."""
    assert _normalize_code_output("a\r\nb\r\n") == "a\nb"
    assert _normalize_code_output("a\r\nb\r\n") == _normalize_code_output("a\nb\n")


def test_normalize_drops_trailing_blank_lines():
    """Trailing blank lines (including whitespace-only ones) are dropped."""
    assert _normalize_code_output("x\n\n\n") == "x"
    assert _normalize_code_output("x\n   \n\t\n") == "x"


def test_normalize_keeps_internal_blank_lines():
    """Blank lines *between* content lines are preserved."""
    assert _normalize_code_output("a\n\nb\n") == "a\n\nb"


def test_normalize_empty_and_none():
    """Empty string and None both map to the empty string."""
    assert _normalize_code_output("") == ""
    assert _normalize_code_output(None) == ""


def test_normalize_only_whitespace():
    """Output that is only whitespace collapses to the empty string."""
    assert _normalize_code_output("   \n\t\n  ") == ""
    assert _normalize_code_output("\n\n") == ""


def test_normalize_single_line_no_trailing_newline():
    """A bare value without a trailing newline survives unchanged."""
    assert _normalize_code_output("42") == "42"
    # ...and matches the same value printed with a trailing newline.
    assert _normalize_code_output("42\n") == _normalize_code_output("42")


# ===========================================================================
# _grade_code_task_async — short-circuit / guard cases (no Judge0 call)
# ===========================================================================


async def test_none_submission_returns_zero():
    """A missing submission grades to 0."""
    task = _task({"test_cases": [{"expectedStdout": "1"}], "language_id": 71})
    assert await _grade_code_task_async(task, None) == 0


async def test_empty_source_code_returns_zero():
    """Blank/whitespace-only source code grades to 0 without hitting Judge0."""
    task = _task({"test_cases": [{"expectedStdout": "1"}], "language_id": 71})
    sub = _submission({"source_code": "   \n\t", "language_id": 71})
    assert await _grade_code_task_async(task, sub) == 0


async def test_missing_language_id_returns_zero():
    """No language_id on submission AND none in contents → 0."""
    task = _task({"test_cases": [{"expectedStdout": "1"}]})  # no language_id
    sub = _submission({"source_code": "print(1)"})  # no language_id
    assert await _grade_code_task_async(task, sub) == 0


async def test_no_test_cases_returns_zero():
    """A task with no test cases grades to 0."""
    task = _task({"test_cases": [], "language_id": 71})
    sub = _submission({"source_code": "print(1)", "language_id": 71})
    assert await _grade_code_task_async(task, sub) == 0


async def test_task_max_zero_returns_zero():
    """A non-positive max_grade_value grades to 0."""
    task = _task(
        {"test_cases": [{"expectedStdout": "1"}], "language_id": 71},
        max_grade_value=0,
    )
    sub = _submission({"source_code": "print(1)", "language_id": 71})
    assert await _grade_code_task_async(task, sub) == 0


async def test_judge0_not_configured_returns_none():
    """When _get_judge0_config raises HTTPException, the grader returns None."""
    task = _task({"test_cases": [{"expectedStdout": "1"}], "language_id": 71})
    sub = _submission({"source_code": "print(1)", "language_id": 71})
    with patch(
        "src.routers.code_execution._get_judge0_config",
        side_effect=HTTPException(status_code=503, detail="not configured"),
    ):
        assert await _grade_code_task_async(task, sub) is None


# ===========================================================================
# _grade_code_task_async — grading modes (Judge0 mocked)
# ===========================================================================


async def test_binary_all_pass_returns_max():
    """binary mode: every test passes → full marks."""
    task = _task(
        {
            "grading_mode": "binary",
            "language_id": 71,
            "test_cases": [
                {"expectedStdout": "1"},
                {"expectedStdout": "2"},
            ],
        }
    )
    sub = _submission({"source_code": "print(x)", "language_id": 71})
    with _patch_judge0([_ok("1\n"), _ok("2\n")]):
        assert await _grade_code_task_async(task, sub) == 100


async def test_binary_one_fail_returns_zero():
    """binary mode: a single failing test → 0 even if others pass."""
    task = _task(
        {
            "grading_mode": "binary",
            "language_id": 71,
            "test_cases": [
                {"expectedStdout": "1"},
                {"expectedStdout": "2"},
            ],
        }
    )
    sub = _submission({"source_code": "print(x)", "language_id": 71})
    with _patch_judge0([_ok("1\n"), _ok("WRONG\n")]):
        assert await _grade_code_task_async(task, sub) == 0


async def test_equal_weight_one_of_two_passes():
    """equal_weight (default) with 1/2 passing → round(0.5 * max)."""
    task = _task(
        {
            # no grading_mode → defaults to equal_weight
            "language_id": 71,
            "test_cases": [
                {"expectedStdout": "1"},
                {"expectedStdout": "2"},
            ],
        }
    )
    sub = _submission({"source_code": "print(x)", "language_id": 71})
    with _patch_judge0([_ok("1\n"), _ok("nope\n")]):
        assert await _grade_code_task_async(task, sub) == 50


async def test_custom_weights_weighted_score():
    """
    custom_weights: grade = round(passed_weight / total_weight * max).

    Three tests with weights 1/3/1 (total 5). Tests 1 and 3 pass (weight 2),
    test 2 fails → round(2/5 * 100) == 40.
    """
    task = _task(
        {
            "grading_mode": "custom_weights",
            "language_id": 71,
            "test_cases": [
                {"expectedStdout": "a", "weight": 1},
                {"expectedStdout": "b", "weight": 3},
                {"expectedStdout": "c", "weight": 1},
            ],
        }
    )
    sub = _submission({"source_code": "...", "language_id": 71})
    with _patch_judge0([_ok("a\n"), _ok("X\n"), _ok("c\n")]):
        assert await _grade_code_task_async(task, sub) == 40


async def test_non_accepted_status_counts_as_fail():
    """
    A correct stdout but a non-Accepted status (id != 3, e.g. compile error 6)
    must NOT pass — passing requires status id == 3 AND matching stdout.
    """
    task = _task(
        {
            "grading_mode": "binary",
            "language_id": 71,
            "test_cases": [{"expectedStdout": "1"}],
        }
    )
    sub = _submission({"source_code": "print(1)", "language_id": 71})
    # status id 6 = Compilation Error; stdout would otherwise match.
    with _patch_judge0([{"status": {"id": 6}, "stdout": "1\n"}]):
        assert await _grade_code_task_async(task, sub) == 0


async def test_expected_snake_case_spelling_honored():
    """The grader tolerates the snake_case ``expected_stdout`` spelling."""
    task = _task(
        {
            "grading_mode": "binary",
            "language_id": 71,
            "test_cases": [{"expected_stdout": "42"}],
        }
    )
    sub = _submission({"source_code": "print(42)", "language_id": 71})
    with _patch_judge0([_ok("42\n")]):
        assert await _grade_code_task_async(task, sub) == 100


async def test_expected_camel_case_spelling_honored():
    """The grader tolerates the camelCase ``expectedStdout`` spelling."""
    task = _task(
        {
            "grading_mode": "binary",
            "language_id": 71,
            "test_cases": [{"expectedStdout": "42"}],
        }
    )
    sub = _submission({"source_code": "print(42)", "language_id": 71})
    with _patch_judge0([_ok("42\n")]):
        assert await _grade_code_task_async(task, sub) == 100


async def test_stdout_normalization_makes_trailing_newline_match():
    """
    stdout "42\\n" must match expected "42": both sides go through
    _normalize_code_output, so trailing newlines/whitespace don't matter.
    """
    task = _task(
        {
            "grading_mode": "binary",
            "language_id": 71,
            "test_cases": [{"expectedStdout": "42"}],
        }
    )
    sub = _submission({"source_code": "print(42)", "language_id": 71})
    with _patch_judge0([_ok("42\n")]):
        assert await _grade_code_task_async(task, sub) == 100


async def test_language_id_falls_back_to_contents():
    """
    With no language_id on the submission but one configured on the task
    contents, grading proceeds using the contents language_id.
    """
    task = _task(
        {
            "grading_mode": "binary",
            "language_id": 71,
            "test_cases": [{"expectedStdout": "1"}],
        }
    )
    sub = _submission({"source_code": "print(1)"})  # no submission language_id
    submit = AsyncMock(side_effect=[_ok("1\n")])
    with patch.multiple(
        "src.routers.code_execution",
        _get_judge0_config=lambda: {"cfg": "fake"},
        _submit_single=submit,
    ):
        result = await _grade_code_task_async(task, sub)
    assert result == 100
    # Confirms the contents language_id (71) was the one actually used.
    called_lang = submit.await_args.args[1]
    assert called_lang == 71


async def test_judge0_exception_per_case_counts_as_fail():
    """
    If a per-case Judge0 call itself raises, that test is treated as failed
    (caught inside run_one) rather than blowing up the whole grade.
    """
    task = _task(
        {
            "language_id": 71,
            "test_cases": [
                {"expectedStdout": "1"},
                {"expectedStdout": "2"},
            ],
        }
    )
    sub = _submission({"source_code": "...", "language_id": 71})
    # First call succeeds, second raises → equal_weight 1/2 → 50.
    with _patch_judge0([_ok("1\n"), RuntimeError("judge0 boom")]):
        assert await _grade_code_task_async(task, sub) == 50
