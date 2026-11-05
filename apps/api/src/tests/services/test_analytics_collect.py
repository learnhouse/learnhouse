"""Tests for src/services/analytics/collect.py (beacon validation and privacy)."""

from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from src.db.analytics import AnalyticsSettings
from src.services.analytics import collect
from src.services.analytics import settings as analytics_settings

SECRET = "s" * 32
BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15"


@pytest.fixture(autouse=True)
def _clear_caches():
    collect._org_cache.clear()
    collect._membership_cache.clear()
    analytics_settings._cache.clear()
    yield
    collect._org_cache.clear()
    collect._membership_cache.clear()
    analytics_settings._cache.clear()


def _ctx(org_id=1, user_id=0, ua=BROWSER, headers=None):
    headers = {"origin": "https://acme.learnhouse.app", "cf-ipcountry": "de", **(headers or {})}
    return collect.BeaconContext(
        org_id=org_id, user_id=user_id, session_id="sess", ip="198.51.100.23",
        user_agent=ua, headers=headers, secret=SECRET,
    )


class TestHelpers:
    @pytest.mark.parametrize(
        "ua,bot",
        [
            ("", True),
            ("Googlebot/2.1 (+http://www.google.com/bot.html)", True),
            ("Mozilla/5.0 HeadlessChrome/120.0", True),
            ("python-requests/2.31", True),
            (BROWSER, False),
        ],
    )
    def test_is_bot(self, ua, bot):
        assert collect.is_bot(ua) is bot

    @pytest.mark.parametrize(
        "ua,device",
        [
            ("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", "tablet"),
            ("Mozilla/5.0 (Linux; Android 14; SM-X710)", "tablet"),
            ("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari", "mobile"),
            ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", "mobile"),
            (BROWSER, "desktop"),
        ],
    )
    def test_device_type(self, ua, device):
        assert collect.device_type(ua) == device

    def test_country_from_headers(self):
        assert collect.country_from_headers({"cf-ipcountry": "fr"}) == "FR"
        assert collect.country_from_headers({"cf-ipcountry": "XX", "x-vercel-ip-country": "MA"}) == "MA"
        assert collect.country_from_headers({"cf-ipcountry": "T1"}) is None
        assert collect.country_from_headers({"x-country-code": "France"}) is None
        assert collect.country_from_headers({}) is None

    def test_visitor_key_rotates_daily_and_is_scoped_to_org(self):
        day1 = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
        day1_later = datetime(2026, 1, 1, 23, tzinfo=timezone.utc)
        day2 = datetime(2026, 1, 2, 1, tzinfo=timezone.utc)
        key = collect.visitor_key(SECRET, 1, "203.0.113.9", BROWSER, day1)
        assert key.startswith("v:") and len(key) == 22
        assert collect.visitor_key(SECRET, 1, "203.0.113.9", BROWSER, day1_later) == key
        assert collect.visitor_key(SECRET, 1, "203.0.113.9", BROWSER, day2) != key
        assert collect.visitor_key(SECRET, 2, "203.0.113.9", BROWSER, day1) != key
        # Same /24 is the same visitor input: the full address is never used.
        assert collect.visitor_key(SECRET, 1, "203.0.113.200", BROWSER, day1) == key
        assert collect.visitor_key(SECRET, 1, "unknown", BROWSER).startswith("v:")

    def test_truncate_ip(self):
        assert collect._truncate_ip("203.0.113.77") == "203.0.113.0"
        assert collect._truncate_ip("2001:db8:abcd:12:1::5") == "2001:db8:abcd::"
        assert collect._truncate_ip("not-an-ip") == "not-an-ip"

    def test_referrer_domain(self):
        own = {"acme.learnhouse.app"}
        assert collect.referrer_domain("https://www.Google.com/search?q=x", own) == "google.com"
        assert collect.referrer_domain("t.co", own) == "t.co"
        assert collect.referrer_domain("https://acme.learnhouse.app/courses", own) is None
        assert collect.referrer_domain("", own) is None
        assert collect.referrer_domain(None, own) is None
        assert collect.referrer_domain("https://", own) is None

    def test_own_hosts(self):
        hosts = collect.own_hosts(
            {"origin": "https://www.acme.io", "referer": "https://acme.io/x", "host": "api.acme.io:8000", "x-forwarded-host": ""}
        )
        assert hosts == {"acme.io", "api.acme.io"}


