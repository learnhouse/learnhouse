"""Every path that calls a model charges AI credits.

Two layers:

1. A static census: every function under ``src/`` that calls the model layer
   (text generation, streaming, embeddings, image, speech, a raw provider
   client) is listed in ``COVERED`` with the charge that pays for it. A new
   caller fails ``test_every_model_call_site_is_covered`` until it runs under
   ``metering.charge`` (or ``metering.start``) and is added here.
2. Endpoint runs: the model layer is swapped for pydantic-ai's TestModel (or a
   fake provider client), ``metering.STRICT_UNMETERED`` makes any model call
   outside a charge raise, and each AI endpoint / job is run end to end. The
   test asserts the charge settled for the right feature with the model usage
   recorded on it.
"""

import ast
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic_ai.models.test import TestModel

from src.services.ai import metering

pytestmark = pytest.mark.asyncio

SRC = Path(__file__).resolve().parents[3]  # .../src

# Calls into the model layer.
MODEL_CALLS = {
    "generate", "generate_stream", "embed_documents", "embed_query", "generate_image",
    "generate_speech", "generate_spoken_script", "ask_ai", "ask_ai_stream",
    "generate_follow_up_suggestions", "build_model", "Client", "generate_embeddings",
    "embed_single_text", "embed",
}

# (module, enclosing function) -> the charge that pays for it.
COVERED = {
    # The model layer itself (records usage on the active charge).
    ("services/ai/llm/client.py", "_agent"): "metered model",
    ("services/ai/llm/embeddings.py", "embed_documents"): "metered embeddings",
    ("services/ai/llm/embeddings.py", "embed_query"): "metered embeddings",
    ("services/ai/image/generator.py", "generate_image"): "records usage (image_generation)",
    ("services/ai/audio/generator.py", "generate_speech"): "records usage (podcast_audio)",
    ("services/ai/audio/generator.py", "generate_spoken_script"): "podcast_script",
    ("services/ai/rag/embedding_service.py", "generate_embeddings"): "rag_indexing",
    ("services/ai/rag/embedding_service.py", "embed_single_text"): "ask_ai / mcp_tools / messaging_agent",
    ("services/ai/rag/query_service.py", "search_course_content"): "ask_ai / mcp_tools / messaging_agent",
    ("services/ai/rag/pipeline.py", "_store"): "rag_indexing",
    # Helpers called only inside a charge.
    ("services/ai/base.py", "ask_ai"): "ask_ai",
    ("services/ai/base.py", "ask_ai_stream"): "ask_ai / editor_ai / messaging_agent",
    ("services/ai/base.py", "generate_follow_up_suggestions"): "ask_ai / editor_ai / messaging_agent",
    ("services/ai/quiz.py", "generate_quiz"): "quiz_generation",
    ("services/ai/scenario.py", "generate_scenario"): "scenario_generation",
    ("services/ai/assignment_gen.py", "generate_assignment_plan"): "assignment_generation",
    ("services/ai/chapters.py", "generate_chapters"): "video_chapters",
    ("services/ai/captions.py", "_transcribe_chunk"): "captions / media_indexing / ai_grading",
    ("services/ai/captions.py", "translate_vtt"): "captions",
    ("services/ai/courseplanning.py", "generate_course_plan_stream"): "course_planning",
    ("services/ai/courseplanning.py", "generate_activity_content_stream"): "course_planning",
    ("services/ai/magicblocks.py", "generate_magicblock_stream"): "magic_block",
    ("services/ai/grading/grader.py", "grade_with_model"): "ai_grading",
    ("services/seo/ai.py", "suggest_snippet"): "seo_generation",
    ("services/landing/ai.py", "plan_page"): "landing_generation",
    ("services/landing/ai.py", "rewrite_copy"): "landing_copy",
    ("services/courses/migration/migration_service.py", "suggest_structure"): "course_import",
    ("services/messaging/agents.py", "_standalone_question"): "messaging_agent",
    ("services/messaging/agents.py", "_stream_reply"): "messaging_agent",
    # Endpoints (the charge is opened here).
    ("services/ai/ai.py", "ai_start_activity_chat_session"): "ask_ai",
    ("services/ai/ai.py", "ai_send_activity_chat_message"): "ask_ai",
    ("routers/ai/ai.py", "_activity_chat_frames"): "ask_ai",
    ("routers/ai/ai.py", "_editor_chat_frames"): "editor_ai",
    ("routers/ai/ai.py", "api_ai_start_activity_chat_session_stream"): "ask_ai",
    ("routers/ai/ai.py", "api_ai_send_activity_chat_message_stream"): "ask_ai",
    ("routers/ai/ai.py", "api_editor_ai_start_chat_session_stream"): "editor_ai",
    ("routers/ai/ai.py", "api_editor_ai_send_message_stream"): "editor_ai",
    ("routers/ai/images.py", "api_generate_image"): "image_generation",
    ("routers/ai/audio.py", "_generate_audio_block"): "podcast_audio",
    ("routers/ai/audio.py", "api_generate_script"): "podcast_script",
}


