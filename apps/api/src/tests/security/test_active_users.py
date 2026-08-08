"""Tests for active-user tracking + billing (src/security/features_utils/active_users.py)."""

from contextlib import ExitStack
from datetime import date
from unittest.mock import patch

import pytest

from src.db.user_activity import UserActivityDay
from src.db.user_organizations import UserOrganization
from src.security.features_utils.active_users import (
    ACTIVE_USER_OVERAGE_PRICE_USD,
    calculate_active_user_overage,
    count_active_users,
    get_active_user_summary,
    get_all_orgs_with_active_user_overage,
    get_member_active_status,
    get_visit_days_for_users,
)

ORG = 1
OTHER_ORG = 2


def _mode(mode: str):
    """Patch deployment mode everywhere it is resolved.

    usage.py binds get_deployment_mode at import time (module attr), while
    plans.py imports it per-call (source attr) — patch both so limits and the
    saas gate agree.
    """
    stack = ExitStack()
    stack.enter_context(
        patch("src.core.deployment_mode.get_deployment_mode", return_value=mode)
    )
    stack.enter_context(
        patch("src.security.features_utils.usage.get_deployment_mode", return_value=mode)
    )
    return stack


def _saas():
    return _mode("saas")


def _oss():
    return _mode("oss")


async def _add_days(db, org_id, user_id, days: list[date]):
    for d in days:
        db.add(UserActivityDay(org_id=org_id, user_id=user_id, activity_date=d))
    await db.commit()


async def _add_member(db, org_id, user_id, creation_date="2026-01-01"):
    """Add a member. Join order decides which members the plan's seats cover,
    so callers that care about the cohort pass an explicit creation_date;
    otherwise insertion order (the id tie-break) settles it."""
    db.add(
        UserOrganization(
            user_id=user_id, org_id=org_id, role_id=1,
            creation_date=creation_date, update_date=creation_date,
        )
    )
    await db.commit()


class TestCountActiveUsers:
    async def test_threshold_two_distinct_days(self, db):
        await _add_days(db, ORG, 10, [date(2026, 7, 1), date(2026, 7, 2)])   # active
        await _add_days(db, ORG, 11, [date(2026, 7, 5)])                      # 1 day -> not
        await _add_days(db, ORG, 12, [date(2026, 7, 3), date(2026, 7, 9), date(2026, 7, 20)])  # active
        assert await count_active_users(ORG, 2026, 7, db) == 2

    async def test_month_boundary_is_respected(self, db):
        # One day in July, one in August -> not active in either month.
        await _add_days(db, ORG, 20, [date(2026, 7, 31), date(2026, 8, 1)])
        assert await count_active_users(ORG, 2026, 7, db) == 0
        assert await count_active_users(ORG, 2026, 8, db) == 0

    async def test_org_scoped(self, db):
        await _add_days(db, ORG, 30, [date(2026, 7, 1), date(2026, 7, 2)])
        await _add_days(db, OTHER_ORG, 30, [date(2026, 7, 1), date(2026, 7, 2)])
        assert await count_active_users(ORG, 2026, 7, db) == 1
        assert await count_active_users(OTHER_ORG, 2026, 7, db) == 1

    async def test_same_day_is_deduped_by_unique_constraint(self, db):
        from sqlalchemy.exc import IntegrityError
        await _add_days(db, ORG, 40, [date(2026, 7, 1)])
        db.add(UserActivityDay(org_id=ORG, user_id=40, activity_date=date(2026, 7, 1)))
        with pytest.raises(IntegrityError):
            await db.commit()
        await db.rollback()
        # Still just one day -> not active.
        assert await count_active_users(ORG, 2026, 7, db) == 0


