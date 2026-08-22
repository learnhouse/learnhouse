from src.services.ai.course_tags import normalize_course_tags


def test_comma_separated_tags_become_pipe_separated():
    assert normalize_course_tags("python, beginner, data") == "python|beginner|data"


def test_already_pipe_separated_tags_are_kept():
    assert normalize_course_tags("python|beginner") == "python|beginner"


def test_empty_and_whitespace_are_dropped():
    assert normalize_course_tags("") == ""
    assert normalize_course_tags("  a, , b  ") == "a|b"
