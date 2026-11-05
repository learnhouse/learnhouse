"""Tests for the agent-facing analytics runner composites.

Covers the auth gates and catalog restrictions of `execute_org_query`
and `execute_course_query` in `src/services/analytics/runner.py`, which the
analytics tools use. The query executor and membership checks live in the
analytics router, so that is where they are stubbed.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.routers import analytics as router
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
    """Membership/admin pass, Pro plan; query executor + enrichment stubbed."""
    execute = AsyncMock(return_value=dict(_ROWS))
    with patch.object(router, "_verify_org_membership", new_callable=AsyncMock), \
         patch.object(router, "_verify_org_admin", new_callable=AsyncMock), \
         patch.object(router, "_execute_query", execute), \
         patch.object(runner, "get_org_plan", new_callable=AsyncMock, return_value="pro"), \
         patch.object(
             runner,
             "enrich_with_metadata",
             new_callable=AsyncMock,
             side_effect=lambda rows, db, org_id=None: rows,
         ):
        yield execute


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
    name, sql, params, org_id, days = _gates_open.await_args.args
    assert (name, sql, params, org_id, days) == (CORE, CORE_QUERIES[CORE][0], {"org_id": 1, "days": 7}, 1, 7)


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
    assert _gates_open.await_args.args[2] == {"org_id": 1, "days": 7, "course_uuid": "course_x"}
    assert _gates_open.await_args.kwargs == {"course_id": "course_x"}


async def test_days_are_clamped_like_the_endpoint(db, _gates_open):
    with patch(
        "src.security.features_utils.plan_check._check_mode_bypass", return_value=True
    ):
        await runner.execute_org_query(CORE, 1, 99999, db, acting_user_id=1)
    assert _gates_open.await_args.args[4] == runner.MAX_DAYS
    assert _gates_open.await_args.args[2]["days"] == runner.MAX_DAYS


async def test_invalid_days_rejected(db, _gates_open):
    with pytest.raises(HTTPException) as exc:
        await runner.execute_org_query(CORE, 1, "abc", db, acting_user_id=1)
    assert exc.value.status_code == 400
