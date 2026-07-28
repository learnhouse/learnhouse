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


class TestEdgeCases:
    async def test_naive_datetimes_are_stamped_utc(self):
        """Aggregates over the naive string columns come back without a zone;
        comparing one to an aware `now` would raise."""
        from datetime import datetime

        from src.services.nudges.snapshot import parse_ts

        parsed = parse_ts(datetime(2026, 7, 28, 12, 0, 0))
        assert parsed is not None and parsed.tzinfo is not None

    async def test_aware_datetimes_pass_through(self):
        from datetime import datetime, timezone

        from src.services.nudges.snapshot import parse_ts

        stamp = datetime(2026, 7, 28, tzinfo=timezone.utc)
        assert parse_ts(stamp) is stamp

    async def test_orgs_without_ids_yield_no_snapshots(self, db):
        """Defensive: an unflushed Organization has no primary key yet."""
        from src.db.organizations import Organization
        from src.services.nudges.eligibility import build_snapshots

        assert await build_snapshots(db, [Organization(name="x", slug="x")]) == []

    async def test_org_base_url_strips_a_trailing_slash(self, monkeypatch):
        """Every CTA concatenates a path onto this, so a trailing slash would
        produce a double slash in the link."""
        from src.services.nudges import links

        async def fake(org_slug, request=None, db_session=None, org_id=None):
            return "https://acme.test/"

        monkeypatch.setattr(links, "get_org_signup_base_url", fake)
        assert await links.org_base_url("acme") == "https://acme.test"


class TestResubscribeThenOptOutAgain:
    async def test_second_opt_out_after_resubscribing_stamps_a_fresh_time(
        self, db, admin_user
    ):
        """The row already exists and its timestamp was cleared on resubscribe,
        so the next opt-out has to stamp it again rather than leave it null."""
        await set_lifecycle_opt_out(db, admin_user.id, opted_out=True)
        await set_lifecycle_opt_out(db, admin_user.id, opted_out=False)

        pref = await set_lifecycle_opt_out(db, admin_user.id, opted_out=True)

        assert pref.lifecycle_opt_out is True
        assert pref.unsubscribed_at is not None


class TestEmptyBatches:
    async def test_recent_send_counts_short_circuits_on_no_users(self, db):
        from datetime import datetime, timezone

        from src.services.nudges.runner import _recent_send_counts

        assert await _recent_send_counts(db, [], datetime.now(timezone.utc)) == {}

    def test_content_cta_prefers_the_newest_course(self):
        from src.services.nudges.catalog import _content_link
        from src.services.nudges.snapshot import OrgSnapshot

        base = dict(org_id=1, org_slug="acme", org_name="Acme", plan="free", lang="en")
        newest = OrgSnapshot(**base, newest_course_uuid="course_new")
        assert _content_link(newest, "https://acme.test") == (
            "https://acme.test/dash/courses/course/new/content"
        )

        # Falls back to the draft when there is no newest course recorded.
        draft_only = OrgSnapshot(**base, oldest_draft_course_uuid="course_draft")
        assert _content_link(draft_only, "https://acme.test").endswith("/draft/content")
