from src.services.security.password_validation import (
    get_password_requirements,
    validate_password_complexity,
)


def test_validate_password_complexity_accepts_strong_password():
    result = validate_password_complexity("Strong1!")

    assert result.is_valid is True
    assert result.errors == []
    assert all(result.requirements.values())


def test_validate_password_complexity_reports_all_missing_requirements():
    result = validate_password_complexity("weak")

    assert result.is_valid is False
    assert result.requirements == {
        "min_length": False,
        "has_uppercase": False,
        "has_lowercase": True,
        "has_number": False,
        "has_special": False,
    }
    assert result.errors == [
        "Password must be at least 8 characters long",
        "Password must contain at least one uppercase letter",
        "Password must contain at least one number",
        "Password must contain at least one special character (!@#$%^&*...)",
    ]


def test_get_password_requirements_returns_expected_items():
    requirements = get_password_requirements()

    assert [item["id"] for item in requirements] == [
        "min_length",
        "has_uppercase",
        "has_lowercase",
        "has_number",
        "has_special",
    ]
    assert requirements[-1]["description"].startswith("At least one special character")
