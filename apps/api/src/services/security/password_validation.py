"""
Password validation service for enforcing strong password requirements.

Requirements:
- Minimum 8 characters
- At least 1 uppercase letter
- At least 1 lowercase letter
- At least 1 number
- At least 1 special character
"""
import re
from typing import List
from pydantic import BaseModel


class PasswordValidationResult(BaseModel):
    """Result of password validation."""
    is_valid: bool
    errors: List[str]
    requirements: dict


# Special characters allowed in passwords
SPECIAL_CHARACTERS = "!@#$%^&*()_+-=[]{}|;':\",./<>?"


def validate_password_complexity(password: str) -> PasswordValidationResult:
    """
    Validate password against complexity requirements.

    Requirements:
    - Minimum 8 characters
    - At least 1 uppercase letter
    - At least 1 lowercase letter
    - At least 1 number
    - At least 1 special character

    Returns:
        PasswordValidationResult with validation status and any errors
    """
    errors: List[str] = []

    requirements = {
        "min_length": False,
        "has_uppercase": False,
        "has_lowercase": False,
        "has_number": False,
        "has_special": False,
    }

    # Check minimum length (8 characters)
    if len(password) >= 8:
        requirements["min_length"] = True
    else:
        errors.append("Password must be at least 8 characters long")

    # Check for uppercase letter
    if re.search(r'[A-Z]', password):
        requirements["has_uppercase"] = True
    else:
        errors.append("Password must contain at least one uppercase letter")

    # Check for lowercase letter
    if re.search(r'[a-z]', password):
        requirements["has_lowercase"] = True
    else:
        errors.append("Password must contain at least one lowercase letter")

    # Check for number
    if re.search(r'[0-9]', password):
        requirements["has_number"] = True
    else:
        errors.append("Password must contain at least one number")

    # Check for special character
    if re.search(r'[!@#$%^&*()_+\-=\[\]{}|;\':",./<>?]', password):
        requirements["has_special"] = True
    else:
        errors.append("Password must contain at least one special character (!@#$%^&*...)")

    is_valid = all(requirements.values())

    return PasswordValidationResult(
        is_valid=is_valid,
        errors=errors,
        requirements=requirements
    )


def get_password_requirements() -> List[dict]:
    """
    Get list of password requirements for display purposes.

    Returns:
        List of requirement descriptions
    """
    return [
        {"id": "min_length", "description": "At least 8 characters"},
        {"id": "has_uppercase", "description": "At least one uppercase letter (A-Z)"},
        {"id": "has_lowercase", "description": "At least one lowercase letter (a-z)"},
        {"id": "has_number", "description": "At least one number (0-9)"},
        {"id": "has_special", "description": "At least one special character (!@#$%^&*...)"},
    ]
