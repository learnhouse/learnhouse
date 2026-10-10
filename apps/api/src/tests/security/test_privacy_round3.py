"""Personal-data exposure regressions (round 3).

1. Org admins received the global account record: signup answers collected by
   OTHER orgs (``extra_metadata``) and the platform ``is_superadmin`` flag.
2. The audit dossier mixed in org-agnostic login rows (other orgs' IPs and
   devices) and account-global lockout state.
3. ``/users/id|uuid|username`` let any logged-in account read any user.
4. GDPR anonymization left signup answers, login traces, audit IPs and AI
   chats behind.
5. Course editors got the full account record of every contributor.
6. The public org read returned ``org.email`` (the creator's address).
"""

import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlmodel import select

from src.db.organization_config import OrganizationConfig
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.user_audit_events import UserAuditEvent, UserAuditEventType
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import APITokenUser, AnonymousUser, PublicUser, User


def _now():
    return str(datetime.now())


async def _make_user(db, user_id, org_ids, role_id=4, **fields):
    u = User(
        id=user_id,
        username=fields.pop("username", f"u{user_id}"),
        first_name="F",
        last_name="L",
        email=fields.pop("email", f"u{user_id}@example.com"),
        password="hashed",
        user_uuid=f"user_{user_id}",
        creation_date=_now(),
        update_date=_now(),
        **fields,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    for oid in org_ids:
        db.add(UserOrganization(
            user_id=u.id, org_id=oid, role_id=role_id,
            creation_date=_now(), update_date=_now(),
        ))
    await db.commit()
    return u


def _public(u: User) -> PublicUser:
    return PublicUser(
        id=u.id, username=u.username, first_name=u.first_name,
        last_name=u.last_name, email=u.email, user_uuid=u.user_uuid,
    )


async def _declare_signup_field(db, org_id, key):
    db.add(OrganizationConfig(
        org_id=org_id,
        config={"general": {"signup_fields": {"fields": [{"key": key, "label": key}]}}},
    ))
    await db.commit()


LEAKY_META = {"company": "Acme", "other_org_secret": "diagnosis: x"}


# -- 1. org-scoped member view -------------------------------------------------


@pytest.mark.asyncio
class TestOrgMemberView:
    async def test_members_list_filters_metadata_and_drops_superadmin(
        self, db, org, admin_user, user_role, mock_request
    ):
        from src.services.orgs.users import get_organization_users

        await _declare_signup_field(db, org.id, "company")
        await _make_user(
            db, 90, [org.id], extra_metadata=dict(LEAKY_META),
            is_superadmin=True, signup_method="google",
        )

        with patch("src.services.orgs.users.is_org_member", return_value=True), \
                patch("src.security.superadmin.is_user_superadmin", return_value=False), \
                patch("src.security.org_auth.is_org_admin", return_value=True):
            result = await get_organization_users(mock_request, org.id, db, admin_user)

        body = jsonable_encoder(result)
        row = next(i["user"] for i in body["items"] if i["user"]["id"] == 90)
        assert row["extra_metadata"] == {"company": "Acme"}
        assert "is_superadmin" not in row
        # What the members table renders is still there.
        assert row["signup_method"] == "google"
        assert row["email"] == "u90@example.com"

    async def test_admin_token_cohort_members_use_org_view(self, db, org, admin_user):
        from src.services.admin.admin import list_usergroup_members

        await _declare_signup_field(db, org.id, "company")
        member = await _make_user(db, 91, [org.id], extra_metadata=dict(LEAKY_META), is_superadmin=True)
        group = UserGroup(name="g", description="", org_id=org.id, usergroup_uuid="ug_r3")
        db.add(group)
        await db.commit()
        await db.refresh(group)
        db.add(UserGroupUser(usergroup_id=group.id, user_id=member.id, org_id=org.id))
        await db.commit()

        token = APITokenUser(id=1, org_id=org.id, created_by_user_id=admin_user.id)
        rows = await list_usergroup_members(token, "ug_r3", db)
        assert rows[0]["user"]["extra_metadata"] == {"company": "Acme"}
        assert "is_superadmin" not in rows[0]["user"]

    async def test_no_declared_fields_means_no_metadata(self, db, org):
        from src.db.users import OrgMemberUserRead

        u = await _make_user(db, 92, [org.id], extra_metadata=dict(LEAKY_META))
        assert OrgMemberUserRead.for_org(u, set()).extra_metadata == {}


# -- 2. audit dossier ----------------------------------------------------------


@pytest.mark.asyncio
class TestDossierScope:
    async def test_org_agnostic_and_foreign_events_excluded(self, db, org, other_org, regular_user):
        from src.services.audit.dossier import _connections_and_timeline

        for org_id, ip in ((None, "1.1.1.1"), (other_org.id, "2.2.2.2"), (org.id, "3.3.3.3")):
            db.add(UserAuditEvent(
                event_type=UserAuditEventType.LOGIN, user_id=regular_user.id,
                org_id=org_id, ip=ip, created_at=datetime.now(timezone.utc),
            ))
        await db.commit()

        connections, timeline = await _connections_and_timeline(db, regular_user.id, org.id)
        assert [c["ip"] for c in connections] == ["3.3.3.3"]
        assert {e["ip"] for e in timeline} == {"3.3.3.3"}

    async def test_identity_omits_global_login_state(self, db, org, regular_user):
        from src.services.audit.dossier import _identity

        user = (await db.execute(select(User).where(User.id == regular_user.id))).scalars().one()
        user.last_login_ip = "9.9.9.9"
        user.failed_login_attempts = 4
        user.locked_until = "2099-01-01"
        db.add(user)
        await db.commit()

        identity = await _identity(db, regular_user.id, org.id)
        sec = identity["security"]
        assert "last_login_ip" not in sec
        assert "failed_login_attempts" not in sec
        assert "locked_until" not in sec
        assert "9.9.9.9" not in json.dumps(identity, default=str)


# -- 3. user lookups -----------------------------------------------------------


@pytest.mark.asyncio
class TestUserLookupScope:
    async def test_cross_org_lookup_is_404(self, db, org, other_org, regular_user, mock_request):
        from src.services.users.users import (
            read_user_by_id,
            read_user_by_username,
            read_user_by_uuid,
        )

        outsider = _public(await _make_user(db, 93, [other_org.id]))
        with patch("src.services.users.users.is_user_superadmin", return_value=False):
            for fn, key in (
                (read_user_by_id, regular_user.id),
                (read_user_by_uuid, regular_user.user_uuid),
                (read_user_by_username, regular_user.username),
            ):
                with pytest.raises(HTTPException) as exc:
                    await fn(mock_request, db, outsider, key)
                assert exc.value.status_code == 404

    async def test_self_shared_org_and_superadmin_allowed(
        self, db, org, other_org, admin_user, regular_user, mock_request
    ):
        from src.services.users.users import read_user_by_username

        with patch("src.services.users.users.is_user_superadmin", return_value=False):
            assert (await read_user_by_username(mock_request, db, regular_user, "regular")).id == regular_user.id
            assert (await read_user_by_username(mock_request, db, admin_user, "regular")).id == regular_user.id

        outsider = _public(await _make_user(db, 94, [other_org.id]))
        with patch("src.services.users.users.is_user_superadmin", return_value=True):
            assert (await read_user_by_username(mock_request, db, outsider, "regular")).id == regular_user.id

    async def test_api_token_scoped_to_its_org(self, db, org, other_org, regular_user, mock_request):
        from src.services.users.users import read_user_by_id

        foreign = APITokenUser(id=5, org_id=other_org.id, created_by_user_id=999)
        with pytest.raises(HTTPException) as exc:
            await read_user_by_id(mock_request, db, foreign, regular_user.id)
        assert exc.value.status_code == 404

        own = APITokenUser(id=6, org_id=org.id, created_by_user_id=999)
        assert (await read_user_by_id(mock_request, db, own, regular_user.id)).id == regular_user.id


# -- 4. GDPR anonymize ---------------------------------------------------------


@pytest.mark.asyncio
class TestAnonymizeScrub:
    async def test_anonymize_clears_traces_and_chats(self, db, org, admin_user):
        from src.services.admin.admin import anonymize_user

        victim = await _make_user(
            db, 95, [org.id], extra_metadata=dict(LEAKY_META),
            last_login_at="2026-01-01", last_login_ip="8.8.8.8",
            failed_login_attempts=3, locked_until="2099-01-01",
        )
        db.add(UserAuditEvent(
            event_type=UserAuditEventType.LOGIN, user_id=victim.id, org_id=None,
            ip="8.8.8.8", user_agent="Firefox", created_at=datetime.now(timezone.utc),
        ))
        await db.commit()

        fake_redis = MagicMock()
        fake_redis.zrange.return_value = [b"chat_a", b"chat_b"]
        token = APITokenUser(id=1, org_id=org.id, created_by_user_id=admin_user.id)

        with patch("src.services.admin.admin.dispatch_webhooks", new_callable=AsyncMock), \
                patch("src.services.ai.base._get_redis", return_value=fake_redis):
            await anonymize_user(token, victim.id, db)

        await db.refresh(victim)
        assert victim.extra_metadata == {}
        assert victim.last_login_at is None
        assert victim.last_login_ip is None
        assert victim.failed_login_attempts == 0
        assert victim.locked_until is None

        events = (await db.execute(
            select(UserAuditEvent).where(UserAuditEvent.user_id == victim.id)
        )).scalars().all()
        assert events and all(e.ip is None and e.user_agent is None for e in events)

        fake_redis.zrange.assert_called_once_with("user_chats:95", 0, -1)
        deleted = set(fake_redis.delete.call_args.args)
        assert deleted == {
            "user_chats:95",
            "chat_history:chat_a", "chat_meta:chat_a",
            "chat_history:chat_b", "chat_meta:chat_b",
        }

    async def test_redis_failure_does_not_block_erasure(self, db, org, admin_user):
        from src.services.admin.admin import anonymize_user

        victim = await _make_user(db, 96, [org.id], extra_metadata={"a": 1})
        token = APITokenUser(id=1, org_id=org.id, created_by_user_id=admin_user.id)
        with patch("src.services.admin.admin.dispatch_webhooks", new_callable=AsyncMock), \
                patch("src.services.ai.base._get_redis", side_effect=RuntimeError("down")):
            await anonymize_user(token, victim.id, db)
        await db.refresh(victim)
        assert victim.extra_metadata == {}


# -- 5. contributors -----------------------------------------------------------


@pytest.mark.asyncio
class TestContributorsEditorView:
    async def test_editor_gets_author_fields_plus_email_only(self, db, org, course, admin_user, mock_request):
        from src.services.courses.contributors import get_course_contributors

        contrib = await _make_user(db, 97, [org.id], extra_metadata=dict(LEAKY_META), is_superadmin=True)
        db.add(ResourceAuthor(
            resource_uuid=course.course_uuid, user_id=contrib.id,
            authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
            creation_date=_now(), update_date=_now(),
        ))
        await db.commit()

        allowed = AsyncMock(return_value=SimpleNamespace(allowed=True))
        with patch("src.services.courses.contributors.check_resource_access", allowed):
            rows = await get_course_contributors(mock_request, course.course_uuid, admin_user, db)

        user = next(r["user"] for r in rows if r["user_id"] == contrib.id)
        assert set(user) == {
            "id", "user_uuid", "username", "first_name", "last_name", "avatar_image", "email",
        }

    async def test_reader_gets_no_email(self, db, org, course, admin_user, mock_request):
        from src.services.courses.contributors import get_course_contributors

        contrib = await _make_user(db, 98, [org.id])
        db.add(ResourceAuthor(
            resource_uuid=course.course_uuid, user_id=contrib.id,
            authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
            creation_date=_now(), update_date=_now(),
        ))
        await db.commit()

        denied = AsyncMock(return_value=SimpleNamespace(allowed=False))
        with patch("src.services.courses.contributors.check_resource_access", denied):
            rows = await get_course_contributors(mock_request, course.course_uuid, admin_user, db)
        assert "email" not in rows[0]["user"]


# -- 6. public org email -------------------------------------------------------


@pytest.mark.asyncio
class TestPublicOrgEmail:
    async def test_anonymous_and_member_get_null_email(self, db, org, regular_user, mock_request):
        from src.services.orgs import orgs as orgs_service

        with patch("src.services.orgs.cache.get_cached_org_by_slug", return_value=None), \
                patch("src.services.orgs.cache.set_cached_org_by_slug"):
            anon = await orgs_service.get_organization_by_slug(mock_request, org.slug, db, AnonymousUser())
            assert anon.email is None

            async def deny(request, org_uuid, user, action, session):
                if action == "update":
                    raise HTTPException(status_code=403)
                return True

            with patch.object(orgs_service, "rbac_check", side_effect=deny):
                member = await orgs_service.get_organization_by_uuid(mock_request, org.org_uuid, db, regular_user)
                assert member.email is None

    async def test_org_manager_gets_email_including_from_cache(self, db, org, admin_user, mock_request):
        from src.services.orgs import orgs as orgs_service

        cached = {
            "id": org.id, "name": org.name, "slug": org.slug, "email": "owner@personal.test",
            "org_uuid": org.org_uuid, "creation_date": "x", "update_date": "x", "config": {},
        }
        with patch.object(orgs_service, "rbac_check", new_callable=AsyncMock):
            by_uuid = await orgs_service.get_organization_by_uuid(mock_request, org.org_uuid, db, admin_user)
            assert by_uuid.email == org.email
            with patch("src.services.orgs.cache.get_cached_org_by_slug", return_value=cached):
                by_slug = await orgs_service.get_organization_by_slug(mock_request, org.slug, db, admin_user)
        assert by_slug.email == "owner@personal.test"

        # The cache never feeds a redacted copy back to managers, nor the
        # unredacted one to the public.
        with patch("src.services.orgs.cache.get_cached_org_by_slug", return_value=cached):
            public = await orgs_service.get_organization_by_slug(mock_request, org.slug, db, AnonymousUser())
        assert public.email is None
