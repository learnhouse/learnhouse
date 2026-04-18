"""Tests for src/services/orgs/users.py."""

from datetime import datetime
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

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
    remove_batch_users_from_org,
    remove_invited_user,
    remove_user_from_org,
    update_user_role,
)


def _make_role(db, org, **overrides):
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
    db.commit()
    db.refresh(role)
    return role


def _make_user(db, **overrides):
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
    db.commit()
    db.refresh(user)
    return user


def _link_user(db, user_id, org_id, role_id):
    link = UserOrganization(
        user_id=user_id,
        org_id=org_id,
        role_id=role_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


def _make_usergroup(db, org, **overrides):
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
    db.commit()
    db.refresh(usergroup)
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
        member_role = _make_role(db, org, id=10, name="Member", role_uuid="role_member")
        in_group_user = _make_user(
            db,
            id=20,
            username="grouped",
            first_name="Grouped",
            last_name="User",
            email="grouped@test.com",
            email_verified=True,
            user_uuid="user_grouped",
        )
        _link_user(db, in_group_user.id, org.id, member_role.id)

        out_group_user = _make_user(
            db,
            id=21,
            username="ungrouped",
            first_name="Ungrouped",
            last_name="User",
            email="ungrouped@test.com",
            email_verified=False,
            user_uuid="user_ungrouped",
        )
        _link_user(db, out_group_user.id, org.id, member_role.id)

        usergroup = _make_usergroup(db, org, id=30, name="Group A")
        db.add(
            UserGroupUser(
                usergroup_id=usergroup.id,
                user_id=in_group_user.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.superadmin.is_user_superadmin", return_value=False
        ), patch(
            "src.security.org_auth.is_org_admin", return_value=False
        ):
            with pytest.raises(Exception) as user_guard_exc:
                await get_organization_users(mock_request, org.id, db, admin_user)
        assert user_guard_exc.value.status_code == 403

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.superadmin.is_user_superadmin", return_value=False
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
            "src.security.superadmin.is_user_superadmin", return_value=False
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
        member_role = _make_role(db, org, id=12, name="Member", role_uuid="role_member2")
        user = _make_user(
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
        usergroup = _make_usergroup(db, org, id=31, name="Export Group")
        db.add(
            UserGroupUser(
                usergroup_id=usergroup.id,
                user_id=user.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.superadmin.is_user_superadmin", return_value=False
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

        verified_user = _make_user(
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
        db.commit()

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.superadmin.is_user_superadmin", return_value=False
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
        ) as decrease_usage:
            result = await remove_batch_users_from_org(
                mock_request, org.id, [regular_user.id, 9999], db, admin_user
            )

        assert result == {"detail": "1 user(s) removed from org"}
        invalidate_cache.assert_any_call(regular_user.id)
        invalidate_cache.assert_any_call(9999)
        assert decrease_usage.call_count == 1

    @pytest.mark.asyncio
    async def test_update_user_role_guard_paths_and_email_failure(
        self, mock_request, db, org, other_org, admin_user, regular_user
    ):
        other_role = _make_role(
            db, other_org, id=40, name="Other Role", role_uuid="role_other"
        )
        other_user = _make_user(
            db,
            id=41,
            username="other",
            first_name="Other",
            last_name="User",
            email="other@test.com",
            user_uuid="user_other",
        )
        _link_user(db, other_user.id, other_org.id, other_role.id)

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

        role = _make_role(db, org, id=11, name="Instructor", role_uuid="role_instructor")

        with patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
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
        self, mock_request, db, org, admin_user
    ):
        empty_config = SimpleNamespace(
            redis_config=SimpleNamespace(redis_connection_string="")
        )
        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=empty_config,
        ):
            with pytest.raises(Exception) as redis_missing_exc:
                await invite_batch_users(
                    mock_request, org.id, "a@test.com", "invite_uuid", db, admin_user
                )
        assert redis_missing_exc.value.status_code == 500

        fake_config = SimpleNamespace(
            redis_config=SimpleNamespace(redis_connection_string="redis://test")
        )
        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=fake_config,
        ), patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ):
            with pytest.raises(Exception) as org_missing_exc:
                await invite_batch_users(
                    mock_request, 999, "a@test.com", "invite_uuid", db, admin_user
                )
        assert org_missing_exc.value.status_code == 404

        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=fake_config,
        ), patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.users.redis.Redis.from_url",
            return_value=None,
        ):
            with pytest.raises(Exception) as redis_conn_exc:
                await invite_batch_users(
                    mock_request, org.id, "a@test.com", "invite_uuid", db, admin_user
                )
        assert redis_conn_exc.value.status_code == 500

        fake_redis = Mock()
        fake_redis.get.side_effect = [None, b"existing", None]
        fake_redis.set = Mock()
        fake_redis.__bool__ = Mock(return_value=True)

        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=fake_config,
        ), patch(
            "src.services.orgs.users.redis.Redis.from_url",
            return_value=fake_redis,
        ), patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.users.send_invite_email",
            side_effect=[True, False],
        ), patch(
            "src.services.orgs.users.dispatch_webhooks",
            new_callable=AsyncMock,
        ) as dispatch_mock:
            result = await invite_batch_users(
                mock_request,
                org.id,
                "new@test.com,existing@test.com,failed@test.com,",
                "invite_uuid",
                db,
                admin_user,
            )

        assert result["summary"] == {
            "total": 3,
            "sent": 1,
            "failed": 1,
            "already_invited": 1,
        }
        assert [item["status"] for item in result["results"]] == [
            "sent",
            "already_invited",
            "email_failed",
        ]
        assert fake_redis.set.call_count == 2
        dispatch_mock.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_get_and_remove_invited_users_redis_paths(
        self, mock_request, db, org, admin_user
    ):
        empty_config = SimpleNamespace(
            redis_config=SimpleNamespace(redis_connection_string="")
        )
        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=empty_config,
        ):
            with pytest.raises(Exception) as list_missing_exc:
                await get_list_of_invited_users(mock_request, org.id, db, admin_user)
        assert list_missing_exc.value.status_code == 500

        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="redis://test")
            ),
        ), patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ):
            with pytest.raises(Exception) as list_org_missing_exc:
                await get_list_of_invited_users(mock_request, 999, db, admin_user)
        assert list_org_missing_exc.value.status_code == 404

        fake_redis = Mock()
        fake_redis.scan_iter.return_value = [
            b"invited_user:a@test.com:org:org_test",
            b"invited_user:b@test.com:org:org_test",
        ]
        fake_redis.get.side_effect = [
            json.dumps({"email": "a@test.com"}).encode("utf-8"),
            json.dumps({"email": "b@test.com"}).encode("utf-8"),
        ]
        fake_redis.__bool__ = Mock(return_value=True)

        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="redis://test")
            ),
        ), patch(
            "src.services.orgs.users.redis.Redis.from_url",
            return_value=fake_redis,
        ), patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ):
            invited = await get_list_of_invited_users(mock_request, org.id, db, admin_user)

        assert [item["email"] for item in invited] == ["a@test.com", "b@test.com"]

        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="redis://test")
            ),
        ), patch(
            "src.services.orgs.users.redis.Redis.from_url",
            return_value=False,
        ), patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ):
            with pytest.raises(Exception) as list_redis_exc:
                await get_list_of_invited_users(mock_request, org.id, db, admin_user)
        assert list_redis_exc.value.status_code == 500

        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=empty_config,
        ), patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.users.redis.Redis.from_url",
            return_value=None,
        ):
            with pytest.raises(Exception) as remove_redis_exc:
                await remove_invited_user(
                    mock_request, org.id, "a@test.com", db, admin_user
                )
        assert remove_redis_exc.value.status_code == 500

        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=empty_config,
        ):
            with pytest.raises(Exception) as remove_missing_conn_exc:
                await remove_invited_user(
                    mock_request, org.id, "a@test.com", db, admin_user
                )
        assert remove_missing_conn_exc.value.status_code == 500

        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="redis://test")
            ),
        ), patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ):
            with pytest.raises(Exception) as remove_org_missing_exc:
                await remove_invited_user(
                    mock_request, 999, "a@test.com", db, admin_user
                )
        assert remove_org_missing_exc.value.status_code == 404

        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="redis://test")
            ),
        ), patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.users.redis.Redis.from_url",
            return_value=False,
        ):
            with pytest.raises(Exception) as remove_conn_exc:
                await remove_invited_user(
                    mock_request, org.id, "a@test.com", db, admin_user
                )
        assert remove_conn_exc.value.status_code == 500

        missing_redis = Mock()
        missing_redis.get.return_value = None
        missing_redis.__bool__ = Mock(return_value=True)
        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="redis://test")
            ),
        ), patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.users.redis.Redis.from_url",
            return_value=missing_redis,
        ):
            with pytest.raises(Exception) as missing_invite_exc:
                await remove_invited_user(
                    mock_request, org.id, "missing@test.com", db, admin_user
                )
        assert missing_invite_exc.value.status_code == 404

        fake_redis = Mock()
        fake_redis.get.return_value = json.dumps({"email": "a@test.com"}).encode("utf-8")
        fake_redis.delete = Mock()
        fake_redis.__bool__ = Mock(return_value=True)
        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=SimpleNamespace(
                redis_config=SimpleNamespace(redis_connection_string="redis://test")
            ),
        ), patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.users.redis.Redis.from_url",
            return_value=fake_redis,
        ):
            result = await remove_invited_user(
                mock_request, org.id, "a@test.com", db, admin_user
            )

        assert result == {"detail": "User removed"}
        fake_redis.delete.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_organization_users_fake_session_edge_cases(
        self, mock_request, org, admin_user
    ):
        class _Result:
            def __init__(self, value):
                self.value = value

            def first(self):
                return self.value

            def one(self):
                return self.value

            def all(self):
                return self.value

        class _Session:
            def __init__(self, results):
                self.results = results
                self.index = 0

            def exec(self, statement):
                result = self.results[self.index]
                self.index += 1
                return _Result(result)

        fake_org = SimpleNamespace(id=org.id, org_uuid=org.org_uuid)
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
            "src.security.superadmin.is_user_superadmin", return_value=False
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
            "src.security.superadmin.is_user_superadmin", return_value=False
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
            "src.security.superadmin.is_user_superadmin", return_value=False
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
        member_role = _make_role(db, org, id=13, name="Member", role_uuid="role_member3")
        user = _make_user(
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
        db.commit()

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.superadmin.is_user_superadmin", return_value=False
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

        class _Result:
            def __init__(self, value):
                self.value = value

            def first(self):
                return self.value

            def one(self):
                return self.value

            def all(self):
                return self.value

        class _Session:
            def __init__(self, results):
                self.results = results
                self.index = 0

            def exec(self, statement):
                result = self.results[self.index]
                self.index += 1
                return _Result(result)

        fake_org = SimpleNamespace(id=org.id, org_uuid=org.org_uuid)
        fake_user = SimpleNamespace(id=90)

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.superadmin.is_user_superadmin", return_value=False
        ), patch(
            "src.security.org_auth.is_org_admin", return_value=True
        ):
            missing_user_org = await export_organization_users_csv(
                mock_request,
                org.id,
                _Session([fake_org, [fake_user], [], []]),
                admin_user,
            )

        missing_csv = await _streaming_response_text(missing_user_org)
        assert "Name,Username,Email" in missing_csv

    @pytest.mark.asyncio
    async def test_get_organization_users_and_export_csv(
        self, mock_request, db, org, admin_user
    ):
        member_role = _make_role(
            db, org, id=10, name="Member", role_uuid="role_member"
        )
        extra_user = _make_user(
            db,
            id=20,
            username="member20",
            first_name="Member",
            last_name="Twenty",
            email="member20@test.com",
            user_uuid="user_20",
        )
        _link_user(db, extra_user.id, org.id, member_role.id)
        usergroup = _make_usergroup(db, org, id=30, name="Group A")
        db.add(
            UserGroupUser(
                usergroup_id=usergroup.id,
                user_id=extra_user.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        with patch(
            "src.services.orgs.users.is_org_member", return_value=True
        ), patch(
            "src.security.superadmin.is_user_superadmin", return_value=False
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
        second_admin = _make_user(
            db,
            id=30,
            username="admin2",
            first_name="Admin",
            last_name="Two",
            email="admin2@test.com",
            user_uuid="user_admin2",
        )
        _link_user(db, second_admin.id, org.id, 1)
        role = _make_role(db, org, id=11, name="Instructor", role_uuid="role_instructor")

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
        ):
            updated = await update_user_role(
                mock_request, org.id, regular_user.id, role.role_uuid, db, admin_user
            )
            removed = await remove_user_from_org(
                mock_request, org.id, second_admin.id, db, admin_user
            )

        assert updated == {"detail": "User role updated"}
        assert removed == {"detail": "User removed from org"}

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

        second_admin = _make_user(
            db,
            id=31,
            username="admin3",
            first_name="Admin",
            last_name="Three",
            email="admin3@test.com",
            user_uuid="user_admin3",
        )
        _link_user(db, second_admin.id, org.id, 1)

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
        self, mock_request, db, org, admin_user
    ):
        fake_redis = Mock()
        fake_redis.get.side_effect = [None, b"existing"]
        fake_redis.set = Mock()
        fake_redis.__bool__ = Mock(return_value=True)
        fake_config = SimpleNamespace(
            redis_config=SimpleNamespace(redis_connection_string="redis://test")
        )

        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=fake_config,
        ), patch(
            "src.services.orgs.users.redis.Redis.from_url",
            return_value=fake_redis,
        ), patch(
            "src.services.orgs.users.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.users.send_invite_email",
            return_value=True,
        ), patch(
            "src.services.orgs.users.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            result = await invite_batch_users(
                mock_request,
                org.id,
                "new@test.com,existing@test.com",
                "invite_uuid",
                db,
                admin_user,
            )

        assert result["summary"]["sent"] == 1
        assert result["summary"]["already_invited"] == 1

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
