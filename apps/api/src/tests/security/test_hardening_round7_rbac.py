"""
RBAC hardening: draft visibility, token create rights, contributor CREATOR
assignment, role rights validation, superadmin token re-check, session org
email, MFA exemption by sign-in method and stale custom-domain claims.
"""

import copy
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select
from starlette.requests import Request

from src.db.courses.courses import Course
from src.db.custom_domains import CustomDomain, CustomDomainCreate
from src.db.podcasts.podcasts import Podcast
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.roles import Role, RoleCreate, RoleTypeEnum, RoleUpdate
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, PublicUser, User
from src.security.auth import validate_superadmin_api_token
from src.security.rbac import AccessAction, check_resource_access
from src.security.session_context import SessionProvenance
from src.services.courses.contributors import update_course_contributor
from src.services.orgs import mfa_policy
from src.services.orgs.custom_domains import add_custom_domain
from src.services.orgs.mfa_policy import OrgMFAPolicy, evaluate_mfa_compliance
from src.services.roles import roles as roles_service
from src.services.roles.roles import create_role, update_role
from src.services.users.users import get_user_session
from src.tests.conftest import ADMIN_RIGHTS, USER_RIGHTS

NOW = str(datetime.now())


def _request() -> Request:
    # Fresh request per call so the per-request access checker cache never
    # carries a decision from one user to another.
    return Request(
        {"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b""}
    )


async def _make_user(db, *, uid, username, org_id=None, role_id=None, **fields) -> PublicUser:
    u = User(
        id=uid,
        username=username,
        first_name=username,
        last_name="User",
        email=f"{username}@test.com",
        password="hashed_password",
        user_uuid=f"user_{username}",
        creation_date=NOW,
        update_date=NOW,
        **fields,
    )
    db.add(u)
    if org_id is not None:
        db.add(UserOrganization(
            user_id=uid, org_id=org_id, role_id=role_id, creation_date=NOW, update_date=NOW,
        ))
    await db.commit()
    return PublicUser(
        id=u.id, username=u.username, first_name=u.first_name, last_name=u.last_name,
        email=u.email, user_uuid=u.user_uuid,
    )


async def _make_role(db, org, *, rid, rights) -> Role:
    r = Role(
        id=rid, name=f"Role {rid}", org_id=org.id, role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid=f"role_{rid}", rights=rights, creation_date=NOW, update_date=NOW,
    )
    db.add(r)
    await db.commit()
    return r


async def _add_author(db, resource_uuid, user_id, authorship=ResourceAuthorshipEnum.CONTRIBUTOR):
    db.add(ResourceAuthor(
        resource_uuid=resource_uuid, user_id=user_id, authorship=authorship,
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date=NOW, update_date=NOW,
    ))
    await db.commit()


async def _read(db, user, uuid) -> bool:
    decision = await check_resource_access(
        _request(), db, user, uuid, AccessAction.READ, raise_on_deny=False
    )
    return decision.allowed


@pytest.fixture
async def draft_course(db, org):
    c = Course(
        id=50, name="Draft", description="d", public=True, published=False,
        open_to_contributors=False, org_id=org.id, course_uuid="course_draft", creation_date=NOW, update_date=NOW,
    )
    db.add(c)
    await db.commit()
    return c


@pytest.fixture
async def draft_podcast(db, org):
    p = Podcast(
        id=50, name="Draft", description="d", public=True, published=False,
        org_id=org.id, podcast_uuid="podcast_draft", creation_date=NOW, update_date=NOW,
    )
    db.add(p)
    await db.commit()
    return p


# ---------------------------------------------------------------------------
# Drafts are not readable through the member role's read right
# ---------------------------------------------------------------------------


class TestDraftReadAccess:
    @pytest.mark.asyncio
    async def test_member_cannot_read_draft_course_or_podcast(
        self, db, regular_user, draft_course, draft_podcast
    ):
        assert not await _read(db, regular_user, draft_course.course_uuid)
        assert not await _read(db, regular_user, draft_podcast.podcast_uuid)

    @pytest.mark.asyncio
    async def test_member_still_reads_published_course(self, db, regular_user, course):
        assert await _read(db, regular_user, course.course_uuid)

    @pytest.mark.asyncio
    async def test_author_and_admin_read_draft(self, db, regular_user, admin_user, draft_course):
        assert await _read(db, admin_user, draft_course.course_uuid)
        await _add_author(db, draft_course.course_uuid, regular_user.id)
        assert await _read(db, regular_user, draft_course.course_uuid)

    @pytest.mark.asyncio
    async def test_role_with_update_right_reads_draft(self, db, org, draft_course):
        editor_role = await _make_role(db, org, rid=60, rights=ADMIN_RIGHTS.model_dump())
        editor = await _make_user(db, uid=20, username="editor", org_id=org.id, role_id=editor_role.id)
        assert await _read(db, editor, draft_course.course_uuid)

    @pytest.mark.asyncio
    async def test_draft_course_activity_unreadable(self, db, org, regular_user, draft_course):
        from src.db.courses.chapters import Chapter

        db.add(Chapter(
            id=50, name="c", description="c", org_id=org.id, course_id=draft_course.id,
            chapter_uuid="chapter_draft", creation_date=NOW, update_date=NOW,
        ))
        await db.commit()
        assert not await _read(db, regular_user, "chapter_draft")


# ---------------------------------------------------------------------------
# API tokens: adding content to an existing resource takes the update right
# ---------------------------------------------------------------------------


def _token(org_id, courses: dict) -> APITokenUser:
    return APITokenUser(id=7, org_id=org_id, rights={"courses": courses}, created_by_user_id=1)


async def _create(db, user, uuid) -> bool:
    decision = await check_resource_access(
        _request(), db, user, uuid, AccessAction.CREATE, raise_on_deny=False
    )
    return decision.allowed


class TestApiTokenCreateOnExisting:
    @pytest.mark.asyncio
    async def test_create_right_alone_cannot_add_to_existing_course(self, db, org, course):
        token = _token(org.id, {"action_create": True, "action_update": False})
        assert not await _create(db, token, course.course_uuid)
        # New top-level courses still only need action_create.
        assert await _create(db, token, "course_x")

    @pytest.mark.asyncio
    async def test_update_right_can_add_to_existing_course(self, db, org, course):
        token = _token(org.id, {"action_create": False, "action_update": True})
        assert await _create(db, token, course.course_uuid)

    @pytest.mark.asyncio
    async def test_object_rights_use_update_right(self, db, org, course):
        token = APITokenUser.model_construct(
            id=7, org_id=org.id, created_by_user_id=1,
            rights=SimpleNamespace(courses=SimpleNamespace(action_create=True, action_update=False)),
        )
        assert not await _create(db, token, course.course_uuid)


# ---------------------------------------------------------------------------
# Contributors: CREATOR is an org admin decision
# ---------------------------------------------------------------------------


class TestContributorCreatorAssignment:
    async def _setup(self, db, org, course, user_role, *, maintainer_role_id=None):
        manager = await _make_user(
            db, uid=30, username="manager", org_id=org.id,
            role_id=maintainer_role_id or user_role.id,
        )
        await _add_author(db, course.course_uuid, manager.id, ResourceAuthorshipEnum.MAINTAINER)
        target = await _make_user(db, uid=31, username="target", org_id=org.id, role_id=user_role.id)
        await _add_author(db, course.course_uuid, target.id)
        return manager, target

    async def _set(self, db, course, caller, target_id, authorship):
        return await update_course_contributor(
            _request(), course.course_uuid, target_id, authorship,
            ResourceAuthorshipStatusEnum.ACTIVE, caller, db,
        )

    @pytest.mark.asyncio
    async def test_course_maintainer_cannot_assign_creator(self, db, org, course, user_role):
        manager, target = await self._setup(db, org, course, user_role)
        with pytest.raises(HTTPException) as exc:
            await self._set(db, course, manager, target.id, ResourceAuthorshipEnum.CREATOR)
        assert exc.value.status_code == 403
        # Lesser roles are still theirs to hand out.
        await self._set(db, course, manager, target.id, ResourceAuthorshipEnum.MAINTAINER)

    @pytest.mark.asyncio
    async def test_org_maintainer_cannot_assign_creator(self, db, org, course, user_role):
        maint_role = await _make_role(db, org, rid=2, rights=ADMIN_RIGHTS.model_dump())
        manager, target = await self._setup(
            db, org, course, user_role, maintainer_role_id=maint_role.id
        )
        with pytest.raises(HTTPException) as exc:
            await self._set(db, course, manager, target.id, ResourceAuthorshipEnum.CREATOR)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_org_admin_can_assign_creator(self, db, org, course, user_role, admin_user):
        _, target = await self._setup(db, org, course, user_role)
        await self._set(db, course, admin_user, target.id, ResourceAuthorshipEnum.CREATOR)
        row = (await db.execute(select(ResourceAuthor).where(
            ResourceAuthor.resource_uuid == course.course_uuid, ResourceAuthor.user_id == target.id,
        ))).scalars().first()
        assert row.authorship == ResourceAuthorshipEnum.CREATOR

    @pytest.mark.asyncio
    async def test_superadmin_can_assign_creator(self, db, org, course, user_role):
        _, target = await self._setup(db, org, course, user_role)
        root = await _make_user(db, uid=32, username="root", is_superadmin=True)
        await self._set(db, course, root, target.id, ResourceAuthorshipEnum.CREATOR)


# ---------------------------------------------------------------------------
# Role rights: every bucket validated, strict booleans, full subset check
# ---------------------------------------------------------------------------


def _rights(base=USER_RIGHTS) -> dict:
    return copy.deepcopy(base.model_dump())


class TestRoleRightsValidation:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("mutate", "detail"),
        [
            (lambda r: r["podcasts"].__setitem__("action_update", 1),
             "Permission 'action_update' for 'podcasts' must be a boolean"),
            # A payload that fits the Rights model is coerced into it (extras
            # dropped); the raw-dict path is the one that needs the checks.
            (lambda r: (r.pop("discussions"), r.__setitem__("houses", {"action_read": True})),
             "Unknown right: houses"),
            (lambda r: (r.pop("discussions"), r["boards"].__setitem__("action_admin", True)),
             "Unknown permission 'action_admin' for 'boards'"),
            (lambda r: r["communities"].pop("action_read"),
             "Missing required permission 'action_read' for 'communities'"),
        ],
    )
    async def test_create_rejects_malformed_buckets(
        self, db, org, admin_user, admin_role, mutate, detail
    ):
        rights = _rights(ADMIN_RIGHTS)
        mutate(rights)
        with patch.object(roles_service, "rbac_check", AsyncMock()):
            with pytest.raises(HTTPException) as exc:
                await create_role(
                    _request(), db, RoleCreate(name="Custom", org_id=org.id, rights=rights), admin_user,
                )
        assert exc.value.status_code == 400
        assert exc.value.detail == detail

    def test_rights_must_be_an_object(self):
        with pytest.raises(HTTPException) as exc:
            roles_service._validate_rights_payload(["courses"])
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_update_cannot_grant_unheld_bucket(self, db, org):
        # Holds roles.update but not podcasts.update: the escalation the old
        # check missed by only looking at bool values in some buckets.
        manager_rights = _rights()
        manager_rights["roles"]["action_update"] = True
        manager_role = await _make_role(db, org, rid=70, rights=manager_rights)
        manager = await _make_user(db, uid=40, username="rolemgr", org_id=org.id, role_id=manager_role.id)
        target = await _make_role(db, org, rid=71, rights=_rights())

        escalated = _rights()
        escalated["podcasts"]["action_update"] = True
        with pytest.raises(HTTPException) as exc:
            await update_role(_request(), db, RoleUpdate(role_id=target.id, rights=escalated), manager)
        assert exc.value.status_code == 403
        assert "'action_update' permission for 'podcasts'" in exc.value.detail

        # Rights it does hold can be granted.
        allowed = _rights()
        allowed["roles"]["action_update"] = True
        updated = await update_role(_request(), db, RoleUpdate(role_id=target.id, rights=allowed), manager)
        assert updated.rights["roles"]["action_update"] is True

    @pytest.mark.asyncio
    async def test_update_without_rights_skips_validation(self, db, org, admin_user, admin_role):
        target = await _make_role(db, org, rid=72, rights=_rights())
        updated = await update_role(_request(), db, RoleUpdate(role_id=target.id, name="Renamed"), admin_user)
        assert updated.name == "Renamed"

    @pytest.mark.asyncio
    async def test_subset_check_handles_model_rights_and_odd_shapes(self, db):
        held = SimpleNamespace(rights=USER_RIGHTS)
        with patch.object(roles_service, "get_user_org_role", AsyncMock(return_value=held)):
            # Non-dict buckets are ignored, read rights the caller holds pass.
            await roles_service._enforce_rights_subset(
                {"courses": {"action_read": True}, "junk": 1}, 1, 1, db, "{perm} {bucket}"
            )
            with pytest.raises(HTTPException):
                await roles_service._enforce_rights_subset(
                    {"courses": {"action_update": True}}, 1, 1, db, "{perm} {bucket}"
                )
        # Empty rights grant nothing, so there is nothing to check.
        await roles_service._enforce_rights_subset({}, 1, 1, db, "{perm} {bucket}")

    @pytest.mark.asyncio
    async def test_caller_without_role_cannot_grant_anything(self, db):
        with patch.object(roles_service, "get_user_org_role", AsyncMock(return_value=None)):
            with pytest.raises(HTTPException):
                await roles_service._enforce_rights_subset(
                    {"courses": {"action_read": True}}, 1, 1, db, "{perm} {bucket}"
                )


