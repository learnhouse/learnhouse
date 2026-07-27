"""Org-defined custom signup fields.

An organization can declare extra fields to collect on its signup form. The
answers are stored on the user's ``extra_metadata`` JSON, keyed by each field's
``key``.

SECURITY — why the server builds the stored dict itself:

``UserCreate`` inherits ``extra_metadata`` from ``UserBase``, and the signup
endpoints are public. If the submitted blob were written straight through, an
anonymous caller could persist arbitrary JSON of arbitrary size on a user row.
So the signup path never trusts ``extra_metadata``: it is stripped, and this
module rebuilds the dict from the org's declared fields alone. A key the org did
not declare is dropped rather than rejected, so a stale cached form does not
break signup for a real user.

The field definitions live in the org config JSON, which is served publicly by
``GET /orgs/slug/{slug}`` — labels and options are public strings.
"""

from typing import Any, Optional

from fastapi import HTTPException

from src.db.organization_config import SignupFieldItem
from src.services.security.profile_validation import contains_url

# Bounds applied on top of whatever the org configured, so a permissive (or
# absent) per-field limit still cannot be used to store an unbounded blob.
MAX_TEXT_LENGTH = 2_000
MAX_TOTAL_SERIALIZED_BYTES = 16_000
MAX_FIELDS = 40


def get_signup_fields(config: Optional[dict]) -> list[SignupFieldItem]:
    """Read an org's declared signup fields from its config.

    Handles both config shapes: v2 keeps customization under ``customization``,
    v1 under ``general`` (same dual lookup the signup-mode read already does).
    Returns only enabled fields, in display order. Malformed entries are skipped
    rather than raising — a bad config must not take signup down.
    """
    if not config:
        return []

    section: Any = None
    if str(config.get("config_version", "1.0")).startswith("2"):
        section = (config.get("customization") or {}).get("signup_fields")
    else:
        section = (config.get("general") or {}).get("signup_fields")

    raw_fields = (section or {}).get("fields") or []
    if not isinstance(raw_fields, list):
        return []

    fields: list[SignupFieldItem] = []
    for raw in raw_fields[:MAX_FIELDS]:
        if not isinstance(raw, dict):
            continue
        try:
            field = SignupFieldItem(**raw)
        except Exception:
            continue
        if not field.key or not field.enabled:
            continue
        fields.append(field)

    return sorted(fields, key=lambda f: f.order)


def missing_required_fields(
    fields: list[SignupFieldItem], stored: Optional[dict]
) -> list[SignupFieldItem]:
    """Required fields a user has not answered yet.

    Drives the post-OAuth "complete your profile" step: Google sign-in never
    renders the signup form, so those users arrive with required fields unset.
    """
    answers = stored or {}
    missing = []
    for field in fields:
        if not field.required:
            continue
        value = answers.get(field.key)
        if field.type == "checkbox":
            if not value:
                missing.append(field)
        elif _is_blank(value):
            missing.append(field)
    return missing


def _field_error(field: SignupFieldItem, message: str) -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={
            "code": "SIGNUP_FIELD_INVALID",
            "message": message,
            "field": field.key,
        },
    )


def _coerce_text(field: SignupFieldItem, value: Any) -> str:
    text = str(value).strip()
    limit = min(field.max_length or MAX_TEXT_LENGTH, MAX_TEXT_LENGTH)
    if len(text) > limit:
        raise _field_error(field, f"{field.label or field.key} is too long")
    # Public free-text on a signup form is a standard spam/phishing relay, the
    # same reason display-name fields reject links.
    if contains_url(text):
        raise _field_error(
            field, f"{field.label or field.key} may not contain a URL or link"
        )
    return text


def _coerce_number(field: SignupFieldItem, value: Any) -> float | int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise _field_error(field, f"{field.label or field.key} must be a number")
    if number != number or number in (float("inf"), float("-inf")):
        raise _field_error(field, f"{field.label or field.key} must be a number")
    if field.min_value is not None and number < field.min_value:
        raise _field_error(
            field, f"{field.label or field.key} must be at least {field.min_value}"
        )
    if field.max_value is not None and number > field.max_value:
        raise _field_error(
            field, f"{field.label or field.key} must be at most {field.max_value}"
        )
    # Keep whole numbers as ints so the stored JSON reads naturally.
    return int(number) if number.is_integer() else number


