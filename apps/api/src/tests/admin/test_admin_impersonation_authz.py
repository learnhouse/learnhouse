"""Authorization tests for the admin API's impersonation endpoint.

``issue_user_token`` mints an ordinary session JWT for an arbitrary member of
the token's org, so it has to be gated on the token's declared rights and must
refuse privileged targets — otherwise any org API token, whatever it was scoped
to, could borrow the org administrator's session.
"""

from datetime import datetime

import pytest
from fastapi import HTTPException

from src.db.roles import Permission
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, User
from src.security.auth import decode_jwt
from src.security.rbac.constants import ADMIN_ROLE_ID, MAINTAINER_ROLE_ID
from src.security.session_context import AMR_CLAIM, AUTH_METHOD_API_TOKEN, SORG_CLAIM
from src.services.admin.admin import (
    _resolve_org_slug,
    issue_user_token,
)


MEMBER_ROLE_ID = 4


def _model_permission(**overrides) -> Permission:
    return Permission(**{**_permission(), **overrides})


def _permission(**overrides) -> dict:
    perm = {
        "action_create": False,
        "action_read": False,
        "action_update": False,
        "action_delete": False,
    }
    perm.update(overrides)
    return perm


USERS_READ_RIGHTS = {"users": _permission(action_read=True)}
# The leaked-integration-token shape: read on content, nothing on people.
COURSES_ONLY_RIGHTS = {
    "courses": _permission(action_read=True),
    "users": _permission(),
}


def _token(org_id: int, rights) -> APITokenUser:
    return APITokenUser(
        id=10,
        user_uuid="apitoken_authz",
        username="api_token",
        org_id=org_id,
        rights=rights,
        token_name="Reporting Token",
        created_by_user_id=1,
    )


async def _member(
    db,
    org_id: int,
    *,
    user_id: int,
    role_id: int,
    is_superadmin: bool = False,
) -> User:
    u = User(
        id=user_id,
        username=f"member{user_id}",
        first_name="Mem",
        last_name="Ber",
        email=f"member{user_id}@test.com",
        password="hashed",
        user_uuid=f"user_member{user_id}",
        is_superadmin=is_superadmin,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    db.add(UserOrganization(
        user_id=u.id,
        org_id=org_id,
        role_id=role_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    ))
    await db.commit()
    return u


@pytest.fixture
def reader_token(org):
    return _token(org.id, USERS_READ_RIGHTS)


class TestIssueUserTokenIsNotRightsScoped:
    async def test_a_content_scoped_token_can_still_mint_for_a_member(self, db, org):
        """Tokens only ever carry content buckets, so impersonation is not
        gated on a ``users`` right — it is gated on the target instead."""
        target = await _member(db, org.id, user_id=20, role_id=MEMBER_ROLE_ID)
        token = _token(org.id, COURSES_ONLY_RIGHTS)

        result = await issue_user_token(token, target.id, db)

        assert result["user_id"] == target.id

    async def test_a_token_with_no_rights_at_all_still_works(self, db, org):
        target = await _member(db, org.id, user_id=21, role_id=MEMBER_ROLE_ID)
        token = _token(org.id, None)

        result = await issue_user_token(token, target.id, db)

        assert result["user_id"] == target.id

    async def test_unknown_target_is_a_404(self, db, org):
        token = _token(org.id, COURSES_ONLY_RIGHTS)

        with pytest.raises(HTTPException) as exc:
            await issue_user_token(token, 999999, db)

        assert exc.value.status_code == 404


class TestIssueUserTokenLegitimateUse:
    async def test_ordinary_member_still_gets_a_token(self, db, org, reader_token):
        target = await _member(db, org.id, user_id=23, role_id=MEMBER_ROLE_ID)

        result = await issue_user_token(reader_token, target.id, db)

        assert result["token_type"] == "bearer"
        assert result["user_id"] == target.id
        assert result["user_uuid"] == target.user_uuid
        assert result["access_token"]

    async def test_minted_session_is_marked_as_machine_issued(
        self, db, org, reader_token
    ):
        target = await _member(db, org.id, user_id=24, role_id=MEMBER_ROLE_ID)

        result = await issue_user_token(reader_token, target.id, db)
        payload = decode_jwt(result["access_token"])

        assert payload is not None
        assert payload["sub"] == target.email
        # Still a session (get_current_user rejects any other purpose), but the
        # amr claim makes an impersonated session auditable.
        assert payload["purpose"] == "session"
        assert payload[AMR_CLAIM] == AUTH_METHOD_API_TOKEN
        assert payload[SORG_CLAIM] == org.id


class TestIssueUserTokenPrivilegedTargets:
    async def test_org_admin_target_is_refused(self, db, org, reader_token):
        target = await _member(db, org.id, user_id=25, role_id=ADMIN_ROLE_ID)

        with pytest.raises(HTTPException) as exc:
            await issue_user_token(reader_token, target.id, db)

        assert exc.value.status_code == 403
        assert "Admin or Maintainer" in str(exc.value.detail)

    async def test_maintainer_target_is_refused(self, db, org, reader_token):
        target = await _member(db, org.id, user_id=26, role_id=MAINTAINER_ROLE_ID)

        with pytest.raises(HTTPException) as exc:
            await issue_user_token(reader_token, target.id, db)

        assert exc.value.status_code == 403
        assert "Admin or Maintainer" in str(exc.value.detail)

    async def test_superadmin_target_is_refused(self, db, org, reader_token):
        target = await _member(
            db, org.id, user_id=27, role_id=MEMBER_ROLE_ID, is_superadmin=True
        )

        with pytest.raises(HTTPException) as exc:
            await issue_user_token(reader_token, target.id, db)

        assert exc.value.status_code == 403
        assert "superadmin" in str(exc.value.detail)


class TestIssueUserTokenCrossOrg:
    async def test_user_in_another_org_is_refused(
        self, db, org, other_org, reader_token
    ):
        outsider = await _member(
            db, other_org.id, user_id=28, role_id=MEMBER_ROLE_ID
        )

        with pytest.raises(HTTPException) as exc:
            await issue_user_token(reader_token, outsider.id, db)

        assert exc.value.status_code == 403
        assert "does not belong to this organization" in str(exc.value.detail)

    async def test_org_slug_gate_still_rejects_another_orgs_slug(
        self, db, org, other_org, reader_token
    ):
        """The endpoint's own org gate is unchanged by the rights check."""
        with pytest.raises(HTTPException) as exc:
            await _resolve_org_slug(other_org.slug, reader_token, db)

        assert exc.value.status_code == 403
        assert "does not have access to this organization" in str(exc.value.detail)