# ---------------------------------------------------------------------------
# Superadmin tokens die with their minter's superadmin flag
# ---------------------------------------------------------------------------


class TestSuperadminTokenRecheck:
    def _token_row(self, created_by):
        return SimpleNamespace(id=9, token_uuid="satoken_x", name="ops", created_by_user_id=created_by)

    async def _validate(self, db, row):
        with patch(
            "src.services.api_tokens.superadmin_api_tokens.validate_superadmin_token_for_auth",
            AsyncMock(return_value=row),
        ):
            return await validate_superadmin_api_token("lh_sa_whatever", db)

    @pytest.mark.asyncio
    async def test_token_of_current_superadmin_is_accepted(self, db):
        await _make_user(db, uid=50, username="sa", is_superadmin=True)
        principal = await self._validate(db, self._token_row(50))
        assert principal is not None and principal.created_by_user_id == 50

    @pytest.mark.asyncio
    async def test_token_of_demoted_or_missing_minter_is_refused(self, db):
        await _make_user(db, uid=51, username="demoted", is_superadmin=False)
        assert await self._validate(db, self._token_row(51)) is None
        assert await self._validate(db, self._token_row(999)) is None
        assert await self._validate(db, self._token_row(0)) is None

    @pytest.mark.asyncio
    async def test_unknown_token_is_refused(self, db):
        assert await self._validate(db, None) is None


