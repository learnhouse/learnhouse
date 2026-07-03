"""AI image generation (Google "nano banana" family).

Image generation is a **Google-only** path: the provider-agnostic text layer in
``src/services/ai/llm`` returns text/embeddings only, so images go straight to
the Google GenAI SDK. It still reuses the same credential resolution as the text
layer — ``ai_config.api_key`` when the configured provider is Google, otherwise
the legacy ``ai_config.gemini_api_key`` — so no separate key is needed when the
deployment already runs on Gemini.

Supports two modes with the same call:
- text-to-image (``prompt`` only)
- image editing / iterative refinement (``prompt`` + one or more ``input_images``)
  which powers the chatbot-like "make it darker / add a diagram" refine loop.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from config.config import get_learnhouse_config
from src.services.ai.llm import AINotConfiguredError
from src.services.ai.llm.provider import _GOOGLE_ALIASES

logger = logging.getLogger(__name__)

# Google "nano banana" image model. Defaults to the generally-available Gemini 2.5
# Flash Image model so generation works out of the box on any Gemini API key.
# Newer/preview models (e.g. Nano Banana 2 / "gemini-3-pro-image-preview") require
# allowlist access and can 429/500 under capacity — set LEARNHOUSE_AI_IMAGE_MODEL
# to opt into one once it is enabled for your key.
DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image"

# Nano banana returns PNG inline data.
OUTPUT_MIME = "image/png"
OUTPUT_EXT = "png"

# Guard against pathologically large prompts before we spend a credit / call out.
MAX_PROMPT_CHARS = 4000

# Bounded retry for transient upstream errors (rate limit / capacity).
_MAX_ATTEMPTS = 3
_RETRY_BACKOFF_SECONDS = 1.5
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}


def _sniff_mime(data: bytes) -> str:
    """Best-effort image MIME detection so edit/refine inputs aren't mislabeled."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return OUTPUT_MIME


def _is_retryable(exc: Exception) -> bool:
    """True for transient Google API errors worth retrying."""
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if isinstance(code, int) and code in _RETRYABLE_STATUS:
        return True
    # google.genai raises ServerError (5xx) / APIError with a numeric status.
    name = type(exc).__name__
    return name in ("ServerError", "ServiceUnavailable", "ResourceExhausted")


def _resolve_image_config() -> tuple[str, str]:
    """Return ``(api_key, model)`` for image generation or raise if unconfigured."""
    cfg = get_learnhouse_config().ai_config
    provider_id = (getattr(cfg, "provider", None) or "").strip().lower()

    # Prefer the unified key when the deployment is already on Google; otherwise
    # fall back to the dedicated Gemini key (which any provider can set purely for
    # image generation, since this path is Google-only).
    api_key = None
    if provider_id in _GOOGLE_ALIASES:
        api_key = getattr(cfg, "api_key", None)
    api_key = api_key or getattr(cfg, "gemini_api_key", None)

    if not api_key:
        raise AINotConfiguredError(
            "AI image generation requires a Google/Gemini API key "
            "(set LEARNHOUSE_GEMINI_API_KEY, or LEARNHOUSE_AI_API_KEY when "
            "LEARNHOUSE_AI_PROVIDER=google)."
        )

    model = (getattr(cfg, "image_model", None) or "").strip() or DEFAULT_IMAGE_MODEL
    return api_key, model


def _extract_image_bytes(response) -> Optional[bytes]:
    """Pull the first inline image payload out of a GenAI response."""
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


async def generate_image(
    prompt: str,
    *,
    input_images: Optional[list[bytes]] = None,
) -> bytes:
    """Generate (or edit) an image with the nano banana model. Returns PNG bytes.

    Raises ``AINotConfiguredError`` when no Google key is configured, or a plain
    ``RuntimeError`` when the model returns no image (e.g. a safety refusal).
    """
    from google import genai
    from google.genai import types

    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("A non-empty prompt is required for image generation.")
    if len(prompt) > MAX_PROMPT_CHARS:
        prompt = prompt[:MAX_PROMPT_CHARS]

    api_key, model = _resolve_image_config()

    # Build multimodal contents.
    #   - EDIT/REFINE (input_images present): put the reference image(s) FIRST and
    #     frame the instruction as an edit of "the provided image". This matches
    #     Google's image-editing recipe and is what makes the model modify the
    #     attachment instead of generating a fresh image from the words alone.
    #   - TEXT-TO-IMAGE: prompt only.
    # Sniff each image's real MIME type — a JPEG/WebP mislabeled as PNG is rejected.
    imgs = [img for img in (input_images or []) if img]
    contents: list = []
    if imgs:
        for img in imgs:
            contents.append(types.Part.from_bytes(data=img, mime_type=_sniff_mime(img)))
        contents.append(
            f"Using the provided image as the starting point, edit it as follows: {prompt}"
        )
    else:
        contents.append(prompt)

    # Request both output modalities — Google's documented image-editing config.
    # TEXT parts are skipped by _extract_image_bytes, so output handling is
    # unchanged; this only avoids a spurious "no image" 502 when an edit turn also
    # returns a text note. (response_modalities is OUTPUT-only — the edit framing
    # above, not this, is what makes the input image be used.)
    config = types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"])

    client = genai.Client(api_key=api_key)
    response = None
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            response = await client.aio.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
            break
        except Exception as e:  # noqa: BLE001 — surface a clean error to the router
            # Log only the exception type: the underlying SDK error can embed the
            # API key (request URL/headers), so never log the message or traceback.
            if _is_retryable(e) and attempt < _MAX_ATTEMPTS:
                logger.warning(
                    "Image generation transient error (%s), retry %d/%d",
                    type(e).__name__, attempt, _MAX_ATTEMPTS,
                )
                await asyncio.sleep(_RETRY_BACKOFF_SECONDS * attempt)
                continue
            logger.error("Image generation call failed: %s", type(e).__name__)
            raise RuntimeError("Image generation failed") from e

    image_bytes = _extract_image_bytes(response)
    if not image_bytes:
        # Most commonly a safety block — no inline image part was returned.
        # `model` is intentionally not logged: it shares a return tuple with the
        # API key, so logging it trips clear-text-secret analysis.
        logger.warning("Image generation returned no image")
        raise RuntimeError(
            "The model did not return an image. Try rephrasing your prompt."
        )
    return image_bytes
