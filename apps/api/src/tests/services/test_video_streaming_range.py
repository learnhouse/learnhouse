"""Unit tests for Range helpers in video_streaming (416 / zero-length edges)."""

from src.services.utils.video_streaming import is_range_unsatisfiable, parse_range_header


def test_no_range_is_satisfiable():
    assert is_range_unsatisfiable(None, 100) is False
    assert is_range_unsatisfiable("", 100) is False


def test_empty_resource_with_range_is_unsatisfiable():
    assert is_range_unsatisfiable("bytes=0-", 0) is True
    assert is_range_unsatisfiable("bytes=0-100", 0) is True


def test_start_past_eof_is_unsatisfiable():
    assert is_range_unsatisfiable("bytes=100-", 100) is True   # last byte is 99
    assert is_range_unsatisfiable("bytes=999-1000", 100) is True


def test_in_range_is_satisfiable():
    assert is_range_unsatisfiable("bytes=0-", 100) is False
    assert is_range_unsatisfiable("bytes=99-", 100) is False
    assert is_range_unsatisfiable("bytes=50-80", 100) is False


def test_suffix_range_is_satisfiable_for_nonempty():
    assert is_range_unsatisfiable("bytes=-500", 100) is False
    assert is_range_unsatisfiable("bytes=-500", 0) is True  # empty file


def test_malformed_range_is_treated_as_satisfiable():
    # Falls through to normal parsing (which yields the full range / 200).
    assert is_range_unsatisfiable("bytes=abc-", 100) is False
    assert parse_range_header("bytes=abc-", 100) == (0, 99)
