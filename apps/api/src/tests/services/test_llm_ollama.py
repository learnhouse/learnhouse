"""Live, local provider-agnostic tests against Ollama (no cloud keys).

These prove that text generation, streaming, and structured output run through the same
``src.services.ai.llm`` layer on a NON-Gemini provider with zero code changes — the whole
point of the refactor. They are opt-in and skipped automatically when Ollama isn't running.

Run locally with:
    ollama serve
    ollama pull llama3.2          # or any small instruct model
    pytest -m ollama src/tests/services/test_llm_ollama.py
Override the model with OLLAMA_TEST_MODEL if you pulled a different one.
"""

import json
import os
import socket
from types import SimpleNamespace

import pytest

from src.services.ai.llm import client as llm_client
from src.services.ai.llm import provider as llm_provider

OLLAMA_HOST, OLLAMA_PORT = "localhost", 11434
OLLAMA_BASE_URL = f"http://{OLLAMA_HOST}:{OLLAMA_PORT}/v1"
OLLAMA_MODEL = os.environ.get("OLLAMA_TEST_MODEL", "llama3.2")


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
    """Make build_model resolve to the local Ollama server for every test here."""
    cfg = SimpleNamespace(
        provider="ollama",
        api_key=None,
        base_url=OLLAMA_BASE_URL,
        gemini_api_key=None,
    )
    monkeypatch.setattr(
        llm_provider, "get_learnhouse_config", lambda: SimpleNamespace(ai_config=cfg)
    )


@pytest.mark.asyncio
async def test_generate_returns_text():
    text = await llm_client.generate(
        model_name=OLLAMA_MODEL,
        user_prompt="Reply with the single word: pong",
        system_prompt="You are a terse assistant.",
        timeout=120.0,
    )
    assert isinstance(text, str) and text.strip()


@pytest.mark.asyncio
async def test_generate_stream_yields_chunks():
    chunks = []
    async for chunk in llm_client.generate_stream(
        model_name=OLLAMA_MODEL,
        user_prompt="Count from 1 to 5 separated by spaces.",
        system_prompt="You are a terse assistant.",
        timeout=120.0,
    ):
        chunks.append(chunk)
    assert chunks
    assert "".join(chunks).strip()


@pytest.mark.asyncio
async def test_generate_json_text_parses():
    # Mirrors the real production pattern (course planning / migration): the model is asked
    # for JSON, returns it as text, and the app parses it. This is provider-agnostic and does
    # not depend on a provider's tool-calling support. The `output_type=` (tool-calling) path
    # also exists in the layer but is intentionally unused by features and is unreliable on
    # tiny local models, so we validate the pattern the codebase actually relies on.
    text = await llm_client.generate(
        model_name=OLLAMA_MODEL,
        user_prompt=(
            "Create a tiny course about the water cycle. Output ONLY valid JSON of the form "
            '{"name": "...", "chapters": ["...", "..."]}. No prose, no code fences.'
        ),
        system_prompt="You output only valid JSON. Never include explanations or markdown.",
        timeout=120.0,
    )
    # Reuse the same defensive extraction the course-planning service uses.
    cleaned = text.strip()
    if "```" in cleaned:
        cleaned = cleaned.split("```")[1].removeprefix("json").strip()
    cleaned = cleaned[cleaned.find("{") : cleaned.rfind("}") + 1]
    data = json.loads(cleaned)
    assert "name" in data and "chapters" in data
    assert isinstance(data["chapters"], list) and data["chapters"]


@pytest.mark.asyncio
async def test_history_round_trips():
    history = [
        {"role": "user", "content": "My favorite color is teal."},
        {"role": "model", "content": "Got it — teal."},
    ]
    text = await llm_client.generate(
        model_name=OLLAMA_MODEL,
        user_prompt="What is my favorite color? Answer with one word.",
        history=history,
        timeout=120.0,
    )
    assert "teal" in text.lower()
