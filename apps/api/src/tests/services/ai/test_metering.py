"""AI credit metering (src/services/ai/metering.py): reserve -> meter -> settle.

Covers settlement (refund the unused reservation, charge the extra up to the
org's total), refunds on failure, idempotency (settle once, charge keys),
long-run top-ups and budgets, the metered pydantic-ai model, unmetered call
flagging, the usage ledger and the X-AI-Credits-Used header.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

import src.db.ai_usage  # noqa: F401  (registers the ledger table before the test engine)
from src.db.ai_usage import AIUsageEvent
from src.security.features_utils import usage as credit_store
from src.services.ai import metering, pricing
from src.services.ai.pricing import Usage
from src.tests.services.ai.fake_redis import FakeRedis

pytestmark = pytest.mark.asyncio

BIG = Usage(model="gemini-3.1-flash-lite", input_tokens=0, output_tokens=1_000_000)  # $1.50 -> 300 credits


@pytest.fixture
def redis(monkeypatch):
    r = FakeRedis()
    monkeypatch.setattr(credit_store, "_get_redis_client", lambda: r)
    return r


# ── settlement ─────────────────────────────────────────────────────────────


async def test_charge_settles_to_the_minimum_and_refunds_the_rest(ai_credit_spy):
    async with metering.charge("seo_generation", org_id=1, db=None, estimate=5) as meter:
        assert metering.current_meter() is meter
    assert metering.current_meter() is None
    assert ai_credit_spy.reserved == [(1, 5)]
    assert ai_credit_spy.refunded == [(1, 4)]
    assert meter.credits == 1 and meter.status == "ok"
    assert ai_credit_spy.settled == [meter]


async def test_charge_bills_real_usage_above_the_reservation(ai_credit_spy):
    async with metering.charge("magic_block", org_id=2, db=None) as meter:
        metering.record_usage(BIG)
    assert ai_credit_spy.extra == [(2, 300 - pricing.FEATURES["magic_block"].credits)]
    assert meter.credits == 300 and meter.summary()["credits"] == 300


async def test_settlement_stops_at_the_org_total(ai_credit_spy):
    ai_credit_spy_up_to = MagicMock(return_value=10)
    with patch("src.security.features_utils.usage.charge_ai_credit_up_to", ai_credit_spy_up_to):
        async with metering.charge("magic_block", org_id=2, db=None) as meter:
            metering.record_usage(BIG)
    assert meter.status == "partial"
    assert meter.credits == pricing.FEATURES["magic_block"].credits + 10


async def test_exception_refunds_everything_and_reraises(ai_credit_spy):
    with pytest.raises(RuntimeError):
        async with metering.charge("quiz_generation", org_id=3, db=None, charge_key="job-1") as meter:
            metering.record_usage(BIG)
            raise RuntimeError("model down")
    assert meter.status == "refunded" and meter.credits == 0
    assert ai_credit_spy.refunded == [(3, pricing.FEATURES["quiz_generation"].credits)]
    # The refunded row gets its own ledger key, so a retry can reuse "job-1".
    assert meter.charge_key.startswith("job-1#r")


async def test_keep_on_failure_pays_for_produced_usage(ai_credit_spy):
    meter = await metering.start("atlas_chat", org_id=4, db=None, keep_on_failure=True)
    meter.add(BIG)
    assert await meter.settle(failed=True) == 300
    assert meter.status == "ok"
    # Nothing produced: refunded even with keep_on_failure.
    empty = await metering.start("atlas_chat", org_id=4, db=None, keep_on_failure=True)
    assert await empty.settle(failed=True) == 0


async def test_settle_is_idempotent(ai_credit_spy):
    meter = await metering.start("seo_generation", org_id=1, db=None)
    assert await meter.settle() == 1
    assert await meter.settle(failed=True) == 1
    assert len(ai_credit_spy.settled) == 1


async def test_refused_reservation_charges_nothing(ai_credit_spy):
    ai_credit_spy.reserve_error = HTTPException(status_code=403, detail="AI credit limit reached")
    with pytest.raises(HTTPException):
        async with metering.charge("seo_generation", org_id=1, db=None):
            pass  # pragma: no cover - never entered
    assert ai_credit_spy.settled == []


async def test_zero_estimate_reserves_nothing_and_absorbed_never_charges(ai_credit_spy):
    async with metering.charge("rag_indexing", org_id=1, db=None) as meter:
        metering.record_usage(Usage(model="gemini-embedding-001", input_tokens=10_000))
    assert ai_credit_spy.reserved == [] and meter.credits == 0
    assert meter.cost_usd > 0  # the cost is still recorded for the reports


async def test_max_credits_caps_the_reservation_and_the_charge(ai_credit_spy):
    meter = await metering.start("magic_block", org_id=1, db=None, estimate=50, max_credits=4)
    assert meter.reserved == 4
    meter.add(BIG)
    assert meter.credits_due() == 4


async def test_unknown_feature_fails_before_reserving(ai_credit_spy):
    with pytest.raises(KeyError):
        await metering.start("nope", org_id=1, db=None)
    assert ai_credit_spy.reserved == []


async def test_user_comes_from_the_ai_rate_limit_context(ai_credit_spy):
    from src.services.security.rate_limiting import ai_acting_user

    token = ai_acting_user.set((42, 7))
    try:
        mine = await metering.start("seo_generation", org_id=7, db=None)
        other_org = await metering.start("seo_generation", org_id=8, db=None)
    finally:
        ai_acting_user.reset(token)
    assert mine.user_id == 42 and other_org.user_id is None


# ── idempotency keys ───────────────────────────────────────────────────────


async def test_charge_key_blocks_a_second_charge(redis):
    with patch("src.security.features_utils.usage.reserve_ai_credit", AsyncMock()), \
         patch("src.security.features_utils.usage.ai_credit_limits", AsyncMock(return_value=None)), \
         patch.object(metering, "_write_ledger", AsyncMock()):
        meter = await metering.start("captions", org_id=1, db=None, charge_key="captions:a:t1")
        await meter.settle()
        with pytest.raises(metering.DuplicateCharge) as exc:
            await metering.start("captions", org_id=1, db=None, charge_key="captions:a:t1")
    assert exc.value.status_code == 409


async def test_refund_and_refused_reservation_release_the_key(redis):
    with patch("src.security.features_utils.usage.ai_credit_limits", AsyncMock(return_value=None)), \
         patch.object(metering, "_write_ledger", AsyncMock()), \
         patch("src.security.features_utils.usage.refund_ai_credit", MagicMock()):
        with patch("src.security.features_utils.usage.reserve_ai_credit",
                   AsyncMock(side_effect=HTTPException(status_code=403, detail="out"))):
            with pytest.raises(HTTPException):
                await metering.start("captions", org_id=1, db=None, charge_key="k1")
        with patch("src.security.features_utils.usage.reserve_ai_credit", AsyncMock()):
            meter = await metering.start("captions", org_id=1, db=None, charge_key="k1")
            await meter.settle(failed=True)
            again = await metering.start("captions", org_id=1, db=None, charge_key="k1")
    assert again.charge_key == "k1"


async def test_lock_helpers_survive_a_redis_outage(monkeypatch):
    def boom():
        raise ConnectionError("down")

    monkeypatch.setattr(credit_store, "_get_redis_client", boom)
    metering._take_lock("k")  # no exception: the reservation fails closed instead
    metering._forget_lock("")  # nothing to forget


# ── long runs ──────────────────────────────────────────────────────────────


async def test_top_up_grows_the_reservation_with_the_run(ai_credit_spy):
    meter = await metering.start("atlas_chat", org_id=1, db=None)
    assert meter.next_call_headroom() == 1
    meter.add(BIG)
    headroom = meter.next_call_headroom()
    assert headroom == 300
    await meter.top_up(None, headroom=headroom)
    assert meter.reserved == 600
    await meter.top_up(None)  # already covered: no new reservation
    assert ai_credit_spy.reserved[-1] == (1, 600 - pricing.FEATURES["atlas_chat"].credits)


async def test_top_up_stops_at_the_budget(ai_credit_spy):
    meter = await metering.start("atlas_scheduled", org_id=1, db=None, max_credits=10)
    await meter.top_up(None, headroom=50)  # nothing ran yet: capped, not stopped
    assert meter.reserved == 10
    meter.add(Usage(model="gemini-3.1-flash-lite", output_tokens=10_000))  # 3 credits
    with pytest.raises(metering.BudgetReached):
        await meter.top_up(None, headroom=meter.next_call_headroom() + 20)


async def test_top_up_refuses_when_the_org_is_out_of_credits(ai_credit_spy):
    meter = await metering.start("atlas_chat", org_id=1, db=None)
    meter.add(BIG)
    ai_credit_spy.reserve_error = HTTPException(status_code=403, detail="out")
    with pytest.raises(HTTPException):
        await meter.top_up(None, headroom=1)


# ── the metered model ──────────────────────────────────────────────────────


async def test_metered_model_records_each_request(ai_credit_spy):
    model = metering.MeteredModel(TestModel(custom_output_text="hi"), price_name="gemini-3.1-flash-lite")
    async with metering.charge("seo_generation", org_id=1, db=None) as meter:
        await Agent(model).run("hello")
        async with Agent(model).run_stream("hello again") as run:
            await run.get_output()
    assert len(meter.usages) == 2
    assert all(u.input_tokens > 0 for u in meter.usages)


async def test_metered_model_keeps_the_local_price_name():
    model = metering.MeteredModel(TestModel(), price_name="ollama:llama3")
    meter = metering.Meter(feature="seo_generation", org_id=1)
    with metering.use_meter(meter):
        await Agent(model).run("hello")
    assert meter.usages[0].model == "ollama:llama3"
    assert meter.cost_usd == 0


async def test_streamed_calls_are_metered_too(ai_credit_spy):
    model = metering.MeteredModel(TestModel(custom_output_text="ok"), price_name="m")
    metering.STRICT_UNMETERED = True
    try:
        with pytest.raises(metering.UnmeteredModelCall):
            async with Agent(model).run_stream("x") as run:
                await run.get_output()
    finally:
        metering.STRICT_UNMETERED = False


def test_usage_from_request_usage_splits_image_and_audio():
    u = SimpleNamespace(
        input_tokens=100, output_tokens=1500, cache_read_tokens=10, input_audio_tokens=0,
        output_audio_tokens=0, details={"image_candidates_tokens": 1290, "audio_prompt_tokens": 40},
    )
    got = metering.usage_from_request_usage("gemini-2.5-flash-image", u)
    assert (got.output_tokens, got.image_output_tokens, got.audio_input_tokens, got.cached_input_tokens) == (210, 1290, 40, 10)


def test_usage_from_genai_response():
    detail = lambda mod, n: SimpleNamespace(modality=SimpleNamespace(name=mod), token_count=n)  # noqa: E731
    meta = SimpleNamespace(
        prompt_token_count=120, candidates_token_count=1300, thoughts_token_count=30,
        cached_content_token_count=0,
        candidates_tokens_details=[detail("IMAGE", 1290), detail("TEXT", 10)],
        prompt_tokens_details=[detail("AUDIO", 50)],
    )
    got = metering.usage_from_genai_response("gemini-3.1-flash-lite-image", SimpleNamespace(usage_metadata=meta, model_version=None))
    assert got.model == "gemini-3.1-flash-lite-image"
    assert (got.image_output_tokens, got.output_tokens, got.audio_input_tokens) == (1290, 40, 50)
    empty = metering.usage_from_genai_response("m", SimpleNamespace(usage_metadata=None, model_version="m2"))
    assert empty.model == "m2" and empty.input_tokens == 0


# ── unmetered calls ────────────────────────────────────────────────────────


def test_unmetered_call_is_counted(redis):
    metering.record_usage(Usage(model="gemini-3.1-flash-lite", input_tokens=1_000_000))
    from src.services.ai.usage_reports import unmetered_calls

    rows = unmetered_calls(days=1)
    assert rows == [{"model": "gemini-3.1-flash-lite", "calls": 1, "cost_usd": 0.25}]


def test_unmetered_flagging_survives_redis_errors(monkeypatch):
    monkeypatch.setattr(credit_store, "_get_redis_client", MagicMock(side_effect=ConnectionError))
    metering.record_usage(Usage(model="m"))  # logged, not raised


def test_strict_mode_raises_on_unmetered_calls():
    metering.STRICT_UNMETERED = True
    try:
        with pytest.raises(metering.UnmeteredModelCall):
            metering.record_usage(Usage(model="m"))
    finally:
        metering.STRICT_UNMETERED = False


def test_a_settled_meter_does_not_take_more_usage():
    meter = metering.Meter(feature="seo_generation", org_id=1, settled=True)
    metering.STRICT_UNMETERED = True
    try:
        with metering.use_meter(meter), pytest.raises(metering.UnmeteredModelCall):
            metering.record_usage(Usage(model="m"))
    finally:
        metering.STRICT_UNMETERED = False


def test_use_meter_survives_a_context_switch():
    import contextvars

    cm = metering.use_meter(metering.Meter(feature="seo_generation", org_id=1))
    cm.__enter__()
    # Exited from another context (an async generator closed by another task):
    # the token is foreign there, so it just clears the meter.
    other = contextvars.copy_context()
    other.run(cm.__exit__, None, None, None)
    assert other.run(metering.current_meter) is None
    metering._current.set(None)


# ── the ledger ─────────────────────────────────────────────────────────────


async def test_settlement_writes_a_ledger_row(engine, monkeypatch):
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(metering, "_session_factory", lambda: factory)
    with patch("src.security.features_utils.usage.reserve_ai_credit", AsyncMock()), \
         patch("src.security.features_utils.usage.ai_credit_limits", AsyncMock(return_value=None)), \
         patch("src.security.features_utils.usage.charge_ai_credit_up_to", MagicMock(return_value=10)):
        async with metering.charge("seo_generation", org_id=1, db=None, user_id=5) as meter:
            metering.record_usage(Usage(model="gemini-3.1-flash-lite", input_tokens=1000, output_tokens=2000))
            metering.record_usage(Usage(model="gemini-3.1-flash-lite", input_tokens=10, output_tokens=0))
    async with factory() as session:
        row = (await session.execute(select(AIUsageEvent))).scalars().one()
    assert (row.org_id, row.user_id, row.feature, row.credits, row.status) == (1, 5, "seo_generation", meter.credits, "ok")
    assert row.requests == 2 and row.input_tokens == 1010 and row.output_tokens == 2000
    assert row.models[0]["requests"] == 2
    assert row.cost_micros == round(meter.cost_usd * 1_000_000)


async def test_a_lost_ledger_write_is_only_logged(monkeypatch):
    monkeypatch.setattr(metering, "_session_factory", lambda: MagicMock(side_effect=RuntimeError("db down")))
    await metering._write_ledger(metering.Meter(feature="seo_generation", org_id=1))


def test_default_session_factory_is_the_app_one():
    from src.core.events.database import _async_session_factory

    assert metering._session_factory() is _async_session_factory


# ── the X-AI-Credits-Used header ───────────────────────────────────────────


async def test_credits_used_header(ai_credit_spy):
    from src.core.middleware.ai_credits import AICreditsHeaderMiddleware

    app = FastAPI()
    app.add_middleware(AICreditsHeaderMiddleware)

    @app.get("/ai")
    async def ai_route():
        async with metering.charge("seo_generation", org_id=1, db=None):
            pass
        async with metering.charge("quiz_generation", org_id=1, db=None):
            pass
        return {"ok": True}

    @app.get("/plain")
    async def plain_route():
        return {"ok": True}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        ai = await client.get("/ai")
        plain = await client.get("/plain")
    expected = pricing.FEATURES["seo_generation"].credits + pricing.FEATURES["quiz_generation"].credits
    assert ai.headers["x-ai-credits-used"] == str(expected)
    assert "x-ai-credits-used" not in plain.headers


async def test_header_middleware_passes_other_scopes_through():
    from src.core.middleware.ai_credits import AICreditsHeaderMiddleware

    inner = AsyncMock()
    await AICreditsHeaderMiddleware(inner)({"type": "lifespan"}, None, None)
    inner.assert_awaited_once()


# ── the credit store helpers ───────────────────────────────────────────────


def test_charge_up_to_respects_the_total(redis):
    redis.set("ai_credits_used:1", 95)
    redis.set("ai_credits_purchased:1", 0)
    limits = {"base": 100, "extra": 0, "unlimited": False}
    assert credit_store.charge_ai_credit_up_to(1, 20, limits) == 5
    assert credit_store.charge_ai_credit_up_to(1, 20, limits) == 0
    assert credit_store.charge_ai_credit_up_to(1, 0, limits) == 0
    # Unlimited (or unknown limits): charged in full.
    assert credit_store.charge_ai_credit_up_to(1, 7) == 7
    assert redis.get("ai_credits_used:1") == b"107"


async def test_ai_credit_limits(monkeypatch):
    cfg = SimpleNamespace(config={"config_version": "2.0", "overrides": {"ai": {"extra_limit": 50}}, "cloud": {"plan": "standard"}})
    monkeypatch.setattr(credit_store, "_load_org_config_for_ai", AsyncMock(return_value=cfg))
    monkeypatch.setattr(credit_store, "_is_non_saas", lambda: False)
    monkeypatch.setattr(credit_store, "_get_org_plan", lambda c: "standard")
    monkeypatch.setattr(credit_store, "get_ai_credit_limit", lambda plan: 1000)
    assert await credit_store.ai_credit_limits(1, None) == {"base": 1000, "extra": 50, "unlimited": False}
    monkeypatch.setattr(credit_store, "get_ai_credit_limit", lambda plan: -1)
    assert (await credit_store.ai_credit_limits(1, None))["unlimited"] is True
    cfg.config = {"config_version": "1.0"}
    monkeypatch.setattr(credit_store, "get_ai_credit_limit", lambda plan: 20)
    assert await credit_store.ai_credit_limits(1, None) == {"base": 20, "extra": 0, "unlimited": False}
    monkeypatch.setattr(credit_store, "_is_non_saas", lambda: True)
    assert (await credit_store.ai_credit_limits(1, None))["unlimited"] is True
    monkeypatch.setattr(credit_store, "_load_org_config_for_ai", AsyncMock(return_value=None))
    assert (await credit_store.ai_credit_limits(1, None))["unlimited"] is True
