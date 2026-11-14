"""Core seams live sessions (an EE feature) rely on: their uuids map to a
resource type, and the EE calendar sources hook never raises."""

from types import SimpleNamespace
from unittest.mock import patch

from src.core import ee_hooks


async def test_live_session_uuids_map_to_their_resource_type():
    from src.security.rbac.utils import check_element_type

    assert await check_element_type("livesession_abc") == "live_sessions"


def test_ee_calendar_sources_hook():
    hooks = SimpleNamespace(register_calendar_sources=lambda: None)
    with patch.object(ee_hooks, "get_ee_hooks", return_value=hooks):
        ee_hooks.register_ee_calendar_sources()

    def boom():
        raise RuntimeError("bad source")

    with patch.object(ee_hooks, "get_ee_hooks", return_value=SimpleNamespace(register_calendar_sources=boom)):
        ee_hooks.register_ee_calendar_sources()  # logged, not raised
