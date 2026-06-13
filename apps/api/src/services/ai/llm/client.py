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
    providers will ignore or reject them — an inherent provider capability difference.
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
            parts.append(BinaryContent(data=base64.b64decode(b64), media_type=mime))
        elif a_type == "image" and url:
            parts.append(ImageUrl(url=url))
        elif a_type == "file" and url:
            parts.append(DocumentUrl(url=url))
    return parts


def _settings(
    max_tokens: Optional[int], temperature: Optional[float], timeout: float
) -> ModelSettings:
    settings: dict = {"timeout": timeout}
    if max_tokens is not None:
        settings["max_tokens"] = max_tokens
    if temperature is not None:
        settings["temperature"] = temperature
    return ModelSettings(**settings)


def _agent(model_name: str, system_prompt: Optional[str], output_type: Any) -> Agent:
    return Agent(
        build_model(model_name),
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
    agent = _agent(model_name, system_prompt, output_type)
    result = await agent.run(
        user_prompt,
        message_history=to_message_history(history) or None,
        model_settings=_settings(max_tokens, temperature, timeout),
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
    agent = _agent(model_name, system_prompt, str)
    async with agent.run_stream(
        user_prompt,
        message_history=to_message_history(history) or None,
        model_settings=_settings(max_tokens, temperature, timeout),
    ) as result:
        async for chunk in result.stream_text(delta=True):
            yield chunk
