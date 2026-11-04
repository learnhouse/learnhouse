"""Guard branches of the media block services (video, audio, image, pdf).

Covers the 404s raised when a block's activity or course has gone missing,
the org-membership gate on private-course reads, and the file-type mapping
in upload_file_and_return_file_object. Storage uploads and RBAC are mocked.
"""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException, UploadFile

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.blocks import Block, BlockRead, BlockTypeEnum
from src.db.courses.courses import Course
from src.services.blocks.block_types.audioBlock import audioBlock
from src.services.blocks.block_types.imageBlock import imageBlock
from src.services.blocks.block_types.pdfBlock import pdfBlock
from src.services.blocks.block_types.videoBlock import videoBlock
from src.services.blocks.utils.upload_files import upload_file_and_return_file_object


CREATE_CASES = [
    ("video", videoBlock, videoBlock.create_video_block),
    ("audio", audioBlock, audioBlock.create_audio_block),
    ("image", imageBlock, imageBlock.create_image_block),
    ("pdf", pdfBlock, pdfBlock.create_pdf_block),
]

GET_CASES = [
    ("video", videoBlock, videoBlock.get_video_block, BlockTypeEnum.BLOCK_VIDEO),
    ("audio", audioBlock, audioBlock.get_audio_block, BlockTypeEnum.BLOCK_AUDIO),
    ("image", imageBlock, imageBlock.get_image_block, BlockTypeEnum.BLOCK_IMAGE),
    ("pdf", pdfBlock, pdfBlock.get_pdf_block, BlockTypeEnum.BLOCK_DOCUMENT_PDF),
]


def _upload() -> MagicMock:
    uf = MagicMock(spec=UploadFile)
    uf.filename = "file.bin"
    return uf


