"""API-token principals act with their own rights, in their own org.

Covers: community writes (members with discussions.action_create only, tokens
resolved to their creator and held to their own rights), superadmin tokens at
the "no API token" gates, token validation (creator membership, expiry
parsing), rights caps, listing endpoints, certification templates, admin API
role/impersonation caps, Zapier subscription rights and active-user
recording.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.api_tokens import APIToken
from src.db.communities.communities import Community
from src.db.communities.discussion_comments import DiscussionComment
from src.db.communities.discussions import Discussion
from src.db.courses.courses import Course
from src.db.roles import Role, RoleTypeEnum
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.user_activity import UserActivityDay
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, PublicUser, SuperadminAPITokenUser, User
from src.tests.conftest import ADMIN_RIGHTS, USER_RIGHTS

pytestmark = pytest.mark.asyncio

NOW = str(datetime.now())


def _token(org_id=1, creator=1, **rights) -> APITokenUser:
    return APITokenUser(
        id=77, org_id=org_id, created_by_user_id=creator, rights=rights, token_name="t"
    )


async def _community(db, org, uuid="community_r6", public=True):
    c = Community(
        org_id=org.id, name="C", description="", public=public,
        community_uuid=uuid, creation_date=NOW, update_date=NOW,
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return c


async def _discussion(db, community, author_id, uuid="discussion_r6"):
    d = Discussion(
        title="T", content="C", label="general", community_id=community.id,
        org_id=community.org_id, author_id=author_id, discussion_uuid=uuid,
        upvote_count=0, creation_date=NOW, update_date=NOW,
    )
    db.add(d)
    await db.commit()
    await db.refresh(d)
    return d


async def _outsider(db, other_org):
    u = User(
        id=9, username="out", first_name="O", last_name="U", email="out@test.com",
        password="x", user_uuid="user_out", creation_date=NOW, update_date=NOW,
    )
    db.add(u)
    db.add(UserOrganization(user_id=9, org_id=other_org.id, role_id=4, creation_date=NOW, update_date=NOW))
    await db.commit()
    return PublicUser(id=9, username="out", first_name="O", last_name="U",
                      email="out@test.com", user_uuid="user_out")


# -- Community writes ---------------------------------------------------------


class TestCommunityWrites:
    async def test_non_member_cannot_comment_on_public_community(
        self, db, org, other_org, admin_user, user_role, mock_request
    ):
        from src.services.communities.comments import create_comment

        community = await _community(db, org)
        discussion = await _discussion(db, community, admin_user.id)
        outsider = await _outsider(db, other_org)
        with pytest.raises(HTTPException) as exc:
            await create_comment(mock_request, discussion.discussion_uuid, "hi", outsider, db)
        assert exc.value.status_code == 403

    async def test_member_without_discussions_create_cannot_vote(
        self, db, org, admin_user, regular_user, mock_request
    ):
        # The fixture User role carries discussions.action_create = False.
        from src.services.communities.votes import upvote_discussion

        community = await _community(db, org)
        discussion = await _discussion(db, community, admin_user.id)
        with pytest.raises(HTTPException) as exc:
            await upvote_discussion(mock_request, discussion.discussion_uuid, regular_user, db)
        assert exc.value.status_code == 403

    async def test_token_writes_as_its_creator(self, db, org, admin_user, mock_request):
        from src.services.communities.comments import create_comment

        community = await _community(db, org)
        discussion = await _discussion(db, community, admin_user.id)
        token = _token(
            creator=admin_user.id,
            communities={"action_read": True},
            discussions={"action_create": True},
        )
        with patch("src.services.communities.comments.dispatch_webhooks", new_callable=AsyncMock):
            created = await create_comment(mock_request, discussion.discussion_uuid, "hi", token, db)
        assert created.author_id == admin_user.id
        row = (await db.execute(select(DiscussionComment))).scalars().first()
        assert row.author_id == admin_user.id

    async def test_token_needs_discussions_create(self, db, org, admin_user, mock_request):
        from src.services.communities.reactions import toggle_reaction

        community = await _community(db, org)
        discussion = await _discussion(db, community, admin_user.id)
        token = _token(creator=admin_user.id, communities={"action_read": True})
        with pytest.raises(HTTPException) as exc:
            await toggle_reaction(mock_request, discussion.discussion_uuid, "x", token, db)
        assert exc.value.status_code == 403

    async def test_token_of_other_org_cannot_write(self, db, org, admin_user):
        from src.services.communities.access import require_community_participant

        community = await _community(db, org)
        token = _token(org_id=2, creator=admin_user.id, discussions={"action_create": True})
        with pytest.raises(HTTPException) as exc:
            await require_community_participant(token, community, db)
        assert exc.value.status_code == 403

    async def test_token_moderation_uses_token_rights_not_creator_role(
        self, db, org, admin_user, mock_request
    ):
        from src.services.communities.discussions import pin_discussion

        community = await _community(db, org)
        discussion = await _discussion(db, community, admin_user.id)
        # Creator is an org admin, but the token itself holds no communities update.
        token = _token(creator=admin_user.id, communities={"action_read": True})
        with pytest.raises(HTTPException) as exc:
            await pin_discussion(mock_request, discussion.discussion_uuid, True, token, db)
        assert exc.value.status_code == 403

        allowed = _token(creator=admin_user.id, communities={"action_read": True, "action_update": True})
        with patch("src.services.communities.discussions.dispatch_webhooks", new_callable=AsyncMock):
            result = await pin_discussion(mock_request, discussion.discussion_uuid, True, allowed, db)
        assert result.is_pinned is True

    async def test_create_community_checks_token_rights(self, db, org, admin_user, mock_request):
        from src.db.communities.communities import CommunityCreate
        from src.services.communities.communities import create_community

        token = _token(creator=admin_user.id, communities={"action_read": True})
        with pytest.raises(HTTPException) as exc:
            await create_community(
                mock_request, org.id, CommunityCreate(name="n", description="d", public=True), token, db
            )
        assert exc.value.status_code == 403

    async def test_community_listing_token_scope(self, db, org, other_org, admin_user, mock_request):
        from src.services.communities.communities import get_communities_by_org

        await _community(db, org, public=False)
        reader = _token(creator=admin_user.id, communities={"action_read": True})
        assert len(await get_communities_by_org(mock_request, org.id, reader, db)) == 1
        with pytest.raises(HTTPException):
            await get_communities_by_org(mock_request, other_org.id, reader, db)
        with pytest.raises(HTTPException):
            await get_communities_by_org(mock_request, org.id, _token(creator=admin_user.id), db)
        # No communities bucket: courses read covers it, as for every existing token.
        legacy = _token(creator=admin_user.id, courses={"action_read": True})
        assert len(await get_communities_by_org(mock_request, org.id, legacy, db)) == 1


# -- Superadmin token at the non-token gates -----------------------------------


class TestSuperadminTokenGates:
    def _sa(self):
        return SuperadminAPITokenUser(id=1, created_by_user_id=5)

    async def test_reject_api_token_access_rejects_superadmin_token(self):
        from src.security.api_token_utils import reject_api_token_access

        with pytest.raises(HTTPException) as exc:
            reject_api_token_access(self._sa())
        assert exc.value.status_code == 403

    async def test_authenticated_gates_reject_superadmin_token(self, mock_request, db):
        from src.security import api_token_utils

        with patch("src.security.auth.get_authenticated_user", new=AsyncMock(return_value=self._sa())):
            for gate in (
                api_token_utils.get_authenticated_non_api_token_user,
                api_token_utils.require_authenticated_user_or_api_token,
            ):
                with pytest.raises(HTTPException) as exc:
                    await gate(mock_request, db)
                assert exc.value.status_code == 403

    async def test_resolve_acting_user_id_uses_creator(self):
        from src.security.auth import resolve_acting_user_id

        assert resolve_acting_user_id(self._sa()) == 5

    async def test_demo_enter_rejects_tokens(self, db):
        from src.routers.demo import enter_demo

        with patch("src.routers.demo.flags.demo_enabled", return_value=True):
            for principal in (self._sa(), _token()):
                with pytest.raises(HTTPException) as exc:
                    await enter_demo(db_session=db, current_user=principal)
                assert exc.value.status_code == 403

    async def test_my_certificate_routes_reject_tokens(self):
        import inspect
        from src.routers.courses import certifications as router
        from src.security.api_token_utils import get_authenticated_non_api_token_user

        for fn in (router.api_get_all_user_certificates, router.api_get_user_certificates_for_course):
            dep = inspect.signature(fn).parameters["current_user"].default.dependency
            assert dep is get_authenticated_non_api_token_user


# -- Token validation ------------------------------------------------------------


async def _stored_token(db, org, creator_id, expires_at=None):
    from src.services.api_tokens.api_tokens import generate_api_token

    full, prefix, token_hash = generate_api_token()
    db.add(APIToken(
        token_uuid="apitoken_r6", name="r6", token_prefix=prefix, token_hash=token_hash,
        org_id=org.id, rights={}, created_by_user_id=creator_id, creation_date=NOW,
        update_date=NOW, expires_at=expires_at, is_active=True,
    ))
    await db.commit()
    return full


class TestTokenValidation:
    @pytest.fixture(autouse=True)
    def _plan(self):
        with patch("src.services.api_tokens.api_tokens._require_api_access_plan", new_callable=AsyncMock):
            yield

    async def test_member_creator_token_is_valid(self, db, org, admin_user):
        from src.services.api_tokens.api_tokens import validate_api_token_for_auth

        full = await _stored_token(db, org, admin_user.id)
        assert await validate_api_token_for_auth(full, db) is not None

    async def test_token_of_departed_creator_is_rejected(self, db, org, admin_user):
        from src.services.api_tokens.api_tokens import validate_api_token_for_auth

        full = await _stored_token(db, org, admin_user.id)
        membership = (await db.execute(
            select(UserOrganization).where(UserOrganization.user_id == admin_user.id)
        )).scalars().first()
        await db.delete(membership)
        await db.commit()
        assert await validate_api_token_for_auth(full, db) is None

    async def test_unparseable_expiry_fails_closed(self, db, org, admin_user):
        from src.services.api_tokens.api_tokens import validate_api_token_for_auth

        full = await _stored_token(db, org, admin_user.id, expires_at="next tuesday")
        assert await validate_api_token_for_auth(full, db) is None

    async def test_expiry_must_be_a_datetime(self):
        from src.services.api_tokens.api_tokens import _validate_expires_at

        _validate_expires_at(None)
        _validate_expires_at("2030-01-01T10:00")
        _validate_expires_at("2030-01-01T10:00:00.000Z")
        with pytest.raises(HTTPException) as exc:
            _validate_expires_at("soon")
        assert exc.value.status_code == 400


class TestRightsCaps:
    BUCKETS = ["courses", "activities", "coursechapters", "folders", "media",
               "certifications", "usergroups", "payments", "search"]

    def _rights(self, **overrides):
        rights = {b: {"action_read": True} for b in self.BUCKETS}
        rights.update(overrides)
        return rights

    async def test_bucket_missing_from_role_is_not_held(self):
        from src.services.api_tokens.api_tokens import validate_rights_structure

        role = USER_RIGHTS.model_dump()
        role.pop("assignments")
        with pytest.raises(HTTPException) as exc:
            await validate_rights_structure(self._rights(assignments={"action_read": True}), role)
        assert exc.value.status_code == 403

    async def test_search_is_capped_by_courses_read(self):
        from src.services.api_tokens.api_tokens import validate_rights_structure

        role = USER_RIGHTS.model_dump()
        await validate_rights_structure(self._rights(), role)
        role["courses"]["action_read"] = False
        with pytest.raises(HTTPException):
            await validate_rights_structure(self._rights(courses={}), role)


# -- Listings --------------------------------------------------------------------


class TestListings:
    async def _courses(self, db, org):
        db.add(Course(id=11, name="pub", public=False, published=True, open_to_contributors=False, org_id=org.id,
                      course_uuid="course_pub", creation_date=NOW, update_date=NOW))
        db.add(Course(id=12, name="draft", public=False, published=False, open_to_contributors=False, org_id=org.id,
                      course_uuid="course_draft", creation_date=NOW, update_date=NOW))
        await db.commit()

    async def test_course_listing_uses_token_rights(self, db, org, admin_user, mock_request):
        from src.services.courses.courses import get_courses_orgslug, get_courses_count_orgslug

        await self._courses(db, org)
        with pytest.raises(HTTPException):
            await get_courses_orgslug(mock_request, _token(creator=admin_user.id), org.slug, db)
        reader = _token(creator=admin_user.id, courses={"action_read": True})
        names = {c.name for c in await get_courses_orgslug(mock_request, reader, org.slug, db)}
        assert names == {"pub"}
        names = {c.name for c in await get_courses_orgslug(
            mock_request, reader, org.slug, db, include_unpublished=True
        )}
        assert names == {"pub", "draft"}
        assert await get_courses_count_orgslug(mock_request, reader, org.slug, db) == 1

    async def test_course_listing_rejects_other_org_token(self, db, org, admin_user, mock_request):
        from src.services.courses.courses import search_courses

        token = _token(org_id=2, creator=admin_user.id, courses={"action_read": True})
        with pytest.raises(HTTPException):
            await search_courses(mock_request, token, org.slug, "x", db)

    async def test_search_hides_unpublished_course_from_group_member(
        self, db, org, regular_user, mock_request
    ):
        from src.services.courses.courses import search_courses

        await self._courses(db, org)
        db.add(UserGroup(id=1, org_id=org.id, name="g", description="", usergroup_uuid="usergroup_g",
                         creation_date=NOW, update_date=NOW))
        db.add(UserGroupResource(usergroup_id=1, resource_uuid="course_draft", org_id=org.id,
                                 creation_date=NOW, update_date=NOW))
        db.add(UserGroupUser(usergroup_id=1, user_id=regular_user.id, org_id=org.id,
                             creation_date=NOW, update_date=NOW))
        await db.commit()
        results = await search_courses(mock_request, regular_user, org.slug, "draft", db)
        assert results == []

    async def test_podcast_listing_uses_podcasts_bucket_or_courses_read(
        self, db, org, admin_user, mock_request
    ):
        from src.services.podcasts.podcasts import get_podcasts_count_orgslug

        # A token holding the podcasts bucket is judged on it.
        with pytest.raises(HTTPException):
            await get_podcasts_count_orgslug(
                mock_request,
                _token(creator=admin_user.id, podcasts={"action_read": False}, courses={"action_read": True}),
                org.slug,
                db,
            )
        # Tokens minted before that bucket existed fall back to courses read.
        assert await get_podcasts_count_orgslug(
            mock_request, _token(creator=admin_user.id, courses={"action_read": True}), org.slug, db
        ) == 0
        with pytest.raises(HTTPException):
            await get_podcasts_count_orgslug(mock_request, _token(creator=admin_user.id), org.slug, db)

    async def test_search_denies_token_without_rights(self, db, org, admin_user, mock_request):
        from src.services.search.search import search_across_org

        token = APITokenUser(id=1, org_id=org.id, created_by_user_id=admin_user.id, rights=None)
        with pytest.raises(HTTPException) as exc:
            await search_across_org(mock_request, token, org.slug, "x", db)
        assert exc.value.status_code == 403


class TestCertificationTemplates:
    async def test_token_needs_certifications_bucket(self, db, org, admin_user, course, mock_request):
        from src.services.courses.certifications import get_certifications_by_course

        courses_only = _token(creator=admin_user.id, courses={"action_read": True})
        with pytest.raises(HTTPException) as exc:
            await get_certifications_by_course(mock_request, course.course_uuid, courses_only, db)
        assert exc.value.status_code == 403
        certs = _token(creator=admin_user.id, certifications={"action_read": True})
        assert await get_certifications_by_course(mock_request, course.course_uuid, certs, db) == []


# -- Admin API -------------------------------------------------------------------


class TestAdminTokenCaps:
    async def test_role_within_token_rights(self):
        from src.services.admin.admin import _role_within_token_rights

        reader = {b: {"action_read": True} for b in (
            "courses", "activities", "assignments", "coursechapters", "folders",
            "media", "usergroups", "users", "roles", "organizations",
        )}
        assert _role_within_token_rights(USER_RIGHTS.model_dump(), reader)
        assert not _role_within_token_rights(ADMIN_RIGHTS.model_dump(), reader)

    async def test_cannot_assign_custom_role_beyond_token(self, db, org, admin_user):
        from src.services.admin.admin import _check_token_can_assign_role

        role = Role(id=50, name="Editor", org_id=org.id, role_type=RoleTypeEnum.TYPE_ORGANIZATION,
                    role_uuid="role_editor", rights=ADMIN_RIGHTS.model_dump(),
                    creation_date=NOW, update_date=NOW)
        token = _token(creator=admin_user.id, users={"action_update": True, "action_read": True})
        with pytest.raises(HTTPException) as exc:
            await _check_token_can_assign_role(token, role, db)
        assert exc.value.status_code == 403

    async def test_cannot_impersonate_account_beyond_token(self, db, org, admin_user, regular_user):
        from src.services.admin.admin import _check_token_can_impersonate

        user = await db.get(User, regular_user.id)
        token = _token(creator=admin_user.id, users={"action_update": True})
        # An ordinary learner (read-only role) is fine...
        await _check_token_can_impersonate(user, token, db)

        # ...an account holding course write authority the token lacks is not.
        db.add(Role(id=51, name="Editor", org_id=org.id, role_type=RoleTypeEnum.TYPE_ORGANIZATION,
                    role_uuid="role_editor2", rights=ADMIN_RIGHTS.model_dump(),
                    creation_date=NOW, update_date=NOW))
        membership = (await db.execute(
            select(UserOrganization).where(UserOrganization.user_id == regular_user.id)
        )).scalars().first()
        membership.role_id = 51
        db.add(membership)
        await db.commit()
        with pytest.raises(HTTPException) as exc:
            await _check_token_can_impersonate(user, token, db)
        assert exc.value.status_code == 403


class TestZapierSubscriptionRights:
    async def test_subscription_needs_token_rights(self):
        from src.routers.integrations.zapier import _require_subscription_rights

        with pytest.raises(HTTPException):
            _require_subscription_rights(_token(), "ping")
        _require_subscription_rights(_token(users={"action_read": True}), "ping")
        with pytest.raises(HTTPException):
            _require_subscription_rights(_token(users={"action_read": True}), "course_completed")
        _require_subscription_rights(
            _token(users={"action_read": True}, courses={"action_read": True}), "course_completed"
        )


# -- Active users ------------------------------------------------------------------


class TestActiveUserRecording:
    async def test_non_member_activity_is_not_recorded(self, db, org, other_org, admin_user):
        from src.services.security import activity
        from src.tests.security.test_active_users import _patch_session_factory

        today = datetime.now().date()
        with _patch_session_factory(db):
            assert await activity._insert_activity_row(other_org.id, admin_user.id, today) is False
            assert await activity._insert_activity_row(org.id, admin_user.id, today) is True
        rows = (await db.execute(select(UserActivityDay))).scalars().all()
        assert [(r.org_id, r.user_id) for r in rows] == [(org.id, admin_user.id)]

    async def test_count_active_users_ignores_non_members(self, db, org, admin_user):
        from datetime import date
        from src.security.features_utils.active_users import count_active_users

        for uid in (admin_user.id, 999):
            for day in (1, 2):
                db.add(UserActivityDay(org_id=org.id, user_id=uid, activity_date=date(2026, 3, day)))
        await db.commit()
        assert await count_active_users(org.id, 2026, 3, db) == 1


class TestSuperadminTokenOrgAndCommunityGates:
    async def test_org_rbac_check_treats_superadmin_token_as_superadmin(self, db, org, mock_request):
        from src.db.users import SuperadminAPITokenUser
        from src.services.orgs.orgs import rbac_check

        token = SuperadminAPITokenUser(id=5, created_by_user_id=999)
        assert await rbac_check(mock_request, org.org_uuid, token, "update", db) is True

    async def test_superadmin_token_cannot_post_to_a_community(self, db, org):
        from src.db.users import SuperadminAPITokenUser
        from src.services.communities.access import require_community_participant

        community = await _community(db, org)
        with pytest.raises(HTTPException) as exc:
            await require_community_participant(
                SuperadminAPITokenUser(id=5, created_by_user_id=999), community, db
            )
        assert exc.value.status_code == 403
