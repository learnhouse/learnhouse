"""AI speech / podcast generation (Google Gemini TTS).

Like image generation, TTS is a **Google-only** path: the provider-agnostic text
layer in ``src/services/ai/llm`` returns text/embeddings only, so speech goes
straight to the Google GenAI SDK. It reuses the same credential resolution as the
text layer — ``ai_config.api_key`` when the configured provider is Google,
otherwise the legacy ``ai_config.gemini_api_key`` — so no separate key is needed
when the deployment already runs on Gemini.

Two modes share one call:
- ``tts``     — single voice reads the given text.
- ``podcast`` — up to two named speakers (Gemini caps multi-speaker at 2) read a
  dialogue script, with tone/pacing steered by a natural-language style prefix.

Gemini returns headerless 24 kHz / 16-bit / mono PCM; we wrap it in a WAV
container (stdlib ``wave``) so it can be stored and streamed like any uploaded
audio file. All TTS model ids are still *preview* upstream, so the model id is a
config value (``LEARNHOUSE_AI_TTS_MODEL``), never hard-coded into behaviour.
"""

from __future__ import annotations

import asyncio
import io
import logging
import wave
from dataclasses import dataclass
from typing import Optional

from config.config import get_learnhouse_config
from src.services.ai.llm import AINotConfiguredError
from src.services.ai.llm.provider import _GOOGLE_ALIASES

logger = logging.getLogger(__name__)

# Cheapest Gemini TTS model with a free tier; supports single AND multi-speaker.
# Override with LEARNHOUSE_AI_TTS_MODEL (e.g. gemini-2.5-pro-preview-tts for higher
# quality, or a newer preview once it is allowlisted for your key).
DEFAULT_TTS_MODEL = "gemini-2.5-flash-preview-tts"

# Gemini TTS output audio characteristics (fixed by the API).
_SAMPLE_RATE = 24000
_SAMPLE_WIDTH = 2  # 16-bit
_CHANNELS = 1

OUTPUT_EXT = "wav"

# A single TTS request has a ~32k-token context. Cap input well under that so we
# fail fast with a clear error instead of spending a credit on a doomed call.
# Sized to hold up to the longest generated script (see MAX_SPOKEN_MINUTES).
MAX_TEXT_CHARS = 11000

# Upper bound on the topic/brief used to generate a script.
MAX_SCRIPT_BRIEF_CHARS = 8000

# Script length targeting. Natural spoken pace is ~140 words/min; the requested
# duration drives the target word count for generated podcast/monologue scripts.
WORDS_PER_MINUTE = 140
MIN_SPOKEN_MINUTES = 2
MAX_SPOKEN_MINUTES = 10

# Gemini caps multi-speaker synthesis at 2 voices.
MAX_SPEAKERS = 2

# Prebuilt voice names (voiceName → characteristic). Used to validate/normalise
# requested voices; unknown names fall back to DEFAULT_VOICE rather than erroring.
PREBUILT_VOICES: dict[str, str] = {
    "Zephyr": "Bright", "Puck": "Upbeat", "Charon": "Informative", "Kore": "Firm",
    "Fenrir": "Excitable", "Leda": "Youthful", "Orus": "Firm", "Aoede": "Breezy",
    "Callirrhoe": "Easy-going", "Autonoe": "Bright", "Enceladus": "Breathy",
    "Iapetus": "Clear", "Umbriel": "Easy-going", "Algieba": "Smooth",
    "Despina": "Smooth", "Erinome": "Clear", "Algenib": "Gravelly",
    "Rasalgethi": "Informative", "Laomedeia": "Upbeat", "Achernar": "Soft",
    "Alnilam": "Firm", "Schedar": "Even", "Gacrux": "Mature",
    "Pulcherrima": "Forward", "Achird": "Friendly", "Zubenelgenubi": "Casual",
    "Vindemiatrix": "Gentle", "Sadachbia": "Lively", "Sadaltager": "Knowledgeable",
    "Sulafat": "Warm",
}
DEFAULT_VOICE = "Kore"

# Bounded retry for transient upstream errors (rate limit / capacity).
_MAX_ATTEMPTS = 3
_RETRY_BACKOFF_SECONDS = 1.5
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}


@dataclass
class Speaker:
    """A named speaker bound to a prebuilt voice (podcast mode)."""
    name: str
    voice: str


def normalise_voice(voice: Optional[str]) -> str:
    """Return a valid prebuilt voice name, defaulting when unknown/empty."""
    if voice and voice.strip() in PREBUILT_VOICES:
        return voice.strip()
    return DEFAULT_VOICE


def _is_retryable(exc: Exception) -> bool:
    """True for transient Google API errors worth retrying."""
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if isinstance(code, int) and code in _RETRYABLE_STATUS:
        return True
    name = type(exc).__name__
    return name in ("ServerError", "ServiceUnavailable", "ResourceExhausted")


