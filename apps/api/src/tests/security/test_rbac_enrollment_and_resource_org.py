"""RBAC paid-enrollment access and resource-org resolution.

* ``authorization_verify_based_on_roles_and_authorship``: when the payments
  module is present (EE), a paid enrollment grants read access even to a user
  who is neither author, role-holder nor usergroup member. The module is
  injected into ``sys.modules`` so this runs on builds without ``ee/``.
* ``ResourceAccessChecker``: a resource type the config does not know cannot
  be org-scoped and keeps the signed-in-only behaviour; a nested resource that
  carries no org of its own inherits its parent's org.
"""

import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.security.rbac import rbac
from src.security.rbac.config import get_resource_config
from src.security.rbac.resource_access import ResourceAccessChecker


def _payments_module(check):
    module = ModuleType("ee.services.payments.payments_access")
    module.check_enrollment_access = check
    return module


@pytest.fixture
def no_other_grant():
    """Not an author, no role grant, no usergroup membership."""
    with patch.object(
        rbac, "authorization_verify_if_user_is_author", AsyncMock(return_value=False)
    ), patch.object(
        rbac, "authorization_verify_based_on_roles", AsyncMock(return_value=False)
    ), patch.object(rbac, "check_usergroup_access", AsyncMock(return_value=False)):
        yield


class TestPaidEnrollmentAccess:
    async def test_paid_enrollment_grants_read(self, mock_request, db, regular_user, no_other_grant):
        check = AsyncMock(return_value=True)

        with patch.dict(sys.modules, {"ee.services.payments.payments_access": _payments_module(check)}):
            allowed = await rbac.authorization_verify_based_on_roles_and_authorship(
                mock_request, regular_user.id, "read", "course_paid", db
            )

        assert allowed is True
        check.assert_awaited_once_with("course_paid", regular_user.id, db)

    async def test_no_enrollment_is_still_denied(self, mock_request, db, regular_user, no_other_grant):
        check = AsyncMock(return_value=False)

        with patch.dict(sys.modules, {"ee.services.payments.payments_access": _payments_module(check)}):
            with pytest.raises(HTTPException) as exc_info:
                await rbac.authorization_verify_based_on_roles_and_authorship(
                    mock_request, regular_user.id, "read", "course_paid", db
                )

        assert exc_info.value.status_code == 403
        check.assert_awaited_once()


class TestResourceOrgResolution:
    async def test_unknown_resource_type_is_not_org_scoped(self, mock_request, db, regular_user):
        checker = ResourceAccessChecker(mock_request, db, regular_user)

        assert await checker._is_member_of_resource_org("widget_123", regular_user.id) is True

    async def test_nested_resource_without_org_inherits_parent_org(
        self, mock_request, db, org, course, regular_user
    ):
        checker = ResourceAccessChecker(mock_request, db, regular_user)
        real_get_resource = checker._get_resource
        # A chapter row that never had its org_id filled in.
        orphan_chapter = SimpleNamespace(org_id=None, course_id=course.id)

        async def get_resource(uuid, config):
            if uuid == "chapter_orphan":
                return orphan_chapter
            return await real_get_resource(uuid, config)

        with patch.object(checker, "_get_resource", side_effect=get_resource):
            org_id = await checker._resource_org_id(
                "chapter_orphan", get_resource_config("chapter_orphan")
            )

        assert org_id == org.id
