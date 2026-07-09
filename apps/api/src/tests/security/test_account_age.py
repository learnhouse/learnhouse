"""Tests for the free-tier account/organization age gate.

The trickiest correctness point is that ``creation_date`` is a varchar written
by ``str(datetime.now())`` — a naive, space-separated, server-local timestamp.
All age math happens in Python; unparseable/legacy dates fail OPEN.
"""
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.services.security import account_age
from src.services.security.account_age import (
    account_age_days,
    enforce_free_tier_age_gate,
    is_free_tier_age_gated,
    parse_creation_date,
)

NOW = datetime(2026, 7, 9, 12, 0, 0, tzinfo=timezone.utc)


def test_parse_creation_date_roundtrips_str_datetime_now():
    # This is exactly the format the app persists: str(datetime.now()).
    raw = "2026-07-09 11:47:21.155477"
    parsed = parse_creation_date(raw)
    assert parsed is not None
    assert parsed.tzinfo is not None  # normalized to aware UTC
    assert parsed.year == 2026 and parsed.minute == 47


@pytest.mark.parametrize("raw", ["", None, "garbage", "not-a-date", "   "])
def test_parse_creation_date_returns_none_for_unparseable(raw):
    assert parse_creation_date(raw) is None


def test_parse_creation_date_handles_iso_and_z_suffix():
    assert parse_creation_date("2026-07-09T11:47:21+00:00") is not None
    assert parse_creation_date("2026-07-09T11:47:21Z") is not None


def test_account_age_days_math():
    assert account_age_days("2026-07-01 12:00:00", now=NOW) == pytest.approx(8.0)
    assert account_age_days("2026-07-09 11:00:00", now=NOW) == pytest.approx(1 / 24, abs=1e-6)
    # Fail-open: unknown age → None (caller treats as old enough).
    assert account_age_days("", now=NOW) is None


def _db_returning(org, user):
    """Fake AsyncSession whose execute() returns org then user in call order."""
    def _result(obj):
        scalars = SimpleNamespace(first=lambda: obj)
        return SimpleNamespace(scalars=lambda: scalars)

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[_result(org), _result(user)])
    return db


@pytest.mark.asyncio
async def test_gate_skips_non_saas():
    with patch.object(account_age, "_is_non_saas", return_value=True):
        assert await is_free_tier_age_gated(1, 2, AsyncMock()) == []


@pytest.mark.asyncio
async def test_gate_exempts_paid_org():
    with patch.object(account_age, "_is_non_saas", return_value=False), \
         patch.object(account_age, "_get_org_config", AsyncMock(return_value=object())), \
         patch.object(account_age, "_get_org_plan", return_value="pro"):
        assert await is_free_tier_age_gated(1, 2, AsyncMock()) == []


@pytest.mark.asyncio
async def test_gate_flags_new_free_org_and_account():
    org = SimpleNamespace(creation_date=str(NOW.replace(tzinfo=None)))
    user = SimpleNamespace(creation_date=str(NOW.replace(tzinfo=None)))
    db = _db_returning(org, user)
    with patch.object(account_age, "_is_non_saas", return_value=False), \
         patch.object(account_age, "_get_org_config", AsyncMock(return_value=object())), \
         patch.object(account_age, "_get_org_plan", return_value="free"):
        too_new = await is_free_tier_age_gated(1, 2, db)
    assert set(too_new) == {"organization", "account"}


@pytest.mark.asyncio
async def test_gate_allows_old_free_org():
    org = SimpleNamespace(creation_date="2026-01-01 00:00:00")
    user = SimpleNamespace(creation_date="2026-01-01 00:00:00")
    db = _db_returning(org, user)
    with patch.object(account_age, "_is_non_saas", return_value=False), \
         patch.object(account_age, "_get_org_config", AsyncMock(return_value=object())), \
         patch.object(account_age, "_get_org_plan", return_value="free"):
        assert await is_free_tier_age_gated(1, 2, db) == []


@pytest.mark.asyncio
async def test_gate_fails_open_on_legacy_empty_dates():
    org = SimpleNamespace(creation_date="")
    user = SimpleNamespace(creation_date="")
    db = _db_returning(org, user)
    with patch.object(account_age, "_is_non_saas", return_value=False), \
         patch.object(account_age, "_get_org_config", AsyncMock(return_value=object())), \
         patch.object(account_age, "_get_org_plan", return_value="free"):
        assert await is_free_tier_age_gated(1, 2, db) == []


@pytest.mark.asyncio
async def test_enforce_raises_403_account_too_new():
    org = SimpleNamespace(creation_date=str(NOW.replace(tzinfo=None)))
    user = SimpleNamespace(creation_date=str(NOW.replace(tzinfo=None)))
    db = _db_returning(org, user)
    with patch.object(account_age, "_is_non_saas", return_value=False), \
         patch.object(account_age, "_get_org_config", AsyncMock(return_value=object())), \
         patch.object(account_age, "_get_org_plan", return_value="free"):
        with pytest.raises(HTTPException) as exc:
            await enforce_free_tier_age_gate(1, 2, db, action="invite members")
    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "ACCOUNT_TOO_NEW"
    assert "invite members" in exc.value.detail["message"]
