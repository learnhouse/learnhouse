"""Sampling parameters on the shared generation helpers (src/services/ai/llm/client.py).

The Anthropic SDK sends API version 2026-10-21, which rejects `temperature`,
`top_p` and `top_k` on every model with HTTP 400. These tests drive a real
Pydantic AI ``AnthropicModel`` against an in-process HTTP transport and check
the request body that would reach the API, so a dependency bump that changes
how the setting is forwarded is caught too. No network calls.
"""

import json
from unittest.mock import patch

import httpx2
import pytest
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.google import GoogleProvider

from src.services.ai.llm import client as client_mod

_ANTHROPIC_REPLY = {
    "id": "msg_test",
    "type": "message",
    "role": "assistant",
    "model": "claude-sonnet-4-5",
    "content": [{"type": "text", "text": "Hello!"}],
    "stop_reason": "end_turn",
    "stop_sequence": None,
    "usage": {"input_tokens": 3, "output_tokens": 2},
}


def _anthropic_model(captured: list[dict]) -> AnthropicModel:
    def handler(request: httpx2.Request) -> httpx2.Response:
        captured.append({"headers": dict(request.headers), "body": json.loads(request.content)})
        return httpx2.Response(200, json=_ANTHROPIC_REPLY)

    http_client = httpx2.AsyncClient(transport=httpx2.MockTransport(handler))
    return AnthropicModel(
        "claude-sonnet-4-5",
        provider=AnthropicProvider(api_key="test-key", http_client=http_client),
    )


async def test_generate_drops_temperature_for_anthropic():
    captured: list[dict] = []
    with patch.object(client_mod, "build_model", return_value=_anthropic_model(captured)):
        out = await client_mod.generate(
            model_name="claude-sonnet-4-5",
            user_prompt="Hi",
            max_tokens=50,
            temperature=0.8,
        )

    assert out == "Hello!"
    assert len(captured) == 1
    body = captured[0]["body"]
    for field in ("temperature", "top_p", "top_k"):
        assert field not in body
    assert body["max_tokens"] == 50


async def test_generate_stream_drops_temperature_for_anthropic():
    captured: list[dict] = []
    with patch.object(client_mod, "build_model", return_value=_anthropic_model(captured)):
        try:
            async for _ in client_mod.generate_stream(
                model_name="claude-sonnet-4-5", user_prompt="Hi", temperature=0.2
            ):
                pass
        except Exception:
            # The mock answers with a non-streaming body; only the request matters here.
            pass

    assert captured, "no request was sent"
    assert "temperature" not in captured[0]["body"]


@pytest.mark.parametrize("temperature", [0.0, 0.7])
def test_settings_keep_temperature_for_other_providers(temperature):
    model = GoogleModel("gemini-3.5-flash", provider=GoogleProvider(api_key="test-key"))
    settings = client_mod._settings(model, 100, temperature, 60.0)
    assert settings["temperature"] == temperature
    assert settings["max_tokens"] == 100


def test_settings_omit_unset_values():
    model = GoogleModel("gemini-3.5-flash", provider=GoogleProvider(api_key="test-key"))
    settings = client_mod._settings(model, None, None, 30.0)
    assert settings == {"timeout": 30.0}