class TestMemberActiveStatus:
    async def test_zero_visit_members_appear(self, db):
        await _add_member(db, ORG, 100)   # no activity
        await _add_member(db, ORG, 101)   # active
        await _add_days(db, ORG, 101, [date(2026, 7, 1), date(2026, 7, 4)])

        status = await get_member_active_status(ORG, 2026, 7, db)
        assert status[100] == {"visit_days": 0, "is_active": False}
        assert status[101] == {"visit_days": 2, "is_active": True}

    async def test_visit_days_for_users_targeted(self, db):
        await _add_days(db, ORG, 200, [date(2026, 7, 1), date(2026, 7, 2), date(2026, 7, 3)])
        await _add_days(db, ORG, 201, [date(2026, 7, 1)])
        result = await get_visit_days_for_users(ORG, [200, 201, 999], 2026, 7, db)
        assert result == {200: 3, 201: 1}  # 999 absent (no activity)


class TestOverage:
    """The plan's included seats are paid for by the subscription whatever their
    holders do. Only members held BEYOND those seats can ever cost anything, and
    only if they were active."""

    async def test_only_the_members_past_the_included_seats_are_billed(self, db):
        # 5 members, all active. With 3 included, the last 2 to join are billable.
        for uid in range(300, 305):
            await _add_member(db, ORG, uid)
            await _add_days(db, ORG, uid, [date(2026, 7, 1), date(2026, 7, 2)])
        out = await calculate_active_user_overage(ORG, 2026, 7, plan_limit=3, db_session=db)
        assert out["active_users"] == 5
        assert out["members_beyond_included"] == 2
        assert out["overage_units"] == 2
        assert out["overage_usd"] == 2 * ACTIVE_USER_OVERAGE_PRICE_USD

    async def test_dormant_members_past_the_seats_cost_nothing(self, db):
        # 5 members, 3 included. The 2 beyond the seats never showed up.
        for uid in range(330, 335):
            await _add_member(db, ORG, uid)
        for uid in range(330, 333):  # only the included ones are active
            await _add_days(db, ORG, uid, [date(2026, 7, 1), date(2026, 7, 2)])
        out = await calculate_active_user_overage(ORG, 2026, 7, plan_limit=3, db_session=db)
        assert out["members_beyond_included"] == 2
        assert out["overage_units"] == 0

    async def test_activity_inside_the_seats_does_not_offset_the_excess(self, db):
        """The included seats are not a pool that busy members eat into: an org
        over its member count pays for its active extras regardless."""
        for uid in range(340, 346):  # 6 members
            await _add_member(db, ORG, uid)
        for uid in (340, 341, 345):  # 2 included active, 1 beyond active
            await _add_days(db, ORG, uid, [date(2026, 7, 1), date(2026, 7, 2)])
        out = await calculate_active_user_overage(ORG, 2026, 7, plan_limit=5, db_session=db)
        assert out["active_users"] == 3
        assert out["overage_units"] == 1

    async def test_within_the_included_count_nothing_is_billable(self, db):
        """However active a small org is, it owes nothing while it fits its plan."""
        for uid in range(310, 315):
            await _add_member(db, ORG, uid)
            await _add_days(db, ORG, uid, [date(2026, 7, i) for i in range(1, 20)])
        out = await calculate_active_user_overage(ORG, 2026, 7, plan_limit=200, db_session=db)
        assert out["members_beyond_included"] == 0
        assert out["overage_units"] == 0
        assert out["overage_usd"] == 0

    async def test_unlimited_plan_never_overages(self, db):
        for uid in range(320, 325):
            await _add_member(db, ORG, uid)
            await _add_days(db, ORG, uid, [date(2026, 7, 1), date(2026, 7, 2)])
        out = await calculate_active_user_overage(ORG, 2026, 7, plan_limit=0, db_session=db)
        assert out["overage_units"] == 0
        assert out["limit"] == "unlimited"

    async def test_members_who_joined_after_the_month_are_not_ranked(self, db):
        """Billing a past month must not rank people who weren't there yet."""
        from src.security.features_utils.active_users import get_members_beyond_included

        for uid in range(350, 353):
            await _add_member(db, ORG, uid, creation_date="2026-07-02 10:00:00")
        for uid in range(360, 366):
            await _add_member(db, ORG, uid, creation_date="2026-09-01 10:00:00")
        excess = await get_members_beyond_included(ORG, 2026, 7, plan_limit=2, db_session=db)
        # Only the three July members are ranked; one sits beyond the 2 included.
        assert excess == [352]