async def _add_activity(db, *, uuid: str, org_id: int, course_id: int) -> Activity:
    a = Activity(
        name="A",
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={"type": "doc", "content": []},
        published=True,
        org_id=org_id,
        course_id=course_id,
        activity_uuid=uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


async def _add_block(db, *, uuid: str, org_id: int, course_id: int, activity_id: int, block_type) -> Block:
    b = Block(
        block_type=block_type,
        content={"file_id": "x"},
        org_id=org_id,
        course_id=course_id,
        activity_id=activity_id,
        block_uuid=uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(b)
    await db.commit()
    await db.refresh(b)
    return b


# ---------------------------------------------------------------------------
# create_*_block
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("label,module,create", CREATE_CASES)
async def test_create_block_unknown_activity_is_404(mock_request, db, org, admin_user, label, module, create):
    """No upload may happen for an activity uuid that does not exist."""
    with patch.object(module, "upload_file_and_return_file_object", new=AsyncMock()) as up:
        with pytest.raises(HTTPException) as exc:
            await create(mock_request, _upload(), "activity_missing", db, current_user=admin_user)
    assert exc.value.status_code == 404
    assert exc.value.detail == "Activity not found"
    up.assert_not_awaited()


@pytest.mark.parametrize("label,module,create", CREATE_CASES)
async def test_create_block_missing_course_is_404(mock_request, db, org, admin_user, label, module, create):
    """An activity whose course row is gone cannot receive new media blocks."""
    act = await _add_activity(db, uuid=f"activity_nocourse_{label}", org_id=org.id, course_id=999)
    with patch.object(module, "upload_file_and_return_file_object", new=AsyncMock()) as up:
        with pytest.raises(HTTPException) as exc:
            await create(mock_request, _upload(), act.activity_uuid, db, current_user=admin_user)
    assert exc.value.status_code == 404
    assert exc.value.detail == "Course not found"
    up.assert_not_awaited()


# ---------------------------------------------------------------------------
# get_*_block
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("label,module,getter,block_type", GET_CASES)
async def test_get_block_with_missing_activity_is_404(
    mock_request, db, org, course, admin_user, label, module, getter, block_type
):
    """A block orphaned from its activity is reported as missing, not served."""
    block = await _add_block(
        db, uuid=f"block_orphan_act_{label}", org_id=org.id, course_id=course.id,
        activity_id=999, block_type=block_type,
    )
    with patch.object(module, "check_resource_access", new=AsyncMock()) as rbac:
        with pytest.raises(HTTPException) as exc:
            await getter(mock_request, block.block_uuid, admin_user, db)
    assert exc.value.status_code == 404
    rbac.assert_not_awaited()


@pytest.mark.parametrize("label,module,getter,block_type", GET_CASES)
async def test_get_block_with_missing_course_is_404(
    mock_request, db, org, admin_user, label, module, getter, block_type
):
    """Without a course there is nothing to check RBAC against, so 404."""
    act = await _add_activity(db, uuid=f"activity_orphan_{label}", org_id=org.id, course_id=999)
    block = await _add_block(
        db, uuid=f"block_orphan_course_{label}", org_id=org.id, course_id=999,
        activity_id=act.id, block_type=block_type,
    )
    with patch.object(module, "check_resource_access", new=AsyncMock()) as rbac:
        with pytest.raises(HTTPException) as exc:
            await getter(mock_request, block.block_uuid, admin_user, db)
    assert exc.value.status_code == 404
    rbac.assert_not_awaited()


async def _private_course_block(db, org, label, block_type):
    course = Course(
        id=50,
        name="Private",
        description="x",
        public=False,
        published=True,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid=f"course_private_{label}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(course)
    await db.commit()
    act = await _add_activity(db, uuid=f"activity_private_{label}", org_id=org.id, course_id=course.id)
    return await _add_block(
        db, uuid=f"block_private_{label}", org_id=org.id, course_id=course.id,
        activity_id=act.id, block_type=block_type,
    )


@pytest.mark.parametrize("label,module,getter,block_type", GET_CASES)
async def test_get_private_block_requires_org_membership(
    mock_request, db, org, regular_user, label, module, getter, block_type
):
    """RBAC alone admits any signed-in user when no usergroup is linked; the
    membership gate must still refuse non-members on a private course."""
    block = await _private_course_block(db, org, label, block_type)
    with patch.object(module, "check_resource_access", new=AsyncMock()), patch.object(
        module, "is_org_member", new=AsyncMock(return_value=False)
    ) as member, patch.object(module, "verify_activity_reader_access", new=AsyncMock()) as reader:
        with pytest.raises(HTTPException) as exc:
            await getter(mock_request, block.block_uuid, regular_user, db)
    assert exc.value.status_code == 403
    member.assert_awaited_once_with(regular_user.id, org.id, db)
    reader.assert_not_awaited()


@pytest.mark.parametrize("label,module,getter,block_type", GET_CASES)
async def test_get_private_block_served_to_org_member(
    mock_request, db, org, regular_user, label, module, getter, block_type
):
    """A member passes the gate, the org 2FA policy, and the activity gate."""
    block = await _private_course_block(db, org, label, block_type)
    with patch.object(module, "check_resource_access", new=AsyncMock()), patch.object(
        module, "is_org_member", new=AsyncMock(return_value=True)
    ), patch.object(module, "enforce_org_mfa", new=AsyncMock()) as mfa, patch.object(
        module, "verify_activity_reader_access", new=AsyncMock()
    ) as reader:
        result = await getter(mock_request, block.block_uuid, regular_user, db)
    assert isinstance(result, BlockRead)
    assert result.block_uuid == block.block_uuid
    mfa.assert_awaited_once_with(regular_user.id, org.id, db)
    reader.assert_awaited_once()


# ---------------------------------------------------------------------------
# upload_file_and_return_file_object
# ---------------------------------------------------------------------------


def _sized_upload(filename: str, content_type: str) -> MagicMock:
    uf = MagicMock(spec=UploadFile)
    uf.filename = filename
    uf.content_type = content_type
    uf.size = 10
    return uf


@pytest.mark.parametrize(
    "formats,expected_types,stored",
    [
        (["jpg", "jpeg", "png", "gif", "webp"], ["image"], "block_a.png"),
        (["pdf"], ["document"], "block_b.pdf"),
    ],
)
async def test_upload_maps_formats_to_allowed_types(mock_request, formats, expected_types, stored):
    """Legacy extension lists are translated into the upload type system."""
    with patch(
        "src.services.blocks.utils.upload_files.upload_file",
        new=AsyncMock(return_value=stored),
    ) as up:
        result = await upload_file_and_return_file_object(
            mock_request, _sized_upload("orig." + stored.rsplit(".", 1)[1], "x/y"),
            "activity_x", "block_x", formats, "someBlock", "org_x", "course_x",
        )
    assert up.await_args.kwargs["allowed_types"] == expected_types
    assert up.await_args.kwargs["directory"] == (
        "courses/course_x/activities/activity_x/dynamic/blocks/someBlock/block_x"
    )
    assert result.file_id == stored.rsplit(".", 1)[0]
    assert result.file_format == stored.rsplit(".", 1)[1]


@pytest.mark.parametrize("formats", [[], ["exe", "zip"]])
async def test_upload_rejects_unknown_formats(mock_request, formats):
    """With no recognised format there is nothing safe to accept: 400, no upload."""
    with patch(
        "src.services.blocks.utils.upload_files.upload_file", new=AsyncMock()
    ) as up:
        with pytest.raises(HTTPException) as exc:
            await upload_file_and_return_file_object(
                mock_request, _sized_upload("a.exe", "application/x-msdownload"),
                "activity_x", "block_x", formats, "someBlock", "org_x", "course_x",
            )
    assert exc.value.status_code == 400
    up.assert_not_awaited()
