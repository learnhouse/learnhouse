"""Pricing math (src/services/ai/pricing.py) and the margin floor at p90.

The floor rule: our provider cost for a request is at most 1 / MARGIN_FLOOR of
the money value of the credits we charge for it, measured on the recorded p90
usage of every feature (fixtures/ai_usage_fixtures.json).
"""

import json
import math
from datetime import date
from pathlib import Path

import pytest

from src.services.ai import pricing
from src.services.ai.pricing import Usage

FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "ai_usage_fixtures.json").read_text())


def _usages(rows):
    return [Usage(**row) for row in rows]


# ── provider prices ────────────────────────────────────────────────────────


def test_plain_text_cost():
    u = Usage(model="gemini-3.1-flash-lite", input_tokens=1_000_000, output_tokens=1_000_000)
    assert pricing.cost_usd(u) == pytest.approx(0.25 + 1.50)


def test_cached_and_audio_input_rates():
    u = Usage(
        model="gemini-3.1-flash-lite",
        input_tokens=3_000_000,
        cached_input_tokens=1_000_000,
        audio_input_tokens=1_000_000,
    )
    # 1M plain at 0.25, 1M cached at 0.025, 1M audio at 0.50
    assert pricing.cost_usd(u) == pytest.approx(0.25 + 0.025 + 0.50)


def test_cached_and_audio_are_clamped_to_input():
    u = Usage(model="gemini-3.1-flash-lite", input_tokens=100, cached_input_tokens=500, audio_input_tokens=500)
    assert pricing.cost_usd(u) == pytest.approx(100 * 0.025 / 1e6)


def test_missing_cached_or_audio_rate_falls_back_to_input():
    u = Usage(model="gemini-2.5-pro", input_tokens=100_000, audio_input_tokens=50_000)
    assert pricing.cost_usd(u) == pytest.approx(0.125)
    u = Usage(model="gemini-2.5-flash-image", input_tokens=1_000_000, cached_input_tokens=1_000_000)
    assert pricing.cost_usd(u) == pytest.approx(0.30)


def test_long_context_prices():
    short = Usage(model="gemini-3.1-pro-preview", input_tokens=200_000, output_tokens=0)
    long = Usage(model="gemini-3.1-pro-preview", input_tokens=200_001, output_tokens=1_000_000)
    assert pricing.cost_usd(short) == pytest.approx(0.4)
    assert pricing.cost_usd(long) == pytest.approx(200_001 * 4.0 / 1e6 + 18.0)


def test_image_and_audio_output_rates():
    img = Usage(model="gemini-3.1-flash-lite-image", image_output_tokens=1120)
    assert pricing.cost_usd(img) == pytest.approx(0.0336)
    tts = Usage(model="gemini-2.5-flash-preview-tts", input_tokens=0, audio_output_tokens=1_000_000)
    assert pricing.cost_usd(tts) == pytest.approx(10.0)
    # A text model asked for audio/images bills them at its output rate.
    odd = Usage(model="gemini-3.1-flash-lite", image_output_tokens=1_000_000, audio_output_tokens=1_000_000)
    assert pricing.cost_usd(odd) == pytest.approx(3.0)


def test_dated_price_today_and_planning():
    u = Usage(model="gemini-3.6-flash", input_tokens=1_000_000, output_tokens=1_000_000)
    assert pricing.cost_usd(u, on=date(2026, 12, 31)) == pytest.approx(0.75 + 3.75)
    assert pricing.cost_usd(u, on=date(2027, 1, 1)) == pytest.approx(1.50 + 7.50)
    # Credits are priced on the highest announced price.
    assert pricing.cost_usd(u, planning=True) == pytest.approx(1.50 + 7.50)


def test_planning_keeps_the_current_row_when_it_is_higher(monkeypatch):
    cheaper_later = pricing.DatedPrice(
        pricing.ModelPrice(input=2.0, output=2.0), date(2027, 1, 1), pricing.ModelPrice(input=1.0, output=1.0)
    )
    monkeypatch.setitem(pricing.MODEL_PRICES, "zz-dated", cheaper_later)
    assert pricing.price_for("zz-dated", planning=True).input == 2.0
    assert pricing.price_for("zz-dated", on=date(2027, 1, 2)).input == 1.0


def test_model_name_normalisation_and_families():
    assert pricing.price_for("models/gemini-3.1-flash-lite").input == 0.25
    assert pricing.price_for("google-gla:gemini-3.1-flash-lite").input == 0.25
    # A versioned id prices like its family.
    assert pricing.price_for("gemini-3.1-flash-lite-001").input == 0.25


def test_unknown_model_uses_the_conservative_fallback():
    assert pricing.price_for("some-new-model") is pricing.FALLBACK_PRICE


def test_local_models_are_free():
    for name in ("ollama:llama3", "nomic-embed-text", "", "test"):
        assert pricing.cost_usd(Usage(model=name, input_tokens=10**6, output_tokens=10**6)) == 0


def test_total_cost_sums_calls():
    calls = [Usage(model="gemini-3.1-flash-lite", input_tokens=1_000_000)] * 3
    assert pricing.total_cost_usd(calls) == pytest.approx(0.75)


def test_usage_as_dict_round_trips():
    u = Usage(model="m", input_tokens=1, output_tokens=2, cached_input_tokens=3, audio_input_tokens=4,
              image_output_tokens=5, audio_output_tokens=6, requests=7)
    assert Usage(**u.as_dict()) == u


