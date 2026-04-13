"""Tests for src/services/orgs/join.py."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.organization_config import OrganizationConfig
from src.db.user_organizations import UserOrganization
from src.db.usergroups import UserGroup
from src.db.users import User
from src.services.orgs.join import JoinOrg, join_org


def _make_user(db, **overrides):
    user = User(
        id=overrides.pop("id", None),
        username=overrides.pop("username", "joiner"),
        first_name=overrides.pop("first_name", "Join"),
        last_name=overrides.pop("last_name", "User"),
        email=overrides.pop("email", "joiner@test.com"),
        password=overrides.pop("password", "hashed"),
        user_uuid=overrides.pop("user_uuid", "user_joiner"),
        email_verified=overrides.pop("email_verified", True),
        signup_method=overrides.pop("signup_method", "email"),
        creation_date=overrides.pop("creation_date", str(datetime.now())),
        update_date=overrides.pop("update_date", str(datetime.now())),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_org_config(db, org, signup_mode="open", version="1.0"):
    if version.startswith("2"):
        config = {
            "config_version": version,
            "admin_toggles": {"members": {"signup_mode": signup_mode}},
        }
    else:
        config = {
            "config_version": version,
            "features": {"members": {"signup_mode": signup_mode}},
        }

    org_config = OrganizationConfig(
        org_id=org.id,
        config=config,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(org_config)
    db.commit()
    db.refresh(org_config)
    return org_config


def _make_usergroup(db, org, **overrides):
    usergroup = UserGroup(
        id=overrides.pop("id", None),
        org_id=org.id,
        name=overrides.pop("name", "Invite Group"),
        description=overrides.pop("description", "Invite group"),
        usergroup_uuid=overrides.pop("usergroup_uuid", "ug_join"),
        creation_date=overrides.pop("creation_date", str(datetime.now())),
        update_date=overrides.pop("update_date", str(datetime.now())),
    )
    db.add(usergroup)
    db.commit()
    db.refresh(usergroup)
    return usergroup


class TestOrgJoinService:
    def test_join_org_model_coerces_user_id_to_string(self):
        args = JoinOrg(org_id=1, user_id=42)
        assert args.user_id == "42"

    @pytest.mark.asyncio
    async def test_join_org_open_success(self, mock_request, db, org):
        user = _make_user(db, id=11, user_uuid="user_11")
        _make_org_config(db, org, signup_mode="open", version="1.0")

        with patch(
            "src.services.orgs.join.check_limits_with_usage"
        ), patch(
            "src.services.orgs.join.get_org_join_mechanism",
            new=AsyncMock(return_value="open"),
        ), patch(
            "src.services.orgs.join.increase_feature_usage"
        ), patch(
            "src.routers.users._invalidate_session_cache"
        ):
            result = await join_org(
                mock_request,
                JoinOrg(org_id=org.id, user_id=user.id),
                user,
                db,
            )

        assert result == "Great, You're part of the Organization"
        row = db.exec(
            select(UserOrganization).where(
                UserOrganization.user_id == user.id,
                UserOrganization.org_id == org.id,
            )
        ).first()
        assert row is not None

    @pytest.mark.asyncio
    async def test_join_org_invite_only_success_with_usergroup(
        self, mock_request, db, org
    ):
        user = _make_user(db, id=12, user_uuid="user_12")
        usergroup = _make_usergroup(db, org, id=22)
        _make_org_config(db, org, signup_mode="inviteOnly", version="2.0")

        with patch(
            "src.services.orgs.join.check_limits_with_usage"
        ), patch(
            "src.services.orgs.join.get_org_join_mechanism",
            new=AsyncMock(return_value="inviteOnly"),
        ), patch(
            "src.services.orgs.join.get_invite_code",
            new=AsyncMock(return_value={"usergroup_id": usergroup.id}),
        ), patch(
            "src.services.orgs.join.add_users_to_usergroup",
            new=AsyncMock(),
        ) as mock_add_users, patch(
            "src.services.orgs.join.increase_feature_usage"
        ), patch(
            "src.routers.users._invalidate_session_cache"
        ):
            result = await join_org(
                mock_request,
                JoinOrg(org_id=org.id, user_id=user.id, invite_code="ABC12345"),
                user,
                db,
            )

        assert result == "Great, You're part of the Organization"
        mock_add_users.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_join_org_failure_branches(
        self, mock_request, db, org, anonymous_user
    ):
        user = _make_user(db, id=13, user_uuid="user_13")
        _make_org_config(db, org, signup_mode="inviteOnly", version="2.0")

        with patch(
            "src.services.orgs.join.check_limits_with_usage"
        ), patch(
            "src.services.orgs.join.get_org_join_mechanism",
            new=AsyncMock(return_value="inviteOnly"),
        ), patch(
            "src.services.orgs.join.get_invite_code",
            new=AsyncMock(return_value=None),
        ):
            with pytest.raises(HTTPException) as missing_invite_exc:
                await join_org(
                    mock_request,
                    JoinOrg(org_id=org.id, user_id=user.id, invite_code="BAD"),
                    user,
                    db,
                )
        assert missing_invite_exc.value.status_code == 400

        user.email_verified = False
        db.add(user)
        db.commit()

        with patch(
            "src.services.orgs.join.check_limits_with_usage"
        ), patch(
            "src.services.orgs.join.get_org_join_mechanism",
            new=AsyncMock(return_value="open"),
        ):
            with pytest.raises(HTTPException) as unverified_exc:
                await join_org(
                    mock_request,
                    JoinOrg(org_id=org.id, user_id=user.id),
                    user,
                    db,
                )
        assert unverified_exc.value.status_code == 403

        user.email_verified = True
        db.add(user)
        db.commit()

        already_linked = UserOrganization(
            user_id=user.id,
            org_id=org.id,
            role_id=4,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(already_linked)
        db.commit()

        with patch(
            "src.services.orgs.join.check_limits_with_usage"
        ), patch(
            "src.services.orgs.join.get_org_join_mechanism",
            new=AsyncMock(return_value="open"),
        ):
            with pytest.raises(HTTPException) as member_exc:
                await join_org(
                    mock_request,
                    JoinOrg(org_id=org.id, user_id=user.id),
                    user,
                    db,
                )
        assert member_exc.value.status_code == 400

        with patch(
            "src.services.orgs.join.check_limits_with_usage"
        ), patch(
            "src.services.orgs.join.get_org_join_mechanism",
            new=AsyncMock(return_value="open"),
        ):
            with pytest.raises(HTTPException) as org_missing_exc:
                await join_org(
                    mock_request,
                    JoinOrg(org_id=999, user_id=user.id),
                    user,
                    db,
                )
        assert org_missing_exc.value.status_code == 404

        denied_user = _make_user(db, id=14, user_uuid="user_14")

        with patch(
            "src.services.orgs.join.check_limits_with_usage"
        ), patch(
            "src.services.orgs.join.get_org_join_mechanism",
            new=AsyncMock(return_value="closed"),
        ):
            with pytest.raises(HTTPException) as denied_exc:
                await join_org(
                    mock_request,
                    JoinOrg(org_id=org.id, user_id=denied_user.id),
                    anonymous_user,
                    db,
                )
        assert denied_exc.value.status_code == 403
