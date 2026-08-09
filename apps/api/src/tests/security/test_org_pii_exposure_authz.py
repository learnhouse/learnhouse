"""Authorization regression tests for three PII-exposure findings.

F9  — GET /orgs/{org_id}/invites/users leaked every pending invitee's email
      address to anyone, including unauthenticated callers, because the only
      gate was ``rbac_check(..., "read", ...)`` which short-circuits to True.
F29 — GET /playgrounds/{uuid}/usergroups returned another tenant's cohort
      names and usergroup uuids to any authenticated principal.
F35 — GET /search/org_slug/{slug} serialized user hits with ``UserRead``,
      handing every org member the full PII projection (email,
      ``extra_metadata`` signup-field answers, ``is_superadmin``).
"""

import json
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.playgrounds import Playground, PlaygroundAccessType
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroups import UserGroup
from src.db.users import PublicUser, User
from src.routers.search import router as search_router
from src.security.auth import get_current_user
from src.services.orgs.users import get_list_of_invited_users
from src.services.playgrounds.playgrounds import get_playground_usergroups
from src.services.search.search import search_across_org

REDIS_URL = "redis://test"


def _redis_config():
    """Config stub whose redis connection string passes the early 500 guard."""
    return MagicMock(
        redis_config=MagicMock(redis_connection_string=REDIS_URL)
    )


def _fake_redis(emails):
    r = MagicMock()
    r.scan_iter.return_value = [
        f"invited_user:{email}:org:org_test".encode("utf-8") for email in emails
    ]
    r.get.side_effect = [
        json.dumps({"email": email, "invite_code_uuid": "code_1"}).encode("utf-8")
        for email in emails
    ]
    return r


async def _outsider(db):
    """An authenticated user who belongs to no organization at all."""
    u = User(
        id=77,
        username="outsider",
        first_name="Out",
        last_name="Sider",
        email="outsider@test.com",
        password="hashed_password",
        user_uuid="user_outsider",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(u)
    await db.commit()
    return PublicUser(
        id=u.id,
        username=u.username,
        first_name=u.first_name,
        last_name=u.last_name,
        email=u.email,
        user_uuid=u.user_uuid,
    )


# ---------------------------------------------------------------------------
# F9 — pending invite list
# ---------------------------------------------------------------------------


class TestInvitedUsersListAuthz:
    async def test_anonymous_caller_is_refused(
        self, mock_request, db, org, anonymous_user
    ):
        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=_redis_config(),
        ), patch(
            "src.services.orgs.users.redis.Redis.from_url"
        ) as from_url:
            with pytest.raises(HTTPException) as exc:
                await get_list_of_invited_users(
                    mock_request, org.id, db, anonymous_user
                )

        assert exc.value.status_code == 401
        # Redis must never be touched for an unauthenticated caller.
        from_url.assert_not_called()

    async def test_plain_member_is_refused(
        self, mock_request, db, org, regular_user
    ):
        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=_redis_config(),
        ), patch(
            "src.services.orgs.users.redis.Redis.from_url"
        ) as from_url:
            with pytest.raises(HTTPException) as exc:
                await get_list_of_invited_users(
                    mock_request, org.id, db, regular_user
                )

        assert exc.value.status_code == 403
        from_url.assert_not_called()

    async def test_admin_of_another_org_is_refused(
        self, mock_request, db, org, other_org, admin_user
    ):
        # admin_user administers org 1 only; org 2 must be opaque to them.
        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=_redis_config(),
        ), patch(
            "src.services.orgs.users.redis.Redis.from_url"
        ) as from_url:
            with pytest.raises(HTTPException) as exc:
                await get_list_of_invited_users(
                    mock_request, other_org.id, db, admin_user
                )

        assert exc.value.status_code == 403
        from_url.assert_not_called()

    async def test_org_admin_still_gets_the_invite_list(
        self, mock_request, db, org, admin_user
    ):
        fake_redis = _fake_redis(["a@test.com", "b@test.com"])

        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=_redis_config(),
        ), patch(
            "src.services.orgs.users.redis.Redis.from_url",
            return_value=fake_redis,
        ):
            invited = await get_list_of_invited_users(
                mock_request, org.id, db, admin_user
            )

        assert [item["email"] for item in invited] == ["a@test.com", "b@test.com"]

    async def test_superadmin_still_gets_the_invite_list(
        self, mock_request, db, org, admin_user
    ):
        # Superadmins carry no admin membership row for every tenant; they are
        # allowed through by the is_user_superadmin bypass.
        outsider = await _outsider(db)
        fake_redis = _fake_redis(["c@test.com"])

        with patch(
            "src.services.orgs.users.get_learnhouse_config",
            return_value=_redis_config(),
        ), patch(
            "src.services.orgs.users.redis.Redis.from_url",
            return_value=fake_redis,
        ), patch(
            "src.services.orgs.users.is_org_member",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.security.superadmin.is_user_superadmin",
            new_callable=AsyncMock,
            return_value=True,
        ):
            invited = await get_list_of_invited_users(
                mock_request, org.id, db, outsider
            )

        assert [item["email"] for item in invited] == ["c@test.com"]


# ---------------------------------------------------------------------------
# F29 — playground usergroup listing
# ---------------------------------------------------------------------------


