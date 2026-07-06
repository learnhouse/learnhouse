"""Unit tests for src/services/ai/audio/generator.py (Gemini TTS).

The Google GenAI SDK is fully mocked; no network calls. Covers the pure helpers
and the generate_speech orchestration (single/multi-speaker, retries, failures).
"""

import io
import wave
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.ai.audio import generator as gen
from src.services.ai.llm import AINotConfiguredError


def _cfg(**kw):
    base = dict(provider="google", api_key="key", gemini_api_key=None, tts_model=None)
    base.update(kw)
    return SimpleNamespace(ai_config=SimpleNamespace(**base))


def _fake_response(pcm=b"PCMDATA"):
    part = SimpleNamespace(inline_data=SimpleNamespace(data=pcm))
    content = SimpleNamespace(parts=[part])
    return SimpleNamespace(candidates=[SimpleNamespace(content=content)])


def _fake_client(response=None, side_effect=None):
    client = MagicMock()
    client.aio.models.generate_content = (
        AsyncMock(side_effect=side_effect) if side_effect is not None else AsyncMock(return_value=response)
    )
    return client


# --- pure helpers ---------------------------------------------------------

def test_normalise_voice():
    assert gen.normalise_voice("Puck") == "Puck"
    assert gen.normalise_voice("  Kore ") == "Kore"
    assert gen.normalise_voice("Nonexistent") == gen.DEFAULT_VOICE
    assert gen.normalise_voice(None) == gen.DEFAULT_VOICE
    assert gen.normalise_voice("") == gen.DEFAULT_VOICE


def test_pcm_to_wav_roundtrip():
    pcm = b"\x00\x01" * 100
    data = gen._pcm_to_wav(pcm)
    assert data[:4] == b"RIFF" and data[8:12] == b"WAVE"
    with wave.open(io.BytesIO(data)) as wf:
        assert wf.getnchannels() == 1
        assert wf.getframerate() == 24000
        assert wf.getsampwidth() == 2
        assert wf.readframes(100) == pcm


def test_build_prompt_tts_plain():
    assert gen._build_prompt("Hello", style=None, language=None, podcast=False) == "Hello"


def test_build_prompt_tts_with_style_and_language():
    p = gen._build_prompt("Hello", style="calm", language="Spanish", podcast=False)
    assert "calm" in p.lower()
    assert "spanish" in p.lower()
    assert p.strip().endswith("Hello")


def test_build_prompt_podcast_defaults_to_podcast_tone():
    p = gen._build_prompt("Host: hi", style=None, language=None, podcast=True)
    assert "podcast" in p.lower()
    assert "conversation" in p.lower()
    assert "Host: hi" in p


def test_extract_pcm():
    assert gen._extract_pcm(_fake_response(b"PCM")) == b"PCM"
    no_inline = SimpleNamespace(
        candidates=[SimpleNamespace(content=SimpleNamespace(parts=[SimpleNamespace(inline_data=None)]))]
    )
    assert gen._extract_pcm(no_inline) is None
    assert gen._extract_pcm(SimpleNamespace(candidates=[])) is None


def test_is_retryable():
    e = Exception()
    e.code = 503
    assert gen._is_retryable(e) is True
    assert gen._is_retryable(type("ServerError", (Exception,), {})()) is True
    assert gen._is_retryable(ValueError("nope")) is False


def test_resolve_tts_config_no_key_raises():
    with patch.object(gen, "get_learnhouse_config", return_value=_cfg(api_key=None, gemini_api_key=None)):
        with pytest.raises(AINotConfiguredError):
            gen._resolve_tts_config()


def test_resolve_tts_config_default_and_override():
    with patch.object(gen, "get_learnhouse_config", return_value=_cfg(provider="google", api_key="k")):
        key, model = gen._resolve_tts_config()
        assert key == "k"
        assert model == gen.DEFAULT_TTS_MODEL
    with patch.object(
        gen, "get_learnhouse_config",
        return_value=_cfg(provider="openai", api_key=None, gemini_api_key="gk", tts_model="custom-tts"),
    ):
        key, model = gen._resolve_tts_config()
        assert key == "gk"
        assert model == "custom-tts"


# --- generate_speech ------------------------------------------------------

async def test_generate_speech_single_voice():
    client = _fake_client(_fake_response())
    with patch.object(gen, "get_learnhouse_config", return_value=_cfg()), \
         patch("google.genai.Client", return_value=client):
        out = await gen.generate_speech("Hello world", voice="Puck")
    assert out[:4] == b"RIFF" and out[8:12] == b"WAVE"
    assert client.aio.models.generate_content.await_count == 1


async def test_generate_speech_multi_speaker():
    client = _fake_client(_fake_response())
    speakers = [gen.Speaker(name="Host", voice="Kore"), gen.Speaker(name="Guest", voice="Puck")]
    with patch.object(gen, "get_learnhouse_config", return_value=_cfg()), \
         patch("google.genai.Client", return_value=client):
        out = await gen.generate_speech("Host: hi\nGuest: hey", speakers=speakers, style="upbeat", language="English")
    assert out[8:12] == b"WAVE"


async def test_generate_speech_empty_text_raises():
    with pytest.raises(ValueError):
        await gen.generate_speech("   ")


async def test_generate_speech_too_long_raises():
    with pytest.raises(ValueError):
        await gen.generate_speech("x" * (gen.MAX_TEXT_CHARS + 1))


async def test_generate_speech_no_audio_raises_runtime():
    client = _fake_client(SimpleNamespace(candidates=[]))
    with patch.object(gen, "get_learnhouse_config", return_value=_cfg()), \
         patch("google.genai.Client", return_value=client):
        with pytest.raises(RuntimeError):
            await gen.generate_speech("Hello")


async def test_generate_speech_retries_then_succeeds():
    retryable = Exception()
    retryable.code = 503
    client = MagicMock()
    client.aio.models.generate_content = AsyncMock(side_effect=[retryable, _fake_response()])
    with patch.object(gen, "get_learnhouse_config", return_value=_cfg()), \
         patch("google.genai.Client", return_value=client), \
         patch.object(gen.asyncio, "sleep", new=AsyncMock()):
        out = await gen.generate_speech("Hello")
    assert out[:4] == b"RIFF"
    assert client.aio.models.generate_content.await_count == 2


async def test_generate_speech_nonretryable_raises_runtime():
    client = _fake_client(side_effect=ValueError("bad request"))
    with patch.object(gen, "get_learnhouse_config", return_value=_cfg()), \
         patch("google.genai.Client", return_value=client):
        with pytest.raises(RuntimeError):
            await gen.generate_speech("Hello")
