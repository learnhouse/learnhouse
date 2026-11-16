"""
Password validation service.

Lenient but safe: length does most of the work, composition rules mostly add
friction (and push people to "Password1!"). Requirements:
- Minimum 8 characters
- At least one letter
- At least one number or symbol (not all letters)
- Not one of the passwords people reach for first

The web checklist mirrors these (components/Auth/PasswordStrengthIndicator.tsx).
"""
from typing import List
from pydantic import BaseModel


class PasswordValidationResult(BaseModel):
    """Result of password validation."""
    is_valid: bool
    errors: List[str]
    requirements: dict


MIN_LENGTH = 8

# Lower-cased. Mirrors COMMON_PASSWORDS in the web checklist.
COMMON_PASSWORDS = frozenset({
    "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "p@ssword1",
    "qwerty123", "qwerty12", "qwertyuiop1", "1q2w3e4r", "1qaz2wsx", "zaq12wsx", "q1w2e3r4",
    "abc12345", "abcd1234", "abcdef12", "test1234", "letmein1", "welcome1", "welcome123",
    "iloveyou1", "admin123", "admin1234", "administrator1", "changeme1", "12345678a", "a12345678",
    "football1", "baseball1", "monkey123", "dragon123", "sunshine1", "princess1", "trustno1",
    "master123", "shadow123", "superman1", "computer1", "learnhouse1",
})


def validate_password_complexity(password: str) -> PasswordValidationResult:
    """Validate a password against the policy above."""
    errors: List[str] = []

    requirements = {
        "min_length": len(password) >= MIN_LENGTH,
        # Any script's letters count, not only A-Z.
        "has_letter": any(ch.isalpha() for ch in password),
        "has_number_or_symbol": any(not ch.isalpha() and not ch.isspace() for ch in password),
        "not_common": password.lower() not in COMMON_PASSWORDS,
    }

    if not requirements["min_length"]:
        errors.append(f"Password must be at least {MIN_LENGTH} characters long")
    if not requirements["has_letter"]:
        errors.append("Password must contain at least one letter")
    if not requirements["has_number_or_symbol"]:
        errors.append("Password must contain at least one number or symbol")
    if not requirements["not_common"]:
        errors.append("This password is too common. Pick something less predictable")

    return PasswordValidationResult(
        is_valid=all(requirements.values()),
        errors=errors,
        requirements=requirements,
    )


def get_password_requirements() -> List[dict]:
    """
    Get list of password requirements for display purposes.

    Returns:
        List of requirement descriptions
    """
    return [
        {"id": "min_length", "description": f"At least {MIN_LENGTH} characters"},
        {"id": "has_letter", "description": "At least one letter"},
        {"id": "has_number_or_symbol", "description": "At least one number or symbol"},
        {"id": "not_common", "description": "Not a commonly used password"},
    ]
