"""Sign-in links: the issuer re-check, session provenance, the explicit link
host, and the single-use store's edge cases.

Links an org issues through its API token are re-checked when clicked (the
token must still be live and still allowed to sign that member in), produce a
session stamped as an API-token sign-in bound to that org, and can be built on
one of the org's verified custom domains when the integration asks for it.
"""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from src.db.api_tokens import APIToken
from src.db.used_link_tokens import UsedLinkToken
from src.security.auth import create_access_token, decode_jwt
from src.security.session_context import AMR_CLAIM, AUTH_METHOD_API_TOKEN, SORG_CLAIM
from src.services.admin.admin import consume_magic_link_token
from src.services.auth import link_tokens
from src.services.auth.link_tokens import redeem_link_token
from src.tests.admin.test_admin_api import FULL_ADMIN_API_RIGHTS


@pytest.fixture(autouse=True)
def _plan_allows_api_access():
    with patch(
        "src.services.api_tokens.api_tokens._require_api_access_plan", new_callable=AsyncMock
    ):
        yield


async def _api_token(db, org, creator, **overrides) -> APIToken:
    fields = dict(
        name="integration",
        token_uuid="apitoken_test",
        token_prefix="lh_test",
        token_hash="x",
        org_id=org.id,
        created_by_user_id=creator.id,
        rights=FULL_ADMIN_API_RIGHTS,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    fields.update(overrides)
    token = APIToken(**fields)
    db.add(token)
    await db.commit()
    await db.refresh(token)
    return token


def _link(email, org_id, **claims) -> str:
    data = {
        "sub": email,
        "purpose": "magic_link",
        "org_id": org_id,
        "redirect_to": "",
        "jti": claims.pop("jti", "hardening-jti"),
        **claims,
    }
    return create_access_token(data=data, expires_delta=timedelta(minutes=5))


# ── Issuer re-check at redemption ────────────────────────────────────────────


@pytest.mark.asyncio
class TestIssuerRecheck:
    async def test_live_token_signs_in_with_api_token_provenance(self, db, org, admin_user, regular_user):
        api_token = await _api_token(db, org, admin_user)
        _u, access, _r, _redirect, mfa = await consume_magic_link_token(
            _link(regular_user.email, org.id, tid=api_token.id), db
        )
        assert mfa is None
        claims = decode_jwt(access)
        assert claims[AMR_CLAIM] == AUTH_METHOD_API_TOKEN
        assert claims[SORG_CLAIM] == org.id

    async def test_revoked_token_refused(self, db, org, admin_user, regular_user):
        api_token = await _api_token(db, org, admin_user, is_active=False)
        with pytest.raises(HTTPException) as exc:
            await consume_magic_link_token(_link(regular_user.email, org.id, tid=api_token.id), db)
        assert exc.value.status_code == 410
        assert exc.value.detail["code"] == "MAGIC_LINK_INVALID"

    async def test_expired_token_refused(self, db, org, admin_user, regular_user):
        api_token = await _api_token(
            db, org, admin_user, expires_at=(datetime.now() - timedelta(days=1)).isoformat()
        )
        with pytest.raises(HTTPException):
            await consume_magic_link_token(_link(regular_user.email, org.id, tid=api_token.id), db)

    async def test_unreadable_expiry_refused(self, db, org, admin_user, regular_user):
        api_token = await _api_token(db, org, admin_user, expires_at="not a date")
        with pytest.raises(HTTPException):
            await consume_magic_link_token(_link(regular_user.email, org.id, tid=api_token.id), db)

    async def test_lapsed_plan_refused(self, db, org, admin_user, regular_user):
        api_token = await _api_token(db, org, admin_user)
        with patch(
            "src.services.api_tokens.api_tokens._require_api_access_plan",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=403, detail="plan"),
        ):
            with pytest.raises(HTTPException) as exc:
                await consume_magic_link_token(_link(regular_user.email, org.id, tid=api_token.id), db)
        assert exc.value.status_code == 410

    async def test_creator_left_org_refused(self, db, org, admin_user, regular_user):
        api_token = await _api_token(db, org, admin_user)
        with patch("src.services.api_tokens.api_tokens.is_org_member", new_callable=AsyncMock, return_value=False):
            with pytest.raises(HTTPException):
                await consume_magic_link_token(_link(regular_user.email, org.id, tid=api_token.id), db)

    async def test_unknown_or_malformed_token_id_refused(self, db, org, regular_user):
        for tid in (999999, "1"):
            with pytest.raises(HTTPException):
                await consume_magic_link_token(
                    _link(regular_user.email, org.id, tid=tid, jti=f"jti-{tid}"), db
                )

    async def test_token_of_another_org_refused(self, db, org, other_org, admin_user, regular_user):
        api_token = await _api_token(db, other_org, admin_user)
        with pytest.raises(HTTPException):
            await consume_magic_link_token(_link(regular_user.email, org.id, tid=api_token.id), db)

    async def test_target_now_beyond_token_rights_refused(self, db, org, admin_user, regular_user):
        # A users-only token may sign in plain learners, not someone whose role
        # now carries write rights the token lacks.
        api_token = await _api_token(db, org, admin_user, rights={"users": {"action_update": True}})
        with patch("src.services.admin.admin._role_within_token_rights", return_value=False):
            with pytest.raises(HTTPException):
                await consume_magic_link_token(_link(regular_user.email, org.id, tid=api_token.id), db)

    async def test_link_without_token_id_still_refuses_admins(self, db, org, admin_user):
        # Links from before tid existed still get every rule that needs no token.
        with pytest.raises(HTTPException) as exc:
            await consume_magic_link_token(_link(admin_user.email, org.id), db)
        assert exc.value.detail["code"] == "MAGIC_LINK_INVALID"

    async def test_link_without_token_id_signs_in_a_learner(self, db, org, regular_user):
        _u, access, _r, _redirect, _mfa = await consume_magic_link_token(
            _link(regular_user.email, org.id), db
        )
        assert access

    async def test_refresh_typed_token_refused(self, db, org, regular_user):
        with pytest.raises(HTTPException) as exc:
            await consume_magic_link_token(_link(regular_user.email, org.id, type="refresh"), db)
        assert exc.value.status_code == 410
        assert (await db.execute(select(UsedLinkToken))).scalars().first() is None


