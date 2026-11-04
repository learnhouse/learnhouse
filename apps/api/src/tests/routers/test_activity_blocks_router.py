"""Router tests for src/routers/courses/activities/blocks.py.

Each file block type (image, video, pdf, audio) has an upload endpoint taking
multipart ``file_object`` + ``activity_uuid`` and a read endpoint taking a
``block_uuid`` query parameter. Services are mocked; the tests pin the
wiring from the HTTP request to the right service with the right arguments.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.courses.blocks import BlockRead, BlockTypeEnum
from src.routers.courses.activities.blocks import router as blocks_router
from src.security.auth import get_current_user

R = "src.routers.courses.activities.blocks"
BASE = "/api/v1/blocks"

BLOCK_KINDS = [
    ("image", BlockTypeEnum.BLOCK_IMAGE, "pic.png", "image/png"),
    ("video", BlockTypeEnum.BLOCK_VIDEO, "clip.mp4", "video/mp4"),
    ("pdf", BlockTypeEnum.BLOCK_DOCUMENT_PDF, "doc.pdf", "application/pdf"),
    ("audio", BlockTypeEnum.BLOCK_AUDIO, "sound.mp3", "audio/mpeg"),
]


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(blocks_router, prefix=BASE)
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


def _block(block_type: BlockTypeEnum, filename: str) -> BlockRead:
    return BlockRead(
        id=1,
        block_type=block_type,
        content={"file_id": "block_1", "file_format": filename.rsplit(".", 1)[1]},
        org_id=1,
        course_id=1,
        chapter_id=1,
        activity_id=1,
        block_uuid="block_1",
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )


@pytest.mark.parametrize("kind, block_type, filename, mime", BLOCK_KINDS, ids=[k[0] for k in BLOCK_KINDS])
class TestFileBlocks:
    async def test_upload_creates_block_for_activity(
        self, client, admin_user, kind, block_type, filename, mime
    ):
        with patch(
            f"{R}.create_{kind}_block",
            new_callable=AsyncMock,
            return_value=_block(block_type, filename),
        ) as svc:
            resp = await client.post(
                f"{BASE}/{kind}",
                data={"activity_uuid": "activity_test"},
                files={"file_object": (filename, b"bytes", mime)},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["block_uuid"] == "block_1"
        assert body["block_type"] == block_type.value
        _request, upload, activity_uuid, _db, user = svc.await_args.args
        assert upload.filename == filename
        assert activity_uuid == "activity_test"
        assert user is admin_user

    async def test_upload_without_file_is_422(
        self, client, kind, block_type, filename, mime
    ):
        with patch(f"{R}.create_{kind}_block", new_callable=AsyncMock) as svc:
            resp = await client.post(
                f"{BASE}/{kind}", data={"activity_uuid": "activity_test"}
            )

        assert resp.status_code == 422
        svc.assert_not_awaited()

    async def test_get_block_by_uuid(
        self, client, admin_user, kind, block_type, filename, mime
    ):
        with patch(
            f"{R}.get_{kind}_block",
            new_callable=AsyncMock,
            return_value=_block(block_type, filename),
        ) as svc:
            resp = await client.get(f"{BASE}/{kind}", params={"block_uuid": "block_1"})

        assert resp.status_code == 200
        assert resp.json()["block_uuid"] == "block_1"
        _request, block_uuid, user, _db = svc.await_args.args
        assert block_uuid == "block_1"
        assert user is admin_user
