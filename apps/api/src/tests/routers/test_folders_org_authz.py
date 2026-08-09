"""Tenant-scoping tests for the org-scoped folders endpoints.

`/folders` is mounted without a router-level dependency, so `org_id` arrives as
a caller-chosen path parameter and the service layer is the only place the
tenant is ever checked. These tests pin that behaviour for the three org-scoped
readers (list / root / search) and the org-scoped root-content writes:

* a signed-in **non-member** is served exactly what an anonymous visitor is
  served — public folders and public resources, never private ones;
* a real **member** still sees the private rows (no regression);
* an **anonymous** visitor still sees the public rows (public library browsing
  keeps working);
* the org-scoped **writes** refuse a non-member outright.

RBAC (`check_resource_access`) and webhooks are stubbed so the membership gate
under test is the only thing deciding the outcome.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.folders.folders import Folder
from src.db.folders.folder_content import FolderContent
from src.db.roles import Role, RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, PublicUser, User
from src.routers.folders.folders import router
from src.security.auth import get_current_user


# ---------------------------------------------------------------------------
# App / client wiring — the acting principal is swapped per test.
# ---------------------------------------------------------------------------

@pytest.fixture
def acting():
    """Mutable holder so a test can pick the principal before each request."""
    return {"user": AnonymousUser()}


@pytest.fixture
def app(db, acting):
    application = FastAPI()
    application.include_router(router, prefix="/api/v1/folders")
    application.dependency_overrides[get_db_session] = lambda: db
    application.dependency_overrides[get_current_user] = lambda: acting["user"]
    yield application
    application.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture(autouse=True)
def _bypass_rbac_and_webhooks():
    with patch(
        "src.services.folders.folders.check_resource_access", new_callable=AsyncMock
    ), patch(
        "src.services.folders.folders.dispatch_webhooks", new_callable=AsyncMock
    ):
        yield


# ---------------------------------------------------------------------------
# Principals
# ---------------------------------------------------------------------------

@pytest.fixture
async def outsider_user(db, org, other_org):
    """A fully authenticated user who belongs to `other_org`, never to `org`.

    This is the attacker shape the fix targets: signed in, holds a role
    somewhere, and simply types another tenant's sequential org id into the URL.
    """
    role = Role(
        id=5,
        name="Other Admin",
        org_id=other_org.id,
        role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_other_admin",
        rights={},
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(role)
    await db.commit()

    u = User(
        id=42,
        username="outsider",
        first_name="Out",
        last_name="Sider",
        email="outsider@other.com",
        password="hashed_password",
        user_uuid="user_outsider",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(u)
    await db.commit()
    db.add(
        UserOrganization(
            user_id=u.id,
            org_id=other_org.id,
            role_id=role.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
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
# Seed data
# ---------------------------------------------------------------------------

def _course(name, uuid, org_id, public):
    return Course(
        name=name,
        description="",
        public=public,
        published=True,
        open_to_contributors=False,
        org_id=org_id,
        course_uuid=uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )


def _folder(name, uuid, org_id, public):
    return Folder(
        name=name,
        description="",
        public=public,
        org_id=org_id,
        folder_uuid=uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )


def _content(folder_id, resource_uuid, org_id, position=0):
    return FolderContent(
        folder_id=folder_id,
        resource_uuid=resource_uuid,
        org_id=org_id,
        position=position,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )


@pytest.fixture
async def library(db, org):
    """A "Sample" library in `org`: one public + one private folder, a public and
    a private course inside the public folder, and the same pair at the root."""
    pub_folder = _folder("Sample Public Folder", "folder_sample_pub", org.id, True)
    priv_folder = _folder("Sample Private Folder", "folder_sample_priv", org.id, False)
    db.add_all([pub_folder, priv_folder])
    await db.commit()
    await db.refresh(pub_folder)
    await db.refresh(priv_folder)

    db.add_all([
        _course("Sample Public Course", "course_sample_pub", org.id, True),
        _course("Sample Private Course", "course_sample_priv", org.id, False),
        _course("Sample Public Root", "course_sample_root_pub", org.id, True),
        _course("Sample Private Root", "course_sample_root_priv", org.id, False),
    ])
    await db.commit()

    db.add_all([
        _content(pub_folder.id, "course_sample_pub", org.id),
        _content(pub_folder.id, "course_sample_priv", org.id, 1),
        _content(None, "course_sample_root_pub", org.id),
        _content(None, "course_sample_root_priv", org.id, 1),
    ])
    await db.commit()
    return {"public": pub_folder, "private": priv_folder}


def _names(payload):
    return {f["name"] for f in payload}


def _uuids(items):
    return {i["resource_uuid"] for i in items}


# ---------------------------------------------------------------------------
# GET /org/{org_id}/page/{page}/limit/{limit}
# ---------------------------------------------------------------------------

class TestListFoldersTenantScope:
    async def test_non_member_gets_public_folders_only(
        self, client, acting, org, library, outsider_user
    ):
        acting["user"] = outsider_user
        res = await client.get(f"/api/v1/folders/org/{org.id}/page/1/limit/50")
        assert res.status_code == 200, res.text
        body = res.json()

        assert _names(body) == {"Sample Public Folder"}
        # ...and the private course inside the public folder must not leak either.
        public_folder = body[0]
        assert _uuids(public_folder["items"]) == {"course_sample_pub"}

    async def test_member_still_sees_private_folders(
        self, client, acting, org, library, admin_user
    ):
        acting["user"] = admin_user
        res = await client.get(f"/api/v1/folders/org/{org.id}/page/1/limit/50")
        assert res.status_code == 200, res.text
        body = res.json()

        assert "Sample Private Folder" in _names(body)
        public_folder = next(f for f in body if f["name"] == "Sample Public Folder")
        assert "course_sample_priv" in _uuids(public_folder["items"])

    async def test_anonymous_still_sees_public_folders(
        self, client, acting, org, library
    ):
        acting["user"] = AnonymousUser()
        res = await client.get(f"/api/v1/folders/org/{org.id}/page/1/limit/50")
        assert res.status_code == 200, res.text
        assert _names(res.json()) == {"Sample Public Folder"}


# ---------------------------------------------------------------------------
# GET /org/{org_id}/root
# ---------------------------------------------------------------------------

class TestOrgRootItemsTenantScope:
    async def test_non_member_gets_public_root_items_only(
        self, client, acting, org, library, outsider_user
    ):
        acting["user"] = outsider_user
        res = await client.get(f"/api/v1/folders/org/{org.id}/root")
        assert res.status_code == 200, res.text
        assert _uuids(res.json()) == {"course_sample_root_pub"}

    async def test_member_still_sees_private_root_items(
        self, client, acting, org, library, admin_user
    ):
        acting["user"] = admin_user
        res = await client.get(f"/api/v1/folders/org/{org.id}/root")
        assert res.status_code == 200, res.text
        assert _uuids(res.json()) == {
            "course_sample_root_pub",
            "course_sample_root_priv",
        }

    async def test_anonymous_still_sees_public_root_items(
        self, client, acting, org, library
    ):
        acting["user"] = AnonymousUser()
        res = await client.get(f"/api/v1/folders/org/{org.id}/root")
        assert res.status_code == 200, res.text
        assert _uuids(res.json()) == {"course_sample_root_pub"}


# ---------------------------------------------------------------------------
# GET /org/{org_id}/search
# ---------------------------------------------------------------------------

class TestSearchLibraryTenantScope:
    async def test_non_member_search_returns_public_only(
        self, client, acting, org, library, outsider_user
    ):
        acting["user"] = outsider_user
        res = await client.get(
            f"/api/v1/folders/org/{org.id}/search", params={"q": "Sample"}
        )
        assert res.status_code == 200, res.text
        body = res.json()

        assert _names(body["folders"]) == {"Sample Public Folder"}
        assert _uuids(body["items"]) == {
            "course_sample_pub",
            "course_sample_root_pub",
        }

    async def test_member_search_includes_private(
        self, client, acting, org, library, admin_user
    ):
        acting["user"] = admin_user
        res = await client.get(
            f"/api/v1/folders/org/{org.id}/search", params={"q": "Sample"}
        )
        assert res.status_code == 200, res.text
        body = res.json()

        assert "Sample Private Folder" in _names(body["folders"])
        assert "course_sample_priv" in _uuids(body["items"])
        assert "course_sample_root_priv" in _uuids(body["items"])

    async def test_anonymous_search_returns_public_only(
        self, client, acting, org, library
    ):
        acting["user"] = AnonymousUser()
        res = await client.get(
            f"/api/v1/folders/org/{org.id}/search", params={"q": "Sample"}
        )
        assert res.status_code == 200, res.text
        body = res.json()

        assert _names(body["folders"]) == {"Sample Public Folder"}
        assert "course_sample_priv" not in _uuids(body["items"])


# ---------------------------------------------------------------------------
# Org-scoped writes — "folder_x" carries no org, so membership is the only gate.
# ---------------------------------------------------------------------------

class TestOrgScopedWrites:
    async def test_non_member_cannot_add_to_another_orgs_root(
        self, client, acting, org, library, outsider_user
    ):
        acting["user"] = outsider_user
        res = await client.post(
            f"/api/v1/folders/org/{org.id}/content",
            params={"resource_uuid": "course_sample_pub"},
        )
        assert res.status_code == 403, res.text

    async def test_member_can_still_add_to_root(
        self, client, acting, org, library, admin_user
    ):
        acting["user"] = admin_user
        res = await client.post(
            f"/api/v1/folders/org/{org.id}/content",
            params={"resource_uuid": "course_sample_pub"},
        )
        assert res.status_code == 200, res.text
        assert res.json()["resource_uuid"] == "course_sample_pub"

    async def test_non_member_cannot_remove_from_another_orgs_root(
        self, client, acting, org, library, outsider_user
    ):
        acting["user"] = outsider_user
        res = await client.request(
            "DELETE",
            f"/api/v1/folders/org/{org.id}/content",
            params={"resource_uuid": "course_sample_root_pub"},
        )
        assert res.status_code == 403, res.text

        # The placement survived the refused call.
        acting["user"] = AnonymousUser()
        listed = await client.get(f"/api/v1/folders/org/{org.id}/root")
        assert "course_sample_root_pub" in _uuids(listed.json())

    async def test_member_can_still_remove_from_root(
        self, client, acting, org, library, admin_user
    ):
        acting["user"] = admin_user
        res = await client.request(
            "DELETE",
            f"/api/v1/folders/org/{org.id}/content",
            params={"resource_uuid": "course_sample_root_pub"},
        )
        assert res.status_code == 200, res.text

    async def test_non_member_cannot_create_a_folder_in_another_org(
        self, client, acting, org, outsider_user
    ):
        acting["user"] = outsider_user
        res = await client.post(
            "/api/v1/folders/", json={"name": "Planted", "org_id": org.id}
        )
        assert res.status_code == 403, res.text

    async def test_member_can_still_create_a_folder(
        self, client, acting, org, admin_user
    ):
        acting["user"] = admin_user
        res = await client.post(
            "/api/v1/folders/", json={"name": "Legit", "org_id": org.id}
        )
        assert res.status_code == 200, res.text
        assert res.json()["name"] == "Legit"