def _coerce_checkbox(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"true", "1", "yes", "on"}


def _coerce_date(field: SignupFieldItem, value: Any) -> str:
    from datetime import date

    text = str(value).strip()
    try:
        # Stored as an ISO date string; parsed here purely to validate.
        date.fromisoformat(text)
    except ValueError:
        raise _field_error(
            field, f"{field.label or field.key} must be a date (YYYY-MM-DD)"
        )
    return text


def _is_blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def validate_signup_field_values(
    fields: list[SignupFieldItem],
    submitted: Optional[dict],
    enforce_required: bool = True,
) -> dict:
    """Build the ``extra_metadata`` dict for a signup from declared fields only.

    Raises HTTP 400 when a required field is missing or a value fails its type's
    rules. Keys the org did not declare are ignored.

    ``enforce_required`` is False on the OAuth path, which never renders the
    signup form and so cannot supply required answers up front — those users are
    asked to complete their profile afterwards. Values that ARE supplied are
    still validated either way.
    """
    if not fields:
        return {}

    values: dict[str, Any] = submitted if isinstance(submitted, dict) else {}
    cleaned: dict[str, Any] = {}

    for field in fields:
        raw = values.get(field.key)

        if field.type == "checkbox":
            checked = _coerce_checkbox(raw)
            # A required checkbox is a consent gate — unticked means not given.
            if field.required and enforce_required and not checked:
                raise _field_error(field, f"{field.label or field.key} is required")
            cleaned[field.key] = checked
            continue

        if _is_blank(raw):
            if field.required and enforce_required:
                raise _field_error(field, f"{field.label or field.key} is required")
            continue

        if field.type == "select":
            choice = str(raw).strip()
            if choice not in field.options:
                raise _field_error(
                    field, f"{field.label or field.key} is not one of the allowed options"
                )
            cleaned[field.key] = choice
        elif field.type == "number":
            cleaned[field.key] = _coerce_number(field, raw)
        elif field.type == "date":
            cleaned[field.key] = _coerce_date(field, raw)
        else:  # text, textarea
            cleaned[field.key] = _coerce_text(field, raw)

    # Belt-and-braces ceiling on what one signup can persist, independent of how
    # many fields the org declared or how generous their individual limits are.
    import json

    if len(json.dumps(cleaned).encode("utf-8")) > MAX_TOTAL_SERIALIZED_BYTES:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "SIGNUP_FIELDS_TOO_LARGE",
                "message": "Submitted signup fields are too large",
            },
        )

    return cleaned


async def get_org_signup_fields(org_id: int, db_session) -> list[SignupFieldItem]:
    """The org's declared signup fields, read from its config row."""
    from sqlmodel import select

    from src.db.organization_config import OrganizationConfig

    row = (
        await db_session.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
        )
    ).scalars().first()
    return get_signup_fields(row.config if row else None)


async def complete_signup_fields_for_user(
    org_id: int,
    user_id: int,
    submitted: Optional[dict],
    db_session,
) -> dict:
    """Store a signed-in user's answers to the org's signup fields.

    This is the post-OAuth completion path: Google sign-in skips the signup
    form, so those users answer here instead. The caller must already be
    authenticated and a member of the org — the router enforces both.

    Values go through the same validation as signup, so this endpoint is not a
    way around it. Existing answers are merged, not replaced, so a partial
    submission cannot wipe what is already stored.
    """
    from sqlalchemy.orm.attributes import flag_modified
    from sqlmodel import select

    from src.db.users import User

    fields = await get_org_signup_fields(org_id, db_session)
    if not fields:
        return {}

    values = validate_signup_field_values(fields, submitted)

    user = (
        await db_session.execute(select(User).where(User.id == user_id))
    ).scalars().first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    merged = dict(user.extra_metadata or {})
    merged.update(values)
    user.extra_metadata = merged
    # extra_metadata is a JSON column reassigned in place; without this the ORM
    # can miss the change (same reason the video service flags it).
    flag_modified(user, "extra_metadata")

    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    return merged
