from src.services.security.password_validation import (
    get_password_requirements,
    validate_password_complexity,
)


def test_validate_password_complexity_accepts_strong_password():
    result = validate_password_complexity("Strong1!")

    assert result.is_valid is True
    assert result.errors == []
    assert all(result.requirements.values())


def test_lenient_policy_accepts_lowercase_letters_and_a_number():
    # No uppercase or special character needed any more.
    assert validate_password_complexity("blue river 42").is_valid is True
    assert validate_password_complexity("comptable7").is_valid is True
    # Letters from any script count.
    assert validate_password_complexity("كلمةسرية9").is_valid is True


def test_validate_password_complexity_reports_all_missing_requirements():
    result = validate_password_complexity("weak")

    assert result.is_valid is False
    assert result.requirements == {
        "min_length": False,
        "has_letter": True,
        "has_number_or_symbol": False,
        "not_common": True,
    }
    assert result.errors == [
        "Password must be at least 8 characters long",
        "Password must contain at least one number or symbol",
    ]


def test_validate_password_complexity_requires_a_letter():
    result = validate_password_complexity("12345678!")

    assert result.is_valid is False
    assert result.requirements["has_letter"] is False
    assert result.errors == ["Password must contain at least one letter"]


def test_all_letters_or_letters_and_spaces_are_refused():
    assert validate_password_complexity("onlyletters").is_valid is False
    assert validate_password_complexity("only letters here").is_valid is False


def test_common_passwords_are_refused_whatever_the_case():
    result = validate_password_complexity("Password123")

    assert result.is_valid is False
    assert result.requirements["not_common"] is False
    assert result.errors == ["This password is too common. Pick something less predictable"]


def test_get_password_requirements_returns_expected_items():
    requirements = get_password_requirements()

    assert [item["id"] for item in requirements] == [
        "min_length",
        "has_letter",
        "has_number_or_symbol",
        "not_common",
    ]
    assert requirements[0]["description"] == "At least 8 characters"
