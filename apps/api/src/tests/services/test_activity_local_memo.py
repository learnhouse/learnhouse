"""The in-process day memo in front of the Redis activity guard."""

from unittest.mock import AsyncMock, MagicMock, patch

import fakeredis
import pytest

from src.services.security import activity


@pytest.fixture(autouse=True)
def _clean_memo():
    activity._TOUCHED_LOCAL.clear()
    yield
    activity._TOUCHED_LOCAL.clear()


def _enabled():
    return patch.object(activity, "_activity_tracking_enabled", return_value=True)


async def test_written_day_is_not_rechecked():
    r = fakeredis.FakeRedis()
    insert = AsyncMock(return_value=True)
    with _enabled(), patch.object(activity, "get_redis_client", return_value=r), patch.object(
        activity, "_insert_activity_row", insert
    ):
        await activity.record_user_activity(7, org_id=3)
        spy = MagicMock(wraps=r)
        with patch.object(activity, "get_redis_client", return_value=spy):
            await activity.record_user_activity(7, org_id=3)
    insert.assert_awaited_once()
    spy.set.assert_not_called()


async def test_key_set_elsewhere_is_remembered():
    r = fakeredis.FakeRedis()
    key_prefix = "activity_touched:3:8:"
    insert = AsyncMock(return_value=True)
    with _enabled(), patch.object(activity, "get_redis_client", return_value=r), patch.object(
        activity, "_insert_activity_row", insert
    ):
        # Another pod already wrote today's row.
        from datetime import datetime, timezone

        r.set(key_prefix + datetime.now(timezone.utc).date().isoformat(), "1")
        await activity.record_user_activity(8, org_id=3)
    insert.assert_not_awaited()
    assert any(k.startswith(key_prefix) for k in activity._TOUCHED_LOCAL)


async def test_non_member_answer_is_not_remembered():
    r = fakeredis.FakeRedis()
    insert = AsyncMock(return_value=False)
    with _enabled(), patch.object(activity, "get_redis_client", return_value=r), patch.object(
        activity, "_insert_activity_row", insert
    ):
        await activity.record_user_activity(9, org_id=3)  # not a member: guard set to "0"
        await activity.record_user_activity(9, org_id=3)  # guard present, holds "0"
    assert activity._TOUCHED_LOCAL == set()
    insert.assert_awaited_once()


async def test_memo_is_skipped_without_redis():
    insert = AsyncMock(return_value=True)
    with _enabled(), patch.object(activity, "get_redis_client", return_value=None), patch.object(
        activity, "_insert_activity_row", insert
    ):
        await activity.record_user_activity(10, org_id=3)
        await activity.record_user_activity(10, org_id=3)
    assert insert.await_count == 2


def test_memo_is_bounded(monkeypatch):
    monkeypatch.setattr(activity, "_TOUCHED_LOCAL_MAX", 2)
    activity._remember_touched("a")
    activity._remember_touched("b")
    activity._remember_touched("c")
    assert activity._TOUCHED_LOCAL == {"c"}
