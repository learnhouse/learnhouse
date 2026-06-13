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
from src.services.ai.llm import embeddings as embeddings_mod


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
        ("deepseek", "deepseek-chat", "OpenAIChatModel"),
        ("moonshot", "kimi-k2-0905-preview", "OpenAIChatModel"),
        ("mistral", "mistral-large", "MistralModel"),
    ],
)
def test_build_model_per_provider(monkeypatch, provider, model_name, expected_cls):
    _patch_ai_config(monkeypatch, provider=provider, api_key="test-key")
    model = build_model(model_name)
    assert type(model).__name__ == expected_cls


def test_build_model_openrouter(monkeypatch):
    # OpenRouter is an OpenAI-compatible gateway; its base URL is auto-configured, so the
    # user only supplies an api_key + a model slug. It resolves to an OpenAIChatModel.
    _patch_ai_config(monkeypatch, provider="openrouter", api_key="sk-or-test")
    model = build_model("anthropic/claude-sonnet-4-5")
    assert type(model).__name__ == "OpenAIChatModel"


def test_build_model_openrouter_requires_key(monkeypatch):
    _patch_ai_config(monkeypatch, provider="openrouter", api_key=None)
    with pytest.raises(AINotConfiguredError):
        build_model("openai/gpt-4o-mini")


def test_build_model_ollama_needs_no_key(monkeypatch):
    # Ollama speaks the OpenAI API and requires no real credentials.
    _patch_ai_config(monkeypatch, provider="ollama", base_url="http://localhost:11434/v1")
    model = build_model("llama3.2")
    assert type(model).__name__ == "OpenAIChatModel"


def test_build_model_bedrock_needs_no_api_key(monkeypatch):
    # Bedrock uses the standard AWS credential chain + region (not LEARNHOUSE_AI_API_KEY).
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    _patch_ai_config(monkeypatch, provider="bedrock", api_key=None)
    model = build_model("anthropic.claude-sonnet-4-5-20250929-v1:0")
    assert type(model).__name__ == "BedrockConverseModel"


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
    # With no config overrides, the three tiers resolve to the Gemini 3 family defaults.
    assert model_for_tier("fast") == "gemini-3.1-flash-lite"
    assert model_for_tier("standard") == "gemini-3.5-flash"
    assert model_for_tier("pro") == "gemini-3.1-pro-preview"


# --- Provider-agnostic embeddings ---------------------------------------------------------


def _patch_embed_config(monkeypatch, **overrides):
    fields = {
        "provider": None, "api_key": None, "base_url": None, "gemini_api_key": None,
        "embedding_provider": None, "embedding_model": None, "embedding_dimensions": None,
    }
    fields.update(overrides)
    cfg = SimpleNamespace(**fields)
    monkeypatch.setattr(
        embeddings_mod, "get_learnhouse_config", lambda: SimpleNamespace(ai_config=cfg)
    )


def test_embeddings_follow_google_provider(monkeypatch):
    _patch_embed_config(monkeypatch, provider="google", api_key="g-key")
    assert type(embeddings_mod.build_embedding_model()).__name__ == "GoogleEmbeddingModel"


def test_embeddings_follow_openai_provider(monkeypatch):
    _patch_embed_config(monkeypatch, provider="openai", api_key="sk-key")
    assert type(embeddings_mod.build_embedding_model()).__name__ == "OpenAIEmbeddingModel"


def test_embeddings_follow_ollama_provider(monkeypatch):
    _patch_embed_config(monkeypatch, provider="ollama", base_url="http://localhost:11434/v1")
    assert type(embeddings_mod.build_embedding_model()).__name__ == "OpenAIEmbeddingModel"


def test_embeddings_explicit_override(monkeypatch):
    # Generation on Anthropic, embeddings explicitly on OpenAI.
    _patch_embed_config(monkeypatch, provider="anthropic", api_key="sk-key", embedding_provider="openai")
    assert type(embeddings_mod.build_embedding_model()).__name__ == "OpenAIEmbeddingModel"


def test_embeddings_fall_back_to_gemini_for_providers_without_embeddings(monkeypatch):
    # Anthropic/DeepSeek have no embeddings API -> use Google when a Gemini key is present.
    _patch_embed_config(monkeypatch, provider="anthropic", api_key="sk-ant", gemini_api_key="g-key")
    assert type(embeddings_mod.build_embedding_model()).__name__ == "GoogleEmbeddingModel"


def test_embeddings_raise_when_no_embeddings_capable_config(monkeypatch):
    _patch_embed_config(monkeypatch, provider="deepseek", api_key="sk-ds", gemini_api_key=None)
    with pytest.raises(AINotConfiguredError):
        embeddings_mod.build_embedding_model()


def test_embedding_dimensions_default_and_override(monkeypatch):
    _patch_embed_config(monkeypatch, provider="google", api_key="g")
    assert embeddings_mod.embedding_dimensions() == 768
    _patch_embed_config(monkeypatch, provider="google", api_key="g", embedding_dimensions=1536)
    assert embeddings_mod.embedding_dimensions() == 1536
