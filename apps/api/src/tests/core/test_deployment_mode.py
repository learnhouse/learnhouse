from types import SimpleNamespace
from unittest.mock import patch

from src.core.deployment_mode import get_deployment_mode


def _config(saas_mode: bool):
    return SimpleNamespace(general_config=SimpleNamespace(saas_mode=saas_mode))


def test_get_deployment_mode_prefers_saas_over_ee():
    with (
        patch("src.core.deployment_mode.get_learnhouse_config", return_value=_config(True)),
        patch("src.core.deployment_mode.is_ee_available", return_value=True),
    ):
        assert get_deployment_mode() == "saas"


def test_get_deployment_mode_returns_ee_for_self_hosted_enterprise():
    with (
        patch("src.core.deployment_mode.get_learnhouse_config", return_value=_config(False)),
        patch("src.core.deployment_mode.is_ee_available", return_value=True),
        patch("src.core.deployment_mode.get_ee_hooks", return_value=None),
    ):
        assert get_deployment_mode() == "ee"


def test_get_deployment_mode_returns_oss_when_ee_unavailable():
    with (
        patch("src.core.deployment_mode.get_learnhouse_config", return_value=_config(False)),
        patch("src.core.deployment_mode.is_ee_available", return_value=False),
    ):
        assert get_deployment_mode() == "oss"


def test_get_deployment_mode_returns_ee_when_license_active():
    hooks = SimpleNamespace(is_license_active=lambda: True)
    with (
        patch("src.core.deployment_mode.get_learnhouse_config", return_value=_config(False)),
        patch("src.core.deployment_mode.is_ee_available", return_value=True),
        patch("src.core.deployment_mode.get_ee_hooks", return_value=hooks),
    ):
        assert get_deployment_mode() == "ee"


def test_get_deployment_mode_degrades_to_oss_when_license_inactive():
    hooks = SimpleNamespace(is_license_active=lambda: False)
    with (
        patch("src.core.deployment_mode.get_learnhouse_config", return_value=_config(False)),
        patch("src.core.deployment_mode.is_ee_available", return_value=True),
        patch("src.core.deployment_mode.get_ee_hooks", return_value=hooks),
    ):
        assert get_deployment_mode() == "oss"


def test_get_deployment_mode_returns_ee_for_legacy_hooks_without_license_check():
    hooks = SimpleNamespace()
    with (
        patch("src.core.deployment_mode.get_learnhouse_config", return_value=_config(False)),
        patch("src.core.deployment_mode.is_ee_available", return_value=True),
        patch("src.core.deployment_mode.get_ee_hooks", return_value=hooks),
    ):
        assert get_deployment_mode() == "ee"
