"""Tests for src/services/orgs/invites.py."""

import json
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException

from src.db.usergroups import UserGroup
from src.services.orgs.invites import (
    create_invite_code,
    delete_invite_code,
    get_invite_code,
    get_invite_codes,
    send_invite_email,
)


def _make_usergroup(db, org, **overrides):
    usergroup = UserGroup(
        id=overrides.pop("id", None),
        org_id=org.id,
        name=overrides.pop("name", "Invite Group"),
        description=overrides.pop("description", "Invite group"),
        usergroup_uuid=overrides.pop("usergroup_uuid", "ug_invite"),
        creation_date=overrides.pop("creation_date", str(datetime.now())),
        update_date=overrides.pop("update_date", str(datetime.now())),
    )
    db.add(usergroup)
    db.commit()
    db.refresh(usergroup)
    return usergroup


def _fake_config(redis_url="redis://test"):
    return SimpleNamespace(
        redis_config=SimpleNamespace(redis_connection_string=redis_url)
    )


def _fake_redis(scan_keys=None, values=None):
    redis_client = Mock()
    redis_client.__bool__ = Mock(return_value=True)
    redis_client.scan_iter = Mock(return_value=scan_keys or [])
    values = values or {}

    def _get(key):
        return values.get(key)

    redis_client.get = Mock(side_effect=_get)
    redis_client.set = Mock()
    redis_client.delete = Mock()
    return redis_client


