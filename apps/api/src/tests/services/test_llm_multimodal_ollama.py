"""Live multimodal test: a real image attachment flowing through the production converter.

This proves that an uploaded image (the `AttachmentData` shape course planning produces) is
converted by ``attachments_to_parts`` into a Pydantic AI part and actually consumed by a
vision-capable model through the provider-agnostic ``generate`` — i.e. image *context* still
works after the refactor.

Scope note: PDFs (BinaryContent application/pdf) and YouTube (VideoUrl) are Gemini-specific
context features. Their mapping to Gemini's inline_data/file_data is verified at the code
level in pydantic_ai/models/google.py (_resolve_file); a live end-to-end check of those two
requires a real Gemini API key and is not run here.

Run locally:
    ollama serve
    ollama pull moondream      # or any vision model; set OLLAMA_VISION_MODEL
    pytest -m ollama src/tests/services/test_llm_multimodal_ollama.py
"""

import base64
import io
import os
import socket
from types import SimpleNamespace

import pytest

from src.services.ai.llm import attachments_to_parts
from src.services.ai.llm import client as llm_client
from src.services.ai.llm import provider as llm_provider

OLLAMA_HOST, OLLAMA_PORT = "localhost", 11434
VISION_MODEL = os.environ.get("OLLAMA_VISION_MODEL", "moondream")


def _ollama_running() -> bool:
    try:
        with socket.create_connection((OLLAMA_HOST, OLLAMA_PORT), timeout=0.5):
            return True
    except OSError:
        return False


pytestmark = [
    pytest.mark.ollama,
    pytest.mark.skipif(not _ollama_running(), reason="Ollama not reachable on localhost:11434"),
]


@pytest.fixture(autouse=True)
def _point_config_at_ollama(monkeypatch):
    cfg = SimpleNamespace(
        provider="ollama",
        api_key=None,
        base_url=f"http://{OLLAMA_HOST}:{OLLAMA_PORT}/v1",
        gemini_api_key=None,
    )
    monkeypatch.setattr(
        llm_provider, "get_learnhouse_config", lambda: SimpleNamespace(ai_config=cfg)
    )


def _solid_png_b64(color: tuple[int, int, int], size: int = 96) -> str:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (size, size), color).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


@pytest.mark.asyncio
async def test_image_attachment_is_seen_by_model():
    # An uploaded-image attachment in the exact shape course planning builds.
    attachment = SimpleNamespace(
        type="image",
        url=None,
        content_base64=_solid_png_b64((220, 20, 20)),  # solid red
        mime_type="image/png",
    )

    # The production converter turns it into a Pydantic AI multimodal part.
    parts = attachments_to_parts([attachment])
    assert [type(p).__name__ for p in parts] == ["BinaryContent"]

    # The vision model must actually receive and interpret the image.
    answer = await llm_client.generate(
        model_name=VISION_MODEL,
        user_prompt=["What is the dominant color of this image? Answer with one word.", *parts],
        timeout=180.0,
    )
    assert isinstance(answer, str) and answer.strip(), "expected a non-empty answer"
    # Best-effort semantic check: the model should identify red.
    assert "red" in answer.lower(), f"model did not identify the image color; got: {answer!r}"
