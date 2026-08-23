"""Course-plan tag coercion.

Course tags are stored PIPE-separated and the web TagInput splits on `|`.
The planning prompt now asks the model for a JSON array, and CoursePlan
coerces that to a clean list. finalize then joins with `|`.

The bug this guards against: the model used to emit `"a, b, c"` (comma
string), finalize stored it verbatim, and the UI rendered ONE chip. So
the negative case here is a stray comma string: it must still coerce to
separate tags, not a single blob.
"""

from src.services.ai.schemas.courseplanning import CoursePlan


def _plan(tags):
    return CoursePlan(name="n", description="d", tags=tags)


def _stored(tags):
    # How finalize_course_plan writes tags onto the Course row.
    return "|".join(_plan(tags).tags)


def test_list_input_is_trimmed_and_blanks_dropped():
    assert _plan(["python", "  beginners  ", ""]).tags == ["python", "beginners"]


def test_stored_form_is_pipe_separated():
    assert _stored(["python", "web"]) == "python|web"


def test_comma_string_still_splits():
    # Guard the actual bug: a comma string (old model output) must NOT
    # become one tag. If this fails, the UI shows a single chip again.
    assert _plan("python, web, apis").tags == ["python", "web", "apis"]
    assert _stored("python, web") == "python|web"


def test_pipe_string_is_accepted():
    # Idempotent: feeding the stored form back in round-trips.
    assert _plan("a|b|c").tags == ["a", "b", "c"]


def test_empty_and_none_are_empty():
    assert _plan("").tags == []
    assert _plan(None).tags == []
    assert _stored([]) == ""
