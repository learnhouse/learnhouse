"""The org reporting gates (per-student audit, analytics): membership and
admin rights in the org being read, superadmins always pass."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.security.org_auth import verify_org_admin, verify_org_membership


class TestVerifyOrgMembership:
    """verify_org_membership: members and superadmins pass, others get 403."""

    def _make_db_session(self, has_membership=False, is_superadmin=False):
        session = AsyncMock()
        membership = MagicMock() if has_membership else None
        _scalars = MagicMock()
        _scalars.first.return_value = membership
        _exec_result = MagicMock()
        _exec_result.scalars.return_value = _scalars
        session.execute.return_value = _exec_result
        return session

    async def test_non_member_rejected(self):
        db = self._make_db_session(has_membership=False)
        with patch("src.security.org_auth.is_user_superadmin", AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc_info:
                await verify_org_membership(user_id=1, org_id=99, db_session=db)
        assert exc_info.value.status_code == 403

    async def test_member_allowed(self):
        db = self._make_db_session(has_membership=True)
        with patch("src.security.org_auth.is_user_superadmin", AsyncMock(return_value=False)):
            # Should not raise
            await verify_org_membership(user_id=1, org_id=1, db_session=db)

    async def test_superadmin_bypasses(self):
        db = self._make_db_session(has_membership=False)
        with patch("src.security.org_auth.is_user_superadmin", AsyncMock(return_value=True)):
            # Should not raise even though not a member
            await verify_org_membership(user_id=1, org_id=99, db_session=db)


class TestVerifyOrgAdmin:
    async def test_membership_and_admin_rights(self):
        db = AsyncMock()

        def _make_execute_result(first_result=None, all_result=None):
            scalars = MagicMock()
            scalars.first.return_value = first_result
            scalars.all.return_value = all_result if all_result is not None else []
            result = MagicMock()
            result.scalars.return_value = scalars
            return result

        with patch("src.security.org_auth.is_user_superadmin", new_callable=AsyncMock, return_value=True):
            await verify_org_membership(1, 10, db)
            await verify_org_admin(1, 10, db)

        db.execute.return_value = _make_execute_result(first_result=None)
        with patch("src.security.org_auth.is_user_superadmin", new_callable=AsyncMock, return_value=False):
            with pytest.raises(HTTPException, match="Not a member"):
                await verify_org_membership(1, 10, db)

        membership = SimpleNamespace(role_id=7)
        db.execute.side_effect = [
            _make_execute_result(first_result=membership),
            _make_execute_result(first_result=SimpleNamespace(rights={"organizations": {"action_update": True}})),
        ]
        with patch("src.security.org_auth.is_user_superadmin", new_callable=AsyncMock, return_value=False):
            await verify_org_admin(1, 10, db)

        db.execute.side_effect = [
            _make_execute_result(first_result=membership),
            _make_execute_result(first_result=SimpleNamespace(rights={"organizations": {"action_update": False}})),
        ]
        with patch("src.security.org_auth.is_user_superadmin", new_callable=AsyncMock, return_value=False):
            with pytest.raises(HTTPException, match="Admin access required"):
                await verify_org_admin(1, 10, db)

        db.execute.side_effect = [_make_execute_result(first_result=None)]
        with patch("src.security.org_auth.is_user_superadmin", new_callable=AsyncMock, return_value=False):
            with pytest.raises(HTTPException, match="Admin access required"):
                await verify_org_admin(1, 10, db)

        db.execute.side_effect = [
            _make_execute_result(first_result=membership),
            _make_execute_result(first_result=None),
        ]
        with patch("src.security.org_auth.is_user_superadmin", new_callable=AsyncMock, return_value=False):
            with pytest.raises(HTTPException, match="Admin access required"):
                await verify_org_admin(1, 10, db)