# ---------------------------------------------------------------------------
# /users/session: org email only for people who can edit the org
# ---------------------------------------------------------------------------


class TestSessionOrgEmail:
    @pytest.mark.asyncio
    async def test_member_does_not_get_org_email(self, db, org, regular_user):
        session = await get_user_session(_request(), db, regular_user)
        assert session.roles[0].org.email is None

    @pytest.mark.asyncio
    async def test_admin_gets_org_email(self, db, org, admin_user):
        session = await get_user_session(_request(), db, admin_user)
        assert session.roles[0].org.email == org.email

    @pytest.mark.asyncio
    async def test_superadmin_member_gets_org_email(self, db, org, user_role):
        sa = await _make_user(
            db, uid=52, username="samember", org_id=org.id, role_id=user_role.id, is_superadmin=True
        )
        session = await get_user_session(_request(), db, sa)
        assert session.roles[0].org.email == org.email


# ---------------------------------------------------------------------------
# MFA policy exemption follows the session's sign-in method
# ---------------------------------------------------------------------------


class TestMfaExemptionBySignInMethod:
    def _exempt(self, signup_method, provenance) -> bool:
        with patch.object(mfa_policy, "get_session_provenance", return_value=provenance):
            return mfa_policy._signed_in_externally(SimpleNamespace(signup_method=signup_method))

    def test_sso_account_signing_in_with_password_is_not_exempt(self):
        assert not self._exempt("sso", SessionProvenance(amr="password"))

    def test_sso_sign_in_is_exempt(self):
        assert self._exempt(None, SessionProvenance(amr="sso"))
        assert self._exempt("password", SessionProvenance(amr="google"))

    def test_unknown_method_falls_back_to_signup_method(self):
        assert self._exempt("google", None)
        assert self._exempt("sso", SessionProvenance(amr=None))
        assert self._exempt("sso", SessionProvenance(amr="api_token"))
        assert not self._exempt("email", None)

    @pytest.mark.asyncio
    async def test_policy_blocks_password_session_of_sso_account(self, db, org, user_role):
        await _make_user(db, uid=53, username="ssouser", org_id=org.id, role_id=user_role.id, signup_method="sso")
        user = (await db.execute(select(User).where(User.id == 53))).scalars().first()
        policy = OrgMFAPolicy(require_2fa=True, grace_days=0, enabled_at="2020-01-01T00:00:00")
        with patch.object(mfa_policy, "get_org_mfa_policy", AsyncMock(return_value=policy)), \
                patch.object(mfa_policy, "is_mfa_active", AsyncMock(return_value=False)), \
                patch.object(mfa_policy, "get_session_provenance", return_value=SessionProvenance(amr="password")):
            state = await evaluate_mfa_compliance(db, user, org.id)
        assert state.exempt_reason is None


