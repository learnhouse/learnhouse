"""Tests for the org auth-method / session-sharing policy.

The gate decides, per request, whether *this session* (how it authenticated and
which org it was minted for) may access the org. Provenance is normally published
on a contextvar by ``get_current_user``; these tests set it directly so the
policy logic can be exercised without a full HTTP round-trip.
"""

from datetime import datetime

import pytest
from sqlmodel import select

from src.db.organization_config import OrganizationConfig
from src.db.users import User
from src.security.session_context import (
    SessionProvenance,
    set_session_provenance,
)
from src.services.orgs.auth_policy import (
    METHOD_NOT_ALLOWED_CODE,
    SESSION_NOT_BOUND_CODE,
    enforce_org_auth_policy,
    evaluate_org_auth,
    get_org_auth_policy,
)


async def _set_auth_policy(db, org_id, **security):
    row = (
        await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org_id))
    ).scalars().first()
    config = {"config_version": "2.0", "admin_toggles": {"security": security}}
    if row is None:
        row = OrganizationConfig(
            org_id=org_id,
            config=config,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    else:
        row.config = config
    db.add(row)
    await db.commit()


def _prov(amr=None, org_id=None):
    set_session_provenance(SessionProvenance(amr=amr, org_id=org_id))


@pytest.fixture(autouse=True)
def _clear_provenance():
    set_session_provenance(None)
    yield
    set_session_provenance(None)


@pytest.mark.asyncio
class TestDefaultsAreNoOp:
    async def test_no_config_allows_any_session(self, db, org, regular_user):
        _prov(amr=None, org_id=None)  # legacy session
        # No policy row at all → nothing enforced.
        await enforce_org_auth_policy(db, regular_user.id, org.id)

    async def test_all_methods_and_sharing_on_is_no_op(self, db, org, regular_user):
        await _set_auth_policy(
            db, org.id,
            allowed_auth_methods=["password", "magic_login", "google", "sso"],
            allow_central_session_sharing=True,
        )
        _prov(amr=None, org_id=None)
        await enforce_org_auth_policy(db, regular_user.id, org.id)

    async def test_empty_allow_list_is_treated_as_unrestricted(self, db, org, regular_user):
        # A mis-save must never lock every method out.
        await _set_auth_policy(db, org.id, allowed_auth_methods=[])
        policy = await get_org_auth_policy(db, org.id)
        assert policy.method_restricted is False
        _prov(amr="password", org_id=None)
        await enforce_org_auth_policy(db, regular_user.id, org.id)


@pytest.mark.asyncio
class TestMethodGate:
    async def test_disallowed_method_is_refused(self, db, org, regular_user):
        from fastapi import HTTPException

        await _set_auth_policy(db, org.id, allowed_auth_methods=["sso"])
        _prov(amr="password", org_id=org.id)

        with pytest.raises(HTTPException) as exc:
            await enforce_org_auth_policy(db, regular_user.id, org.id)
        assert exc.value.detail["code"] == METHOD_NOT_ALLOWED_CODE
        assert exc.value.detail["allowed_methods"] == ["sso"]

    async def test_allowed_method_passes(self, db, org, regular_user):
        await _set_auth_policy(db, org.id, allowed_auth_methods=["sso", "password"])
        _prov(amr="password", org_id=org.id)
        await enforce_org_auth_policy(db, regular_user.id, org.id)

    async def test_legacy_session_blocked_under_restriction(self, db, org, regular_user):
        from fastapi import HTTPException

        # A pre-feature session carries no amr; a restrictive org must force it to
        # re-authenticate with a known method rather than let it through blind.
        await _set_auth_policy(db, org.id, allowed_auth_methods=["password"])
        _prov(amr=None, org_id=None)
        with pytest.raises(HTTPException) as exc:
            await enforce_org_auth_policy(db, regular_user.id, org.id)
        assert exc.value.detail["code"] == METHOD_NOT_ALLOWED_CODE

    async def test_api_token_is_exempt(self, db, org, regular_user):
        # Machine credentials carry their own org boundary; the human method
        # policy must not apply to them.
        await _set_auth_policy(db, org.id, allowed_auth_methods=["sso"])
        _prov(amr="api_token", org_id=org.id)
        await enforce_org_auth_policy(db, regular_user.id, org.id)


@pytest.mark.asyncio
class TestSharingGate:
    async def test_foreign_session_refused_when_sharing_off(self, db, org, regular_user):
        from fastapi import HTTPException

        await _set_auth_policy(db, org.id, allow_central_session_sharing=False)
        _prov(amr="password", org_id=None)  # central/apex session
        with pytest.raises(HTTPException) as exc:
            await enforce_org_auth_policy(db, regular_user.id, org.id)
        assert exc.value.detail["code"] == SESSION_NOT_BOUND_CODE

    async def test_other_org_session_refused_when_sharing_off(self, db, org, regular_user):
        from fastapi import HTTPException

        await _set_auth_policy(db, org.id, allow_central_session_sharing=False)
        _prov(amr="password", org_id=org.id + 999)
        with pytest.raises(HTTPException) as exc:
            await enforce_org_auth_policy(db, regular_user.id, org.id)
        assert exc.value.detail["code"] == SESSION_NOT_BOUND_CODE

    async def test_matching_org_session_passes(self, db, org, regular_user):
        await _set_auth_policy(db, org.id, allow_central_session_sharing=False)
        _prov(amr="password", org_id=org.id)
        await enforce_org_auth_policy(db, regular_user.id, org.id)

    async def test_sharing_on_lets_central_session_through(self, db, org, regular_user):
        await _set_auth_policy(db, org.id, allow_central_session_sharing=True)
        _prov(amr="password", org_id=None)
        await enforce_org_auth_policy(db, regular_user.id, org.id)


@pytest.mark.asyncio
class TestSuperadminAndResilience:
    async def test_superadmin_is_never_blocked(self, db, org, regular_user):
        await _set_auth_policy(
            db, org.id,
            allowed_auth_methods=["sso"],
            allow_central_session_sharing=False,
        )
        user = (
            await db.execute(select(User).where(User.id == regular_user.id))
        ).scalars().first()
        user.is_superadmin = True
        db.add(user)
        await db.commit()

        _prov(amr="password", org_id=None)
        # Would fail both gates, but a platform admin must not be locked out of a
        # tenant by that tenant's own policy.
        await enforce_org_auth_policy(db, regular_user.id, org.id)

    async def test_decision_is_memoized_per_session(self, db, org, regular_user):
        await _set_auth_policy(db, org.id, allowed_auth_methods=["sso"])
        _prov(amr="password", org_id=org.id)

        first = await evaluate_org_auth(db, regular_user.id, org.id)
        assert first is not None
        assert (regular_user.id, org.id) in db._auth_policy_cache


@pytest.mark.asyncio
class TestGateWiring:
    """The policy must actually fire from the shared org gate, not just in
    isolation — that is the seam every request funnels through."""

    async def test_require_org_membership_enforces_method_policy(self, db, org, regular_user):
        from fastapi import HTTPException
        from src.security.org_auth import require_org_membership

        await _set_auth_policy(db, org.id, allowed_auth_methods=["sso"])
        _prov(amr="password", org_id=org.id)

        with pytest.raises(HTTPException) as exc:
            await require_org_membership(regular_user.id, org.id, db)
        assert exc.value.detail["code"] == METHOD_NOT_ALLOWED_CODE

    async def test_require_org_membership_passes_allowed_method(self, db, org, regular_user):
        from src.security.org_auth import require_org_membership

        await _set_auth_policy(db, org.id, allowed_auth_methods=["password"])
        _prov(amr="password", org_id=org.id)
        await require_org_membership(regular_user.id, org.id, db)


@pytest.mark.asyncio
class TestMalformedConfig:
    async def test_non_dict_security_falls_back_to_defaults(self, db, org):
        # A security blob of the wrong shape (a list) must not raise or lock the
        # org — get_org_auth_policy swallows it and returns the permissive default.
        row = OrganizationConfig(
            org_id=org.id,
            config={"config_version": "2.0", "admin_toggles": {"security": ["bogus"]}},
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(row)
        await db.commit()

        policy = await get_org_auth_policy(db, org.id)
        assert policy.method_restricted is False
        assert policy.allow_central_session_sharing is True
