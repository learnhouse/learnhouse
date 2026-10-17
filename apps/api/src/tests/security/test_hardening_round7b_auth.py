"""Auth / session / API-token hardening (sweep 7b).

Covers: the session epoch stamped on account creation and email change, API
token rights capped by the creator's current role, token regeneration and
rights-shape checks, custom-domain sessions bound to their org, full session
rotation on 2FA changes, verify-email sign-in gates, the demo guard on the org
security policy, the resource authorization probe, rights-based org email
redaction in /users/session, and SSO link removal on a Google claim.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import jwt
import pytest
from fastapi import FastAPI, HTTPException, Request, Response
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.api_tokens import APIToken
from src.db.custom_domains import CustomDomain
from src.db.organizations import Organization
from src.db.roles import Role
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, User, UserRead, UserUpdate
from src.security.auth import create_access_token
from src.security.security import ALGORITHM, SECRET_KEY
from src.security.session_context import (
    AUTH_METHOD_PASSWORD,
    CUSTOM_DOMAIN_CLAIM,
    LEGACY_GRACE_CLAIM,
    SORG_CLAIM,
    SessionProvenance,
    carry_session_claims,
    get_session_provenance,
    session_claims,
    set_session_provenance,
)
from src.tests.conftest import ADMIN_RIGHTS, USER_RIGHTS

NOW = str(datetime.now())


def _claims(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


def _config(tenancy: str = "multi"):
    return SimpleNamespace(
        hosting_config=SimpleNamespace(
            tenancy=tenancy,
            domain="learnhouse.test",
            cookie_config=SimpleNamespace(domain=".learnhouse.test"),
        )
    )


def _request(headers: dict | None = None, method: str = "POST") -> Request:
    return Request({
        "type": "http", "method": method, "path": "/", "query_string": b"",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
    })


async def _custom_domain(db, org_id: int, domain: str = "academy.example.com", status="verified"):
    db.add(CustomDomain(
        domain=domain, domain_uuid=f"domain_{domain}", org_id=org_id, status=status,
        creation_date=NOW, update_date=NOW,
    ))
    await db.commit()


async def _set_superadmin(db, user_id: int, value: bool = True):
    row = (await db.execute(select(User).where(User.id == user_id))).scalars().first()
    row.is_superadmin = value
    db.add(row)
    await db.commit()
    db._superadmin_cache = {}


@pytest.fixture(autouse=True)
def _reset_provenance():
    set_session_provenance(None)
    yield
    set_session_provenance(None)


# -- 1. Session epoch ---------------------------------------------------------


class TestSessionEpoch:
    def test_epoch_is_whole_seconds(self):
        from src.services.users.users import _session_epoch_now

        stamp = _session_epoch_now()
        assert stamp.microsecond == 0 and stamp.tzinfo is None

    async def test_signup_stamps_epoch_so_old_tokens_for_the_address_die(
        self, mock_request, db, org, anonymous_user
    ):
        from src.db.users import UserCreate
        from src.security.auth import get_current_user
        from src.services.users.users import create_user, create_user_without_org

        stale = create_access_token({"sub": "reused@test.com"})
        payload = _claims(stale)
        payload["iat"] = payload["iat"] - 60
        stale = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

        with patch("src.services.users.users.rbac_check", new_callable=AsyncMock), patch(
            "src.services.users.users.check_limits_with_usage", new_callable=AsyncMock
        ), patch("src.services.users.users.increase_feature_usage", new_callable=AsyncMock), patch(
            "src.services.users.users.track", new_callable=AsyncMock
        ), patch("src.services.users.users.dispatch_webhooks", new_callable=AsyncMock), patch(
            "src.services.users.users.send_account_creation_email"
        ), patch("src.services.users.users.get_deployment_mode", return_value="oss"), patch(
            "src.services.users.users._get_welcome_cta_url", new_callable=AsyncMock, return_value="/"
        ):
            await create_user(
                mock_request, db, anonymous_user,
                UserCreate(username="reused", email="reused@test.com", password="Password123!"),
                org.id,
            )
            await create_user_without_org(
                mock_request, db, anonymous_user,
                UserCreate(username="orgless", email="orgless@test.com", password="Password123!"),
            )

        for email in ("reused@test.com", "orgless@test.com"):
            row = (await db.execute(select(User).where(User.email == email))).scalars().first()
            assert row.password_changed_at is not None

        with pytest.raises(HTTPException) as exc:
            await get_current_user(_request({"authorization": f"Bearer {stale}"}), db)
        assert exc.value.status_code == 401

    async def test_email_change_stamps_epoch(self, mock_request, db, regular_user):
        from src.services.users.users import update_user

        with patch("src.services.users.users.rbac_check", new_callable=AsyncMock), patch(
            "src.services.users.users._require_reauth_for_email_change", new_callable=AsyncMock
        ), patch("src.services.users.users._after_email_change", new_callable=AsyncMock):
            await update_user(
                mock_request, db, regular_user.id, regular_user,
                UserUpdate(
                    username=regular_user.username, first_name="R", last_name="U",
                    email="moved@test.com",
                ),
            )
        row = (await db.execute(select(User).where(User.id == regular_user.id))).scalars().first()
        assert row.email == "moved@test.com"
        assert row.password_changed_at is not None
        assert row.email_verified is False


# -- 2. API tokens --------------------------------------------------------------


def _token_rights(**grants) -> dict:
    empty = {"action_create": False, "action_read": False, "action_update": False, "action_delete": False}
    rights = {
        b: dict(empty)
        for b in ("courses", "activities", "coursechapters", "folders", "media",
                  "certifications", "usergroups", "payments", "search")
    }
    for bucket, perms in grants.items():
        rights.setdefault(bucket, dict(empty)).update(perms)
    return rights


async def _api_token(db, org_id, creator_id, rights, prefix="lh_sweep7b00"):
    from src.services.api_tokens.api_tokens import hash_token

    full = prefix + "x" * 20
    token = APIToken(
        token_uuid=f"apitoken_{prefix}", name=prefix, token_prefix=full[:12],
        token_hash=hash_token(full), org_id=org_id, rights=rights,
        created_by_user_id=creator_id, creation_date=NOW, update_date=NOW, is_active=True,
    )
    db.add(token)
    await db.commit()
    await db.refresh(token)
    return full, token


class TestCapTokenRights:
    def test_caps_by_role_and_token_only_buckets(self):
        from src.services.api_tokens.api_tokens import cap_token_rights

        role = Role(id=4, name="User", rights=USER_RIGHTS.model_dump())
        capped = cap_token_rights(
            _token_rights(
                courses={"action_read": True, "action_update": True},
                search={"action_read": True},
                payments={"action_update": True},
                folders={"action_read": 1},
            )
            | {"unknown": {"action_read": True}, "junk": True},
            role,
        )
        assert capped["courses"]["action_read"] is True
        assert capped["courses"]["action_update"] is False
        # Token-only buckets follow the role bucket that caps them.
        assert capped["search"]["action_read"] is True
        assert capped["payments"]["action_update"] is False
        # A non-bool flag never survives, nor a bucket the role has no cap for.
        assert capped["folders"]["action_read"] is False
        assert capped["unknown"]["action_read"] is False
        assert capped["junk"] == {}

    def test_role_without_rights_object(self):
        from src.db.roles import Rights
        from src.services.api_tokens.api_tokens import cap_token_rights

        rights = _token_rights(courses={"action_create": True})
        assert cap_token_rights(rights, Role(id=1, name="Admin", rights={}))["courses"]["action_create"] is True
        assert cap_token_rights(rights, Role(id=4, name="User", rights={}))["courses"]["action_create"] is False
        assert cap_token_rights(rights, None)["courses"]["action_create"] is False
        # Rights models are accepted on either side.
        assert cap_token_rights(ADMIN_RIGHTS, Role(id=1, name="Admin", rights=ADMIN_RIGHTS))[
            "courses"]["action_create"] is True
        assert isinstance(ADMIN_RIGHTS, Rights)

    def test_rights_dict_normalizes_models(self):
        from src.db.roles import Permission
        from src.services.api_tokens.api_tokens import _rights_dict

        perm = Permission(action_create=True, action_read=True, action_update=False, action_delete=False)
        assert _rights_dict(None) == {}
        assert _rights_dict({"media": perm})["media"]["action_create"] is True


class TestTokenRightsAtAuthTime:
    async def test_demoted_creator_token_loses_rights(self, db, org, admin_user, user_role):
        from src.security.auth import validate_api_token
        from src.services.api_tokens.api_tokens import validate_api_token_for_auth

        full, row = await _api_token(
            db, org.id, admin_user.id,
            _token_rights(courses={"action_read": True, "action_update": True}),
        )
        with patch("src.services.api_tokens.api_tokens._require_api_access_plan", new_callable=AsyncMock):
            # Still an admin: the stored row comes back untouched.
            assert await validate_api_token_for_auth(full, db) is row

            membership = (await db.execute(
                select(UserOrganization).where(UserOrganization.user_id == admin_user.id)
            )).scalars().first()
            membership.role_id = user_role.id
            db.add(membership)
            await db.commit()

            capped = await validate_api_token_for_auth(full, db)
            principal = await validate_api_token(full, db)

        assert capped is not row
        assert capped.rights["courses"]["action_update"] is False
        assert capped.rights["courses"]["action_read"] is True
        assert principal.rights["courses"]["action_update"] is False
        # The stored row keeps what the admin granted.
        await db.refresh(row)
        assert row.rights["courses"]["action_update"] is True

    async def test_live_token_lookup_is_capped_too(self, db, org, regular_user):
        from src.services.api_tokens.api_tokens import get_live_api_token

        _full, row = await _api_token(
            db, org.id, regular_user.id, _token_rights(users={"action_update": True}),
            prefix="lh_sweep7b01",
        )
        with patch("src.services.api_tokens.api_tokens._require_api_access_plan", new_callable=AsyncMock):
            live = await get_live_api_token(row.id, db)
            with patch(
                "src.services.api_tokens.api_tokens._api_token_is_live",
                new_callable=AsyncMock, return_value=False,
            ):
                assert await get_live_api_token(row.id, db) is None
            with patch(
                "src.services.api_tokens.api_tokens._api_token_is_live",
                new_callable=AsyncMock, side_effect=HTTPException(status_code=403),
            ):
                assert await get_live_api_token(row.id, db) is None
        assert live.rights["users"]["action_update"] is False

    async def test_rightless_token_is_returned_as_is(self, db):
        from src.services.api_tokens.api_tokens import _with_creator_capped_rights

        row = SimpleNamespace(rights=None)
        assert await _with_creator_capped_rights(row, db) is row


class TestRegenerateApiToken:
    async def _regen(self, db, org, caller, token_uuid):
        from src.services.api_tokens.api_tokens import regenerate_api_token

        with patch(
            "src.services.api_tokens.api_tokens.require_org_role_permission", new_callable=AsyncMock
        ):
            return await regenerate_api_token(Mock(), db, org.id, token_uuid, caller)

    async def test_only_creator_or_rights_holder(self, db, org, admin_user, regular_user):
        _f, admin_token = await _api_token(
            db, org.id, admin_user.id, _token_rights(courses={"action_delete": True}),
            prefix="lh_sweep7b02",
        )
        _f, reader_token = await _api_token(
            db, org.id, admin_user.id, _token_rights(courses={"action_read": True}),
            prefix="lh_sweep7b03",
        )
        with pytest.raises(HTTPException) as exc:
            await self._regen(db, org, regular_user, admin_token.token_uuid)
        assert exc.value.status_code == 403

        # A token whose rights the caller holds anyway, the creator, a superadmin.
        assert (await self._regen(db, org, regular_user, reader_token.token_uuid)).token
        assert (await self._regen(db, org, admin_user, admin_token.token_uuid)).token
        await _set_superadmin(db, regular_user.id)
        assert (await self._regen(db, org, regular_user, admin_token.token_uuid)).token


class TestRightsShape:
    async def test_non_bool_flags_are_rejected(self):
        from src.services.api_tokens.api_tokens import validate_rights_structure

        with pytest.raises(HTTPException) as exc:
            await validate_rights_structure(
                _token_rights(courses={"action_create": "yes"}), ADMIN_RIGHTS.model_dump()
            )
        assert exc.value.status_code == 400
        assert "boolean" in exc.value.detail

    async def test_required_bucket_must_be_an_object(self):
        from src.services.api_tokens.api_tokens import validate_rights_structure

        rights = _token_rights()
        rights["media"] = True
        with pytest.raises(HTTPException) as exc:
            await validate_rights_structure(rights, ADMIN_RIGHTS.model_dump())
        assert exc.value.status_code == 400

    async def test_extra_non_object_bucket_is_left_alone(self):
        from src.services.api_tokens.api_tokens import validate_rights_structure

        await validate_rights_structure(
            _token_rights() | {"assignments": True}, USER_RIGHTS.model_dump()
        )


# -- 3. Custom-domain sessions ----------------------------------------------------


class TestSessionClaims:
    def test_custom_domain_claim_needs_an_org(self):
        assert session_claims("password", 3, custom_domain=True)[CUSTOM_DOMAIN_CLAIM] is True
        assert CUSTOM_DOMAIN_CLAIM not in session_claims("password", None, custom_domain=True)
        assert CUSTOM_DOMAIN_CLAIM not in session_claims("password", 3)

    def test_rotation_carries_the_binding(self):
        carried = carry_session_claims({"amr": "password", SORG_CLAIM: 3, CUSTOM_DOMAIN_CLAIM: True})
        assert carried[CUSTOM_DOMAIN_CLAIM] is True
        assert CUSTOM_DOMAIN_CLAIM not in carry_session_claims({"amr": "password", SORG_CLAIM: 3})

    async def test_get_current_user_publishes_binding(self, db, regular_user):
        from src.security.auth import get_current_user

        token = create_access_token({
            "sub": regular_user.email, "purpose": "session",
            **session_claims("password", 1, custom_domain=True),
        })
        await get_current_user(_request({"authorization": f"Bearer {token}"}), db)
        provenance = get_session_provenance()
        assert provenance.custom_domain is True and provenance.org_id == 1

    def test_pending_and_minted_tokens_carry_binding(self):
        from src.services.auth.session import (
            create_mfa_pending_token,
            decode_mfa_pending_custom_domain,
            mint_session_tokens,
        )

        assert decode_mfa_pending_custom_domain(create_mfa_pending_token("a@test.com", "password", 2, True))
        assert not decode_mfa_pending_custom_domain(create_mfa_pending_token("a@test.com", "password", 2))
        minted = mint_session_tokens("a@test.com", "password", 2, True)
        assert _claims(minted.access_token)[CUSTOM_DOMAIN_CLAIM] is True
        assert _claims(minted.refresh_token)[CUSTOM_DOMAIN_CLAIM] is True

    async def test_issue_passes_binding_on_both_branches(self, db):
        from src.services.auth.session import issue_session_or_challenge

        user = SimpleNamespace(id=5, email="a@test.com")
        with patch("src.services.auth.session.is_mfa_active", new_callable=AsyncMock, return_value=True):
            pending = await issue_session_or_challenge(db, user, "password", 2, custom_domain=True)
        with patch("src.services.auth.session.is_mfa_active", new_callable=AsyncMock, return_value=False):
            live = await issue_session_or_challenge(db, user, "password", 2, custom_domain=True)
        assert _claims(pending.mfa_token)[CUSTOM_DOMAIN_CLAIM] is True
        assert _claims(live.access_token)[CUSTOM_DOMAIN_CLAIM] is True


class TestDomainBoundPolicy:
    async def test_bound_session_only_reaches_its_org(self, db, org, other_org, regular_user):
        from src.services.orgs.auth_policy import SESSION_NOT_BOUND_CODE, evaluate_org_auth

        set_session_provenance(SessionProvenance(amr="password", org_id=org.id, custom_domain=True))
        assert await evaluate_org_auth(db, regular_user.id, org.id) is None
        block = await evaluate_org_auth(db, regular_user.id, other_org.id)
        assert block == {"code": SESSION_NOT_BOUND_CODE}

    async def test_unbound_session_keeps_default_sharing(self, db, org, other_org, regular_user):
        from src.services.orgs.auth_policy import evaluate_org_auth

        set_session_provenance(SessionProvenance(amr="password", org_id=org.id))
        assert await evaluate_org_auth(db, regular_user.id, other_org.id) is None

    async def test_bound_session_lists_other_org_as_a_visitor(
        self, db, org, other_org, regular_user, mock_request
    ):
        from src.db.courses.courses import Course
        from src.services.courses.courses import get_courses_orgslug, search_courses
        from src.services.search.search import search_across_org

        db.add(UserOrganization(
            user_id=regular_user.id, org_id=other_org.id, role_id=4, creation_date=NOW, update_date=NOW,
        ))
        db.add(Course(
            name="Members Only", description="hidden", public=False, published=True,
            open_to_contributors=False, org_id=other_org.id, course_uuid="course_members_only",
            creation_date=NOW, update_date=NOW,
        ))
        await db.commit()

        async def visible():
            db._auth_policy_cache = {}  # memoized per request; provenance changes here
            listed = await get_courses_orgslug(mock_request, regular_user, other_org.slug, db)
            found = await search_courses(mock_request, regular_user, other_org.slug, "Members", db)
            searched = await search_across_org(mock_request, regular_user, other_org.slug, "Members", db)
            return [
                [c.course_uuid for c in listed],
                [c.course_uuid for c in found],
                [c.course_uuid for c in searched.courses],
            ]

        set_session_provenance(SessionProvenance(amr="password", org_id=org.id))
        assert await visible() == [["course_members_only"]] * 3

        set_session_provenance(SessionProvenance(amr="password", org_id=org.id, custom_domain=True))
        assert await visible() == [[], [], []]

        # Its own org still lists as a member.
        set_session_provenance(SessionProvenance(amr="password", org_id=other_org.id, custom_domain=True))
        assert await visible() == [["course_members_only"]] * 3

    async def test_viewer_for_org_keeps_machine_and_anonymous_callers(self, db, other_org):
        from src.db.users import APITokenUser
        from src.services.orgs.auth_policy import viewer_for_org

        set_session_provenance(SessionProvenance(amr="password", org_id=1, custom_domain=True))
        anon = AnonymousUser()
        token = APITokenUser(id=1, user_uuid="t", username="t", org_id=other_org.id, token_name="t", created_by_user_id=1)
        assert await viewer_for_org(db, anon, other_org.id) is anon
        assert await viewer_for_org(db, token, other_org.id) is token
        nobody = SimpleNamespace(id=None)
        assert await viewer_for_org(db, nobody, other_org.id) is nobody


class TestCustomDomainDetection:
    async def test_custom_domain_org_id(self, db, org):
        from src.routers.auth import _request_hostname, custom_domain_org_id

        await _custom_domain(db, org.id)
        assert _request_hostname(_request()) is None
        with patch("src.routers.auth.get_learnhouse_config", return_value=_config()):
            assert await custom_domain_org_id(_request({"origin": "https://Academy.example.com"}), db) == org.id
            assert await custom_domain_org_id(_request({"origin": "https://other.example.com"}), db) is None
            assert await custom_domain_org_id(_request({"origin": "https://org.learnhouse.test"}), db) is None
            assert await custom_domain_org_id(_request({"origin": "http://localhost:3000"}), db) is None
            assert await custom_domain_org_id(_request(), db) is None
        with patch("src.routers.auth.get_learnhouse_config", return_value=_config("single")):
            assert await custom_domain_org_id(_request({"origin": "https://academy.example.com"}), db) is None

    async def test_proxied_sign_in_uses_the_client_host(self, db, org):
        from src.routers.auth import _request_hostname, custom_domain_org_id

        await _custom_domain(db, org.id)
        proxied = _request({"host": "api.internal:9000", "x-learnhouse-client-host": "academy.example.com"})
        with patch("src.routers.auth.get_learnhouse_config", return_value=_config()):
            assert await custom_domain_org_id(proxied, db) == org.id
        # The cookie-scope resolver keeps ignoring it.
        assert _request_hostname(proxied) == "api.internal"

    async def test_unproven_claim_does_not_bind(self, db, org):
        from src.routers.auth import custom_domain_org_id

        await _custom_domain(db, org.id, "pending.example.com", status="pending")
        await _custom_domain(db, org.id, "live.example.com", status="active")
        with patch("src.routers.auth.get_learnhouse_config", return_value=_config()):
            assert await custom_domain_org_id(_request({"origin": "https://pending.example.com"}), db) is None
            assert await custom_domain_org_id(_request({"origin": "https://live.example.com"}), db) == org.id

    async def test_cookie_domain_without_headers_is_shared(self):
        from src.routers.auth import get_cookie_domain_for_request

        with patch("src.routers.auth.get_learnhouse_config", return_value=_config()):
            assert get_cookie_domain_for_request(_request()) == ".learnhouse.test"

    async def test_bind_session(self, db, org, other_org, regular_user):
        from src.routers.auth import _bind_session_to_custom_domain

        await _custom_domain(db, org.id)
        custom = _request({"origin": "https://academy.example.com"})
        with patch("src.routers.auth.get_learnhouse_config", return_value=_config()):
            assert await _bind_session_to_custom_domain(
                _request({"origin": "https://org.learnhouse.test"}), db, regular_user.id, other_org.id, "password"
            ) == (other_org.id, False)
            assert await _bind_session_to_custom_domain(
                custom, db, regular_user.id, org.id, "password"
            ) == (org.id, True)
            with patch(
                "src.services.orgs.auth_policy.enforce_login_auth_method", new_callable=AsyncMock
            ) as enforce:
                assert await _bind_session_to_custom_domain(
                    custom, db, regular_user.id, None, "password"
                ) == (org.id, True)
            enforce.assert_awaited_once_with(db, org.id, "password")

            await _set_superadmin(db, regular_user.id)
            with pytest.raises(HTTPException) as exc:
                await _bind_session_to_custom_domain(custom, db, regular_user.id, org.id, "password")
        assert exc.value.detail["code"] == "PLATFORM_SIGN_IN_REQUIRED"


@pytest.fixture
def auth_app(db):
    from src.routers.auth import router as auth_router
    from src.routers.mfa import router as mfa_router
    from src.security.auth import get_current_user

    app = FastAPI()
    app.include_router(auth_router, prefix="/api/v1/auth")
    app.include_router(mfa_router, prefix="/api/v1/auth")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
    yield app
    app.dependency_overrides.clear()


async def _post(app, path, **kwargs):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.post(path, **kwargs)


ORIGIN = {"origin": "https://academy.example.com"}


class TestCustomDomainSignIn:
    async def test_password_login_binds_session_and_refuses_superadmin(
        self, auth_app, db, org, other_org, regular_user
    ):
        await _custom_domain(db, org.id)
        user = (await db.execute(select(User).where(User.id == regular_user.id))).scalars().first()
        with patch("src.routers.auth.get_learnhouse_config", return_value=_config()), patch(
            "src.routers.auth.check_login_rate_limit", return_value=(True, None)
        ), patch("src.routers.auth.authenticate_user", new_callable=AsyncMock, return_value=user), patch(
            "src.routers.auth.get_deployment_mode", return_value="oss"
        ), patch("src.routers.auth.record_audit_event", new_callable=AsyncMock):
            ok = await _post(
                auth_app, "/api/v1/auth/login", headers=ORIGIN,
                data={"username": user.email, "password": "pw", "org_slug": other_org.slug},
            )
            await _set_superadmin(db, regular_user.id)
            refused = await _post(
                auth_app, "/api/v1/auth/login", headers=ORIGIN,
                data={"username": user.email, "password": "pw"},
            )
        assert ok.status_code == 200
        claims = _claims(ok.json()["tokens"]["access_token"])
        assert claims[SORG_CLAIM] == org.id and claims[CUSTOM_DOMAIN_CLAIM] is True
        assert refused.status_code == 403
        assert refused.json()["detail"]["code"] == "PLATFORM_SIGN_IN_REQUIRED"

    async def test_google_and_magic_link_bind_session(self, auth_app, db, org, regular_user):
        await _custom_domain(db, org.id)
        user_read = UserRead.model_validate(
            (await db.execute(select(User).where(User.id == regular_user.id))).scalars().first()
        )
        with patch("src.routers.auth.get_learnhouse_config", return_value=_config()), patch(
            "src.routers.auth.signWithGoogle", new_callable=AsyncMock, return_value=user_read
        ), patch(
            "src.services.auth.magic_login.consume_magic_login_token",
            new_callable=AsyncMock, return_value=(regular_user.email, org.id),
        ), patch("src.routers.auth.update_login_info", new_callable=AsyncMock):
            google = await _post(
                auth_app, "/api/v1/auth/oauth", headers=ORIGIN,
                json={"email": regular_user.email, "provider": "google", "access_token": "t"},
            )
            magic = await _post(
                auth_app, "/api/v1/auth/magic-link/verify", headers=ORIGIN, json={"token": "x"},
            )
        for response in (google, magic):
            assert response.status_code == 200, response.text
            claims = _claims(response.json()["tokens"]["access_token"])
            assert claims[SORG_CLAIM] == org.id and claims[CUSTOM_DOMAIN_CLAIM] is True

    async def test_mfa_completion_keeps_binding(self, auth_app, db, org, regular_user):
        from src.services.auth.session import create_mfa_pending_token

        pending = create_mfa_pending_token(regular_user.email, AUTH_METHOD_PASSWORD, org.id, True)
        with patch("src.routers.mfa.check_rate_limit", return_value=(True, 0, None)):
            response = await _post(
                auth_app, "/api/v1/auth/login/mfa", json={"mfa_token": pending, "code": "123456"},
            )
        assert response.status_code == 200, response.text
        assert _claims(response.json()["tokens"]["access_token"])[CUSTOM_DOMAIN_CLAIM] is True


# -- 4. 2FA changes rotate every session ---------------------------------------------


class TestMfaRotatesSessions:
    def test_rotation_revokes_all_and_reissues_with_same_provenance(self):
        from src.routers.mfa import _rotate_sessions

        old = create_access_token({
            "sub": "a@test.com", "purpose": "session",
            **session_claims("password", 4, custom_domain=True),
        })
        response = Response()
        with patch("src.routers.mfa.revoke_user_sessions_before") as revoke:
            tokens = _rotate_sessions(
                _request({"authorization": f"Bearer {old}"}), response,
                SimpleNamespace(id=9, email="a@test.com"),
            )
        revoke.assert_called_once_with(9)
        claims = _claims(tokens["access_token"])
        assert claims["amr"] == "password" and claims[SORG_CLAIM] == 4
        assert claims[CUSTOM_DOMAIN_CLAIM] is True
        assert _claims(tokens["refresh_token"])["type"] == "refresh"
        assert "LH_access=" in response.headers.get("set-cookie", "")

    def test_rotation_of_a_methodless_session_keeps_its_grace(self):
        from src.routers.mfa import _rotate_sessions

        with patch("src.routers.mfa.revoke_user_sessions_before"):
            tokens = _rotate_sessions(_request(), Response(), SimpleNamespace(id=9, email="a@test.com"))
        assert LEGACY_GRACE_CLAIM in _claims(tokens["access_token"])

    async def test_confirm_and_disable_return_fresh_tokens(self, db, regular_user):
        import time

        import pyotp
        from src.db.user_mfa import UserMFA
        from src.routers.mfa import router as mfa_router
        from src.security.auth import get_authenticated_user
        from src.services.auth.mfa import TOTP_PERIOD_SECONDS, encrypt_secret, generate_totp_secret

        secret = generate_totp_secret()
        db.add(UserMFA(
            user_id=regular_user.id, secret_encrypted=encrypt_secret(secret),
            creation_date=NOW, update_date=NOW,
        ))
        await db.commit()
        code = pyotp.TOTP(secret, interval=TOTP_PERIOD_SECONDS).at(int(time.time()))

        app = FastAPI()
        app.include_router(mfa_router, prefix="/api/v1/auth")
        app.dependency_overrides[get_db_session] = lambda: db
        app.dependency_overrides[get_authenticated_user] = lambda: regular_user
        with patch("src.routers.mfa.check_rate_limit", return_value=(True, 0, None)), patch(
            "src.routers.mfa.security_verify_password", return_value=True
        ), patch("src.routers.mfa.revoke_user_sessions_before") as revoke, patch(
            "src.routers.mfa.verify_and_consume_totp", new=AsyncMock(return_value=True)
        ):
            confirmed = await _post(app, "/api/v1/auth/mfa/confirm", json={"code": code})
            disabled = await _post(app, "/api/v1/auth/mfa/disable", json={"password": "pw", "code": code})
        assert confirmed.status_code == 200 and disabled.status_code == 200
        assert confirmed.json()["tokens"]["access_token"]
        assert disabled.json()["tokens"]["refresh_token"]
        assert revoke.call_count == 2
        assert all(call.args == (regular_user.id,) for call in revoke.call_args_list)


# -- 5. Verify-email sign-in gates ----------------------------------------------------


class TestVerifyEmailSignInGates:
    async def _verify(self, auth_app, db, user_row, headers=None):
        with patch("src.routers.auth.check_email_verification_rate_limit", return_value=(True, 0)), patch(
            "src.routers.auth.verify_email_token", new_callable=AsyncMock,
            return_value=(user_row, "Email verified"),
        ), patch("src.routers.auth.get_learnhouse_config", return_value=_config()):
            return await _post(
                auth_app, "/api/v1/auth/verify-email", headers=headers or {},
                json={"token": "t", "user_uuid": user_row.user_uuid, "org_uuid": "org_test"},
            )

    async def test_signs_in_when_nothing_refuses(self, auth_app, db, org, regular_user):
        row = (await db.execute(select(User).where(User.id == regular_user.id))).scalars().first()
        response = await self._verify(auth_app, db, row)
        assert response.json()["tokens"]["access_token"]

    async def test_locked_account_is_not_signed_in(self, auth_app, db, org, regular_user):
        row = (await db.execute(select(User).where(User.id == regular_user.id))).scalars().first()
        row.locked_until = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
        response = await self._verify(auth_app, db, row)
        assert response.status_code == 200
        assert response.json() == {"message": "Email verified"}

    async def test_disallowed_method_is_not_signed_in(self, auth_app, db, org, regular_user):
        row = (await db.execute(select(User).where(User.id == regular_user.id))).scalars().first()
        with patch(
            "src.services.orgs.auth_policy.is_login_method_allowed",
            new_callable=AsyncMock, return_value=False,
        ):
            response = await self._verify(auth_app, db, row)
        assert response.json() == {"message": "Email verified"}

    async def test_superadmin_on_custom_domain_is_not_signed_in(self, auth_app, db, org, regular_user):
        await _custom_domain(db, org.id)
        await _set_superadmin(db, regular_user.id)
        row = (await db.execute(select(User).where(User.id == regular_user.id))).scalars().first()
        response = await self._verify(auth_app, db, row, headers=ORIGIN)
        assert response.json() == {"message": "Email verified"}


# -- 6. Demo guard on the org security policy -------------------------------------


class TestOrgPolicyDemoGuard:
    async def test_demo_org_policy_cannot_be_changed(self, db, org, admin_user):
        from src.routers.mfa import router as mfa_router
        from src.security.auth import get_authenticated_user

        org_row = (await db.execute(select(Organization).where(Organization.id == org.id))).scalars().first()
        org_row.is_demo = True
        db.add(org_row)
        await db.commit()

        app = FastAPI()
        app.include_router(mfa_router, prefix="/api/v1/auth")
        app.dependency_overrides[get_db_session] = lambda: db
        app.dependency_overrides[get_authenticated_user] = lambda: admin_user
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            response = await c.put(f"/api/v1/auth/mfa/org-policy/{org.id}", json={"require_2fa": False})
        assert response.status_code == 403


# -- 7. Resource authorization probe ---------------------------------------------------


class TestAuthorizeUserAction:
    async def test_uses_the_resource_checker(self, mock_request, db, regular_user):
        from src.security.rbac.types import AccessDecision
        from src.services.users.users import authorize_user_action

        with patch(
            "src.security.rbac.check_resource_access", new_callable=AsyncMock,
            return_value=AccessDecision(allowed=True, reason="ok"),
        ) as checker:
            assert await authorize_user_action(mock_request, db, regular_user, "course_x", "read") is True
        assert checker.await_args.kwargs["raise_on_deny"] is False

        # Unknown or foreign resources are a plain 403, never a 402 with details.
        with pytest.raises(HTTPException) as exc:
            await authorize_user_action(mock_request, db, regular_user, "course_missing", "read")
        assert exc.value.status_code == 403


# -- 8. Org email in /users/session ----------------------------------------------------


class TestSessionOrgEmail:
    async def test_org_email_follows_the_update_right(self, mock_request, db, org, admin_user, regular_user):
        from src.services.users.users import get_user_session

        org_row = (await db.execute(select(Organization).where(Organization.id == org.id))).scalars().first()
        org_row.email = "owner@test.com"
        db.add(org_row)
        await db.commit()

        admin_session = await get_user_session(mock_request, db, admin_user)
        member_session = await get_user_session(mock_request, db, regular_user)
        assert admin_session.roles[0].org.email == "owner@test.com"
        assert member_session.roles[0].org.email is None


# -- 9. SSO links on a Google claim ------------------------------------------------------


class TestGoogleClaimDropsSsoLinks:
    async def test_hook_is_optional(self, db):
        from src.services.auth.utils import _drop_unverified_sso_links

        with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
            await _drop_unverified_sso_links(1, db)
        with patch("src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace()):
            await _drop_unverified_sso_links(1, db)

    async def test_unverified_account_claimed_by_google_drops_links(self):
        from src.services.auth.utils import signWithGoogle

        hook = AsyncMock()
        user = User(
            id=1, username="u", first_name="", last_name="", email="claimed@test.com",
            password="", user_uuid="user_claimed", email_verified=False, signup_method="sso",
            creation_date=NOW, update_date=NOW,
        )
        db_session = AsyncMock()
        result = Mock()
        result.scalars.return_value.first.return_value = user
        db_session.execute.return_value = result
        db_session.add = Mock()
        with patch(
            "src.services.auth.utils.get_google_user_info",
            return_value={"email": "claimed@test.com", "email_verified": True},
        ), patch("src.services.auth.utils.get_client_ip", return_value="10.0.0.1"), patch(
            "src.services.auth.utils.update_login_info", new_callable=AsyncMock
        ), patch("src.services.auth.utils.record_audit_event", new_callable=AsyncMock), patch(
            "src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace(revoke_unverified_sso_links=hook)
        ):
            await signWithGoogle(Mock(), "t", "claimed@test.com", None, Mock(), db_session)
        hook.assert_awaited_once_with(1, db_session)

    async def test_verified_account_keeps_links(self):
        from src.services.auth.utils import signWithGoogle

        hook = AsyncMock()
        user = User(
            id=1, username="u", first_name="", last_name="", email="owner@test.com",
            password="", user_uuid="user_owner", email_verified=True, signup_method="google",
            creation_date=NOW, update_date=NOW,
        )
        db_session = AsyncMock()
        result = Mock()
        result.scalars.return_value.first.return_value = user
        db_session.execute.return_value = result
        with patch(
            "src.services.auth.utils.get_google_user_info",
            return_value={"email": "owner@test.com", "email_verified": True},
        ), patch("src.services.auth.utils.get_client_ip", return_value="10.0.0.1"), patch(
            "src.services.auth.utils.update_login_info", new_callable=AsyncMock
        ), patch("src.services.auth.utils.record_audit_event", new_callable=AsyncMock), patch(
            "src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace(revoke_unverified_sso_links=hook)
        ):
            await signWithGoogle(Mock(), "t", "owner@test.com", None, Mock(), db_session)
        hook.assert_not_awaited()

