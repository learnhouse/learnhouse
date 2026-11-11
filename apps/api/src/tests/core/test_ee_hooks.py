from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from src.core import ee_hooks
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


def test_notify_learner_progress_calls_hook():
    hooks = MagicMock()
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks):
        ee_hooks.notify_ee_learner_progress(3, 7)
    hooks.on_learner_progress.assert_called_once_with(3, 7)


def test_notify_learner_progress_without_ee_is_a_no_op():
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
        ee_hooks.notify_ee_learner_progress(3, 7)


def test_notify_learner_progress_never_raises():
    hooks = MagicMock()
    hooks.on_learner_progress.side_effect = RuntimeError("boom")
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks):
        ee_hooks.notify_ee_learner_progress(3, 7)


def test_notify_course_content_changed_calls_hook():
    hooks = MagicMock()
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks):
        ee_hooks.notify_ee_course_content_changed(7)
    hooks.on_course_content_changed.assert_called_once_with(7)


def test_notify_course_content_changed_never_raises():
    hooks = MagicMock()
    hooks.on_course_content_changed.side_effect = RuntimeError("boom")
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks):
        ee_hooks.notify_ee_course_content_changed(7)
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
        ee_hooks.notify_ee_course_content_changed(7)
