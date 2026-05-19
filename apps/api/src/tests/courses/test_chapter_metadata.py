"""Service-level tests for the Chapter.extra_metadata JSONB field."""

from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import select

from src.db.courses.chapters import Chapter, ChapterCreate, ChapterUpdate
from src.services.courses.chapters import (
    create_chapter,
    get_chapter,
    update_chapter,
)


@pytest.fixture
def bypass_rbac():
    with patch(
        "src.services.courses.chapters.check_resource_access",
        new_callable=AsyncMock,
    ):
        yield


@pytest.mark.asyncio
async def test_create_chapter_with_extra_metadata(
    db, org, course, admin_user, mock_request, bypass_rbac
):
    payload = ChapterCreate(
        course_id=course.id,
        org_id=org.id,
        name="ch",
        extra_metadata={"a": 1},
    )

    created = await create_chapter(mock_request, payload, admin_user, db)

    assert created.extra_metadata == {"a": 1}

    row = (await db.execute(select(Chapter).where(Chapter.id == created.id))).scalars().first()
    assert row is not None
    assert row.extra_metadata == {"a": 1}


@pytest.mark.asyncio
async def test_update_chapter_sets_extra_metadata(
    db, org, course, chapter, admin_user, mock_request, bypass_rbac
):
    assert chapter.extra_metadata is None

    updated = await update_chapter(
        mock_request,
        ChapterUpdate(extra_metadata={"b": 2}),
        chapter.id,
        admin_user,
        db,
    )

    assert updated.extra_metadata == {"b": 2}

    row = (await db.execute(select(Chapter).where(Chapter.id == chapter.id))).scalars().first()
    assert row.extra_metadata == {"b": 2}


@pytest.mark.asyncio
async def test_update_chapter_does_not_clobber_when_omitted(
    db, org, course, chapter, admin_user, mock_request, bypass_rbac
):
    chapter.extra_metadata = {"prior": "value"}
    db.add(chapter)
    await db.commit()

    updated = await update_chapter(
        mock_request,
        ChapterUpdate(name="renamed"),
        chapter.id,
        admin_user,
        db,
    )

    assert updated.name == "renamed"
    assert updated.extra_metadata == {"prior": "value"}

    row = (await db.execute(select(Chapter).where(Chapter.id == chapter.id))).scalars().first()
    assert row.extra_metadata == {"prior": "value"}


@pytest.mark.asyncio
async def test_chapter_read_round_trips_extra_metadata(
    db, org, course, admin_user, mock_request, bypass_rbac
):
    payload = ChapterCreate(
        course_id=course.id,
        org_id=org.id,
        name="round-trip",
        extra_metadata={"nested": {"k": [1, 2, 3]}, "flag": True},
    )
    created = await create_chapter(mock_request, payload, admin_user, db)

    fetched = await get_chapter(mock_request, created.id, admin_user, db)

    assert fetched.id == created.id
    assert fetched.extra_metadata == {"nested": {"k": [1, 2, 3]}, "flag": True}
