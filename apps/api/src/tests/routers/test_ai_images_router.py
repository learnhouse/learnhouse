"""Behavioral tests for src/routers/ai/images.py.

External I/O fully mocked; handlers called directly with an AsyncMock db_session
whose .execute() returns a result supporting .scalars().first().
"""

import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.routers.ai import images as img
from src.services.ai.llm import AINotConfiguredError
from src.services.ai.schemas.image import GenerateImageRequest

pytestmark = pytest.mark.asyncio


def _result(value):
    scalars = MagicMock()
    scalars.first.return_value = value
    res = MagicMock()
    res.scalars.return_value = scalars
    return res


def _db_returning(*values):
    db = AsyncMock()
    db.execute.side_effect = [_result(v) for v in values]
    return db


def _org(id=5, uuid="org_x"):
    return SimpleNamespace(id=id, org_uuid=uuid)


def _user(id=1):
    return SimpleNamespace(id=id)


def _patches(member=True):
    """Common happy-path patches; returns a contextlib-style list to enter."""
    return [
        patch.object(img, "is_org_member", new=AsyncMock(return_value=member)),
        patch.object(img, "enforce_ai_rate_limit"),
        patch.object(img, "reserve_ai_credit", new=AsyncMock()),
        patch.object(img, "refund_ai_credit"),
    ]


async def test_empty_prompt_400():
    body = GenerateImageRequest(org_id=5, prompt="   ")
    with pytest.raises(HTTPException) as exc:
        await img.api_generate_image(body, _user(), _db_returning(_org()))
    assert exc.value.status_code == 400


async def test_org_not_found_404():
    body = GenerateImageRequest(org_id=5, prompt="cat")
    with pytest.raises(HTTPException) as exc:
        await img.api_generate_image(body, _user(), _db_returning(None))
    assert exc.value.status_code == 404


async def test_non_member_403():
    body = GenerateImageRequest(org_id=5, prompt="cat")
    with patch.object(img, "is_org_member", new=AsyncMock(return_value=False)), \
         patch.object(img, "reserve_ai_credit", new=AsyncMock()) as reserve:
        with pytest.raises(HTTPException) as exc:
            await img.api_generate_image(body, _user(), _db_returning(_org()))
    assert exc.value.status_code == 403
    reserve.assert_not_called()


