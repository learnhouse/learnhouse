"""Unit tests for the provider-agnostic LLM layer (src/services/ai/llm).

Covers the model factory (one provider per config), the message-history converter, and the
attachment converter. No network calls — provider clients are constructed but never invoked.
"""

import base64
from types import SimpleNamespace

import pytest

from src.services.ai.llm import (
    AINotConfiguredError,
    attachments_to_parts,
    build_model,
    model_for_tier,
    to_message_history,
)
from src.services.ai.llm import provider as provider_mod


def _patch_ai_config(monkeypatch, **overrides):
    """Point build_model at a synthetic ai_config."""
    fields = {"provider": None, "api_key": None, "base_url": None, "gemini_api_key": None}
    fields.update(overrides)
    cfg = SimpleNamespace(**fields)
    monkeypatch.setattr(
        provider_mod, "get_learnhouse_config", lambda: SimpleNamespace(ai_config=cfg)
    )


@pytest.mark.parametrize(
    "provider,model_name,expected_cls",
    [
        ("google", "gemini-2.5-flash", "GoogleModel"),
        ("openai", "gpt-4o", "OpenAIChatModel"),
        ("anthropic", "claude-sonnet-4-5", "AnthropicModel"),
        ("groq", "llama-3.3-70b", "GroqModel"),
        ("mistral", "mistral-large", "MistralModel"),
    ],
)
def test_build_model_per_provider(monkeypatch, provider, model_name, expected_cls):
    _patch_ai_config(monkeypatch, provider=provider, api_key="test-key")
    model = build_model(model_name)
    assert type(model).__name__ == expected_cls


def test_build_model_ollama_needs_no_key(monkeypatch):
    # Ollama speaks the OpenAI API and requires no real credentials.
    _patch_ai_config(monkeypatch, provider="ollama", base_url="http://localhost:11434/v1")
    model = build_model("llama3.2")
    assert type(model).__name__ == "OpenAIChatModel"


def test_build_model_defaults_to_google(monkeypatch):
    _patch_ai_config(monkeypatch, provider=None, api_key="test-key")
    assert type(build_model("gemini-2.5-flash")).__name__ == "GoogleModel"


def test_build_model_google_falls_back_to_gemini_key(monkeypatch):
    # Legacy deployments only set gemini_api_key; the google provider should still work.
    _patch_ai_config(monkeypatch, provider="google", api_key=None, gemini_api_key="legacy-key")
    assert type(build_model("gemini-2.5-flash")).__name__ == "GoogleModel"


def test_build_model_missing_key_raises(monkeypatch):
    _patch_ai_config(monkeypatch, provider="openai", api_key=None)
    with pytest.raises(AINotConfiguredError):
        build_model("gpt-4o")


def test_build_model_unknown_provider_raises(monkeypatch):
    _patch_ai_config(monkeypatch, provider="does-not-exist", api_key="x")
    with pytest.raises(AINotConfiguredError):
        build_model("whatever")


def test_to_message_history_dict_format():
    msgs = to_message_history(
        [
            {"role": "user", "content": "hello"},
            {"role": "model", "content": "hi there"},
            {"role": "user", "content": ""},  # empty content is skipped
        ]
    )
    assert [type(m).__name__ for m in msgs] == ["ModelRequest", "ModelResponse"]


def test_to_message_history_object_format():
    msgs = to_message_history(
        [
            SimpleNamespace(type="human", content="q"),
            SimpleNamespace(type="ai", content="a"),
        ]
    )
    assert [type(m).__name__ for m in msgs] == ["ModelRequest", "ModelResponse"]


def test_to_message_history_empty():
    assert to_message_history(None) == []
    assert to_message_history([]) == []


def test_attachments_to_parts():
    img_b64 = base64.b64encode(b"\x89PNG").decode()
    parts = attachments_to_parts(
        [
            SimpleNamespace(type="youtube", url="https://youtu.be/x", content_base64=None, mime_type=None),
            SimpleNamespace(type="image", url=None, content_base64=img_b64, mime_type="image/png"),
            SimpleNamespace(type="file", url=None, content_base64=img_b64, mime_type="application/pdf"),
            SimpleNamespace(type="image", url="https://x/y.png", content_base64=None, mime_type=None),
        ]
    )
    assert [type(p).__name__ for p in parts] == [
        "VideoUrl",
        "BinaryContent",
        "BinaryContent",
        "ImageUrl",
    ]
    assert attachments_to_parts(None) == []


def test_model_for_tier_defaults():
    # With no config overrides, tiers resolve to the historical Gemini model names.
    assert model_for_tier("standard") == "gemini-2.5-flash"
    assert model_for_tier("pro") == "gemini-2.5-pro"
    assert model_for_tier("fast") == "gemini-2.0-flash-lite"
    assert model_for_tier("interactive") == "gemini-2.5-flash-lite"
    assert model_for_tier("interactive_pro") == "gemini-3-flash-preview"
