"""Behavioral tests for src/routers/ai/audio.py (Gemini TTS audio generation).

External I/O fully mocked; the handler is called directly with an AsyncMock
db_session whose .execute() returns a result supporting .scalars().first().
Mirrors test_ai_images_router.py.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.routers.ai import audio as aud
from src.services.ai.llm import AINotConfiguredError
from src.services.ai.schemas.audio import (
    GenerateAudioRequest,
    GenerateAudioSpeaker,
    GenerateScriptRequest,
)

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


def _activity(org_id=5):
    return SimpleNamespace(org_id=org_id)


def _user(id=1):
    return SimpleNamespace(id=id)


def _body(**kw):
    base = dict(activity_uuid="act_1", mode="tts", text="Hello there")
    base.update(kw)
    return GenerateAudioRequest(**base)


def _script_body(**kw):
    base = dict(activity_uuid="act_1", text="Explain photosynthesis")
    base.update(kw)
    return GenerateScriptRequest(**base)


def _happy_patches():
    return [
        patch.object(aud, "is_org_member", new=AsyncMock(return_value=True)),
        patch.object(aud, "enforce_ai_rate_limit"),
        patch.object(aud, "reserve_ai_credit", new=AsyncMock()),
    ]


async def test_empty_text_400():
    with pytest.raises(HTTPException) as e:
        await aud.api_generate_audio(MagicMock(), _body(text="  "), _user(), _db_returning(_activity()))
    assert e.value.status_code == 400


async def test_activity_not_found_404():
    with pytest.raises(HTTPException) as e:
        await aud.api_generate_audio(MagicMock(), _body(), _user(), _db_returning(None))
    assert e.value.status_code == 404


async def test_non_member_403_no_spend():
    with patch.object(aud, "is_org_member", new=AsyncMock(return_value=False)), \
         patch.object(aud, "reserve_ai_credit", new=AsyncMock()) as reserve:
        with pytest.raises(HTTPException) as e:
            await aud.api_generate_audio(MagicMock(), _body(), _user(), _db_returning(_activity()))
    assert e.value.status_code == 403
    reserve.assert_not_called()


async def test_happy_path_tts():
    block = SimpleNamespace(block_uuid="block_1")
    with patch.object(aud, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(aud, "enforce_ai_rate_limit"), \
         patch.object(aud, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(aud, "generate_speech", new=AsyncMock(return_value=b"RIFFxxxxWAVE")) as gs, \
         patch.object(aud, "create_audio_block", new=AsyncMock(return_value=block)) as cab:
        resp = await aud.api_generate_audio(MagicMock(), _body(voice="Puck"), _user(), _db_returning(_activity()))
    assert resp is block
    gs.assert_awaited_once()
    assert gs.await_args.kwargs["voice"] == "Puck"
    assert gs.await_args.kwargs["speakers"] is None
    cab.assert_awaited_once()


async def test_happy_path_podcast_builds_speakers():
    block = SimpleNamespace(block_uuid="block_2")
    body = _body(
        mode="podcast",
        speakers=[
            GenerateAudioSpeaker(name="Host", voice="Kore"),
            GenerateAudioSpeaker(name="Guest", voice="Puck"),
        ],
    )
    with patch.object(aud, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(aud, "enforce_ai_rate_limit"), \
         patch.object(aud, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(aud, "generate_speech", new=AsyncMock(return_value=b"RIFFxxxxWAVE")) as gs, \
         patch.object(aud, "create_audio_block", new=AsyncMock(return_value=block)):
        await aud.api_generate_audio(MagicMock(), body, _user(), _db_returning(_activity()))
    speakers = gs.await_args.kwargs["speakers"]
    assert [s.name for s in speakers] == ["Host", "Guest"]
    assert [s.voice for s in speakers] == ["Kore", "Puck"]


async def test_not_configured_refunds_and_403():
    with patch.object(aud, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(aud, "enforce_ai_rate_limit"), \
         patch.object(aud, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(aud, "generate_speech", new=AsyncMock(side_effect=AINotConfiguredError("no key"))), \
         patch.object(aud, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as e:
            await aud.api_generate_audio(MagicMock(), _body(), _user(), _db_returning(_activity()))
    assert e.value.status_code == 403
    refund.assert_called_once_with(5, aud.AUDIO_CREDIT_COST)


async def test_value_error_refunds_and_400():
    with patch.object(aud, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(aud, "enforce_ai_rate_limit"), \
         patch.object(aud, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(aud, "generate_speech", new=AsyncMock(side_effect=ValueError("too long"))), \
         patch.object(aud, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as e:
            await aud.api_generate_audio(MagicMock(), _body(), _user(), _db_returning(_activity()))
    assert e.value.status_code == 400
    refund.assert_called_once()


async def test_generation_failure_refunds_and_502():
    with patch.object(aud, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(aud, "enforce_ai_rate_limit"), \
         patch.object(aud, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(aud, "generate_speech", new=AsyncMock(side_effect=RuntimeError("boom"))), \
         patch.object(aud, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as e:
            await aud.api_generate_audio(MagicMock(), _body(), _user(), _db_returning(_activity()))
    assert e.value.status_code == 502
    refund.assert_called_once()


async def test_store_http_error_refunds_and_reraises():
    with patch.object(aud, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(aud, "enforce_ai_rate_limit"), \
         patch.object(aud, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(aud, "generate_speech", new=AsyncMock(return_value=b"RIFFxxxxWAVE")), \
         patch.object(aud, "create_audio_block", new=AsyncMock(side_effect=HTTPException(status_code=403, detail="rbac"))), \
         patch.object(aud, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as e:
            await aud.api_generate_audio(MagicMock(), _body(), _user(), _db_returning(_activity()))
    assert e.value.status_code == 403
    refund.assert_called_once()


async def test_store_generic_error_refunds_and_500():
    with patch.object(aud, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(aud, "enforce_ai_rate_limit"), \
         patch.object(aud, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(aud, "generate_speech", new=AsyncMock(return_value=b"RIFFxxxxWAVE")), \
         patch.object(aud, "create_audio_block", new=AsyncMock(side_effect=RuntimeError("disk"))), \
         patch.object(aud, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as e:
            await aud.api_generate_audio(MagicMock(), _body(), _user(), _db_returning(_activity()))
    assert e.value.status_code == 500
    refund.assert_called_once()


# --- /audio/script (podcast script generation) ---------------------------

async def test_script_empty_text_400():
    with pytest.raises(HTTPException) as e:
        await aud.api_generate_script(_script_body(text="  "), _user(), _db_returning(_activity()))
    assert e.value.status_code == 400


async def test_script_activity_not_found_404():
    with pytest.raises(HTTPException) as e:
        await aud.api_generate_script(_script_body(), _user(), _db_returning(None))
    assert e.value.status_code == 404


async def test_script_non_member_403_no_spend():
    with patch.object(aud, "is_org_member", new=AsyncMock(return_value=False)), \
         patch.object(aud, "reserve_ai_credit", new=AsyncMock()) as reserve:
        with pytest.raises(HTTPException) as e:
            await aud.api_generate_script(_script_body(), _user(), _db_returning(_activity()))
    assert e.value.status_code == 403
    reserve.assert_not_called()


async def test_script_happy_path_podcast():
    with patch.object(aud, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(aud, "enforce_ai_rate_limit"), \
         patch.object(aud, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(aud, "generate_spoken_script", new=AsyncMock(return_value="Host: hi\nGuest: hey")) as gps:
        resp = await aud.api_generate_script(
            _script_body(mode="podcast", minutes=5, speakers=[
                GenerateAudioSpeaker(name="Host", voice="Kore"),
                GenerateAudioSpeaker(name="Guest", voice="Puck"),
            ]),
            _user(), _db_returning(_activity()),
        )
    assert resp.transcript.startswith("Host:")
    assert gps.await_args.kwargs["kind"] == "podcast"
    assert gps.await_args.kwargs["speaker_names"] == ["Host", "Guest"]
    assert gps.await_args.kwargs["minutes"] == 5


async def test_script_happy_path_speak_monologue():
    with patch.object(aud, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(aud, "enforce_ai_rate_limit"), \
         patch.object(aud, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(aud, "generate_spoken_script", new=AsyncMock(return_value="Photosynthesis is...")) as gps:
        resp = await aud.api_generate_script(
            _script_body(mode="speak", minutes=3), _user(), _db_returning(_activity())
        )
    assert resp.transcript.startswith("Photosynthesis")
    assert gps.await_args.kwargs["kind"] == "monologue"
    assert gps.await_args.kwargs["minutes"] == 3


async def test_script_not_configured_refunds_and_403():
    with patch.object(aud, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(aud, "enforce_ai_rate_limit"), \
         patch.object(aud, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(aud, "generate_spoken_script", new=AsyncMock(side_effect=AINotConfiguredError("no key"))), \
         patch.object(aud, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as e:
            await aud.api_generate_script(_script_body(), _user(), _db_returning(_activity()))
    assert e.value.status_code == 403
    refund.assert_called_once_with(5, aud.SCRIPT_CREDIT_COST)


async def test_script_value_error_refunds_and_400():
    with patch.object(aud, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(aud, "enforce_ai_rate_limit"), \
         patch.object(aud, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(aud, "generate_spoken_script", new=AsyncMock(side_effect=ValueError("empty"))), \
         patch.object(aud, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as e:
            await aud.api_generate_script(_script_body(), _user(), _db_returning(_activity()))
    assert e.value.status_code == 400
    refund.assert_called_once()


async def test_script_generation_failure_refunds_and_502():
    with patch.object(aud, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(aud, "enforce_ai_rate_limit"), \
         patch.object(aud, "reserve_ai_credit", new=AsyncMock()), \
         patch.object(aud, "generate_spoken_script", new=AsyncMock(side_effect=RuntimeError("boom"))), \
         patch.object(aud, "refund_ai_credit") as refund:
        with pytest.raises(HTTPException) as e:
            await aud.api_generate_script(_script_body(), _user(), _db_returning(_activity()))
    assert e.value.status_code == 502
    refund.assert_called_once()
