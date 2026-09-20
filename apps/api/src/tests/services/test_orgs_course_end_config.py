"""
Tests for update_org_course_end_config in src/services/orgs/orgs.py

Covers the course-completion screen config writer: v2 configs store it under
`customization.course_end`, v1 under `general.course_end`, the link allowlist,
the missing-org / missing-config guards, and the router endpoint.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.organizations import OrganizationConfig
from src.routers.orgs.orgs import router as orgs_router
from src.security.auth import get_current_user
from src.services.orgs.orgs import update_org_course_end_config


async def _load_config(db, org_id):
    return (
        await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org_id))
    ).scalars().first()


_COURSE_END = {
    "message": "  Pick your next course from the library.  ",
    "button_text": "Browse the library",
    "button_link": "/courses",
}


async def _make_config(db, org, config):
    row = OrganizationConfig(
        org_id=org.id,
        config=config,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@pytest.fixture(autouse=True)
def _bypass_rbac():
    with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock, return_value=True):
        yield


class TestUpdateOrgCourseEndConfig:
    @pytest.mark.asyncio
    async def test_v2_config_stores_under_customization(self, db, org, admin_user, mock_request):
        await _make_config(db, org, {"config_version": "2.0", "customization": {}})
        result = await update_org_course_end_config(mock_request, _COURSE_END, org.id, admin_user, db)
        assert result["detail"] == "Course end configuration updated"

        row = await _load_config(db, org.id)
        stored = row.config["customization"]["course_end"]
        assert stored == {
            "message": "Pick your next course from the library.",
            "button_text": "Browse the library",
            "button_link": "/courses",
        }

    @pytest.mark.asyncio
    async def test_v1_config_stores_under_general(self, db, org, admin_user, mock_request):
        await _make_config(db, org, {"config_version": "1.4", "general": {"enabled": True}})
        await update_org_course_end_config(mock_request, _COURSE_END, org.id, admin_user, db)

        row = await _load_config(db, org.id)
        assert row.config["general"]["course_end"]["button_link"] == "/courses"

    @pytest.mark.asyncio
    async def test_empty_payload_resets_to_defaults(self, db, org, admin_user, mock_request):
        await _make_config(db, org, {"config_version": "2.0", "customization": {"course_end": _COURSE_END}})
        await update_org_course_end_config(mock_request, {}, org.id, admin_user, db)

        row = await _load_config(db, org.id)
        assert row.config["customization"]["course_end"] == {
            "message": "",
            "button_text": "",
            "button_link": "",
        }

    @pytest.mark.asyncio
    async def test_unknown_keys_are_dropped(self, db, org, admin_user, mock_request):
        await _make_config(db, org, {"config_version": "2.0", "customization": {}})
        await update_org_course_end_config(
            mock_request, {**_COURSE_END, "html": "<script>"}, org.id, admin_user, db
        )

        row = await _load_config(db, org.id)
        assert "html" not in row.config["customization"]["course_end"]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "link",
        ["https://example.com/next", "HTTP://example.com", "/course/abc", "/"],
    )
    async def test_allowed_links(self, db, org, admin_user, mock_request, link):
        await _make_config(db, org, {"config_version": "2.0", "customization": {}})
        await update_org_course_end_config(
            mock_request, {**_COURSE_END, "button_link": link}, org.id, admin_user, db
        )

        row = await _load_config(db, org.id)
        assert row.config["customization"]["course_end"]["button_link"] == link

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "link",
        ["javascript:alert(1)", "//evil.example", "data:text/html,x", "courses", " JavaScript:alert(1)"],
    )
    async def test_rejected_links(self, db, org, admin_user, mock_request, link):
        await _make_config(db, org, {"config_version": "2.0", "customization": {}})
        with pytest.raises(HTTPException) as exc:
            await update_org_course_end_config(
                mock_request, {**_COURSE_END, "button_link": link}, org.id, admin_user, db
            )
        assert exc.value.status_code == 400

        row = await _load_config(db, org.id)
        assert "course_end" not in row.config["customization"]

    @pytest.mark.asyncio
    async def test_too_long_message_400(self, db, org, admin_user, mock_request):
        await _make_config(db, org, {"config_version": "2.0", "customization": {}})
        with pytest.raises(HTTPException) as exc:
            await update_org_course_end_config(
                mock_request, {"message": "x" * 501}, org.id, admin_user, db
            )
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_missing_org_404(self, db, admin_user, mock_request):
        with pytest.raises(HTTPException) as exc:
            await update_org_course_end_config(mock_request, _COURSE_END, 999999, admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_missing_config_404(self, db, org, admin_user, mock_request):
        with pytest.raises(HTTPException) as exc:
            await update_org_course_end_config(mock_request, _COURSE_END, org.id, admin_user, db)
        assert exc.value.status_code == 404


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(orgs_router, prefix="/api/v1/orgs")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class TestCourseEndConfigEndpoint:
    @pytest.mark.asyncio
    async def test_put_updates_config(self, client, db, org):
        await _make_config(db, org, {"config_version": "2.0", "customization": {}})
        response = await client.put(
            f"/api/v1/orgs/{org.id}/config/course-end", json=_COURSE_END
        )
        assert response.status_code == 200
        assert response.json()["detail"] == "Course end configuration updated"

    @pytest.mark.asyncio
    async def test_put_rejects_unsafe_link(self, client, db, org):
        await _make_config(db, org, {"config_version": "2.0", "customization": {}})
        response = await client.put(
            f"/api/v1/orgs/{org.id}/config/course-end",
            json={"button_link": "javascript:alert(1)"},
        )
        assert response.status_code == 400
