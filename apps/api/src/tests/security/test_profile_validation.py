"""Tests for display-name URL/link rejection and render-time scrubbing.

Regression guard for the phishing-relay incident where an attacker planted a
phishing URL in their username and relayed it via invites.
"""
import pytest

from src.services.security.profile_validation import (
    contains_url,
    sanitize_display_name,
    strip_urls,
    validate_display_name,
    validate_profile_fields,
)


@pytest.mark.parametrize(
    "value",
    [
        "Вам 5000 руб https://platf-yndx.online/pro/",  # the real incident payload
        "platf-yndx.online",
        "www.evil.com",
        "http://x.io",
        "HTTPS://X.IO",
        "free money at evil.dev/promo",  # TLD-agnostic path match (.dev not in list)
        "ping me evil.ai/x",
        "reach me bit.ly/abc",
        "contact evil dot com",
        "cash evil (dot) com",
        "ftp://host.example/file",
    ],
)
def test_contains_url_flags_links(value):
    assert contains_url(value) is True
    assert validate_display_name(value) is False


@pytest.mark.parametrize(
    "value",
    [
        "John Smith",
        "María José",
        "O'Brien",
        "J.R.R. Tolkien",  # dotted initials, no path → not a URL
        "Dr. Strange",
        "李四",
        "",
        "A. B. Curie",
    ],
)
def test_contains_url_allows_plain_names(value):
    assert contains_url(value) is False
    assert validate_display_name(value) is True


def test_validate_profile_fields_skips_none_and_reports_invalid():
    result = validate_profile_fields(
        {"username": "Free http://x.io", "first_name": "Dan", "last_name": None}
    )
    assert result.is_valid is False
    assert result.invalid_fields == ["username"]
    assert result.errors and "username" in result.errors[0]


def test_validate_profile_fields_all_clean():
    result = validate_profile_fields(
        {"username": "danabc", "first_name": "Dan", "last_name": "Smith"}
    )
    assert result.is_valid is True
    assert result.invalid_fields == []


def test_strip_urls_empty_returns_empty_string():
    assert strip_urls("") == ""
    assert strip_urls(None) == ""


def test_strip_urls_removes_links_and_control_chars():
    assert "http" not in strip_urls("see https://evil.example/x now")
    # CR/LF (SMTP header injection primitive) are stripped.
    scrubbed = strip_urls("Dan\r\nBcc: victim@x.com")
    assert "\r" not in scrubbed and "\n" not in scrubbed


def test_sanitize_display_name_falls_back_when_empty_after_scrub():
    assert sanitize_display_name("platf-yndx.online") == "A LearnHouse user"
    assert sanitize_display_name("platf-yndx.online", fallback="Someone") == "Someone"
    assert sanitize_display_name("John Smith") == "John Smith"


def test_reject_urls_in_profile_fields_helper():
    from fastapi import HTTPException

    from src.services.users.users import _reject_urls_in_profile_fields

    # Clean fields: no raise.
    _reject_urls_in_profile_fields(username="dan", first_name="Dan", last_name="Smith")
    # A URL in any field: 400 PROFILE_FIELD_INVALID.
    with pytest.raises(HTTPException) as exc:
        _reject_urls_in_profile_fields(username="buy http://evil.io", first_name=None, last_name=None)
    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "PROFILE_FIELD_INVALID"


def test_looks_like_email_rejects_malformed_and_control_chars():
    from src.services.orgs.users import _looks_like_email

    assert _looks_like_email("a@test.com") is True
    assert _looks_like_email("no-at-sign") is False
    assert _looks_like_email("a@b.com" + "x" * 260) is False  # too long
    assert _looks_like_email("a\n@test.com") is False  # control char
    assert _looks_like_email("a:b@test.com") is False  # colon (Redis key shaping)