async def test_happy_path():
    body = GenerateImageRequest(org_id=5, prompt="a cat")
    record = SimpleNamespace(ai_generation_uuid="aigen_1")
    with patch.object(img, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(img, "enforce_ai_rate_limit"), \
         patch.object(img, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(img, "generate_image", new=AsyncMock(return_value=b"IMG")), \
         patch.object(img, "upload_content", new=AsyncMock()) as upload, \
         patch.object(img, "record_generation", new=AsyncMock(return_value=record)):
        resp = await img.api_generate_image(body, _user(), _db_returning(_org()))
    assert resp.file_id.endswith(".png")
    assert "org_x/ai_images/" in resp.media_url
    assert resp.session_uuid.startswith("aiimg_")
    assert resp.ai_generation_uuid == "aigen_1"
    upload.assert_awaited_once()


async def test_refine_with_source_image():
    b64 = "data:image/png;base64," + base64.b64encode(b"orig").decode()
    body = GenerateImageRequest(org_id=5, prompt="darker", source_image_base64=b64, session_uuid="aiimg_prev")
    record = SimpleNamespace(ai_generation_uuid="aigen_2")
    gen = AsyncMock(return_value=b"IMG")
    with patch.object(img, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(img, "enforce_ai_rate_limit"), \
         patch.object(img, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(img, "generate_image", new=gen), \
         patch.object(img, "upload_content", new=AsyncMock()), \
         patch.object(img, "record_generation", new=AsyncMock(return_value=record)):
        resp = await img.api_generate_image(body, _user(), _db_returning(_org()))
    assert resp.session_uuid == "aiimg_prev"
    assert gen.await_args.kwargs["input_images"] == [b"orig"]


async def test_refine_by_source_file_id_reads_storage():
    body = GenerateImageRequest(org_id=5, prompt="darker", source_file_id="prev.png", session_uuid="aiimg_prev")
    record = SimpleNamespace(ai_generation_uuid="aigen_r")
    gen = AsyncMock(return_value=b"IMG")
    with patch.object(img, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(img, "enforce_ai_rate_limit"), \
         patch.object(img, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(img, "read_content", new=AsyncMock(return_value=b"orig-bytes")) as rc, \
         patch.object(img, "generate_image", new=gen), \
         patch.object(img, "upload_content", new=AsyncMock()), \
         patch.object(img, "record_generation", new=AsyncMock(return_value=record)):
        await img.api_generate_image(body, _user(), _db_returning(_org()))
    rc.assert_awaited_once()
    assert gen.await_args.kwargs["input_images"] == [b"orig-bytes"]


async def test_refine_source_file_id_missing_404():
    body = GenerateImageRequest(org_id=5, prompt="x", source_file_id="gone.png")
    with patch.object(img, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(img, "enforce_ai_rate_limit"), \
         patch.object(img, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(img, "read_content", new=AsyncMock(side_effect=HTTPException(status_code=404, detail="nf"))):
        with pytest.raises(HTTPException) as exc:
            await img.api_generate_image(body, _user(), _db_returning(_org()))
    assert exc.value.status_code == 404


async def test_refine_source_file_id_traversal_400():
    body = GenerateImageRequest(org_id=5, prompt="x", source_file_id="../../other/secret.png")
    with patch.object(img, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(img, "enforce_ai_rate_limit"), \
         patch.object(img, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(img, "read_content", new=AsyncMock()) as rc:
        with pytest.raises(HTTPException) as exc:
            await img.api_generate_image(body, _user(), _db_returning(_org()))
    assert exc.value.status_code == 400
    rc.assert_not_called()  # rejected before any storage read


async def test_invalid_source_base64_ignored():
    body = GenerateImageRequest(org_id=5, prompt="x", source_image_base64="!!!notbase64!!!")
    record = SimpleNamespace(ai_generation_uuid="aigen_3")
    gen = AsyncMock(return_value=b"IMG")
    with patch.object(img, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(img, "enforce_ai_rate_limit"), \
         patch.object(img, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(img, "generate_image", new=gen), \
         patch.object(img, "upload_content", new=AsyncMock()), \
         patch.object(img, "record_generation", new=AsyncMock(return_value=record)):
        await img.api_generate_image(body, _user(), _db_returning(_org()))
    assert gen.await_args.kwargs["input_images"] is None


async def test_not_configured_refunds_and_403():
    body = GenerateImageRequest(org_id=5, prompt="x")
    with patch.object(img, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(img, "enforce_ai_rate_limit"), \
         patch.object(img, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(img, "generate_image", new=AsyncMock(side_effect=AINotConfiguredError("no key"))), \
         patch.object(img, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as exc:
            await img.api_generate_image(body, _user(), _db_returning(_org()))
    assert exc.value.status_code == 403
    refund.assert_called_once_with(5, img.IMAGE_CREDIT_COST)


async def test_generation_failure_refunds_and_502():
    body = GenerateImageRequest(org_id=5, prompt="x")
    with patch.object(img, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(img, "enforce_ai_rate_limit"), \
         patch.object(img, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(img, "generate_image", new=AsyncMock(side_effect=RuntimeError("boom"))), \
         patch.object(img, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as exc:
            await img.api_generate_image(body, _user(), _db_returning(_org()))
    assert exc.value.status_code == 502
    refund.assert_called_once()


async def test_upload_failure_refunds_and_500():
    body = GenerateImageRequest(org_id=5, prompt="x")
    with patch.object(img, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(img, "enforce_ai_rate_limit"), \
         patch.object(img, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(img, "generate_image", new=AsyncMock(return_value=b"IMG")), \
         patch.object(img, "upload_content", new=AsyncMock(side_effect=RuntimeError("disk"))), \
         patch.object(img, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as exc:
            await img.api_generate_image(body, _user(), _db_returning(_org()))
    assert exc.value.status_code == 500
    refund.assert_called_once()


async def test_get_image_bytes_ok():
    with patch.object(img, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(img, "read_content", new=AsyncMock(return_value=b"PNGDATA")):
        resp = await img.api_get_image_bytes(5, "f.png", _user(), _db_returning(_org()))
    assert resp.body == b"PNGDATA"
    assert resp.media_type == "image/png"


async def test_get_image_bytes_traversal_400():
    with patch.object(img, "is_org_member", new=AsyncMock(return_value=True)):
        with pytest.raises(HTTPException) as exc:
            await img.api_get_image_bytes(5, "../secret.png", _user(), _db_returning(_org()))
    assert exc.value.status_code == 400


async def test_get_image_bytes_missing_404():
    with patch.object(img, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(img, "read_content", new=AsyncMock(side_effect=HTTPException(status_code=404, detail="nf"))):
        with pytest.raises(HTTPException) as exc:
            await img.api_get_image_bytes(5, "gone.png", _user(), _db_returning(_org()))
    assert exc.value.status_code == 404


async def test_get_image_bytes_non_member_403():
    with patch.object(img, "is_org_member", new=AsyncMock(return_value=False)):
        with pytest.raises(HTTPException) as exc:
            await img.api_get_image_bytes(5, "f.png", _user(), _db_returning(_org()))
    assert exc.value.status_code == 403


async def test_history_list():
    row = SimpleNamespace(
        ai_generation_uuid="aigen_1", session_uuid="aiimg_1", prompt="cat",
        result={"file_id": "f.png", "media_url": "content/orgs/org_x/ai_images/f.png"},
        creation_date="2026-07-02",
    )
    with patch.object(img, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(img, "list_generations", new=AsyncMock(return_value=[row])):
        items = await img.api_list_image_history(5, 30, 0, _user(), _db_returning(_org()))
    assert items[0].file_id == "f.png"


async def test_delete_history_ok_and_404():
    with patch.object(img, "delete_generation", new=AsyncMock(return_value=True)):
        assert (await img.api_delete_image_history("aigen_1", _user(), AsyncMock()))["detail"] == "deleted"
    with patch.object(img, "delete_generation", new=AsyncMock(return_value=False)):
        with pytest.raises(HTTPException) as exc:
            await img.api_delete_image_history("nope", _user(), AsyncMock())
    assert exc.value.status_code == 404
