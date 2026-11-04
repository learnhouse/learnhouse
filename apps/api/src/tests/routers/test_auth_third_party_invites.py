"""Invite handling in the third_party_login OAuth handler (src/routers/auth.py).

test_auth_third_party.py covers the gate itself (open org, missing invite,
existing member, Redis down). These cover what happens once an invite is
found: a pending email invite is honoured and then marked accepted, an invite
code's usergroup is attached, and failures in that follow-up work never turn a
completed sign-in into an error.
"""

import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import fakeredis
import pytest
from fastapi import HTTPException, Response, status

from src.db.organization_config import OrganizationConfig
from src.db.users import AnonymousUser
from src.routers.auth import third_party_login

# The handler reads the config again after sign-in (custom-domain binding), so
# the fake carries a single-tenant hosting block that skips that lookup.
_REDIS_CONFIG = SimpleNamespace(
    redis_config=SimpleNamespace(redis_connection_string="redis://localhost:6379"),
    hosting_config=SimpleNamespace(tenancy="single"),
)


async def _make_invite_only(db, org_id: int):
    db.add(
        OrganizationConfig(
            org_id=org_id,
            config={
                "config_version": "1.0",
                "features": {"members": {"signup_mode": "inviteOnly"}},
            },
        )
    )
    await db.commit()


def _google_body(email="invitee@example.com"):
    return SimpleNamespace(email=email, provider="google", access_token="tok")


def _invite_key(email, org):
    return f"invited_user:{email}:org:{org.org_uuid}"


async def _login(db, org, body=None, invite_code=None):
    return await third_party_login(
        request=SimpleNamespace(),
        response=Response(),
        body=body or _google_body(),
        org_id=org.id,
        invite_code=invite_code,
        current_user=AnonymousUser(),
        db_session=db,
    )


@pytest.fixture
def signed_in():
    """Patch the Google round-trip and cookie writing so the handler runs to
    completion; yields the signWithGoogle mock."""
    sign_with_google = AsyncMock(
        return_value=SimpleNamespace(id=7, email="invitee@example.com")
    )
    with patch("src.routers.auth.signWithGoogle", sign_with_google), patch(
        "src.routers.auth.set_auth_cookies"
    ), patch("src.routers.auth.UserRead") as user_read, patch(
        "src.routers.auth.get_google_user_info",
        AsyncMock(return_value={"email": "invitee@example.com", "email_verified": True}),
    ):
        user_read.model_validate.side_effect = lambda u: u
        yield sign_with_google


@pytest.fixture
def redis_server():
    """A shared fake Redis server; every ``Redis.from_url`` call gets a fresh
    client on it, like the real connection pool would."""
    server = fakeredis.FakeServer()
    with patch(
        "src.routers.auth.get_learnhouse_config", return_value=_REDIS_CONFIG
    ), patch(
        "redis.Redis.from_url",
        side_effect=lambda *a, **k: fakeredis.FakeRedis(server=server),
    ):
        yield server


class TestNonGoogleProviderInInviteOnlyOrg:
    async def test_body_email_is_normalised_for_the_invite_lookup(self, db, org):
        """Any provider other than Google has no verified email to resolve, so
        the invite gate falls back to the (normalised) body email."""
        await _make_invite_only(db, org.id)
        mock_redis = MagicMock(get=MagicMock(return_value=None))

        with patch(
            "src.routers.auth.get_learnhouse_config", return_value=_REDIS_CONFIG
        ), patch("redis.Redis.from_url", return_value=mock_redis):
            with pytest.raises(HTTPException) as exc_info:
                await _login(
                    db,
                    org,
                    body=SimpleNamespace(
                        email="  Invitee@Example.COM ",
                        provider="github",
                        access_token="tok",
                    ),
                )

        assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN
        mock_redis.get.assert_called_once_with(_invite_key("invitee@example.com", org))


