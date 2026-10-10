"""Org-level authorization, session policy and offboarding.

* Security-sensitive org settings (signup mechanism, staff removal, custom
  domains, webhooks) take the real organizations/users right, not just the
  Admin-or-Maintainer role id rbac_check accepts.
* Org session policies are enforced by rbac_check and the analytics gates.
* Removing or leaving an org revokes the per-resource grants a member held.
* Custom domains and webhooks stop once the plan no longer includes them.
"""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.db.api_tokens import APIToken
from src.db.boards import Board, BoardMember
from src.db.custom_domains import CustomDomain, CustomDomainCreate
from src.db.organization_config import OrganizationConfig
from src.db.organizations import OrganizationCreate, OrganizationUpdate
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import PublicUser, User
from src.db.webhooks import WebhookEndpointCreate
from src.tests.security import test_org_admin_gates as _gates

_make_member = _gates._make_member
# Shared fixtures: the seeded Maintainer role/user and silenced side effects.
maintainer_role = _gates.maintainer_role
maintainer_user = _gates.maintainer_user
side_effects = _gates.side_effects

NOW = str(datetime.now())


async def _org_config(db, org, plan="free"):
    db.add(OrganizationConfig(
        org_id=org.id,
        config={"config_version": "2.0", "plan": plan, "admin_toggles": {}},
    ))
    await db.commit()


