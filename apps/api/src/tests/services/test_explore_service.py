"""Tests for src/services/explore/explore.py."""

import pytest
from fastapi import HTTPException

from src.services.explore.explore import (
    get_course_for_explore,
    get_courses_for_an_org_explore,
    get_org_for_explore,
    get_orgs_for_explore,
    search_orgs_for_explore,
)


class TestGetOrgsForExplore:
    @pytest.mark.asyncio
    async def test_returns_empty_when_no_explore_orgs(self, mock_request, db, org):
        result = await get_orgs_for_explore(mock_request, db)
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_explore_orgs(self, mock_request, db, org):
        from src.db.organizations import Organization
        from sqlmodel import select

        org_row = (await db.execute(select(Organization).where(Organization.id == org.id))).scalars().first()
        org_row.explore = True
        db.add(org_row)
        await db.commit()

        result = await get_orgs_for_explore(mock_request, db)
        assert len(result) == 1
        assert result[0].slug == "test-org"

    @pytest.mark.asyncio
    async def test_label_filter(self, mock_request, db, org):
        from src.db.organizations import Organization
        from sqlmodel import select

        org_row = (await db.execute(select(Organization).where(Organization.id == org.id))).scalars().first()
        org_row.explore = True
        org_row.label = "tech"
        db.add(org_row)
        await db.commit()

        result_matching = await get_orgs_for_explore(mock_request, db, label="tech")
        result_not_matching = await get_orgs_for_explore(mock_request, db, label="other")
        assert len(result_matching) == 1
        assert len(result_not_matching) == 0

    @pytest.mark.asyncio
    async def test_enforces_max_limit(self, mock_request, db):
        result = await get_orgs_for_explore(mock_request, db, limit=9999)
        assert isinstance(result, list)


class TestGetCoursesForAnOrgExplore:
    @pytest.mark.asyncio
    async def test_returns_public_courses(self, mock_request, db, org, course):
        result = await get_courses_for_an_org_explore(
            mock_request, db, org_uuid=org.org_uuid
        )
        assert len(result) == 1
        assert result[0].name == "Test Course"

    @pytest.mark.asyncio
    async def test_raises_404_for_unknown_org(self, mock_request, db):
        with pytest.raises(HTTPException) as exc:
            await get_courses_for_an_org_explore(
                mock_request, db, org_uuid="nonexistent-uuid"
            )
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_public_courses(self, mock_request, db, org):
        result = await get_courses_for_an_org_explore(
            mock_request, db, org_uuid=org.org_uuid
        )
        assert isinstance(result, list)


class TestGetOrgForExplore:
    @pytest.mark.asyncio
    async def test_returns_org(self, mock_request, db, org):
        result = await get_org_for_explore(mock_request, "test-org", db)
        assert result.slug == "test-org"
        assert result.name == "Test Org"

    @pytest.mark.asyncio
    async def test_raises_404_for_unknown_slug(self, mock_request, db):
        with pytest.raises(HTTPException) as exc:
            await get_org_for_explore(mock_request, "nonexistent", db)
        assert exc.value.status_code == 404


class TestGetCourseForExplore:
    @pytest.mark.asyncio
    async def test_returns_course_with_no_authors(self, mock_request, db, org, course):
        result = await get_course_for_explore(mock_request, course.id, db)
        assert result.name == "Test Course"
        assert result.authors == []

    @pytest.mark.asyncio
    async def test_raises_404_for_unknown_course(self, mock_request, db):
        with pytest.raises(HTTPException) as exc:
            await get_course_for_explore(mock_request, 9999, db)
        assert exc.value.status_code == 404


class TestSearchOrgsForExplore:
    @pytest.mark.asyncio
    async def test_returns_empty_for_no_match(self, mock_request, db, org):
        result = await search_orgs_for_explore(mock_request, db, search_query="zzznomatch")
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_matching_explore_orgs(self, mock_request, db, org):
        from src.db.organizations import Organization
        from sqlmodel import select

        org_row = (await db.execute(select(Organization).where(Organization.id == org.id))).scalars().first()
        org_row.explore = True
        db.add(org_row)
        await db.commit()

        result = await search_orgs_for_explore(mock_request, db, search_query="Test Org")
        assert len(result) == 1