class TestOrgInvitesService:
    @pytest.mark.asyncio
    async def test_create_invite_code_success_with_usergroup(
        self, mock_request, db, org, admin_user
    ):
        usergroup = _make_usergroup(db, org, id=11)
        fake_redis = _fake_redis()

        with patch(
            "src.services.orgs.invites.get_learnhouse_config",
            return_value=_fake_config(),
        ), patch(
            "src.services.orgs.invites.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.invites.redis.Redis.from_url",
            return_value=fake_redis,
        ), patch(
            "src.services.orgs.invites.uuid.uuid4",
            return_value="invite-uuid",
        ), patch(
            "src.services.orgs.invites.secrets.choice",
            side_effect=list("ABCDEFGH"),
        ):
            result = await create_invite_code(
                mock_request,
                org.id,
                admin_user,
                db,
                usergroup.id,
            )

        assert result["invite_code"] == "ABCDEFGH"
        assert result["invite_code_uuid"] == "org_invite_code_invite-uuid"
        assert result["usergroup_id"] == usergroup.id
        fake_redis.set.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_invite_code_validation_and_limit_guards(
        self, mock_request, db, org, admin_user
    ):
        with patch(
            "src.services.orgs.invites.get_learnhouse_config",
            return_value=_fake_config(None),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await create_invite_code(mock_request, org.id, admin_user, db)
        assert exc_info.value.status_code == 500

        with patch(
            "src.services.orgs.invites.get_learnhouse_config",
            return_value=_fake_config(),
        ), patch(
            "src.services.orgs.invites.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.invites.redis.Redis.from_url",
            return_value=_fake_redis(scan_keys=[f"k{i}" for i in range(6)]),
        ):
            with pytest.raises(HTTPException) as limit_exc:
                await create_invite_code(mock_request, org.id, admin_user, db)
        assert limit_exc.value.status_code == 400

        with patch(
            "src.services.orgs.invites.get_learnhouse_config",
            return_value=_fake_config(),
        ), patch(
            "src.services.orgs.invites.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.invites.redis.Redis.from_url",
            return_value=_fake_redis(),
        ):
            with pytest.raises(HTTPException) as group_exc:
                await create_invite_code(
                    mock_request,
                    org.id,
                    admin_user,
                    db,
                    usergroup_id=999,
                )
        assert group_exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_invite_code_error_branches(
        self, mock_request, db, org, admin_user
    ):
        with patch(
            "src.services.orgs.invites.get_learnhouse_config",
            return_value=_fake_config(None),
        ):
            with pytest.raises(HTTPException) as create_redis_exc:
                await create_invite_code(mock_request, org.id, admin_user, db)
            with pytest.raises(HTTPException) as get_codes_redis_exc:
                await get_invite_codes(mock_request, org.id, admin_user, db)
            with pytest.raises(HTTPException) as get_code_redis_exc:
                await get_invite_code(
                    mock_request,
                    org.id,
                    "ABC12345",
                    admin_user,
                    db,
                )
            with pytest.raises(HTTPException) as delete_redis_exc:
                await delete_invite_code(
                    mock_request,
                    org.id,
                    "org_invite_code_test",
                    admin_user,
                    db,
                )

        assert create_redis_exc.value.status_code == 500
        assert get_codes_redis_exc.value.status_code == 500
        assert get_code_redis_exc.value.status_code == 500
        assert delete_redis_exc.value.status_code == 500

        with patch(
            "src.services.orgs.invites.get_learnhouse_config",
            return_value=_fake_config(),
        ), patch(
            "src.services.orgs.invites.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.invites.redis.Redis.from_url",
            return_value=_fake_redis(),
        ):
            with pytest.raises(HTTPException) as create_org_exc:
                await create_invite_code(mock_request, 999, admin_user, db)
            with pytest.raises(HTTPException) as get_codes_org_exc:
                await get_invite_codes(mock_request, 999, admin_user, db)
            with pytest.raises(HTTPException) as get_code_org_exc:
                await get_invite_code(
                    mock_request,
                    999,
                    "ABC12345",
                    admin_user,
                    db,
                )
            with pytest.raises(HTTPException) as delete_org_exc:
                await delete_invite_code(
                    mock_request,
                    999,
                    "org_invite_code_missing",
                    admin_user,
                    db,
                )

        assert create_org_exc.value.status_code == 404
        assert get_codes_org_exc.value.status_code == 404
        assert get_code_org_exc.value.status_code == 404
        assert delete_org_exc.value.status_code == 404

        with patch(
            "src.services.orgs.invites.get_learnhouse_config",
            return_value=_fake_config(),
        ), patch(
            "src.services.orgs.invites.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.invites.redis.Redis.from_url",
            return_value=None,
        ):
            with pytest.raises(HTTPException) as create_conn_exc:
                await create_invite_code(mock_request, org.id, admin_user, db)
            with pytest.raises(HTTPException) as get_codes_conn_exc:
                await get_invite_codes(mock_request, org.id, admin_user, db)
            with pytest.raises(HTTPException) as get_code_conn_exc:
                await get_invite_code(
                    mock_request,
                    org.id,
                    "ABC12345",
                    admin_user,
                    db,
                )
            with pytest.raises(HTTPException) as delete_conn_exc:
                await delete_invite_code(
                    mock_request,
                    org.id,
                    "org_invite_code_test",
                    admin_user,
                    db,
                )

        assert create_conn_exc.value.status_code == 500
        assert get_codes_conn_exc.value.status_code == 500
        assert get_code_conn_exc.value.status_code == 500
        assert delete_conn_exc.value.status_code == 500

        invite_payload = {
            "invite_code": "ABC12345",
            "invite_code_uuid": "org_invite_code_test",
            "invite_code_expires": 123,
            "invite_code_type": "signup",
            "created_at": "2024-01-01T00:00:00",
            "created_by": admin_user.user_uuid,
        }
        with patch(
            "src.services.orgs.invites.get_learnhouse_config",
            return_value=_fake_config(),
        ), patch(
            "src.services.orgs.invites.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.invites.redis.Redis.from_url",
            return_value=_fake_redis(scan_keys=[], values={b"invite-key": json.dumps(invite_payload)}),
        ):
            with pytest.raises(HTTPException) as get_code_missing_exc:
                await get_invite_code(
                    mock_request,
                    org.id,
                    "MISSING",
                    admin_user,
                    db,
                )
        assert get_code_missing_exc.value.status_code == 404

        with patch(
            "src.services.orgs.invites.get_learnhouse_config",
            return_value=_fake_config(),
        ), patch(
            "src.services.orgs.invites.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.invites.redis.Redis.from_url",
            return_value=_fake_redis(scan_keys=[]),
        ):
            with pytest.raises(HTTPException) as delete_missing_keys_exc:
                await delete_invite_code(
                    mock_request,
                    org.id,
                    "org_invite_code_missing",
                    admin_user,
                    db,
                )
        assert delete_missing_keys_exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_get_invite_codes_enriches_usergroup_name(
        self, mock_request, db, org, admin_user
    ):
        usergroup = _make_usergroup(db, org, id=21, name="Beta Group")
        invite_payload = {
            "invite_code": "ABC12345",
            "invite_code_uuid": "org_invite_code_test",
            "invite_code_expires": 123,
            "invite_code_type": "signup",
            "created_at": "2024-01-01T00:00:00",
            "created_by": admin_user.user_uuid,
            "usergroup_id": usergroup.id,
        }
        fake_redis = _fake_redis(
            scan_keys=[b"invite-key"],
            values={b"invite-key": json.dumps(invite_payload)},
        )

        with patch(
            "src.services.orgs.invites.get_learnhouse_config",
            return_value=_fake_config(),
        ), patch(
            "src.services.orgs.invites.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.invites.redis.Redis.from_url",
            return_value=fake_redis,
        ):
            result = await get_invite_codes(mock_request, org.id, admin_user, db)

        assert result[0]["invite_code"] == "ABC12345"
        assert result[0]["usergroup_name"] == "Beta Group"

    @pytest.mark.asyncio
    async def test_get_invite_code_success_and_not_found(
        self, mock_request, db, org, admin_user
    ):
        invite_payload = {
            "invite_code": "ABC12345",
            "invite_code_uuid": "org_invite_code_test",
            "invite_code_expires": 123,
            "invite_code_type": "signup",
            "created_at": "2024-01-01T00:00:00",
            "created_by": admin_user.user_uuid,
        }
        fake_redis = _fake_redis(
            scan_keys=[b"invite-key"],
            values={b"invite-key": json.dumps(invite_payload)},
        )

        with patch(
            "src.services.orgs.invites.get_learnhouse_config",
            return_value=_fake_config(),
        ), patch(
            "src.services.orgs.invites.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.invites.redis.Redis.from_url",
            return_value=fake_redis,
        ):
            result = await get_invite_code(
                mock_request,
                org.id,
                "ABC12345",
                admin_user,
                db,
            )

        assert result["invite_code"] == "ABC12345"

        with patch(
            "src.services.orgs.invites.get_learnhouse_config",
            return_value=_fake_config(),
        ), patch(
            "src.services.orgs.invites.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.invites.redis.Redis.from_url",
            return_value=_fake_redis(),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await get_invite_code(
                    mock_request,
                    org.id,
                    "bad-code*",
                    admin_user,
                    db,
                )
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_invite_code_success_and_missing(
        self, mock_request, db, org, admin_user
    ):
        fake_redis = _fake_redis(scan_keys=[b"invite-key"])

        with patch(
            "src.services.orgs.invites.get_learnhouse_config",
            return_value=_fake_config(),
        ), patch(
            "src.services.orgs.invites.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.invites.redis.Redis.from_url",
            return_value=fake_redis,
        ):
            result = await delete_invite_code(
                mock_request,
                org.id,
                "org_invite_code_test",
                admin_user,
                db,
            )

        assert result == [b"invite-key"]
        fake_redis.delete.assert_called_once_with(b"invite-key")

        with patch(
            "src.services.orgs.invites.get_learnhouse_config",
            return_value=_fake_config(),
        ), patch(
            "src.services.orgs.invites.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.invites.redis.Redis.from_url",
            return_value=_fake_redis(),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await delete_invite_code(
                    mock_request,
                    org.id,
                    "org_invite_code_missing",
                    admin_user,
                    db,
                )
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_send_invite_email_with_and_without_invite_code(
        self, mock_request, org, admin_user
    ):
        fake_redis = _fake_redis(
            scan_keys=[b"invite-key"],
            values={
                b"invite-key": json.dumps(
                    {"invite_code": "ABC12345", "invite_code_uuid": "invite_uuid"}
                )
            },
        )

        with patch(
            "src.services.orgs.invites.get_learnhouse_config",
            return_value=_fake_config(),
        ), patch(
            "src.services.orgs.invites.redis.Redis.from_url",
            return_value=fake_redis,
        ), patch(
            "src.services.email.utils.get_org_signup_base_url",
            return_value="https://test-org.learnhouse.io",
        ), patch(
            "src.services.orgs.invites.send_invitation_email",
            return_value={"id": "email"},
        ):
            result = send_invite_email(
                org,
                "invite_uuid",
                admin_user,
                admin_user.email,
                mock_request,
            )

        assert result is True

        with patch(
            "src.services.orgs.invites.get_learnhouse_config",
            return_value=_fake_config(),
        ), patch(
            "src.services.email.utils.get_org_signup_base_url",
            return_value="https://test-org.learnhouse.io",
        ), patch(
            "src.services.orgs.invites.send_invitation_email",
            side_effect=RuntimeError("boom"),
        ):
            result = send_invite_email(
                org,
                None,
                admin_user,
                admin_user.email,
                mock_request,
            )

        assert result is False