class TestPendingEmailInvite:
    async def test_invalid_code_falls_back_to_email_invite_which_is_then_accepted(
        self, db, org, signed_in, redis_server
    ):
        """A bad invite code is not fatal when the address also has a pending
        dashboard invite. After sign-in the invite is marked accepted and keeps
        its remaining TTL, so the member list stops showing it as pending."""
        await _make_invite_only(db, org.id)
        key = _invite_key("invitee@example.com", org)
        seed = fakeredis.FakeRedis(server=redis_server)
        seed.set(key, json.dumps({"email": "invitee@example.com", "pending": True}), ex=3600)

        with patch(
            "src.services.orgs.invites.get_invite_code",
            AsyncMock(side_effect=HTTPException(status_code=404, detail="Invalid code")),
        ):
            result = await _login(db, org, invite_code="BADCODE")

        assert result["tokens"]["access_token"]
        assert signed_in.await_args.args[3] == org.id

        record = json.loads(seed.get(key))
        assert record["pending"] is False
        assert 0 < seed.ttl(key) <= 3600

    async def test_invite_without_ttl_is_kept_without_expiry(
        self, db, org, signed_in, redis_server
    ):
        await _make_invite_only(db, org.id)
        key = _invite_key("invitee@example.com", org)
        seed = fakeredis.FakeRedis(server=redis_server)
        seed.set(key, json.dumps({"pending": True}))

        await _login(db, org)

        assert json.loads(seed.get(key))["pending"] is False
        assert seed.ttl(key) == -1

    async def test_failure_to_mark_invite_accepted_does_not_fail_sign_in(
        self, db, org, signed_in, caplog
    ):
        await _make_invite_only(db, org.id)
        gate_client = MagicMock(get=MagicMock(return_value=b'{"pending": true}'))
        # Second connection (the "mark accepted" step) is broken end to end,
        # including close().
        broken_client = MagicMock(
            get=MagicMock(side_effect=ConnectionError("redis went away")),
            close=MagicMock(side_effect=ConnectionError("already closed")),
        )

        with patch(
            "src.routers.auth.get_learnhouse_config", return_value=_REDIS_CONFIG
        ), patch(
            "redis.Redis.from_url", side_effect=[gate_client, broken_client]
        ), caplog.at_level(logging.WARNING, logger="src.routers.auth"):
            result = await _login(db, org)

        assert result["tokens"]["access_token"]
        broken_client.set.assert_not_called()
        broken_client.close.assert_called_once()
        assert "Could not mark invitation as accepted" in caplog.text


class TestInviteCodeUsergroup:
    async def test_usergroup_from_invite_code_is_attached(self, db, org, signed_in):
        await _make_invite_only(db, org.id)
        add_to_group = AsyncMock()

        with patch(
            "src.services.orgs.invites.get_invite_code",
            AsyncMock(return_value={"invite_code": "CODE", "usergroup_id": "12"}),
        ), patch("src.services.users.usergroups.add_users_to_usergroup", add_to_group):
            result = await _login(db, org, invite_code="CODE")

        assert result["tokens"]["access_token"]
        args = add_to_group.await_args.args
        # usergroup id coerced to int, user id passed as the comma-list string.
        assert args[3] == 12
        assert args[4] == "7"

    async def test_usergroup_failure_does_not_fail_sign_in(
        self, db, org, signed_in, caplog
    ):
        await _make_invite_only(db, org.id)

        with patch(
            "src.services.orgs.invites.get_invite_code",
            AsyncMock(return_value={"invite_code": "CODE", "usergroup_id": 12}),
        ), patch(
            "src.services.users.usergroups.add_users_to_usergroup",
            AsyncMock(side_effect=HTTPException(status_code=400, detail="gone")),
        ), caplog.at_level(logging.WARNING, logger="src.routers.auth"):
            result = await _login(db, org, invite_code="CODE")

        assert result["tokens"]["access_token"]
        assert "Could not attach OAuth user to invite usergroup" in caplog.text