class TestSummaryAndBatch:
    async def test_summary_non_saas_has_no_overage(self, db):
        for uid in range(400, 415):  # 15 active users
            await _add_days(db, ORG, uid, [date(2026, 7, 1), date(2026, 7, 2)])
        with _oss():
            summary = await get_active_user_summary(ORG, db, year=2026, month=7)
        assert summary["plan_limit"] == 0
        assert summary["overage_units"] == 0

    async def test_summary_saas_free_plan_limit(self, db):
        # No org config row -> plan falls back to "free" (10 included members).
        for uid in range(500, 512):  # 12 members, all active
            await _add_member(db, ORG, uid)
            await _add_days(db, ORG, uid, [date(2026, 7, 1), date(2026, 7, 2)])
        with _saas():
            summary = await get_active_user_summary(ORG, db, year=2026, month=7)
        assert summary["plan"] == "free"
        assert summary["plan_limit"] == 10
        assert summary["active_users"] == 12
        assert summary["members_beyond_included"] == 2
        assert summary["overage_units"] == 2

    async def test_batch_only_returns_orgs_over_limit(self, db):
        # ORG holds more members than free includes (12 > 10); OTHER_ORG fits (3).
        for uid in range(600, 612):
            await _add_member(db, ORG, uid)
            await _add_days(db, ORG, uid, [date(2026, 7, 1), date(2026, 7, 2)])
        for uid in range(700, 703):
            await _add_member(db, OTHER_ORG, uid)
            await _add_days(db, OTHER_ORG, uid, [date(2026, 7, 1), date(2026, 7, 2)])
        with _saas():
            rows = await get_all_orgs_with_active_user_overage(2026, 7, db)
        org_ids = {r["org_id"] for r in rows}
        assert ORG in org_ids
        assert OTHER_ORG not in org_ids


class TestRecordActivity:
    async def test_oss_is_noop(self):
        """Plain OSS has no consumer for the rows, so it must not write them."""
        from src.services.security import activity
        called = {"db": False}

        async def _fail_insert(*a, **k):
            called["db"] = True

        with _oss(), patch.object(activity, "_insert_activity_row", _fail_insert):
            await activity.record_user_activity(1, org_id=ORG)
        assert called["db"] is False

    async def test_ee_records(self):
        """Self-hosted enterprise must record.

        Enterprise deployments report their own active-user count, and that
        count reads this table. While recording was SaaS-only the number was
        structurally zero on every self-hosted install.
        """
        from src.services.security import activity
        called = {"db": False}

        async def _spy_insert(*a, **k):
            called["db"] = True

        with _mode("ee"), patch.object(activity, "_insert_activity_row", _spy_insert):
            await activity.record_user_activity(1, org_id=ORG)
        assert called["db"] is True

    async def test_no_org_ref_is_noop(self):
        from src.services.security import activity
        called = {"db": False}

        async def _fail_insert(*a, **k):
            called["db"] = True

        # No org id/slug/uuid resolvable -> nothing recorded.
        with _saas(), patch.object(activity, "_insert_activity_row", _fail_insert):
            await activity.record_user_activity(1)
        assert called["db"] is False

    async def test_never_raises_on_failure(self):
        from src.services.security import activity

        async def _boom(*a, **k):
            raise RuntimeError("db down")

        # Even if the DB insert path explodes, the caller must not see it.
        with _saas(), patch.object(activity, "_insert_activity_row", _boom):
            await activity.record_user_activity(1, org_id=ORG)  # must not raise


