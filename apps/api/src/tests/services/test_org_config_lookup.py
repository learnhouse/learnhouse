"""Tests for src/services/orgs/org_config_lookup.py."""

from unittest.mock import AsyncMock, Mock

from src.db.organization_config import OrganizationConfig
from src.services.orgs.org_config_lookup import get_session_org_config


async def _add_config(db, org_id, config=None):
    row = OrganizationConfig(org_id=org_id, config=config or {"config_version": "1.0"})
    db.add(row)
    await db.commit()
    return row


async def test_returns_none_when_org_has_no_config(db, org):
    assert await get_session_org_config(db, org.id) is None


async def test_reuses_the_row_this_session_already_loaded(db, org):
    await _add_config(db, org.id)
    db.expunge_all()

    first = await get_session_org_config(db, org.id)
    assert first is not None

    db.execute = AsyncMock(side_effect=AssertionError("should not hit the database"))
    try:
        assert await get_session_org_config(db, org.id) is first
    finally:
        del db.execute


async def test_expired_row_is_reloaded_not_served_stale(db, org):
    row = await _add_config(db, org.id, {"config_version": "1.0", "marker": "old"})
    db.expire(row)

    fresh = await get_session_org_config(db, org.id)
    assert fresh is not None
    assert fresh.config["marker"] == "old"


async def test_does_not_return_another_orgs_config(db, org):
    await _add_config(db, org.id)
    await get_session_org_config(db, org.id)
    assert await get_session_org_config(db, org.id + 999) is None


async def test_non_session_double_falls_back_to_query():
    row = OrganizationConfig(org_id=1, config={})
    result = Mock()
    result.scalars.return_value.first.return_value = row
    session = Mock()
    session.execute = AsyncMock(return_value=result)
    assert await get_session_org_config(session, 1) is row
    session.execute.assert_awaited_once()