def _resolve_tts_config() -> tuple[str, str]:
    """Return ``(api_key, model)`` for TTS or raise if unconfigured."""
    cfg = get_learnhouse_config().ai_config
    provider_id = (getattr(cfg, "provider", None) or "").strip().lower()

    api_key = None
    if provider_id in _GOOGLE_ALIASES:
        api_key = getattr(cfg, "api_key", None)
    api_key = api_key or getattr(cfg, "gemini_api_key", None)

    if not api_key:
        raise AINotConfiguredError(
            "AI audio generation requires a Google/Gemini API key "
            "(set LEARNHOUSE_GEMINI_API_KEY, or LEARNHOUSE_AI_API_KEY when "
            "LEARNHOUSE_AI_PROVIDER=google)."
        )

    model = (getattr(cfg, "tts_model", None) or "").strip() or DEFAULT_TTS_MODEL
    return api_key, model


def _build_prompt(text: str, *, style: Optional[str], language: Optional[str], podcast: bool) -> str:
    """Prefix the script with natural-language directives.

    Gemini TTS has no separate style/language parameter — tone, pacing and target
    language are all steered through the prompt text. Language is otherwise
    auto-detected from the input, so this directive only nudges it when the caller
    explicitly picked one.
    """
    directives: list[str] = []
    if style and style.strip():
        directives.append(style.strip().rstrip("."))
    elif podcast:
        directives.append("Read aloud in a warm, upbeat, natural podcast tone")
    if language and language.strip():
        directives.append(f"speak in {language.strip()}")

    text = text.strip()
    if not directives:
        return text
    lead = ", ".join(directives).capitalize() + ":"
    if podcast:
        return f"{lead}\nTTS the following conversation:\n{text}"
    return f"{lead}\n{text}"


_PODCAST_SCRIPT_SYSTEM = (
    "You are a professional podcast script writer. Turn the user's topic or source "
    "material into a natural, engaging spoken conversation between the given speakers.\n"
    "Rules:\n"
    "- Output ONLY the dialogue. Every line MUST start with a speaker name followed by a "
    "colon, e.g. 'Host:'. Use ONLY these exact speaker names: {names}.\n"
    "- Alternate turns naturally with a clear intro and wrap-up.\n"
    "{length_line}"
    "- Make it sound spoken — contractions, natural reactions.\n"
    "- Do NOT include stage directions, sound effects, markdown, headings, or narration.\n"
    "{lang_line}{tone_line}"
)

_MONOLOGUE_SCRIPT_SYSTEM = (
    "You are an expert educator and speaker. Turn the user's subject into a detailed, "
    "engaging spoken explanation delivered by a single speaker talking directly to the "
    "listener.\n"
    "Rules:\n"
    "- Output ONLY the spoken words as flowing prose. NO speaker labels, NO markdown, NO "
    "headings, NO bullet points, NO stage directions.\n"
    "- Explain in depth and clearly, well-structured, with a natural intro and a conclusion.\n"
    "{length_line}"
    "- Make it sound spoken — contractions, natural transitions, a clear voice.\n"
    "{lang_line}{tone_line}"
)


async def generate_spoken_script(
    brief: str,
    *,
    kind: str = "podcast",
    speaker_names: Optional[list[str]] = None,
    language: Optional[str] = None,
    style: Optional[str] = None,
    minutes: int = MIN_SPOKEN_MINUTES,
) -> str:
    """Write a spoken script from a topic/brief using the text LLM.

    ``kind='podcast'`` produces a two-speaker dialogue (each line prefixed with a
    speaker name); ``kind='monologue'`` produces a single-speaker explanation as
    flowing prose. ``minutes`` targets the spoken length. Raises
    ``AINotConfiguredError`` when the AI provider is unconfigured, ``ValueError`` on
    empty input, or ``RuntimeError`` on an empty/failed generation.
    """
    from src.services.ai.llm import generate, model_for_tier

    brief = (brief or "").strip()
    if not brief:
        raise ValueError("Add a topic or some text to generate a script from.")
    if len(brief) > MAX_SCRIPT_BRIEF_CHARS:
        brief = brief[:MAX_SCRIPT_BRIEF_CHARS]

    minutes = max(MIN_SPOKEN_MINUTES, min(int(minutes or MIN_SPOKEN_MINUTES), MAX_SPOKEN_MINUTES))
    target_words = minutes * WORDS_PER_MINUTE
    length_line = (
        f"- Aim for about {minutes} minute(s) of spoken audio (roughly {target_words} "
        "words). Use enough content to fill the time naturally, without padding or "
        "abruptly cutting off.\n"
    )
    lang_line = f"- Speak in {language.strip()}.\n" if language and language.strip() else ""
    tone_line = f"- Tone / style: {style.strip()}.\n" if style and style.strip() else ""

    if kind == "monologue":
        system = _MONOLOGUE_SCRIPT_SYSTEM.format(
            length_line=length_line, lang_line=lang_line, tone_line=tone_line
        )
    else:
        names = ", ".join([n for n in (speaker_names or []) if n and n.strip()]) or "Host, Guest"
        system = _PODCAST_SCRIPT_SYSTEM.format(
            names=names, length_line=length_line, lang_line=lang_line, tone_line=tone_line
        )

    # Token budget. The standard tier is a Gemini 3 "thinking" model, where
    # max_output_tokens is SHARED between reasoning tokens and the visible answer —
    # a tight budget makes the script stop mid-sentence (the reasoning eats it up).
    # So give generous headroom for thinking PLUS ~2x the target output length so
    # the script can never be truncated by the ceiling. (max_tokens is a ceiling,
    # not a target — length is steered by the prompt.)
    # Cap stays safely under the flash model's own output limit (~8k tokens); the
    # computed budget for the longest (10 min) script is ~5.8k, so this never binds.
    _THINKING_HEADROOM_TOKENS = 3000
    _OUTPUT_TOKENS_PER_WORD = 2  # ~2x the ~1.4 tokens/word a script actually needs
    max_tokens = min(8000, target_words * _OUTPUT_TOKENS_PER_WORD + _THINKING_HEADROOM_TOKENS)

    try:
        text = await generate(
            model_name=model_for_tier("standard"),
            user_prompt=brief,
            system_prompt=system,
            max_tokens=max_tokens,
            temperature=0.8,
        )
    except AINotConfiguredError:
        raise
    except Exception as e:  # noqa: BLE001 — surface a clean error to the router
        logger.error("Script generation failed: %s", type(e).__name__)
        raise RuntimeError("Script generation failed") from e

    text = (text or "").strip()
    if not text:
        raise RuntimeError("The model returned an empty script. Try a different topic.")
    # Keep the script within the TTS input budget.
    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS]
    return text