# ---------------------------------------------------------------------------
# Activity capture internals (src/services/security/activity.py)
# ---------------------------------------------------------------------------

from types import SimpleNamespace  # noqa: E402
import asyncio  # noqa: E402

from sqlmodel import select, func as _func  # noqa: E402


class _FactoryCM:
    """Async CM that yields the test session without closing it."""
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, *a):
        return False


def _patch_session_factory(db):
    # activity.py imports _async_session_factory from this module per-call.
    return patch("src.core.events.database._async_session_factory", lambda: _FactoryCM(db))


class _FakeRedis:
    def __init__(self, set_result):
        self._set_result = set_result
        self.store = {}

    def set(self, key, value, **kwargs):
        self.store[key] = value
        return self._set_result

    def get(self, key):
        return self.store.get(key)


class _BrokenRedis:
    """Redis whose get and/or set raise. The cache is an optimisation — a dead
    Redis must never break org resolution or activity capture."""

    def __init__(self, fail_get=False, fail_set=False):
        self.fail_get = fail_get
        self.fail_set = fail_set
        self.store = {}

    def get(self, key):
        if self.fail_get:
            raise RuntimeError("redis down")
        return self.store.get(key)

    def set(self, key, value, **kwargs):
        if self.fail_set:
            raise RuntimeError("redis down")
        self.store[key] = value
        return True


async def _count_rows(db, org_id):
    stmt = select(_func.count()).select_from(UserActivityDay).where(
        UserActivityDay.org_id == org_id
    )
    return int((await db.execute(stmt)).scalar_one())