@pytest.mark.asyncio
async def test_issued_link_names_its_token(db, org, admin_user, regular_user, mock_request):
    from src.db.users import APITokenUser
    from src.services.admin.admin import issue_magic_link

    token_user = APITokenUser(id=42, org_id=org.id, rights=FULL_ADMIN_API_RIGHTS)
    with patch(
        "src.services.admin.admin._magic_link_base_url",
        new_callable=AsyncMock,
        return_value="https://acme.example.com",
    ), patch("src.services.admin.admin._check_token_can_impersonate", new_callable=AsyncMock):
        result = await issue_magic_link(
            token_user=token_user, user_id=regular_user.id, redirect_to=None,
            ttl_seconds=300, org_slug=org.slug, request=mock_request, db_session=db,
        )
    assert decode_jwt(result["token"])["tid"] == 42


# ── Link host: an explicit verified custom domain ─────────────────────────────


async def _domain(db, org, name, status="verified"):
    from src.db.custom_domains import CustomDomain

    db.add(CustomDomain(domain=name, org_id=org.id, status=status, domain_uuid=f"domain_{name}"))
    await db.commit()


@pytest.mark.asyncio
class TestExplicitHost:
    """A domain behind a CDN fails the live DNS check, so the integration may
    name one of the org's verified custom domains itself."""

    @pytest.fixture(autouse=True)
    def _plan_includes_custom_domains(self):
        with patch(
            "src.services.orgs.custom_domains._org_plan_includes_custom_domains",
            new_callable=AsyncMock,
            return_value=True,
        ) as plan:
            yield plan

    async def _base(self, org, db, mock_request, host):
        from src.services.admin.admin import _magic_link_base_url

        cfg = MagicMock()
        cfg.hosting_config.ssl = True
        with patch("config.config.get_learnhouse_config", return_value=cfg), patch(
            "src.services.admin.admin.get_org_signup_base_url",
            new_callable=AsyncMock,
            return_value="https://acme.learnhouse.io",
        ):
            return await _magic_link_base_url(org, mock_request, db, host=host)

    async def test_domain_no_longer_on_the_plan_refused(self, org, db, mock_request, _plan_includes_custom_domains):
        await _domain(db, org, "academy.acme.test")
        _plan_includes_custom_domains.return_value = False
        with pytest.raises(HTTPException) as exc:
            await self._base(org, db, mock_request, "academy.acme.test")
        assert exc.value.status_code == 400

    async def test_verified_domain_is_used(self, org, db, mock_request):
        await _domain(db, org, "academy.acme.test")
        assert await self._base(org, db, mock_request, " Academy.Acme.test. ") == "https://academy.acme.test"

    async def test_default_is_the_org_site(self, org, db, mock_request):
        assert await self._base(org, db, mock_request, None) == "https://acme.learnhouse.io"

    async def test_unverified_domain_refused(self, org, db, mock_request):
        await _domain(db, org, "pending.acme.test", status="pending")
        with pytest.raises(HTTPException) as exc:
            await self._base(org, db, mock_request, "pending.acme.test")
        assert exc.value.status_code == 400

    async def test_another_orgs_domain_refused(self, org, other_org, db, mock_request):
        await _domain(db, other_org, "other.example.test")
        with pytest.raises(HTTPException):
            await self._base(org, db, mock_request, "other.example.test")

    async def test_arbitrary_host_refused(self, org, db, mock_request):
        with pytest.raises(HTTPException):
            await self._base(org, db, mock_request, "evil.example")

    async def test_issue_endpoint_passes_it_through(self, db, org, regular_user, mock_request):
        from src.db.users import APITokenUser
        from src.services.admin.admin import issue_magic_link

        await _domain(db, org, "academy.acme.test")
        cfg = MagicMock()
        cfg.hosting_config.ssl = True
        token_user = APITokenUser(id=7, org_id=org.id, rights=FULL_ADMIN_API_RIGHTS)
        with patch("config.config.get_learnhouse_config", return_value=cfg), patch(
            "src.services.admin.admin._check_token_can_impersonate", new_callable=AsyncMock
        ):
            result = await issue_magic_link(
                token_user=token_user, user_id=regular_user.id, redirect_to="/course/a",
                ttl_seconds=300, org_slug=org.slug, request=mock_request, db_session=db,
                host="academy.acme.test",
            )
        assert result["url"].startswith("https://academy.acme.test/auth/magic?token=")
        assert result["url"].endswith("&next=%2Fcourse%2Fa")


