from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.security.org_auth import (
    get_user_org,
    get_user_org_role,
    is_org_admin,
    is_org_member,
    require_org_admin,
    require_org_membership,
    require_org_role_permission,
)


def _session_with_firsts(*results: object) -> AsyncMock:
    """Build an AsyncMock session whose execute().scalars().first() returns results in order."""
    session = AsyncMock()
    calls = []

    async def _execute(_statement):
        idx = len(calls)
        calls.append(_statement)
        result_mock = MagicMock()
        result_mock.scalars.return_value.first.return_value = results[idx] if idx < len(results) else None
        return result_mock

    session.execute.side_effect = _execute
    return session


class TestOrgAuthHelpers:
    async def test_is_org_member_superadmin_bypass(self):
        session = AsyncMock()

        with patch("src.security.org_auth.is_user_superadmin", new=AsyncMock(return_value=True)):
            assert await is_org_member(1, 2, session) is True
            session.execute.assert_not_called()

    async def test_is_org_member_queries_membership(self):
        session = _session_with_firsts(SimpleNamespace(id=1))

        with patch("src.security.org_auth.is_user_superadmin", new=AsyncMock(return_value=False)):
            assert await is_org_member(7, 9, session) is True

    async def test_is_org_member_returns_false_when_missing(self):
        session = _session_with_firsts(None)

        with patch("src.security.org_auth.is_user_superadmin", new=AsyncMock(return_value=False)):
            assert await is_org_member(7, 9, session) is False

    async def test_is_org_admin_superadmin_bypass(self):
        session = AsyncMock()

        with patch("src.security.org_auth.is_user_superadmin", new=AsyncMock(return_value=True)):
            assert await is_org_admin(1, 2, session) is True
            session.execute.assert_not_called()

    async def test_is_org_admin_queries_admin_membership(self):
        # role_id=1 is in ADMIN_OR_MAINTAINER_ROLE_IDS
        session = _session_with_firsts(SimpleNamespace(id=1, role_id=1))

        with patch("src.security.org_auth.is_user_superadmin", new=AsyncMock(return_value=False)):
            assert await is_org_admin(7, 9, session) is True

    async def test_is_org_admin_returns_false_when_missing(self):
        session = _session_with_firsts(None)

        with patch("src.security.org_auth.is_user_superadmin", new=AsyncMock(return_value=False)):
            assert await is_org_admin(7, 9, session) is False

    async def test_get_user_org_returns_row(self):
        row = SimpleNamespace(id=1, role_id=5)
        session = _session_with_firsts(row)

        assert await get_user_org(7, 9, session) is row

    async def test_get_user_org_returns_none(self):
        session = _session_with_firsts(None)

        assert await get_user_org(7, 9, session) is None

    async def test_get_user_org_role_returns_none_without_membership(self):
        session = _session_with_firsts(None)

        assert await get_user_org_role(7, 9, session) is None

    async def test_get_user_org_role_returns_role(self):
        user_org = SimpleNamespace(role_id=11)
        role = SimpleNamespace(id=11, rights={})
        session = _session_with_firsts(user_org, role)

        assert await get_user_org_role(7, 9, session) is role


class TestOrgAuthRequirementsAndPermissions:
    async def test_require_org_membership_allows_member(self):
        session = AsyncMock()

        with patch("src.security.org_auth.is_org_member", new=AsyncMock(return_value=True)):
            assert await require_org_membership(7, 9, session) is None

    async def test_require_org_membership_rejects_non_member(self):
        session = AsyncMock()

        with patch("src.security.org_auth.is_org_member", new=AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc_info:
                await require_org_membership(7, 9, session)

        assert exc_info.value.status_code == 403

    async def test_require_org_admin_allows_admin(self):
        session = AsyncMock()

        with patch("src.security.org_auth.is_org_admin", new=AsyncMock(return_value=True)):
            assert await require_org_admin(7, 9, session) is None

    async def test_require_org_admin_rejects_non_admin(self):
        session = AsyncMock()

        with patch("src.security.org_auth.is_org_admin", new=AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc_info:
                await require_org_admin(7, 9, session)

        assert exc_info.value.status_code == 403

    async def test_require_org_role_permission_superadmin_bypass(self):
        session = AsyncMock()

        with patch("src.security.org_auth.is_user_superadmin", new=AsyncMock(return_value=True)):
            assert await require_org_role_permission(7, 9, session, "courses", "action_create") is None

    async def test_require_org_role_permission_rejects_missing_membership(self):
        session = _session_with_firsts(None)

        with patch("src.security.org_auth.is_user_superadmin", new=AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc_info:
                await require_org_role_permission(7, 9, session, "courses", "action_create")

        assert exc_info.value.status_code == 403

    async def test_require_org_role_permission_rejects_missing_role(self):
        session = _session_with_firsts(SimpleNamespace(role_id=11), None)

        with patch("src.security.org_auth.is_user_superadmin", new=AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc_info:
                await require_org_role_permission(7, 9, session, "courses", "action_create")

        assert exc_info.value.status_code == 403

    async def test_require_org_role_permission_allows_dict_permission(self):
        session = _session_with_firsts(
            SimpleNamespace(role_id=11),
            SimpleNamespace(id=11, rights={"courses": {"action_create": True}}),
        )

        with patch("src.security.org_auth.is_user_superadmin", new=AsyncMock(return_value=False)):
            assert await require_org_role_permission(7, 9, session, "courses", "action_create") is None

    async def test_require_org_role_permission_rejects_dict_permission(self):
        session = _session_with_firsts(
            SimpleNamespace(role_id=11),
            SimpleNamespace(id=11, rights={"courses": {"action_create": False}}),
        )

        with patch("src.security.org_auth.is_user_superadmin", new=AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc_info:
                await require_org_role_permission(7, 9, session, "courses", "action_create")

        assert exc_info.value.status_code == 403

    async def test_require_org_role_permission_allows_fallback_role(self):
        session = _session_with_firsts(
            SimpleNamespace(role_id=1),
            SimpleNamespace(id=1, rights=None),
        )

        with patch("src.security.org_auth.is_user_superadmin", new=AsyncMock(return_value=False)):
            assert await require_org_role_permission(7, 9, session, "courses", "action_create") is None

    async def test_require_org_role_permission_rejects_non_fallback_role(self):
        session = _session_with_firsts(
            SimpleNamespace(role_id=99),
            SimpleNamespace(id=99, rights=None),
        )

        with patch("src.security.org_auth.is_user_superadmin", new=AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc_info:
                await require_org_role_permission(7, 9, session, "courses", "action_create")

        assert exc_info.value.status_code == 403