async def _playground_with_usergroup(db, org, owner_id):
    playground = Playground(
        org_id=org.id,
        name="Authz Playground",
        description="Desc",
        thumbnail_image="",
        access_type=PlaygroundAccessType.AUTHENTICATED,
        published=True,
        html_content="<div></div>",
        playground_uuid="pg_authz",
        created_by=owner_id,
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    usergroup = UserGroup(
        org_id=org.id,
        name="Secret Cohort",
        description="Internal cohort",
        usergroup_uuid="ug_authz",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(playground)
    db.add(usergroup)
    await db.commit()
    await db.refresh(usergroup)

    db.add(
        UserGroupResource(
            usergroup_id=usergroup.id,
            resource_uuid=playground.playground_uuid,
            org_id=org.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()
    return playground, usergroup


class TestPlaygroundUsergroupsAuthz:
    async def test_anonymous_caller_is_refused(
        self, mock_request, db, org, admin_user, anonymous_user
    ):
        playground, _ = await _playground_with_usergroup(db, org, admin_user.id)

        with pytest.raises(HTTPException) as exc:
            await get_playground_usergroups(
                mock_request, playground.playground_uuid, anonymous_user, db
            )

        assert exc.value.status_code == 401

    async def test_non_member_is_refused(
        self, mock_request, db, org, admin_user
    ):
        playground, _ = await _playground_with_usergroup(db, org, admin_user.id)
        outsider = await _outsider(db)

        # AUTHENTICATED access type, so _check_read_access lets them through —
        # the new rights gate is what refuses the cross-tenant read.
        with pytest.raises(HTTPException) as exc:
            await get_playground_usergroups(
                mock_request, playground.playground_uuid, outsider, db
            )

        assert exc.value.status_code == 403

    async def test_member_without_update_rights_is_refused(
        self, mock_request, db, org, admin_user, regular_user
    ):
        playground, _ = await _playground_with_usergroup(db, org, admin_user.id)

        with pytest.raises(HTTPException) as exc:
            await get_playground_usergroups(
                mock_request, playground.playground_uuid, regular_user, db
            )

        assert exc.value.status_code == 403

    async def test_authorized_caller_still_gets_the_usergroups(
        self, mock_request, db, org, admin_user
    ):
        playground, usergroup = await _playground_with_usergroup(
            db, org, admin_user.id
        )

        listed = await get_playground_usergroups(
            mock_request, playground.playground_uuid, admin_user, db
        )

        assert [item["usergroup_uuid"] for item in listed] == [
            usergroup.usergroup_uuid
        ]
        assert listed[0]["name"] == "Secret Cohort"

    async def test_missing_playground_still_404s(
        self, mock_request, db, org, admin_user
    ):
        with pytest.raises(HTTPException) as exc:
            await get_playground_usergroups(
                mock_request, "pg_does_not_exist", admin_user, db
            )

        assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# F35 — org search user projection
# ---------------------------------------------------------------------------

PII_FIELDS = ("email", "extra_metadata", "is_superadmin", "signup_method")


async def _make_target_user_pii(db):
    """Give the searchable admin user real PII so absence assertions bite."""
    user = (await db.execute(select(User).where(User.id == 1))).scalars().first()
    user.extra_metadata = {"custom_signup_answer": "top secret"}
    user.signup_method = "password"
    db.add(user)
    await db.commit()
    return user


@pytest.fixture
def search_app(db, regular_user):
    app = FastAPI()
    app.include_router(search_router, prefix="/api/v1/search")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: regular_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def search_client(search_app):
    async with AsyncClient(
        transport=ASGITransport(app=search_app), base_url="http://test"
    ) as c:
        yield c


class TestSearchUserProjection:
    async def test_member_search_hits_carry_no_pii(
        self, mock_request, db, org, admin_user, regular_user
    ):
        await _make_target_user_pii(db)

        with patch(
            "src.services.search.search.search_courses",
            new_callable=AsyncMock,
            return_value=[],
        ):
            result = await search_across_org(
                mock_request, regular_user, "test-org", "Admin", db
            )

        # Search still finds the user...
        assert "admin" in [u.username for u in result.users]
        assert result.total_users >= 1

        # ...but the projection is the stripped public one. Assert on absence
        # explicitly — this is the regression guard for F35.
        for hit in result.users:
            dumped = hit.model_dump()
            for field in PII_FIELDS:
                assert field not in dumped, f"{field} leaked from org search"
                assert not hasattr(hit, field)

    async def test_admin_search_hits_carry_no_pii_either(
        self, mock_request, db, org, admin_user
    ):
        await _make_target_user_pii(db)

        with patch(
            "src.services.search.search.search_courses",
            new_callable=AsyncMock,
            return_value=[],
        ):
            result = await search_across_org(
                mock_request, admin_user, "test-org", "Admin", db
            )

        assert "admin" in [u.username for u in result.users]
        for hit in result.users:
            dumped = hit.model_dump()
            assert not any(field in dumped for field in PII_FIELDS)

    @patch(
        "src.services.search.search.search_courses",
        new_callable=AsyncMock,
        return_value=[],
    )
    async def test_search_response_body_omits_pii(
        self, mock_search_courses, db, org, admin_user, regular_user, search_client
    ):
        await _make_target_user_pii(db)

        with patch(
            "src.routers.search.check_search_rate_limit",
            return_value=(True, 0),
        ):
            response = await search_client.get(
                "/api/v1/search/org_slug/test-org", params={"query": "Admin"}
            )

        assert response.status_code == 200
        body = response.json()
        assert [u["username"] for u in body["users"]] == ["admin"]
        for hit in body["users"]:
            for field in PII_FIELDS:
                assert field not in hit, f"{field} leaked on the wire"
            # The public profile fields the UI actually renders are still there.
            assert "user_uuid" in hit
            assert "avatar_image" in hit
