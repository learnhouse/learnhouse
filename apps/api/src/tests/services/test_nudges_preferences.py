"""Tests for src/services/nudges/preferences.py."""

from src.services.nudges.preferences import (
    get_opted_out_user_ids,
    get_user_by_uuid,
    is_opted_out,
    set_lifecycle_opt_out,
)


class TestLookup:
    async def test_get_user_by_uuid(self, db, admin_user):
        found = await get_user_by_uuid(db, admin_user.user_uuid)
        assert found is not None and found.id == admin_user.id

    async def test_get_user_by_uuid_returns_none_when_absent(self, db):
        assert await get_user_by_uuid(db, "user_nope") is None


class TestOptOutState:
    async def test_absence_of_a_row_means_opted_in(self, db, admin_user):
        """No row is the "never asked" state — everyone starts subscribed."""
        assert await is_opted_out(db, admin_user.id) is False

    async def test_set_then_read(self, db, admin_user):
        await set_lifecycle_opt_out(db, admin_user.id)
        assert await is_opted_out(db, admin_user.id) is True

    async def test_resubscribe_clears_the_timestamp(self, db, admin_user):
        await set_lifecycle_opt_out(db, admin_user.id, opted_out=True)
        pref = await set_lifecycle_opt_out(
            db, admin_user.id, opted_out=False, source="dashboard"
        )

        assert pref.lifecycle_opt_out is False
        assert pref.unsubscribed_at is None
        assert pref.source == "dashboard"
        assert await is_opted_out(db, admin_user.id) is False

    async def test_repeat_opt_out_keeps_the_original_timestamp(self, db, admin_user):
        first = await set_lifecycle_opt_out(db, admin_user.id)
        original = first.unsubscribed_at

        second = await set_lifecycle_opt_out(db, admin_user.id)
        assert second.unsubscribed_at == original


class TestBulkOptOutSet:
    async def test_empty_input_avoids_a_query(self, db):
        assert await get_opted_out_user_ids(db, []) == set()

    async def test_returns_only_opted_out_ids(self, db, admin_user, regular_user):
        await set_lifecycle_opt_out(db, admin_user.id)

        result = await get_opted_out_user_ids(db, [admin_user.id, regular_user.id])
        assert result == {admin_user.id}

    async def test_resubscribed_users_drop_out_of_the_set(
        self, db, admin_user, regular_user
    ):
        await set_lifecycle_opt_out(db, admin_user.id)
        await set_lifecycle_opt_out(db, admin_user.id, opted_out=False)

        assert await get_opted_out_user_ids(db, [admin_user.id, regular_user.id]) == set()