def _saas():
    """Patch both bindings of get_deployment_mode used by plan checks."""
    from contextlib import ExitStack

    stack = ExitStack()
    stack.enter_context(patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"))
    stack.enter_context(
        patch("src.security.features_utils.plan_check.get_deployment_mode", return_value="saas")
    )
    return stack


async def _outsider(db, user_id=9, username="outsider"):
    u = User(
        id=user_id, username=username, first_name=username, last_name="X",
        email=f"{username}@test.com", password="x", user_uuid=f"user_{username}",
        creation_date=NOW, update_date=NOW,
    )
    db.add(u)
    await db.commit()
    return PublicUser(
        id=u.id, username=u.username, first_name=u.first_name,
        last_name=u.last_name, email=u.email, user_uuid=u.user_uuid,
    )


# ---------------------------------------------------------------------------
# Sensitive settings need the real right
# ---------------------------------------------------------------------------


class TestSensitiveOrgSettings:
    async def test_maintainer_cannot_change_signup_mechanism(
        self, db, org, admin_user, maintainer_user, mock_request
    ):
        from src.services.orgs.orgs import update_org_signup_mechanism

        await _org_config(db, org)
        with pytest.raises(HTTPException) as exc:
            await update_org_signup_mechanism(mock_request, "open", org.id, maintainer_user, db)
        assert exc.value.status_code == 403

    async def test_admin_can_change_signup_mechanism(self, db, org, admin_user, mock_request):
        from src.services.orgs.orgs import update_org_signup_mechanism

        await _org_config(db, org)
        with patch("src.services.orgs.orgs.dispatch_webhooks", new_callable=AsyncMock):
            result = await update_org_signup_mechanism(mock_request, "open", org.id, admin_user, db)
        assert result["detail"] == "Signup mechanism updated"

    async def test_maintainer_cannot_remove_maintainer(
        self, db, org, admin_user, maintainer_user, mock_request, side_effects
    ):
        from src.services.orgs.users import remove_user_from_org

        other = await _make_member(db, org, 6, "maintainer2", 2)
        with pytest.raises(HTTPException) as exc:
            await remove_user_from_org(mock_request, org.id, other.id, db, maintainer_user)
        assert exc.value.status_code == 403

    async def test_maintainer_cannot_batch_remove_maintainer(
        self, db, org, admin_user, maintainer_user, mock_request, side_effects
    ):
        from src.services.orgs.users import remove_batch_users_from_org

        other = await _make_member(db, org, 6, "maintainer2", 2)
        with pytest.raises(HTTPException) as exc:
            await remove_batch_users_from_org(mock_request, org.id, [other.id], db, maintainer_user)
        assert exc.value.status_code == 403

    async def test_admin_can_remove_maintainer(
        self, db, org, admin_user, maintainer_user, mock_request, side_effects
    ):
        from src.services.orgs.users import remove_user_from_org

        result = await remove_user_from_org(
            mock_request, org.id, maintainer_user.id, db, admin_user
        )
        assert result["detail"] == "User removed from org"

    async def test_maintainer_cannot_manage_custom_domains(
        self, db, org, admin_user, maintainer_user, mock_request
    ):
        from src.services.orgs.custom_domains import (
            add_custom_domain,
            delete_custom_domain,
            verify_custom_domain,
        )

        db.add(CustomDomain(
            domain_uuid="domain_1", domain="learn.example.com", org_id=org.id,
            status="verified", creation_date=NOW, update_date=NOW,
        ))
        await db.commit()
        for call in (
            add_custom_domain(
                mock_request, db, CustomDomainCreate(domain="new.example.com"),
                org.id, maintainer_user,
            ),
            verify_custom_domain(mock_request, db, org.id, "domain_1", maintainer_user),
            delete_custom_domain(mock_request, db, org.id, "domain_1", maintainer_user),
        ):
            with pytest.raises(HTTPException) as exc:
                await call
            assert exc.value.status_code == 403

    async def test_maintainer_cannot_create_webhook(
        self, db, org, admin_user, maintainer_user, mock_request
    ):
        from src.services.webhooks.webhooks import create_webhook_endpoint

        with pytest.raises(HTTPException) as exc:
            await create_webhook_endpoint(
                mock_request, db, org.id,
                WebhookEndpointCreate(url="https://example.com/h", events=["course_created"]),
                maintainer_user,
            )
        assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Org session policies
# ---------------------------------------------------------------------------


class TestOrgSessionPolicy:
    async def test_rbac_check_enforces_org_policy(
        self, db, org, maintainer_user, mock_request
    ):
        from src.services.orgs.orgs import rbac_check

        with patch("src.services.orgs.orgs.enforce_org_mfa", new_callable=AsyncMock) as mfa:
            await rbac_check(mock_request, org.org_uuid, maintainer_user, "update", db)
        mfa.assert_awaited_once_with(maintainer_user.id, org.id, db)

    async def test_rbac_check_read_stays_public(self, db, org, regular_user, mock_request):
        from src.services.orgs.orgs import rbac_check

        with patch("src.services.orgs.orgs.enforce_org_mfa", new_callable=AsyncMock) as mfa:
            assert await rbac_check(mock_request, org.org_uuid, regular_user, "read", db)
        mfa.assert_not_awaited()

    async def test_analytics_gates_enforce_org_policy(self, db, org, admin_user):
        from src.routers.analytics import _verify_org_admin, _verify_org_membership

        blocked = HTTPException(status_code=403, detail="2fa")
        with patch(
            "src.routers.analytics.enforce_org_mfa", new_callable=AsyncMock, side_effect=blocked
        ):
            with pytest.raises(HTTPException):
                await _verify_org_membership(admin_user.id, org.id, db)
            with pytest.raises(HTTPException):
                await _verify_org_admin(admin_user.id, org.id, db)

    async def test_superadmin_is_not_blocked_by_policy(self, db, org):
        from src.routers.analytics import _verify_org_membership

        boss = await _outsider(db, 20, "boss")
        with patch("src.routers.analytics.is_user_superadmin", new_callable=AsyncMock, return_value=True), \
             patch("src.routers.analytics.enforce_org_mfa", new_callable=AsyncMock) as mfa:
            await _verify_org_membership(boss.id, org.id, db)
        mfa.assert_not_awaited()


# ---------------------------------------------------------------------------
# Offboarding
# ---------------------------------------------------------------------------


async def _grants(db, org, course, user_id):
    db.add(ResourceAuthor(
        resource_uuid=course.course_uuid, user_id=user_id,
        authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date=NOW, update_date=NOW,
    ))
    group = UserGroup(id=1, name="g", description="", org_id=org.id, usergroup_uuid="ug_1")
    board = Board(id=1, name="b", org_id=org.id, board_uuid="board_1", created_by=user_id)
    db.add_all([group, board])
    await db.commit()
    db.add_all([
        UserGroupUser(usergroup_id=group.id, user_id=user_id, org_id=org.id),
        BoardMember(board_id=board.id, user_id=user_id, role="editor"),
        APIToken(
            name="t", token_uuid="apitoken_1", token_prefix="lh_x", token_hash="h",
            org_id=org.id, created_by_user_id=user_id, is_active=True,
        ),
    ])
    await db.commit()


async def _assert_revoked(db, user_id):
    from sqlmodel import select

    author = (await db.execute(
        select(ResourceAuthor).where(ResourceAuthor.user_id == user_id)
    )).scalars().one()
    await db.refresh(author)
    assert author.authorship_status == ResourceAuthorshipStatusEnum.INACTIVE
    assert not (await db.execute(
        select(UserGroupUser).where(UserGroupUser.user_id == user_id)
    )).scalars().all()
    assert not (await db.execute(
        select(BoardMember).where(BoardMember.user_id == user_id)
    )).scalars().all()
    token = (await db.execute(select(APIToken))).scalars().one()
    await db.refresh(token)
    assert token.is_active is False


class TestOffboarding:
    async def test_remove_revokes_grants_and_invite(
        self, db, org, course, admin_user, regular_user, mock_request, side_effects
    ):
        from src.services.orgs.users import remove_user_from_org

        await _grants(db, org, course, regular_user.id)
        fake_redis = MagicMock()
        with patch("src.core.redis.get_redis_client", return_value=fake_redis):
            await remove_user_from_org(mock_request, org.id, regular_user.id, db, admin_user)

        await _assert_revoked(db, regular_user.id)
        fake_redis.delete.assert_called_once_with(
            f"invited_user:{regular_user.email}:org:{org.org_uuid}"
        )

    async def test_leave_revokes_grants(
        self, db, org, course, admin_user, regular_user, mock_request, side_effects
    ):
        from src.services.orgs.users import leave_org

        await _grants(db, org, course, regular_user.id)
        with patch("src.core.redis.get_redis_client", return_value=None):
            await leave_org(mock_request, org.id, db, regular_user)
        await _assert_revoked(db, regular_user.id)

    async def test_batch_remove_revokes_grants(
        self, db, org, course, admin_user, regular_user, mock_request, side_effects
    ):
        from src.services.orgs.users import remove_batch_users_from_org

        await _grants(db, org, course, regular_user.id)
        with patch("src.core.redis.get_redis_client", return_value=None):
            await remove_batch_users_from_org(
                mock_request, org.id, [regular_user.id], db, admin_user
            )
        await _assert_revoked(db, regular_user.id)

    async def test_other_org_grants_are_kept(
        self, db, org, other_org, course, admin_user, regular_user, mock_request, side_effects
    ):
        from sqlmodel import select
        from src.services.orgs.users import remove_user_from_org

        await _grants(db, other_org, course, regular_user.id)  # board/group/token in other org
        with patch("src.core.redis.get_redis_client", return_value=None):
            await remove_user_from_org(mock_request, org.id, regular_user.id, db, admin_user)
        assert (await db.execute(select(BoardMember))).scalars().all()
        assert (await db.execute(select(UserGroupUser))).scalars().all()


class TestStaleGrantsIgnored:
    async def test_author_row_needs_org_membership(self, db, org, course, mock_request):
        from src.security.rbac.resource_access import ResourceAccessChecker

        outsider = await _outsider(db)
        db.add(ResourceAuthor(
            resource_uuid=course.course_uuid, user_id=outsider.id,
            authorship=ResourceAuthorshipEnum.CREATOR,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        ))
        await db.commit()
        checker = ResourceAccessChecker(mock_request, db, outsider)
        assert await checker._is_resource_author(course.course_uuid) is False

    async def test_author_member_still_author(self, db, org, course, regular_user, mock_request):
        from src.security.rbac.resource_access import ResourceAccessChecker

        db.add(ResourceAuthor(
            resource_uuid=course.course_uuid, user_id=regular_user.id,
            authorship=ResourceAuthorshipEnum.CREATOR,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        ))
        await db.commit()
        checker = ResourceAccessChecker(mock_request, db, regular_user)
        assert await checker._is_resource_author(course.course_uuid) is True

    async def test_stale_board_member_falls_back_to_rbac(self, db, org, mock_request):
        from src.services.boards.boards import check_board_membership

        outsider = await _outsider(db)
        board = Board(id=1, name="b", org_id=org.id, board_uuid="board_1", public=False)
        db.add(board)
        await db.commit()
        db.add(BoardMember(board_id=board.id, user_id=outsider.id, role="owner"))
        await db.commit()
        with pytest.raises(HTTPException) as exc:
            await check_board_membership(mock_request, "board_1", outsider, db)
        assert exc.value.status_code == 403

    async def test_board_member_in_org_keeps_role(self, db, org, regular_user, mock_request):
        from src.services.boards.boards import check_board_membership

        board = Board(id=1, name="b", org_id=org.id, board_uuid="board_1", public=False)
        db.add(board)
        await db.commit()
        db.add(BoardMember(board_id=board.id, user_id=regular_user.id, role="owner"))
        await db.commit()
        member = await check_board_membership(mock_request, "board_1", regular_user, db)
        assert member.role == "owner"


# ---------------------------------------------------------------------------
# Org email in the member's org list
# ---------------------------------------------------------------------------


class TestOrgListEmail:
    async def test_member_does_not_see_org_email(self, db, org, regular_user, mock_request):
        from src.services.orgs.orgs import get_orgs_by_user

        orgs = await get_orgs_by_user(mock_request, db, regular_user.id)
        assert orgs[0].email is None

    async def test_admin_sees_org_email(self, db, org, admin_user, mock_request):
        from src.services.orgs.orgs import get_orgs_by_user, get_orgs_by_user_admin

        assert (await get_orgs_by_user(mock_request, db, admin_user.id))[0].email == org.email
        assert (await get_orgs_by_user_admin(mock_request, db, admin_user.id))[0].email == org.email


# ---------------------------------------------------------------------------
# Plan-gated serving
# ---------------------------------------------------------------------------


class TestPlanGatedServing:
    async def _domain(self, db, org):
        db.add(CustomDomain(
            domain_uuid="domain_1", domain="learn.example.com", org_id=org.id,
            status="verified", creation_date=NOW, update_date=NOW,
        ))
        await db.commit()

    async def test_domain_not_served_after_downgrade(self, db, org):
        from src.services.orgs.custom_domains import resolve_org_by_domain

        await self._domain(db, org)
        await _org_config(db, org, plan="free")
        with _saas():
            assert await resolve_org_by_domain(db, "learn.example.com") is None

    async def test_domain_served_on_entitled_plan(self, db, org):
        from src.services.orgs.custom_domains import resolve_org_by_domain

        await self._domain(db, org)
        await _org_config(db, org, plan="standard")
        with _saas():
            result = await resolve_org_by_domain(db, "learn.example.com")
        assert result.org_id == org.id

    async def test_domain_served_when_plan_lookup_errors(self, db, org):
        from src.services.orgs.custom_domains import resolve_org_by_domain

        await self._domain(db, org)
        with _saas(), patch(
            "src.security.features_utils.plan_check.get_org_plan",
            new_callable=AsyncMock, side_effect=RuntimeError("db down"),
        ):
            result = await resolve_org_by_domain(db, "learn.example.com")
        assert result.org_id == org.id

    async def test_webhooks_need_plan(self, db, org, other_org):
        from src.services.webhooks.dispatch import _org_plan_includes_webhooks

        await _org_config(db, org, plan="standard")
        await _org_config(db, other_org, plan="pro")
        with _saas():
            assert await _org_plan_includes_webhooks(org.id, db) is False
            assert await _org_plan_includes_webhooks(other_org.id, db) is True


# ---------------------------------------------------------------------------
# Slug format, CSV cells, internal-key comparison
# ---------------------------------------------------------------------------


class TestSlugFormat:
    @pytest.mark.parametrize("slug", ["evil.com/x", "a?b", 'a"b', "a#b", "a b", "-", ""])
    async def test_create_rejects_bad_slug(self, db, org, admin_user, mock_request, slug):
        from src.services.orgs.orgs import create_org

        with patch("src.services.orgs.orgs.is_multi_org_allowed", return_value=True):
            with pytest.raises(HTTPException) as exc:
                await create_org(
                    mock_request, OrganizationCreate(name="N", slug=slug, email="a@b.com"),
                    admin_user, db,
                )
        assert exc.value.status_code == 400

    def test_normalizes_case_and_edges(self):
        from src.services.orgs.orgs import normalize_org_slug

        assert normalize_org_slug(" My-Org- ") == "my-org"

    async def test_update_validates_changed_slug_only(self, db, org, admin_user, mock_request):
        from src.services.orgs.orgs import update_org

        org.slug = "Legacy_Slug"
        db.add(org)
        await db.commit()
        # Unchanged legacy slug is accepted as-is.
        result = await update_org(
            mock_request, OrganizationUpdate(name="R", slug="Legacy_Slug"), org.id, admin_user, db
        )
        assert result.slug == "Legacy_Slug"
        with pytest.raises(HTTPException) as exc:
            await update_org(
                mock_request, OrganizationUpdate(slug="x/y"), org.id, admin_user, db
            )
        assert exc.value.status_code == 400


class TestCsvAndKeys:
    @pytest.mark.parametrize("value", [" =cmd", " +1", "  @x", "=1"])
    def test_csv_safe_leading_whitespace(self, value):
        from src.services.orgs.users import _csv_safe

        assert _csv_safe(value).startswith("'")

    async def test_boards_internal_key_non_ascii(self, monkeypatch):
        from src.routers.boards.boards import verify_internal_key

        monkeypatch.setenv("COLLAB_INTERNAL_KEY", "secret")
        with pytest.raises(HTTPException) as exc:
            await verify_internal_key("é")
        assert exc.value.status_code == 403

    async def test_domains_internal_key_non_ascii(self, db, mock_request, monkeypatch):
        from src.routers.orgs.custom_domains import api_list_all_verified_domains

        monkeypatch.setenv("CLOUD_INTERNAL_KEY", "secret")
        with pytest.raises(HTTPException) as exc:
            await api_list_all_verified_domains(mock_request, x_internal_key="é", db_session=db)
        assert exc.value.status_code == 403
