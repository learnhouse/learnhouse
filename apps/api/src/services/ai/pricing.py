"""AI pricing: provider prices, the money value of a credit, and per-feature credit prices.

One place answers three questions:

1. What did a model call cost us? (``MODEL_PRICES`` + ``cost_usd``)
2. What is one credit worth to us? (``CREDIT_VALUE_USD``)
3. How many credits does a feature charge? (``FEATURES`` + ``credits_for_cost`` /
   ``estimate_credits`` / ``settle_credits``)

The rule every price here follows: our provider cost for a request is at most half
of what the credits we charge for it are worth (``MARGIN_FLOOR = 2.0``), measured
at p90 usage. Metered features charge ``max(published minimum, cost x 2 / credit
value)`` rounded up to whole credits, so a long or heavy request can never sell
below the floor; flat features have a published price checked against the p90 cost
in ``src/tests/services/ai/fixtures/ai_usage_fixtures.json``.

Updating prices: edit ``MODEL_PRICES`` (keep the source and date), then run
``pytest src/tests/services/ai/test_pricing.py`` -- it fails when a flat feature
price no longer covers its recorded p90 cost at the floor.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Iterable, Optional

# ── Credit value ───────────────────────────────────────────────────────────────
#
# The LOWEST money value of one credit across everything we sell, so the margin
# rule holds for every customer:
#   - "LearnHouse 500 AI Credits" pack, Stripe price price_1T9CMND4mnPUYnAGe0nQPv7r,
#     $5.00 / month for 500 credits                               -> $0.0100
#   - Family plan, annual: $360 / 12 / 3,000 included credits     -> $0.0100
#   - Personal annual $108/12/500 = $0.018; Standard annual $468/12/1,000 = $0.039;
#     Pro annual $1,428/12/3,000 = $0.040 (2,000 in the API: $0.060). Monthly is higher.
# (Stripe live prices read 2026-11-09.) Enterprise has unlimited credits under a
# contract, so this rule can't be enforced per credit there.
CREDIT_VALUE_USD = 0.01
CREDIT_VALUE_SOURCE = "Stripe: 500 AI credits pack $5.00/mo (lowest $/credit), read 2026-11-09"

# Provider cost must be <= 1 / MARGIN_FLOOR of the charged value (2.0 = 50% gross margin).
MARGIN_FLOOR = 2.0

PRICES_AS_OF = "2026-11-09"
PRICE_SOURCE = "https://aistudio.google.com/docs/pricing (Gemini API, Standard paid tier)"


# ── Provider prices ────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ModelPrice:
    """USD per 1M tokens (Standard paid tier) unless a field says otherwise."""

    input: float
    output: float  # text output, thinking tokens included (Gemini bills them as output)
    cached_input: Optional[float] = None
    audio_input: Optional[float] = None
    # Image / audio output tokens are billed at their own rate on image / TTS models.
    image_output: Optional[float] = None
    audio_output: Optional[float] = None
    # Prompts above this many tokens use the long-context prices.
    long_context_threshold: Optional[int] = None
    input_long: Optional[float] = None
    output_long: Optional[float] = None
    source: str = PRICE_SOURCE


@dataclass(frozen=True)
class DatedPrice:
    """A price that changes on a known date (announced on the pricing page)."""

    current: ModelPrice
    changes_on: date
    then: ModelPrice


# Gemini 3.6 Flash: $0.75 / $3.75 through 2026-12-31, $1.50 / $7.50 from 2027-01-01.
_FLASH_36_NOW = ModelPrice(input=0.75, output=3.75, cached_input=0.075, audio_input=0.75)
_FLASH_36_2027 = ModelPrice(input=1.50, output=7.50, cached_input=0.15, audio_input=1.50)

MODEL_PRICES: dict[str, ModelPrice | DatedPrice] = {
    # Text / multimodal. `gemini-3.5-flash` (our standard tier) is answered by
    # `gemini-3.6-flash` today (the response's model_version says so), which is the
    # model Google bills. When a response doesn't name its model we price the
    # request at the last published 3.5 Flash rate, the higher of the two.
    "gemini-3.6-flash": DatedPrice(_FLASH_36_NOW, date(2027, 1, 1), _FLASH_36_2027),
    "gemini-3.8-flash": DatedPrice(_FLASH_36_NOW, date(2027, 1, 1), _FLASH_36_2027),
    "gemini-3.5-flash": ModelPrice(
        input=1.50, output=9.00, cached_input=0.15, audio_input=1.50,
        source="Gemini API price table as of May 2026 (no longer listed; served as 3.6 Flash)",
    ),
    "gemini-3.5-flash-lite": ModelPrice(input=0.30, output=2.50, cached_input=0.03, audio_input=0.30),
    "gemini-3.1-flash-lite": ModelPrice(input=0.25, output=1.50, cached_input=0.025, audio_input=0.50),
    "gemini-3-flash-preview": ModelPrice(input=0.50, output=3.00, cached_input=0.05, audio_input=1.00),
    "gemini-3.1-pro-preview": ModelPrice(
        input=2.00, output=12.00, cached_input=0.20, audio_input=2.00,
        long_context_threshold=200_000, input_long=4.00, output_long=18.00,
    ),
    "gemini-2.5-flash": ModelPrice(input=0.30, output=2.50, cached_input=0.03, audio_input=1.00),
    "gemini-2.5-pro": ModelPrice(
        input=1.25, output=10.00, cached_input=0.125,
        long_context_threshold=200_000, input_long=2.50, output_long=15.00,
    ),
    # Image models: image output tokens at their own rate (1K image ~1,120-1,290 tokens).
    "gemini-3.1-flash-lite-image": ModelPrice(input=0.25, output=1.50, image_output=30.00),  # ~$0.034 / 1K image
    "gemini-3.1-flash-image": ModelPrice(input=0.50, output=3.00, image_output=60.00),  # ~$0.067 / 1K image
    "gemini-3-pro-image": ModelPrice(input=2.00, output=12.00, image_output=120.00),  # ~$0.134 / 1K-2K image
    "gemini-3-pro-image-preview": ModelPrice(input=2.00, output=12.00, image_output=120.00),
    "gemini-2.5-flash-image": ModelPrice(input=0.30, output=2.50, image_output=30.00),  # ~$0.039 / image
    # Speech (TTS): text in, audio tokens out (~25 audio tokens per second).
    "gemini-2.5-flash-preview-tts": ModelPrice(input=0.50, output=10.00, audio_output=10.00),
    "gemini-2.5-pro-preview-tts": ModelPrice(input=1.00, output=20.00, audio_output=20.00),
    "gemini-3.1-flash-tts-preview": ModelPrice(input=1.00, output=20.00, audio_output=20.00),
    # Embeddings: input only.
    "gemini-embedding-001": ModelPrice(input=0.15, output=0.0),
    "gemini-embedding-2": ModelPrice(input=0.20, output=0.0),
    "text-embedding-3-small": ModelPrice(
        input=0.02, output=0.0, source="https://openai.com/api/pricing (2026-11-09)"
    ),
}

# Unknown models (an operator override, another provider) are priced like the most
# expensive text model we know, so a new model can never sell below the floor.
FALLBACK_PRICE = ModelPrice(
    input=4.00, output=18.00, cached_input=0.40, audio_input=4.00,
    source="fallback: gemini-3.1-pro-preview long-context price",
)

# Local / self-hosted models cost us nothing per token.
_FREE_PREFIXES = ("ollama:", "nomic-embed", "dev:", "test")


def _base_name(model: str) -> str:
    name = (model or "").strip().lower()
    for prefix in ("models/", "google-gla:", "google-vertex:", "google:", "gemini:"):
        if name.startswith(prefix):
            name = name[len(prefix):]
    return name


def price_for(model: str, *, on: Optional[date] = None, planning: bool = False) -> ModelPrice:
    """Price row for ``model``.

    ``planning=True`` returns the highest price announced for the model (a dated
    price's later row when it is higher), so credit prices set today still hold
    after an announced provider increase. Billing reports use ``on`` (today).
    """
    name = _base_name(model)
    if not name or any(name.startswith(p) for p in _FREE_PREFIXES):
        return ModelPrice(input=0.0, output=0.0, source="local model")
    row = MODEL_PRICES.get(name)
    if row is None:
        # Versioned ids ("gemini-3.1-flash-lite-001") fall back to their family.
        for known in sorted(MODEL_PRICES, key=len, reverse=True):
            if name.startswith(known):
                row = MODEL_PRICES[known]
                break
    if row is None:
        return FALLBACK_PRICE
    if isinstance(row, DatedPrice):
        if planning:
            return row.then if row.then.input >= row.current.input else row.current
        today = on or date.today()
        return row.then if today >= row.changes_on else row.current
    return row


# ── Usage and cost ─────────────────────────────────────────────────────────────


@dataclass
class Usage:
    """Billable units of one provider call."""

    model: str
    input_tokens: int = 0
    output_tokens: int = 0  # text + thinking
    cached_input_tokens: int = 0  # part of input_tokens billed at the cached rate
    audio_input_tokens: int = 0  # part of input_tokens billed at the audio rate
    image_output_tokens: int = 0
    audio_output_tokens: int = 0
    requests: int = 1

    def as_dict(self) -> dict[str, Any]:
        return {
            "model": self.model,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cached_input_tokens": self.cached_input_tokens,
            "audio_input_tokens": self.audio_input_tokens,
            "image_output_tokens": self.image_output_tokens,
            "audio_output_tokens": self.audio_output_tokens,
            "requests": self.requests,
        }


def cost_usd(usage: Usage, *, on: Optional[date] = None, planning: bool = False) -> float:
    """What ``usage`` costs at the provider's list price (USD)."""
    p = price_for(usage.model, on=on, planning=planning)
    long_ctx = bool(p.long_context_threshold and usage.input_tokens > p.long_context_threshold)
    in_rate = (p.input_long if long_ctx and p.input_long is not None else p.input)
    out_rate = (p.output_long if long_ctx and p.output_long is not None else p.output)
    cached = min(max(usage.cached_input_tokens, 0), max(usage.input_tokens, 0))
    audio_in = min(max(usage.audio_input_tokens, 0), max(usage.input_tokens - cached, 0))
    plain_in = max(usage.input_tokens - cached - audio_in, 0)
    total = plain_in * in_rate
    total += cached * (p.cached_input if p.cached_input is not None else in_rate)
    total += audio_in * (p.audio_input if p.audio_input is not None else in_rate)
    total += max(usage.output_tokens, 0) * out_rate
    total += max(usage.image_output_tokens, 0) * (p.image_output if p.image_output is not None else out_rate)
    total += max(usage.audio_output_tokens, 0) * (p.audio_output if p.audio_output is not None else out_rate)
    return total / 1_000_000


def total_cost_usd(usages: Iterable[Usage], *, on: Optional[date] = None, planning: bool = False) -> float:
    return sum(cost_usd(u, on=on, planning=planning) for u in usages)


def credits_for_cost(cost: float) -> int:
    """Whole credits whose value covers ``cost`` at the margin floor (rounded up)."""
    if cost <= 0:
        return 0
    raw = cost * MARGIN_FLOOR / CREDIT_VALUE_USD
    # Float noise (2.0000000001) must not add a credit.
    return int(math.ceil(raw - 1e-9))


def margin_multiple(credits: int, cost: float) -> Optional[float]:
    """Charged value / provider cost (2.0 = cost is 50% of the value). None when free."""
    if cost <= 0:
        return None
    return round(credits * CREDIT_VALUE_USD / cost, 3)


def gross_margin_pct(credits: int, cost: float) -> Optional[float]:
    """(value - cost) / value, in percent. None when nothing was charged."""
    value = credits * CREDIT_VALUE_USD
    if value <= 0:
        return None
    return round((value - cost) / value * 100, 1)


# ── Features ───────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class FeaturePrice:
    """What a feature charges.

    ``credits`` is the published price per ``unit``. A ``metered`` feature charges
    ``max(credits x units, actual cost at the floor)``: ``credits`` is its minimum,
    and the estimate shown before it runs. ``p90_cost_usd`` is the recorded p90
    provider cost per unit (see the usage fixtures), kept here for the superadmin
    view and the margin tests.
    """

    key: str
    label: str
    credits: int
    unit: str = "request"  # request | message | image | minute | page | step | lesson | item
    metered: bool = False
    group: str = "content"  # atlas | content | learners | media
    edition: str = "oss"  # oss | ee
    p90_cost_usd: float = 0.0
    note: str = ""
    # Extra credits per extra unit for features priced as "base + per unit"
    # (AI grading media). 0 = the unit price is ``credits``.
    extra: dict[str, int] = field(default_factory=dict)
    # Platform work we pay for but don't charge (metered for the cost reports only).
    absorbed: bool = False
    # What a typical request charges (p50 at the standard model tier), when that
    # is above the minimum: what the customer sees as "About N credits".
    typical: int = 0

    @property
    def shown(self) -> int:
        return max(self.credits, self.typical)


_f = FeaturePrice


FEATURES: dict[str, FeaturePrice] = {
    fp.key: fp
    for fp in [
        # Atlas (EE): usage-based. The published number is the minimum per message;
        # long jobs (many steps) charge their real cost at the floor.
        _f("atlas_chat", "Atlas message", 3, "message", metered=True, group="atlas", edition="ee", typical=18, p90_cost_usd=0.130,
           note="Charged by usage: a long multi-step job costs more"),
        _f("atlas_scheduled", "Scheduled agent run", 3, "run", metered=True, group="atlas", edition="ee", typical=18, p90_cost_usd=0.130),
        _f("course_builder_plan", "Course builder: course plan", 4, "plan", metered=True, group="atlas", edition="ee", typical=6),
        _f("course_builder_lesson", "Course builder: lesson", 4, "lesson", metered=True, group="atlas", edition="ee", typical=9),
        _f("ai_editor_turn", "AI Editor message", 3, "message", metered=True, group="atlas", edition="ee", typical=18, p90_cost_usd=0.130),
        _f("ai_editor_complete", "AI Editor autocomplete", 1, "request", metered=True, group="atlas", edition="ee"),
        _f("thumbnail", "Course thumbnail", 8, "image", group="media", p90_cost_usd=0.0354),
        _f("image_generation", "Image generation", 9, "image", group="media", p90_cost_usd=0.0388),
        # Course content generation (OSS).
        _f("course_planning", "Course planning", 2, "request", metered=True, typical=4, p90_cost_usd=0.0317),
        _f("editor_ai", "Editor AI actions", 1, "request", metered=True, typical=3, p90_cost_usd=0.0174),
        _f("magic_block", "Magic block", 3, "generation", metered=True, p90_cost_usd=0.0031),
        _f("quiz_generation", "Quiz generation", 2, "request", metered=True, typical=4, p90_cost_usd=0.0785),
        _f("assignment_generation", "Assignment generation", 3, "request", metered=True, typical=4, p90_cost_usd=0.0460),
        _f("scenario_generation", "Scenario generation", 2, "request", metered=True, typical=4, p90_cost_usd=0.0285),
        _f("seo_generation", "SEO generation", 1, "request", metered=True, typical=2, p90_cost_usd=0.0076),
        # Landing page builder: a whole page from a brief, and copy rewrites.
        _f("landing_generation", "Landing page generation", 3, "page", metered=True, typical=4),
        _f("landing_copy", "Landing page copy", 1, "request", metered=True),
        _f("course_import", "Course import", 1, "request", metered=True),
        _f("boards_playground", "Board playground", 3, "generation", metered=True),
        _f("translation", "Course translation", 1, "item", metered=True, p90_cost_usd=0.0004),
        # Learners.
        _f("ask_ai", "Ask AI (learners)", 1, "message", metered=True, group="learners", typical=2, p90_cost_usd=0.0169),
        _f("ai_grading", "AI grading", 2, "submission", metered=True, group="learners", typical=3,
           extra={"media_minutes": 1, "document_pages": 1, "images": 1}),
        _f("messaging_agent", "AI messaging agent", 2, "reply", metered=True, group="learners"),
        # Media.
        _f("podcast_script", "Podcast script", 1, "script", metered=True, group="media", typical=3, p90_cost_usd=0.0135),
        _f("podcast_audio", "Podcast / voice audio", 4, "minute", metered=True, group="media", p90_cost_usd=0.0159),
        _f("captions", "Video captions", 1, "minute", metered=True, group="media"),
        _f("video_chapters", "Video chapters", 1, "request", metered=True, group="media"),
        # Live sessions (EE): summary of a recording's transcript (transcription uses "captions").
        _f("live_session_summary", "Live session summary", 1, "request", metered=True, group="media", edition="ee"),
        _f("media_indexing", "Media indexing (Ask AI)", 1, "minute", metered=True, group="media"),
        # Plays (EE).
        _f("plays_generation", "Plays generation", 3, "generation", metered=True, edition="ee"),
        _f("plays_step", "Plays AI step (learners)", 1, "step", metered=True, group="learners", edition="ee"),
        _f("plays_copilot", "Plays copilot", 1, "message", metered=True, edition="ee"),
        # Newsletter (EE): subject lines and a body drafted from a prompt.
        _f("newsletter_draft", "Newsletter draft", 2, "request", metered=True, edition="ee", typical=3),
        # Org MCP tools that call a model.
        _f("mcp_tools", "MCP AI tools", 1, "request", metered=True, edition="oss"),
        # Keeping the Ask AI index fresh when content changes: embeddings only
        # (~$0.0001 per page), absorbed by the platform, metered for the reports.
        _f("rag_indexing", "Content indexing (Ask AI)", 0, "page", metered=True, group="learners", absorbed=True,
           note="Included: not charged"),
    ]
}


def feature(key: str) -> FeaturePrice:
    """The feature's price row. Unknown keys raise: every charge names a real feature."""
    try:
        return FEATURES[key]
    except KeyError as e:  # pragma: no cover - programming error
        raise KeyError(f"Unknown AI feature '{key}'. Add it to pricing.FEATURES.") from e


def estimate_credits(key: str, units: float = 1, *, extra: Optional[dict[str, float]] = None) -> int:
    """Credits to reserve (and to show the customer) before ``key`` runs.

    ``units`` multiplies the published price (minutes of audio, images, lessons).
    ``extra`` adds ``FeaturePrice.extra`` per-unit surcharges (AI grading media).
    """
    fp = feature(key)
    total = fp.credits * max(units, 0)
    for name, count in (extra or {}).items():
        total += fp.extra.get(name, 0) * max(count, 0)
    return max(1, int(math.ceil(total - 1e-9))) if total > 0 else 0


def settle_credits(key: str, cost: float, *, minimum: Optional[int] = None) -> int:
    """Credits a finished request costs: never less than its published minimum,
    never less than its provider cost at the floor. Flat features charge their
    published price (their p90 cost is checked by the tests)."""
    fp = feature(key)
    if fp.absorbed:
        return 0
    floor = fp.credits if minimum is None else minimum
    if not fp.metered:
        return floor
    return max(floor, credits_for_cost(cost))


def p90_credits(fp: FeaturePrice) -> int:
    """Credits charged for the feature's recorded p90 request."""
    if fp.absorbed:
        return 0
    if not fp.metered:
        return fp.credits
    return max(fp.credits, credits_for_cost(fp.p90_cost_usd))


def public_price_table() -> list[dict[str, Any]]:
    """Published per-feature prices for the usage page / API docs."""
    return [public_price_table_row(fp) for fp in FEATURES.values()]


def pricing_summary() -> dict[str, Any]:
    """Everything the superadmin view shows about pricing."""
    rows = []
    for fp in FEATURES.values():
        value = fp.credits * CREDIT_VALUE_USD
        rows.append(
            {
                **public_price_table_row(fp),
                "value_usd": round(value, 4),
                "p90_cost_usd": fp.p90_cost_usd,
                "typical": fp.shown,
                # What the p90 request is charged (metered features follow their cost).
                "p90_credits": p90_credits(fp),
                "p90_margin_multiple": None if fp.absorbed else margin_multiple(p90_credits(fp), fp.p90_cost_usd),
            }
        )
    return {
        "credit_value_usd": CREDIT_VALUE_USD,
        "credit_value_source": CREDIT_VALUE_SOURCE,
        "margin_floor": MARGIN_FLOOR,
        "prices_as_of": PRICES_AS_OF,
        "price_source": PRICE_SOURCE,
        "features": rows,
        "models": model_price_table(),
    }


def public_price_table_row(fp: FeaturePrice) -> dict[str, Any]:
    return {
        "key": fp.key,
        "label": fp.label,
        "credits": fp.credits,
        "unit": fp.unit,
        "metered": fp.metered,
        "group": fp.group,
        "edition": fp.edition,
        "extra": dict(fp.extra),
        "note": fp.note,
        "absorbed": fp.absorbed,
        # "About N credits" before it runs (the minimum, or a typical request when higher).
        "typical": fp.shown,
    }


def model_price_table(on: Optional[date] = None) -> list[dict[str, Any]]:
    out = []
    for name in MODEL_PRICES:
        now = price_for(name, on=on)
        plan = price_for(name, planning=True)
        out.append(
            {
                "model": name,
                "input_per_m": now.input,
                "output_per_m": now.output,
                "cached_input_per_m": now.cached_input,
                "audio_input_per_m": now.audio_input,
                "image_output_per_m": now.image_output,
                "audio_output_per_m": now.audio_output,
                "planning_input_per_m": plan.input,
                "planning_output_per_m": plan.output,
                "source": now.source,
            }
        )
    return out