# ── credits ────────────────────────────────────────────────────────────────


def test_credits_for_cost_rounds_up_at_the_floor():
    assert pricing.credits_for_cost(0) == 0
    assert pricing.credits_for_cost(-1) == 0
    assert pricing.credits_for_cost(0.005) == 1  # exactly 1 credit at a 2x floor
    assert pricing.credits_for_cost(0.0050001) == 2
    assert pricing.credits_for_cost(0.0336) == 7


def test_margin_helpers():
    assert pricing.margin_multiple(2, 0.01) == 2.0
    assert pricing.margin_multiple(2, 0) is None
    assert pricing.gross_margin_pct(2, 0.01) == 50.0
    assert pricing.gross_margin_pct(0, 0.01) is None


def test_estimate_credits_units_and_extras():
    fp = pricing.FEATURES["ai_grading"]
    assert pricing.estimate_credits("ai_grading") == fp.credits
    assert pricing.estimate_credits("podcast_audio", 3) == pricing.FEATURES["podcast_audio"].credits * 3
    extra = {"media_minutes": 2, "images": 1}
    assert pricing.estimate_credits("ai_grading", 1, extra=extra) == fp.credits + 2 * fp.extra["media_minutes"] + fp.extra["images"]
    # Unknown extras cost nothing; fractions round up; no units is free.
    assert pricing.estimate_credits("ai_grading", 1, extra={"nope": 5}) == fp.credits
    assert pricing.estimate_credits("seo_generation", 0.2) == 1
    assert pricing.estimate_credits("seo_generation", 0) == 0
    assert pricing.estimate_credits("rag_indexing", 10) == 0


def test_settle_credits_metered_flat_and_absorbed():
    # Metered: never below the minimum, never below the cost at the floor.
    assert pricing.settle_credits("magic_block", 0.0) == pricing.FEATURES["magic_block"].credits
    assert pricing.settle_credits("magic_block", 1.0) == 200
    assert pricing.settle_credits("magic_block", 0.0, minimum=0) == 0
    # Flat: the published price whatever the cost.
    assert pricing.settle_credits("image_generation", 5.0) == pricing.FEATURES["image_generation"].credits
    # Absorbed: never charged.
    assert pricing.settle_credits("rag_indexing", 5.0) == 0


def test_unknown_feature_is_refused():
    with pytest.raises(KeyError):
        pricing.feature("nope")


def test_public_tables():
    table = pricing.public_price_table()
    assert {row["key"] for row in table} == set(pricing.FEATURES)
    assert all({"label", "credits", "unit", "metered", "absorbed"} <= set(row) for row in table)
    summary = pricing.pricing_summary()
    assert summary["credit_value_usd"] == pricing.CREDIT_VALUE_USD
    assert summary["margin_floor"] == pricing.MARGIN_FLOOR
    assert len(summary["features"]) == len(pricing.FEATURES)
    models = {m["model"]: m for m in summary["models"]}
    assert models["gemini-3.6-flash"]["planning_input_per_m"] == 1.50
    assert pricing.model_price_table(on=date(2026, 11, 9))[0]["model"] in pricing.MODEL_PRICES


# ── the margin floor at p90 ────────────────────────────────────────────────


def test_every_feature_has_usage_fixtures():
    assert set(pricing.FEATURES) <= set(FIXTURES), "record p50/p90 usage for every priced feature"


@pytest.mark.parametrize("key", sorted(pricing.FEATURES))
def test_margin_floor_holds_at_p90(key):
    fp = pricing.FEATURES[key]
    if fp.absorbed:
        pytest.skip("absorbed by the platform: not charged")
    fx = FIXTURES[key]
    units = fx.get("units", 1)
    for level in ("p50_usage", "p90_usage"):
        cost = pricing.total_cost_usd(_usages(fx[level]), planning=True)
        minimum = pricing.estimate_credits(key, units)
        credits = pricing.settle_credits(key, cost, minimum=minimum)
        value = credits * pricing.CREDIT_VALUE_USD
        assert value >= cost * pricing.MARGIN_FLOOR - 1e-12, (
            f"{key} at {level}: {credits} credits (${value:.4f}) do not cover "
            f"${cost:.4f} x {pricing.MARGIN_FLOOR}; raise its price to "
            f"{math.ceil(cost * pricing.MARGIN_FLOOR / pricing.CREDIT_VALUE_USD)}"
        )


def test_typical_and_p90_credits():
    atlas = pricing.FEATURES["atlas_chat"]
    # Shown "About N" is the typical request when above the minimum.
    assert atlas.shown == atlas.typical > atlas.credits
    assert pricing.FEATURES["magic_block"].shown == pricing.FEATURES["magic_block"].credits
    # Metered: the p90 request is charged its cost at the floor; flat: its price; absorbed: nothing.
    assert pricing.p90_credits(atlas) == pricing.credits_for_cost(atlas.p90_cost_usd)
    assert pricing.p90_credits(pricing.FEATURES["thumbnail"]) == pricing.FEATURES["thumbnail"].credits
    assert pricing.p90_credits(pricing.FEATURES["rag_indexing"]) == 0
    rows = {r["key"]: r for r in pricing.pricing_summary()["features"]}
    assert rows["rag_indexing"]["p90_margin_multiple"] is None
    assert rows["atlas_chat"]["p90_margin_multiple"] >= pricing.MARGIN_FLOOR
    assert {r["key"]: r["typical"] for r in pricing.public_price_table()}["atlas_chat"] == atlas.typical
