"""
Tests for src/services/search/search.py

Covers: _escape_like_wildcards, search_across_org (collections, users,
        anonymous vs authenticated visibility).
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.db.collections import Collection
from src.db.users import APITokenUser
from src.db.courses.courses import Course
from src.db.collections_courses import CollectionCourse
from src.db.playgrounds import Playground, PlaygroundAccessType
from src.services.search.search import SearchResult, _escape_like_wildcards, search_across_org


def _make_course(db, org, *, id, name="Extra Course", course_uuid=None,
                 public=True, published=True):
    """Helper to insert an additional course."""
    c = Course(
        id=id,
        name=name,
        description=f"Description for {name}",
        public=public,
        published=published,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid=course_uuid or f"course_{id}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def _make_collection(db, org, *, id, name="Extra Collection",
                     collection_uuid=None, public=True):
    """Helper to insert an additional collection."""
    c = Collection(
        id=id,
        name=name,
        description=f"Description for {name}",
        public=public,
        org_id=org.id,
        collection_uuid=collection_uuid or f"collection_{id}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


class TestEscapeLikeWildcards:
    """Tests for _escape_like_wildcards()."""

    def test_escape_like_wildcards(self):
        assert _escape_like_wildcards("hello") == "hello"
        assert _escape_like_wildcards("100%") == "100\\%"
        assert _escape_like_wildcards("under_score") == "under\\_score"
        assert _escape_like_wildcards("back\\slash") == "back\\\\slash"
        # Combined
        assert _escape_like_wildcards("%_\\") == "\\%\\_\\\\"


class TestSearchAcrossOrg:
    """Tests for search_across_org()."""

    @pytest.mark.asyncio
    async def test_search_nonexistent_org_returns_empty(
        self, db, org, anonymous_user, mock_request
    ):
        with patch(
            "src.services.search.search.search_courses",
            new_callable=AsyncMock, return_value=[],
        ):
            result = await search_across_org(
                mock_request, anonymous_user, "fake-org", "anything", db
            )

        assert isinstance(result, SearchResult)
        assert result.courses == []
        assert result.collections == []
        assert result.users == []

    @pytest.mark.asyncio
    async def test_search_finds_collections_by_name(
        self, db, org, anonymous_user, mock_request
    ):
        _make_collection(
            db, org, id=70, name="Searchable Bundle",
            collection_uuid="collection_searchable", public=True,
        )

        with patch(
            "src.services.search.search.search_courses",
            new_callable=AsyncMock, return_value=[],
        ):
            result = await search_across_org(
                mock_request, anonymous_user, "test-org", "Searchable", db
            )

        collection_names = [c.name for c in result.collections]
        assert "Searchable Bundle" in collection_names

    @pytest.mark.asyncio
    async def test_search_anonymous_no_users(
        self, db, org, admin_user, anonymous_user, mock_request
    ):
        with patch(
            "src.services.search.search.search_courses",
            new_callable=AsyncMock, return_value=[],
        ):
            result = await search_across_org(
                mock_request, anonymous_user, "test-org", "admin", db
            )

        assert result.users == []

    @pytest.mark.asyncio
    async def test_search_authenticated_finds_users(
        self, db, org, admin_user, mock_request
    ):
        with patch(
            "src.services.search.search.search_courses",
            new_callable=AsyncMock, return_value=[],
        ), patch(
            "src.services.search.search.is_org_member",
            return_value=True,
        ):
            result = await search_across_org(
                mock_request, admin_user, "test-org", "Admin", db
            )

        usernames = [u.username for u in result.users]
        assert "admin" in usernames

    @pytest.mark.asyncio
    async def test_search_authenticated_non_member_no_users(
        self, db, org, admin_user, mock_request
    ):
        with patch(
            "src.services.search.search.search_courses",
            new_callable=AsyncMock, return_value=[],
        ), patch(
            "src.services.search.search.is_org_member",
            return_value=False,
        ):
            result = await search_across_org(
                mock_request, admin_user, "test-org", "Admin", db
            )

        assert result.users == []

    @pytest.mark.asyncio
    async def test_search_api_token_without_rights_skips_token_check(
        self, db, org, mock_request
    ):
        token_user = APITokenUser(org_id=org.id, rights=None, token_name="demo")

        with patch(
            "src.services.search.search.search_courses",
            new_callable=AsyncMock,
            return_value=[],
        ), patch(
            "src.services.search.search.is_org_member",
            return_value=False,
        ):
            result = await search_across_org(
                mock_request, token_user, "test-org", "Test", db
            )

        assert result.courses == []
        assert result.collections == []
        assert result.users == []

    @pytest.mark.asyncio
    async def test_search_api_token_rejects_cross_org_access(
        self, db, org, mock_request
    ):
        token_user = APITokenUser(
            org_id=999,
            rights={"search": {"action_read": True}},
            token_name="demo",
        )

        with patch(
            "src.services.search.search.search_courses",
            new_callable=AsyncMock,
            return_value=[],
        ):
            with pytest.raises(Exception) as exc_info:
                await search_across_org(
                    mock_request, token_user, "test-org", "Test", db
                )

        assert getattr(exc_info.value, "status_code", None) == 403

    @pytest.mark.asyncio
    async def test_search_api_token_dict_rights_branches(
        self, db, org, mock_request
    ):
        allowed_token = APITokenUser(
            org_id=org.id,
            rights={"search": {"action_read": True}},
            token_name="demo",
        )
        denied_token = APITokenUser(
            org_id=org.id,
            rights={"search": {"action_read": False}},
            token_name="demo",
        )

        with patch(
            "src.services.search.search.search_courses",
            new_callable=AsyncMock,
            return_value=[],
        ), patch(
            "src.services.search.search.is_org_member",
            return_value=False,
        ):
            allowed = await search_across_org(
                mock_request, allowed_token, "test-org", "Test", db
            )

        assert allowed.users == []

        with patch(
            "src.services.search.search.search_courses",
            new_callable=AsyncMock,
            return_value=[],
        ):
            with pytest.raises(Exception) as exc_info:
                await search_across_org(
                    mock_request, denied_token, "test-org", "Test", db
                )

        assert getattr(exc_info.value, "status_code", None) == 403

    @pytest.mark.asyncio
    async def test_search_api_token_object_rights_branches(
        self, db, org, mock_request
    ):
        allowed_token = APITokenUser(
            org_id=org.id,
            rights={},
            token_name="demo",
        )
        allowed_token.rights = SimpleNamespace(
            search=SimpleNamespace(action_read=True)
        )
        denied_token = APITokenUser(
            org_id=org.id,
            rights={},
            token_name="demo",
        )
        denied_token.rights = SimpleNamespace(
            search=SimpleNamespace(action_read=False)
        )

        with patch(
            "src.services.search.search.search_courses",
            new_callable=AsyncMock,
            return_value=[],
        ), patch(
            "src.services.search.search.is_org_member",
            return_value=False,
        ):
            allowed = await search_across_org(
                mock_request, allowed_token, "test-org", "Test", db
            )

        assert allowed.collections == []

        with patch(
            "src.services.search.search.search_courses",
            new_callable=AsyncMock,
            return_value=[],
        ):
            with pytest.raises(Exception) as exc_info:
                await search_across_org(
                    mock_request, denied_token, "test-org", "Test", db
                )

        assert getattr(exc_info.value, "status_code", None) == 403

    @pytest.mark.asyncio
    async def test_search_finds_playgrounds_by_name(
        self, db, org, anonymous_user, mock_request
    ):
        pg = Playground(
            id=80,
            name="Searchable Playground",
            description="A public playground",
            access_type=PlaygroundAccessType.PUBLIC,
            published=True,
            org_id=org.id,
            playground_uuid="pg_searchable",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(pg)
        db.commit()

        with patch(
            "src.services.search.search.search_courses",
            new_callable=AsyncMock,
            return_value=[],
        ):
            result = await search_across_org(
                mock_request, anonymous_user, "test-org", "Searchable Playground", db
            )

        playground_names = [p.name for p in result.playgrounds]
        assert "Searchable Playground" in playground_names

    @pytest.mark.asyncio
    async def test_search_deduplicates_collection_courses(
        self, db, org, anonymous_user, mock_request, collection, course
    ):
        db.add(
            CollectionCourse(
                collection_id=collection.id,
                course_id=course.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        with patch(
            "src.services.search.search.search_courses",
            new_callable=AsyncMock,
            return_value=[],
        ):
            result = await search_across_org(
                mock_request, anonymous_user, "test-org", "Test", db
            )

        assert len(result.collections) == 1
        assert len(result.collections[0].courses) == 1
