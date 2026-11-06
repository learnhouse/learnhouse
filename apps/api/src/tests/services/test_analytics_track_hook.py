"""Core's analytics hooks: ``track()`` forwards to EE and is a no-op without
it; the per-student audit's behavioural sections and the shutdown flush go
through ``ee_hooks`` the same way."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from src.core import ee_hooks
from src.services.analytics import events
from src.services.analytics.analytics import track


async def test_track_sends_every_argument(analytics_queue):
    await track(events.COURSE_ENROLLED, 3, user_id=4, properties={"course_uuid": "course_x"})
    assert analytics_queue == [{
        "event_name": events.COURSE_ENROLLED,
        "org_id": 3,
        "user_id": 4,
        "session_id": "",
        "properties": {"course_uuid": "course_x"},
        "source": "api",
        "actor_key": None,
        "country": None,
        "device": None,
    }]


async def test_track_never_raises():
    with patch(
        "src.services.analytics.analytics.track_ee_analytics_event",
        new=AsyncMock(side_effect=RuntimeError("boom")),
    ):
        await track(events.COURSE_ENROLLED, 3)


async def test_forwarding_without_ee_does_nothing():
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
        await ee_hooks.track_ee_analytics_event(event_name="page_view", org_id=1)
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace()):
        await ee_hooks.track_ee_analytics_event(event_name="page_view", org_id=1)


async def test_forwarding_hands_the_event_to_ee():
    hooks = SimpleNamespace(track_analytics_event=AsyncMock())
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks):
        await ee_hooks.track_ee_analytics_event(event_name="page_view", org_id=1, user_id=2)
    hooks.track_analytics_event.assert_awaited_once_with(event_name="page_view", org_id=1, user_id=2)


async def test_user_behavior_is_empty_without_ee():
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
        assert await ee_hooks.get_ee_user_behavior(5, 1, 30) == {}


async def test_user_behavior_comes_from_ee():
    hooks = SimpleNamespace(user_analytics_behavior=AsyncMock(return_value={"user_views": []}))
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks):
        assert await ee_hooks.get_ee_user_behavior(5, 1, 30) == {"user_views": []}
    hooks.user_analytics_behavior.assert_awaited_once_with(5, 1, 30)


async def test_shutdown_hook():
    app = object()
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
        await ee_hooks.run_ee_shutdown(app)

    hooks = SimpleNamespace(on_shutdown=AsyncMock())
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks):
        await ee_hooks.run_ee_shutdown(app)
    hooks.on_shutdown.assert_awaited_once_with(app)

    # A failing EE shutdown is logged; core's shutdown carries on.
    hooks = SimpleNamespace(on_shutdown=AsyncMock(side_effect=RuntimeError("boom")))
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks):
        await ee_hooks.run_ee_shutdown(app)
