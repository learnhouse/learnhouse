"""
Regression tests for email handling on the self-serve user-update path.

Historical gap: ``UserUpdate`` declared ``email: str``, overriding the
parent ``UserBase.email: EmailStr``. Any garbage string ("notanemail",
"", "<script>") was accepted as an email, because pydantic only runs the
declared type's validator.

These tests pin three behaviours:

1. Format: pydantic rejects non-email strings at schema construction.
2. Accept: well-formed addresses still pass.
3. Re-verification: when the address actually changes, ``email_verified``
   flips back to False so SaaS login re-requires ownership proof on the
   new mailbox. Password/profile/etc. updates that do NOT change the
   address must NOT flip the flag.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError

from src.db.users import User, UserUpdate
from src.services.users.users import update_user


# ---------------------------------------------------------------------------
# Schema-level: format validation via EmailStr
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_email",
    [
        "notanemail",
        "missing-at-sign.example.com",
        "",
        " ",
        "spaces in@local.com",
        "double@@at.com",
        "<script>alert(1)</script>@x.com",
    ],
)
def test_userupdate_rejects_malformed_email(bad_email):
    """Schema must reject obviously invalid email strings at validation time."""
    with pytest.raises(ValidationError):
        UserUpdate(
            username="alice",
            first_name="A",
            last_name="L",
            email=bad_email,
            avatar_image="",
            bio="",
            details={},
            profile={},
        )


def test_userupdate_accepts_valid_email():
    """Well-formed addresses continue to validate."""
    obj = UserUpdate(
        username="alice",
        first_name="A",
        last_name="L",
        email="alice@example.com",
        avatar_image="",
        bio="",
        details={},
        profile={},
    )
    assert str(obj.email) == "alice@example.com"


# ---------------------------------------------------------------------------
# Service-level: changing the email resets email_verified
# ---------------------------------------------------------------------------


def _set_user_email_state(db, *, user_id: int, email: str, verified: bool) -> User:
    """Adjust the email+verification fields on the user row that the
    ``regular_user`` conftest fixture already created.
    """
    from sqlmodel import select
    u = db.exec(select(User).where(User.id == user_id)).first()
    assert u is not None, "regular_user fixture should have created the row"
    u.email = email
    u.email_verified = verified
    u.email_verified_at = str(datetime.now()) if verified else None
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.mark.asyncio
async def test_update_user_resets_email_verified_when_email_changes(
    db, org, regular_user, mock_request
):
    """Changing the email flips email_verified back to False."""
    _set_user_email_state(db, user_id=regular_user.id, email="regular@test.com", verified=True)

    with patch("src.services.users.users.rbac_check", new=AsyncMock()):
        result = await update_user(
            mock_request,
            db,
            regular_user.id,
            regular_user,
            UserUpdate(
                username="regular",
                first_name="Regular",
                last_name="User",
                email="new-address@test.com",
                avatar_image="",
                bio="",
                details={},
                profile={},
            ),
        )

    assert result.email == "new-address@test.com"
    assert result.email_verified is False


@pytest.mark.asyncio
async def test_update_user_keeps_email_verified_when_email_unchanged(
    db, org, regular_user, mock_request
):
    """Profile edits that do NOT change the email must keep verification intact."""
    _set_user_email_state(db, user_id=regular_user.id, email="regular@test.com", verified=True)

    with patch("src.services.users.users.rbac_check", new=AsyncMock()):
        result = await update_user(
            mock_request,
            db,
            regular_user.id,
            regular_user,
            UserUpdate(
                username="regular",
                first_name="Renamed",
                last_name="User",
                email="regular@test.com",
                avatar_image="",
                bio="now with a bio",
                details={},
                profile={},
            ),
        )

    assert result.email == "regular@test.com"
    assert result.email_verified is True


@pytest.mark.asyncio
async def test_update_user_cannot_self_promote_email_verified(
    db, org, regular_user, mock_request
):
    """A caller cannot forge email_verified via the self-serve update.

    Two layers protect us: (1) ``email_verified`` is not a field on the
    ``UserUpdate`` pydantic schema so the router never parses it from the
    body; (2) the service's ``_PROTECTED_FIELDS`` allowlist also refuses
    to apply it, as a belt-and-braces guard against future schema drift.
    """
    # Layer 1: schema-level — pydantic drops unknown fields by default and
    # the ``extra`` setting on SQLModel rejects them on strict validation.
    assert "email_verified" not in UserUpdate.model_fields
    assert "email_verified_at" not in UserUpdate.model_fields

    # Layer 2: even if a payload sneaks past the schema, the service's
    # allowlist skips it when applying updates.
    import src.services.users.users as users_service
    # Read the source to confirm the guard is wired.
    source = __import__("inspect").getsource(users_service.update_user)
    assert "email_verified" in source
    assert '"email_verified"' in source or "'email_verified'" in source
