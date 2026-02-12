"""
Unit tests for analytics security (org membership checks, event validation).

Tests cover:
- _verify_org_membership rejects non-members
- _verify_org_membership allows members
- _verify_org_membership allows superadmins
- _validate_course_uuid rejects SQL injection
- _build_sql type safety
- FrontendEvent model validation
"""

import pytest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException


class TestVerifyOrgMembership:
    """Test _verify_org_membership in analytics.py."""

    def _make_db_session(self, has_membership=False, is_superadmin=False):
        session = MagicMock()
        result = MagicMock()
        if has_membership:
            result.first.return_value = MagicMock()  # membership exists
        else:
            result.first.return_value = None
        session.exec.return_value = result
        return session

    @patch("src.routers.analytics.is_user_superadmin", return_value=False)
    def test_non_member_rejected(self, mock_superadmin):
        from src.routers.analytics import _verify_org_membership
        db = self._make_db_session(has_membership=False)
        with pytest.raises(HTTPException) as exc_info:
            _verify_org_membership(user_id=1, org_id=99, db_session=db)
        assert exc_info.value.status_code == 403

    @patch("src.routers.analytics.is_user_superadmin", return_value=False)
    def test_member_allowed(self, mock_superadmin):
        from src.routers.analytics import _verify_org_membership
        db = self._make_db_session(has_membership=True)
        # Should not raise
        _verify_org_membership(user_id=1, org_id=1, db_session=db)

    @patch("src.routers.analytics.is_user_superadmin", return_value=True)
    def test_superadmin_bypasses(self, mock_superadmin):
        from src.routers.analytics import _verify_org_membership
        db = self._make_db_session(has_membership=False)
        # Should not raise even though not a member
        _verify_org_membership(user_id=1, org_id=99, db_session=db)


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


class TestBuildSql:
    """Test _build_sql type safety."""

    def test_integer_params(self):
        from src.routers.analytics import _build_sql
        sql = _build_sql("SELECT * WHERE org_id={org_id} AND days={days}", 1, 30)
        assert "org_id=1" in sql
        assert "days=30" in sql

    def test_string_org_id_rejected(self):
        from src.routers.analytics import _build_sql
        with pytest.raises(HTTPException):
            _build_sql("SELECT *", "1; DROP TABLE", 30)

    def test_course_uuid_validated(self):
        from src.routers.analytics import _build_sql
        with pytest.raises(HTTPException):
            _build_sql(
                "SELECT * WHERE course_uuid='{course_uuid}'",
                1, 30,
                course_uuid="'; DROP TABLE events; --"
            )

    def test_valid_course_uuid_in_sql(self):
        from src.routers.analytics import _build_sql
        sql = _build_sql(
            "SELECT * WHERE course_uuid='{course_uuid}'",
            1, 30,
            course_uuid="course_abc-123"
        )
        assert "course_abc-123" in sql


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
