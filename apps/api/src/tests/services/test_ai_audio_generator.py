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


def _fake_response(pcm=b"PCMDATA", mime_type="audio/L16;codec=pcm;rate=24000"):
    part = SimpleNamespace(inline_data=SimpleNamespace(data=pcm, mime_type=mime_type))
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


def test_extract_audio():
    assert gen._extract_audio(_fake_response(b"PCM", "audio/wav")) == (b"PCM", "audio/wav")
    no_inline = SimpleNamespace(
        candidates=[SimpleNamespace(content=SimpleNamespace(parts=[SimpleNamespace(inline_data=None)]))]
    )
    assert gen._extract_audio(no_inline) == (None, None)
    assert gen._extract_audio(SimpleNamespace(candidates=[])) == (None, None)


def test_to_wav_passes_through_a_complete_wav():
    # GA models return a full WAV file; wrapping it again would corrupt it.
    wav = gen._pcm_to_wav(b"\x01\x02" * 50)
    assert gen._to_wav(wav, "audio/wav") is wav


def test_to_wav_wraps_raw_pcm_using_the_mime_rate():
    pcm = b"\x00\x01" * 100
    out = gen._to_wav(pcm, "audio/l16; rate=16000; channels=1")
    with wave.open(io.BytesIO(out)) as wf:
        assert wf.getframerate() == 16000
        assert wf.getnchannels() == 1
        assert wf.readframes(100) == pcm
    # No rate in the mime type: fall back to the documented 24 kHz.
    with wave.open(io.BytesIO(gen._to_wav(pcm, None))) as wf:
        assert wf.getframerate() == 24000


def test_default_model_uses_current_request_shape():
    assert gen._uses_speech_metadata(gen.DEFAULT_TTS_MODEL) is True
    assert gen._uses_speech_metadata("gemini-3.8-flash-lite-tts") is True


@pytest.mark.parametrize(
    "model",
    ["gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts", "gemini-3.1-flash-tts-preview",
     "models/gemini-2.5-flash-preview-tts"],
)
def test_preview_models_use_legacy_request_shape(model):
    assert gen._uses_speech_metadata(model) is False


def test_split_turns_basic_dialogue():
    script = "Host: Welcome to the show.\nGuest: Thanks for having me!"
    assert gen._split_turns(script, ["Host", "Guest"]) == [
        ("Host", "Welcome to the show."),
        ("Guest", "Thanks for having me!"),
    ]


def test_split_turns_keeps_every_line():
    script = (
        "Intro line without a label.\n\n"
        "**host:** First point,\n"
        "continued on the next line.\n"
        "Guest: Note: colons inside a line are fine.\n"
        "Narrator: not a configured speaker"
    )
    assert gen._split_turns(script, ["Host", "Guest"]) == [
        ("Host", "Intro line without a label."),
        ("Host", "First point, continued on the next line."),
        ("Guest", "Note: colons inside a line are fine. Narrator: not a configured speaker"),
    ]


def test_build_contents_ga_podcast_tags_each_turn():
    speakers = [gen.Speaker(name="Host", voice="Kore"), gen.Speaker(name="Guest", voice="Puck")]
    contents = gen._build_contents(
        "Host: hi\nGuest: hey", model="gemini-3.8-flash-tts", speakers=speakers,
        style=None, language="French",
    )
    assert [p.text for p in contents.parts] == ["hi", "hey"]
    assert [p.speech_metadata.speaker for p in contents.parts] == ["Host", "Guest"]
    style = contents.parts[0].speech_metadata.style.lower()
    assert "podcast" in style and "french" in style


def test_build_contents_ga_single_voice_keeps_text_verbatim():
    plain = gen._build_contents("Hello", model="gemini-3.8-flash-tts", speakers=None, style=None, language=None)
    assert plain.parts[0].text == "Hello"
    assert plain.parts[0].speech_metadata is None
    styled = gen._build_contents("Hello", model="gemini-3.8-flash-tts", speakers=None, style="calm", language=None)
    assert styled.parts[0].text == "Hello"
    assert styled.parts[0].speech_metadata.style == "Calm"
    assert styled.parts[0].speech_metadata.speaker is None


def test_build_contents_legacy_model_uses_prompt_prefix():
    speakers = [gen.Speaker(name="Host", voice="Kore")]
    contents = gen._build_contents(
        "Host: hi", model="gemini-2.5-flash-preview-tts", speakers=speakers, style=None, language=None,
    )
    assert isinstance(contents, str)
    assert "TTS the following conversation" in contents and "Host: hi" in contents


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


async def test_generate_speech_uses_v1beta_and_returns_ga_wav_unchanged():
    # speech_metadata only exists on v1beta; GA models answer with a full WAV.
    wav = gen._pcm_to_wav(b"\x01\x00" * 64)
    client = _fake_client(_fake_response(wav, "audio/wav"))
    with patch.object(gen, "get_learnhouse_config", return_value=_cfg()), \
         patch("google.genai.Client", return_value=client) as client_cls:
        out = await gen.generate_speech("Hello world")
    assert out == wav
    assert client_cls.call_args.kwargs["http_options"] == {"api_version": "v1beta"}


