"""
Regression tests for F-1: cross-org IDOR on media block GETs.

Before the fix, ``get_image_block`` / ``get_video_block`` / ``get_pdf_block`` /
``get_audio_block`` loaded a Block by UUID and returned it without invoking
RBAC. Any authenticated (or anonymous, because the router-level dep admits
``AnonymousUser``) caller who obtained a block UUID from org B could read the
corresponding asset from org A.

These tests assert that each block-read service now resolves the block's
owning course and enforces ``check_resource_access(...READ...)``, so:

- A member of org A reading a block from a private course in org B → 403.
- A member of org A reading a block from their own course → 200.
- An anonymous reader accessing a block from a public + published course → 200.
- An anonymous reader accessing a block from a non-public or unpublished course → 403.
"""

from datetime import datetime

import pytest
from fastapi import HTTPException

from src.db.courses.activities import (
    Activity,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.blocks import Block, BlockTypeEnum
from src.db.courses.courses import Course
from src.services.blocks.block_types.audioBlock.audioBlock import get_audio_block
from src.services.blocks.block_types.imageBlock.imageBlock import get_image_block
from src.services.blocks.block_types.pdfBlock.pdfBlock import get_pdf_block
from src.services.blocks.block_types.videoBlock.videoBlock import get_video_block


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mk_block(db, *, block_uuid: str, org_id: int, course_id: int, activity_id: int, block_type: BlockTypeEnum) -> Block:
    b = Block(
        block_type=block_type,
        content={"file_id": "x"},
        org_id=org_id,
        course_id=course_id,
        activity_id=activity_id,
        block_uuid=block_uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


def _mk_course(db, *, org_id: int, cid: int, uuid: str, public: bool) -> Course:
    c = Course(
        id=cid,
        name=f"Course {cid}",
        description="x",
        public=public,
        published=True,
        open_to_contributors=False,
        org_id=org_id,
        course_uuid=uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def _mk_activity(db, *, aid: int, org_id: int, course_id: int, uuid: str) -> Activity:
    a = Activity(
        id=aid,
        name=f"Activity {aid}",
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
    db.commit()
    db.refresh(a)
    return a


# ---------------------------------------------------------------------------
# Parametrized matrix: same test body for every block type
# ---------------------------------------------------------------------------

BLOCK_CASES = [
    ("image", get_image_block, BlockTypeEnum.BLOCK_IMAGE),
    ("video", get_video_block, BlockTypeEnum.BLOCK_VIDEO),
    ("pdf", get_pdf_block, BlockTypeEnum.BLOCK_DOCUMENT_PDF),
    ("audio", get_audio_block, BlockTypeEnum.BLOCK_AUDIO),
]


@pytest.mark.parametrize("label,getter,block_type", BLOCK_CASES)
@pytest.mark.asyncio
async def test_member_of_own_org_can_read_block(
    db, org, course, activity, regular_user, mock_request, label, getter, block_type,
):
    """Positive path: org member reads a block that belongs to their own org's course."""
    block = _mk_block(
        db,
        block_uuid=f"block_same_org_{label}",
        org_id=org.id,
        course_id=course.id,
        activity_id=activity.id,
        block_type=block_type,
    )
    result = await getter(mock_request, block.block_uuid, regular_user, db)
    assert result.block_uuid == block.block_uuid


@pytest.mark.parametrize("label,getter,block_type", BLOCK_CASES)
@pytest.mark.asyncio
async def test_cross_org_member_cannot_read_private_block(
    db, org, other_org, regular_user, mock_request, label, getter, block_type,
):
    """Negative path: member of org A cannot read a private-course block from org B."""
    # Make cid/aid unique per parametrize case so parametrize doesn't collide.
    suffix_offset = {"image": 0, "video": 1, "pdf": 2, "audio": 3}[label]
    other_course = _mk_course(
        db, org_id=other_org.id, cid=900 + suffix_offset,
        uuid=f"course_other_{label}", public=False,
    )
    other_activity = _mk_activity(
        db, aid=900 + suffix_offset, org_id=other_org.id,
        course_id=other_course.id, uuid=f"activity_other_{label}",
    )
    block = _mk_block(
        db,
        block_uuid=f"block_other_org_{label}",
        org_id=other_org.id,
        course_id=other_course.id,
        activity_id=other_activity.id,
        block_type=block_type,
    )

    with pytest.raises(HTTPException) as exc_info:
        await getter(mock_request, block.block_uuid, regular_user, db)
    assert exc_info.value.status_code == 403


@pytest.mark.parametrize("label,getter,block_type", BLOCK_CASES)
@pytest.mark.asyncio
async def test_anonymous_can_read_block_on_public_published_course(
    db, org, course, activity, anonymous_user, mock_request, label, getter, block_type,
):
    """Positive path: anonymous read of a public+published course's block stays allowed."""
    block = _mk_block(
        db,
        block_uuid=f"block_public_{label}",
        org_id=org.id,
        course_id=course.id,
        activity_id=activity.id,
        block_type=block_type,
    )
    result = await getter(mock_request, block.block_uuid, anonymous_user, db)
    assert result.block_uuid == block.block_uuid


@pytest.mark.parametrize("label,getter,block_type", BLOCK_CASES)
@pytest.mark.asyncio
async def test_anonymous_cannot_read_block_on_private_course(
    db, other_org, anonymous_user, mock_request, label, getter, block_type,
):
    """Negative path: anonymous cannot read a non-public course's block."""
    suffix_offset = {"image": 0, "video": 1, "pdf": 2, "audio": 3}[label]
    private_course = _mk_course(
        db, org_id=other_org.id, cid=700 + suffix_offset,
        uuid=f"course_private_{label}", public=False,
    )
    private_activity = _mk_activity(
        db, aid=700 + suffix_offset, org_id=other_org.id,
        course_id=private_course.id, uuid=f"activity_private_{label}",
    )
    block = _mk_block(
        db,
        block_uuid=f"block_private_{label}",
        org_id=other_org.id,
        course_id=private_course.id,
        activity_id=private_activity.id,
        block_type=block_type,
    )

    with pytest.raises(HTTPException) as exc_info:
        await getter(mock_request, block.block_uuid, anonymous_user, db)
    assert exc_info.value.status_code == 403


@pytest.mark.parametrize("label,getter,block_type", BLOCK_CASES)
@pytest.mark.asyncio
async def test_unknown_block_uuid_returns_404(
    db, regular_user, mock_request, label, getter, block_type,
):
    """Non-existent block UUID: 404, not 5xx, and never leaks other orgs' data."""
    with pytest.raises(HTTPException) as exc_info:
        await getter(mock_request, f"block_does_not_exist_{label}", regular_user, db)
    assert exc_info.value.status_code == 404
