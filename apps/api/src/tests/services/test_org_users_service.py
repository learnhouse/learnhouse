"""Tests for src/services/orgs/users.py."""

from datetime import datetime
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.roles import Role, RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import User
from src.services.orgs.users import (
    export_organization_users_csv,
    get_organization_users,
    get_list_of_invited_users,
    invite_batch_users,
    remove_all_users_from_org,
    remove_batch_users_from_org,
    remove_invited_user,
    remove_user_from_org,
    update_user_role,
)


async def _make_role(db, org, **overrides):
    role = Role(
        id=overrides.pop("id", None),
        name=overrides.pop("name", "Custom Role"),
        org_id=overrides.pop("org_id", org.id),
        role_type=overrides.pop("role_type", RoleTypeEnum.TYPE_ORGANIZATION),
        role_uuid=overrides.pop("role_uuid", "role_custom"),
        rights=overrides.pop("rights", {}),
        creation_date=overrides.pop("creation_date", str(datetime.now())),
        update_date=overrides.pop("update_date", str(datetime.now())),
    )
    db.add(role)
    await db.commit()
    await db.refresh(role)
    return role


async def _make_user(db, **overrides):
    user = User(
        id=overrides.pop("id", None),
        username=overrides.pop("username", "user"),
        first_name=overrides.pop("first_name", "User"),
        last_name=overrides.pop("last_name", "Test"),
        email=overrides.pop("email", "user@test.com"),
        password=overrides.pop("password", "hashed"),
        user_uuid=overrides.pop("user_uuid", "user_test"),
        email_verified=overrides.pop("email_verified", True),
        signup_method=overrides.pop("signup_method", "email"),
        creation_date=overrides.pop("creation_date", str(datetime.now())),
        update_date=overrides.pop("update_date", str(datetime.now())),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _link_user(db, user_id, org_id, role_id):
    link = UserOrganization(
        user_id=user_id,
        org_id=org_id,
        role_id=role_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return link


async def _make_usergroup(db, org, **overrides):
    usergroup = UserGroup(
        id=overrides.pop("id", None),
        org_id=org.id,
        name=overrides.pop("name", "UG"),
        description=overrides.pop("description", "Desc"),
        usergroup_uuid=overrides.pop("usergroup_uuid", "ug_test"),
        creation_date=overrides.pop("creation_date", str(datetime.now())),
        update_date=overrides.pop("update_date", str(datetime.now())),
    )
    db.add(usergroup)
    await db.commit()
    await db.refresh(usergroup)
    return usergroup


async def _streaming_response_text(response):
    chunks = []
    async for chunk in response.body_iterator:
        if isinstance(chunk, bytes):
            chunks.append(chunk.decode())
        else:
            chunks.append(str(chunk))
    return "".join(chunks)


class TestOrgUsersService:
    @pytest.mark.asyncio
    async def test_get_organization_users_filters_sort_and_counts(
        self, mock_request, db, org, admin_user
    ):
        member_role = await _make_role(db, org, id=10, name="Member", role_uuid="role_member")
        in_group_user = await _make_user(
            db,
            id=20,
            username="grouped",
            first_name="Grouped",
            last_name="User",
            email="grouped@test.com",
            email_verified=True,
            user_uuid="user_grouped",
        )
        await _link_user(db, in_group_user.id, org.id, member_role.id)

        out_group_user = await _make_user(
            db,
            id=21,
            username="ungrouped",
            first_name="Ungrouped",
            last_name="User",
            email="ungrouped@test.com",
            email_verified=False,
            user_uuid="user_ungrouped",
        )
        await _link_user(db, out_group_user.id, org.id, member_role.id)

        usergroup = await _make_usergroup(db, org, id=30, name="Group A")
        db.add(
            UserGroupUser(
                usergroup_id=usergroup.id,
                user_id=in_group_user.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        await db.commit()

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.backoffice.is_user_backoffice_staff", return_value=False
        ), patch(
            "src.security.org_auth.is_org_admin", return_value=False
        ):
            with pytest.raises(Exception) as user_guard_exc:
                await get_organization_users(mock_request, org.id, db, admin_user)
        assert user_guard_exc.value.status_code == 403

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.backoffice.is_user_backoffice_staff", return_value=False
        ), patch(
            "src.security.org_auth.is_org_admin", return_value=True
        ):
            result = await get_organization_users(
                mock_request,
                org.id,
                db,
                admin_user,
                page=0,
                limit=500,
                search="User",
                usergroup_id=usergroup.id,
                usergroup_filter="not_in_group",
                sort_order="asc",
                role_id=member_role.id,
                status="unverified",
            )

        assert result["page"] == 1
        assert result["limit"] == 100
        assert result["total"] == 1
        assert result["all_total"] == 1
        assert result["in_group_total"] == 1
        assert len(result["items"]) == 1
        assert result["items"][0].user.username == "ungrouped"

    @pytest.mark.asyncio
    async def test_get_organization_users_lists_anonymized_members(
        self, mock_request, db, org, admin_user
    ):
        """A GDPR-scrubbed member must not take the whole listing down.

        The scrub rewrites the address to a reserved-domain placeholder. When
        UserRead still typed email as EmailStr, model_validate raised on that
        row and the endpoint answered 500, so one deleted account emptied the
        members page for its entire organization. Rows scrubbed before the
        placeholder domain changed still carry ".local", so the listing has to
        stay tolerant of them.
        """
        member_role = await _make_role(db, org, id=40, name="Member", role_uuid="role_member_anon")
        scrubbed = await _make_user(
            db,
            id=41,
            username="deleted_user_41",
            first_name="Deleted",
            last_name="User",
            email="deleted-user-41@anonymized.local",
            email_verified=False,
            signup_method="anonymized",
            user_uuid="user_deleted_41",
        )
        await _link_user(db, scrubbed.id, org.id, member_role.id)

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.backoffice.is_user_backoffice_staff", return_value=False
        ), patch(
            "src.security.org_auth.is_org_admin", return_value=True
        ):
            result = await get_organization_users(mock_request, org.id, db, admin_user)

        emails = [item.user.email for item in result["items"]]
        assert "deleted-user-41@anonymized.local" in emails

    @pytest.mark.asyncio
    async def test_get_organization_users_and_export_guard_paths(
        self, mock_request, db, org, admin_user, anonymous_user
    ):
        with pytest.raises(Exception) as missing_org_exc:
            await get_organization_users(mock_request, 999, db, admin_user)
        assert missing_org_exc.value.status_code == 404

        with pytest.raises(Exception) as anon_exc:
            await export_organization_users_csv(
                mock_request, org.id, db, anonymous_user
            )
        assert anon_exc.value.status_code == 401

        with pytest.raises(Exception) as missing_export_exc:
            await export_organization_users_csv(mock_request, 999, db, admin_user)
        assert missing_export_exc.value.status_code == 404

        with patch(
            "src.services.orgs.users.is_org_member", return_value=False
        ):
            with pytest.raises(Exception) as member_exc:
                await export_organization_users_csv(mock_request, org.id, db, admin_user)
        assert member_exc.value.status_code == 403

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.backoffice.is_user_backoffice_staff", return_value=False
        ), patch(
            "src.security.org_auth.is_org_admin", return_value=False
        ):
            with pytest.raises(Exception) as admin_exc:
                await export_organization_users_csv(mock_request, org.id, db, admin_user)
        assert admin_exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_export_organization_users_csv_success(
        self, mock_request, db, org, admin_user
    ):
        member_role = await _make_role(db, org, id=12, name="Member", role_uuid="role_member2")
        user = await _make_user(
            db,
            id=22,
            username="csvuser",
            first_name="CSV",
            last_name="Person",
            email="csv@test.com",
            email_verified=False,
            signup_method="oauth",
            last_login_at="2024-02-03T04:05:06",
            user_uuid="user_csv",
        )
        db.add(
            UserOrganization(
                user_id=user.id,
                org_id=org.id,
                role_id=member_role.id,
                creation_date="2024-01-02T03:04:05",
                update_date=str(datetime.now()),
            )
        )
        usergroup = await _make_usergroup(db, org, id=31, name="Export Group")
        db.add(
            UserGroupUser(
                usergroup_id=usergroup.id,
                user_id=user.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        await db.commit()

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.backoffice.is_user_backoffice_staff", return_value=False
        ), patch(
            "src.security.org_auth.is_org_admin", return_value=True
        ):
            response = await export_organization_users_csv(
                mock_request,
                org.id,
                db,
                admin_user,
                search="csv",
                usergroup_id=usergroup.id,
                usergroup_filter="in_group",
                sort_order="asc",
                role_id=member_role.id,
                status="unverified",
            )

        csv_text = await _streaming_response_text(response)
        assert "Name,Username,Email,Groups,Role,Joined,Email Verified,Signup Method,Last Login" in csv_text
        assert 'CSV Person,csvuser,csv@test.com,Export Group,Member,"Jan 02, 2024",No,oauth,' in csv_text

        verified_user = await _make_user(
            db,
            id=23,
            username="verifieduser",
            first_name="Verified",
            last_name="Person",
            email="verified@test.com",
            email_verified=True,
            signup_method="email",
            user_uuid="user_verified",
        )
        db.add(
            UserOrganization(
                user_id=verified_user.id,
                org_id=org.id,
                role_id=member_role.id,
                creation_date="2024-03-04T05:06:07",
                update_date=str(datetime.now()),
            )
        )
        await db.commit()

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.backoffice.is_user_backoffice_staff", return_value=False
        ), patch(
            "src.security.org_auth.is_org_admin", return_value=True
        ):
            verified_response = await export_organization_users_csv(
                mock_request,
                org.id,
                db,
                admin_user,
                usergroup_id=usergroup.id,
                usergroup_filter="not_in_group",
                sort_order="asc",
                role_id=member_role.id,
                status="verified",
            )

        verified_csv = await _streaming_response_text(verified_response)
        assert "Verified Person,verifieduser,verified@test.com,,Member,\"Mar 04, 2024\",Yes,email," in verified_csv

    @pytest.mark.asyncio
    async def test_remove_user_and_batch_missing_org_and_missing_user(
        self, mock_request, db, org, admin_user, regular_user
    ):
        with pytest.raises(Exception) as remove_missing_org_exc:
            await remove_user_from_org(mock_request, 999, regular_user.id, db, admin_user)
        assert remove_missing_org_exc.value.status_code == 404

        with pytest.raises(Exception) as batch_missing_org_exc:
            await remove_batch_users_from_org(
                mock_request, 999, [regular_user.id], db, admin_user
            )
        assert batch_missing_org_exc.value.status_code == 404

        with patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ):
            with pytest.raises(Exception) as remove_missing_user_exc:
                await remove_user_from_org(
                    mock_request, org.id, 9999, db, admin_user
                )
        assert remove_missing_user_exc.value.status_code == 404

        with patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.routers.users._invalidate_session_cache"
        ) as invalidate_cache, patch(
            "src.services.orgs.users.decrease_feature_usage"
        ) as decrease_usage, patch(
            "src.services.orgs.users.track", new_callable=AsyncMock
        ) as mock_track:
            result = await remove_batch_users_from_org(
                mock_request, org.id, [regular_user.id, 9999], db, admin_user
            )

        assert result == {"detail": "1 user(s) removed from org"}
        # Only the member who was actually removed is counted.
        mock_track.assert_awaited_once_with(
            event_name="user_removed_from_org",
            org_id=org.id,
            user_id=regular_user.id,
        )
        invalidate_cache.assert_any_call(regular_user.id)
        invalidate_cache.assert_any_call(9999)
        assert decrease_usage.call_count == 1

    @pytest.mark.asyncio
    async def test_remove_all_users_from_org(
        self, mock_request, db, org, admin_user, regular_user
    ):
        # Missing org -> 404
        with pytest.raises(Exception) as missing_org_exc:
            await remove_all_users_from_org(mock_request, 999, db, admin_user)
        assert missing_org_exc.value.status_code == 404

        # org has admin_user (id=1) and regular_user (id=2). Removing all should
        # drop regular_user but keep the caller (admin_user).
        with patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.routers.users._invalidate_session_cache"
        ) as invalidate_cache, patch(
            "src.services.orgs.users.decrease_feature_usage"
        ) as decrease_usage:
            result = await remove_all_users_from_org(
                mock_request, org.id, db, admin_user
            )

        assert result == {"detail": "1 user(s) removed from org"}
        invalidate_cache.assert_any_call(regular_user.id)
        assert decrease_usage.call_count == 1

        # Caller remains a member; the other user is gone.
        remaining = (await db.exec(
            select(UserOrganization).where(UserOrganization.org_id == org.id)
        )).all()
        remaining_ids = {uo.user_id for uo in remaining}
        assert admin_user.id in remaining_ids
        assert regular_user.id not in remaining_ids

    @pytest.mark.asyncio
    async def test_update_user_role_guard_paths_and_email_failure(
        self, mock_request, db, org, other_org, admin_user, regular_user
    ):
        other_role = await _make_role(
            db, other_org, id=40, name="Other Role", role_uuid="role_other"
        )
        other_user = await _make_user(
            db,
            id=41,
            username="other",
            first_name="Other",
            last_name="User",
            email="other@test.com",
            user_uuid="user_other",
        )
        await _link_user(db, other_user.id, other_org.id, other_role.id)

        with patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ):
            with pytest.raises(Exception) as role_missing_exc:
                await update_user_role(
                    mock_request, org.id, regular_user.id, "missing_role", db, admin_user
                )
        assert role_missing_exc.value.status_code == 404

        with patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ):
            with pytest.raises(Exception) as org_missing_exc:
                await update_user_role(
                    mock_request, 999, regular_user.id, other_role.role_uuid, db, admin_user
                )
        assert org_missing_exc.value.status_code == 404

        with patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.security.backoffice.is_user_backoffice_staff",
            new_callable=AsyncMock,
            return_value=True,
        ):
            with pytest.raises(Exception) as no_admin_exc:
                await update_user_role(
                    mock_request,
                    other_org.id,
                    other_user.id,
                    other_role.role_uuid,
                    db,
                    admin_user,
                )
        assert no_admin_exc.value.status_code == 400

        role = await _make_role(db, org, id=11, name="Instructor", role_uuid="role_instructor")

        # Only a backoffice staff member may change their own role, so the last-admin guard
        # is reached as one.
        with patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.security.backoffice.is_user_backoffice_staff",
            new_callable=AsyncMock,
            return_value=True,
        ):
            with pytest.raises(Exception) as last_admin_exc:
                await update_user_role(
                    mock_request, org.id, admin_user.id, role.role_uuid, db, admin_user
                )
        assert last_admin_exc.value.status_code == 400

        with patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ):
            with pytest.raises(Exception) as user_missing_exc:
                await update_user_role(
                    mock_request, org.id, 9999, role.role_uuid, db, admin_user
                )
        assert user_missing_exc.value.status_code == 404

        with patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.routers.users._invalidate_session_cache"
        ) as invalidate_cache, patch(
            "src.services.orgs.users.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as dispatch_mock, patch(
            "src.services.orgs.users.send_role_changed_email",
            side_effect=Exception("smtp down"),
        ), patch(
            "src.services.orgs.users.logger.warning"
        ) as warning_mock:
            result = await update_user_role(
                mock_request, org.id, regular_user.id, role.role_uuid, db, admin_user
            )

        assert result == {"detail": "User role updated"}
        invalidate_cache.assert_called_once_with(regular_user.id)
        dispatch_mock.assert_awaited_once()
        warning_mock.assert_called_once()

    @pytest.mark.asyncio
    async def test_invite_batch_users_guard_paths_and_summary(
        self, mock_request, db, org, admin_user, user_role
    ):
        from src.db.org_invitations import OrgInvitation

        with pytest.raises(HTTPException) as org_missing_exc:
            await invite_batch_users(mock_request, 999, "a@test.com", None, db, admin_user)
        assert org_missing_exc.value.status_code == 404

        with pytest.raises(HTTPException) as code_missing_exc:
            await invite_batch_users(mock_request, org.id, "a@test.com", "invite_uuid", db, admin_user)
        assert code_missing_exc.value.status_code == 404

        send = AsyncMock(side_effect=[True, True, True, False])
        with patch("src.services.orgs.invitations.service._send_email", send), patch(
            "src.services.security.rate_limiting.enforce_invite_rate_limit"
        ), patch(
            "src.services.webhooks.dispatch.dispatch_webhooks", new_callable=AsyncMock
        ) as dispatch_mock, patch(
            "src.services.analytics.analytics.track", new_callable=AsyncMock
        ) as mock_track:
            await invite_batch_users(mock_request, org.id, "existing@test.com", None, db, admin_user)
            mock_track.reset_mock()
            result = await invite_batch_users(
                mock_request,
                org.id,
                "new@test.com,existing@test.com,failed@test.com,",
                None,
                db,
                admin_user,
            )

        assert result["summary"]["total"] == 3
        assert result["summary"]["sent"] == 1
        assert result["summary"]["failed"] == 1
        # A pending invitation gets a fresh email (and link) instead of a skip.
        assert result["summary"]["already_invited"] == 1
        assert [item["status"] for item in result["results"]] == ["sent", "resent", "email_failed"]
        rows = (await db.execute(select(OrgInvitation).order_by(OrgInvitation.email))).scalars().all()
        assert [r.email for r in rows] == ["existing@test.com", "failed@test.com", "new@test.com"]
        assert all(r.role_id == user_role.id and r.token_hash for r in rows)
        assert dispatch_mock.await_count == 2
        mock_track.assert_awaited_once_with(
            event_name="user_invited",
            org_id=org.id,
            user_id=admin_user.id,
            properties={"invite_method": "email", "count": 3},
        )

    @pytest.mark.asyncio
    async def test_get_and_remove_invited_users_paths(
        self, mock_request, db, org, admin_user, user_role
    ):
        from src.db.org_invitations import OrgInvitation
        from src.services.orgs.invitations.policy import utcnow
        from datetime import timedelta

        with pytest.raises(HTTPException) as list_org_missing_exc:
            await get_list_of_invited_users(mock_request, 999, db, admin_user)
        assert list_org_missing_exc.value.status_code == 404

        now = utcnow()
        for i, (email, status, expires) in enumerate((
            ("db@test.com", "pending", now + timedelta(days=3)),
            ("joined@test.com", "accepted", now + timedelta(days=3)),
            ("late@test.com", "pending", now - timedelta(days=1)),
        )):
            db.add(OrgInvitation(
                invitation_uuid=f"invitation_{email}", org_id=org.id, email=email, role_id=user_role.id,
                status=status, expires_at=expires, created_at=now - timedelta(minutes=i), updated_at=now,
            ))
        await db.commit()

        fake_redis = Mock()
        fake_redis.scan_iter.return_value = [b"invited_user:a@test.com:org:org_test"]
        fake_redis.get.side_effect = lambda key: json.dumps({"email": "a@test.com", "pending": True}).encode("utf-8")
        with patch("src.core.redis.get_redis_client", return_value=fake_redis):
            invited = await get_list_of_invited_users(mock_request, org.id, db, admin_user)
        assert [item["email"] for item in invited] == ["db@test.com", "joined@test.com", "a@test.com"]
        assert invited[0]["pending"] is True and invited[1]["pending"] is False

        # Redis down: the database invitations still list.
        with patch("src.core.redis.get_redis_client", return_value=None):
            invited = await get_list_of_invited_users(mock_request, org.id, db, admin_user)
        assert [item["email"] for item in invited] == ["db@test.com", "joined@test.com"]

        with pytest.raises(HTTPException) as remove_org_missing_exc:
            await remove_invited_user(mock_request, 999, "a@test.com", db, admin_user)
        assert remove_org_missing_exc.value.status_code == 404

        result = await remove_invited_user(mock_request, org.id, "DB@test.com", db, admin_user)
        assert result == {"detail": "User removed"}
        row = (await db.execute(select(OrgInvitation).where(OrgInvitation.email == "db@test.com"))).scalars().one()
        assert row.status == "revoked"

        legacy = Mock()
        legacy.get.side_effect = lambda key: b"x" if "legacy@test.com" in key else None
        with patch("src.core.redis.get_redis_client", return_value=legacy):
            assert await remove_invited_user(mock_request, org.id, "legacy@test.com", db, admin_user) == {"detail": "User removed"}
            legacy.delete.assert_called_once_with(f"invited_user:legacy@test.com:org:{org.org_uuid}")
            with pytest.raises(HTTPException) as missing_invite_exc:
                await remove_invited_user(mock_request, org.id, "nobody@test.com", db, admin_user)
        assert missing_invite_exc.value.status_code == 404
        with patch("src.core.redis.get_redis_client", return_value=None):
            with pytest.raises(HTTPException) as no_redis_exc:
                await remove_invited_user(mock_request, org.id, "nobody@test.com", db, admin_user)
        assert no_redis_exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_get_organization_users_fake_session_edge_cases(
        self, mock_request, org, admin_user
    ):
        class _Scalars:
            def __init__(self, value):
                self.value = value

            def first(self):
                return self.value

            def one(self):
                return self.value

            def all(self):
                return self.value if isinstance(self.value, list) else [self.value]

        class _Result:
            def __init__(self, value):
                self.value = value

            def scalars(self):
                return _Scalars(self.value)

            def scalar_one(self):
                return self.value

            def first(self):
                return self.value

            def one(self):
                return self.value

            def all(self):
                return self.value if isinstance(self.value, list) else [self.value]

        class _Session:
            def __init__(self, results):
                self.results = results
                self.index = 0

            async def execute(self, statement):
                result = self.results[self.index]
                self.index += 1
                return _Result(result)

        fake_org = SimpleNamespace(id=org.id, org_uuid=org.org_uuid, is_demo=False)
        fake_user = SimpleNamespace(id=88)
        fake_link = UserOrganization(
            user_id=fake_user.id,
            org_id=org.id,
            role_id=999,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.backoffice.is_user_backoffice_staff", return_value=False
        ), patch(
            "src.security.org_auth.is_org_admin", return_value=True
        ):
            no_users = await get_organization_users(
                mock_request,
                org.id,
                _Session([fake_org, 0, []]),
                admin_user,
            )

        assert no_users["total"] == 0
        assert no_users["items"] == []

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.backoffice.is_user_backoffice_staff", return_value=False
        ), patch(
            "src.security.org_auth.is_org_admin", return_value=True
        ):
            missing_user_org = await get_organization_users(
                mock_request,
                org.id,
                _Session([fake_org, 1, [fake_user], [], []]),
                admin_user,
            )

        assert missing_user_org["items"] == []

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.backoffice.is_user_backoffice_staff", return_value=False
        ), patch(
            "src.security.org_auth.is_org_admin", return_value=True
        ):
            missing_role = await get_organization_users(
                mock_request,
                org.id,
                _Session([fake_org, 1, [fake_user], [fake_link], [], []]),
                admin_user,
            )

        assert missing_role["items"] == []

    @pytest.mark.asyncio
    async def test_export_organization_users_csv_invalid_date_and_missing_user_org(
        self, mock_request, db, org, admin_user
    ):
        member_role = await _make_role(db, org, id=13, name="Member", role_uuid="role_member3")
        user = await _make_user(
            db,
            id=24,
            username="baddate",
            first_name="Bad",
            last_name="Date",
            email="bad@test.com",
            email_verified=True,
            signup_method="email",
            user_uuid="user_bad_date",
        )
        db.add(
            UserOrganization(
                user_id=user.id,
                org_id=org.id,
                role_id=member_role.id,
                creation_date="not-a-date",
                update_date=str(datetime.now()),
            )
        )
        await db.commit()

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.backoffice.is_user_backoffice_staff", return_value=False
        ), patch(
            "src.security.org_auth.is_org_admin", return_value=True
        ):
            response = await export_organization_users_csv(
                mock_request,
                org.id,
                db,
                admin_user,
                role_id=member_role.id,
                status="verified",
            )

        csv_text = await _streaming_response_text(response)
        assert "not-a-date" in csv_text

        class _Scalars2:
            def __init__(self, value):
                self.value = value
            def first(self):
                return self.value
            def one(self):
                return self.value
            def all(self):
                return self.value if isinstance(self.value, list) else [self.value]

        class _Result2:
            def __init__(self, value):
                self.value = value
            def scalars(self):
                return _Scalars2(self.value)
            def first(self):
                return self.value
            def one(self):
                return self.value
            def all(self):
                return self.value if isinstance(self.value, list) else [self.value]

        class _Session2:
            def __init__(self, results):
                self.results = results
                self.index = 0
            async def execute(self, statement):
                result = self.results[self.index]
                self.index += 1
                return _Result2(result)

        _Session = _Session2

        fake_org = SimpleNamespace(id=org.id, org_uuid=org.org_uuid, is_demo=False)
        fake_user = SimpleNamespace(id=90)

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.backoffice.is_user_backoffice_staff", return_value=False
        ), patch(
            "src.security.org_auth.is_org_admin", return_value=True
        ):
            missing_user_org = await export_organization_users_csv(
                mock_request,
                org.id,
                # The `None` is the org-config lookup for custom signup field
                # columns: no config row, so no extra columns.
                _Session([fake_org, [fake_user], None, [], []]),
                admin_user,
            )

        missing_csv = await _streaming_response_text(missing_user_org)
        assert "Name,Username,Email" in missing_csv

    @pytest.mark.asyncio
    async def test_get_organization_users_and_export_csv(
        self, mock_request, db, org, admin_user
    ):
        member_role = await _make_role(
            db, org, id=10, name="Member", role_uuid="role_member"
        )
        extra_user = await _make_user(
            db,
            id=20,
            username="member20",
            first_name="Member",
            last_name="Twenty",
            email="member20@test.com",
            user_uuid="user_20",
        )
        await _link_user(db, extra_user.id, org.id, member_role.id)
        usergroup = await _make_usergroup(db, org, id=30, name="Group A")
        db.add(
            UserGroupUser(
                usergroup_id=usergroup.id,
                user_id=extra_user.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        await db.commit()

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.backoffice.is_user_backoffice_staff", return_value=False
        ), patch(
            "src.security.org_auth.is_org_admin", return_value=True
        ):
            result = await get_organization_users(
                mock_request,
                org.id,
                db,
                admin_user,
                search="Member",
                usergroup_id=usergroup.id,
                usergroup_filter="in_group",
                status="verified",
            )
            csv_response = await export_organization_users_csv(
                mock_request,
                org.id,
                db,
                admin_user,
                search="member20",
            )

        assert result["total"] == 1
        assert result["items"][0].user.username == "member20"
        assert result["items"][0].usergroups[0].name == "Group A"
        assert result["in_group_total"] == 1
        assert "text/csv" in csv_response.media_type

    @pytest.mark.asyncio
    async def test_export_csv_includes_custom_signup_field_columns(
        self, mock_request, db, org, admin_user
    ):
        """The org's declared signup fields become extra export columns, with
        booleans rendered Yes/No and unanswered fields left blank."""
        from src.db.organization_config import OrganizationConfig

        member_role = await _make_role(
            db, org, id=11, name="Member", role_uuid="role_member_cf"
        )
        member = await _make_user(
            db,
            id=21,
            username="member21",
            first_name="Member",
            last_name="TwentyOne",
            email="member21@test.com",
            user_uuid="user_21",
        )
        member.extra_metadata = {"company": "Acme", "news": True}
        db.add(member)
        await _link_user(db, member.id, org.id, member_role.id)

        db.add(
            OrganizationConfig(
                org_id=org.id,
                config={
                    "config_version": "2.0",
                    "customization": {
                        "signup_fields": {
                            "fields": [
                                {"key": "company", "label": "Company", "type": "text"},
                                {"key": "news", "label": "Newsletter", "type": "checkbox"},
                                {"key": "cohort", "label": "Cohort", "type": "text"},
                            ]
                        }
                    },
                },
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        await db.commit()

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.backoffice.is_user_backoffice_staff", return_value=False
        ), patch(
            "src.security.org_auth.is_org_admin", return_value=True
        ):
            response = await export_organization_users_csv(
                mock_request, org.id, db, admin_user, search="member21"
            )

        csv_text = await _streaming_response_text(response)
        header, row = csv_text.strip().splitlines()[0], csv_text.strip().splitlines()[1]
        assert header.endswith("Company,Newsletter,Cohort")
        # Acme, the boolean rendered Yes, and an empty cell for the unanswered one.
        assert row.endswith("Acme,Yes,")

    @pytest.mark.asyncio
    async def test_get_organization_users_auth_guards(
        self, mock_request, db, org, admin_user, anonymous_user
    ):
        with pytest.raises(Exception) as anon_exc:
            await get_organization_users(mock_request, org.id, db, anonymous_user)
        assert anon_exc.value.status_code == 401

        with patch(
            "src.services.orgs.users.is_org_member", return_value=False
        ):
            with pytest.raises(Exception) as member_exc:
                await get_organization_users(mock_request, org.id, db, admin_user)
        assert member_exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_remove_users_and_update_role(
        self, mock_request, db, org, admin_user, regular_user
    ):
        second_admin = await _make_user(
            db,
            id=30,
            username="admin2",
            first_name="Admin",
            last_name="Two",
            email="admin2@test.com",
            user_uuid="user_admin2",
        )
        await _link_user(db, second_admin.id, org.id, 1)
        role = await _make_role(db, org, id=11, name="Instructor", role_uuid="role_instructor")

        with patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.routers.users._invalidate_session_cache"
        ), patch(
            "src.services.orgs.users.decrease_feature_usage"
        ), patch(
            "src.services.orgs.users.dispatch_webhooks",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.users.send_role_changed_email"
        ), patch(
            "src.services.orgs.users.track", new_callable=AsyncMock
        ) as mock_track:
            updated = await update_user_role(
                mock_request, org.id, regular_user.id, role.role_uuid, db, admin_user
            )
            removed = await remove_user_from_org(
                mock_request, org.id, second_admin.id, db, admin_user
            )

        assert updated == {"detail": "User role updated"}
        assert removed == {"detail": "User removed from org"}
        mock_track.assert_awaited_once_with(
            event_name="user_removed_from_org",
            org_id=org.id,
            user_id=second_admin.id,
        )

    @pytest.mark.asyncio
    async def test_remove_batch_and_last_admin_guards(
        self, mock_request, db, org, admin_user, regular_user
    ):
        with patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ):
            with pytest.raises(Exception) as last_admin_exc:
                await remove_user_from_org(
                    mock_request, org.id, admin_user.id, db, admin_user
                )
        assert last_admin_exc.value.status_code == 400

        second_admin = await _make_user(
            db,
            id=31,
            username="admin3",
            first_name="Admin",
            last_name="Three",
            email="admin3@test.com",
            user_uuid="user_admin3",
        )
        await _link_user(db, second_admin.id, org.id, 1)

        with patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ):
            with pytest.raises(Exception) as batch_exc:
                await remove_batch_users_from_org(
                    mock_request, org.id, [admin_user.id, second_admin.id], db, admin_user
                )
        assert batch_exc.value.status_code == 400

        with patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.routers.users._invalidate_session_cache"
        ), patch(
            "src.services.orgs.users.decrease_feature_usage"
        ):
            result = await remove_batch_users_from_org(
                mock_request, org.id, [regular_user.id], db, admin_user
            )
        assert result == {"detail": "1 user(s) removed from org"}

    @pytest.mark.asyncio
    async def test_invite_batch_users(
        self, mock_request, db, org, admin_user, user_role, course
    ):
        """An invite code's groups and courses ride along (database and Redis codes)."""
        from src.db.org_invitations import OrgInvitation, OrgInviteCode
        from src.services.orgs.invitations.policy import utcnow

        group = UserGroup(
            org_id=org.id, name="G", description="", usergroup_uuid="ug_batch",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(group)
        await db.commit()
        await db.refresh(group)
        code_uuid = "org_invite_code_12345678-1234-1234-1234-1234567890ab"
        db.add(OrgInviteCode(
            code_uuid=code_uuid, org_id=org.id, code="ABCDEFGH", role_id=user_role.id,
            usergroup_ids=[group.id], course_uuids=[course.course_uuid], uses=0,
            created_at=utcnow(), updated_at=utcnow(),
        ))
        await db.commit()

        legacy_uuid = "org_invite_code_99999999-9999-9999-9999-999999999999"
        legacy = Mock()
        legacy.scan_iter.side_effect = lambda match, count: [b"k"] if match.startswith(legacy_uuid) else []
        legacy.get.return_value = json.dumps({"usergroup_id": group.id}).encode()
        with patch("src.services.orgs.invitations.service._send_email", AsyncMock(return_value=True)), patch(
            "src.services.security.rate_limiting.enforce_invite_rate_limit"
        ), patch("src.services.webhooks.dispatch.dispatch_webhooks", new_callable=AsyncMock), patch(
            "src.core.redis.get_redis_client", return_value=legacy
        ):
            result = await invite_batch_users(mock_request, org.id, "new@test.com", code_uuid, db, admin_user)
            legacy_result = await invite_batch_users(mock_request, org.id, "old@test.com", legacy_uuid, db, admin_user)
            with pytest.raises(HTTPException) as unknown:
                await invite_batch_users(
                    mock_request, org.id, "x@test.com", "org_invite_code_00000000-0000-0000-0000-000000000000", db, admin_user
                )
        assert unknown.value.status_code == 404
        with patch("src.core.redis.get_redis_client", return_value=None):
            with pytest.raises(HTTPException) as no_redis:
                await invite_batch_users(mock_request, org.id, "x@test.com", legacy_uuid, db, admin_user)
        assert no_redis.value.status_code == 404

        assert result["summary"]["sent"] == 1 and legacy_result["summary"]["sent"] == 1
        rows = {r.email: r for r in (await db.execute(select(OrgInvitation))).scalars().all()}
        assert rows["new@test.com"].usergroup_ids == [group.id]
        assert rows["new@test.com"].course_uuids == [course.course_uuid]
        assert rows["old@test.com"].usergroup_ids == [group.id] and rows["old@test.com"].course_uuids == []

    @pytest.mark.asyncio
    async def test_invite_batch_users_rejects_malformed_and_oversized(
        self, mock_request, db, org, admin_user, user_role
    ):
        from src.services.security.rate_limiting import INVITE_MAX_BATCH_SIZE

        with patch("src.services.orgs.invitations.service._send_email", AsyncMock(return_value=True)), patch(
            "src.services.security.rate_limiting.enforce_invite_rate_limit"
        ), patch("src.services.webhooks.dispatch.dispatch_webhooks", new_callable=AsyncMock):
            # A malformed address is rejected (never sent) and reported.
            result = await invite_batch_users(
                mock_request, org.id, "ok@test.com,not-an-email", None, db, admin_user
            )
            assert result["summary"]["invalid_email"] == 1
            assert any(r["status"] == "invalid_email" for r in result["results"])

            # More than the batch cap → 400 INVITE_BATCH_TOO_LARGE.
            too_many = ",".join(f"user{i}@test.com" for i in range(INVITE_MAX_BATCH_SIZE + 1))
            with pytest.raises(HTTPException) as exc:
                await invite_batch_users(mock_request, org.id, too_many, None, db, admin_user)
            assert exc.value.status_code == 400
            assert exc.value.detail["code"] == "INVITE_BATCH_TOO_LARGE"

    @pytest.mark.asyncio
    async def test_remove_batch_users_from_org_empty_list(
        self, mock_request, db, org, admin_user
    ):
        """Line 514: user_ids is empty -> user_orgs_to_remove = [] (else branch)."""
        with patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.routers.users._invalidate_session_cache"
        ), patch(
            "src.services.orgs.users.decrease_feature_usage"
        ):
            result = await remove_batch_users_from_org(
                mock_request, org.id, [], db, admin_user
            )

        assert result == {"detail": "0 user(s) removed from org"}


@pytest.fixture(autouse=True)
def _skip_org_mfa_policy():
    """No-op the org two-factor policy for this module.

    These tests use a fake session that returns a fixed, ordered list of
    results. The policy check issues its own queries, which would consume
    entries from that list and desynchronise every subsequent lookup. The
    policy itself is covered in src/tests/security/test_mfa_org_policy.py.
    """
    with patch("src.services.orgs.users.enforce_org_mfa", new=AsyncMock(return_value=None)):
        yield