def _pcm_to_wav(pcm: bytes) -> bytes:
    """Wrap raw 24 kHz/16-bit/mono PCM in a WAV container."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(_CHANNELS)
        wf.setsampwidth(_SAMPLE_WIDTH)
        wf.setframerate(_SAMPLE_RATE)
        wf.writeframes(pcm)
    return buf.getvalue()


def _extract_pcm(response) -> Optional[bytes]:
    """Pull the first inline audio payload out of a GenAI response."""
    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            inline = getattr(part, "inline_data", None)
            data = getattr(inline, "data", None) if inline else None
            if data:
                return data
    return None


async def generate_speech(
    text: str,
    *,
    voice: Optional[str] = None,
    speakers: Optional[list[Speaker]] = None,
    style: Optional[str] = None,
    language: Optional[str] = None,
) -> bytes:
    """Synthesize speech with Gemini TTS. Returns WAV bytes.

    Single-speaker when ``speakers`` is empty (uses ``voice``); otherwise
    multi-speaker "podcast" mode binding each speaker name to a prebuilt voice.

    Raises ``AINotConfiguredError`` when no Google key is configured, or a plain
    ``RuntimeError`` when the model returns no audio (e.g. a safety refusal).
    """
    from google import genai
    from google.genai import types

    text = (text or "").strip()
    if not text:
        raise ValueError("Some text is required to generate audio.")
    if len(text) > MAX_TEXT_CHARS:
        raise ValueError(
            f"Text is too long ({len(text)} chars). Keep it under {MAX_TEXT_CHARS} "
            "characters per generation."
        )

    api_key, model = _resolve_tts_config()
    podcast = bool(speakers)
    prompt = _build_prompt(text, style=style, language=language, podcast=podcast)

    if podcast:
        speaker_configs = [
            types.SpeakerVoiceConfig(
                speaker=s.name,
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name=normalise_voice(s.voice)
                    )
                ),
            )
            for s in speakers[:MAX_SPEAKERS]
        ]
        speech_config = types.SpeechConfig(
            multi_speaker_voice_config=types.MultiSpeakerVoiceConfig(
                speaker_voice_configs=speaker_configs
            )
        )
    else:
        speech_config = types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=normalise_voice(voice)
                )
            )
        )

    config = types.GenerateContentConfig(
        response_modalities=["AUDIO"],
        speech_config=speech_config,
    )

    client = genai.Client(api_key=api_key)
    response = None
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            response = await client.aio.models.generate_content(
                model=model,
                contents=prompt,
                config=config,
            )
            break
        except Exception as e:  # noqa: BLE001 — surface a clean error to the router
            # Log only the exception type: the underlying SDK error can embed the
            # API key (request URL/headers), so never log the message or traceback.
            if _is_retryable(e) and attempt < _MAX_ATTEMPTS:
                logger.warning(
                    "Audio generation transient error (%s), retry %d/%d",
                    type(e).__name__, attempt, _MAX_ATTEMPTS,
                )
                await asyncio.sleep(_RETRY_BACKOFF_SECONDS * attempt)
                continue
            logger.error("Audio generation call failed: %s", type(e).__name__)
            raise RuntimeError("Audio generation failed") from e

    pcm = _extract_pcm(response)
    if not pcm:
        logger.warning("Audio generation returned no audio")
        raise RuntimeError(
            "The model did not return any audio. Try rephrasing or shortening your text."
        )
    return _pcm_to_wav(pcm)