class TestLookups:
    async def test_org_exists_is_cached(self, db, org):
        assert await collect.org_exists(org.id, db) is True
        assert await collect.org_exists(999, db) is False
        with patch.object(db, "execute") as execute:
            assert await collect.org_exists(org.id, db) is True
            assert await collect.org_exists(999, db) is False
        execute.assert_not_called()

    async def test_membership(self, db, org, admin_user, regular_user):
        assert await collect.membership(admin_user.id, org.id, db) == (True, True)
        assert await collect.membership(regular_user.id, org.id, db) == (True, False)
        assert await collect.membership(12345, org.id, db) == (False, False)
        with patch.object(db, "execute") as execute:
            assert await collect.membership(admin_user.id, org.id, db) == (True, True)
        execute.assert_not_called()


class TestBuildWebRows:
    async def test_anonymous_public_events_only(self, db, org):
        rows = await collect.build_web_rows(
            _ctx(),
            [
                ("page_view", {"path": "/courses", "referrer": "https://www.google.com/"}),
                ("course_view", {"course_uuid": "course_1"}),
                ("time_on_activity", {"seconds_spent": 30}),  # members only
                ("course_enrolled", {}),  # server-side only
                ("unknown", {}),
                ("search_query", "not a dict"),
            ],
            db,
        )
        assert [r["event_name"] for r in rows] == ["page_view", "course_view", "search_query"]
        page_view = rows[0]
        assert page_view["user_id"] == 0
        assert page_view["actor_key"].startswith("v:")
        assert page_view["country"] == "DE"
        assert page_view["device"] == "desktop"
        assert page_view["referrer_domain"] == "google.com"
        assert page_view["source"] == "web"
        assert len({r["actor_key"] for r in rows}) == 1

    async def test_batch_size_is_capped(self, db, org):
        events = [("page_view", {"path": f"/{i}"}) for i in range(collect.MAX_EVENTS_PER_BATCH + 5)]
        assert len(await collect.build_web_rows(_ctx(), events, db)) == collect.MAX_EVENTS_PER_BATCH

    async def test_bots_and_unknown_orgs_are_dropped(self, db, org):
        assert await collect.build_web_rows(_ctx(ua="Googlebot"), [("page_view", {})], db) == []
        assert await collect.build_web_rows(_ctx(org_id=404), [("page_view", {})], db) == []

    async def test_member_events_are_attributed(self, db, org, regular_user):
        rows = await collect.build_web_rows(
            _ctx(user_id=regular_user.id),
            [("time_on_activity", {"seconds_spent": 45, "activity_uuid": "a1"})],
            db,
        )
        assert rows[0]["user_id"] == regular_user.id
        assert rows[0]["actor_key"] == f"u:{regular_user.id}"
        assert rows[0]["seconds_spent"] == 45

    async def test_non_members_are_counted_anonymously(self, db, org, other_org, regular_user):
        rows = await collect.build_web_rows(
            _ctx(org_id=other_org.id, user_id=regular_user.id), [("page_view", {"path": "/"})], db
        )
        assert rows[0]["user_id"] == 0
        assert rows[0]["actor_key"].startswith("v:")

    async def test_org_settings_are_applied(self, db, org, admin_user):
        db.add(AnalyticsSettings(org_id=org.id, track_anonymous=False, collect_location=False, exclude_staff=True))
        await db.commit()

        assert await collect.build_web_rows(_ctx(), [("page_view", {})], db) == []

        rows = await collect.build_web_rows(
            _ctx(user_id=admin_user.id),
            [("page_view", {"path": "/"}), ("search_query", {"query": "python", "results_count": 3})],
            db,
        )
        # Staff browsing is left out; their searches still count. No country stored.
        assert [r["event_name"] for r in rows] == ["search_query"]
        assert rows[0]["country"] is None
        assert rows[0]["properties"] == {"query": "python", "results_count": 3}