# ---------------------------------------------------------------------------
# Custom domains: stale unverified claims don't block the real owner
# ---------------------------------------------------------------------------


async def _claim(db, org_id, *, created, status="pending", verified_at=None, domain="learn.example.com"):
    row = CustomDomain(
        domain_uuid=f"domain_{org_id}_{status}", domain=domain, org_id=org_id, status=status,
        verification_token="t", primary=False, creation_date=created, update_date=created,
        verified_at=verified_at,
    )
    db.add(row)
    await db.commit()
    return row


async def _add(db, org, user, domain="learn.example.com"):
    return await add_custom_domain(_request(), db, CustomDomainCreate(domain=domain), org.id, user)


class TestStaleDomainClaims:
    OLD = str(datetime.now() - timedelta(days=30))

    @pytest.mark.asyncio
    async def test_stale_unverified_claim_is_released(self, db, org, other_org, admin_user):
        await _claim(db, other_org.id, created=self.OLD)
        result = await _add(db, org, admin_user)
        assert result.org_id == org.id
        rows = (await db.execute(select(CustomDomain))).scalars().all()
        assert [r.org_id for r in rows] == [org.id]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "claim",
        [
            {"created": str(datetime.now())},  # still fresh
            {"created": OLD, "status": "verified", "verified_at": OLD},
            {"created": OLD, "verified_at": OLD},  # verified once, DNS check failing now
            {"created": "not a date"},
        ],
    )
    async def test_live_claims_still_block(self, db, org, other_org, admin_user, claim):
        await _claim(db, other_org.id, **claim)
        with pytest.raises(HTTPException) as exc:
            await _add(db, org, admin_user)
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_own_stale_claim_still_conflicts(self, db, org, admin_user):
        await _claim(db, org.id, created=self.OLD)
        with pytest.raises(HTTPException) as exc:
            await _add(db, org, admin_user)
        assert exc.value.status_code == 409