class TestActivityCapture:
    def test_seconds_until_utc_midnight_in_range(self):
        from src.services.security import activity
        secs = activity._seconds_until_utc_midnight()
        assert 1 <= secs <= 86400

    async def test_records_a_row_when_redis_absent(self, db, org):
        from src.services.security import activity
        with _saas(), _patch_session_factory(db), patch(
            "src.services.security.activity.get_redis_client", return_value=None
        ):
            await activity.record_user_activity(55, org_id=ORG)
        assert await _count_rows(db, ORG) == 1

    async def test_redis_guard_skips_db_when_already_touched(self, db, org):
        from src.services.security import activity
        with _saas(), _patch_session_factory(db), patch(
            "src.services.security.activity.get_redis_client",
            return_value=_FakeRedis(set_result=False),  # key already set today
        ):
            await activity.record_user_activity(56, org_id=ORG)
        assert await _count_rows(db, ORG) == 0

    async def test_redis_guard_allows_first_touch(self, db, org):
        from src.services.security import activity
        with _saas(), _patch_session_factory(db), patch(
            "src.services.security.activity.get_redis_client",
            return_value=_FakeRedis(set_result=True),  # first touch of the day
        ):
            await activity.record_user_activity(57, org_id=ORG)
        assert await _count_rows(db, ORG) == 1

    async def test_duplicate_same_day_is_idempotent(self, db, org):
        from src.services.security import activity
        with _saas(), _patch_session_factory(db), patch(
            "src.services.security.activity.get_redis_client", return_value=None
        ):
            await activity.record_user_activity(58, org_id=ORG)
            await activity.record_user_activity(58, org_id=ORG)  # second insert -> no-op
        assert await _count_rows(db, ORG) == 1

    async def test_resolve_org_id_passthrough(self):
        from src.services.security import activity
        assert await activity._resolve_org_id(42, None, None) == 42

    async def test_resolve_org_id_from_slug(self, db, org):
        from src.services.security import activity
        with _patch_session_factory(db), patch(
            "src.services.security.activity.get_redis_client", return_value=None
        ):
            resolved = await activity._resolve_org_id(None, "test-org", None)
        assert resolved == org.id

    async def test_resolve_org_id_from_uuid(self, db, org):
        from src.services.security import activity
        with _patch_session_factory(db), patch(
            "src.services.security.activity.get_redis_client", return_value=None
        ):
            resolved = await activity._resolve_org_id(None, None, "org_test")
        assert resolved == org.id

    async def test_resolve_org_id_none_when_no_ref(self):
        from src.services.security import activity
        assert await activity._resolve_org_id(None, None, None) is None

    async def test_resolve_org_id_served_from_cache(self):
        """A cached slug -> id mapping short-circuits the DB lookup entirely."""
        from src.services.security import activity
        cache = _FakeRedis(set_result=True)
        cache.store["org_id_by_ref:slug:acme"] = "77"
        with patch(
            "src.services.security.activity.get_redis_client", return_value=cache
        ):
            # No session factory patched: a DB lookup here would blow up.
            assert await activity._resolve_org_id(None, "acme", None) == 77

    async def test_resolve_org_id_falls_back_when_cache_read_fails(self, db, org):
        from src.services.security import activity
        with _patch_session_factory(db), patch(
            "src.services.security.activity.get_redis_client",
            return_value=_BrokenRedis(fail_get=True),
        ):
            assert await activity._resolve_org_id(None, "test-org", None) == org.id

    async def test_resolve_org_id_caches_the_lookup(self, db, org):
        from src.services.security import activity
        cache = _FakeRedis(set_result=True)
        with _patch_session_factory(db), patch(
            "src.services.security.activity.get_redis_client", return_value=cache
        ):
            assert await activity._resolve_org_id(None, None, "org_test") == org.id
        assert cache.store["org_id_by_ref:uuid:org_test"] == str(org.id)

    async def test_resolve_org_id_survives_cache_write_failure(self, db, org):
        from src.services.security import activity
        with _patch_session_factory(db), patch(
            "src.services.security.activity.get_redis_client",
            return_value=_BrokenRedis(fail_set=True),
        ):
            assert await activity._resolve_org_id(None, "test-org", None) == org.id

    async def test_anonymous_user_is_noop(self, db, org):
        """No user id (anonymous request) -> nothing recorded, even in SaaS."""
        from src.services.security import activity
        with _saas(), _patch_session_factory(db), patch(
            "src.services.security.activity.get_redis_client", return_value=None
        ):
            await activity.record_user_activity(0, org_id=ORG)
        assert await _count_rows(db, ORG) == 0


# ---------------------------------------------------------------------------
# Auth hook helpers (src/security/auth.py)
# ---------------------------------------------------------------------------

class TestAuthActivityHooks:
    def test_org_ref_from_path_id(self):
        from src.security.auth import _org_ref_from_request
        req = SimpleNamespace(path_params={"org_id": "7"}, query_params={})
        assert _org_ref_from_request(req) == (7, None, None)

    def test_org_ref_from_query_id(self):
        from src.security.auth import _org_ref_from_request
        req = SimpleNamespace(path_params={}, query_params={"org_id": "9"})
        assert _org_ref_from_request(req) == (9, None, None)

    def test_org_ref_from_slug_and_uuid(self):
        from src.security.auth import _org_ref_from_request
        req = SimpleNamespace(path_params={"org_slug": "acme", "org_uuid": "u1"}, query_params={})
        assert _org_ref_from_request(req) == (None, "acme", "u1")

    def test_org_ref_invalid_id_is_none(self):
        from src.security.auth import _org_ref_from_request
        req = SimpleNamespace(path_params={"org_id": "notint"}, query_params={})
        assert _org_ref_from_request(req) == (None, None, None)

    async def test_record_activity_from_request_schedules_touch(self):
        from src.security import auth
        captured = {}

        async def _fake_record(user_id, org_id=None, org_slug=None, org_uuid=None):
            captured["args"] = (user_id, org_id, org_slug, org_uuid)

        req = SimpleNamespace(path_params={"org_id": "3"}, query_params={})
        with patch("src.services.security.activity.record_user_activity", _fake_record):
            auth._record_activity_from_request(req, 88)
            await asyncio.sleep(0.02)  # let the fire-and-forget task run
        assert captured["args"] == (88, 3, None, None)

    async def test_record_activity_no_user_is_noop(self):
        from src.security import auth
        req = SimpleNamespace(path_params={"org_id": "3"}, query_params={})
        # Must not raise and must not schedule anything.
        auth._record_activity_from_request(req, None)
        await asyncio.sleep(0.01)

    async def test_record_activity_without_org_ref_is_noop(self):
        """Non org-scoped routes carry no org reference — nothing to record."""
        from src.security import auth
        scheduled = []

        async def _fake_record(user_id, org_id=None, org_slug=None, org_uuid=None):
            scheduled.append(user_id)

        req = SimpleNamespace(path_params={}, query_params={})
        with patch("src.services.security.activity.record_user_activity", _fake_record):
            auth._record_activity_from_request(req, 88)
            await asyncio.sleep(0.02)
        assert scheduled == []

    async def test_record_activity_swallows_scheduling_failure(self):
        """Auth must never fail because activity capture did."""
        from src.security import auth
        # A request object missing path_params raises inside the helper.
        req = SimpleNamespace(query_params={})
        auth._record_activity_from_request(req, 88)  # must not raise
        await asyncio.sleep(0.01)


