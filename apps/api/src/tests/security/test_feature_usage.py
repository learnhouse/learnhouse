from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, func, select

from src.db.billing_usage import UsageEvent
from src.db.organization_config import OrganizationConfig
from src.security.features_utils import usage


async def _make_org_config(db, org_id: int, config: dict) -> OrganizationConfig:
    org_config = OrganizationConfig(org_id=org_id, config=config)
    db.add(org_config)
    await db.commit()
    await db.refresh(org_config)
    return org_config


async def _make_usage_event(
    db,
    org_id: int,
    feature: str,
    event_type: str,
    usage_after: int,
    timestamp: datetime,
) -> UsageEvent:
    event = UsageEvent(
        org_id=org_id,
        feature=feature,
        event_type=event_type,
        usage_after=usage_after,
        timestamp=timestamp,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


class TestFeatureUsage:
    def test_get_redis_client_success_and_missing_config(self):
        redis_client = Mock()

        with patch("src.security.features_utils.usage._get_redis_pool_client", return_value=redis_client):
            result = usage._get_redis_client()

        assert result is redis_client

        with patch("src.security.features_utils.usage._get_redis_pool_client", return_value=None):
            with pytest.raises(HTTPException) as exc_info:
                usage._get_redis_client()

        assert exc_info.value.status_code == 500

    def test_get_org_plan_versions(self):
        assert usage._get_org_plan(SimpleNamespace(config={"config_version": "2.0", "plan": "pro"})) == "pro"
        assert (
            usage._get_org_plan(SimpleNamespace(config={"config_version": "1.4", "cloud": {"plan": "standard"}}))
            == "standard"
        )

    @pytest.mark.asyncio
    async def test_actual_counts_and_dashboard_seats(self, db, org, regular_user, course, admin_user, admin_role):
        assert await usage._get_actual_member_count(org.id, db) == 2
        assert await usage._get_actual_course_count(org.id, db) == 1
        assert await usage._get_actual_admin_seat_count(org.id, db) == 1

        assert usage.is_role_dashboard_enabled(admin_role) is True
        assert usage.is_role_dashboard_enabled(SimpleNamespace(rights=[])) is False

    @pytest.mark.asyncio
    async def test_actual_usage_routes_and_zero_admin_seats(self, db, org, regular_user, course):
        assert await usage._get_actual_admin_seat_count(org.id, db) == 0
        assert await usage._get_actual_usage("members", org.id, db) == 1
        assert await usage._get_actual_usage("courses", org.id, db) == 1
        assert await usage._get_actual_usage("admin_seats", org.id, db) == 0
        assert await usage._get_actual_usage("other", org.id, db) == 0

    def test_invalidate_usage_cache_success_and_swallowed_error(self):
        redis_client = Mock()
        with patch("src.security.features_utils.usage._get_redis_client", return_value=redis_client):
            usage._invalidate_usage_cache(9)

        redis_client.delete.assert_called_once_with("org_usage:9")

        with patch("src.security.features_utils.usage._get_redis_client", side_effect=RuntimeError("boom")):
            usage._invalidate_usage_cache(9)

    @pytest.mark.asyncio
    async def test_log_usage_event_plan_based_and_non_plan_based(self, db, org, regular_user):
        with patch("src.security.features_utils.usage._invalidate_usage_cache") as invalidate:
            await usage.log_usage_event(org.id, "members", "add", db)

        event = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org.id, UsageEvent.feature == "members"))).scalar_one()
        assert event.event_type == "add"
        assert event.usage_after == 1
        invalidate.assert_called_once_with(org.id)

        before = (await db.execute(select(func.count()).select_from(UsageEvent))).scalar()
        await usage.log_usage_event(org.id, "api", "add", db)
        assert (await db.execute(select(func.count()).select_from(UsageEvent))).scalar() == before

    @pytest.mark.asyncio
    async def test_feature_enabled_and_access_paths(self, db, org):
        await _make_org_config(db, org.id, {"config_version": "2.0", "plan": "standard"})

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 1}), \
             patch("src.services.orgs.cache.get_cached_org_config", return_value=None), \
             patch("src.services.orgs.cache.set_cached_org_config"):
            assert await usage.check_feature_enabled("courses", org.id, db) is True

        await db.execute(delete(OrganizationConfig).where(OrganizationConfig.org_id == org.id))
        await db.commit()
        with patch("src.services.orgs.cache.get_cached_org_config", return_value=None), \
             patch("src.services.orgs.cache.set_cached_org_config"):
            with pytest.raises(HTTPException) as missing_exc:
                await usage.check_feature_enabled("courses", org.id, db)
        assert missing_exc.value.status_code == 404

        await _make_org_config(db, org.id, {"config_version": "2.0", "plan": "standard"})
        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": False, "limit": 1}), \
             patch("src.services.orgs.cache.get_cached_org_config", return_value=None), \
             patch("src.services.orgs.cache.set_cached_org_config"):
            with pytest.raises(HTTPException) as disabled_exc:
                await usage.check_feature_enabled("courses", org.id, db)
        assert disabled_exc.value.status_code == 403

        with patch("src.security.features_utils.usage.get_deployment_mode", return_value="oss"):
            assert await usage.check_feature_access("versioning", org.id, db) is True

        with patch("src.security.features_utils.usage.get_deployment_mode", return_value="saas"), patch(
            "src.security.features_utils.usage.get_required_plan_for_feature", return_value=None
        ):
            assert await usage.check_feature_access("custom", org.id, db) is True

        await db.execute(delete(OrganizationConfig).where(OrganizationConfig.org_id == org.id))
        await db.commit()
        with patch("src.security.features_utils.usage.get_deployment_mode", return_value="saas"), patch(
            "src.security.features_utils.usage.get_required_plan_for_feature", return_value="pro"
        ), patch("src.services.orgs.cache.get_cached_org_config", return_value=None), \
             patch("src.services.orgs.cache.set_cached_org_config"):
            with pytest.raises(HTTPException) as missing_plan_exc:
                await usage.check_feature_access("custom", org.id, db)
        assert missing_plan_exc.value.status_code == 404

        await _make_org_config(db, org.id, {"config_version": "2.0", "plan": "standard"})
        with patch("src.security.features_utils.usage.get_deployment_mode", return_value="saas"), patch(
            "src.security.features_utils.usage.get_required_plan_for_feature", return_value="pro"
        ), patch("src.security.features_utils.usage.plan_meets_requirement", return_value=False), \
             patch("src.services.orgs.cache.get_cached_org_config", return_value=None), \
             patch("src.services.orgs.cache.set_cached_org_config"):
            with pytest.raises(HTTPException) as denied_exc:
                await usage.check_feature_access("custom", org.id, db)
        assert denied_exc.value.status_code == 403

        with patch("src.security.features_utils.usage.get_deployment_mode", return_value="saas"), patch(
            "src.security.features_utils.usage.get_required_plan_for_feature", return_value="pro"
        ), patch("src.security.features_utils.usage.plan_meets_requirement", return_value=True), \
             patch("src.services.orgs.cache.get_cached_org_config", return_value=None), \
             patch("src.services.orgs.cache.set_cached_org_config"):
            assert await usage.check_feature_access("custom", org.id, db) is True

    @pytest.mark.asyncio
    async def test_usage_at_timestamp_and_peak_queries(self, db, org):
        start = datetime(2024, 1, 1, 12, 0, 0)
        mid = start + timedelta(minutes=5)
        end = start + timedelta(minutes=10)
        await _make_usage_event(db, org.id, "members", "add", 2, start)
        await _make_usage_event(db, org.id, "members", "add", 5, mid)

        assert await usage.get_usage_at_timestamp(org.id, "members", mid, db) == 5
        assert await usage.get_usage_at_timestamp(org.id, "members", start - timedelta(seconds=1), db) == 0
        assert await usage.get_peak_usage(org.id, "members", start, end, db) == 5

        with patch("src.security.features_utils.usage.get_usage_at_timestamp", return_value=7):
            assert await usage.get_peak_usage(org.id, "members", end, end, db) == 7

        events = await usage.get_usage_events(org.id, "members", start, end, db)
        assert [event.usage_after for event in events] == [2, 5]

    @pytest.mark.asyncio
    async def test_weighted_average_usage_paths(self, db, org):
        start = datetime(2024, 1, 1, 12, 0, 0)
        end = start + timedelta(seconds=10)
        mid = start + timedelta(seconds=5)
        event = SimpleNamespace(timestamp=mid, usage_after=6)

        with patch("src.security.features_utils.usage.get_usage_events", return_value=[]), patch(
            "src.security.features_utils.usage.get_usage_at_timestamp", return_value=4
        ):
            assert await usage.calculate_weighted_average_usage(org.id, "members", start, end, db) == 4.0

        with patch("src.security.features_utils.usage.get_usage_events", return_value=[event]), patch(
            "src.security.features_utils.usage.get_usage_at_timestamp", return_value=2
        ):
            assert await usage.calculate_weighted_average_usage(org.id, "members", start, end, db) == 4.0

        with patch("src.security.features_utils.usage.get_usage_events", return_value=[event]), patch(
            "src.security.features_utils.usage.get_usage_at_timestamp", return_value=2
        ):
            assert await usage.calculate_weighted_average_usage(org.id, "members", start, start, db) == 2.0

    @pytest.mark.asyncio
    async def test_billable_overage_and_billing_summary(self, db, org, other_org):
        start = datetime(2024, 1, 1, 12, 0, 0)
        end = start + timedelta(days=1)

        unlimited = await usage.calculate_billable_overage(org.id, "members", start, end, 0, db, "peak")
        assert unlimited["limit"] == "unlimited"
        assert unlimited["usage"] == 0

        with patch("src.security.features_utils.usage.get_peak_usage", return_value=7.4):
            peak = await usage.calculate_billable_overage(org.id, "members", start, end, 5, db, "peak")
        assert peak["usage"] == 7.4
        assert peak["overage"] == 2.4

        with patch("src.security.features_utils.usage.calculate_weighted_average_usage", return_value=6.346):
            average = await usage.calculate_billable_overage(org.id, "members", start, end, 5, db, "average")
        assert average["usage"] == 6.35
        assert average["overage"] == 1.35

        assert await usage.get_billing_summary(org.id, start, end, db) == {"error": "Organization has no config"}

        await _make_org_config(db, org.id, {"config_version": "2.0", "plan": "standard"})
        with patch("src.security.features_utils.usage.get_plan_limit", return_value=5), patch(
            "src.security.features_utils.usage.calculate_billable_overage",
            side_effect=lambda org_id, feature, *_args, **_kwargs: {
                "feature": feature,
                "overage": 1 if feature == "members" else 0,
            },
        ):
            summary = await usage.get_billing_summary(org.id, start, end, db)

        assert summary["org_id"] == org.id
        assert summary["plan"] == "standard"
        assert summary["features"]["members"]["overage"] == 1

        await _make_usage_event(db, org.id, "members", "add", 11, start)
        await _make_usage_event(db, other_org.id, "members", "add", 12, start)
        with patch(
            "src.security.features_utils.usage.get_billing_summary",
            side_effect=[
                {"features": {"members": {"overage": 0}}},
                {"features": {"members": {"overage": 3}}},
            ],
        ):
            overage_orgs = await usage.get_all_orgs_with_overage(start, end, db)

        assert len(overage_orgs) == 1
        assert overage_orgs[0]["features"]["members"]["overage"] == 3

    @pytest.mark.asyncio
    async def test_admin_seat_helpers_and_purchased_seats(self, db, org, admin_user):
        await _make_org_config(db, org.id, {"config_version": "2.0", "plan": "standard"})

        with patch("src.security.features_utils.usage.check_limits_with_usage", return_value=True) as check_limits:
            assert await usage.check_admin_seat_limit(org.id, db) is True
        check_limits.assert_called_once_with("admin_seats", org.id, db)

        with patch("src.security.features_utils.usage.get_plan_limit", return_value=5):
            summary = await usage.get_admin_seat_usage(org.id, db)
        assert summary == {"plan": "standard", "current_usage": 1, "limit": 5, "remaining": 4}

        await db.execute(delete(OrganizationConfig).where(OrganizationConfig.org_id == org.id))
        await db.commit()
        assert await usage.get_admin_seat_usage(org.id, db) == {"error": "Organization has no config"}

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client:
            redis_client.return_value.get.return_value = b"7"
            assert usage.get_purchased_member_seats(org.id) == 7

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client:
            redis_client.return_value.get.return_value = None
            assert usage.get_purchased_member_seats(org.id) == 0

    @pytest.mark.asyncio
    async def test_usage_limit_checks_and_mutators(self, db, org):
        await _make_org_config(db, org.id, {"config_version": "2.0", "plan": "free"})

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 1}), patch(
            "src.security.features_utils.usage._get_actual_usage", return_value=2
        ), patch("src.services.orgs.cache.get_cached_org_config", return_value=None), \
             patch("src.services.orgs.cache.set_cached_org_config"):
            with pytest.raises(HTTPException) as exc_info:
                await usage.check_limits_with_usage("members", org.id, db)
        assert exc_info.value.status_code == 403

        await db.execute(delete(OrganizationConfig).where(OrganizationConfig.org_id == org.id))
        await db.commit()
        await _make_org_config(db, org.id, {"config_version": "2.0", "plan": "pro"})
        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 1}), patch(
            "src.security.features_utils.usage._get_actual_usage", return_value=2
        ), patch("src.services.orgs.cache.get_cached_org_config", return_value=None), \
             patch("src.services.orgs.cache.set_cached_org_config"):
            assert await usage.check_limits_with_usage("members", org.id, db) is True

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 3}), patch(
            "src.security.features_utils.usage._get_redis_client"
        ) as redis_client, patch("src.services.orgs.cache.get_cached_org_config", return_value=None), \
             patch("src.services.orgs.cache.set_cached_org_config"):
            redis_client.return_value.get.return_value = b"3"
            with pytest.raises(HTTPException) as redis_limit_exc:
                await usage.check_limits_with_usage("ai", org.id, db)
        assert redis_limit_exc.value.status_code == 403

        with patch("src.security.features_utils.usage.log_usage_event", return_value=True) as log_usage:
            assert await usage.increase_feature_usage("members", org.id, db) is True
        log_usage.assert_called_once_with(org.id, "members", "add", db)

        with patch("src.security.features_utils.usage.log_usage_event", return_value=True) as log_usage:
            assert await usage.decrease_feature_usage("members", org.id, db) is True
        log_usage.assert_called_once_with(org.id, "members", "remove", db)

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client:
            redis_client.return_value.get.return_value = b"2"
            redis_client.return_value.set.return_value = True
            assert await usage.increase_feature_usage("ai", org.id, db) is True
            redis_client.return_value.set.assert_called_once_with("ai_usage:1", 3)

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client:
            redis_client.return_value.get.return_value = b"2"
            redis_client.return_value.set.return_value = True
            assert await usage.decrease_feature_usage("ai", org.id, db) is True
            redis_client.return_value.set.assert_called_once_with("ai_usage:1", 1)

    @pytest.mark.asyncio
    async def test_usage_limit_edge_branches_and_empty_redis(self, db, org):
        with patch("src.services.orgs.cache.get_cached_org_config", return_value=None), \
             patch("src.services.orgs.cache.set_cached_org_config"):
            with pytest.raises(HTTPException) as missing_exc:
                await usage.check_limits_with_usage("members", org.id, db)
        assert missing_exc.value.status_code == 404

        await _make_org_config(db, org.id, {"config_version": "2.0", "plan": "standard"})
        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": False, "limit": 1}), \
             patch("src.services.orgs.cache.get_cached_org_config", return_value=None), \
             patch("src.services.orgs.cache.set_cached_org_config"):
            with pytest.raises(HTTPException) as disabled_exc:
                await usage.check_limits_with_usage("courses", org.id, db)
        assert disabled_exc.value.status_code == 403

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 0}), \
             patch("src.services.orgs.cache.get_cached_org_config", return_value=None), \
             patch("src.services.orgs.cache.set_cached_org_config"):
            assert await usage.check_limits_with_usage("courses", org.id, db) is True

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 2}), patch(
            "src.security.features_utils.usage._get_actual_usage", return_value=1
        ), patch("src.services.orgs.cache.get_cached_org_config", return_value=None), \
             patch("src.services.orgs.cache.set_cached_org_config"):
            assert await usage.check_limits_with_usage("members", org.id, db) is True

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 2}), patch(
            "src.security.features_utils.usage._get_redis_client"
        ) as redis_client, patch("src.services.orgs.cache.get_cached_org_config", return_value=None), \
             patch("src.services.orgs.cache.set_cached_org_config"):
            redis_client.return_value.get.return_value = None
            assert await usage.check_limits_with_usage("ai", org.id, db) is True

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client:
            redis_client.return_value.get.return_value = None
            assert await usage.increase_feature_usage("ai", org.id, db) is True
            redis_client.return_value.set.assert_called_once_with("ai_usage:1", 1)

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client:
            redis_client.return_value.get.return_value = None
            assert await usage.decrease_feature_usage("ai", org.id, db) is True
            redis_client.return_value.set.assert_called_once_with("ai_usage:1", 0)

    @pytest.mark.asyncio
    async def test_ai_credit_checks_and_mutators(self, db, org):
        await _make_org_config(
            db,
            org.id,
            {
                "config_version": "2.0",
                "plan": "standard",
                "overrides": {"ai": {"extra_limit": 3}},
            },
        )

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 1}), patch(
            "src.security.features_utils.usage.get_deployment_mode", return_value="ee"
        ):
            assert await usage.check_ai_credits(org.id, db) is True

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": False, "limit": 1}):
            with pytest.raises(HTTPException) as disabled_exc:
                await usage.check_ai_credits(org.id, db)
        assert disabled_exc.value.status_code == 403

        await db.execute(delete(OrganizationConfig).where(OrganizationConfig.org_id == org.id))
        await db.commit()
        with pytest.raises(HTTPException) as missing_exc:
            await usage.check_ai_credits(org.id, db)
        assert missing_exc.value.status_code == 404

        await _make_org_config(
            db,
            org.id,
            {
                "config_version": "2.0",
                "plan": "free",
                "overrides": {"ai": {"extra_limit": 3}},
            },
        )
        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 1}), patch(
            "src.security.features_utils.usage.get_deployment_mode", return_value="saas"
        ), patch("src.security.features_utils.usage.get_ai_credit_limit", return_value=0):
            with pytest.raises(HTTPException) as free_exc:
                await usage.check_ai_credits(org.id, db)
        assert free_exc.value.status_code == 403

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 1}), patch(
            "src.security.features_utils.usage.get_deployment_mode", return_value="saas"
        ), patch("src.security.features_utils.usage.get_ai_credit_limit", return_value=-1):
            assert await usage.check_ai_credits(org.id, db) is True

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 1}), patch(
            "src.security.features_utils.usage.get_deployment_mode", return_value="saas"
        ), patch("src.security.features_utils.usage.get_ai_credit_limit", return_value=5), patch(
            "src.security.features_utils.usage._get_redis_client"
        ) as redis_client:
            redis_client.return_value.mget.return_value = (b"2", b"6")
            assert await usage.check_ai_credits(org.id, db) is True

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 1}), patch(
            "src.security.features_utils.usage.get_deployment_mode", return_value="saas"
        ), patch("src.security.features_utils.usage.get_ai_credit_limit", return_value=5), patch(
            "src.security.features_utils.usage._get_redis_client"
        ) as redis_client:
            redis_client.return_value.mget.return_value = (b"2", b"10")
            with pytest.raises(HTTPException) as limit_exc:
                await usage.check_ai_credits(org.id, db)
        assert limit_exc.value.status_code == 403

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client:
            redis_client.return_value.incrby.return_value = 6
            assert usage.deduct_ai_credit(org.id, db, amount=2) == 6
            redis_client.return_value.incrby.assert_called_once_with("ai_credits_used:1", 2)

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client:
            redis_client.return_value.incrby.return_value = 12
            assert usage.add_ai_credits(org.id, 5) == 12
            redis_client.return_value.incrby.assert_called_once_with("ai_credits_purchased:1", 5)

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client:
            assert usage.reset_ai_credits_usage(org.id) is True
            redis_client.return_value.set.assert_called_once_with("ai_credits_used:1", 0)

    @pytest.mark.asyncio
    async def test_ai_credit_summary_paths(self, db, org):
        await _make_org_config(
            db,
            org.id,
            {
                "config_version": "2.0",
                "plan": "standard",
                "overrides": {"ai": {"extra_limit": 2}},
            },
        )

        assert await usage.get_ai_credits_summary(999, db) == {"error": "Organization has no config"}

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client, patch(
            "src.security.features_utils.usage.get_deployment_mode", return_value="ee"
        ):
            redis_client.return_value.get.return_value = b"3"
            summary = await usage.get_ai_credits_summary(org.id, db)

        assert summary == {
            "plan": "standard",
            "mode": "ee",
            "base_credits": "unlimited",
            "purchased_credits": 0,
            "total_credits": "unlimited",
            "used_credits": 3,
            "remaining_credits": "unlimited",
        }

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client, patch(
            "src.security.features_utils.usage.get_deployment_mode", return_value="saas"
        ), patch("src.security.features_utils.usage.get_ai_credit_limit", return_value=-1):
            redis_client.return_value.mget.return_value = (b"4", b"6")
            summary = await usage.get_ai_credits_summary(org.id, db)

        assert summary["base_credits"] == "unlimited"
        assert summary["purchased_credits"] == 4
        assert summary["used_credits"] == 6
        assert summary["remaining_credits"] == "unlimited"

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client, patch(
            "src.security.features_utils.usage.get_deployment_mode", return_value="saas"
        ), patch("src.security.features_utils.usage.get_ai_credit_limit", return_value=5):
            redis_client.return_value.mget.return_value = (b"4", b"6")
            summary = await usage.get_ai_credits_summary(org.id, db)

        assert summary == {
            "plan": "standard",
            "base_credits": 5,
            "purchased_credits": 4,
            "total_credits": 11,
            "used_credits": 6,
            "remaining_credits": 5,
        }