def _model_call_sites() -> set[tuple[str, str]]:
    sites: set[tuple[str, str]] = set()
    for path in SRC.rglob("*.py"):
        rel = path.relative_to(SRC).as_posix()
        if rel.startswith("tests/") or rel in ("services/ai/metering.py", "services/ai/llm/provider.py"):
            continue
        tree = ast.parse(path.read_text())
        for fn in ast.walk(tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for node in ast.walk(fn):
                if not isinstance(node, ast.Call):
                    continue
                f = node.func
                name = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", None)
                if name in MODEL_CALLS and not (name == "generate" and isinstance(f, ast.Attribute)):
                    if name == "Client" and not (isinstance(f, ast.Attribute) and getattr(f.value, "id", "") == "genai"):
                        continue
                    sites.add((rel, fn.name))
    return sites


def test_every_model_call_site_is_covered():
    found = _model_call_sites()
    missing = sorted(found - set(COVERED))
    assert not missing, (
        "These functions call a model but no AI charge is recorded for them. Run them under "
        "metering.charge(...) (src/services/ai/metering.py) and add them to COVERED: " + json.dumps(missing)
    )


def test_covered_list_has_no_stale_entries():
    stale = sorted(set(COVERED) - _model_call_sites())
    assert not stale, f"Remove entries that no longer call a model: {stale}"


# ── endpoint runs ──────────────────────────────────────────────────────────


@pytest.fixture
def strict_models(monkeypatch, ai_credit_spy):
    """Every pydantic-ai model is a metered TestModel; unmetered calls raise."""
    monkeypatch.setattr("src.services.ai.llm.provider._build_raw_model", lambda name: TestModel())
    monkeypatch.setattr(metering, "STRICT_UNMETERED", True)
    monkeypatch.setattr("src.services.security.rate_limiting.enforce_ai_rate_limit", lambda *a, **k: None)
    return ai_credit_spy


def _settled(spy, feature):
    meters = [m for m in spy.settled if m.feature == feature]
    assert meters, f"no {feature} charge settled (got {spy.features})"
    return meters[-1]


def _fake_genai(response):
    client = MagicMock()
    client.aio.models.generate_content = AsyncMock(return_value=response)
    return MagicMock(return_value=client)


def _detail(mod, n):
    return SimpleNamespace(modality=SimpleNamespace(name=mod), token_count=n)


async def _drain(gen):
    return [frame async for frame in gen]


async def test_seo_suggestion_charges(strict_models, db, org, mock_request, admin_user):
    from src.routers import seo as seo_router
    from src.services.seo import seo as seo_service

    settings = {"org_id": org.id, "name": "Python", "description": "Learn"}
    with patch.object(seo_service, "get_seo_settings", new=AsyncMock(return_value=settings)), \
         patch.object(seo_router, "enforce_ai_rate_limit"):
        await seo_router.api_ai_suggest(
            seo_router.SeoSuggestRequest(org_id=org.id, resource_type="course", resource_uuid="c1"),
            mock_request, db, admin_user,
        )
    assert _settled(strict_models, "seo_generation").usages


def _org_db(*rows):
    db = AsyncMock()
    results = []
    for row in rows:
        scalars = MagicMock()
        scalars.first.return_value = row
        results.append(MagicMock(scalars=MagicMock(return_value=scalars)))
    db.execute.side_effect = results + [MagicMock()] * 10
    return db


@pytest.mark.parametrize("module,func,body_cls,feature,request_first", [
    ("quiz", "api_generate_quiz", "GenerateQuizRequest", "quiz_generation", False),
    ("scenario", "api_generate_scenario", "GenerateScenarioRequest", "scenario_generation", True),
])
async def test_block_generators_charge(strict_models, module, func, body_cls, feature, request_first):
    import importlib

    router = importlib.import_module(f"src.routers.ai.{module}")
    schemas = importlib.import_module(f"src.services.ai.schemas.{module}")
    org = SimpleNamespace(id=5, org_uuid="org_x")
    body = getattr(schemas, body_cls)(org_id=5, prompt="photosynthesis")
    args = (MagicMock(), body) if request_first else (body, MagicMock())
    with patch.object(router, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(router, "enforce_org_mfa", new=AsyncMock()), \
         patch.object(router, "require_org_create_permission", new=AsyncMock()), \
         patch.object(router, "enforce_ai_rate_limit"), \
         patch.object(router, "resolve_model_for_org", new=AsyncMock(return_value="gemini-3.1-flash-lite")), \
         patch.object(router, "record_generation", new=AsyncMock(return_value=SimpleNamespace(ai_generation_uuid="g"))):
        try:
            await getattr(router, func)(*args, SimpleNamespace(id=1), _org_db(org))
        except Exception:
            pass  # TestModel output may not pass the block's checks; the charge still settles
    assert _settled(strict_models, feature).usages


async def test_assignment_generation_charges(strict_models):
    from src.routers.ai import assignment_gen as router
    from src.services.ai.schemas.assignment import GenerateAssignmentRequest

    org = SimpleNamespace(id=5, org_uuid="org_x")
    course = SimpleNamespace(id=3, org_id=5, course_uuid="course_1")
    with patch.object(router, "is_org_member", new=AsyncMock(return_value=True)), \
         patch.object(router, "enforce_org_mfa", new=AsyncMock()), \
         patch.object(router, "check_resource_access", new=AsyncMock()), \
         patch.object(router, "enforce_ai_rate_limit"), \
         patch.object(router, "resolve_model_for_org", new=AsyncMock(return_value="gemini-3.1-flash-lite")), \
         patch.object(router, "record_generation", new=AsyncMock(return_value=SimpleNamespace(ai_generation_uuid="g"))):
        try:
            await router.api_generate_assignment(
                GenerateAssignmentRequest(org_id=5, course_uuid="course_1", prompt="dns"),
                MagicMock(), SimpleNamespace(id=1), _org_db(org, course),
            )
        except Exception:
            pass
    assert _settled(strict_models, "assignment_generation").usages


async def test_image_generation_charges(strict_models, monkeypatch):
    from src.routers.ai import images as img
    from src.services.ai.schemas.image import GenerateImageRequest

    part = SimpleNamespace(inline_data=SimpleNamespace(data=b"PNG"))
    response = SimpleNamespace(
        candidates=[SimpleNamespace(content=SimpleNamespace(parts=[part]))],
        usage_metadata=SimpleNamespace(prompt_token_count=20, candidates_token_count=1290, thoughts_token_count=0,
                                       cached_content_token_count=0, candidates_tokens_details=[_detail("IMAGE", 1290)],
                                       prompt_tokens_details=[]),
        model_version="gemini-2.5-flash-image",
    )
    monkeypatch.setattr("google.genai.Client", _fake_genai(response))
    monkeypatch.setattr("src.services.ai.image.generator._resolve_image_config", lambda: ("k", "gemini-2.5-flash-image"))
    org = SimpleNamespace(id=5, org_uuid="org_x")
    with patch.object(img, "_load_org_and_authorize", new=AsyncMock(return_value=org)), \
         patch.object(img, "enforce_ai_rate_limit"), \
         patch.object(img, "upload_content", new=AsyncMock()), \
         patch.object(img, "record_generation", new=AsyncMock(return_value=SimpleNamespace(ai_generation_uuid="g"))):
        await img.api_generate_image(GenerateImageRequest(org_id=5, prompt="a cat"), SimpleNamespace(id=1), AsyncMock())
    meter = _settled(strict_models, "image_generation")
    assert meter.usages[0].image_output_tokens == 1290


async def test_audio_and_script_charge(strict_models, monkeypatch):
    from src.routers.ai import audio as aud
    from src.services.ai.schemas.audio import GenerateAudioRequest, GenerateScriptRequest

    pcm = b"\x00\x00" * 24000 * 61  # 61 seconds -> 2 started minutes
    part = SimpleNamespace(inline_data=SimpleNamespace(data=pcm, mime_type="audio/L16;rate=24000"))
    response = SimpleNamespace(
        candidates=[SimpleNamespace(content=SimpleNamespace(parts=[part]))],
        usage_metadata=SimpleNamespace(prompt_token_count=30, candidates_token_count=1525, thoughts_token_count=0,
                                       cached_content_token_count=0, candidates_tokens_details=[_detail("AUDIO", 1525)],
                                       prompt_tokens_details=[]),
        model_version="gemini-2.5-flash-preview-tts",
    )
    monkeypatch.setattr("google.genai.Client", _fake_genai(response))
    monkeypatch.setattr("src.services.ai.audio.generator._resolve_tts_config", lambda: ("k", "gemini-2.5-flash-preview-tts"))
    with patch.object(aud, "_resolve_org_id_for_activity", new=AsyncMock(return_value=5)), \
         patch.object(aud, "enforce_ai_rate_limit"), \
         patch.object(aud, "create_audio_block", new=AsyncMock(return_value={"ok": True})):
        await aud.api_generate_audio(MagicMock(), GenerateAudioRequest(activity_uuid="a", text="hello there"), SimpleNamespace(id=1), AsyncMock())
        await aud.api_generate_script(MagicMock(), GenerateScriptRequest(activity_uuid="a", text="dns"), SimpleNamespace(id=1), AsyncMock())
    audio = _settled(strict_models, "podcast_audio")
    assert audio.units == 2 and audio.usages[0].audio_output_tokens == 1525
    assert _settled(strict_models, "podcast_script").usages


async def test_streams_charge(strict_models):
    """Magic blocks, course planning, activity chat and editor AI all stream;
    each settles its charge when the stream ends (boards: ee/tests)."""
    from src.routers.ai import ai as ai_router
    from src.routers.ai import courseplanning as cp
    from src.routers.ai import magicblocks as mb
    from src.services.ai.base import ask_ai_stream

    async def text_stream():
        model = __import__("src.services.ai.llm", fromlist=["generate_stream"])
        async for chunk in model.generate_stream(model_name="gemini-3.1-flash-lite", user_prompt="hi"):
            yield chunk

    for feature, gen in [
        ("magic_block", lambda m: mb.event_generator(text_stream(), "s", meter=m)),
        ("course_planning", lambda m: cp.event_generator(text_stream(), "s", meter=m)),
        ("course_planning", lambda m: cp.event_generator_with_save(text_stream(), "s", "a", meter=m)),
    ]:
        meter = await metering.start(feature, org_id=5, db=None)
        await _drain(gen(meter))
        assert meter.settled and meter.usages, feature

    with patch.object(ai_router, "save_message_to_history"), patch.object(ai_router, "track_ai_message", new=AsyncMock()):
        for feature, gen in [
            ("ask_ai", ai_router.activity_chat_event_generator),
            ("editor_ai", ai_router.editor_chat_event_generator),
        ]:
            meter = await metering.start(feature, org_id=5, db=None)
            stream = ask_ai_stream("q", [], "context", "system", "gemini-3.1-flash-lite")
            frames = await _drain(gen(stream, "chat", "act", "q", "context", "gemini-3.1-flash-lite", org_id=5, meter=meter))
            assert any('"credits"' in f for f in frames), feature
            # The follow-up suggestions ran on the same charge.
            assert len(meter.usages) == 2, feature


async def test_embedding_paths_charge(strict_models, monkeypatch):
    """RAG search, the MCP/Atlas search tool and content indexing."""
    from src.services.ai.llm import embeddings
    from src.services.ai.rag import embedding_service

    class FakeEmbedder:
        model = SimpleNamespace(model_name="gemini-embedding-001")

        async def embed(self, texts, input_type):
            texts = [texts] if isinstance(texts, str) else texts
            return SimpleNamespace(embeddings=[[0.0] * 3 for _ in texts], usage=None, model_name=None)

    monkeypatch.setattr(embeddings, "_embedder", lambda: FakeEmbedder())
    async with metering.charge("ask_ai", org_id=5, db=None) as meter:
        await embedding_service.embed_single_text("what is dns")
        await embedding_service.generate_embeddings(["a", "b"])
    assert len(meter.usages) == 2 and meter.usages[0].input_tokens > 0


async def test_rag_search_endpoint_charges(strict_models):
    from src.routers.ai import rag as rag_router

    scope = SimpleNamespace(course_ids=[1])
    with patch.object(rag_router, "_open_rag", new=AsyncMock(return_value=(5, scope))), \
         patch.object(rag_router, "search_course_content", new=AsyncMock(return_value=[])):
        await rag_router.api_rag_search(MagicMock(), rag_router.RAGSearchRequest(query="dns", course_uuid="c"), SimpleNamespace(id=1), AsyncMock())
    assert "ask_ai" in strict_models.features


async def test_rag_indexing_is_metered_but_free(strict_models, monkeypatch):
    from src.services.ai.rag import pipeline

    seen = []

    async def fake_embeddings(texts):
        metering.record_usage(metering.Usage(model="gemini-embedding-001", input_tokens=len(texts) * 100))
        seen.append(len(texts))
        return [[0.0] * 3 for _ in texts]

    monkeypatch.setattr(pipeline, "generate_embeddings", fake_embeddings)
    monkeypatch.setattr(pipeline.store, "current_hash", AsyncMock(return_value=None))
    monkeypatch.setattr(pipeline.store, "replace", AsyncMock())
    segment = SimpleNamespace(text="hello world " * 50, source_type=SimpleNamespace(value="text"), block_uuid=None,
                              locator=None, chapter_name=None)
    extraction = SimpleNamespace(ref=SimpleNamespace(key="k"), segments=[segment], org_id=5, course_id=1,
                                 activity_id=2, activity_uuid="a", activity_name="A", chapter_name="C", course_name="Co")
    await pipeline._store(extraction, AsyncMock())
    meter = _settled(strict_models, "rag_indexing")
    assert meter.credits == 0 and meter.cost_usd > 0 and seen


async def test_discovery_search_charges(strict_models):
    from src.services.ai.tools import discovery

    ctx = SimpleNamespace(request=MagicMock(), user=SimpleNamespace(id=1), org=SimpleNamespace(slug="o"), db_session=AsyncMock())
    p = SimpleNamespace(course_uuid=None, query="dns", limit=3)
    with patch("src.routers.ai.rag._open_rag", new=AsyncMock(return_value=(5, SimpleNamespace(course_ids=[1])))), \
         patch("src.services.ai.rag.query_service.search_course_content", new=AsyncMock(return_value=[])):
        await discovery._passages(ctx, p)
    assert "mcp_tools" in strict_models.features
