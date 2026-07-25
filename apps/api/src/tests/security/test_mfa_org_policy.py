"""Tests for the org-wide "require 2FA" policy evaluation.

The deadline arithmetic is the part worth pinning down: it decides whether a
real user is locked out of their organisation today or in three weeks.
"""

from datetime import datetime, timedelta

import pytest
from sqlmodel import select

from src.db.organization_config import OrganizationConfig
from src.db.user_mfa import UserMFA
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.services.orgs.mfa_policy import evaluate_mfa_compliance, get_org_mfa_policy


async def _set_policy(db, org_id, **security):
    row = (
        await db.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
        )
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


async def _get_user(db, user_id) -> User:
    return (await db.execute(select(User).where(User.id == user_id))).scalars().first()


async def _backdate_membership(db, user_id, org_id, days):
    membership = (
        await db.execute(
            select(UserOrganization).where(
                UserOrganization.user_id == user_id,
                UserOrganization.org_id == org_id,
            )
        )
    ).scalars().first()
    membership.creation_date = str(datetime.now() - timedelta(days=days))
    db.add(membership)
    await db.commit()


async def _enroll(db, user_id, confirmed=True):
    db.add(
        UserMFA(
            user_id=user_id,
            secret_encrypted="ciphertext",
            confirmed_at=str(datetime.now()) if confirmed else None,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()


@pytest.mark.asyncio
class TestPolicyOff:
    async def test_no_config_means_no_requirement(self, db, org, regular_user):
        user = await _get_user(db, regular_user.id)
        state = await evaluate_mfa_compliance(db, user, org.id)
        assert state.required is False
        assert state.satisfied is True
        assert state.blocking is False

    async def test_explicitly_disabled(self, db, org, regular_user):
        await _set_policy(db, org.id, require_2fa=False)
        user = await _get_user(db, regular_user.id)
        state = await evaluate_mfa_compliance(db, user, org.id)
        assert state.required is False
        assert state.blocking is False

    async def test_malformed_config_fails_closed_to_no_policy(self, db, org, regular_user):
        await _set_policy(db, org.id, require_2fa=True, require_2fa_grace_days="not-a-number")
        user = await _get_user(db, regular_user.id)
        state = await evaluate_mfa_compliance(db, user, org.id)
        # Must not enforce with nonsense numbers — an admin fixes the config
        # rather than the whole org being blocked by a typo.
        assert state.required is False


@pytest.mark.asyncio
class TestPolicyOn:
    async def test_enrolled_user_satisfies_immediately(self, db, org, regular_user):
        await _set_policy(
            db, org.id, require_2fa=True, require_2fa_enabled_at=datetime.now().isoformat()
        )
        await _enroll(db, regular_user.id)
        user = await _get_user(db, regular_user.id)

        state = await evaluate_mfa_compliance(db, user, org.id)
        assert state.required is True
        assert state.satisfied is True
        assert state.blocking is False

    async def test_unconfirmed_enrollment_does_not_satisfy(self, db, org, regular_user):
        await _set_policy(
            db, org.id, require_2fa=True, require_2fa_enabled_at=datetime.now().isoformat()
        )
        await _enroll(db, regular_user.id, confirmed=False)
        user = await _get_user(db, regular_user.id)

        state = await evaluate_mfa_compliance(db, user, org.id)
        assert state.satisfied is False

    async def test_zero_grace_blocks_right_away(self, db, org, regular_user):
        await _set_policy(
            db,
            org.id,
            require_2fa=True,
            require_2fa_grace_days=0,
            require_2fa_enabled_at=datetime.now().isoformat(),
        )
        user = await _get_user(db, regular_user.id)

        state = await evaluate_mfa_compliance(db, user, org.id)
        assert state.satisfied is False
        assert state.blocking is True
        assert state.days_remaining == 0

    async def test_grace_period_leaves_user_working(self, db, org, regular_user):
        await _set_policy(
            db,
            org.id,
            require_2fa=True,
            require_2fa_grace_days=30,
            require_2fa_enabled_at=datetime.now().isoformat(),
        )
        user = await _get_user(db, regular_user.id)

        state = await evaluate_mfa_compliance(db, user, org.id)
        assert state.satisfied is False
        assert state.blocking is False
        assert 28 <= state.days_remaining <= 30

    async def test_expired_grace_blocks(self, db, org, regular_user):
        await _set_policy(
            db,
            org.id,
            require_2fa=True,
            require_2fa_grace_days=7,
            require_2fa_enabled_at=(datetime.now() - timedelta(days=30)).isoformat(),
        )
        # The membership must be backdated too: the fixture joins the user
        # today, and the late-joiner rule would (correctly) hand them a fresh
        # grace window that outlives the policy anchor.
        await _backdate_membership(db, regular_user.id, org.id, days=60)
        user = await _get_user(db, regular_user.id)

        state = await evaluate_mfa_compliance(db, user, org.id)
        assert state.blocking is True
        assert state.days_remaining == 0


@pytest.mark.asyncio
class TestLateJoinerGetsFullGrace:
    """The max(policy_anchor, join_date) rule.

    Without it, anyone joining after the policy was switched on inherits an
    already-expired deadline and is blocked on their first login.
    """

    async def test_user_joining_after_policy_still_gets_full_grace(
        self, db, org, regular_user
    ):
        await _set_policy(
            db,
            org.id,
            require_2fa=True,
            require_2fa_grace_days=14,
            # Policy switched on a year ago...
            require_2fa_enabled_at=(datetime.now() - timedelta(days=365)).isoformat(),
        )
        # ...but this member joined today.
        membership = (
            await db.execute(
                select(UserOrganization).where(
                    UserOrganization.user_id == regular_user.id,
                    UserOrganization.org_id == org.id,
                )
            )
        ).scalars().first()
        membership.creation_date = str(datetime.now())
        db.add(membership)
        await db.commit()

        user = await _get_user(db, regular_user.id)
        state = await evaluate_mfa_compliance(db, user, org.id)

        assert state.blocking is False, "a brand-new member must not be blocked on day one"
        assert 12 <= state.days_remaining <= 14

    async def test_long_standing_member_uses_policy_anchor(self, db, org, regular_user):
        await _set_policy(
            db,
            org.id,
            require_2fa=True,
            require_2fa_grace_days=7,
            require_2fa_enabled_at=(datetime.now() - timedelta(days=10)).isoformat(),
        )
        membership = (
            await db.execute(
                select(UserOrganization).where(
                    UserOrganization.user_id == regular_user.id,
                    UserOrganization.org_id == org.id,
                )
            )
        ).scalars().first()
        membership.creation_date = str(datetime.now() - timedelta(days=400))
        db.add(membership)
        await db.commit()

        user = await _get_user(db, regular_user.id)
        state = await evaluate_mfa_compliance(db, user, org.id)
        assert state.blocking is True


@pytest.mark.asyncio
class TestExternalAuthExemption:
    async def test_google_user_is_exempt_by_default(self, db, org, regular_user):
        await _set_policy(
            db,
            org.id,
            require_2fa=True,
            require_2fa_enabled_at=datetime.now().isoformat(),
        )
        user = await _get_user(db, regular_user.id)
        user.signup_method = "google"
        db.add(user)
        await db.commit()

        state = await evaluate_mfa_compliance(db, user, org.id)
        assert state.satisfied is True
        assert state.exempt_reason == "external_auth"

    async def test_exemption_can_be_switched_off(self, db, org, regular_user):
        await _set_policy(
            db,
            org.id,
            require_2fa=True,
            exempt_external_auth=False,
            require_2fa_enabled_at=datetime.now().isoformat(),
        )
        user = await _get_user(db, regular_user.id)
        user.signup_method = "google"
        db.add(user)
        await db.commit()

        state = await evaluate_mfa_compliance(db, user, org.id)
        assert state.satisfied is False

    async def test_password_user_is_never_exempt(self, db, org, regular_user):
        await _set_policy(
            db,
            org.id,
            require_2fa=True,
            require_2fa_enabled_at=datetime.now().isoformat(),
        )
        user = await _get_user(db, regular_user.id)
        user.signup_method = "password"
        db.add(user)
        await db.commit()

        state = await evaluate_mfa_compliance(db, user, org.id)
        assert state.satisfied is False


@pytest.mark.asyncio
class TestPolicyReading:
    async def test_defaults_when_org_has_no_config_row(self, db, org):
        policy = await get_org_mfa_policy(db, org.id)
        assert policy.require_2fa is False
        assert policy.grace_days == 0
        assert policy.exempt_external_auth is True

    async def test_negative_grace_is_clamped(self, db, org):
        await _set_policy(db, org.id, require_2fa=True, require_2fa_grace_days=-5)
        policy = await get_org_mfa_policy(db, org.id)
        assert policy.grace_days == 0


@pytest.mark.asyncio
class TestEnforcement:
    """The policy is only real if a blocked user is actually refused."""

    async def _make_blocking(self, db, org_id, user_id):
        await _set_policy(
            db,
            org_id,
            require_2fa=True,
            require_2fa_grace_days=7,
            require_2fa_enabled_at=(datetime.now() - timedelta(days=30)).isoformat(),
        )
        await _backdate_membership(db, user_id, org_id, days=60)

    async def test_blocked_member_is_refused(self, db, org, regular_user):
        from fastapi import HTTPException
        from src.security.org_auth import require_org_membership

        await self._make_blocking(db, org.id, regular_user.id)

        with pytest.raises(HTTPException) as exc:
            await require_org_membership(regular_user.id, org.id, db)

        assert exc.value.status_code == 403
        assert exc.value.detail["code"] == "MFA_REQUIRED_BY_ORG"
        # The deadline is handed back so the UI can say when access was lost.
        assert exc.value.detail["deadline"] is not None

    async def test_enrolled_member_passes(self, db, org, regular_user):
        from src.security.org_auth import require_org_membership

        await self._make_blocking(db, org.id, regular_user.id)
        await _enroll(db, regular_user.id)

        # Must not raise.
        await require_org_membership(regular_user.id, org.id, db)

    async def test_member_inside_grace_passes(self, db, org, regular_user):
        from src.security.org_auth import require_org_membership

        await _set_policy(
            db,
            org.id,
            require_2fa=True,
            require_2fa_grace_days=30,
            require_2fa_enabled_at=datetime.now().isoformat(),
        )
        await require_org_membership(regular_user.id, org.id, db)

    async def test_superadmin_is_never_blocked(self, db, org, regular_user):
        from src.security.org_auth import require_org_membership

        await self._make_blocking(db, org.id, regular_user.id)
        user = await _get_user(db, regular_user.id)
        user.is_superadmin = True
        db.add(user)
        await db.commit()

        # A platform admin locked out of a tenant by that tenant's own policy
        # would have no way back in.
        await require_org_membership(regular_user.id, org.id, db)

    async def test_policy_off_is_a_no_op(self, db, org, regular_user):
        from src.security.org_auth import require_org_membership

        await require_org_membership(regular_user.id, org.id, db)

    async def test_decision_is_memoized_per_session(self, db, org, regular_user):
        from src.services.orgs.mfa_policy import is_org_mfa_blocking

        await self._make_blocking(db, org.id, regular_user.id)

        first = await is_org_mfa_blocking(db, regular_user.id, org.id)
        assert first is not None
        # Second call must come from the per-session cache, not re-query.
        assert (regular_user.id, org.id) in db._mfa_policy_cache
        assert await is_org_mfa_blocking(db, regular_user.id, org.id) is first


@pytest.mark.asyncio
class TestPlaygroundEnforcement:
    """Playgrounds run their own org-role gate rather than going through
    ``require_org_*``. These pin that the policy is nonetheless enforced there —
    the module was a bypass around the org-wide requirement — while a
    non-member is never swept up by an org they do not belong to.
    """

    async def _make_blocking(self, db, org_id, user_id):
        await _set_policy(
            db,
            org_id,
            require_2fa=True,
            require_2fa_grace_days=7,
            require_2fa_enabled_at=(datetime.now() - timedelta(days=30)).isoformat(),
        )
        await _backdate_membership(db, user_id, org_id, days=60)

    async def test_blocked_member_cannot_resolve_playground_rights(self, db, org, regular_user):
        from fastapi import HTTPException
        from src.services.playgrounds.playgrounds import _get_user_rights

        await self._make_blocking(db, org.id, regular_user.id)

        with pytest.raises(HTTPException) as exc:
            await _get_user_rights(regular_user.id, org.id, db)
        assert exc.value.detail["code"] == "MFA_REQUIRED_BY_ORG"

    async def test_blocked_member_read_gate_refuses(self, db, org, regular_user):
        from fastapi import HTTPException
        from src.services.playgrounds.playgrounds import _enforce_member_mfa

        await self._make_blocking(db, org.id, regular_user.id)

        with pytest.raises(HTTPException) as exc:
            await _enforce_member_mfa(regular_user.id, org.id, db)
        assert exc.value.detail["code"] == "MFA_REQUIRED_BY_ORG"

    async def test_enrolled_member_resolves_rights(self, db, org, regular_user):
        from src.services.playgrounds.playgrounds import _get_user_rights

        await self._make_blocking(db, org.id, regular_user.id)
        await _enroll(db, regular_user.id)

        # Must not raise — an enrolled member is compliant.
        await _get_user_rights(regular_user.id, org.id, db)

    async def test_non_member_is_not_subject_to_policy(self, db, org, regular_user):
        from src.services.playgrounds.playgrounds import _enforce_member_mfa

        await self._make_blocking(db, org.id, regular_user.id)
        # Drop the membership: a non-member viewing this org's public playgrounds
        # must not inherit its 2FA requirement.
        membership = (
            await db.execute(
                select(UserOrganization).where(
                    UserOrganization.user_id == regular_user.id,
                    UserOrganization.org_id == org.id,
                )
            )
        ).scalars().first()
        await db.delete(membership)
        await db.commit()

        # Must not raise.
        await _enforce_member_mfa(regular_user.id, org.id, db)


class TestParseDt:
    """The date-shape fallback in _parse_dt decides real lockout deadlines, so
    the non-ISO and unparseable branches are pinned explicitly."""

    def test_none_and_empty(self):
        from src.services.orgs.mfa_policy import _parse_dt

        assert _parse_dt(None) is None
        assert _parse_dt("") is None

    def test_iso(self):
        from src.services.orgs.mfa_policy import _parse_dt

        assert _parse_dt("2024-01-01T09:30:00") is not None

    def test_unparseable_returns_none(self):
        from src.services.orgs.mfa_policy import _parse_dt

        # Exercises the fromisoformat failure -> strptime fallbacks -> warning.
        assert _parse_dt("definitely-not-a-date") is None
