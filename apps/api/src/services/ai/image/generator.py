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

import logging
from typing import Optional

from config.config import get_learnhouse_config
from src.services.ai.llm import AINotConfiguredError
from src.services.ai.llm.provider import _GOOGLE_ALIASES

logger = logging.getLogger(__name__)

# Google "nano banana 2 lite" image model. Overridable via LEARNHOUSE_AI_IMAGE_MODEL
# so the exact model id can be pinned/upgraded without a code change (Google's
# preview model strings change over time — confirm the current id for your key).
DEFAULT_IMAGE_MODEL = "gemini-3-pro-image-preview"

# Nano banana returns PNG inline data.
OUTPUT_MIME = "image/png"
OUTPUT_EXT = "png"

# Guard against pathologically large prompts before we spend a credit / call out.
MAX_PROMPT_CHARS = 4000


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

    # Build multimodal contents: the prompt plus any reference images to edit.
    contents: list = [prompt]
    for img in input_images or []:
        if img:
            contents.append(types.Part.from_bytes(data=img, mime_type=OUTPUT_MIME))

    client = genai.Client(api_key=api_key)
    try:
        response = await client.aio.models.generate_content(
            model=model,
            contents=contents,
        )
    except Exception as e:  # noqa: BLE001 — surface a clean error to the router
        # Log only the exception type: the underlying SDK error can embed the
        # API key (request URL/headers), so never log the message or traceback.
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
