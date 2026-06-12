"""Tests for the _csv_safe CSV-injection neutralizer in src/services/orgs/users.py."""

import pytest

from src.services.orgs.users import _csv_safe


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("=cmd", "'=cmd"),
        ("+1", "'+1"),
        ("@x", "'@x"),
        ("-1", "'-1"),
        ("\tdanger", "'\tdanger"),
        ("\rdanger", "'\rdanger"),
    ],
)
def test_csv_safe_prefixes_dangerous_leading_chars(value, expected):
    assert _csv_safe(value) == expected


def test_csv_safe_leaves_normal_string_unchanged():
    assert _csv_safe("Alice") == "Alice"
    assert _csv_safe("user@example.com is not leading @") == "user@example.com is not leading @"


def test_csv_safe_empty_string_unchanged():
    assert _csv_safe("") == ""


def test_csv_safe_non_string_values_unchanged():
    assert _csv_safe(123) == 123
    assert _csv_safe(None) is None
    assert _csv_safe(True) is True
