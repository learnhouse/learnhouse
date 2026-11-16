"""Free trials get a small AI credit allowance, not the trial plan's full one."""

from unittest.mock import AsyncMock, patch

import pytest

from src.db.org_plan_state import TrialStatus
from src.security.features_utils import usage
from src.services.plans import trial


class TestTrialCreditCap:
    def test_default_and_override(self, monkeypatch):
        monkeypatch.delenv("LEARNHOUSE_TRIAL_AI_CREDITS", raising=False)
        assert trial.trial_ai_credits() == 200
        monkeypatch.setenv("LEARNHOUSE_TRIAL_AI_CREDITS", "50")
        assert trial.trial_ai_credits() == 50
        monkeypatch.setenv("LEARNHOUSE_TRIAL_AI_CREDITS", "-5")
        assert trial.trial_ai_credits() == 0
        monkeypatch.setenv("LEARNHOUSE_TRIAL_AI_CREDITS", "lots")
        assert trial.trial_ai_credits() == 200

    async def test_only_an_active_trial_on_the_trial_plan_is_capped(self, monkeypatch):
        monkeypatch.delenv("LEARNHOUSE_TRIAL_AI_CREDITS", raising=False)
        active = AsyncMock(return_value=type("T", (), {"status": TrialStatus.ACTIVE})())
        with patch.object(trial, "trials_enabled", return_value=True), patch.object(trial, "get_active_trial", active):
            assert await trial.trial_ai_credit_cap(None, 1, trial.TRIAL_PLAN) == 200
            # A paid plan (bought during or after the trial) is never capped.
            assert await trial.trial_ai_credit_cap(None, 1, "standard") is None
        with patch.object(trial, "trials_enabled", return_value=True), \
             patch.object(trial, "get_active_trial", AsyncMock(return_value=None)):
            assert await trial.trial_ai_credit_cap(None, 1, trial.TRIAL_PLAN) is None
        with patch.object(trial, "trials_enabled", return_value=False):
            assert await trial.trial_ai_credit_cap(None, 1, trial.TRIAL_PLAN) is None


class TestBaseCredits:
    @pytest.mark.parametrize(
        "plan_limit, cap, expected",
        [
            (2000, 200, 200),  # trial: capped
            (2000, None, 2000),  # paid: the plan's allowance
            (20, 200, 20),  # never raised above the plan
            (-1, 200, 200),  # an unlimited plan in trial is still capped
            (0, 200, 0),  # no AI at all stays none
        ],
    )
    async def test_cap(self, plan_limit, cap, expected):
        with patch.object(usage, "get_ai_credit_limit", return_value=plan_limit), \
             patch("src.services.plans.trial.trial_ai_credit_cap", AsyncMock(return_value=cap)):
            assert await usage._base_ai_credits(1, "pro", None) == expected
