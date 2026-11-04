"""Edge branches across the organization services: member invites, org
deletion side effects, plan history, live custom-domain DNS checks, joining,
and the sign-in policy reads.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException

from src.db.organization_plan_history import OrganizationPlanHistory
from src.db.users import APITokenUser, PublicUser, User
from src.security.features_utils.plans import get_plan_limit
from src.services.orgs import custom_domains as cd
from src.services.orgs import orgs as orgs_service
from src.services.orgs import users as org_users
from src.services.orgs.auth_policy import is_login_method_allowed
from src.services.orgs.join import JoinOrg, join_org
from src.services.orgs.org_config_lookup import _pinned_rows
from src.services.orgs.plan_history import record_plan_change, resolve_plan_for_month


_REDIS_CONFIG = SimpleNamespace(redis_config=SimpleNamespace(redis_connection_string="redis://test"))


# ─── users.py ────────────────────────────────────────────────────────────────


def test_rights_within_ignores_missing_and_malformed_grants():
    """No grant at all, or a bucket that is not a permission map, grants nothing."""
    assert org_users._rights_within(None, {"courses": {"action_read": True}}) is True
    assert org_users._rights_within({"courses": "everything"}, {}) is True
    assert org_users._rights_within({"courses": {"action_read": True}}, {}) is False


async def test_api_tokens_skip_the_admin_only_removal_gate(db, org, mock_request):
    """Token callers were already gated by their rights; the admin check is for people."""
    token = APITokenUser(org_id=org.id, rights={}, created_by_user_id=1)
    assert await org_users._require_admin_to_touch_admins(mock_request, org, token, db) is None


async def test_invites_must_come_from_an_existing_member(db, org, mock_request):
    """A caller whose account row is gone cannot send invitations."""
    ghost = PublicUser(id=999, username="ghost", first_name="G", last_name="H", email="g@h.com", user_uuid="user_ghost")
    with patch.object(org_users, "get_learnhouse_config", return_value=_REDIS_CONFIG), \
         patch.object(org_users, "rbac_check", new_callable=AsyncMock):
        with pytest.raises(HTTPException) as exc:
            await org_users.invite_batch_users(mock_request, org.id, "a@test.com", None, db, ghost)
    assert exc.value.status_code == 403
    assert exc.value.detail == "Invitations must come from a member"


async def test_unreadable_pending_invite_counts_toward_the_cap(db, org, admin_user, mock_request):
    """A corrupt pending-invite record is counted, so it cannot be used to slip past the member cap."""
    fake_redis = Mock()
    fake_redis.get = Mock(side_effect=lambda key: b"{corrupt" if key == "invited_user:old@test.com:org:org_test" else None)
    fake_redis.scan_iter = Mock(return_value=["invited_user:old@test.com:org:org_test"])
    fake_redis.set = Mock()

    with patch.object(org_users, "get_learnhouse_config", return_value=_REDIS_CONFIG), \
         patch.object(org_users.redis.Redis, "from_url", return_value=fake_redis), \
         patch.object(org_users, "rbac_check", new_callable=AsyncMock), \
         patch.object(org_users, "enforce_free_tier_age_gate", new_callable=AsyncMock), \
         patch.object(org_users, "check_members_limit_with_pending", new_callable=AsyncMock) as limit, \
         patch.object(org_users, "enforce_invite_rate_limit"), \
         patch.object(org_users, "send_invite_email", new=AsyncMock(return_value=True)), \
         patch.object(org_users, "dispatch_webhooks", new_callable=AsyncMock):
        result = await org_users.invite_batch_users(mock_request, org.id, "new@test.com", None, db, admin_user)

    # One unreadable existing record plus the one new invite.
    limit.assert_awaited_once_with(org.id, 2, db)
    assert result["summary"]["sent"] == 1


# ─── orgs.py ─────────────────────────────────────────────────────────────────


async def test_org_without_email_needs_no_redaction(db, mock_request):
    org_read = SimpleNamespace(email=None)
    assert await orgs_service._redact_org_email_unless_manager(mock_request, org_read, None, db) is org_read


async def test_welcome_email_failure_never_fails_org_creation():
    user = SimpleNamespace(email="creator@test.com")
    org = SimpleNamespace(slug="acme", id=7, name="Acme")
    with patch("src.services.email.utils.get_org_signup_base_url", new=AsyncMock(side_effect=RuntimeError("smtp down"))), \
         patch("src.services.users.emails.send_org_created_email") as send:
        assert await orgs_service._try_send_org_created(Mock(), org, user, Mock()) is None
    send.assert_not_called()


async def test_org_deletion_survives_a_failed_confirmation_email(db, org, admin_user, mock_request):
    with patch("src.routers.users._invalidate_session_cache"), \
         patch("src.services.users.emails.send_org_deleted_email", side_effect=RuntimeError("smtp down")) as send:
        result = await orgs_service.delete_org(mock_request, org.id, admin_user, db)
    assert result["org_id"] == org.id
    send.assert_called_once_with(admin_user.email, "Test Org")


async def test_superadmin_counts_as_org_admin(db):
    with patch.object(orgs_service, "is_user_superadmin", new=AsyncMock(return_value=True)), \
         patch.object(orgs_service, "get_user_org", new=AsyncMock()) as lookup:
        assert await orgs_service.is_org_admin_role(5, 1, db) is True
    lookup.assert_not_awaited()


# ─── plan_history.py ─────────────────────────────────────────────────────────


async def test_record_plan_change_swallows_write_failures(db, org):
    """Bookkeeping failures must not block the plan change itself."""
    with patch.object(db, "flush", new=AsyncMock(side_effect=RuntimeError("db down"))):
        assert await record_plan_change(org.id, "free", "pro", db) is False


async def test_history_that_starts_after_the_month_falls_back_to_current_plan(db, org):
    db.add(OrganizationPlanHistory(org_id=org.id, plan="pro", effective_from=datetime(2026, 3, 10, tzinfo=timezone.utc)))
    await db.commit()
    # January predates every recorded change, so nothing covers it.
    plan, limit = await resolve_plan_for_month(org.id, 2026, 1, "free", db)
    assert (plan, limit) == ("free", get_plan_limit("free", "members"))


async def test_history_inside_the_month_without_an_opening_plan(db, org):
    """A first change in the middle of a month is the only candidate."""
    db.add(OrganizationPlanHistory(org_id=org.id, plan="pro", effective_from=datetime(2026, 3, 10, tzinfo=timezone.utc)))
    await db.commit()
    plan, limit = await resolve_plan_for_month(org.id, 2026, 3, "free", db)
    assert (plan, limit) == ("pro", get_plan_limit("pro", "members"))


# ─── custom_domains.py (live DNS check) ──────────────────────────────────────


def test_points_at_platform_needs_a_base_domain_and_a_domain():
    with patch.object(cd, "LEARNHOUSE_DOMAIN", ""):
        assert cd._check_points_at_platform("school.example.com", "acme") is False
    with patch.object(cd, "LEARNHOUSE_DOMAIN", "learnhouse.test"):
        assert cd._check_points_at_platform("", "acme") is False


def test_platform_subdomains_always_point_at_the_platform():
    with patch.object(cd, "LEARNHOUSE_DOMAIN", "learnhouse.test"), \
         patch.object(cd, "_dns_records") as dns:
        assert cd._check_points_at_platform("acme.learnhouse.test", "acme") is True
        assert cd._check_points_at_platform("learnhouse.test", "") is True
    dns.assert_not_called()


def test_points_at_platform_cache_is_bounded(monkeypatch):
    monkeypatch.delenv("LEARNHOUSE_CUSTOM_DOMAIN_DEV_MODE", raising=False)
    monkeypatch.setattr(cd, "_POINTS_AT_PLATFORM_CACHE", {("stale.example.com", ""): (False, 0.0)})
    monkeypatch.setattr(cd, "_POINTS_AT_PLATFORM_CACHE_MAX", 1)
    with patch.object(cd, "_check_points_at_platform", return_value=True):
        assert cd.domain_points_at_platform("school.example.com", "acme") is True
    assert list(cd._POINTS_AT_PLATFORM_CACHE) == [("school.example.com", "acme")]


async def test_async_points_at_platform_runs_the_blocking_check():
    with patch.object(cd, "domain_points_at_platform", return_value=True) as check:
        assert await cd.custom_domain_points_at_platform("school.example.com", "acme") is True
    check.assert_called_once_with("school.example.com", "acme")


# ─── join.py / auth_policy.py / org_config_lookup.py ─────────────────────────


async def test_invite_only_org_without_a_code_refuses_the_join(db, org, mock_request):
    """An invite-only org cannot be joined without an invite code."""
    joiner = User(
        id=40, username="joiner", first_name="J", last_name="O", email="joiner@test.com",
        password="x", user_uuid="user_joiner", email_verified=True,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(joiner)
    await db.commit()
    caller = PublicUser(id=40, username="joiner", first_name="J", last_name="O", email="joiner@test.com", user_uuid="user_joiner")

    with patch("src.services.orgs.join.check_limits_with_usage", new_callable=AsyncMock), \
         patch("src.services.orgs.join.get_org_join_mechanism", new=AsyncMock(return_value="inviteOnly")):
        with pytest.raises(HTTPException) as exc:
            await join_org(mock_request, JoinOrg(org_id=org.id, user_id=40), caller, db)
    assert exc.value.status_code == 403
    assert exc.value.detail == "Something wrong, try later."


async def test_policy_read_failure_allows_login(db):
    with patch("src.services.orgs.auth_policy.get_org_auth_policy", new=AsyncMock(side_effect=RuntimeError("db down"))):
        assert await is_login_method_allowed(db, 1, "password") is True


def test_pinned_rows_skips_test_doubles():
    assert _pinned_rows(SimpleNamespace()) is None
