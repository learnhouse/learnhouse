from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from src.core.ee_hooks import register_ee_middlewares


def _config(saas_mode: bool):
    return SimpleNamespace(general_config=SimpleNamespace(saas_mode=saas_mode))


def test_register_ee_middlewares_skips_in_saas_mode():
    app = MagicMock()
    with (
        patch("config.config.get_learnhouse_config", return_value=_config(True)),
        patch("src.core.ee_hooks.get_ee_hooks") as mock_get_hooks,
    ):
        register_ee_middlewares(app)
        mock_get_hooks.assert_not_called()


def test_register_ee_middlewares_calls_hooks_when_not_saas():
    app = MagicMock()
    hooks = SimpleNamespace(register_middlewares=MagicMock())
    with (
        patch("config.config.get_learnhouse_config", return_value=_config(False)),
        patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks),
    ):
        register_ee_middlewares(app)
        hooks.register_middlewares.assert_called_once_with(app)


def test_register_ee_middlewares_no_hooks_when_not_saas():
    app = MagicMock()
    with (
        patch("config.config.get_learnhouse_config", return_value=_config(False)),
        patch("src.core.ee_hooks.get_ee_hooks", return_value=None),
    ):
        register_ee_middlewares(app)