# ---------------------------------------------------------------------------
# Plan history (src/services/orgs/plan_history.py)
# ---------------------------------------------------------------------------

from datetime import datetime, timezone  # noqa: E402

from src.db.organization_plan_history import OrganizationPlanHistory  # noqa: E402


async def _add_plan_change(db, org_id, plan, when: datetime):
    db.add(OrganizationPlanHistory(org_id=org_id, plan=plan, effective_from=when))
    await db.commit()


def _utc(year, month, day, hour=12):
    return datetime(year, month, day, hour, tzinfo=timezone.utc)


class TestPlanHistory:
    """Overage is billed in arrears, so a past month must resolve to the plan
    that applied during it, not whatever the org is on today."""

    async def test_no_history_falls_back_to_current_plan(self, db):
        from src.services.orgs.plan_history import resolve_plan_for_month
        with _saas():
            assert await resolve_plan_for_month(ORG, 2026, 7, "standard", db) == (
                "standard", 200,
            )

    async def test_downgrade_after_the_month_bills_the_old_plan(self, db):
        """Pro through July, downgraded in August: July is still a Pro month."""
        from src.services.orgs.plan_history import resolve_plan_for_month
        await _add_plan_change(db, ORG, "pro", _utc(2026, 3, 1))
        await _add_plan_change(db, ORG, "standard", _utc(2026, 8, 10))
        with _saas():
            assert await resolve_plan_for_month(ORG, 2026, 7, "standard", db) == (
                "pro", 500,
            )

    async def test_downgrade_inside_the_month_keeps_the_higher_limit(self, db):
        from src.services.orgs.plan_history import resolve_plan_for_month
        await _add_plan_change(db, ORG, "pro", _utc(2026, 3, 1))
        await _add_plan_change(db, ORG, "standard", _utc(2026, 7, 20))
        with _saas():
            assert await resolve_plan_for_month(ORG, 2026, 7, "standard", db) == (
                "pro", 500,
            )

    async def test_upgrade_inside_the_month_keeps_the_higher_limit(self, db):
        from src.services.orgs.plan_history import resolve_plan_for_month
        await _add_plan_change(db, ORG, "standard", _utc(2026, 3, 1))
        await _add_plan_change(db, ORG, "pro", _utc(2026, 7, 28))
        with _saas():
            assert await resolve_plan_for_month(ORG, 2026, 7, "pro", db) == ("pro", 500)

    async def test_unlimited_plan_wins_over_a_numeric_limit(self, db):
        from src.services.orgs.plan_history import resolve_plan_for_month
        await _add_plan_change(db, ORG, "standard", _utc(2026, 3, 1))
        await _add_plan_change(db, ORG, "enterprise", _utc(2026, 7, 15))
        with _saas():
            plan, limit = await resolve_plan_for_month(ORG, 2026, 7, "standard", db)
        assert (plan, limit) == ("enterprise", 0)  # 0 == unlimited

    async def test_history_starting_after_the_month_falls_back(self, db):
        """An org whose first recorded change is later than the billed month."""
        from src.services.orgs.plan_history import resolve_plan_for_month
        await _add_plan_change(db, ORG, "pro", _utc(2026, 9, 1))
        with _saas():
            assert await resolve_plan_for_month(ORG, 2026, 7, "standard", db) == (
                "standard", 200,
            )

    async def test_history_is_org_scoped(self, db):
        from src.services.orgs.plan_history import resolve_plan_for_month
        await _add_plan_change(db, OTHER_ORG, "pro", _utc(2026, 3, 1))
        with _saas():
            assert await resolve_plan_for_month(ORG, 2026, 7, "free", db) == ("free", 10)

    async def test_change_on_the_first_instant_of_the_month_counts(self, db):
        from src.services.orgs.plan_history import resolve_plan_for_month
        await _add_plan_change(db, ORG, "free", _utc(2026, 1, 1))
        await _add_plan_change(db, ORG, "pro", datetime(2026, 7, 1, 0, 0, tzinfo=timezone.utc))
        with _saas():
            assert await resolve_plan_for_month(ORG, 2026, 7, "pro", db) == ("pro", 500)


