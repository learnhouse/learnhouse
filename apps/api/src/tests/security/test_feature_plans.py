"""Tests for src/security/features_utils/plans.py."""

from unittest.mock import patch

import pytest

from src.security.features_utils.plans import (
    AI_CREDIT_LIMITS,
    FEATURE_PLAN_REQUIREMENTS,
    PLAN_FEATURE_CONFIGS,
    PLAN_HIERARCHY,
    PLAN_LIMITS,
    get_ai_credit_limit,
    get_feature_limit_for_plan,
    get_plan_config,
    get_plan_feature_config,
    get_plan_limit,
    get_required_plan_for_feature,
    is_feature_enabled_for_plan,
    plan_meets_requirement,
)


def _patch_mode(mode: str):
    return patch("src.core.deployment_mode.get_deployment_mode", return_value=mode)


class TestFeaturePlans:
    def test_constants_are_populated(self):
        assert PLAN_HIERARCHY == [
            "free",
            "personal",
            "personal-family",
            "standard",
            "pro",
            "business",
            "enterprise",
        ]
        assert FEATURE_PLAN_REQUIREMENTS["boards"] == "personal"
        assert PLAN_LIMITS["standard"]["members"] == 0
        assert AI_CREDIT_LIMITS["enterprise"] == -1
        assert PLAN_FEATURE_CONFIGS["free"]["cloud"]["plan"] == "free"

    def test_get_plan_feature_config_known_and_unknown(self):
        assert get_plan_feature_config("free", "courses") == {"enabled": True, "limit": 1}
        assert get_plan_feature_config("missing", "courses") == {"enabled": True, "limit": 1}
        assert get_plan_feature_config("free", "missing") == {"enabled": False, "limit": 0}

    def test_get_plan_config_known_and_unknown(self):
        assert get_plan_config("pro")["cloud"]["plan"] == "pro"
        assert get_plan_config("missing")["cloud"]["plan"] == "free"

    @pytest.mark.parametrize(
        ("mode", "plan", "feature", "expected"),
        [
            ("saas", "standard", "analytics", True),
            ("saas", "free", "analytics", False),
            ("ee", "free", "analytics", True),
            ("oss", "free", "boards", True),
            ("oss", "free", "analytics", False),
            ("oss", "free", "api", False),
            ("oss", "free", "sso", False),
            ("oss", "free", "audit_logs", False),
            ("oss", "free", "scorm", False),
            ("oss", "free", "scim", False),
            ("saas", "pro", "scim", False),
            ("saas", "business", "scim", True),
        ],
    )
    def test_is_feature_enabled_for_plan(self, mode, plan, feature, expected):
        with _patch_mode(mode):
            assert is_feature_enabled_for_plan(plan, feature) is expected

    @pytest.mark.parametrize(
        ("mode", "plan", "feature", "expected"),
        [
            ("saas", "standard", "members", 0),
            ("saas", "pro", "ai", 3000),
            ("saas", "missing", "ai", 0),
            ("saas", "free", "missing", 0),
            ("ee", "standard", "members", 0),
            ("oss", "standard", "members", 0),
        ],
    )
    def test_get_feature_limit_for_plan(self, mode, plan, feature, expected):
        with _patch_mode(mode):
            assert get_feature_limit_for_plan(plan, feature) == expected

    @pytest.mark.parametrize(
        ("mode", "plan", "expected"),
        [
            # Free orgs get a starter AI credit allowance so they can try the AI
            # features (incl. AI audio generation) before upgrading.
            ("saas", "free", 20),
            ("saas", "personal", 500),
            ("saas", "enterprise", -1),
            ("saas", "missing", 0),
            ("ee", "free", -1),
            ("oss", "free", -1),
        ],
    )
    def test_get_ai_credit_limit(self, mode, plan, expected):
        with _patch_mode(mode):
            assert get_ai_credit_limit(plan) == expected

    @pytest.mark.parametrize(
        ("mode", "plan", "feature", "expected"),
        [
            ("saas", "standard", "members", 0),
            ("saas", "pro", "admin_seats", 10),
            ("saas", "missing", "members", 10),
            ("saas", "free", "missing", 0),
            ("ee", "free", "members", 0),
            ("oss", "free", "members", 0),
        ],
    )
    def test_get_plan_limit(self, mode, plan, feature, expected):
        with _patch_mode(mode):
            assert get_plan_limit(plan, feature) == expected

    def test_plan_meets_requirement_saas(self):
        with _patch_mode("saas"):
            assert plan_meets_requirement("pro", "standard") is True
            assert plan_meets_requirement("standard", "pro") is False
            assert plan_meets_requirement("missing", "missing") is True

    def test_plan_meets_requirement_mode_bypass(self):
        with _patch_mode("ee"):
            assert plan_meets_requirement("free", "enterprise") is True

        with _patch_mode("oss"):
            assert plan_meets_requirement("free", "enterprise") is False
            assert plan_meets_requirement("free", "business") is False
            assert plan_meets_requirement("free", "pro") is True

    def test_business_plan_sits_between_pro_and_enterprise(self):
        # V2 pricing: SSO, LTI 1.3, SCORM and audit logs come with Business.
        for feature in ("sso", "scim", "lti", "scorm", "audit_logs", "live_sessions"):
            assert FEATURE_PLAN_REQUIREMENTS[feature] == "business"
            assert get_plan_feature_config("pro", feature)["enabled"] is False
            assert get_plan_feature_config("business", feature)["enabled"] is True
            assert get_plan_feature_config("enterprise", feature)["enabled"] is True
        # Custom roles, webhooks and advanced analytics stay on Pro.
        for feature in ("roles", "webhooks", "versioning"):
            assert get_plan_feature_config("pro", feature)["enabled"] is True
        assert FEATURE_PLAN_REQUIREMENTS["roles"] == "pro"
        assert FEATURE_PLAN_REQUIREMENTS["webhooks"] == "pro"
        assert FEATURE_PLAN_REQUIREMENTS["analytics_advanced"] == "pro"
        # Business keeps everything Pro has.
        for feature, cfg in PLAN_FEATURE_CONFIGS["pro"]["features"].items():
            if cfg.get("enabled"):
                assert PLAN_FEATURE_CONFIGS["business"]["features"][feature]["enabled"] is True
        assert PLAN_LIMITS["business"] == {"courses": 0, "members": 0, "admin_seats": 25}
        assert AI_CREDIT_LIMITS["business"] == 10000
        assert get_plan_config("business")["cloud"] == {"plan": "business", "custom_domain": True}
        with _patch_mode("saas"):
            assert plan_meets_requirement("business", "pro") is True
            assert plan_meets_requirement("business", "business") is True
            assert plan_meets_requirement("pro", "business") is False
            assert plan_meets_requirement("business", "enterprise") is False

    def test_get_required_plan_for_feature(self):
        assert get_required_plan_for_feature("boards") == "personal"
        assert get_required_plan_for_feature("unknown") is None