# ── Single-use store edge cases ──────────────────────────────────────────────


class _FakeRedis:
    def __init__(self, existing=(), fail=False):
        self.keys = set(existing)
        self.fail = fail

    def exists(self, key):
        if self.fail:
            raise ConnectionError("redis down")
        return key in self.keys

    def set(self, key, value, nx=False, ex=None):
        if self.fail:
            raise ConnectionError("redis down")
        if nx and key in self.keys:
            return None
        self.keys.add(key)
        return True


@pytest.mark.asyncio
class TestRedeemLinkToken:
    async def test_link_spent_on_an_older_pod_is_refused(self, db):
        r = _FakeRedis(existing={"magic_link_used:old"})
        with patch.object(link_tokens, "_legacy_redis", return_value=r):
            assert await redeem_link_token(db, "old", "magic_link", 4102444800) is False

    async def test_redemption_is_announced_to_older_pods(self, db):
        r = _FakeRedis()
        with patch.object(link_tokens, "_legacy_redis", return_value=r):
            assert await redeem_link_token(db, "new", "magic_login", 4102444800) is True
        assert "magic_login_used:new" in r.keys

    async def test_older_pod_claiming_it_mid_redemption_wins(self, db):
        # The older pod's SETNX landed between our check and our claim: it
        # already handed out a session, so this redemption must refuse.
        class _Racy(_FakeRedis):
            def exists(self, key):
                found = key in self.keys
                self.keys.add(key)  # the older pod claims it right after our check
                return found

        with patch.object(link_tokens, "_legacy_redis", return_value=_Racy()):
            assert await redeem_link_token(db, "racy", "magic_link", 4102444800) is False

    async def test_redis_failures_never_decide_the_outcome(self, db):
        r = _FakeRedis(fail=True)
        with patch.object(link_tokens, "_legacy_redis", return_value=r):
            assert await redeem_link_token(db, "j", "magic_link", 4102444800) is True
            assert await redeem_link_token(db, "j", "magic_link", 4102444800) is False

    async def test_purposes_without_a_legacy_marker_skip_redis(self, db):
        r = MagicMock()
        with patch.object(link_tokens, "_legacy_redis", return_value=r):
            assert await redeem_link_token(db, "m", "mfa_pending", 4102444800) is True
        r.exists.assert_not_called()
        r.set.assert_not_called()

    async def test_replay_does_not_write(self, db):
        assert await redeem_link_token(db, "once", "magic_link", 4102444800) is True
        with patch.object(db, "add") as add:
            assert await redeem_link_token(db, "once", "magic_link", 4102444800) is False
        add.assert_not_called()

    async def test_lost_race_is_a_reuse(self, db):
        with patch.object(db, "commit", side_effect=IntegrityError("x", {}, Exception())):
            assert await redeem_link_token(db, "race", "magic_link", 4102444800) is False

    async def test_failing_rollback_keeps_the_answer(self, db):
        with patch.object(db, "commit", side_effect=RuntimeError("db down")), patch.object(
            db, "rollback", side_effect=RuntimeError("still down")
        ):
            with pytest.raises(HTTPException) as exc:
                await redeem_link_token(db, "r", "magic_link", 4102444800)
        assert exc.value.status_code == 503
        with patch.object(db, "commit", side_effect=IntegrityError("x", {}, Exception())), patch.object(
            db, "rollback", side_effect=RuntimeError("still down")
        ):
            assert await redeem_link_token(db, "r2", "magic_link", 4102444800) is False


@pytest.mark.asyncio
async def test_spending_a_pending_token_without_jti_fails(db):
    from src.services.auth.session import spend_mfa_pending_token

    token = create_access_token(
        data={"sub": "a@b.co", "purpose": "mfa_pending"}, expires_delta=timedelta(minutes=5)
    )
    assert await spend_mfa_pending_token(db, token) is False