async def test_generate_speech_multi_speaker():
    client = _fake_client(_fake_response())
    speakers = [gen.Speaker(name="Host", voice="Kore"), gen.Speaker(name="Guest", voice="Puck")]
    with patch.object(gen, "get_learnhouse_config", return_value=_cfg()), \
         patch("google.genai.Client", return_value=client):
        out = await gen.generate_speech("Host: hi\nGuest: hey", speakers=speakers, style="upbeat", language="English")
    assert out[8:12] == b"WAVE"
    contents = client.aio.models.generate_content.await_args.kwargs["contents"]
    assert [p.speech_metadata.speaker for p in contents.parts] == ["Host", "Guest"]


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


# --- generate_spoken_script ----------------------------------------------

async def test_generate_spoken_script_podcast_happy():
    gm = AsyncMock(return_value="Host: Hi\nGuest: Hey")
    with patch("src.services.ai.llm.generate", new=gm), \
         patch("src.services.ai.llm.model_for_tier", return_value="m"):
        out = await gen.generate_spoken_script(
            "about cats", kind="podcast", speaker_names=["Host", "Guest"], language="English", style="fun"
        )
    assert out.startswith("Host:")
    # Podcast system prompt enforces speaker-labelled dialogue.
    assert "speaker name" in gm.await_args.kwargs["system_prompt"].lower()


async def test_generate_spoken_script_monologue_uses_prose_prompt():
    gm = AsyncMock(return_value="Photosynthesis is how plants make food...")
    with patch("src.services.ai.llm.generate", new=gm), \
         patch("src.services.ai.llm.model_for_tier", return_value="m"):
        out = await gen.generate_spoken_script("photosynthesis", kind="monologue")
    assert out.startswith("Photosynthesis")
    system = gm.await_args.kwargs["system_prompt"].lower()
    assert "single speaker" in system
    assert "no speaker labels" in system


async def test_generate_spoken_script_minutes_drives_target_and_clamps():
    gm = AsyncMock(return_value="Host: hi")
    with patch("src.services.ai.llm.generate", new=gm), \
         patch("src.services.ai.llm.model_for_tier", return_value="m"):
        # Over the max clamps to MAX_SPOKEN_MINUTES.
        await gen.generate_spoken_script("t", minutes=99)
    system = gm.await_args.kwargs["system_prompt"]
    assert f"{gen.MAX_SPOKEN_MINUTES} minute" in system
    assert str(gen.MAX_SPOKEN_MINUTES * gen.WORDS_PER_MINUTE) in system


async def test_generate_spoken_script_minutes_below_min_clamps():
    gm = AsyncMock(return_value="Host: hi")
    with patch("src.services.ai.llm.generate", new=gm), \
         patch("src.services.ai.llm.model_for_tier", return_value="m"):
        await gen.generate_spoken_script("t", minutes=1)
    assert f"{gen.MIN_SPOKEN_MINUTES} minute" in gm.await_args.kwargs["system_prompt"]


async def test_generate_spoken_script_budget_has_thinking_headroom():
    # The standard tier is a Gemini-3 thinking model whose max_output_tokens is
    # shared between reasoning and the answer. The budget must leave ample room
    # beyond the visible output, or scripts get cut off mid-sentence. Guards the fix.
    gm = AsyncMock(return_value="Host: hi")
    with patch("src.services.ai.llm.generate", new=gm), \
         patch("src.services.ai.llm.model_for_tier", return_value="m"):
        await gen.generate_spoken_script("topic", minutes=gen.MIN_SPOKEN_MINUTES)
    two_min = gm.await_args.kwargs["max_tokens"]
    assert two_min >= 3000
    with patch("src.services.ai.llm.generate", new=gm), \
         patch("src.services.ai.llm.model_for_tier", return_value="m"):
        await gen.generate_spoken_script("topic", minutes=gen.MAX_SPOKEN_MINUTES)
    # Longer scripts get a larger budget.
    assert gm.await_args.kwargs["max_tokens"] > two_min


async def test_generate_spoken_script_empty_brief_raises():
    with pytest.raises(ValueError):
        await gen.generate_spoken_script("   ")


async def test_generate_spoken_script_empty_output_raises_runtime():
    with patch("src.services.ai.llm.generate", new=AsyncMock(return_value="   ")), \
         patch("src.services.ai.llm.model_for_tier", return_value="m"):
        with pytest.raises(RuntimeError):
            await gen.generate_spoken_script("topic")


async def test_generate_spoken_script_truncates_to_tts_budget():
    long_script = "Host: " + ("x" * (gen.MAX_TEXT_CHARS + 500))
    with patch("src.services.ai.llm.generate", new=AsyncMock(return_value=long_script)), \
         patch("src.services.ai.llm.model_for_tier", return_value="m"):
        out = await gen.generate_spoken_script("topic")
    assert len(out) <= gen.MAX_TEXT_CHARS
