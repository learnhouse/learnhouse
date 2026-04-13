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
            "enterprise",
        ]
        assert FEATURE_PLAN_REQUIREMENTS["boards"] == "pro"
        assert PLAN_LIMITS["standard"]["members"] == 500
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
        ],
    )
    def test_is_feature_enabled_for_plan(self, mode, plan, feature, expected):
        with _patch_mode(mode):
            assert is_feature_enabled_for_plan(plan, feature) is expected

    @pytest.mark.parametrize(
        ("mode", "plan", "feature", "expected"),
        [
            ("saas", "standard", "members", 500),
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
            ("saas", "free", 0),
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
            ("saas", "standard", "members", 500),
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
            assert plan_meets_requirement("free", "pro") is True

    def test_get_required_plan_for_feature(self):
        assert get_required_plan_for_feature("boards") == "pro"
        assert get_required_plan_for_feature("unknown") is None
