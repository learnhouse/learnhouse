import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException, Request
from sqlmodel import Field, Session, SQLModel

from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.db.roles import DashboardPermission, Permission, PermissionsWithOwn, Rights, Role
from src.db.users import APITokenUser
from src.security.rbac.rbac import (
    _get_offer_for_usergroup,
    authorization_verify_api_token_permissions,
    authorization_verify_based_on_org_admin_status,
    authorization_verify_based_on_roles,
    authorization_verify_based_on_roles_and_authorship,
    authorization_verify_based_on_roles_and_authorship_or_api_token,
    authorization_verify_if_element_is_public,
    authorization_verify_if_user_is_author,
    check_usergroup_access,
)


def _result(*, first=None, all=None):
    result = Mock()
    result.first.return_value = first
    result.all.return_value = [] if all is None else all
    return result


def _session_with_results(*results):
    session = Mock(spec=Session)
    session.exec.side_effect = list(results)
    return session


def _request():
    return Mock(spec=Request)


class _FakePaymentsOffer(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = ""
    amount: float = 0.0
    currency: str = "USD"
    usergroup_id: int = 0


_fake_payments_module = ModuleType("ee.db.payments.payments_offers")
_fake_payments_module.PaymentsOffer = _FakePaymentsOffer


def _role_with_dict_rights() -> Role:
    return Role(
        name="dict-role",
        description="",
        rights={"users": {"action_read": True, "action_update": True}},
        org_id=None,
        role_uuid="role_dict",
    )


def _role_with_object_rights() -> Role:
    return Role(
        name="object-role",
        description="",
        rights=Rights(
            courses=PermissionsWithOwn(
                action_create=False,
                action_read=False,
                action_read_own=False,
                action_update=False,
                action_update_own=False,
                action_delete=False,
                action_delete_own=False,
            ),
            users=Permission(
                action_create=False,
                action_read=False,
                action_update=True,
                action_delete=False,
            ),
            usergroups=Permission(
                action_create=False,
                action_read=False,
                action_update=False,
                action_delete=False,
            ),
            collections=Permission(
                action_create=False,
                action_read=False,
                action_update=False,
                action_delete=False,
            ),
            organizations=Permission(
                action_create=False,
                action_read=False,
                action_update=False,
                action_delete=False,
            ),
            coursechapters=Permission(
                action_create=False,
                action_read=False,
                action_update=False,
                action_delete=False,
            ),
            activities=Permission(
                action_create=False,
                action_read=False,
                action_update=False,
                action_delete=False,
            ),
            roles=Permission(
                action_create=False,
                action_read=False,
                action_update=False,
                action_delete=False,
            ),
            dashboard=DashboardPermission(action_access=False),
            communities=Permission(
                action_create=False,
                action_read=False,
                action_update=False,
                action_delete=False,
            ),
            discussions=PermissionsWithOwn(
                action_create=False,
                action_read=False,
                action_read_own=False,
                action_update=False,
                action_update_own=False,
                action_delete=False,
                action_delete_own=False,
            ),
            podcasts=PermissionsWithOwn(
                action_create=False,
                action_read=False,
                action_read_own=False,
                action_update=False,
                action_update_own=False,
                action_delete=False,
                action_delete_own=False,
            ),
        ),
        org_id=None,
        role_uuid="role_object",
    )


class TestRBACRuntime:
    @pytest.mark.asyncio
    async def test_get_offer_for_usergroup_returns_offer_metadata(self):
        offer = SimpleNamespace(id=12, name="Pro", amount=19.0, currency="USD")
        session = _session_with_results(_result(first=offer))

        with patch.dict(sys.modules, {"ee.db.payments.payments_offers": _fake_payments_module}):
            result = await _get_offer_for_usergroup(7, session)

        assert result == {
            "offer_id": 12,
            "offer_name": "Pro",
            "amount": 19.0,
            "currency": "USD",
        }

    @pytest.mark.asyncio
    async def test_get_offer_for_usergroup_returns_none_on_exception(self):
        session = Mock(spec=Session)
        session.exec.side_effect = RuntimeError("db failure")

        result = await _get_offer_for_usergroup(7, session)

        assert result is None

    @pytest.mark.asyncio
    async def test_check_usergroup_access_allows_open_resource(self):
        session = _session_with_results(_result(all=[]))

        assert await check_usergroup_access("course_1", 99, session) is True

    @pytest.mark.asyncio
    async def test_check_usergroup_access_allows_member(self):
        session = _session_with_results(
            _result(all=[SimpleNamespace(usergroup_id=1)]),
            _result(first=SimpleNamespace(usergroup_id=1)),
        )

        assert await check_usergroup_access("course_1", 99, session) is True

    @pytest.mark.asyncio
    async def test_check_usergroup_access_denies_non_member_without_offer(self):
        session = _session_with_results(
            _result(all=[SimpleNamespace(usergroup_id=1)]),
            _result(first=None),
            _result(first=None),
        )

        assert await check_usergroup_access("course_1", 99, session) is False

    @pytest.mark.asyncio
    async def test_check_usergroup_access_raises_payment_required_for_paid_group(self):
        session = _session_with_results(
            _result(all=[SimpleNamespace(usergroup_id=1)]),
            _result(first=None),
            _result(first=SimpleNamespace(id=77, name="VIP", amount=49.0, currency="EUR")),
        )

        with patch.dict(sys.modules, {"ee.db.payments.payments_offers": _fake_payments_module}):
            with pytest.raises(HTTPException) as exc_info:
                await check_usergroup_access("course_1", 99, session)

        assert exc_info.value.status_code == 402
        assert exc_info.value.detail == {
            "code": "PAYMENT_REQUIRED",
            "offer_id": 77,
            "offer_name": "VIP",
            "amount": 49.0,
            "currency": "EUR",
        }

    @pytest.mark.asyncio
    async def test_authorization_verify_if_element_is_public_covers_podcast_and_collection_failures(self):
        session = Mock(spec=Session)

        with patch("src.security.rbac.rbac.check_element_type", new_callable=AsyncMock) as mock_check_type:
            mock_check_type.return_value = "collections"
            session.exec.return_value.first.return_value = None

            with pytest.raises(HTTPException) as exc_info:
                await authorization_verify_if_element_is_public(
                    request=_request(),
                    element_uuid="collection_1",
                    action="read",
                    db_session=session,
            )

            assert exc_info.value.status_code == 403

        with patch("src.security.rbac.rbac.check_element_type", new_callable=AsyncMock) as mock_check_type:
            mock_check_type.return_value = "podcasts"
            session.exec.return_value.first.return_value = SimpleNamespace(id=1)

            assert (
                await authorization_verify_if_element_is_public(
                    request=_request(),
                    element_uuid="podcast_1",
                    action="read",
                    db_session=session,
                )
                is True
            )

        with patch("src.security.rbac.rbac.check_element_type", new_callable=AsyncMock) as mock_check_type:
            mock_check_type.return_value = "podcasts"
            session.exec.return_value.first.return_value = None

            with pytest.raises(HTTPException) as exc_info:
                await authorization_verify_if_element_is_public(
                    request=_request(),
                    element_uuid="podcast_1",
                    action="read",
                    db_session=session,
                )

            assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_authorization_verify_if_user_is_author_covers_invalid_action_and_status(self):
        session = Mock(spec=Session)
        author = Mock(spec=ResourceAuthor)
        author.authorship = ResourceAuthorshipEnum.REPORTER
        author.authorship_status = ResourceAuthorshipStatusEnum.PENDING
        session.exec.return_value.first.return_value = author

        with patch("src.security.rbac.rbac.check_element_type", new_callable=AsyncMock):
            assert (
                await authorization_verify_if_user_is_author(
                    request=_request(),
                    user_id=7,
                    action="publish",
                    element_uuid="course_1",
                    db_session=session,
                )
                is False
            )

    @pytest.mark.asyncio
    async def test_authorization_verify_based_on_roles_covers_dict_and_object_rights(self):
        session = Mock(spec=Session)

        with patch("src.security.rbac.rbac.check_element_type", new_callable=AsyncMock, return_value="users"), \
            patch("src.security.rbac.rbac.is_user_superadmin", return_value=False), \
            patch("src.security.rbac.rbac.authorization_verify_if_user_is_author", new_callable=AsyncMock, return_value=False):
            session.exec.return_value.all.return_value = [_role_with_dict_rights()]

            assert (
                await authorization_verify_based_on_roles(
                    request=_request(),
                    user_id=7,
                    action="update",
                    element_uuid="user_1",
                    db_session=session,
                )
                is True
            )

        with patch("src.security.rbac.rbac.check_element_type", new_callable=AsyncMock, return_value="users"), \
            patch("src.security.rbac.rbac.is_user_superadmin", return_value=False), \
            patch("src.security.rbac.rbac.authorization_verify_if_user_is_author", new_callable=AsyncMock, return_value=False):
            session.exec.return_value.all.return_value = [_role_with_object_rights()]

            assert (
                await authorization_verify_based_on_roles(
                    request=_request(),
                    user_id=7,
                    action="update",
                    element_uuid="user_1",
                    db_session=session,
                )
                is True
            )

    @pytest.mark.asyncio
    async def test_authorization_verify_based_on_roles_superadmin_bypass(self):
        session = Mock(spec=Session)

        with patch("src.security.rbac.rbac.is_user_superadmin", return_value=True), \
            patch("src.security.rbac.rbac.check_element_type", new_callable=AsyncMock) as mock_check_type:
            result = await authorization_verify_based_on_roles(
                request=_request(),
                user_id=7,
                action="read",
                element_uuid="course_1",
                db_session=session,
            )

        assert result is True
        mock_check_type.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_authorization_verify_based_on_org_admin_status_covers_superadmin_and_unknown_org(self):
        session = Mock(spec=Session)

        with patch("src.security.rbac.rbac.is_user_superadmin", return_value=True), \
            patch("src.security.rbac.rbac.get_element_organization_id", new_callable=AsyncMock) as mock_get_org:
            assert (
                await authorization_verify_based_on_org_admin_status(
                    request=_request(),
                    user_id=7,
                    action="read",
                    element_uuid="course_1",
                    db_session=session,
                )
                is True
            )
            mock_get_org.assert_not_awaited()

        with patch("src.security.rbac.rbac.is_user_superadmin", return_value=False), \
            patch("src.security.rbac.rbac.get_element_organization_id", new_callable=AsyncMock, return_value=None):
            assert (
                await authorization_verify_based_on_org_admin_status(
                    request=_request(),
                    user_id=7,
                    action="read",
                    element_uuid="course_1",
                    db_session=session,
                )
                is False
            )

    @pytest.mark.asyncio
    async def test_authorization_verify_based_on_roles_and_authorship_superadmin_bypass(self):
        session = Mock(spec=Session)

        with patch("src.security.rbac.rbac.is_user_superadmin", return_value=True), \
            patch("src.security.rbac.rbac.authorization_verify_if_user_is_author", new_callable=AsyncMock) as mock_author, \
            patch("src.security.rbac.rbac.authorization_verify_based_on_roles", new_callable=AsyncMock) as mock_roles:
            assert (
                await authorization_verify_based_on_roles_and_authorship(
                    request=_request(),
                    user_id=7,
                    action="read",
                    element_uuid="course_1",
                    db_session=session,
                )
                is True
            )
            mock_author.assert_not_awaited()
            mock_roles.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_authorization_verify_api_token_permissions_covers_all_branches(self):
        session = Mock(spec=Session)

        token_rights = {
            "courses": {"action_read": True},
            "search": {"action_read": True},
            "collections": {"action_update": True},
        }
        token_with_dict_rights = APITokenUser(
            org_id=7,
            rights=token_rights,
            token_name="demo",
        )
        token_with_objects = APITokenUser(org_id=7, rights={}, token_name="demo")
        token_with_objects.rights = SimpleNamespace(
            courses=SimpleNamespace(action_read=True, action_update=False, action_create=False, action_delete=False),
            search=SimpleNamespace(action_read=True, action_update=True, action_create=False, action_delete=False),
            collections=SimpleNamespace(action_read=False, action_update=True, action_create=False, action_delete=False),
        )

        with patch("src.security.rbac.rbac.check_element_type", new_callable=AsyncMock, return_value="users"):
            with pytest.raises(HTTPException) as exc_info:
                await authorization_verify_api_token_permissions(
                    request=_request(),
                    api_token_user=APITokenUser(org_id=7, rights=token_rights, token_name="demo"),
                    action="read",
                    element_uuid="user_1",
                    db_session=session,
                )
            assert exc_info.value.status_code == 403

        with patch("src.security.rbac.rbac.check_element_type", new_callable=AsyncMock, return_value="courses"), \
            patch("src.security.rbac.rbac.get_element_organization_id", new_callable=AsyncMock, return_value=99):
            with pytest.raises(HTTPException) as exc_info:
                await authorization_verify_api_token_permissions(
                    request=_request(),
                    api_token_user=APITokenUser(org_id=7, rights=token_rights, token_name="demo"),
                    action="read",
                    element_uuid="course_1",
                    db_session=session,
                )
            assert exc_info.value.status_code == 403

        with patch("src.security.rbac.rbac.check_element_type", new_callable=AsyncMock, return_value="courses"), \
            patch("src.security.rbac.rbac.get_element_organization_id", new_callable=AsyncMock, return_value=7):
            with pytest.raises(HTTPException) as exc_info:
                await authorization_verify_api_token_permissions(
                    request=_request(),
                    api_token_user=APITokenUser(org_id=7, rights=None, token_name="demo"),
                    action="read",
                    element_uuid="course_1",
                    db_session=session,
                )
            assert exc_info.value.status_code == 403

        with patch("src.security.rbac.rbac.check_element_type", new_callable=AsyncMock, return_value="courses"), \
            patch("src.security.rbac.rbac.get_element_organization_id", new_callable=AsyncMock, return_value=7):
            with pytest.raises(HTTPException) as exc_info:
                await authorization_verify_api_token_permissions(
                    request=_request(),
                    api_token_user=APITokenUser(org_id=7, rights={"search": {"action_read": True}}, token_name="demo"),
                    action="read",
                    element_uuid="course_1",
                    db_session=session,
                )
            assert exc_info.value.status_code == 403

        with patch("src.security.rbac.rbac.check_element_type", new_callable=AsyncMock, return_value="search"), \
            patch("src.security.rbac.rbac.get_element_organization_id", new_callable=AsyncMock, return_value=7):
            with pytest.raises(HTTPException) as exc_info:
                await authorization_verify_api_token_permissions(
                    request=_request(),
                    api_token_user=token_with_dict_rights,
                    action="update",
                    element_uuid="search_1",
                    db_session=session,
                )
            assert exc_info.value.status_code == 403

        with patch("src.security.rbac.rbac.check_element_type", new_callable=AsyncMock, return_value="courses"), \
            patch("src.security.rbac.rbac.get_element_organization_id", new_callable=AsyncMock, return_value=7):
            assert (
                await authorization_verify_api_token_permissions(
                    request=_request(),
                    api_token_user=token_with_dict_rights,
                    action="read",
                    element_uuid="course_1",
                    db_session=session,
                )
                is True
            )

        with patch("src.security.rbac.rbac.check_element_type", new_callable=AsyncMock, return_value="search"), \
            patch("src.security.rbac.rbac.get_element_organization_id", new_callable=AsyncMock, return_value=7):
            assert (
                await authorization_verify_api_token_permissions(
                    request=_request(),
                    api_token_user=token_with_dict_rights,
                    action="read",
                    element_uuid="search_1",
                    db_session=session,
                )
                is True
            )

        with patch("src.security.rbac.rbac.check_element_type", new_callable=AsyncMock, return_value="search"), \
            patch("src.security.rbac.rbac.get_element_organization_id", new_callable=AsyncMock, return_value=7):
            assert (
                await authorization_verify_api_token_permissions(
                    request=_request(),
                    api_token_user=token_with_objects,
                    action="read",
                    element_uuid="search_1",
                    db_session=session,
                )
                is True
            )

        with patch("src.security.rbac.rbac.check_element_type", new_callable=AsyncMock, return_value="collections"), \
            patch("src.security.rbac.rbac.get_element_organization_id", new_callable=AsyncMock, return_value=7):
            assert (
                await authorization_verify_api_token_permissions(
                    request=_request(),
                    api_token_user=token_with_dict_rights,
                    action="update",
                    element_uuid="collection_1",
                    db_session=session,
                )
                is True
            )

        with patch("src.security.rbac.rbac.check_element_type", new_callable=AsyncMock, return_value="courses"), \
            patch("src.security.rbac.rbac.get_element_organization_id", new_callable=AsyncMock, return_value=7):
            assert (
                await authorization_verify_api_token_permissions(
                    request=_request(),
                    api_token_user=token_with_objects,
                    action="read",
                    element_uuid="course_1",
                    db_session=session,
                )
                is True
            )

        with patch("src.security.rbac.rbac.check_element_type", new_callable=AsyncMock, return_value="collections"), \
            patch("src.security.rbac.rbac.get_element_organization_id", new_callable=AsyncMock, return_value=7):
            assert (
                await authorization_verify_api_token_permissions(
                    request=_request(),
                    api_token_user=token_with_objects,
                    action="update",
                    element_uuid="collection_1",
                    db_session=session,
                )
                is True
            )

    @pytest.mark.asyncio
    async def test_authorization_verify_based_on_roles_and_authorship_or_api_token_covers_both_paths(self):
        session = Mock(spec=Session)

        token_user = APITokenUser(org_id=7, rights={"courses": {"action_read": True}}, token_name="demo")
        request = _request()

        with patch("src.security.rbac.rbac.authorization_verify_api_token_permissions", new_callable=AsyncMock, return_value=True) as mock_token:
            assert (
                await authorization_verify_based_on_roles_and_authorship_or_api_token(
                    request=request,
                    current_user=token_user,
                    action="read",
                    element_uuid="course_1",
                    db_session=session,
                )
                is True
            )
            mock_token.assert_awaited_once()

        user = SimpleNamespace(id=11)
        with patch("src.security.rbac.rbac.is_user_superadmin", return_value=False), \
            patch("src.security.rbac.rbac.authorization_verify_based_on_roles_and_authorship", new_callable=AsyncMock, return_value="regular") as mock_regular:
            assert (
                await authorization_verify_based_on_roles_and_authorship_or_api_token(
                    request=request,
                    current_user=user,
                    action="read",
                    element_uuid="course_1",
                    db_session=session,
                )
                == "regular"
            )
            mock_regular.assert_awaited_once_with(
                request,
                user.id,
                "read",
                "course_1",
                session,
            )

        with patch("src.security.rbac.rbac.is_user_superadmin", return_value=True), \
            patch("src.security.rbac.rbac.authorization_verify_based_on_roles_and_authorship", new_callable=AsyncMock) as mock_regular:
            assert (
                await authorization_verify_based_on_roles_and_authorship_or_api_token(
                    request=request,
                    current_user=user,
                    action="read",
                    element_uuid="course_1",
                    db_session=session,
                )
                is True
            )
            mock_regular.assert_not_awaited()
