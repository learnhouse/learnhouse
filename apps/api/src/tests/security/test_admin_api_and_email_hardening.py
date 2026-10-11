"""Admin API tokens may only control accounts their org solely owns, and
org/user names never reach an email as links or header breaks."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.organization_config import OrganizationConfig
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, User, UserRead
from src.security.session_context import SessionProvenance, set_session_provenance
from src.services.admin.admin import (
    anonymize_user,
    change_user_role,
    issue_magic_link,
    issue_user_token,
    provision_user,
    remove_user_from_org_admin,
    update_user_profile,
)
from src.services.auth import magic_login as ml
from src.services.email.safe_text import email_org_name, header_safe
from src.services.orgs.auth_policy import SESSION_NOT_BOUND_CODE, evaluate_org_auth
from src.services.orgs.join_notifications import notify_user_joined_org


# Admin API endpoints enforce the token's rights buckets; these fixtures exercise
# the endpoints' own logic, so the token holds every bucket they check.
FULL_ADMIN_API_RIGHTS = {
    bucket: {
        "action_create": True,
        "action_read": True,
        "action_update": True,
        "action_delete": True,
    }
    for bucket in ("users", "roles", "courses", "certifications", "usergroups")
}


@pytest.fixture
def token(org, admin_user):
    return APITokenUser(
        id=1,
        user_uuid="apitoken_hardening",
        username="api_token",
        org_id=org.id,
        rights=FULL_ADMIN_API_RIGHTS,
        token_name="t",
        created_by_user_id=admin_user.id,
    )


@pytest.fixture
def side_effects():
    targets = [
        "dispatch_webhooks", "track", "check_limits_with_usage",
        "increase_feature_usage", "decrease_feature_usage", "notify_user_joined_org",
    ]
    patches = [patch(f"src.services.admin.admin.{t}", new_callable=AsyncMock) for t in targets]
    mocks = {t: p.start() for t, p in zip(targets, patches)}
    yield mocks
    for p in patches:
        p.stop()


async def _member(db, user_id, org_ids, role_id=4, **fields):
    u = User(
        id=user_id,
        username=fields.pop("username", f"u{user_id}"),
        first_name="F",
        last_name="L",
        email=fields.pop("email", f"u{user_id}@example.com"),
        password="hashed",
        user_uuid=f"user_{user_id}",
        email_verified=True,
        **fields,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    for oid in org_ids:
        db.add(UserOrganization(
            user_id=u.id, org_id=oid, role_id=role_id,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
    await db.commit()
    return u


# -- provision_user ------------------------------------------------------------


@pytest.mark.asyncio
class TestProvision:
    async def test_existing_account_is_not_attached(
        self, db, org, other_org, token, user_role, mock_request, side_effects
    ):
        victim = await _member(db, 50, [other_org.id])
        with pytest.raises(HTTPException) as exc:
            await provision_user(
                token, victim.email, "x", "", "", None, user_role.id, mock_request, db
            )
        assert exc.value.status_code == 409
        rows = (await db.execute(
            select(UserOrganization).where(
                UserOrganization.user_id == victim.id,
                UserOrganization.org_id == org.id,
            )
        )).scalars().all()
        assert rows == []
        side_effects["notify_user_joined_org"].assert_not_called()

    @pytest.mark.parametrize("field", ["username", "first_name", "last_name"])
    async def test_url_in_profile_field_rejected(
        self, db, token, user_role, mock_request, side_effects, field
    ):
        names = {"username": "newbie", "first_name": "New", "last_name": "Bie"}
        names[field] = "claim http://evil.com/x"
        with pytest.raises(HTTPException) as exc:
            await provision_user(
                token, "new@example.com", names["username"], names["first_name"],
                names["last_name"], None, user_role.id, mock_request, db,
            )
        assert exc.value.status_code == 400
        assert exc.value.detail["code"] == "PROFILE_FIELD_INVALID"


# -- account edits ---------------------------------------------------------------


@pytest.mark.asyncio
class TestAccountEdits:
    async def test_profile_update_refused_for_multi_org_member(self, db, org, other_org, token):
        shared = await _member(db, 60, [org.id, other_org.id])
        with pytest.raises(HTTPException) as exc:
            await update_user_profile(token, shared.id, {"email": "attacker@evil.test"}, db)
        assert exc.value.status_code == 403

    async def test_profile_update_refused_for_org_admin(self, db, org, token):
        admin = await _member(db, 61, [org.id], role_id=1)
        with pytest.raises(HTTPException) as exc:
            await update_user_profile(token, admin.id, {"first_name": "X"}, db)
        assert exc.value.status_code == 403

    async def test_profile_update_refused_for_superadmin(self, db, org, token):
        sa = await _member(db, 62, [org.id], is_superadmin=True)
        with pytest.raises(HTTPException) as exc:
            await update_user_profile(token, sa.id, {"first_name": "X"}, db)
        assert exc.value.status_code == 403

    async def test_email_change_resets_verification(self, db, org, token):
        member = await _member(db, 63, [org.id])
        result = await update_user_profile(token, member.id, {"email": "moved@example.com"}, db)
        assert result.email == "moved@example.com"
        await db.refresh(member)
        assert member.email_verified is False
        assert member.email_verified_at is None

    async def test_same_email_keeps_verification(self, db, org, token):
        member = await _member(db, 64, [org.id])
        await update_user_profile(token, member.id, {"email": member.email, "first_name": "Y"}, db)
        await db.refresh(member)
        assert member.email_verified is True

    async def test_anonymize_refused_for_multi_org_member(self, db, org, other_org, token, side_effects):
        shared = await _member(db, 65, [org.id, other_org.id])
        with pytest.raises(HTTPException) as exc:
            await anonymize_user(token, shared.id, db)
        assert exc.value.status_code == 403
        await db.refresh(shared)
        assert shared.email == "u65@example.com"

    async def test_role_change_refused_for_maintainer(self, db, org, token, user_role):
        maint = await _member(db, 66, [org.id], role_id=2)
        with pytest.raises(HTTPException) as exc:
            await change_user_role(token, maint.id, user_role.id, db)
        assert exc.value.status_code == 403

    async def test_remove_refused_for_admin(self, db, org, token, side_effects):
        await _member(db, 67, [org.id], role_id=1)
        with pytest.raises(HTTPException) as exc:
            await remove_user_from_org_admin(token, 67, db)
        assert exc.value.status_code == 403


# -- impersonation ----------------------------------------------------------------


@pytest.mark.asyncio
class TestImpersonation:
    async def test_issue_token_refused_for_multi_org_member(self, db, org, other_org, token):
        shared = await _member(db, 70, [org.id, other_org.id])
        with pytest.raises(HTTPException) as exc:
            await issue_user_token(token, shared.id, db)
        assert exc.value.status_code == 403

    async def test_magic_link_refused_for_multi_org_member(
        self, db, org, other_org, token, mock_request
    ):
        shared = await _member(db, 71, [org.id, other_org.id])
        with pytest.raises(HTTPException) as exc:
            await issue_magic_link(token, shared.id, None, 300, org.slug, mock_request, db)
        assert exc.value.status_code == 403

    async def test_issue_token_allowed_for_sole_member(self, db, org, token):
        member = await _member(db, 72, [org.id])
        result = await issue_user_token(token, member.id, db)
        assert result["user_id"] == member.id


# -- session binding for API-token sessions ---------------------------------------


@pytest.mark.asyncio
class TestApiTokenSessionBinding:
    @pytest.fixture(autouse=True)
    def _reset(self):
        set_session_provenance(None)
        yield
        set_session_provenance(None)

    async def _sharing_off(self, db, org_id):
        db.add(OrganizationConfig(
            org_id=org_id,
            config={"config_version": "2.0", "admin_toggles": {"security": {
                "allow_central_session_sharing": False,
            }}},
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        ))
        await db.commit()

    async def test_foreign_org_api_token_session_refused(self, db, org, other_org, regular_user):
        await self._sharing_off(db, org.id)
        set_session_provenance(SessionProvenance(amr="api_token", org_id=other_org.id))
        block = await evaluate_org_auth(db, regular_user.id, org.id)
        assert block == {"code": SESSION_NOT_BOUND_CODE}

    async def test_own_org_api_token_session_allowed(self, db, org, regular_user):
        await self._sharing_off(db, org.id)
        set_session_provenance(SessionProvenance(amr="api_token", org_id=org.id))
        assert await evaluate_org_auth(db, regular_user.id, org.id) is None


# -- email rendering ----------------------------------------------------------------


_HOSTILE_ORG = "Acme http://evil.com/login\r\nBcc: victim@evil.test"


def test_helpers_strip_links_and_breaks():
    cleaned = email_org_name(_HOSTILE_ORG)
    assert "http" not in cleaned and "evil.com" not in cleaned
    assert "\r" not in cleaned and "\n" not in cleaned
    assert header_safe("Hi\r\nBcc: x@y") == "Hi Bcc: x@y"


@pytest.mark.asyncio
async def test_join_email_sanitizes_org_and_user_names(db, org, mock_request):
    org.name = _HOSTILE_ORG
    db.add(org)
    await db.commit()
    user = await _member(db, 80, [], username="bob visit www.evil.com")
    with patch(
        "src.services.email.utils.get_org_signup_base_url",
        new=AsyncMock(return_value="https://acme.test/"),
    ), patch("src.services.users.emails.send_email", return_value=True) as send:
        await notify_user_joined_org(mock_request, db, user, org.id)

    call = send.call_args.kwargs
    for part in (call["subject"], call["body"]):
        assert "evil.com" not in part
    assert "\n" not in call["subject"] and "\r" not in call["subject"]
    assert "Acme" in call["subject"]


def test_magic_link_email_sanitizes_org_and_user_names():
    user = UserRead(
        id=1, username="eve http://evil.com/x", first_name="E", last_name="V",
        email="eve@example.com", user_uuid="user_eve",
    )
    with patch.object(ml, "send_email", return_value=True) as send:
        ml.send_magic_login_email(
            user, "eve@example.com", "https://acme.test", "tok", org_name=_HOSTILE_ORG
        )
    call = send.call_args.kwargs
    assert "evil.com" not in call["subject"]
    assert "\n" not in call["subject"] and "\r" not in call["subject"]
    # The only link in the body is the real login URL.
    assert "evil.com" not in call["body"]
    assert "https://acme.test/auth/magic?token=tok" in call["body"]


def test_send_email_strips_breaks_from_subject():
    from src.services.email import utils as email_utils

    with patch.object(email_utils, "_send_email_resend", return_value=True) as resend, \
            patch.object(email_utils, "_send_email_smtp", return_value=True) as smtp:
        email_utils.send_email(to="a@example.com", subject="Hi\r\nBcc: x@evil.test", body="b")
    sent = (resend.call_args or smtp.call_args).args
    assert sent[2] == "Hi Bcc: x@evil.test"
