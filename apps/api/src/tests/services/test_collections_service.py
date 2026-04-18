"""
Tests for src/services/courses/collections.py

Covers: get_collection, create_collection, update_collection,
        delete_collection, get_collections.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.collections import Collection, CollectionCreate, CollectionRead, CollectionUpdate
from src.db.collections_courses import CollectionCourse
from src.db.courses.courses import Course
from src.services.courses.collections import (
    create_collection,
    delete_collection,
    get_collection,
    get_collections,
    update_collection,
)


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


def _link_course_to_collection(db, collection, course, org):
    """Helper to create a CollectionCourse join row."""
    link = CollectionCourse(
        collection_id=collection.id,
        course_id=course.id,
        org_id=org.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(link)
    db.commit()


class TestGetCollection:
    """Tests for get_collection()."""

    @pytest.mark.asyncio
    async def test_get_collection_found(
        self, db, org, course, collection, admin_user, mock_request, bypass_rbac
    ):
        result = await get_collection(
            mock_request, "collection_test", admin_user, db
        )

        assert isinstance(result, CollectionRead)
        assert result.name == "Test Collection"
        assert len(result.courses) == 1

    @pytest.mark.asyncio
    async def test_get_collection_not_found(
        self, db, org, admin_user, mock_request, bypass_rbac
    ):
        with pytest.raises(HTTPException) as exc_info:
            await get_collection(
                mock_request, "nonexistent_uuid", admin_user, db
            )

        assert exc_info.value.status_code == 409

    @pytest.mark.asyncio
    async def test_get_collection_anonymous_only_public_courses(
        self, db, org, course, collection, anonymous_user, mock_request,
        bypass_rbac,
    ):
        private_course = _make_course(
            db, org, id=50, name="Private Course",
            course_uuid="course_private", public=False,
        )
        _link_course_to_collection(db, collection, private_course, org)

        result = await get_collection(
            mock_request, "collection_test", anonymous_user, db
        )

        course_ids = [c.id for c in result.courses]
        assert course.id in course_ids
        assert private_course.id not in course_ids


class TestCreateCollection:
    """Tests for create_collection()."""

    @pytest.mark.asyncio
    async def test_create_collection(
        self, db, org, course, admin_user, mock_request, bypass_rbac,
        bypass_webhooks,
    ):
        payload = CollectionCreate(
            name="New Collection",
            description="Brand new",
            public=True,
            courses=[course.id],
            org_id=org.id,
        )

        result = await create_collection(
            mock_request, payload, admin_user, db
        )

        assert isinstance(result, CollectionRead)
        assert result.name == "New Collection"
        assert len(result.courses) == 1

        # Verify persisted in DB
        stored = db.exec(
            select(Collection).where(
                Collection.collection_uuid == result.collection_uuid
            )
        ).first()
        assert stored is not None


    @pytest.mark.asyncio
    async def test_create_collection_course_access_denied_raises_403(
        self, db, org, course, admin_user, mock_request, bypass_webhooks
    ):
        payload = CollectionCreate(
            name="Forbidden Collection",
            description="",
            public=True,
            courses=[course.id],
            org_id=org.id,
        )

        with patch(
            "src.services.courses.collections.check_resource_access",
            new_callable=AsyncMock,
            side_effect=[None, HTTPException(status_code=403, detail="Forbidden")],
        ):
            with pytest.raises(HTTPException) as exc_info:
                await create_collection(mock_request, payload, admin_user, db)

        assert exc_info.value.status_code == 403


class TestUpdateCollection:
    """Tests for update_collection()."""

    @pytest.mark.asyncio
    async def test_update_collection_name(
        self, db, org, course, collection, admin_user, mock_request,
        bypass_rbac,
    ):
        payload = CollectionUpdate(name="Updated Name", courses=[course.id])

        result = await update_collection(
            mock_request, payload, "collection_test", admin_user, db
        )

        assert result.name == "Updated Name"

    @pytest.mark.asyncio
    async def test_update_collection_not_found(
        self, db, org, admin_user, mock_request, bypass_rbac
    ):
        payload = CollectionUpdate(name="X", courses=[])

        with pytest.raises(HTTPException) as exc_info:
            await update_collection(
                mock_request, payload, "nonexistent_uuid", admin_user, db
            )

        assert exc_info.value.status_code == 409


class TestDeleteCollection:
    """Tests for delete_collection()."""

    @pytest.mark.asyncio
    async def test_delete_collection(
        self, db, org, course, collection, admin_user, mock_request,
        bypass_rbac,
    ):
        result = await delete_collection(
            mock_request, "collection_test", admin_user, db
        )

        assert result == {"detail": "Collection deleted"}

        remaining = db.get(Collection, 1)
        assert remaining is None

    @pytest.mark.asyncio
    async def test_delete_collection_not_found(
        self, db, org, admin_user, mock_request, bypass_rbac
    ):
        with pytest.raises(HTTPException) as exc_info:
            await delete_collection(
                mock_request, "nonexistent_uuid", admin_user, db
            )

        assert exc_info.value.status_code == 404


class TestGetCollections:
    """Tests for get_collections()."""

    @pytest.mark.asyncio
    async def test_get_collections_authenticated(
        self, db, org, course, collection, admin_user, mock_request,
        bypass_rbac,
    ):
        result = await get_collections(
            mock_request, org.id, admin_user, db
        )

        assert len(result) >= 1
        names = [c.name for c in result]
        assert "Test Collection" in names

    @pytest.mark.asyncio
    async def test_get_collections_empty_org_returns_empty_list(
        self, db, other_org, admin_user, mock_request, bypass_rbac
    ):
        result = await get_collections(mock_request, other_org.id, admin_user, db)
        assert result == []

    @pytest.mark.asyncio
    async def test_get_collections_anonymous_only_public(
        self, db, org, course, collection, anonymous_user, mock_request,
        bypass_rbac,
    ):
        _make_collection(
            db, org, id=60, name="Private Collection",
            collection_uuid="collection_private", public=False,
        )

        result = await get_collections(
            mock_request, org.id, anonymous_user, db
        )

        names = [c.name for c in result]
        assert "Test Collection" in names
        assert "Private Collection" not in names
