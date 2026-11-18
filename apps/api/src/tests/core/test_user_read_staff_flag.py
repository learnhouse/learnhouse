"""UserRead accepts the pre-Backoffice staff flag from cached session data."""

from src.db.users import UserRead

BASE = {"username": "u", "first_name": "", "last_name": "", "email": "u@example.com", "id": 1, "user_uuid": "user_1"}


def test_legacy_is_superadmin_is_read():
    user = UserRead.model_validate({**BASE, "is_superadmin": True})
    assert user.is_backoffice_staff is True
    assert user.is_superadmin is True


def test_new_flag_wins_and_default_is_false():
    assert UserRead.model_validate({**BASE, "is_backoffice_staff": False, "is_superadmin": True}).is_backoffice_staff is False
    assert UserRead.model_validate(BASE).is_backoffice_staff is False
