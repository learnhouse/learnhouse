"""
Regression coverage for CWE-613 on the self-service password change.

``PUT /users/change_password/{user_id}`` used to rewrite the hash and nothing
else: it never stamped ``password_changed_at``, so a token stolen before the
change kept working for its full lifetime (and its refresh token kept minting
new ones for 30 days). The reset-code flow already stamped it; this path did
not. Both the stamp and the Redis revocation cutoff are pinned here, because
either one silently failing restores the vulnerability.
"""

from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from src.db.users import User, UserUpdatePassword
from src.security.security import security_hash_password
from src.services.users.users import update_user_password


@pytest.mark.asyncio
async def test_password_change_stamps_password_changed_at(
    mock_request, db, admin_user
):
    user = await db.get(User, admin_user.id)
    user.password = security_hash_password("old-password")
    user.password_changed_at = None
    db.add(user)
    await db.commit()

    before = datetime.now(timezone.utc).replace(tzinfo=None)

    await update_user_password(
        mock_request,
        db,
        admin_user,
        admin_user.id,
        UserUpdatePassword(
            old_password="old-password",
            new_password="NewPassword123!",
        ),
    )

    refreshed = await db.get(User, admin_user.id)
    assert refreshed is not None
    assert refreshed.password_changed_at is not None, (
        "password_changed_at must be stamped — get_current_user and "
        "/auth/refresh use it to reject tokens minted before the change"
    )
    assert refreshed.password_changed_at >= before


@pytest.mark.asyncio
async def test_password_change_revokes_existing_sessions(
    mock_request, db, admin_user
):
    user = await db.get(User, admin_user.id)
    user.password = security_hash_password("old-password")
    db.add(user)
    await db.commit()

    with patch(
        "src.security.auth.revoke_user_sessions_before", return_value=True
    ) as revoke:
        await update_user_password(
            mock_request,
            db,
            admin_user,
            admin_user.id,
            UserUpdatePassword(
                old_password="old-password",
                new_password="NewPassword123!",
            ),
        )

    revoke.assert_called_once_with(admin_user.id)


@pytest.mark.asyncio
async def test_password_change_survives_revocation_store_failure(
    mock_request, db, admin_user
):
    """Redis being down must not block the password change — the DB stamp is
    the load-bearing half of the fix."""
    user = await db.get(User, admin_user.id)
    user.password = security_hash_password("old-password")
    user.password_changed_at = None
    db.add(user)
    await db.commit()

    with patch(
        "src.security.auth.revoke_user_sessions_before",
        side_effect=RuntimeError("redis down"),
    ):
        result = await update_user_password(
            mock_request,
            db,
            admin_user,
            admin_user.id,
            UserUpdatePassword(
                old_password="old-password",
                new_password="NewPassword123!",
            ),
        )

    assert result.id == admin_user.id
    refreshed = await db.get(User, admin_user.id)
    assert refreshed is not None and refreshed.password_changed_at is not None
