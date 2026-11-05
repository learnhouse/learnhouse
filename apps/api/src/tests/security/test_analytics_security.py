"""
Unit tests for analytics security (org membership checks, event validation).

Tests cover:
- _verify_org_membership rejects non-members
- _verify_org_membership allows members
- _verify_org_membership allows superadmins
- _validate_course_uuid rejects SQL injection
- _query_params type safety (queries take bind parameters, never interpolation)
- the query catalog only uses known bind parameters and scopes every query
"""

import re

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException


class TestVerifyOrgMembership:
    """Test _verify_org_membership in analytics.py."""

    def _make_db_session(self, has_membership=False, is_superadmin=False):
        session = AsyncMock()
        membership = MagicMock() if has_membership else None
        _scalars = MagicMock()
        _scalars.first.return_value = membership
        _exec_result = MagicMock()
        _exec_result.scalars.return_value = _scalars
        session.execute.return_value = _exec_result
        return session

    @pytest.mark.asyncio
    async def test_non_member_rejected(self):
        from src.routers.analytics import _verify_org_membership
        db = self._make_db_session(has_membership=False)
        with patch("src.routers.analytics.is_user_superadmin", AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc_info:
                await _verify_org_membership(user_id=1, org_id=99, db_session=db)
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_member_allowed(self):
        from src.routers.analytics import _verify_org_membership
        db = self._make_db_session(has_membership=True)
        with patch("src.routers.analytics.is_user_superadmin", AsyncMock(return_value=False)):
            # Should not raise
            await _verify_org_membership(user_id=1, org_id=1, db_session=db)

    @pytest.mark.asyncio
    async def test_superadmin_bypasses(self):
        from src.routers.analytics import _verify_org_membership
        db = self._make_db_session(has_membership=False)
        with patch("src.routers.analytics.is_user_superadmin", AsyncMock(return_value=True)):
            # Should not raise even though not a member
            await _verify_org_membership(user_id=1, org_id=99, db_session=db)


class TestValidateCourseUuid:
    """Test _validate_course_uuid in analytics.py."""

    def test_valid_course_uuid(self):
        from src.routers.analytics import _validate_course_uuid
        assert _validate_course_uuid("course_abc-123") == "course_abc-123"

    def test_sql_injection_rejected(self):
        from src.routers.analytics import _validate_course_uuid
        with pytest.raises(HTTPException) as exc_info:
            _validate_course_uuid("course'; DROP TABLE events; --")
        assert exc_info.value.status_code == 400

    def test_empty_rejected(self):
        from src.routers.analytics import _validate_course_uuid
        with pytest.raises(HTTPException):
            _validate_course_uuid("")

    def test_too_long_rejected(self):
        from src.routers.analytics import _validate_course_uuid
        with pytest.raises(HTTPException):
            _validate_course_uuid("a" * 101)

    def test_special_chars_rejected(self):
        from src.routers.analytics import _validate_course_uuid
        with pytest.raises(HTTPException):
            _validate_course_uuid("course{uuid}")

    def test_spaces_rejected(self):
        from src.routers.analytics import _validate_course_uuid
        with pytest.raises(HTTPException):
            _validate_course_uuid("course uuid")


class TestQueryParams:
    """Test _query_params type safety."""

    def test_integer_params(self):
        from src.routers.analytics import _query_params
        assert _query_params(1, 30) == {"org_id": 1, "days": 30}

    def test_string_org_id_rejected(self):
        from src.routers.analytics import _query_params
        with pytest.raises(HTTPException):
            _query_params("1; DROP TABLE", 30)

    def test_string_days_rejected(self):
        from src.routers.analytics import _query_params
        with pytest.raises(HTTPException):
            _query_params(1, "30")

    def test_course_uuid_validated(self):
        from src.routers.analytics import _query_params
        with pytest.raises(HTTPException):
            _query_params(1, 30, course_uuid="'; DROP TABLE events; --")

    def test_valid_course_uuid_bound(self):
        from src.routers.analytics import _query_params
        assert _query_params(1, 30, course_uuid="course_abc-123")["course_uuid"] == "course_abc-123"


def _bind_names(sql: str) -> set[str]:
    # Same rule as SQLAlchemy text(): ":name" not preceded by ":" or a word char
    # (so "::date" casts are not binds).
    return set(re.findall(r"(?<![:\w]):(\w+)", sql))


class TestQueryCatalog:
    """Static checks over every catalog query (the SQL itself is exercised on
    Postgres by scripts/ci_analytics_queries.py)."""

    def _registries(self):
        from src.services.analytics import queries as q
        return {
            "org": {**q.ALL_QUERIES, **q.SUPERADMIN_QUERIES},
            "course": {**q.COURSE_QUERIES, **q.COURSE_DETAIL_QUERIES},
            "user": q.USER_QUERIES,
        }

    def test_query_names_and_defaults_unchanged(self):
        from src.services.analytics import queries as q
        assert len(q.CORE_QUERIES) == 10
        assert len(q.ADVANCED_QUERIES) == 13
        assert len(q.DETAIL_QUERIES) == 5
        assert len(q.COURSE_QUERIES) == 18
        assert len(q.COURSE_DETAIL_QUERIES) == 2
        assert len(q.FEATURE_QUERIES) == 16
        assert set(q.ALL_QUERIES) == (
            set(q.CORE_QUERIES) | set(q.FEATURE_QUERIES) | set(q.ADVANCED_QUERIES) | set(q.DETAIL_QUERIES)
        )
        assert q.CORE_QUERIES["live_users"][1] == 0
        assert q.ADVANCED_QUERIES["time_to_completion"][1] == 180
        assert set(q.USER_QUERIES) == {
            "user_time_total", "user_time_by_course", "user_views", "user_searches", "user_daily_activity",
        }
        assert set(q.SUPERADMIN_QUERIES) == {"superadmin_org_visits_rank", "superadmin_org_weekly_visits"}

    def test_feature_queries_are_core_and_keep_their_names(self):
        # The web dashboard reads these by name and column; plan-gated
        # (advanced) queries would 403 on smaller plans.
        from src.services.analytics import queries as q
        assert list(q.FEATURE_QUERIES) == [
            "feature_summary", "feature_usage_daily", "video_engagement", "podcast_engagement",
            "assessment_summary", "assessment_daily", "community_daily", "top_communities",
            "ai_daily", "ai_by_surface", "acquisition_methods", "paths_summary",
            "top_boards_playgrounds", "content_creation_daily", "nudge_effectiveness",
            "library_top_resources",
        ]
        assert not set(q.FEATURE_QUERIES) & set(q.ADVANCED_QUERIES)
        assert not set(q.FEATURE_QUERIES) & set(q.CORE_QUERIES)
        assert all(days == 30 for _sql, days in q.FEATURE_QUERIES.values())
        for name, (sql, _days) in q.FEATURE_QUERIES.items():
            assert q.ALL_QUERIES[name][0] is sql

    def test_feature_groups_only_use_catalogued_events(self):
        from src.services.analytics import queries as q
        from src.services.analytics.events import CATALOG
        grouped = [name for names in q.FEATURE_GROUPS.values() for name in names]
        assert len(grouped) == len(set(grouped)), "an event belongs to two features"
        assert set(grouped) <= set(CATALOG)
        for name in grouped:
            assert f"'{name}'" in q.FEATURE_SUMMARY and f"'{name}'" in q.FEATURE_USAGE_DAILY

    def test_numeric_properties_are_read_without_casting_junk(self):
        # A non-number "percent" from a public beacon must not fail the chart.
        from src.services.analytics import queries as q
        assert q._num("percent") == (
            "(CASE WHEN jsonb_typeof(properties->'percent') = 'number' "
            "THEN (properties->>'percent')::numeric END)"
        )
        assert q._pct("a", "b").startswith("(CASE WHEN " + q._num("b") + " > 0 THEN ")
        for name in ("video_engagement", "podcast_engagement", "assessment_summary", "acquisition_methods"):
            sql = q.FEATURE_QUERIES[name][0]
            assert "->>'percent')::" not in sql.replace(q._num("percent"), ""), name

    def test_only_known_bind_parameters(self):
        allowed = {
            "org": {"org_id", "days"},
            "course": {"org_id", "days", "course_uuid"},
            "user": {"org_id", "days", "user_id"},
        }
        for kind, registry in self._registries().items():
            for name, (sql, _days) in registry.items():
                binds = _bind_names(sql)
                assert binds <= allowed[kind], f"{name}: unexpected binds {binds - allowed[kind]}"
                assert "org_id" in binds, f"{name} is not scoped to an org"

    def test_every_query_is_scoped(self):
        for kind, registry in self._registries().items():
            for name, (sql, _days) in registry.items():
                if kind == "user":
                    assert "org_id = :org_id" in sql and "user_id = :user_id" in sql, name
                else:
                    assert "(:org_id = 0 OR org_id = :org_id)" in sql, name
                if kind == "course":
                    assert "course_uuid = :course_uuid" in sql, name

    def test_no_string_formatting_or_clickhouse_left(self):
        # Older callers still run the SQL through str.format, so braces would break them.
        for registry in self._registries().values():
            for name, (sql, _days) in registry.items():
                assert "{" not in sql and "}" not in sql, name
                assert sql.format(org_id=1, days=30) == sql, name
                for token in ("FROM events", "uniqExact", "JSONExtract", "countIf", "toDate", "INTERVAL "):
                    assert token not in sql, f"{name} still uses {token}"


class TestParseParams:
    """Test _parse_safe_params."""

    def test_valid_params(self):
        from src.routers.analytics import _parse_safe_params
        request = MagicMock()
        request.query_params = {"days": "7"}
        org_id, days = _parse_safe_params(1, request, 30)
        assert org_id == 1
        assert days == 7

    def test_default_days(self):
        from src.routers.analytics import _parse_safe_params
        request = MagicMock()
        request.query_params = MagicMock()
        request.query_params.get = MagicMock(return_value="30")
        org_id, days = _parse_safe_params(1, request, 30)
        assert days == 30

    def test_invalid_days_rejected(self):
        from src.routers.analytics import _parse_safe_params
        request = MagicMock()
        request.query_params = MagicMock()
        request.query_params.get = MagicMock(return_value="not_a_number")
        with pytest.raises(HTTPException):
            _parse_safe_params(1, request, 30)
