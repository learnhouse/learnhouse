"""Superadmin gate for token principals, without the EE package.

test_superadmin_api_tokens_auth.py covers the same ground but is skipped on
builds that strip ``ee/``. These run everywhere: ``require_superadmin`` with an
org-scoped API token, with a superadmin token whose minting user was demoted or
is still a superadmin, plus ``org_owns_account`` refusing to hand a platform
superadmin's identity to any single org, and ``get_current_user`` rejecting an
``lh_sa_`` bearer token that matches nothing.
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException, Request

from src.db.users import APITokenUser, SuperadminAPITokenUser, User
from src.security.auth import get_current_user
from src.security.org_auth import org_owns_account
from src.security.superadmin import require_superadmin


@pytest.fixture
def enterprise_mode(monkeypatch):
    """conftest pins the suite to OSS, where the superadmin surface refuses
    every caller up front. The gate resolves the mode lazily from this module,
    so patching the definition reaches it."""
    import src.core.deployment_mode as deployment_mode

    monkeypatch.setattr(deployment_mode, "get_deployment_mode", lambda: "ee")


async def _make_user(db, user_id: int, *, is_superadmin: bool) -> User:
    user = User(
        id=user_id,
        username=f"user{user_id}",
        first_name="Test",
        last_name="User",
        email=f"user{user_id}@test.com",
        password="hashed",
        user_uuid=f"user_{user_id}",
        is_superadmin=is_superadmin,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(user)
    await db.commit()
    return user


class TestRequireSuperadminTokenPrincipals:
    async def test_org_api_token_is_never_a_superadmin(self, db, enterprise_mode):
        # Even one minted by a superadmin: org tokens are org-scoped.
        await _make_user(db, 501, is_superadmin=True)
        token_user = APITokenUser(org_id=1, created_by_user_id=501)

        with pytest.raises(HTTPException) as exc_info:
            await require_superadmin(current_user=token_user, db_session=db)

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == "Superadmin access required"

    async def test_superadmin_token_of_a_demoted_creator_is_refused(self, db, enterprise_mode):
        await _make_user(db, 502, is_superadmin=False)
        token_user = SuperadminAPITokenUser(id=9, created_by_user_id=502)

        with pytest.raises(HTTPException) as exc_info:
            await require_superadmin(current_user=token_user, db_session=db)

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == "Token creator is no longer a superadmin"

    async def test_superadmin_token_of_a_current_superadmin_passes(self, db, enterprise_mode):
        await _make_user(db, 503, is_superadmin=True)
        token_user = SuperadminAPITokenUser(id=9, created_by_user_id=503)

        result = await require_superadmin(current_user=token_user, db_session=db)

        assert result is token_user


class TestOrgOwnsAccount:
    async def test_platform_superadmin_belongs_to_no_single_org(self, db, org):
        """Even with the org as their only membership, an org may not rewrite a
        superadmin's email or two-factor."""
        await _make_user(db, 504, is_superadmin=True)

        assert await org_owns_account(504, org.id, db) is False


class TestUnknownSuperadminBearerToken:
    async def test_unmatched_lh_sa_token_is_401(self, db, enterprise_mode):
        request = Mock(spec=Request)
        request.headers = {"Authorization": "Bearer lh_sa_doesnotexist0000"}
        request.cookies = {}
        request.path_params = {}
        request.state = SimpleNamespace()

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(request=request, db_session=db)

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Could not validate credentials"
        # Nothing was authenticated, so nothing is published on the request.
        assert not hasattr(request.state, "user")