class TestGetOrgConfigCacheHit:
    """Cover _get_org_config cache-hit and set_cached exception paths in usage.py."""

    @pytest.mark.asyncio
    async def test_returns_cached_org_config_without_db_hit(self, db, org):
        from src.db.organization_config import OrganizationConfig

        cached_data = {"org_id": org.id, "config": {"plan": "pro"}}
        with patch("src.services.orgs.cache.get_cached_org_config", return_value=cached_data):
            result = await usage._get_org_config(org.id, db)
        assert isinstance(result, OrganizationConfig)

    @pytest.mark.asyncio
    async def test_invalid_cached_data_falls_back_to_db(self, db, org):
        from src.db.organization_config import OrganizationConfig

        org_config = OrganizationConfig(org_id=org.id, config={"plan": "free"})
        db.add(org_config)
        await db.commit()

        # Corrupt cache data → falls through to DB
        with patch("src.services.orgs.cache.get_cached_org_config", return_value={"bad": "data"}), \
             patch("src.services.orgs.cache.set_cached_org_config"):
            result = await usage._get_org_config(org.id, db)
        assert result is not None

    @pytest.mark.asyncio
    async def test_set_cached_exception_is_swallowed(self, db, org):
        from src.db.organization_config import OrganizationConfig

        org_config = OrganizationConfig(org_id=org.id, config={"plan": "free"})
        db.add(org_config)
        await db.commit()

        with patch("src.services.orgs.cache.get_cached_org_config", return_value=None), \
             patch("src.services.orgs.cache.set_cached_org_config", side_effect=RuntimeError("redis")):
            result = await usage._get_org_config(org.id, db)
        assert result is not None

    @pytest.mark.asyncio
    async def test_invalid_cached_data_exception_falls_back_to_db(self, db, org):
        from src.db.organization_config import OrganizationConfig

        org_config = OrganizationConfig(org_id=org.id, config={"plan": "free"})
        db.add(org_config)
        await db.commit()

        # Dict with integer key causes TypeError on ** unpacking, exercising the except branch
        with patch("src.services.orgs.cache.get_cached_org_config", return_value={1: "bad-key"}), \
             patch("src.services.orgs.cache.set_cached_org_config"):
            result = await usage._get_org_config(org.id, db)
        assert result is not None