class TestRecordPlanChange:
    async def test_records_only_real_changes(self, db, org):
        from src.services.orgs.plan_history import record_plan_change
        assert await record_plan_change(ORG, "standard", "standard", db) is False
        assert await record_plan_change(ORG, "standard", None, db) is False
        assert await record_plan_change(ORG, "standard", "pro", db) is True
        await db.commit()
        rows = (
            await db.execute(select(OrganizationPlanHistory).where(
                OrganizationPlanHistory.org_id == ORG
            ))
        ).scalars().all()
        assert [r.plan for r in rows] == ["pro"]

    async def test_first_plan_ever_is_recorded(self, db, org):
        """A brand-new org going free -> standard leaves a starting point."""
        from src.services.orgs.plan_history import record_plan_change
        assert await record_plan_change(ORG, None, "standard", db) is True


class TestSummaryUsesPlanHistory:
    async def test_summary_prices_a_past_month_at_the_old_plan(self, db, org):
        """243 active users in July on Pro, downgraded to Standard in August.
        July must bill against Pro's 500, i.e. no overage at all."""
        from src.security.features_utils.active_users import get_active_user_summary
        await _add_plan_change(db, ORG, "pro", _utc(2026, 3, 1))
        await _add_plan_change(db, ORG, "standard", _utc(2026, 8, 10))
        for user_id in range(1000, 1000 + 243):
            await _add_days(db, ORG, user_id, [date(2026, 7, 4), date(2026, 7, 5)])
        with _saas():
            summary = await get_active_user_summary(ORG, db, year=2026, month=7)
        assert summary["active_users"] == 243
        assert summary["plan"] == "pro"
        assert summary["plan_limit"] == 500
        assert summary["overage_units"] == 0


class TestEdgeBranches:
    async def test_december_month_bounds(self, db):
        # Exercises the December branch of _month_bounds (year rollover).
        await _add_days(db, ORG, 900, [date(2026, 12, 3), date(2026, 12, 20)])
        await _add_days(db, ORG, 901, [date(2027, 1, 2)])  # next year, excluded
        assert await count_active_users(ORG, 2026, 12, db) == 1

    async def test_visit_days_empty_user_list(self, db):
        assert await get_visit_days_for_users(ORG, [], 2026, 7, db) == {}
