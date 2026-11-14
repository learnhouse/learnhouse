"""Unified, provider-neutral generation helpers.

All AI text generation in the backend goes through ``generate`` / ``generate_stream`` so the
underlying provider is a config concern, not a code concern. These wrap Pydantic AI's
``Agent`` and translate the app's stored message/attachment formats into Pydantic AI types.
"""

from __future__ import annotations

import base64
import logging
from typing import Any, AsyncGenerator, Optional, Sequence, Type, Union

from pydantic_ai import Agent
from pydantic_ai.messages import (
    SystemPromptPart,
    BinaryContent,
    DocumentUrl,
    ImageUrl,
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
    VideoUrl,
)
from pydantic_ai.models import Model
from pydantic_ai.settings import ModelSettings

from src.services.ai.llm.provider import build_model

logger = logging.getLogger(__name__)

# Per-request timeouts (seconds). Mirrors the previous hand-rolled asyncio timeouts.
DEFAULT_TIMEOUT = 60.0
STREAM_TIMEOUT = 90.0

# A single user turn: a prompt string plus optional multimodal parts (images/docs/video).
UserPrompt = Union[str, Sequence[Any]]


def to_message_history(stored: Any) -> list[ModelMessage]:
    """Convert stored chat history into Pydantic AI ``ModelMessage`` objects.

    Accepts the Redis JSON format (``[{"role": "user"|"model", "content": str}, ...]``) and
    the legacy object format (``msg.type``/``msg.content``). Unknown entries are skipped.
    """
    messages: list[ModelMessage] = []
    if not stored:
        return messages

    items = getattr(stored, "messages", stored)
    for msg in items:
        if isinstance(msg, dict) and "role" in msg and "content" in msg:
            role, content = msg["role"], msg["content"]
        elif hasattr(msg, "type") and hasattr(msg, "content"):
            role = "user" if msg.type == "human" else "model"
            content = msg.content
        else:
            continue

        if not content:
            continue
        if role == "user":
            messages.append(ModelRequest(parts=[UserPromptPart(content=content)]))
        else:
            messages.append(ModelResponse(parts=[TextPart(content=content)]))
    return messages


def attachments_to_parts(attachments: Any) -> list:
    """Convert ``AttachmentData``-like objects into Pydantic AI multimodal parts.

    Replaces the Gemini-specific ``inline_data``/``file_data`` dicts. Note: video/YouTube and
    URL-based documents are only honored by providers that support them (e.g. Gemini); other
    providers will ignore or reject them, an inherent provider capability difference.
    """
    parts: list = []
    for att in attachments or []:
        a_type = getattr(att, "type", None)
        url = getattr(att, "url", None)
        b64 = getattr(att, "content_base64", None)
        mime = getattr(att, "mime_type", None)

        if a_type == "youtube" and url:
            parts.append(VideoUrl(url=url))
        elif a_type in ("image", "file") and b64 and mime:
            # content_base64 is user-supplied; a malformed/truncated value would
            # raise binascii.Error and surface as an unhandled 500. Skip the bad
            # attachment instead of crashing the whole request.
            try:
                decoded = base64.b64decode(b64)
            except Exception:
                logger.warning("Skipping attachment with invalid base64 content")
                continue
            parts.append(BinaryContent(data=decoded, media_type=mime))
        elif a_type == "image" and url:
            parts.append(ImageUrl(url=url))
        elif a_type == "file" and url:
            parts.append(DocumentUrl(url=url))
    return parts


def _history_with_system(history: Any, system_prompt: Optional[str]) -> Optional[list[ModelMessage]]:
    """Stored history as model messages, led by the system prompt.

    Pydantic AI only injects ``system_prompt`` when ``message_history`` is
    empty. Every follow-up turn of a chat therefore used to run without its
    instructions or retrieved course context. Putting the prompt at the head
    of the history keeps it on every turn.
    """
    messages = to_message_history(history)
    if not messages:
        return None
    if system_prompt:
        messages.insert(0, ModelRequest(parts=[SystemPromptPart(content=system_prompt)]))
    return messages


# Providers whose API rejects sampling parameters for every model. The Anthropic
# SDK sends API version 2026-10-21 since 2.0, and on that version a Messages
# request carrying `temperature`, `top_p` or `top_k` returns HTTP 400, even at
# the default value. Pydantic AI only strips them for the newest Claude models,
# so the documented `claude-sonnet-4-5` / `claude-haiku-4-5` setups broke.
# Callers pass `temperature` as a hint; dropping it here keeps every feature
# working on these providers with the model's default sampling.
_PROVIDERS_WITHOUT_SAMPLING = frozenset({"anthropic"})


def _settings(
    model: Model, max_tokens: Optional[int], temperature: Optional[float], timeout: float
) -> ModelSettings:
    settings: dict = {"timeout": timeout}
    if max_tokens is not None:
        settings["max_tokens"] = max_tokens
    if temperature is not None and model.system not in _PROVIDERS_WITHOUT_SAMPLING:
        settings["temperature"] = temperature
    return ModelSettings(**settings)


def _agent(model: Model, system_prompt: Optional[str], output_type: Any) -> Agent:
    return Agent(
        model,
        output_type=output_type,
        system_prompt=system_prompt or (),
    )


async def generate(
    *,
    model_name: str,
    user_prompt: UserPrompt,
    system_prompt: Optional[str] = None,
    history: Any = None,
    output_type: Type[Any] = str,
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> Any:
    """Run a single (non-streaming) generation.

    Returns plain text when ``output_type`` is ``str``, or a validated instance of
    ``output_type`` (a Pydantic model) for structured output.
    """
    model = build_model(model_name)
    agent = _agent(model, system_prompt, output_type)
    result = await agent.run(
        user_prompt,
        message_history=_history_with_system(history, system_prompt),
        model_settings=_settings(model, max_tokens, temperature, timeout),
    )
    return result.output


async def generate_stream(
    *,
    model_name: str,
    user_prompt: UserPrompt,
    system_prompt: Optional[str] = None,
    history: Any = None,
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = None,
    timeout: float = STREAM_TIMEOUT,
) -> AsyncGenerator[str, None]:
    """Stream text deltas for a single generation, yielding chunks as they arrive."""
    model = build_model(model_name)
    agent = _agent(model, system_prompt, str)
    async with agent.run_stream(
        user_prompt,
        message_history=_history_with_system(history, system_prompt),
        model_settings=_settings(model, max_tokens, temperature, timeout),
    ) as result:
        async for chunk in result.stream_text(delta=True):
            yield chunk
