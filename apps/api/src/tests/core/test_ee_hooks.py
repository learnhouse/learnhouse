from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from src.core import ee_hooks
from src.core.ee_hooks import register_ee_middlewares


def _config(saas_mode: bool):
    return SimpleNamespace(general_config=SimpleNamespace(saas_mode=saas_mode))


def test_register_ee_middlewares_in_saas_mode_only_adds_the_audit_context():
    """SaaS skips the request audit middleware; it only gets the light one that
    gives typed audit events their request id, IP and user agent."""
    app = MagicMock()
    hooks = SimpleNamespace(register_middlewares=MagicMock(), register_saas_middlewares=MagicMock())
    with (
        patch("config.config.get_learnhouse_config", return_value=_config(True)),
        patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks),
    ):
        register_ee_middlewares(app)
    hooks.register_saas_middlewares.assert_called_once_with(app)
    hooks.register_middlewares.assert_not_called()
    with (
        patch("config.config.get_learnhouse_config", return_value=_config(True)),
        patch("src.core.ee_hooks.get_ee_hooks", return_value=None),
    ):
        register_ee_middlewares(app)


def test_audit_event_forwards_to_ee_and_never_raises():
    calls = []
    hooks = SimpleNamespace(record_audit_event=lambda request, **kw: calls.append((request, kw)))
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks):
        ee_hooks.audit_event("req", action="course.updated", org_id=1, target_id="c")
    assert calls == [("req", {"action": "course.updated", "org_id": 1, "target_id": "c"})]

    def boom(*_a, **_kw):
        raise RuntimeError("down")

    with patch("src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace(record_audit_event=boom)):
        ee_hooks.audit_event(None, action="x.y", org_id=1)
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
        ee_hooks.audit_event(None, action="x.y", org_id=1)


def test_audit_agent_action_forwards_and_never_raises():
    calls = []
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace(record_agent_audit=lambda **kw: calls.append(kw))):
        ee_hooks.audit_agent_action(via="mcp", tool="t")
    assert calls == [{"via": "mcp", "tool": "t"}]

    def boom(**_kw):
        raise RuntimeError("down")

    with patch("src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace(record_agent_audit=boom)):
        ee_hooks.audit_agent_action(via="mcp")
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
        ee_hooks.audit_agent_action(via="mcp")


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


def test_register_ee_platform_mcp_mounts_through_ee():
    hooks = SimpleNamespace(register_platform_mcp=MagicMock())
    app = object()
    with patch.object(ee_hooks, "get_ee_hooks", return_value=hooks):
        ee_hooks.register_ee_platform_mcp(app)
    hooks.register_platform_mcp.assert_called_once_with(app)


def test_register_ee_platform_mcp_without_ee_or_on_failure():
    with patch.object(ee_hooks, "get_ee_hooks", return_value=None):
        ee_hooks.register_ee_platform_mcp(object())
    with patch.object(ee_hooks, "get_ee_hooks", return_value=SimpleNamespace()):
        ee_hooks.register_ee_platform_mcp(object())
    broken = SimpleNamespace(register_platform_mcp=MagicMock(side_effect=RuntimeError("boom")))
    with patch.object(ee_hooks, "get_ee_hooks", return_value=broken):
        ee_hooks.register_ee_platform_mcp(object())  # logged, never raises
