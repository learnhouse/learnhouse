"""Tests for the agent-facing analytics runner composites.

Covers the auth gates and catalog restrictions of `execute_org_query`
and `execute_course_query` in `src/services/analytics/runner.py` — the
new surface both the dashboard endpoints and the analytics tools share.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.services.analytics import runner
from src.services.analytics.queries import (
    ADVANCED_QUERIES,
    CORE_QUERIES,
    COURSE_QUERIES,
    DETAIL_QUERIES,
)

CORE = sorted(CORE_QUERIES)[0]
ADVANCED = sorted(ADVANCED_QUERIES)[0]
COURSE = sorted(COURSE_QUERIES)[0]
DETAIL = sorted(DETAIL_QUERIES)[0]

_ROWS = {"data": [{"course_uuid": "course_x"}], "rows": 1, "meta": []}


@pytest.fixture
def _gates_open():
    """Membership/admin pass; tinybird + enrichment stubbed."""
    with patch.object(runner, "verify_org_membership", new_callable=AsyncMock), \
         patch.object(runner, "verify_org_admin", new_callable=AsyncMock), \
         patch.object(
             runner, "execute_tinybird_query", new_callable=AsyncMock, return_value=dict(_ROWS)
         ), \
         patch.object(
             runner, "enrich_with_metadata", new_callable=AsyncMock, side_effect=lambda rows, db: rows
         ):
        yield


async def test_org_query_rejects_unknown_name(db, _gates_open):
    with pytest.raises(HTTPException) as exc:
        await runner.execute_org_query("not_a_query", 1, 7, db, acting_user_id=1)
    assert exc.value.status_code == 404


async def test_org_query_rejects_detail_query(db, _gates_open):
    with pytest.raises(HTTPException) as exc:
        await runner.execute_org_query(DETAIL, 1, 7, db, acting_user_id=1)
    assert exc.value.status_code == 404


async def test_org_query_core_runs(db, _gates_open):
    with patch(
        "src.security.features_utils.plan_check._check_mode_bypass", return_value=True
    ):
        result = await runner.execute_org_query(CORE, 1, 7, db, acting_user_id=1)
    assert result["data"] == _ROWS["data"]


async def test_org_query_advanced_blocked_without_plan(db, _gates_open):
    with patch(
        "src.security.features_utils.plan_check._check_mode_bypass", return_value=None
    ), patch.object(
        runner, "get_org_plan", new_callable=AsyncMock, return_value="free"
    ), patch.object(runner, "plan_meets_requirement", return_value=False):
        with pytest.raises(HTTPException) as exc:
            await runner.execute_org_query(ADVANCED, 1, 7, db, acting_user_id=1)
    assert exc.value.status_code == 403
    assert "Enterprise" in exc.value.detail


async def test_org_query_advanced_allowed_with_plan(db, _gates_open):
    with patch(
        "src.security.features_utils.plan_check._check_mode_bypass", return_value=None
    ), patch.object(
        runner, "get_org_plan", new_callable=AsyncMock, return_value="enterprise"
    ), patch.object(runner, "plan_meets_requirement", return_value=True):
        result = await runner.execute_org_query(ADVANCED, 1, 7, db, acting_user_id=1)
    assert "data" in result


async def test_course_query_requires_pro_plan(db, _gates_open):
    with patch(
        "src.security.features_utils.plan_check._check_mode_bypass", return_value=None
    ), patch.object(
        runner, "get_org_plan", new_callable=AsyncMock, return_value="free"
    ), patch.object(runner, "plan_meets_requirement", return_value=False):
        with pytest.raises(HTTPException) as exc:
            await runner.execute_course_query(COURSE, "course_x", 1, 7, db, acting_user_id=1)
    assert exc.value.status_code == 403


async def test_course_query_rejects_unknown_name(db, _gates_open):
    with patch(
        "src.security.features_utils.plan_check._check_mode_bypass", return_value=True
    ):
        with pytest.raises(HTTPException) as exc:
            await runner.execute_course_query("nope", "course_x", 1, 7, db, acting_user_id=1)
    assert exc.value.status_code == 404


async def test_course_query_validates_course_uuid(db, _gates_open):
    with patch(
        "src.security.features_utils.plan_check._check_mode_bypass", return_value=True
    ):
        with pytest.raises(HTTPException) as exc:
            await runner.execute_course_query(COURSE, "bad uuid!", 1, 7, db, acting_user_id=1)
    assert exc.value.status_code == 400


async def test_course_query_runs(db, _gates_open):
    with patch(
        "src.security.features_utils.plan_check._check_mode_bypass", return_value=True
    ):
        result = await runner.execute_course_query(
            COURSE, "course_x", 1, 7, db, acting_user_id=1
        )
    assert result["data"] == _ROWS["data"]
