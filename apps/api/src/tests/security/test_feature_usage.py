from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from src.db.billing_usage import UsageEvent
from src.db.organization_config import OrganizationConfig
from src.security.features_utils import usage


def _make_org_config(db: Session, org_id: int, config: dict) -> OrganizationConfig:
    org_config = OrganizationConfig(org_id=org_id, config=config)
    db.add(org_config)
    db.commit()
    db.refresh(org_config)
    return org_config


def _make_usage_event(
    db: Session,
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
    db.commit()
    db.refresh(event)
    return event


class TestFeatureUsage:
    def test_get_redis_client_success_and_missing_config(self):
        config = SimpleNamespace(redis_config=SimpleNamespace(redis_connection_string="redis://localhost:6379"))
        redis_client = Mock()

        with patch("src.security.features_utils.usage.get_learnhouse_config", return_value=config), patch(
            "redis.Redis.from_url", return_value=redis_client
        ) as from_url:
            result = usage._get_redis_client()

        assert result is redis_client
        from_url.assert_called_once_with("redis://localhost:6379")

        config.redis_config.redis_connection_string = None
        with patch("src.security.features_utils.usage.get_learnhouse_config", return_value=config):
            with pytest.raises(HTTPException) as exc_info:
                usage._get_redis_client()

        assert exc_info.value.status_code == 500

    def test_get_org_plan_versions(self):
        assert usage._get_org_plan(SimpleNamespace(config={"config_version": "2.0", "plan": "pro"})) == "pro"
        assert (
            usage._get_org_plan(SimpleNamespace(config={"config_version": "1.4", "cloud": {"plan": "standard"}}))
            == "standard"
        )

    def test_actual_counts_and_dashboard_seats(self, db, org, regular_user, course, admin_user, admin_role):
        assert usage._get_actual_member_count(org.id, db) == 2
        assert usage._get_actual_course_count(org.id, db) == 1
        assert usage._get_actual_admin_seat_count(org.id, db) == 1

        assert usage.is_role_dashboard_enabled(admin_role) is True
        assert usage.is_role_dashboard_enabled(SimpleNamespace(rights=[])) is False

    def test_actual_usage_routes_and_zero_admin_seats(self, db, org, regular_user, course):
        assert usage._get_actual_admin_seat_count(org.id, db) == 0
        assert usage._get_actual_usage("members", org.id, db) == 1
        assert usage._get_actual_usage("courses", org.id, db) == 1
        assert usage._get_actual_usage("admin_seats", org.id, db) == 0
        assert usage._get_actual_usage("other", org.id, db) == 0

    def test_invalidate_usage_cache_success_and_swallowed_error(self):
        redis_client = Mock()
        with patch("src.security.features_utils.usage._get_redis_client", return_value=redis_client):
            usage._invalidate_usage_cache(9)

        redis_client.delete.assert_called_once_with("org_usage:9")

        with patch("src.security.features_utils.usage._get_redis_client", side_effect=RuntimeError("boom")):
            usage._invalidate_usage_cache(9)

    def test_log_usage_event_plan_based_and_non_plan_based(self, db, org, regular_user):
        with patch("src.security.features_utils.usage._invalidate_usage_cache") as invalidate:
            usage.log_usage_event(org.id, "members", "add", db)

        event = db.query(UsageEvent).filter(UsageEvent.org_id == org.id, UsageEvent.feature == "members").one()
        assert event.event_type == "add"
        assert event.usage_after == 1
        invalidate.assert_called_once_with(org.id)

        before = db.query(UsageEvent).count()
        usage.log_usage_event(org.id, "api", "add", db)
        assert db.query(UsageEvent).count() == before

    def test_feature_enabled_and_access_paths(self, db, org):
        _make_org_config(db, org.id, {"config_version": "2.0", "plan": "standard"})

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 1}):
            assert usage.check_feature_enabled("courses", org.id, db) is True

        db.query(OrganizationConfig).filter(OrganizationConfig.org_id == org.id).delete()
        db.commit()
        with pytest.raises(HTTPException) as missing_exc:
            usage.check_feature_enabled("courses", org.id, db)
        assert missing_exc.value.status_code == 404

        _make_org_config(db, org.id, {"config_version": "2.0", "plan": "standard"})
        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": False, "limit": 1}):
            with pytest.raises(HTTPException) as disabled_exc:
                usage.check_feature_enabled("courses", org.id, db)
        assert disabled_exc.value.status_code == 403

        with patch("src.security.features_utils.usage.get_deployment_mode", return_value="oss"):
            assert usage.check_feature_access("versioning", org.id, db) is True

        with patch("src.security.features_utils.usage.get_deployment_mode", return_value="saas"), patch(
            "src.security.features_utils.usage.get_required_plan_for_feature", return_value=None
        ):
            assert usage.check_feature_access("custom", org.id, db) is True

        db.query(OrganizationConfig).filter(OrganizationConfig.org_id == org.id).delete()
        db.commit()
        with patch("src.security.features_utils.usage.get_deployment_mode", return_value="saas"), patch(
            "src.security.features_utils.usage.get_required_plan_for_feature", return_value="pro"
        ):
            with pytest.raises(HTTPException) as missing_plan_exc:
                usage.check_feature_access("custom", org.id, db)
        assert missing_plan_exc.value.status_code == 404

        _make_org_config(db, org.id, {"config_version": "2.0", "plan": "standard"})
        with patch("src.security.features_utils.usage.get_deployment_mode", return_value="saas"), patch(
            "src.security.features_utils.usage.get_required_plan_for_feature", return_value="pro"
        ), patch("src.security.features_utils.usage.plan_meets_requirement", return_value=False):
            with pytest.raises(HTTPException) as denied_exc:
                usage.check_feature_access("custom", org.id, db)
        assert denied_exc.value.status_code == 403

        with patch("src.security.features_utils.usage.get_deployment_mode", return_value="saas"), patch(
            "src.security.features_utils.usage.get_required_plan_for_feature", return_value="pro"
        ), patch("src.security.features_utils.usage.plan_meets_requirement", return_value=True):
            assert usage.check_feature_access("custom", org.id, db) is True

    def test_usage_at_timestamp_and_peak_queries(self, db, org):
        start = datetime(2024, 1, 1, 12, 0, 0)
        mid = start + timedelta(minutes=5)
        end = start + timedelta(minutes=10)
        _make_usage_event(db, org.id, "members", "add", 2, start)
        _make_usage_event(db, org.id, "members", "add", 5, mid)

        assert usage.get_usage_at_timestamp(org.id, "members", mid, db) == 5
        assert usage.get_usage_at_timestamp(org.id, "members", start - timedelta(seconds=1), db) == 0
        assert usage.get_peak_usage(org.id, "members", start, end, db) == 5

        with patch("src.security.features_utils.usage.get_usage_at_timestamp", return_value=7):
            assert usage.get_peak_usage(org.id, "members", end, end, db) == 7

        events = usage.get_usage_events(org.id, "members", start, end, db)
        assert [event.usage_after for event in events] == [2, 5]

    def test_weighted_average_usage_paths(self, db, org):
        start = datetime(2024, 1, 1, 12, 0, 0)
        end = start + timedelta(seconds=10)
        mid = start + timedelta(seconds=5)
        event = SimpleNamespace(timestamp=mid, usage_after=6)

        with patch("src.security.features_utils.usage.get_usage_events", return_value=[]), patch(
            "src.security.features_utils.usage.get_usage_at_timestamp", return_value=4
        ):
            assert usage.calculate_weighted_average_usage(org.id, "members", start, end, db) == 4.0

        with patch("src.security.features_utils.usage.get_usage_events", return_value=[event]), patch(
            "src.security.features_utils.usage.get_usage_at_timestamp", return_value=2
        ):
            assert usage.calculate_weighted_average_usage(org.id, "members", start, end, db) == 4.0

        with patch("src.security.features_utils.usage.get_usage_events", return_value=[event]), patch(
            "src.security.features_utils.usage.get_usage_at_timestamp", return_value=2
        ):
            assert usage.calculate_weighted_average_usage(org.id, "members", start, start, db) == 2.0

    def test_billable_overage_and_billing_summary(self, db, org, other_org):
        start = datetime(2024, 1, 1, 12, 0, 0)
        end = start + timedelta(days=1)

        unlimited = usage.calculate_billable_overage(org.id, "members", start, end, 0, db, "peak")
        assert unlimited["limit"] == "unlimited"
        assert unlimited["usage"] == 0

        with patch("src.security.features_utils.usage.get_peak_usage", return_value=7.4):
            peak = usage.calculate_billable_overage(org.id, "members", start, end, 5, db, "peak")
        assert peak["usage"] == 7.4
        assert peak["overage"] == 2.4

        with patch("src.security.features_utils.usage.calculate_weighted_average_usage", return_value=6.346):
            average = usage.calculate_billable_overage(org.id, "members", start, end, 5, db, "average")
        assert average["usage"] == 6.35
        assert average["overage"] == 1.35

        assert usage.get_billing_summary(org.id, start, end, db) == {"error": "Organization has no config"}

        _make_org_config(db, org.id, {"config_version": "2.0", "plan": "standard"})
        with patch("src.security.features_utils.usage.get_plan_limit", return_value=5), patch(
            "src.security.features_utils.usage.calculate_billable_overage",
            side_effect=lambda org_id, feature, *_args, **_kwargs: {
                "feature": feature,
                "overage": 1 if feature == "members" else 0,
            },
        ):
            summary = usage.get_billing_summary(org.id, start, end, db)

        assert summary["org_id"] == org.id
        assert summary["plan"] == "standard"
        assert summary["features"]["members"]["overage"] == 1

        _make_usage_event(db, org.id, "members", "add", 11, start)
        _make_usage_event(db, other_org.id, "members", "add", 12, start)
        with patch(
            "src.security.features_utils.usage.get_billing_summary",
            side_effect=[
                {"features": {"members": {"overage": 0}}},
                {"features": {"members": {"overage": 3}}},
            ],
        ):
            overage_orgs = usage.get_all_orgs_with_overage(start, end, db)

        assert len(overage_orgs) == 1
        assert overage_orgs[0]["features"]["members"]["overage"] == 3

    def test_admin_seat_helpers_and_purchased_seats(self, db, org, admin_user):
        _make_org_config(db, org.id, {"config_version": "2.0", "plan": "standard"})

        with patch("src.security.features_utils.usage.check_limits_with_usage", return_value=True) as check_limits:
            assert usage.check_admin_seat_limit(org.id, db) is True
        check_limits.assert_called_once_with("admin_seats", org.id, db)

        with patch("src.security.features_utils.usage.get_plan_limit", return_value=5):
            summary = usage.get_admin_seat_usage(org.id, db)
        assert summary == {"plan": "standard", "current_usage": 1, "limit": 5, "remaining": 4}

        db.query(OrganizationConfig).filter(OrganizationConfig.org_id == org.id).delete()
        db.commit()
        assert usage.get_admin_seat_usage(org.id, db) == {"error": "Organization has no config"}

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client:
            redis_client.return_value.get.return_value = b"7"
            assert usage.get_purchased_member_seats(org.id) == 7

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client:
            redis_client.return_value.get.return_value = None
            assert usage.get_purchased_member_seats(org.id) == 0

    def test_usage_limit_checks_and_mutators(self, db, org):
        _make_org_config(db, org.id, {"config_version": "2.0", "plan": "free"})

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 1}), patch(
            "src.security.features_utils.usage._get_actual_usage", return_value=2
        ):
            with pytest.raises(HTTPException) as exc_info:
                usage.check_limits_with_usage("members", org.id, db)
        assert exc_info.value.status_code == 403

        db.query(OrganizationConfig).filter(OrganizationConfig.org_id == org.id).delete()
        db.commit()
        _make_org_config(db, org.id, {"config_version": "2.0", "plan": "pro"})
        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 1}), patch(
            "src.security.features_utils.usage._get_actual_usage", return_value=2
        ):
            assert usage.check_limits_with_usage("members", org.id, db) is True

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 3}), patch(
            "src.security.features_utils.usage._get_redis_client"
        ) as redis_client:
            redis_client.return_value.get.return_value = b"3"
            with pytest.raises(HTTPException) as redis_limit_exc:
                usage.check_limits_with_usage("ai", org.id, db)
        assert redis_limit_exc.value.status_code == 403

        with patch("src.security.features_utils.usage.log_usage_event", return_value=True) as log_usage:
            assert usage.increase_feature_usage("members", org.id, db) is True
        log_usage.assert_called_once_with(org.id, "members", "add", db)

        with patch("src.security.features_utils.usage.log_usage_event", return_value=True) as log_usage:
            assert usage.decrease_feature_usage("members", org.id, db) is True
        log_usage.assert_called_once_with(org.id, "members", "remove", db)

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client:
            redis_client.return_value.get.return_value = b"2"
            redis_client.return_value.set.return_value = True
            assert usage.increase_feature_usage("ai", org.id, db) is True
            redis_client.return_value.set.assert_called_once_with("ai_usage:1", 3)

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client:
            redis_client.return_value.get.return_value = b"2"
            redis_client.return_value.set.return_value = True
            assert usage.decrease_feature_usage("ai", org.id, db) is True
            redis_client.return_value.set.assert_called_once_with("ai_usage:1", 1)

    def test_usage_limit_edge_branches_and_empty_redis(self, db, org):
        with pytest.raises(HTTPException) as missing_exc:
            usage.check_limits_with_usage("members", org.id, db)
        assert missing_exc.value.status_code == 404

        _make_org_config(db, org.id, {"config_version": "2.0", "plan": "standard"})
        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": False, "limit": 1}):
            with pytest.raises(HTTPException) as disabled_exc:
                usage.check_limits_with_usage("courses", org.id, db)
        assert disabled_exc.value.status_code == 403

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 0}):
            assert usage.check_limits_with_usage("courses", org.id, db) is True

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 2}), patch(
            "src.security.features_utils.usage._get_actual_usage", return_value=1
        ):
            assert usage.check_limits_with_usage("members", org.id, db) is True

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 2}), patch(
            "src.security.features_utils.usage._get_redis_client"
        ) as redis_client:
            redis_client.return_value.get.return_value = None
            assert usage.check_limits_with_usage("ai", org.id, db) is True

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client:
            redis_client.return_value.get.return_value = None
            assert usage.increase_feature_usage("ai", org.id, db) is True
            redis_client.return_value.set.assert_called_once_with("ai_usage:1", 1)

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client:
            redis_client.return_value.get.return_value = None
            assert usage.decrease_feature_usage("ai", org.id, db) is True
            redis_client.return_value.set.assert_called_once_with("ai_usage:1", 0)

    def test_ai_credit_checks_and_mutators(self, db, org):
        _make_org_config(
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
            assert usage.check_ai_credits(org.id, db) is True

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": False, "limit": 1}):
            with pytest.raises(HTTPException) as disabled_exc:
                usage.check_ai_credits(org.id, db)
        assert disabled_exc.value.status_code == 403

        db.query(OrganizationConfig).filter(OrganizationConfig.org_id == org.id).delete()
        db.commit()
        with pytest.raises(HTTPException) as missing_exc:
            usage.check_ai_credits(org.id, db)
        assert missing_exc.value.status_code == 404

        _make_org_config(
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
                usage.check_ai_credits(org.id, db)
        assert free_exc.value.status_code == 403

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 1}), patch(
            "src.security.features_utils.usage.get_deployment_mode", return_value="saas"
        ), patch("src.security.features_utils.usage.get_ai_credit_limit", return_value=-1):
            assert usage.check_ai_credits(org.id, db) is True

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 1}), patch(
            "src.security.features_utils.usage.get_deployment_mode", return_value="saas"
        ), patch("src.security.features_utils.usage.get_ai_credit_limit", return_value=5), patch(
            "src.security.features_utils.usage._get_redis_client"
        ) as redis_client:
            redis_client.return_value.mget.return_value = (b"2", b"6")
            assert usage.check_ai_credits(org.id, db) is True

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True, "limit": 1}), patch(
            "src.security.features_utils.usage.get_deployment_mode", return_value="saas"
        ), patch("src.security.features_utils.usage.get_ai_credit_limit", return_value=5), patch(
            "src.security.features_utils.usage._get_redis_client"
        ) as redis_client:
            redis_client.return_value.mget.return_value = (b"2", b"10")
            with pytest.raises(HTTPException) as limit_exc:
                usage.check_ai_credits(org.id, db)
        assert limit_exc.value.status_code == 403

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client:
            redis_client.return_value.get.return_value = b"4"
            assert usage.deduct_ai_credit(org.id, db, amount=2) == 6
            redis_client.return_value.set.assert_called_once_with("ai_credits_used:1", 6)

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client:
            redis_client.return_value.incrby.return_value = 12
            assert usage.add_ai_credits(org.id, 5) == 12
            redis_client.return_value.incrby.assert_called_once_with("ai_credits_purchased:1", 5)

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client:
            assert usage.reset_ai_credits_usage(org.id) is True
            redis_client.return_value.set.assert_called_once_with("ai_credits_used:1", 0)

    def test_ai_credit_summary_paths(self, db, org):
        _make_org_config(
            db,
            org.id,
            {
                "config_version": "2.0",
                "plan": "standard",
                "overrides": {"ai": {"extra_limit": 2}},
            },
        )

        assert usage.get_ai_credits_summary(999, db) == {"error": "Organization has no config"}

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client, patch(
            "src.security.features_utils.usage.get_deployment_mode", return_value="ee"
        ):
            redis_client.return_value.get.return_value = b"3"
            summary = usage.get_ai_credits_summary(org.id, db)

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
            summary = usage.get_ai_credits_summary(org.id, db)

        assert summary["base_credits"] == "unlimited"
        assert summary["purchased_credits"] == 4
        assert summary["used_credits"] == 6
        assert summary["remaining_credits"] == "unlimited"

        with patch("src.security.features_utils.usage._get_redis_client") as redis_client, patch(
            "src.security.features_utils.usage.get_deployment_mode", return_value="saas"
        ), patch("src.security.features_utils.usage.get_ai_credit_limit", return_value=5):
            redis_client.return_value.mget.return_value = (b"4", b"6")
            summary = usage.get_ai_credits_summary(org.id, db)

        assert summary == {
            "plan": "standard",
            "base_credits": 5,
            "purchased_credits": 4,
            "total_credits": 9,
            "used_credits": 6,
            "remaining_credits": 3,
        }
