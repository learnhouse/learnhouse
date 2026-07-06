"""Request schemas for AI audio / podcast generation (Gemini TTS)."""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class GenerateAudioSpeaker(BaseModel):
    """A named speaker bound to a prebuilt Gemini voice (podcast mode)."""
    name: str
    voice: str


class GenerateAudioRequest(BaseModel):
    # The activity the generated audio block is attached to. The generated file is
    # stored and streamed exactly like an uploaded audio block.
    activity_uuid: str
    # 'tts' → single voice; 'podcast' → up to two named speakers reading a dialogue.
    mode: Literal["tts", "podcast"] = "tts"
    # The text (tts) or dialogue script (podcast) to synthesize.
    text: str
    # Single-speaker voice (tts mode).
    voice: Optional[str] = None
    # Named speaker → voice bindings (podcast mode; max 2).
    speakers: Optional[list[GenerateAudioSpeaker]] = Field(default=None)
    # Optional natural-language tone/style directive (e.g. "calm and reassuring").
    style: Optional[str] = None
    # Optional target language label/BCP-47 (Gemini otherwise auto-detects it).
    language: Optional[str] = None
