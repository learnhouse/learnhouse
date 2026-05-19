"""Service-level tests for the Activity.extra_metadata JSONB field."""

import io
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import UploadFile
from sqlmodel import select
from starlette.datastructures import Headers

from src.db.courses.activities import (
    Activity,
    ActivityCreate,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
    ActivityUpdate,
)
from src.services.courses.activities.activities import (
    create_activity,
    update_activity,
)
from src.services.courses.activities.pdf import create_documentpdf_activity


@pytest.fixture
def bypass_activity_rbac():
    """Patches check_resource_access where activity services import it."""
    with patch(
        "src.services.courses.activities.activities.check_resource_access",
        new_callable=AsyncMock,
    ), patch(
        "src.services.courses.activities.pdf.check_resource_access",
        new_callable=AsyncMock,
    ):
        yield


@pytest.mark.asyncio
async def test_create_activity_with_extra_metadata(
    db, org, course, chapter, admin_user, mock_request, bypass_activity_rbac
):
    payload = ActivityCreate(
        name="a",
        chapter_id=chapter.id,
        extra_metadata={"x": 1},
    )

    created = await create_activity(mock_request, payload, admin_user, db)

    assert created.extra_metadata == {"x": 1}

    row = (await db.execute(select(Activity).where(Activity.id == created.id))).scalars().first()
    assert row is not None
    assert row.extra_metadata == {"x": 1}


@pytest.mark.asyncio
async def test_update_activity_clears_extra_metadata(
    db, org, course, chapter, activity, admin_user, mock_request, bypass_activity_rbac
):
    # Start from non-None metadata so we can prove None clears it.
    activity.extra_metadata = {"prior": "value"}
    db.add(activity)
    await db.commit()
    await db.refresh(activity)
    assert activity.extra_metadata == {"prior": "value"}

    # Build via model_validate so extra_metadata=None is *set* (not default).
    update_obj = ActivityUpdate.model_validate({"extra_metadata": None})
    assert "extra_metadata" in update_obj.model_fields_set

    updated = await update_activity(
        mock_request, update_obj, activity.activity_uuid, admin_user, db
    )

    assert updated.extra_metadata is None

    await db.execute(select(Activity).where(Activity.id == activity.id))  # flush expired state
    row = (await db.execute(select(Activity).where(Activity.id == activity.id))).scalars().first()
    assert row.extra_metadata is None


@pytest.mark.asyncio
async def test_update_activity_sets_extra_metadata(
    db, org, course, chapter, activity, admin_user, mock_request, bypass_activity_rbac
):
    assert activity.extra_metadata is None

    updated = await update_activity(
        mock_request,
        ActivityUpdate(extra_metadata={"k": [1, 2, 3], "flag": True}),
        activity.activity_uuid,
        admin_user,
        db,
    )

    assert updated.extra_metadata == {"k": [1, 2, 3], "flag": True}

    row = (await db.execute(select(Activity).where(Activity.id == activity.id))).scalars().first()
    assert row.extra_metadata == {"k": [1, 2, 3], "flag": True}


@pytest.mark.asyncio
async def test_create_documentpdf_activity_passes_extra_metadata(
    db, org, course, chapter, admin_user, mock_request, bypass_activity_rbac
):
    pdf_file = UploadFile(
        filename="x.pdf",
        file=io.BytesIO(b"%PDF-1.4 stub"),
        headers=Headers({"content-type": "application/pdf"}),
    )

    with patch(
        "src.services.courses.activities.pdf.upload_pdf",
        new_callable=AsyncMock,
        return_value="x.pdf",
    ) as mock_upload:
        created = await create_documentpdf_activity(
            mock_request,
            name="pdf-activity",
            chapter_id=str(chapter.id),
            current_user=admin_user,
            db_session=db,
            pdf_file=pdf_file,
            extra_metadata={"source": "upload", "page_count": 3},
        )

    mock_upload.assert_awaited_once()
    assert created.extra_metadata == {"source": "upload", "page_count": 3}
    assert created.activity_type == ActivityTypeEnum.TYPE_DOCUMENT
    assert created.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_DOCUMENT_PDF

    row = (await db.execute(select(Activity).where(Activity.id == created.id))).scalars().first()
    assert row is not None
    assert row.extra_metadata == {"source": "upload", "page_count": 3}
